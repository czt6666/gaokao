import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "gaokao.db")

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("PRAGMA table_info(orders)")
    cols = [row[1] for row in cur.fetchall()]

    new_cols = [
        ("c_major", "VARCHAR(50) DEFAULT ''"),
        ("c_city", "VARCHAR(20) DEFAULT ''"),
        ("c_nature", "VARCHAR(20) DEFAULT ''"),
        ("c_tier", "VARCHAR(20) DEFAULT ''"),
    ]

    for col_name, col_def in new_cols:
        if col_name in cols:
            print(f"{col_name} 列已存在，跳过")
            continue
        cur.execute(f"ALTER TABLE orders ADD COLUMN {col_name} {col_def}")
        print(f"迁移完成：orders 表已添加 {col_name} 列")

    conn.commit()
    conn.close()

if __name__ == "__main__":
    migrate()
