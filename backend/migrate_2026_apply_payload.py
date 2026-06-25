#!/usr/bin/env python3
"""【线上执行】把载荷库写入线上：admission_2026 整表替换 + admission_records 追加增量。

只动这两张表：
  · admission_2026          —— DROP 后用载荷的 schema+数据+索引重建（幂等，可重复跑）
  · admission_records       —— append 载荷里的增量行（不含 id，线上自增；不动线上已有数据）
其余表（users/orders/...）完全不碰。默认 DRY-RUN，--apply 才写。

⚠️ 所有表名都显式加 main./pay. 前缀：否则线上 main 尚无 admission_2026 时，不带前缀的
   DROP/SELECT 会按搜索顺序命中「附加的载荷库 pay」，导致误删载荷表。

⚠️ admission_records 是「追加」，重复跑会重复插入。脚本带一次性保护：若检测到增量
   已大部分存在则中止（除非 --force）。

用法（服务器 backend 目录）：
  .venv/bin/python migrate_2026_apply_payload.py --db /app/backend/gaokao.db \
      --payload /app/data/migration_2026_payload.db [--apply] [--force]
"""
import argparse
import os
import sqlite3

KEY = ["province", "school_name", "major_name", "year", "min_score"]


def _sample_already_present(con) -> float:
    """抽样估计增量是否已在线上（防重复追加）。返回命中比例 0~1。"""
    rows = con.execute(
        f"SELECT {', '.join(KEY)} FROM pay.admission_records_delta LIMIT 200"
    ).fetchall()
    if not rows:
        return 0.0
    hit = 0
    for r in rows:
        where = " AND ".join(f"{k} IS ?" for k in KEY)
        if con.execute(f"SELECT 1 FROM main.admission_records WHERE {where} LIMIT 1", r).fetchone():
            hit += 1
    return hit / len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--payload", required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--force", action="store_true", help="跳过重复追加保护")
    args = ap.parse_args()
    for p in (args.db, args.payload):
        if not os.path.exists(p):
            raise SystemExit(f"文件不存在: {p}")

    con = sqlite3.connect(args.db)
    con.execute("ATTACH ? AS pay", (args.payload,))

    a26 = con.execute("SELECT COUNT(*) FROM pay.admission_2026").fetchone()[0]
    delta = con.execute("SELECT COUNT(*) FROM pay.admission_records_delta").fetchone()[0]
    try:
        cur26 = con.execute("SELECT COUNT(*) FROM main.admission_2026").fetchone()[0]
    except sqlite3.OperationalError:
        cur26 = None
    cur_rec = con.execute("SELECT COUNT(*) FROM main.admission_records").fetchone()[0]
    present = _sample_already_present(con)

    print(f"== {'APPLY 写库' if args.apply else 'DRY-RUN 不写'} | 线上库: {args.db} ==")
    print(f"  admission_2026:    线上现有 {cur26}  →  整表替换为 {a26} 行")
    print(f"  admission_records: 线上现有 {cur_rec}  →  追加 {delta} 行（增量抽样已存在率 {present:.0%}）")

    if not args.apply:
        print("（dry-run 结束，未改动线上库；加 --apply 执行）")
        return
    if present > 0.5 and not args.force:
        raise SystemExit("✗ 增量大部分已存在，疑似重复执行，已中止。确认要再追加请加 --force。")

    # 列清单（排除 id，避免与线上主键冲突）
    cols = [r[1] for r in con.execute("PRAGMA main.table_info(admission_records)")]
    collist = ", ".join(c for c in cols if c != "id")

    # 载荷里 admission_2026 的建表/建索引语句（不带库名前缀，CREATE 默认建到 main）
    objs = con.execute(
        "SELECT type, sql FROM pay.sqlite_master WHERE tbl_name='admission_2026' AND sql IS NOT NULL"
    ).fetchall()

    con.execute("BEGIN")
    # admission_2026 整表替换（全部显式 main./pay.）
    con.execute("DROP TABLE IF EXISTS main.admission_2026")
    for ty, sql in objs:
        if ty == "table":
            con.execute(sql)                                   # CREATE TABLE → main
    con.execute("INSERT INTO main.admission_2026 SELECT * FROM pay.admission_2026")
    for ty, sql in objs:
        if ty == "index":
            con.execute(sql)                                   # CREATE INDEX → main
    # admission_records 追加增量
    con.execute(
        f"INSERT INTO main.admission_records ({collist}) "
        f"SELECT {collist} FROM pay.admission_records_delta"
    )
    con.commit()

    print("  ✓ admission_2026:", con.execute("SELECT COUNT(*) FROM main.admission_2026").fetchone()[0], "行")
    print("  ✓ admission_records:", con.execute("SELECT COUNT(*) FROM main.admission_records").fetchone()[0], "行")
    con.execute("DETACH pay")
    con.close()
    print("✓ 完成（仅这两张表，其余表未动）")


if __name__ == "__main__":
    main()
