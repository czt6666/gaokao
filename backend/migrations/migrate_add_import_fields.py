#!/usr/bin/env python3
"""
数据库迁移脚本：为 admission_records 增加导入所需字段

使用方式:
  python backend/migrations/migrate_add_import_fields.py --db backend/gaokao.db
"""
import argparse
import sqlite3

COLUMNS_TO_ADD = [
    ("subject_must",      "VARCHAR(100) DEFAULT ''"),
    ("subject_any_of",    "VARCHAR(200) DEFAULT ''"),
    ("major_restrictions", "VARCHAR(200) DEFAULT ''"),
]


def migrate(db_path: str):
    conn = sqlite3.connect(db_path)
    cursor = conn.execute("PRAGMA table_info(admission_records)")
    existing = {row[1] for row in cursor.fetchall()}

    for col_name, col_def in COLUMNS_TO_ADD:
        if col_name in existing:
            print(f"[SKIP] {col_name} 已存在")
        else:
            conn.execute(f"ALTER TABLE admission_records ADD COLUMN {col_name} {col_def}")
            print(f"[ADD]  {col_name} {col_def}")

    conn.commit()
    conn.close()
    print("[DONE]")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Add import fields to admission_records")
    parser.add_argument("--db", default="backend/gaokao.db", help="SQLite database path")
    args = parser.parse_args()
    migrate(args.db)
