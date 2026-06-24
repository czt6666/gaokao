import sqlite3
import json

DB_PATH = "/Users/czt/workspace/webfrontend/gaokao/backend/db-backup/gaokao-0523.db"
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

# 精选20所学校（全国分布，层次多样，580±10分）
SCHOOLS = [
    "北京化工大学",      # 211 北京
    "辽宁大学",          # 211 沈阳
    "太原理工大学",      # 211 太原
    "天津工业大学",      # 双一流 天津
    "东北师范大学",      # 211 长春
    "北京林业大学",      # 211 北京
    "北京工业大学",      # 211 北京
    "中国地质大学（北京）", # 211 北京
    "中国传媒大学",      # 211 北京
    "东北财经大学",      # 双非 大连
    "陕西师范大学",      # 211 西安
    "河北工业大学",      # 211 天津
    "江南大学",          # 211 无锡
    "长安大学",          # 211 西安
    "中国石油大学（华东）", # 211 青岛
    "西安邮电大学",      # 双非 西安
    "云南大学",          # 211 昆明
    "西南大学",          # 211 重庆
    "上海理工大学",      # 双非 上海
    "浙江工业大学",      # 双非 杭州
]

results = {}
for school in SCHOOLS:
    # 查各年各专业录取分
    sql = """
    SELECT year, major_name, major_group, min_score, min_rank, admit_count, subject_req
    FROM admission_records
    WHERE province='北京' AND batch='本科批' AND school_name=? AND year IN (2022,2023,2024,2025)
    ORDER BY year DESC, min_score DESC
    """
    cur = conn.execute(sql, (school,))
    rows = [dict(r) for r in cur.fetchall()]
    
    # 按年份分组，统计每年580分以下/附近的专业
    by_year = {}
    for r in rows:
        y = r['year']
        if y not in by_year:
            by_year[y] = []
        by_year[y].append(r)
    
    # 找出580分附近（<=590）的专业
    affordable = []
    for r in rows:
        if r['min_score'] and r['min_score'] <= 590:
            affordable.append(r)
    
    # 学校汇总
    summary_sql = """
    SELECT year, MIN(min_score) as min_score, MAX(min_score) as max_score, AVG(min_score) as avg_score, COUNT(*) as major_count
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
        print(f"  {s['year']}: 最低{s['min_score']} 最高{s['max_score']} 平均{s['avg_score']:.1f} 专业数{s['major_count']}")
    if affordable:
        print(f"  580分附近专业({len(affordable)}个):")
        for a in affordable[:8]:
            print(f"    {a['year']} {a['major_name']}: {a['min_score']}分")
    else:
        print("  ⚠️ 580分附近无专业（全部>590）")

with open("/Users/czt/workspace/webfrontend/gaokao/preach/xiaohongshu_beijing_580/schools_20_data.json", "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

conn.close()
