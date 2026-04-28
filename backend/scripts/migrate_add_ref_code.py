import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "gaokao.db")

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # 检查是否已有 ref_code 列
    cur.execute("PRAGMA table_info(orders)")
    cols = [row[1] for row in cur.fetchall()]
    if "ref_code" in cols:
        print("ref_code 列已存在，跳过迁移")
        conn.close()
        return

    cur.execute("ALTER TABLE orders ADD COLUMN ref_code VARCHAR(10) DEFAULT ''")
    conn.commit()
    conn.close()
    print("迁移完成：orders 表已添加 ref_code 列")

if __name__ == "__main__":
    migrate()
