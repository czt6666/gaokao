import sqlite3
import sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect('../gaokao.db')
c = conn.cursor()

c.execute("""
    SELECT subject_req, COUNT(*) as cnt
    FROM admission_records
    WHERE subject_req IS NOT NULL AND subject_req != ''
    GROUP BY subject_req
    ORDER BY cnt DESC
    LIMIT 50
""")

print("=== subject_req 分布 (前50) ===")
for row in c.fetchall():
    print(f"{row[0]}: {row[1]}")

# 检查包含'化学'的
print("\n=== 包含'化学'的选科要求 ===")
c.execute("""
    SELECT subject_req, COUNT(*) as cnt
    FROM admission_records
    WHERE subject_req LIKE '%化学%'
    GROUP BY subject_req
    ORDER BY cnt DESC
""")
for row in c.fetchall():
    print(f"{row[0]}: {row[1]}")

conn.close()
