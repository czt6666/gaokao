import sqlite3
import json

DB_PATH = "/Users/czt/workspace/webfrontend/gaokao/backend/db-backup/gaokao-0523.db"
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

SCHOOLS = [
    "北京化工大学",
    "辽宁大学",
    "太原理工大学",
    "天津工业大学",
    "东北师范大学",
    "北京林业大学",
    "北京工业大学",
    "中国地质大学（北京）",
    "中国传媒大学",
    "东北财经大学",
    "陕西师范大学",
    "河北工业大学",
    "江南大学",
    "长安大学",
    "中国石油大学（华东）",
    "西安邮电大学",
    "云南大学",
    "西南大学",
    "上海理工大学",
    "浙江工业大学",
]

results = {}
for school in SCHOOLS:
    sql = """
    SELECT year, major_name, major_group, min_score, min_rank, admit_count, subject_req
    FROM admission_records
    WHERE province='北京' AND batch='本科批' AND school_name=? AND year IN (2022,2023,2024,2025)
    ORDER BY year DESC, min_score DESC
    """
    cur = conn.execute(sql, (school,))
    rows = [dict(r) for r in cur.fetchall()]
    
    affordable = [r for r in rows if r['min_score'] and r['min_score'] <= 590]
    
    summary_sql = """
    SELECT year, MIN(min_score) as min_score, MAX(min_score) as max_score, 
           AVG(min_score) as avg_score, COUNT(*) as major_count
    FROM admission_records
    WHERE province='北京' AND batch='本科批' AND school_name=? AND year IN (2022,2023,2024,2025)
    GROUP BY year
    """
    cur2 = conn.execute(summary_sql, (school,))
    summary = [dict(r) for r in cur2.fetchall()]
    
    results[school] = {
        "all_records": rows,
        "affordable_records": affordable,
        "summary": summary,
        "affordable_count": len(affordable),
        "total_count": len(rows)
    }
    
    print(f"\n=== {school} ===")
    for s in summary:
        avg = f"{s['avg_score']:.1f}" if s['avg_score'] else "None"
        print(f"  {s['year']}: 最低{s['min_score']} 最高{s['max_score']} 平均{avg} 专业数{s['major_count']}")
    if affordable:
        print(f"  580分附近专业({len(affordable)}个):")
        for a in affordable[:8]:
            print(f"    {a['year']} {a['major_name']}: {a['min_score']}分")
    else:
        print("  ⚠️ 580分附近无专业（全部>590）")

with open("/Users/czt/workspace/webfrontend/gaokao/preach/xiaohongshu_beijing_580/schools_20_data.json", "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

conn.close()
