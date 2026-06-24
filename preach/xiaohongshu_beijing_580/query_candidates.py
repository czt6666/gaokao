import sqlite3
import json

DB_PATH = "/Users/czt/workspace/webfrontend/gaokao/backend/db-backup/gaokao-0523.db"
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

def query_candidates():
    """找北京考生580分附近(565-595)的学校，按2024年最低分排序"""
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
        s.tier
    FROM admission_records a
    LEFT JOIN schools s ON a.school_name = s.name
    WHERE a.province = '北京' AND a.batch = '本科批' AND a.year IN (2022,2023,2024,2025)
    GROUP BY a.school_name
    HAVING 
        (y2024 >= 565 AND y2024 <= 595)
        OR (y2023 >= 565 AND y2023 <= 595)
        OR (y2022 >= 565 AND y2022 <= 595)
    ORDER BY y2024 DESC
    """
    cur = conn.execute(sql)
    rows = [dict(r) for r in cur.fetchall()]
    return rows

def query_school_majors(school_name, years=(2022,2023,2024,2025)):
    """查某学校近几年各专业的录取分数"""
    placeholders = ",".join("?" for _ in years)
    sql = f"""
    SELECT 
        school_name, major_name, year, min_score, min_rank, admit_count, subject_req
    FROM admission_records
    WHERE province='北京' AND batch='本科批' 
      AND school_name=? AND year IN ({placeholders})
    ORDER BY year DESC, min_score DESC
    """
    cur = conn.execute(sql, (school_name, *years))
    return [dict(r) for r in cur.fetchall()]

if __name__ == "__main__":
    candidates = query_candidates()
    print(f"找到候选学校数量: {len(candidates)}")
    
    # 保存候选学校
    with open("/Users/czt/workspace/webfrontend/gaokao/preach/xiaohongshu_beijing_580/candidates_raw.json", "w", encoding="utf-8") as f:
        json.dump(candidates, f, ensure_ascii=False, indent=2)
    
    # 打印前25所
    for i, c in enumerate(candidates[:25]):
        print(f"{i+1}. {c['school_name']} | 2024:{c['y2024']} 2023:{c['y2023']} 2022:{c['y2022']} 2025:{c['y2025']} | 985:{c['is_985']} 211:{c['is_211']} | {c['school_province']}{c['city']}")

conn.close()
