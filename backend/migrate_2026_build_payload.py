#!/usr/bin/env python3
"""【本地执行】导出 2026 迁移载荷库（直接发数据，不在服务器重算）。

载荷只含两块、体积最小化：
  · admission_2026          —— 整表（线上新表，全量替换）
  · admission_records_delta —— 本次相对「导入前备份」新增的历年记录（不含 id 列），
                               线上直接 append；不携带线上已有的 240 万基础数据。

去重/对比只在本地做一次（用备份做差集），服务器侧纯粹收数据。

用法（在 backend 目录）：
  .venv/bin/python migrate_2026_build_payload.py \
      --src gaokao.db --backup gaokao.db.bak-before-2026import --out migration_2026_payload.db
"""
import argparse
import os
import sqlite3

KEY = ["province", "school_name", "major_name", "year", "min_score"]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(here, "gaokao.db"))
    ap.add_argument("--backup", default=os.path.join(here, "gaokao.db.bak-before-2026import"),
                    help="导入前的库备份，用于算 admission_records 增量")
    ap.add_argument("--out", default=os.path.join(here, "migration_2026_payload.db"))
    args = ap.parse_args()

    for p in (args.src, args.backup):
        if not os.path.exists(p):
            raise SystemExit(f"文件不存在: {p}")
    if os.path.exists(args.out):
        os.remove(args.out)

    out = sqlite3.connect(args.out)
    out.execute("ATTACH ? AS src", (args.src,))
    out.execute("ATTACH ? AS bak", (args.backup,))

    # ── admission_2026：整表（schema + 数据 + 索引）──
    objs = out.execute(
        "SELECT type, sql FROM src.sqlite_master WHERE tbl_name='admission_2026' AND sql IS NOT NULL"
    ).fetchall()
    for ty, sql in objs:
        if ty == "table":
            out.execute(sql)
    out.execute("INSERT INTO admission_2026 SELECT * FROM src.admission_2026")
    for ty, sql in objs:
        if ty == "index":
            out.execute(sql)
    print("  admission_2026:", out.execute("SELECT COUNT(*) FROM admission_2026").fetchone()[0], "行")

    # ── admission_records 增量（差集，排除 id 列）──
    cols = [r[1] for r in out.execute("PRAGMA src.table_info(admission_records)")]
    collist = ", ".join(c for c in cols if c != "id")
    # 给备份建索引加速反连接（备份是一次性快照，加索引无副作用）
    out.execute(f"CREATE INDEX IF NOT EXISTS bak.ix_key ON admission_records ({', '.join(KEY)})")
    on = " AND ".join(f"b.{k} IS m.{k}" for k in KEY)   # IS：NULL 安全，避免把含 NULL 的旧行误判为新增
    out.execute(f"CREATE TABLE admission_records_delta AS SELECT {collist} FROM src.admission_records WHERE 0")
    out.execute(
        f"INSERT INTO admission_records_delta ({collist}) "
        f"SELECT {', '.join('m.'+c for c in cols if c != 'id')} "
        f"FROM src.admission_records m LEFT JOIN bak.admission_records b ON {on} "
        f"WHERE b.id IS NULL"
    )
    print("  admission_records_delta:", out.execute("SELECT COUNT(*) FROM admission_records_delta").fetchone()[0], "行")

    out.commit()
    for s in ("src", "bak"):
        out.execute(f"DETACH {s}")
    out.execute("VACUUM")
    out.close()
    print(f"✓ 载荷库已生成: {args.out}  ({os.path.getsize(args.out)/1024/1024:.1f} MB)")


if __name__ == "__main__":
    main()
