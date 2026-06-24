import sqlite3
import json

DB_PATH = "/Users/czt/workspace/webfrontend/gaokao/backend/db-backup/gaokao-0523.db"
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

SCHOOLS = [
    "中央民族大学", "西北农林科技大学", "东北大学秦皇岛分校",
    "西南财经大学", "西安电子科技大学", "南京理工大学",
    "暨南大学", "东华大学", "天津医科大学", "中国药科大学",
    "华中师范大学", "福州大学", "武汉理工大学", "合肥工业大学",
    "中国石油大学（北京）", "哈尔滨工程大学", "北京交通大学",
    "上海大学", "深圳大学", "成都中医药大学"
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
    
    affordable = [r for r in rows if r['min_score'] and r['min_score'] <= 610]
    
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
        print(f"  600分附近专业({len(affordable)}个):")
        for a in affordable[:8]:
            print(f"    {a['year']} {a['major_name']}: {a['min_score']}分")
    else:
        print("  ⚠️ 600分附近无专业（全部>610）")

with open("/Users/czt/workspace/webfrontend/gaokao/preach/xiaohongshu_beijing_600/schools_20_data.json", "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

conn.close()
