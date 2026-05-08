"""
Admin 界面优化所需的数据库字段迁移
- feedbacks.user_id
- users.referral_reward_days
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import engine
from sqlalchemy import text

def add_column_if_not_exists(table: str, column: str, dtype: str):
    with engine.connect() as conn:
        # SQLite 检查列是否存在
        rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
        cols = [r[1] for r in rows]
        if column in cols:
            print(f"SKIP: {table}.{column} 已存在")
            return
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {dtype}"))
        conn.commit()
        print(f"OK: added {table}.{column} {dtype}")

def migrate():
    add_column_if_not_exists("feedbacks", "user_id", "INTEGER")
    add_column_if_not_exists("users", "referral_reward_days", "INTEGER DEFAULT 0")

if __name__ == "__main__":
    migrate()
