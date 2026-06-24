"""
API 脚本：查询某学校近几年在北京各专业的录取分数
数据来源：gaokao-0523.db (备份数据库)
"""
import sqlite3
import json
from pathlib import Path

DB_PATH = "/Users/czt/workspace/webfrontend/gaokao/backend/db-backup/gaokao-0523.db"
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

def get_school_admission(school_name, province="北京", batch="本科批", years=(2022, 2023, 2024, 2025)):
    """
    查询指定学校近几年各专业在北京的录取分数
    返回按年份和专业分排序的数据
    """
    placeholders = ",".join("?" for _ in years)
    sql = f"""
    SELECT 
        school_name,
        major_name,
        major_group,
        year,
        min_score,
        min_rank,
        admit_count,
        subject_req,
        subject_must,
        subject_any_of
    FROM admission_records
    WHERE province = ? AND batch = ? 
      AND school_name = ? AND year IN ({placeholders})
    ORDER BY year DESC, min_score DESC
    """
    cur = conn.execute(sql, (province, batch, school_name, *years))
    return [dict(r) for r in cur.fetchall()]

def get_school_summary(school_name, province="北京", batch="本科批", years=(2022, 2023, 2024, 2025)):
    """
    返回该学校各年的最低分、最高分、平均分、招生人数汇总
    """
    placeholders = ",".join("?" for _ in years)
    sql = f"""
    SELECT 
        year,
        MIN(min_score) as min_score,
        MAX(min_score) as max_score,
        AVG(min_score) as avg_score,
        SUM(admit_count) as total_admit,
        COUNT(*) as major_count
    FROM admission_records
    WHERE province = ? AND batch = ? 
      AND school_name = ? AND year IN ({placeholders})
    GROUP BY year
    ORDER BY year DESC
    """
    cur = conn.execute(sql, (province, batch, school_name, *years))
    return [dict(r) for r in cur.fetchall()]

def get_all_schools_in_range(min_score=570, max_score=590, province="北京", batch="本科批", year=2024):
    """
    查询某一年录取最低分在范围内的学校列表
    """
    sql = """
    SELECT 
        a.school_name,
        MIN(a.min_score) as min_score,
        COUNT(*) as major_count,
        s.province as school_province,
        s.city,
        s.is_985,
        s.is_211,
        s.is_shuangyiliu
    FROM admission_records a
    LEFT JOIN schools s ON a.school_name = s.name
    WHERE a.province = ? AND a.batch = ? AND a.year = ?
    GROUP BY a.school_name
    HAVING min_score BETWEEN ? AND ?
    ORDER BY min_score DESC
    """
    cur = conn.execute(sql, (province, batch, year, min_score, max_score))
    return [dict(r) for r in cur.fetchall()]

if __name__ == "__main__":
    # 测试：查询北京工业大学
    school = "北京工业大学"
    print(f"=== {school} 各专业录取分 ===")
    data = get_school_admission(school)
    for d in data[:10]:
        print(f"{d['year']} | {d['major_name']} | {d['min_score']}分 | 位次{d['min_rank']} | 招{d['admit_count']}人")
    
    print(f"\n=== {school} 年度汇总 ===")
    summary = get_school_summary(school)
    for s in summary:
        print(f"{s['year']} | 最低{s['min_score']} | 最高{s['max_score']} | 平均{s['avg_score']:.1f} | 招{s['total_admit']}人 | {s['major_count']}个专业")

conn.close()
