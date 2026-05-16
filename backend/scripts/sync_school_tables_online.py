#!/usr/bin/env python3
"""
同步 admission_records 表到线上数据库（不碰用户表）

使用方式（在线上服务器执行）：
  1. 把本地 gaokao.db 上传到线上（如 /tmp/local_gaokao.db）
  2. 运行：
     python backend/scripts/sync_school_tables_online.py \
       --source /tmp/local_gaokao.db \
       --target /path/to/online_gaokao.db
"""
import argparse
import os
import sqlite3
import time


BATCH_SIZE = 3000


def get_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    cursor = conn.execute(f"PRAGMA table_info({table})")
    return [row[1] for row in cursor.fetchall()]


def sync_admission_records(src: sqlite3.Connection, tgt: sqlite3.Connection) -> int:
    table = "admission_records"

    src_cols = get_columns(src, table)
    tgt_cols = get_columns(tgt, table)

    # 取交集：只同步两边都有的列
    common_cols = [c for c in src_cols if c in tgt_cols]
    if not common_cols:
        print(f"[ERROR] {table} 无公共列，无法同步")
        return 0

    # 如果目标有本地没有的列，打印提示
    extra_in_tgt = [c for c in tgt_cols if c not in src_cols]
    if extra_in_tgt:
        print(f"[WARN] 目标表多出的列（将留空）: {extra_in_tgt}")

    col_str = ", ".join(common_cols)
    placeholders = ", ".join(["?"] * len(common_cols))
    select_sql = f"SELECT {col_str} FROM {table}"
    insert_sql = f"INSERT INTO {table} ({col_str}) VALUES ({placeholders})"

    # 清空目标表
    print("[1/3] 清空线上 admission_records...")
    tgt.execute(f"DELETE FROM {table}")
    try:
        tgt.execute(f"DELETE FROM sqlite_sequence WHERE name='{table}'")
    except Exception:
        pass
    tgt.commit()

    # 读取并写入
    print("[2/3] 开始同步数据...")
    cursor = src.execute(select_sql)
    total = 0
    t0 = time.time()

    while True:
        rows = cursor.fetchmany(BATCH_SIZE)
        if not rows:
            break
        tgt.executemany(insert_sql, rows)
        tgt.commit()
        total += len(rows)
        if total % 30000 == 0:
            elapsed = time.time() - t0
            print(f"  ... 已写入 {total} 行，耗时 {elapsed:.1f}s")

    print(f"[3/3] 同步完成: {total} 行")
    return total


def sync_all(source_path: str, target_path: str):
    if not os.path.exists(source_path):
        print(f"[ERROR] 源数据库不存在: {source_path}")
        return
    if not os.path.exists(target_path):
        print(f"[ERROR] 目标数据库不存在: {target_path}")
        return

    src = sqlite3.connect(source_path)
    tgt = sqlite3.connect(target_path)

    tgt.execute("PRAGMA foreign_keys=OFF")

    t0 = time.time()
    total = sync_admission_records(src, tgt)
    tgt.commit()

    src.close()
    tgt.close()

    elapsed = time.time() - t0
    print(f"\n{'='*50}")
    print(f"总计: {total} 行")
    print(f"耗时: {elapsed:.1f}s ({elapsed/60:.1f}min)")
    print(f"{'='*50}")


def main():
    parser = argparse.ArgumentParser(description="Sync admission_records to online DB")
    parser.add_argument("--source", required=True, help="本地数据库路径（已上传到服务器）")
    parser.add_argument("--target", required=True, help="线上数据库路径")
    args = parser.parse_args()
    sync_all(args.source, args.target)


if __name__ == "__main__":
    main()
