#!/usr/bin/env python3
"""
线上 admission_records 表结构修复 + 数据同步脚本

功能：
1. 检查线上 admission_records 表结构，自动添加缺失列（subject_must / subject_any_of / major_restrictions）
2. 清空线上 admission_records 表
3. 从本地已导入的数据库复制全部数据到线上数据库

使用方式（在线上服务器执行）：
  1. 先把本地 gaokao.db 上传到线上（例如放到 /tmp/local_gaokao.db）
  2. 运行：
     python sync_admission_online.py \
       --source /tmp/local_gaokao.db \
       --target /path/to/online_gaokao.db

  3. 同步完成后删除 source 文件节省空间：
     rm /tmp/local_gaokao.db
"""
import argparse
import os
import sqlite3
import time


COLUMNS_TO_ADD = [
    ("subject_must",      "VARCHAR(100) DEFAULT ''"),
    ("subject_any_of",    "VARCHAR(200) DEFAULT ''"),
    ("major_restrictions", "VARCHAR(200) DEFAULT ''"),
]

BATCH_SIZE = 3000


def migrate_schema(conn: sqlite3.Connection):
    """检查并添加缺失列"""
    cursor = conn.execute("PRAGMA table_info(admission_records)")
    existing = {row[1] for row in cursor.fetchall()}
    added = []
    for col_name, col_def in COLUMNS_TO_ADD:
        if col_name not in existing:
            conn.execute(f"ALTER TABLE admission_records ADD COLUMN {col_name} {col_def}")
            added.append(col_name)
    if added:
        conn.commit()
        print(f"[MIGRATE] 已添加缺失列: {added}")
    else:
        print("[MIGRATE] 表结构已是最新，无需添加列")
    return added


def get_source_columns(conn: sqlite3.Connection) -> list[str]:
    """获取 source 表的列名顺序"""
    cursor = conn.execute("PRAGMA table_info(admission_records)")
    return [row[1] for row in cursor.fetchall()]


def sync_data(source_path: str, target_path: str):
    if not os.path.exists(source_path):
        print(f"[ERROR] 源数据库不存在: {source_path}")
        return
    if not os.path.exists(target_path):
        print(f"[ERROR] 目标数据库不存在: {target_path}")
        return

    src = sqlite3.connect(source_path)
    tgt = sqlite3.connect(target_path)

    # 1. 迁移目标表结构
    print("[1/4] 检查并修复线上表结构...")
    migrate_schema(tgt)

    # 2. 获取 source 列名，构建动态 SQL
    print("[2/4] 读取源表列信息...")
    src_cols = get_source_columns(src)
    # 去掉 id（自增主键，让 target 自动生成）
    if "id" in src_cols:
        src_cols.remove("id")
    col_str = ", ".join(src_cols)
    placeholders = ", ".join(["?"] * len(src_cols))

    # 3. 清空目标表
    print("[3/4] 清空线上 admission_records...")
    tgt.execute("DELETE FROM admission_records")
    try:
        tgt.execute("DELETE FROM sqlite_sequence WHERE name='admission_records'")
    except Exception:
        pass
    tgt.commit()

    # 4. 读取并写入
    print("[4/4] 开始同步数据...")
    select_sql = f"SELECT {col_str} FROM admission_records"
    insert_sql = f"INSERT INTO admission_records ({col_str}) VALUES ({placeholders})"

    cursor = src.execute(select_sql)
    batch = []
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

    # 写入剩余
    if batch:
        tgt.executemany(insert_sql, batch)
        tgt.commit()
        total += len(batch)

    src.close()
    tgt.close()

    elapsed = time.time() - t0
    print(f"[DONE] 同步完成: {total} 行，耗时 {elapsed:.1f}s ({elapsed/60:.1f}min)")


def main():
    parser = argparse.ArgumentParser(description="Sync admission_records from local to online DB")
    parser.add_argument("--source", required=True, help="本地导入完成的数据库路径（已上传到服务器）")
    parser.add_argument("--target", required=True, help="线上正在运行的数据库路径")
    args = parser.parse_args()

    sync_data(args.source, args.target)


if __name__ == "__main__":
    main()
