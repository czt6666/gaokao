"""
桌面数据全量导入脚本
===================
从 /Users/Admin/Desktop/高考程序素材/00、志愿填报必备资料/ 导入所有高价值数据。
运行: cd backend && python3 scrapers/import_desktop_data.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
import sqlite3
import json
import re

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "gaokao.db")
BASE = "/Users/Admin/Desktop/高考程序素材/00、志愿填报必备资料"

def get_conn():
    return sqlite3.connect(DB_PATH)

def safe_float(v, default=0.0):
    try:
        if pd.isna(v): return default
        s = str(v).replace('%', '').replace('％', '').strip()
        return float(s) if s else default
    except: return default

def safe_int(v, default=0):
    try:
        if pd.isna(v): return default
        return int(float(str(v).strip()))
    except: return default

def safe_str(v, default=""):
    if v is None or (isinstance(v, float) and pd.isna(v)): return default
    return str(v).strip()


# ══════════════════════════════════════════════════════════════
# Step 1: 专业满意度 (50,796 rows) → major_satisfaction 新表
# ══════════════════════════════════════════════════════════════
def import_major_satisfaction():
    print("\n═══ Step 1: 专业满意度 (50,796条) ═══")
    path = f"{BASE}/3、专业介绍/其他专业资料（供参考）/专业满意度.xlsx"
    df = pd.read_excel(path)

    conn = get_conn()
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS major_satisfaction (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_name TEXT NOT NULL,
            edu_level TEXT DEFAULT '',
            major_name TEXT NOT NULL,
            overall_score REAL DEFAULT 0,
            overall_votes INTEGER DEFAULT 0,
            employment_score REAL DEFAULT 0,
            employment_votes INTEGER DEFAULT 0,
            teaching_score REAL DEFAULT 0,
            teaching_votes INTEGER DEFAULT 0,
            facility_score REAL DEFAULT 0,
            facility_votes INTEGER DEFAULT 0
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS ix_ms_school ON major_satisfaction(school_name)")
    c.execute("CREATE INDEX IF NOT EXISTS ix_ms_major ON major_satisfaction(major_name)")
    c.execute("DELETE FROM major_satisfaction")

    cols = df.columns.tolist()
    count = 0
    for _, row in df.iterrows():
        c.execute("""
            INSERT INTO major_satisfaction
            (school_name, edu_level, major_name, overall_score, overall_votes,
             employment_score, employment_votes, teaching_score, teaching_votes,
             facility_score, facility_votes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """, (
            safe_str(row.get('院校名称', row.iloc[0] if len(cols) > 0 else '')),
            safe_str(row.get('层次', row.iloc[1] if len(cols) > 1 else '')),
            safe_str(row.get('专业名称', row.iloc[2] if len(cols) > 2 else '')),
            safe_float(row.get('综合满意度', row.iloc[3] if len(cols) > 3 else 0)),
            safe_int(row.get(cols[4], 0) if len(cols) > 4 else 0),
            safe_float(row.get('就业满意度', row.iloc[5] if len(cols) > 5 else 0)),
            safe_int(row.get(cols[6], 0) if len(cols) > 6 else 0),
            safe_float(row.get('教学质量满意度', row.iloc[7] if len(cols) > 7 else 0)),
            safe_int(row.get(cols[8], 0) if len(cols) > 8 else 0),
            safe_float(row.get('办学条件满意度', row.iloc[9] if len(cols) > 9 else 0)),
            safe_int(row.get(cols[10], 0) if len(cols) > 10 else 0),
        ))
        count += 1

    conn.commit()
    conn.close()
    print(f"  ✅ 导入 {count:,} 条专业满意度数据")


# ══════════════════════════════════════════════════════════════
# Step 2: 阳光高考网专业满意度 (39,467 rows) → 合并到 major_satisfaction
# ══════════════════════════════════════════════════════════════
def import_sunshine_satisfaction():
    print("\n═══ Step 2: 阳光高考网专业满意度 (39,467条) ═══")
    path = f"{BASE}/2、院校介绍/\"阳光高考网\"中国高校专业满意度调查结果.xlsx"
    if not os.path.exists(path):
        # Try alternative path without quotes
        path = f"{BASE}/2、院校介绍/\u201c阳光高考网\u201d中国高校专业满意度调查结果.xlsx"

    df = pd.read_excel(path)
    cols = df.columns.tolist()
    print(f"  列名: {cols}")

    conn = get_conn()
    c = conn.cursor()

    # Check for existing records to avoid dupes
    existing = set()
    for row in c.execute("SELECT school_name, major_name FROM major_satisfaction"):
        existing.add((row[0], row[1]))

    count = 0
    skipped = 0
    for _, row in df.iterrows():
        school = safe_str(row.iloc[0])
        major = safe_str(row.iloc[1])
        if (school, major) in existing:
            skipped += 1
            continue

        c.execute("""
            INSERT INTO major_satisfaction
            (school_name, edu_level, major_name, overall_score, overall_votes,
             employment_score, employment_votes, teaching_score, teaching_votes,
             facility_score, facility_votes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """, (
            school, "", major,
            safe_float(row.iloc[2]) if len(cols) > 2 else 0,
            safe_int(row.iloc[3]) if len(cols) > 3 else 0,
            safe_float(row.iloc[5]) if len(cols) > 5 else 0,  # 就业满意度
            safe_int(row.iloc[6]) if len(cols) > 6 else 0,
            safe_float(row.iloc[3]) if len(cols) > 3 else 0,  # 教学
            0,
            safe_float(row.iloc[4]) if len(cols) > 4 else 0,  # 办学条件
            0,
        ))
        existing.add((school, major))
        count += 1

    conn.commit()
    conn.close()
    print(f"  ✅ 新增 {count:,} 条（跳过已存在 {skipped:,} 条）")


# ══════════════════════════════════════════════════════════════
# Step 3: 院校满意度 (2,469 rows) → schools.satisfaction_score 更新
# ══════════════════════════════════════════════════════════════
def import_school_satisfaction():
    print("\n═══ Step 3: 院校满意度 → 更新 schools 表 ═══")
    path = f"{BASE}/2、院校介绍/院校满意度(来源自网络，供参考).xlsx"
    df = pd.read_excel(path)
    print(f"  列名: {df.columns.tolist()}")

    conn = get_conn()
    c = conn.cursor()

    updated = 0
    for _, row in df.iterrows():
        school = safe_str(row.iloc[0])
        score = safe_float(row.iloc[2])  # 综合满意度
        if school and score > 0:
            c.execute("UPDATE schools SET satisfaction_score = ? WHERE name = ?", (score, school))
            if c.rowcount > 0:
                updated += 1

    conn.commit()
    conn.close()
    print(f"  ✅ 更新 {updated} 所学校的满意度评分")


# ══════════════════════════════════════════════════════════════
# Step 4: 专业就业信息分析 (1,318 rows) → 更新 major_employment
# ══════════════════════════════════════════════════════════════
def import_major_employment():
    print("\n═══ Step 4: 专业就业信息 → 更新/补充 major_employment ═══")
    path = f"{BASE}/3、专业介绍/其他专业资料（供参考）/专业就业信息分析.xlsx"
    df = pd.read_excel(path)
    cols = df.columns.tolist()
    print(f"  列名: {cols[:10]}...")

    conn = get_conn()
    c = conn.cursor()

    # Get existing majors
    existing = set()
    for row in c.execute("SELECT major_name FROM major_employment"):
        existing.add(row[0])

    updated = 0
    inserted = 0
    for _, row in df.iterrows():
        # Try to find major name column
        major = safe_str(row.iloc[3]) if len(cols) > 3 else ""
        if not major:
            continue

        avg_salary = safe_float(row.get('平均工资', row.iloc[4] if len(cols) > 4 else 0))
        emp_rank = safe_str(row.get('就业概况-名次', row.iloc[5] if len(cols) > 5 else ''))
        top_region = safe_str(row.get('就业最多地区', ''))
        top_industry = safe_str(row.get('就业最多行业', ''))
        salary_by_exp = safe_str(row.get('工作年限工资', ''))

        if major in existing:
            # Update salary if we have better data
            if avg_salary > 0:
                c.execute("""
                    UPDATE major_employment SET avg_salary = ?, employment_rank = ?
                    WHERE major_name = ? AND (avg_salary IS NULL OR avg_salary = 0)
                """, (avg_salary, emp_rank, major))
                if c.rowcount > 0:
                    updated += 1
        else:
            edu = safe_str(row.iloc[0]) if len(cols) > 0 else ""
            cat1 = safe_str(row.iloc[1]) if len(cols) > 1 else ""
            cat2 = safe_str(row.iloc[2]) if len(cols) > 2 else ""
            c.execute("""
                INSERT INTO major_employment
                (major_name, edu_level, category_1, category_2, avg_salary,
                 employment_rank, top_city, top_industry, salary_by_exp)
                VALUES (?,?,?,?,?,?,?,?,?)
            """, (major, edu, cat1, cat2, avg_salary, emp_rank,
                  top_region, top_industry, salary_by_exp))
            existing.add(major)
            inserted += 1

    conn.commit()
    conn.close()
    print(f"  ✅ 更新 {updated} 条, 新增 {inserted} 条")


# ══════════════════════════════════════════════════════════════
# Step 5: 毕业生薪酬排行榜 TOP200 → school_employment 补充
# ══════════════════════════════════════════════════════════════
def import_salary_ranking():
    print("\n═══ Step 5: 毕业生薪酬排行榜TOP200 ═══")
    path = f"{BASE}/1、大学排名/22-25软科排名/2024中国大学毕业生薪酬水平排行榜TOP200.xlsx"
    df = pd.read_excel(path, header=1)  # Real header is row 1
    cols = df.columns.tolist()
    print(f"  列名: {cols}")

    conn = get_conn()
    c = conn.cursor()

    # Create a salary_ranking table
    c.execute("""
        CREATE TABLE IF NOT EXISTS school_salary_ranking (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_name TEXT UNIQUE NOT NULL,
            salary_rank INTEGER,
            avg_salary_2023 REAL,
            avg_salary_2021 REAL,
            avg_salary_2019 REAL,
            school_type TEXT DEFAULT '',
            location TEXT DEFAULT '',
            is_985 TEXT DEFAULT '',
            is_211 TEXT DEFAULT ''
        )
    """)
    c.execute("DELETE FROM school_salary_ranking")

    count = 0
    for _, row in df.iterrows():
        school = safe_str(row.iloc[1]) if len(cols) > 1 else ""
        if not school or school == 'nan':
            continue
        rank = safe_int(row.iloc[0])
        # Find salary columns - they might have different names
        sal_2023 = safe_float(row.iloc[6]) if len(cols) > 6 else 0
        sal_2021 = safe_float(row.iloc[7]) if len(cols) > 7 else 0
        sal_2019 = safe_float(row.iloc[8]) if len(cols) > 8 else 0

        c.execute("""
            INSERT OR REPLACE INTO school_salary_ranking
            (school_name, salary_rank, avg_salary_2023, avg_salary_2021, avg_salary_2019,
             school_type, location, is_985, is_211)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, (school, rank, sal_2023, sal_2021, sal_2019,
              safe_str(row.iloc[2]), safe_str(row.iloc[3]),
              safe_str(row.iloc[4]), safe_str(row.iloc[5])))
        count += 1

    conn.commit()
    conn.close()
    print(f"  ✅ 导入 {count} 所学校薪酬排名")


# ══════════════════════════════════════════════════════════════
# Step 6: 就业避坑指南 (1,051 rows) → school_employment 补充
# ══════════════════════════════════════════════════════════════
def import_employment_guide():
    print("\n═══ Step 6: 就业避坑指南 → 1,051校就业流向 ═══")
    path = f"{BASE}/2、院校介绍/《就业避坑指南——1000所院校就业流向》.xlsx"
    df = pd.read_excel(path)

    conn = get_conn()
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS school_employment_flow (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_name TEXT UNIQUE NOT NULL,
            province TEXT DEFAULT '',
            city TEXT DEFAULT '',
            region_flow TEXT DEFAULT '',
            employer_type TEXT DEFAULT '',
            top_employers TEXT DEFAULT '',
            employer_details TEXT DEFAULT ''
        )
    """)
    c.execute("DELETE FROM school_employment_flow")

    count = 0
    for _, row in df.iterrows():
        school = safe_str(row.get('院校名称', ''))
        if not school:
            continue
        c.execute("""
            INSERT OR REPLACE INTO school_employment_flow
            (school_name, province, city, region_flow, employer_type, top_employers, employer_details)
            VALUES (?,?,?,?,?,?,?)
        """, (
            school,
            safe_str(row.get('省份', '')),
            safe_str(row.get('城市', '')),
            safe_str(row.get('毕业生签约地区流向', '')),
            safe_str(row.get('毕业生签约单位性质', '')),
            safe_str(row.get('主要签约单位', '')),
            safe_str(row.get('主要签约单位说明', '')),
        ))
        count += 1

    conn.commit()
    conn.close()
    print(f"  ✅ 导入 {count} 所学校就业流向")


# ══════════════════════════════════════════════════════════════
# Step 7: 专业就业分析 (3 sheets: 行业/地区/职业方向)
# ══════════════════════════════════════════════════════════════
def import_major_employment_analysis():
    print("\n═══ Step 7: 专业就业分析 → 行业/地区/职业分布 ═══")
    path = f"{BASE}/3、专业介绍/其他专业资料（供参考）/专业就业分析.xlsx"

    conn = get_conn()
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS major_employment_dist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            major_code TEXT DEFAULT '',
            major_name TEXT NOT NULL,
            dist_type TEXT NOT NULL,
            item_name TEXT NOT NULL,
            item_detail TEXT DEFAULT '',
            percentage REAL DEFAULT 0
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS ix_med_major ON major_employment_dist(major_name)")
    c.execute("CREATE INDEX IF NOT EXISTS ix_med_type ON major_employment_dist(dist_type)")
    c.execute("DELETE FROM major_employment_dist")

    total = 0

    # Sheet 1: 就业行业分布
    try:
        df = pd.read_excel(path, sheet_name="就业行业分布")
        for _, row in df.iterrows():
            c.execute("""
                INSERT INTO major_employment_dist (major_code, major_name, dist_type, item_name, percentage)
                VALUES (?,?,?,?,?)
            """, (safe_str(row.iloc[0]), safe_str(row.iloc[1]), "industry",
                  safe_str(row.iloc[2]), safe_float(row.iloc[3])))
            total += 1
        print(f"  行业分布: {total} 条")
    except Exception as e:
        print(f"  行业分布读取失败: {e}")

    # Sheet 2: 就业地区分布
    cnt2 = 0
    try:
        df = pd.read_excel(path, sheet_name="就业地区分布")
        for _, row in df.iterrows():
            c.execute("""
                INSERT INTO major_employment_dist (major_code, major_name, dist_type, item_name, percentage)
                VALUES (?,?,?,?,?)
            """, (safe_str(row.iloc[0]), safe_str(row.iloc[1]), "region",
                  safe_str(row.iloc[2]), safe_float(row.iloc[3])))
            cnt2 += 1
        print(f"  地区分布: {cnt2} 条")
        total += cnt2
    except Exception as e:
        print(f"  地区分布读取失败: {e}")

    # Sheet 3: 就业职业方向
    cnt3 = 0
    try:
        df = pd.read_excel(path, sheet_name="就业职业方向")
        for _, row in df.iterrows():
            c.execute("""
                INSERT INTO major_employment_dist (major_code, major_name, dist_type, item_name, item_detail, percentage)
                VALUES (?,?,?,?,?,?)
            """, (safe_str(row.iloc[0]), safe_str(row.iloc[1]), "career",
                  safe_str(row.iloc[2]), safe_str(row.iloc[3]), safe_float(row.iloc[4])))
            cnt3 += 1
        print(f"  职业方向: {cnt3} 条")
        total += cnt3
    except Exception as e:
        print(f"  职业方向读取失败: {e}")

    conn.commit()
    conn.close()
    print(f"  ✅ 总计导入 {total:,} 条就业分布数据")


# ══════════════════════════════════════════════════════════════
# Step 8: 3167所大学六合一 → 更新 schools 表元数据
# ══════════════════════════════════════════════════════════════
def import_school_metadata():
    print("\n═══ Step 8: 3167所大学六合一 → 更新学校元数据 ═══")
    path = f"{BASE}/01、一表查询全国本、专科3167个大学（六合一版）.xls"
    df = pd.read_excel(path)

    conn = get_conn()
    c = conn.cursor()

    # Add columns if missing
    for col_sql in [
        "ALTER TABLE schools ADD COLUMN postgrad_recommend_rate TEXT DEFAULT ''",
        "ALTER TABLE schools ADD COLUMN postgrad_rate_24 TEXT DEFAULT ''",
    ]:
        try:
            c.execute(col_sql)
        except:
            pass

    updated = 0
    for _, row in df.iterrows():
        school = safe_str(row.get('院校新名称', ''))
        if not school:
            continue

        postgrad_rate = safe_str(row.get('保研率', ''))
        rate_24 = safe_str(row.get('24推免率', ''))
        flagship = safe_str(row.get('王牌专业', ''))
        emp_quality = safe_str(row.get('就业质量', ''))
        city_level = safe_str(row.get('城市水平标签', ''))
        admin = safe_str(row.get('主管部门', ''))
        founded = safe_str(row.get('建校时间', ''))
        rank_2025 = safe_int(row.get('软科排名', 0))

        updates = []
        params = []

        if postgrad_rate and postgrad_rate != '0':
            updates.append("postgrad_rate = ?")
            params.append(postgrad_rate)
        if rate_24 and rate_24 != 'nan':
            updates.append("postgrad_recommend_rate = ?")
            params.append(rate_24)
        if flagship and flagship != '0' and flagship != 'nan':
            updates.append("flagship_majors = CASE WHEN flagship_majors IS NULL OR flagship_majors = '' THEN ? ELSE flagship_majors END")
            params.append(flagship)
        if emp_quality and emp_quality != 'nan' and 'http' in emp_quality:
            updates.append("employment_quality = CASE WHEN employment_quality IS NULL OR employment_quality = '' THEN ? ELSE employment_quality END")
            params.append(emp_quality)
        if city_level and city_level != 'nan':
            updates.append("city_level = CASE WHEN city_level IS NULL OR city_level = '' THEN ? ELSE city_level END")
            params.append(city_level)
        if admin and admin != 'nan':
            updates.append("admin_dept = CASE WHEN admin_dept IS NULL OR admin_dept = '' THEN ? ELSE admin_dept END")
            params.append(admin)
        if rank_2025 > 0:
            updates.append("rank_2025 = CASE WHEN rank_2025 IS NULL OR rank_2025 = 0 THEN ? ELSE rank_2025 END")
            params.append(rank_2025)

        if updates:
            params.append(school)
            sql = f"UPDATE schools SET {', '.join(updates)} WHERE name = ?"
            c.execute(sql, params)
            if c.rowcount > 0:
                updated += 1

    conn.commit()
    conn.close()
    print(f"  ✅ 更新 {updated} 所学校元数据（保研率/推免率/王牌专业/城市等级）")


# ══════════════════════════════════════════════════════════════
# Step 9: 专业排名信息 (35,503 rows) → 补充 subject_evaluations
# ══════════════════════════════════════════════════════════════
def import_major_rankings():
    print("\n═══ Step 9: 专业排名信息 → 补充 subject_evaluations ═══")
    path = f"{BASE}/3、专业介绍/其他专业资料（供参考）/专业排名信息.xlsx"
    df = pd.read_excel(path)
    cols = df.columns.tolist()
    print(f"  列名: {cols}")

    conn = get_conn()
    c = conn.cursor()

    # Get existing records to avoid duplicates
    existing = set()
    for row in c.execute("SELECT school_name, subject_name FROM subject_evaluations"):
        existing.add((row[0], row[1]))

    count = 0
    skipped = 0
    for _, row in df.iterrows():
        major = safe_str(row.iloc[0])
        rank = safe_int(row.iloc[1])
        school = safe_str(row.iloc[2])
        grade = safe_str(row.iloc[3])

        if not school or not major:
            continue
        if (school, major) in existing:
            skipped += 1
            continue

        c.execute("""
            INSERT INTO subject_evaluations
            (school_name, school_code, subject_code, subject_name, grade, category, major_category)
            VALUES (?,?,?,?,?,?,?)
        """, (school, "", "", major, grade, "", ""))
        existing.add((school, major))
        count += 1

    conn.commit()
    conn.close()
    print(f"  ✅ 新增 {count:,} 条学科评估（跳过已存在 {skipped:,} 条）")


# ══════════════════════════════════════════════════════════════
# Step 10: 省控线补充 (2014-2024)
# ══════════════════════════════════════════════════════════════
def import_control_lines():
    print("\n═══ Step 10: 省控线 22-24 → 补充 province_control_lines ═══")
    path = f"{BASE}/7、全国各省市批次线/22-24年省控线汇总表.xlsx"
    df = pd.read_excel(path)

    conn = get_conn()
    c = conn.cursor()

    existing = set()
    for row in c.execute("SELECT province, year, batch, subject_type FROM province_control_lines"):
        existing.add((row[0], row[1], row[2], row[3]))

    count = 0
    for _, row in df.iterrows():
        prov = safe_str(row.get('省份', ''))
        year = safe_int(row.get('年份', 0))
        batch = safe_str(row.get('批次/段', ''))
        subj = safe_str(row.get('科目', ''))
        score = safe_float(row.get('分数线', 0))

        if not prov or year == 0 or score == 0:
            continue
        if (prov, year, batch, subj) in existing:
            continue

        c.execute("""
            INSERT INTO province_control_lines (province, year, batch, subject_type, score)
            VALUES (?,?,?,?,?)
        """, (prov, year, batch, subj, score))
        existing.add((prov, year, batch, subj))
        count += 1

    # Also import 2014-2023 historical data
    path2 = f"{BASE}/7、全国各省市批次线/2014-2023年各地高考历年分数线(批次线).xlsx"
    if os.path.exists(path2):
        df2 = pd.read_excel(path2)
        for _, row in df2.iterrows():
            prov = safe_str(row.get('地区', row.iloc[0] if len(df2.columns) > 0 else ''))
            year = safe_int(row.get('年份', row.iloc[1] if len(df2.columns) > 1 else 0))
            subj = safe_str(row.get('考生类别', row.iloc[2] if len(df2.columns) > 2 else ''))
            batch = safe_str(row.get('批次', row.iloc[3] if len(df2.columns) > 3 else ''))
            score = safe_float(row.get('分数线', row.iloc[4] if len(df2.columns) > 4 else 0))

            if not prov or year == 0 or score == 0:
                continue
            if (prov, year, batch, subj) in existing:
                continue

            c.execute("""
                INSERT INTO province_control_lines (province, year, batch, subject_type, score)
                VALUES (?,?,?,?,?)
            """, (prov, year, batch, subj, score))
            existing.add((prov, year, batch, subj))
            count += 1

    conn.commit()
    conn.close()
    print(f"  ✅ 补充 {count} 条省控线数据")


# ══════════════════════════════════════════════════════════════
# Step 11: 专业介绍及薪酬表 → 补充 major_employment 的薪资趋势
# ══════════════════════════════════════════════════════════════
def import_salary_trends():
    print("\n═══ Step 11: 专业薪酬趋势 → 补充 major_employment.salary_trend ═══")
    path = f"{BASE}/3、专业介绍/其他专业资料（供参考）/专业介绍及薪酬表.xlsx"
    df = pd.read_excel(path)

    conn = get_conn()
    c = conn.cursor()

    updated = 0
    for _, row in df.iterrows():
        major = safe_str(row.get('专业', ''))
        salary_trend = safe_str(row.get('薪资', ''))
        intro = safe_str(row.get('专业简介', ''))
        training = safe_str(row.get('培养目标', ''))
        career = safe_str(row.get('就业方向', ''))

        if not major:
            continue

        updates = []
        params = []
        if salary_trend and salary_trend != 'nan':
            updates.append("salary_trend = CASE WHEN salary_trend IS NULL OR salary_trend = '' THEN ? ELSE salary_trend END")
            params.append(salary_trend)
        if intro and intro != 'nan':
            updates.append("intro = CASE WHEN intro IS NULL OR intro = '' THEN ? ELSE intro END")
            params.append(intro)
        if training and training != 'nan':
            updates.append("training_goal = CASE WHEN training_goal IS NULL OR training_goal = '' THEN ? ELSE training_goal END")
            params.append(training)
        if career and career != 'nan':
            updates.append("career_direction = CASE WHEN career_direction IS NULL OR career_direction = '' THEN ? ELSE career_direction END")
            params.append(career)

        if updates:
            params.append(major)
            sql = f"UPDATE major_employment SET {', '.join(updates)} WHERE major_name = ?"
            c.execute(sql, params)
            if c.rowcount > 0:
                updated += 1

    conn.commit()
    conn.close()
    print(f"  ✅ 更新 {updated} 个专业的薪酬趋势/简介/培养目标")


# ══════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("🚀 开始导入桌面数据...")
    print(f"数据库: {DB_PATH}")
    print(f"数据源: {BASE}")

    import_major_satisfaction()     # Step 1: 50K 专业满意度
    import_sunshine_satisfaction()  # Step 2: 39K 阳光高考满意度
    import_school_satisfaction()    # Step 3: 2.5K 院校满意度
    import_major_employment()       # Step 4: 1.3K 专业就业
    import_salary_ranking()         # Step 5: 200 薪酬排行
    import_employment_guide()       # Step 6: 1K 就业避坑
    import_major_employment_analysis()  # Step 7: 25K 就业分布
    import_school_metadata()        # Step 8: 3K 学校元数据
    import_major_rankings()         # Step 9: 35K 学科评估
    import_control_lines()          # Step 10: 省控线
    import_salary_trends()          # Step 11: 薪酬趋势

    # Final stats
    conn = get_conn()
    c = conn.cursor()
    print("\n" + "=" * 60)
    print("📊 导入后数据库统计:")
    for table in ['major_satisfaction', 'school_salary_ranking', 'school_employment_flow',
                   'major_employment_dist', 'subject_evaluations', 'major_employment',
                   'province_control_lines', 'schools']:
        cnt = c.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table}: {cnt:,} 条")
    conn.close()

    print("\n🎉 全部导入完成！")
