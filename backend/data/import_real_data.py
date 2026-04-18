"""
真实数据导入脚本
从「高考程序素材」文件夹读取并导入到SQLite数据库

导入顺序：
1. 院校基础信息（含保研率）→ schools 表
2. 学科评估结果 → subject_evaluations 表
3. 北京专业录取分数(22-25) → admission_records 表  ← 最核心
4. 北京招生计划(22-25) → majors 表
5. 一分一段表(22-25) → rank_tables 表
6. 专业就业信息 → major_employment 表
"""

import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
from database import (
    School, SubjectEvaluation, Major, AdmissionRecord,
    RankTable, MajorEmployment, SessionLocal, init_db
)

# 数据文件根目录
DATA_ROOT = "/Users/Admin/Desktop/高考程序素材"

def log(msg): print(f"  → {msg}")


# ──────────────────────────────────────────────────────────────
# 1. 院校基础信息
# ──────────────────────────────────────────────────────────────
def import_schools(db):
    print("\n[1/6] 导入院校基础信息...")
    path = f"{DATA_ROOT}/00、志愿填报必备资料/2、院校介绍/02-全国院校基础信息-带保研率.xlsx"
    df = pd.read_excel(path, header=1)  # 第2行是真正的列头
    df.columns = [str(c).strip() for c in df.columns]

    # 找到有效的列
    col_map = {}
    for col in df.columns:
        c = col.strip()
        if "学校名称" in c or c == "学校名称": col_map["name"] = col
        elif "新院校名称" in c: col_map["new_name"] = col
        elif "所在省" in c: col_map["province"] = col
        elif "城市" in c: col_map["city"] = col
        elif "类型" in c and "院校" not in c: col_map["school_type"] = col
        elif "985" in c: col_map["is_985"] = col
        elif "211" in c: col_map["is_211"] = col
        elif "双一流" in c: col_map["shuangyiliu"] = col
        elif "公私" in c or "公办" in c: col_map["nature"] = col
        elif "保研率" in c: col_map["postgrad_rate"] = col
        elif "男生比例" in c: col_map["male_ratio"] = col
        elif "女生比例" in c: col_map["female_ratio"] = col
        elif "官网" in c: col_map["website"] = col
        elif "大学简介" in c: col_map["intro"] = col
        elif "本科" in c and "专科" in c: col_map["level"] = col

    count = 0
    seen_names = set()
    for _, row in df.iterrows():
        name = str(row.get(col_map.get("name", ""), "")).strip()
        if not name or name == "nan" or name == "学校名称":
            continue

        # 层次判断
        is_985 = str(row.get(col_map.get("is_985", ""), "否")).strip()
        is_211 = str(row.get(col_map.get("is_211", ""), "否")).strip()
        syl = str(row.get(col_map.get("shuangyiliu", ""), "")).strip()

        # 兼容 985.0 / 211.0（pandas float列）
        is_985_clean = is_985.rstrip("0").rstrip(".") if "." in is_985 else is_985
        is_211_clean = is_211.rstrip("0").rstrip(".") if "." in is_211 else is_211
        if is_985_clean in ["985", "是", "1", "True"]:
            tier = "985"
        elif is_211_clean in ["211", "是", "1", "True"]:
            tier = "211"
        elif "双一流" in syl or "一流" in syl:
            tier = "双一流"
        else:
            tier = "普通"

        # 城市清理
        city = str(row.get(col_map.get("city", ""), "")).strip()
        city = city.replace("市", "").replace("区", "") if city != "nan" else ""

        # 简介截断（避免过长）
        intro = str(row.get(col_map.get("intro", ""), ""))
        intro = intro[:500] if intro != "nan" else ""

        # 跳过重名（同名学校取第一条）
        if name in seen_names:
            continue
        seen_names.add(name)

        school = School(
            name=name,
            province=str(row.get(col_map.get("province", ""), "")).strip(),
            city=city,
            tier=tier,
            school_type=str(row.get(col_map.get("school_type", ""), "")).strip(),
            is_985="是" if is_985_clean in ["985", "是", "1"] else "否",
            is_211="是" if is_211_clean in ["211", "是", "1"] else "否",
            is_shuangyiliu="是" if tier in ["985", "211", "双一流"] else "否",
            nature=str(row.get(col_map.get("nature", ""), "公办")).strip(),
            postgrad_rate=str(row.get(col_map.get("postgrad_rate", ""), "")).strip(),
            male_ratio=str(row.get(col_map.get("male_ratio", ""), "")).strip(),
            female_ratio=str(row.get(col_map.get("female_ratio", ""), "")).strip(),
            website=str(row.get(col_map.get("website", ""), "")).strip(),
            intro=intro
        )
        db.add(school)
        count += 1
        if count % 500 == 0:
            db.flush()
            log(f"已处理 {count} 所院校...")

    db.commit()
    log(f"✅ 院校基础信息导入完成：{count} 所")


# ──────────────────────────────────────────────────────────────
# 2. 学科评估
# ──────────────────────────────────────────────────────────────
def import_subject_evaluations(db):
    print("\n[2/6] 导入学科评估数据...")
    path = f"{DATA_ROOT}/00、志愿填报必备资料/3、专业介绍/绝密报考-第四轮全国高校学科评估结果Excel表格.xlsx"
    df = pd.read_excel(path, header=1)

    count = 0
    for _, row in df.iterrows():
        subject_raw = str(row.get("一级学科", "")).strip()
        grade = str(row.get("等级", "")).strip()
        school_raw = str(row.get("院校代码及名称", "")).strip()
        category = str(row.get("门类", "")).strip()
        major_cat = str(row.get("专业大类", "")).strip()

        if not subject_raw or subject_raw == "nan" or not grade or grade == "nan":
            continue
        if not school_raw or school_raw == "nan":
            continue

        # 解析学科代码和名称：如 "0101哲学"
        subject_code = ""
        subject_name = subject_raw
        m = re.match(r"^(\d+)\s*(.+)$", subject_raw)
        if m:
            subject_code = m.group(1)
            subject_name = m.group(2).strip()

        # 解析院校：可能有多所（换行分隔）
        schools_raw = school_raw.replace("_x000D_", "").replace("\n", "\n").split("\n")
        for sch in schools_raw:
            sch = sch.strip()
            if not sch:
                continue
            # 解析院校代码和名称：如 "10001北京大学"
            sch_code = ""
            sch_name = sch
            m2 = re.match(r"^(\d+)\s*(.+)$", sch)
            if m2:
                sch_code = m2.group(1)
                sch_name = m2.group(2).strip()

            ev = SubjectEvaluation(
                school_name=sch_name,
                school_code=sch_code,
                subject_code=subject_code,
                subject_name=subject_name,
                grade=grade,
                category=category,
                major_category=major_cat
            )
            db.add(ev)
            count += 1

        if count % 1000 == 0:
            db.flush()

    db.commit()
    log(f"✅ 学科评估导入完成：{count} 条")


# ──────────────────────────────────────────────────────────────
# 3. 北京专业录取数据（核心）
# ──────────────────────────────────────────────────────────────
def import_admission_records(db):
    print("\n[3/6] 导入北京专业录取数据（22-25年）...")
    path = f"{DATA_ROOT}/18、北京-2026志愿填报资料【永久更新】/2、北京高考录取数据22-25【持续更新】/22-25年全国高校在北京的专业录取分数.xlsx"
    df = pd.read_excel(path)

    count = 0
    skip = 0
    for _, row in df.iterrows():
        year = row.get("年份", 0)
        school_name = str(row.get("院校名称", "")).strip()
        school_code = str(row.get("院校代码", "")).strip()
        major_name = str(row.get("专业", "")).strip()
        subject_req = str(row.get("选科要求", "")).strip()
        major_group = str(row.get("所属专业组", "")).strip()
        batch = str(row.get("批次", "")).strip()
        min_score = row.get("最低分数", 0)
        min_rank = row.get("最低位次", 0)
        admit_count = row.get("录取人数", 0)
        school_province = str(row.get("学校所在", "")).strip()
        school_nature = str(row.get("学校性质", "")).strip()
        is_985 = str(row.get("是否985", "否")).strip()
        is_211 = str(row.get("是否211", "否")).strip()

        # 数据清洗
        if not school_name or school_name == "nan":
            skip += 1; continue
        if not major_name or major_name == "nan":
            skip += 1; continue
        try:
            min_score = int(float(min_score)) if str(min_score) not in ["nan", ""] else 0
            min_rank = int(float(min_rank)) if str(min_rank) not in ["nan", ""] else 0
            admit_count = int(float(admit_count)) if str(admit_count) not in ["nan", ""] else 0
        except:
            min_score, min_rank, admit_count = 0, 0, 0

        if min_rank <= 0:
            skip += 1; continue

        rec = AdmissionRecord(
            school_code=school_code,
            school_name=school_name,
            major_name=major_name,
            major_group=major_group if major_group != "nan" else "",
            province="北京",
            year=int(year) if str(year) != "nan" else 0,
            batch=batch if batch != "nan" else "",
            subject_req=subject_req if subject_req != "nan" else "",
            min_score=min_score,
            min_rank=min_rank,
            admit_count=admit_count,
            school_province=school_province if school_province != "nan" else "",
            school_nature=school_nature if school_nature != "nan" else "",
            is_985=is_985 if is_985 != "nan" else "否",
            is_211=is_211 if is_211 != "nan" else "否",
        )
        db.add(rec)
        count += 1
        if count % 2000 == 0:
            db.flush()
            log(f"已导入 {count} 条录取记录...")

    db.commit()
    log(f"✅ 录取数据导入完成：{count} 条（跳过 {skip} 条无效行）")


# ──────────────────────────────────────────────────────────────
# 4. 北京招生计划（含选科/学费）
# ──────────────────────────────────────────────────────────────
def import_majors(db):
    print("\n[4/6] 导入北京招生计划（22-25年）...")
    path = f"{DATA_ROOT}/18、北京-2026志愿填报资料【永久更新】/2、北京高考录取数据22-25【持续更新】/22-25年全国高校在北京市的招生计划.xlsx"
    df = pd.read_excel(path)

    count = 0
    for _, row in df.iterrows():
        school_name = str(row.get("院校名称", "")).strip()
        school_code = str(row.get("院校代码", "")).strip()
        major_name = str(row.get("专业", "")).strip()
        major_group = str(row.get("所属专业组", "")).strip()
        subject_req = str(row.get("选科要求", "")).strip()
        plan_count = row.get("招生人数", 0)
        duration = str(row.get("学制", "4")).strip()
        tuition = row.get("学费(元/年)", 0)
        province = str(row.get("省份", "")).strip()
        city = str(row.get("城市", "")).strip()
        year = row.get("年份", 0)
        batch = str(row.get("批次", "")).strip()
        nature = str(row.get("院校性质", "")).strip()

        if not school_name or school_name == "nan":
            continue
        if not major_name or major_name == "nan":
            continue

        try:
            plan_count = int(float(plan_count)) if str(plan_count) not in ["nan", ""] else 0
            tuition = int(float(tuition)) if str(tuition) not in ["nan", ""] else 0
        except:
            plan_count, tuition = 0, 0

        major = Major(
            school_code=school_code,
            school_name=school_name,
            major_name=major_name,
            major_group=major_group if major_group != "nan" else "",
            subject_req=subject_req if subject_req != "nan" else "",
            plan_count=plan_count,
            duration=duration if duration != "nan" else "4",
            tuition=tuition,
            province="北京",
            city=city.replace("市", "") if city != "nan" else "",
            year=int(year) if str(year) != "nan" else 0,
            batch=batch if batch != "nan" else "",
        )
        db.add(major)
        count += 1
        if count % 3000 == 0:
            db.flush()

    db.commit()
    log(f"✅ 招生计划导入完成：{count} 条")


# ──────────────────────────────────────────────────────────────
# 5. 一分一段表
# ──────────────────────────────────────────────────────────────
def import_rank_tables(db):
    print("\n[5/6] 导入北京一分一段表（22-25年）...")
    base = f"{DATA_ROOT}/18、北京-2026志愿填报资料【永久更新】/2、北京高考录取数据22-25【持续更新】/一分一段"
    files = {
        2022: "北京2022年的一分一段表.xlsx",
        2023: "北京2023年的一分一段表.xlsx",
        2024: "北京2024年的一分一段表.xlsx",
        2025: "北京2025年的一分一段表.xlsx",
    }

    total = 0
    for year, fname in files.items():
        fpath = f"{base}/{fname}"
        if not os.path.exists(fpath):
            log(f"文件不存在，跳过：{fname}")
            continue
        df = pd.read_excel(fpath)
        count = 0
        for _, row in df.iterrows():
            score_raw = str(row.get("分数(分)", "")).strip()
            cum_raw = row.get("累计人数(人)", 0)
            count_raw = row.get("本段人数(人)", 0)
            category = str(row.get("科类", "综合")).strip()
            batch = str(row.get("批次", "本科批")).strip()

            # 处理分数段（如 "700-750"）→ 取中间值
            try:
                if "-" in score_raw:
                    parts = score_raw.split("-")
                    score = int(parts[0])
                else:
                    score = int(float(score_raw))
            except:
                continue

            try:
                cum = int(float(cum_raw)) if str(cum_raw) != "nan" else 0
                cnt = int(float(count_raw)) if str(count_raw) != "nan" else 0
            except:
                cum, cnt = 0, 0

            rt = RankTable(
                province="北京",
                year=year,
                category=category,
                batch=batch,
                score=score,
                count_this=cnt,
                count_cum=cum,
                rank_min=cum - cnt + 1 if cum > cnt else 1,
                rank_max=cum
            )
            db.add(rt)
            count += 1

        db.flush()
        log(f"{year}年一分一段：{count} 条")
        total += count

    db.commit()
    log(f"✅ 一分一段表导入完成：共 {total} 条")


# ──────────────────────────────────────────────────────────────
# 6. 专业就业信息
# ──────────────────────────────────────────────────────────────
def import_employment(db):
    print("\n[6/6] 导入专业就业信息...")
    path = f"{DATA_ROOT}/00、志愿填报必备资料/3、专业介绍/其他专业资料（供参考）/专业就业信息.xlsx"
    df = pd.read_excel(path)

    count = 0
    for _, row in df.iterrows():
        major_name = str(row.get("学科三类", "")).strip()
        if not major_name or major_name == "nan":
            continue

        avg_salary_raw = row.get("平均工资", 0)
        try:
            avg_salary = int(float(avg_salary_raw)) if str(avg_salary_raw) != "nan" else 0
        except:
            avg_salary = 0

        emp = MajorEmployment(
            major_name=major_name,
            edu_level=str(row.get("学历类型", "本科")).strip(),
            category_1=str(row.get("学科一类", "")).strip(),
            category_2=str(row.get("学科二类", "")).strip(),
            avg_salary=avg_salary,
            employment_rank=str(row.get("就业概况-名次-描述", "")).strip(),
            top_city=str(row.get("就业最多地区", "")).strip(),
            top_industry=str(row.get("就业最多行业", "")).strip(),
            job_directions=str(row.get("就业方向", "")).strip()[:500],
            common_jobs=str(row.get("从事岗位", "")).strip()[:1000],
            salary_by_exp=str(row.get("工作年限工资", "")).strip()[:300],
        )
        db.add(emp)
        count += 1

    db.commit()
    log(f"✅ 专业就业信息导入完成：{count} 条")


# ──────────────────────────────────────────────────────────────
# 主入口
# ──────────────────────────────────────────────────────────────
def run():
    print("=" * 55)
    print("  高考志愿决策引擎 · 真实数据导入")
    print("=" * 55)

    # 初始化表结构
    init_db()

    db = SessionLocal()
    try:
        # 清空旧数据
        print("\n清空旧数据...")
        for model in [MajorEmployment, RankTable, AdmissionRecord, Major, SubjectEvaluation, School]:
            count = db.query(model).delete()
            print(f"  删除 {model.__tablename__}: {count} 条")
        db.commit()

        # 按顺序导入
        import_schools(db)
        import_subject_evaluations(db)
        import_admission_records(db)
        import_majors(db)
        import_rank_tables(db)
        import_employment(db)

        # 统计
        print("\n" + "=" * 55)
        print("  导入完成！数据库统计：")
        print(f"  院校数量:     {db.query(School).count():>8,}")
        print(f"  学科评估:     {db.query(SubjectEvaluation).count():>8,}")
        print(f"  专业录取记录: {db.query(AdmissionRecord).count():>8,}")
        print(f"  招生计划:     {db.query(Major).count():>8,}")
        print(f"  一分一段:     {db.query(RankTable).count():>8,}")
        print(f"  就业数据:     {db.query(MajorEmployment).count():>8,}")
        print("=" * 55)

    except Exception as e:
        db.rollback()
        print(f"\n❌ 导入出错: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    run()
