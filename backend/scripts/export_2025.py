"""导出2025 rank_tables为CSV和SQL INSERT"""
import sys, os, sqlite3, csv
sys.stdout.reconfigure(encoding="utf-8")
DB = os.path.join(os.path.dirname(__file__), "..", "gaokao.db")
conn = sqlite3.connect(DB)
cur = conn.cursor()

cur.execute("SELECT province,year,category,batch,score,count_this,count_cum,rank_min,rank_max FROM rank_tables WHERE year=2025 ORDER BY province,category,score DESC")
rows = cur.fetchall()

# CSV
csv_path = os.path.join(os.path.dirname(__file__), "..", "data", "rank_tables_2025_export.csv")
with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f)
    w.writerow(["province","year","category","batch","score","count_this","count_cum","rank_min","rank_max"])
    w.writerows(rows)
print(f"CSV exported: {csv_path} ({len(rows)} rows)")

# SQL INSERT dump
sql_path = os.path.join(os.path.dirname(__file__), "..", "data", "rank_tables_2025_export.sql")
with open(sql_path, "w", encoding="utf-8") as f:
    f.write("BEGIN;\n")
    # 先删除旧2025数据（幂等）
    f.write("DELETE FROM rank_tables WHERE year=2025;\n")
    for r in rows:
        f.write(f"INSERT INTO rank_tables (province,year,category,batch,score,count_this,count_cum,rank_min,rank_max) VALUES ({', '.join(repr(x) for x in r)});\n")
    f.write("COMMIT;\n")
print(f"SQL exported: {sql_path} ({len(rows)} rows)")

conn.close()
