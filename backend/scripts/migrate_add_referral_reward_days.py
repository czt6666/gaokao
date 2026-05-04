"""
Migration: add referral_reward_days column to users table
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import engine
from sqlalchemy import text

def migrate():
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN referral_reward_days INTEGER DEFAULT 0"))
        conn.commit()
        print("OK: added users.referral_reward_days")

if __name__ == "__main__":
    migrate()
