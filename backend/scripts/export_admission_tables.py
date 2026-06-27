#!/usr/bin/env python3
"""
导出 admission_records + admission_2026 两张表为独立的小 SQLite 文件，
供全量替换式线上同步使用（重建表，非增量）。

本地导出 -> gzip -> 上传 -> 服务器 ATTACH 替换。
排除其余 30+ 张表，导出体积远小于 2.9GB 全库。

用法（在 backend 目录）:
  # 导出
  .venv/bin/python scripts/export_admission_tables.py --export admission_sync.db --db gaokao.db

  # 服务器应用（替换线上两表）
  .venv/bin/python scripts/export_admission_tables.py --apply admission_sync.db --db /app/backend/gaokao.db
"""
import argparse
import gzip
import os
import shutil
import sqlite3
import sys
import time

SYNC_TABLES = ["admission_records", "admission_2026"]


def export_tables(source_db: str, output: str, tables: list[str] = SYNC_TABLES):
    """用 VACUUM INTO 导出只含两表的精简库，再 gzip。"""
    if not os.path.exists(source_db):
        sys.exit(f"源库不存在: {source_db}")

    tmp_db = output + ".tmp.db"
    for p in (tmp_db, output, output + ".gz"):
        if os.path.exists(p):
            os.remove(p)

    src = sqlite3.connect(source_db)

    # 1) 在新库里建表（schema + 数据）
    print(f"导出 {tables} 到精简库...")
    src.execute(f"ATTACH DATABASE '{tmp_db}' AS sync")
    for tbl in tables:
        # 取建表 SQL
        ddl = src.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (tbl,)
        ).fetchone()
        if not ddl:
            print(f"  ⚠ 跳过不存在的表: {tbl}")
            continue
        src.execute(ddl[0].replace(f"TABLE {tbl}", f"TABLE sync.{tbl}", 1)
                    .replace(f'TABLE "{tbl}"', f'TABLE sync."{tbl}"', 1))
        src.execute(f"INSERT INTO sync.{tbl} SELECT * FROM main.{tbl}")
        cnt = src.execute(f"SELECT COUNT(*) FROM sync.{tbl}").fetchone()[0]
        print(f"  {tbl}: {cnt:,} 行")
    src.commit()
    src.execute("DETACH DATABASE sync")
    src.close()

    # 2) gzip
    print("压缩...")
    with open(tmp_db, "rb") as f_in, gzip.open(output + ".gz", "wb", compresslevel=6) as f_out:
        shutil.copyfileobj(f_in, f_out)
    os.remove(tmp_db)

    size_mb = os.path.getsize(output + ".gz") / 1024 / 1024
    print(f"✅ 导出完成: {output}.gz ({size_mb:.1f} MB)")


def apply_tables(sync_file: str, target_db: str, tables: list[str] = SYNC_TABLES):
    """在服务器上用同步库替换线上表（事务内 DELETE + INSERT）。"""
    if not os.path.exists(sync_file):
        # 允许传 .gz
        if os.path.exists(sync_file + ".gz"):
            sync_file = sync_file + ".gz"
        else:
            sys.exit(f"同步文件不存在: {sync_file}")
    if not os.path.exists(target_db):
        sys.exit(f"目标库不存在: {target_db}")

    # 解压（如是 .gz）
    work_db = sync_file
    if sync_file.endswith(".gz"):
        work_db = sync_file[:-3]
        print("解压同步库...")
        with gzip.open(sync_file, "rb") as f_in, open(work_db, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)

    tgt = sqlite3.connect(target_db)
    tgt.execute("PRAGMA journal_mode=WAL")
    tgt.execute(f"ATTACH DATABASE '{work_db}' AS sync")

    t0 = time.time()
    for tbl in tables:
        # 同步库里有这张表才替换
        exists = tgt.execute(
            "SELECT 1 FROM sync.sqlite_master WHERE type='table' AND name=?", (tbl,)
        ).fetchone()
        if not exists:
            print(f"  ⚠ 同步库缺表 {tbl}，跳过")
            continue

        # 确保目标表存在（不存在则按同步库 schema 建）
        tgt_exists = tgt.execute(
            "SELECT 1 FROM main.sqlite_master WHERE type='table' AND name=?", (tbl,)
        ).fetchone()
        if not tgt_exists:
            ddl = tgt.execute(
                "SELECT sql FROM sync.sqlite_master WHERE type='table' AND name=?", (tbl,)
            ).fetchone()[0]
            tgt.execute(ddl)
            print(f"  [CREATE] {tbl}")

        # 列对齐：目标表缺少同步库里的列时，先 ALTER TABLE 补列（保证新字段不丢）
        tgt_cols = [r[1] for r in tgt.execute(f"PRAGMA main.table_info({tbl})")]
        sync_info = {r[1]: r[2] for r in tgt.execute(f"PRAGMA sync.table_info({tbl})")}
        for col_name, col_type in sync_info.items():
            if col_name not in tgt_cols:
                tgt.execute(f"ALTER TABLE main.{tbl} ADD COLUMN {col_name} {col_type or 'TEXT'}")
                print(f"  [ALTER] {tbl} ADD {col_name}")
        # 重新读取目标列
        tgt_cols = [r[1] for r in tgt.execute(f"PRAGMA main.table_info({tbl})")]
        sync_cols = list(sync_info.keys())
        common = [c for c in sync_cols if c in tgt_cols]
        col_str = ",".join(common)

        n_before = tgt.execute(f"SELECT COUNT(*) FROM main.{tbl}").fetchone()[0]
        tgt.execute("BEGIN")
        tgt.execute(f"DELETE FROM main.{tbl}")
        tgt.execute(f"INSERT INTO main.{tbl} ({col_str}) SELECT {col_str} FROM sync.{tbl}")
        tgt.execute("COMMIT")
        n_after = tgt.execute(f"SELECT COUNT(*) FROM main.{tbl}").fetchone()[0]
        print(f"  {tbl}: {n_before:,} -> {n_after:,} 行 ({len(common)}/{len(sync_cols)} 列)")

    tgt.execute("DETACH DATABASE sync")
    tgt.close()

    # 清理解压临时库
    if work_db != sync_file:
        os.remove(work_db)

    print(f"✅ 应用完成 ({time.time() - t0:.0f}s)")


def main():
    ap = argparse.ArgumentParser(description="全量替换式同步 admission_records + admission_2026")
    ap.add_argument("--db", required=True, help="数据库路径（导出=源，应用=目标）")
    ap.add_argument("--export", metavar="OUTPUT", help="导出精简库（输出 OUTPUT.gz）")
    ap.add_argument("--apply", metavar="SYNC_FILE", help="应用精简库到目标库（替换表）")
    ap.add_argument("--tables", help=f"逗号分隔的表名，覆盖默认 {SYNC_TABLES}")
    args = ap.parse_args()

    tables = [t.strip() for t in args.tables.split(",")] if args.tables else SYNC_TABLES

    if args.export:
        export_tables(args.db, args.export, tables)
    elif args.apply:
        apply_tables(args.apply, args.db, tables)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
