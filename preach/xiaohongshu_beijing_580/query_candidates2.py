import sqlite3
import json

DB_PATH = "/Users/czt/workspace/webfrontend/gaokao/backend/db-backup/gaokao-0523.db"
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

# 更严格筛选：近三年至少一年最低分在570-590之间，且2024年不超过590（否则580冲不上）
sql = """
SELECT 
    a.school_name,
    MIN(CASE WHEN a.year=2022 THEN a.min_score END) as y2022,
    MIN(CASE WHEN a.year=2023 THEN a.min_score END) as y2023,
    MIN(CASE WHEN a.year=2024 THEN a.min_score END) as y2024,
    MIN(CASE WHEN a.year=2025 THEN a.min_score END) as y2025,
    COUNT(*) as record_count,
    s.is_985,
    s.is_211,
    s.is_shuangyiliu,
    s.province as school_province,
    s.city,
    s.tier,
    s.tags,
    s.employment_quality
FROM admission_records a
LEFT JOIN schools s ON a.school_name = s.name
WHERE a.province = '北京' AND a.batch = '本科批' AND a.year IN (2022,2023,2024,2025)
GROUP BY a.school_name
HAVING 
    (y2024 IS NOT NULL AND y2024 BETWEEN 570 AND 590)
    OR (y2023 IS NOT NULL AND y2023 BETWEEN 570 AND 590)
    OR (y2022 IS NOT NULL AND y2022 BETWEEN 570 AND 590)
ORDER BY y2024 DESC
"""

cur = conn.execute(sql)
rows = [dict(r) for r in cur.fetchall()]

# 过滤：排除2024年最低分>590的学校（580分基本冲不上）
filtered = [r for r in rows if r['y2024'] is None or r['y2024'] <= 590]

with open("/Users/czt/workspace/webfrontend/gaokao/preach/xiaohongshu_beijing_580/candidates_filtered.json", "w", encoding="utf-8") as f:
    json.dump(filtered, f, ensure_ascii=False, indent=2)

print(f"过滤后候选学校数量: {len(filtered)}")
for i, c in enumerate(filtered[:40]):
    print(f"{i+1}. {c['school_name']} | 2024:{c['y2024']} 2023:{c['y2023']} 2022:{c['y2022']} 2025:{c['y2025']} | 985:{c['is_985']} 211:{c['is_211']} | {c['school_province']}{c['city']}")

conn.close()
