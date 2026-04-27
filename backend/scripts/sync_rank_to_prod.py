"""
将本地 2025 一分一段数据同步到线上 SQLite 数据库。
用法：
  python scripts/sync_rank_to_prod.py /path/to/remote/gaokao.db
或：
  python scripts/sync_rank_to_prod.py --dry-run /path/to/remote/gaokao.db

原理：
  1. 读取本地 gaokao.db 中 year=2025 的 rank_tables 数据
  2. 连接到线上 DB（直接文件路径或先 scp 到本地处理）
  3. 幂等写入：先 DELETE year=2025，再 INSERT（避免重复）
  4. 事务包裹，出错自动回滚

安全提示：
  - 线上 DB 操作前请确保已备份
  - 建议先 --dry-run 看影响行数
"""
import sys, os, argparse, sqlite3
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.stdout.reconfigure(encoding="utf-8")

LOCAL_DB = os.path.join(os.path.dirname(__file__), "..", "gaokao.db")


def fetch_local_rows() -> list[tuple]:
    conn = sqlite3.connect(LOCAL_DB)
    cur = conn.cursor()
    cur.execute(
        "SELECT province, year, category, batch, score, count_this, count_cum, rank_min, rank_max "
        "FROM rank_tables WHERE year=2025 ORDER BY province, category, score DESC"
    )
    rows = cur.fetchall()
    conn.close()
    return rows


def sync(target_db_path: str, dry_run: bool = False):
    rows = fetch_local_rows()
    if not rows:
        print("本地无 2025 数据")
        return

    print(f"本地共 {len(rows)} 条 2025 数据待同步")

    if dry_run:
        print("\n[Dry-run] 只打印前 3 条示例:")
        for r in rows[:3]:
            print(" ", r)
        print(f"\n[Dry-run] 将删除目标库 year=2025 的 rank_tables 数据，再插入 {len(rows)} 条")
        return

    if not os.path.exists(target_db_path):
        print(f"目标数据库不存在: {target_db_path}")
        sys.exit(1)

    conn = sqlite3.connect(target_db_path)
    cur = conn.cursor()

    # 确认目标库有 rank_tables 表
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='rank_tables'")
    if not cur.fetchone():
        print("目标库缺少 rank_tables 表，请先初始化 schema")
        sys.exit(1)

    # 统计目标库现有 2025 数据
    cur.execute("SELECT COUNT(*) FROM rank_tables WHERE year=2025")
    old_count = cur.fetchone()[0]
    print(f"目标库现有 2025 数据: {old_count} 条")

    try:
        conn.execute("BEGIN")
        cur.execute("DELETE FROM rank_tables WHERE year=2025")
        deleted = cur.rowcount

        cur.executemany(
            "INSERT INTO rank_tables (province, year, category, batch, score, count_this, count_cum, rank_min, rank_max) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows
        )
        inserted = cur.rowcount
        conn.commit()
        print(f"✅ 同步完成: 删除 {deleted} 条旧数据，插入 {inserted} 条新数据")
    except Exception as e:
        conn.rollback()
        print(f"❌ 同步失败，已回滚: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("target_db", help="线上 SQLite 数据库路径（若在同一机器）或本地副本路径")
    p.add_argument("--dry-run", action="store_true", help="只打印影响行数，不实际写入")
    args = p.parse_args()
    sync(args.target_db, dry_run=args.dry_run)
