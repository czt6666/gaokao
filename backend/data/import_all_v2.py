"""
全量数据导入脚本 v2
运行方式：cd backend && python3 data/import_all_v2.py

导入顺序（依赖关系）：
1. 软科2025排名  → schools.rank_2025
2. 院校基础信息  → schools (补充77列字段)
3. 院校王牌专业  → schools.flagship_majors
4. 北京历史专业分数线(2017-2021) → admission_records
5. 北京历史投档线(2018-2023)     → admission_records
6. 省控线汇总    → province_control_lines
7. 专业介绍及薪酬表 → major_employment (intro/salary_trend/...)
8. 专业满意度    → major_employment.satisfaction
9. 就业行业分布  → major_employment.industry_dist
10. 就业地区分布 → major_employment.city_dist
11. 院校专业简介 → national_programs
12. 就业避坑指南 → schools.employment_quality
"""

import sys, os, glob, json, re
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
import xlrd
from sqlalchemy.orm import Session
from database import (
    SessionLocal, init_db, School, AdmissionRecord,
    MajorEmployment, NationalProgram, ProvinceControlLine
)

BASE = "/Users/Admin/Desktop/高考程序素材"


def find(pattern: str) -> str:
    """在素材目录递归查找文件"""
    matches = glob.glob(os.path.join(BASE, "**", pattern), recursive=True)
    if not matches:
        raise FileNotFoundError(f"未找到: {pattern}")
    return matches[0]


def safe_int(val, default=0) -> int:
    try:
        v = str(val).strip().rstrip(".0")
        return int(v) if v else default
    except Exception:
        return default


def safe_float(val, default=0.0) -> float:
    try:
        return float(val)
    except Exception:
        return default


def safe_str(val, default="") -> str:
    if val is None or (isinstance(val, float) and val != val):
        return default
    return str(val).strip()


# ─────────────────────────────────────────────────────────────
# 1. 软科2025排名 → schools.rank_2025
# ─────────────────────────────────────────────────────────────
def import_ranking_2025(db: Session):
    print("\n[1/12] 导入软科2025排名...")
    path = find("2025年软科中国大学排名数据.xlsx")
    df = pd.read_excel(path)
    updated = 0
    for _, row in df.iterrows():
        name = safe_str(row.get("高校名称", ""))
        rank = safe_int(row.get("排名", 0))
        if not name or rank == 0:
            continue
        school = db.query(School).filter(School.name == name).first()
        if school:
            school.rank_2025 = rank
            updated += 1
    db.commit()
    print(f"   ✅ 软科2025排名更新 {updated} 所学校")


# ─────────────────────────────────────────────────────────────
# 2. 院校基础信息（大XLS文件，77列）
# ─────────────────────────────────────────────────────────────
def import_school_base_info(db: Session):
    print("\n[2/12] 导入院校基础信息（77列大文件）...")
    path = find("01、一表查询全国本、专科3167个大学（六合一版）.xls")
    wb = xlrd.open_workbook(path)
    sh = wb.sheet_by_name("院校基础信息")

    headers = [str(c).strip() for c in sh.row_values(0)]
    updated = 0

    for i in range(2, sh.nrows):  # 第0行=列名, 第1行=序号说明, 第2行起=数据
        row = sh.row_values(i)
        data = dict(zip(headers, row))

        name = safe_str(data.get("院校新名称") or data.get("院校原名称", ""))
        if not name:
            continue

        school = db.query(School).filter(School.name == name).first()
        if not school:
            continue

        website_val = safe_str(data.get("学校官网", ""))
        admission_val = safe_str(data.get("招生网址", ""))
        intro_val = safe_str(data.get("院校简介", ""))
        tags_val = safe_str(data.get("院校标签", ""))
        city_level_val = safe_str(data.get("城市水平标签", ""))
        admin_val = safe_str(data.get("主管部门", ""))
        founded_raw = data.get("创建时间", 0) or data.get("建校时间", 0)
        rank_raw = data.get("软科排名", 0)

        if website_val:
            school.website = website_val
        if admission_val:
            school.admission_website = admission_val
        if intro_val and len(intro_val) > len(school.intro or ""):
            school.intro = intro_val[:2000]
        if tags_val:
            school.tags = tags_val
        if city_level_val:
            school.city_level = city_level_val
        if admin_val:
            school.admin_dept = admin_val
        if founded_raw:
            school.founded_year = safe_int(founded_raw)
        rank_int = safe_int(rank_raw)
        if rank_int > 0 and school.rank_2025 == 0:
            school.rank_2025 = rank_int

        updated += 1

    db.commit()
    print(f"   ✅ 院校基础信息更新 {updated} 所学校")


# ─────────────────────────────────────────────────────────────
# 3. 院校王牌专业
# ─────────────────────────────────────────────────────────────
def import_flagship_majors(db: Session):
    print("\n[3/12] 导入院校王牌专业...")
    path = find("01、一表查询全国本、专科3167个大学（六合一版）.xls")
    wb = xlrd.open_workbook(path)
    sh = wb.sheet_by_name("院校王牌专业")
    headers = [str(c).strip() for c in sh.row_values(0)]
    updated = 0

    for i in range(1, sh.nrows):
        row = sh.row_values(i)
        data = dict(zip(headers, row))
        name = safe_str(data.get("院校名称", ""))
        flagships = safe_str(data.get("王牌专业（重点专业）", ""))
        if not name or not flagships:
            continue
        school = db.query(School).filter(School.name == name).first()
        if school and flagships:
            school.flagship_majors = flagships[:500]
            updated += 1

    db.commit()
    print(f"   ✅ 王牌专业更新 {updated} 所学校")


# ─────────────────────────────────────────────────────────────
# 4. 北京历史专业分数线（2017-2021，5年）
# ─────────────────────────────────────────────────────────────
def import_beijing_history_scores(db: Session):
    print("\n[4/12] 导入北京历史专业分数线（2017-2021）...")
    patterns = [
        "北京_专业分数线_2017.xlsx",
        "北京_专业分数线_2018.xlsx",
        "北京_专业分数线_2019.xlsx",
        "北京_专业分数线_2020.xlsx",
        "北京_专业分数线_2021.xlsx",
    ]
    total_inserted = 0

    for pat in patterns:
        try:
            path = find(pat)
        except FileNotFoundError:
            print(f"   ⚠️ 未找到 {pat}，跳过")
            continue

        df = pd.read_excel(path)
        inserted = 0

        for _, row in df.iterrows():
            year = safe_int(row.get("年份", 0))
            school_name = safe_str(row.get("学校", ""))
            major_name = safe_str(row.get("专业", ""))
            min_score = safe_int(row.get("最低分", 0))
            min_rank = safe_int(row.get("最低分排名", 0))
            batch = safe_str(row.get("批次", ""))
            subject_req = safe_str(row.get("科类", ""))
            school_code = safe_str(row.get("全国统一招生代码", ""))
            is_985 = "是" if safe_str(row.get("_985", "")) == "是" else "否"
            is_211 = "是" if safe_str(row.get("_211", "")) == "是" else "否"

            if not school_name or min_score < 100 or min_rank == 0:
                continue

            # 检查是否已有该记录
            exists = db.query(AdmissionRecord).filter(
                AdmissionRecord.school_name == school_name,
                AdmissionRecord.major_name == major_name,
                AdmissionRecord.year == year,
                AdmissionRecord.province == "北京"
            ).first()
            if exists:
                continue

            rec = AdmissionRecord(
                school_code=school_code,
                school_name=school_name,
                major_name=major_name,
                major_group="",
                province="北京",
                year=year,
                batch=batch,
                subject_req=subject_req,
                min_score=min_score,
                min_rank=min_rank,
                admit_count=0,
                school_province="",
                school_nature=safe_str(row.get("办学性质", "")),
                is_985=is_985,
                is_211=is_211,
            )
            db.add(rec)
            inserted += 1

        db.commit()
        print(f"   ✅ {pat}: 新增 {inserted} 条")
        total_inserted += inserted

    print(f"   → 北京历史专业分数线共新增 {total_inserted} 条")


# ─────────────────────────────────────────────────────────────
# 5. 北京历史投档线（2017-2023，格式=专业组级别）
# ─────────────────────────────────────────────────────────────
def import_beijing_history_toudang(db: Session):
    print("\n[5/12] 导入北京历史投档线（2017-2023）...")
    patterns = [
        "北京_投档线_2017.xlsx",
        "北京_投档线_2018.xlsx",
        "北京_投档线_2019.xlsx",
        "北京_投档线_2020.xlsx",
        "北京_投档线_2021.xlsx",
    ]
    total_inserted = 0

    for pat in patterns:
        try:
            path = find(pat)
        except FileNotFoundError:
            print(f"   ⚠️ 未找到 {pat}，跳过")
            continue

        df = pd.read_excel(path)
        inserted = 0

        for _, row in df.iterrows():
            year = safe_int(row.get("年份", 0))
            school_name = safe_str(row.get("学校", ""))
            min_score = safe_int(row.get("最低分", 0))
            min_rank = safe_int(row.get("最低分排名", 0))
            batch = safe_str(row.get("批次", ""))
            subject_req = safe_str(row.get("科类", ""))
            major_group = safe_str(row.get("专业组", ""))
            school_code = safe_str(row.get("全国统一招生代码", ""))
            is_985 = "是" if safe_str(row.get("_985", "")) == "是" else "否"
            is_211 = "是" if safe_str(row.get("_211", "")) == "是" else "否"

            if not school_name or min_score < 100:
                continue

            major_name = f"[投档线]{major_group or batch}"

            exists = db.query(AdmissionRecord).filter(
                AdmissionRecord.school_name == school_name,
                AdmissionRecord.major_name == major_name,
                AdmissionRecord.year == year,
                AdmissionRecord.province == "北京"
            ).first()
            if exists:
                continue

            rec = AdmissionRecord(
                school_code=school_code,
                school_name=school_name,
                major_name=major_name,
                major_group=major_group,
                province="北京",
                year=year,
                batch=batch,
                subject_req=subject_req,
                min_score=min_score,
                min_rank=min_rank,
                admit_count=0,
                school_province="",
                school_nature=safe_str(row.get("办学性质", "")),
                is_985=is_985,
                is_211=is_211,
            )
            db.add(rec)
            inserted += 1

        db.commit()
        print(f"   ✅ {pat}: 新增 {inserted} 条")
        total_inserted += inserted

    print(f"   → 北京历史投档线共新增 {total_inserted} 条")


# ─────────────────────────────────────────────────────────────
# 6. 全国省控线（22-24年）
# ─────────────────────────────────────────────────────────────
def import_province_control_lines(db: Session):
    print("\n[6/12] 导入全国省控线...")
    path = find("22-24年省控线汇总表.xlsx")
    df = pd.read_excel(path)
    inserted = 0

    for _, row in df.iterrows():
        province = safe_str(row.get("省份", ""))
        year = safe_int(row.get("年份", 0))
        batch = safe_str(row.get("批次/段", ""))
        subject = safe_str(row.get("科目", ""))
        score = safe_int(row.get("分数线", 0))

        if not province or year == 0:
            continue

        exists = db.query(ProvinceControlLine).filter(
            ProvinceControlLine.province == province,
            ProvinceControlLine.year == year,
            ProvinceControlLine.batch == batch,
            ProvinceControlLine.subject_type == subject,
        ).first()
        if exists:
            continue

        db.add(ProvinceControlLine(
            province=province, year=year,
            batch=batch, subject_type=subject, score=score,
        ))
        inserted += 1

    db.commit()
    print(f"   ✅ 省控线新增 {inserted} 条")


# ─────────────────────────────────────────────────────────────
# 7. 专业介绍及薪酬表（1727行，28列）
# ─────────────────────────────────────────────────────────────
def import_salary_and_intro(db: Session):
    print("\n[7/12] 导入专业薪酬表（含简介/趋势/就业方向）...")
    path = find("专业介绍及薪酬表.xlsx")
    df = pd.read_excel(path)
    updated = 0

    for _, row in df.iterrows():
        major_name = safe_str(row.get("专业", ""))
        if not major_name:
            continue

        emp = db.query(MajorEmployment).filter(
            MajorEmployment.major_name == major_name
        ).first()

        salary_raw = safe_str(row.get("薪资", ""))
        # 解析薪资趋势 {年份,金额} 格式
        salary_trend = ""
        if salary_raw and "{" in salary_raw:
            try:
                pairs = re.findall(r"\{(\d+),(\d+)\}", salary_raw)
                salary_dict = {int(y): int(s) for y, s in pairs}
                salary_trend = json.dumps(salary_dict, ensure_ascii=False)
                # 取最近年份薪资作为 avg_salary
                if salary_dict:
                    latest_salary = salary_dict[max(salary_dict.keys())]
                else:
                    latest_salary = 0
            except Exception:
                latest_salary = 0
                salary_trend = ""
        else:
            latest_salary = 0

        intro = safe_str(row.get("专业简介", ""))[:1000]
        training_goal = safe_str(row.get("培养目标", ""))[:500]
        career_dir = safe_str(row.get("就业方向", ""))[:500]
        gender_m = safe_str(row.get("男生比例", ""))
        gender_f = safe_str(row.get("女生比例", ""))
        city_dist = safe_str(row.get("就业地区分布", ""))[:500]
        industry_dist = safe_str(row.get("行业分布", ""))[:500]
        major_code = safe_str(row.get("国标代码", ""))

        if emp:
            if salary_trend:
                emp.salary_trend = salary_trend
            if latest_salary > emp.avg_salary:
                emp.avg_salary = latest_salary
            if intro:
                emp.intro = intro
            if training_goal:
                emp.training_goal = training_goal
            if career_dir:
                emp.career_direction = career_dir
            if gender_m:
                emp.gender_male = gender_m
            if gender_f:
                emp.gender_female = gender_f
            if city_dist:
                emp.city_dist = city_dist
            if industry_dist:
                emp.industry_dist = industry_dist
            if major_code:
                emp.major_code = major_code
        else:
            # 新建记录
            db.add(MajorEmployment(
                major_name=major_name,
                edu_level=safe_str(row.get("学历层次", "本科")),
                category_1=safe_str(row.get("学科门类", "")),
                category_2=safe_str(row.get("一级学科", "")),
                avg_salary=latest_salary,
                salary_trend=salary_trend,
                intro=intro,
                training_goal=training_goal,
                career_direction=career_dir,
                gender_male=gender_m,
                gender_female=gender_f,
                city_dist=city_dist,
                industry_dist=industry_dist,
                major_code=major_code,
            ))

        updated += 1

    db.commit()
    print(f"   ✅ 专业薪酬表处理 {updated} 条")


# ─────────────────────────────────────────────────────────────
# 8. 专业满意度（50796行）
# ─────────────────────────────────────────────────────────────
def import_satisfaction(db: Session):
    print("\n[8/12] 导入专业满意度数据...")
    path = find("专业满意度.xlsx")
    df = pd.read_excel(path)

    # 按专业名聚合满意度均值
    agg = df.groupby("专业名称").agg(
        satisfaction=("综合满意度", "mean"),
        votes=("综合满意度投票人数", "sum")
    ).reset_index()

    updated = 0
    for _, row in agg.iterrows():
        major_name = safe_str(row.get("专业名称", ""))
        sat = safe_float(row.get("satisfaction", 0.0))
        if not major_name or sat == 0:
            continue

        emp = db.query(MajorEmployment).filter(
            MajorEmployment.major_name == major_name
        ).first()
        if emp:
            emp.satisfaction = round(sat, 2)
            updated += 1

    db.commit()
    print(f"   ✅ 满意度更新 {updated} 个专业")


# ─────────────────────────────────────────────────────────────
# 9. 专业就业行业分布
# ─────────────────────────────────────────────────────────────
def import_industry_dist(db: Session):
    print("\n[9/12] 导入就业行业分布...")
    path = find("专业就业行业分布分析.xlsx")
    df = pd.read_excel(path)

    # 按专业取前3行业
    top3 = (
        df.sort_values("占比", ascending=False)
          .groupby("专业名称")
          .head(3)
          .groupby("专业名称")["行业"]
          .apply(lambda x: "、".join(x))
          .reset_index()
    )

    updated = 0
    for _, row in top3.iterrows():
        name = safe_str(row.get("专业名称", ""))
        industries = safe_str(row.get("行业", ""))
        if not name:
            continue
        emp = db.query(MajorEmployment).filter(
            MajorEmployment.major_name == name
        ).first()
        if emp:
            emp.top_industry = industries
            updated += 1

    db.commit()
    print(f"   ✅ 就业行业更新 {updated} 个专业")


# ─────────────────────────────────────────────────────────────
# 10. 专业就业地区分布
# ─────────────────────────────────────────────────────────────
def import_city_dist(db: Session):
    print("\n[10/12] 导入就业地区分布...")
    path = find("专业就业地区分布分析.xlsx")
    df = pd.read_excel(path)

    # 列名修正
    major_col = "专业名称" if "专业名称" in df.columns else "专业类"
    top3 = (
        df.sort_values("占比", ascending=False)
          .groupby(major_col)
          .head(3)
          .groupby(major_col)["地区"]
          .apply(lambda x: "、".join(x))
          .reset_index()
    )

    updated = 0
    for _, row in top3.iterrows():
        name = safe_str(row.get(major_col, ""))
        cities = safe_str(row.get("地区", ""))
        if not name:
            continue
        emp = db.query(MajorEmployment).filter(
            MajorEmployment.major_name == name
        ).first()
        if emp:
            emp.top_city = cities
            updated += 1

    db.commit()
    print(f"   ✅ 就业地区更新 {updated} 个专业")


# ─────────────────────────────────────────────────────────────
# 11. 院校专业简介（53,672行）→ national_programs
# ─────────────────────────────────────────────────────────────
def import_national_programs(db: Session):
    print("\n[11/12] 导入全国院校开设专业目录（53,672行）...")
    path = find("01、一表查询全国本、专科3167个大学（六合一版）.xls")
    wb = xlrd.open_workbook(path)
    sh = wb.sheet_by_name("院校专业简介")
    headers = [str(c).strip() for c in sh.row_values(0)]

    batch_size = 500
    inserted = 0
    batch = []

    for i in range(1, sh.nrows):
        row = sh.row_values(i)
        data = dict(zip(headers, row))

        school_name = safe_str(data.get("院校名称", ""))
        major_name = safe_str(data.get("专业名称（*代表国家特色专业）", "") or data.get("专业名称", ""))
        province = safe_str(data.get("省份", ""))
        city = safe_str(data.get("城市", ""))
        category = safe_str(data.get("类别", ""))

        if not school_name or not major_name:
            continue

        major_name = major_name.lstrip("*").strip()

        batch.append(NationalProgram(
            school_name=school_name,
            province=province,
            city=city,
            major_name=major_name,
            major_category=category,
        ))
        inserted += 1

        if len(batch) >= batch_size:
            db.bulk_save_objects(batch)
            db.commit()
            batch = []
            print(f"   ... 已写入 {inserted} 条", end="\r")

    if batch:
        db.bulk_save_objects(batch)
        db.commit()

    print(f"   ✅ 全国专业目录新增 {inserted} 条")


# ─────────────────────────────────────────────────────────────
# 12. 就业避坑指南（1051行）→ schools.employment_quality
# ─────────────────────────────────────────────────────────────
def import_employment_quality(db: Session):
    print("\n[12/12] 导入院校就业流向...")
    path = find("《就业避坑指南——1000所院校就业流向》.xlsx")
    df = pd.read_excel(path)
    updated = 0

    for _, row in df.iterrows():
        school_name = safe_str(row.get("院校名称", ""))
        if not school_name:
            continue

        flow = safe_str(row.get("毕业生签约地区流向", ""))
        units = safe_str(row.get("毕业生签约单位性质", ""))
        top_units = safe_str(row.get("主要签约单位", ""))

        summary = ""
        if flow:
            summary += f"地区流向：{flow[:80]} "
        if units:
            summary += f"| 单位性质：{units[:80]}"

        school = db.query(School).filter(School.name == school_name).first()
        if school:
            school.employment_quality = summary[:400]
            updated += 1

    db.commit()
    print(f"   ✅ 就业流向更新 {updated} 所学校")


# ─────────────────────────────────────────────────────────────
# 主流程
# ─────────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("全量数据导入 v2 启动")
    print("=" * 60)

    # 先确保新表存在
    init_db()

    db = SessionLocal()
    try:
        import_ranking_2025(db)
        import_school_base_info(db)
        import_flagship_majors(db)
        import_beijing_history_scores(db)
        import_beijing_history_toudang(db)
        import_province_control_lines(db)
        import_salary_and_intro(db)
        import_satisfaction(db)
        import_industry_dist(db)
        import_city_dist(db)
        import_national_programs(db)
        import_employment_quality(db)
    finally:
        db.close()

    print("\n" + "=" * 60)
    print("✅ 全量导入完成！")
    print("=" * 60)


if __name__ == "__main__":
    main()
