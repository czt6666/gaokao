"""
生成学校级就业数据（估算模型）
================================
基于以下维度估算各高校就业质量指标：
  1. 学校层次（985/211/双一流/普通）
  2. 软科排名（rank_2024）
  3. 地域溢价（北京/上海/广深/其他）
  4. 学科评估得分（有无A+/A级学科）

数据标注为 data_source="估算模型"，作为scraped数据的fallback。
"""
import sys, os, random, json, math
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from database import SessionLocal, School, SchoolEmployment
from sqlalchemy import text

random.seed(42)  # 保证可重复性


# ── 地域薪资系数 ──────────────────────────────────────────────
CITY_PREMIUM = {
    "北京": 1.25, "上海": 1.22, "深圳": 1.18, "广州": 1.12,
    "杭州": 1.10, "南京": 1.06, "成都": 1.02, "武汉": 1.02,
    "西安": 0.98, "重庆": 0.98, "天津": 1.05, "苏州": 1.08,
    "宁波": 1.05, "长沙": 0.98, "合肥": 1.00, "郑州": 0.97,
    "济南": 0.97, "厦门": 1.04, "福州": 1.02,
}

def city_coeff(province: str, city: str) -> float:
    # 用城市查，再用省份查
    for key in [city, province]:
        if key and key in CITY_PREMIUM:
            return CITY_PREMIUM[key]
    return 0.95  # 其他城市默认


# ── 层次基准参数 ──────────────────────────────────────────────
TIER_PARAMS = {
    "985": {
        "salary_base": (11000, 22000),  # (min, max) range based on rank
        "employment_rate": (0.920, 0.975),
        "postgrad_rate": (0.38, 0.65),
        "overseas_rate": (0.06, 0.18),
        "employer_tier_p": [0.65, 0.28, 0.07],  # P(头部, 中等, 一般)
    },
    "211": {
        "salary_base": (8000, 14000),
        "employment_rate": (0.890, 0.950),
        "postgrad_rate": (0.22, 0.42),
        "overseas_rate": (0.03, 0.09),
        "employer_tier_p": [0.20, 0.55, 0.25],
    },
    "双一流": {
        "salary_base": (7200, 11000),
        "employment_rate": (0.870, 0.930),
        "postgrad_rate": (0.18, 0.35),
        "overseas_rate": (0.02, 0.06),
        "employer_tier_p": [0.10, 0.52, 0.38],
    },
    "普通": {
        "salary_base": (5500, 9000),
        "employment_rate": (0.840, 0.920),
        "postgrad_rate": (0.08, 0.20),
        "overseas_rate": (0.005, 0.025),
        "employer_tier_p": [0.02, 0.25, 0.73],
    },
}


def rank_percentile(rank: int, tier: str) -> float:
    """将排名转为0-1分位数（越靠前越接近1）"""
    if not rank or rank <= 0:
        return 0.5
    if tier == "985":
        return max(0.0, 1.0 - (rank - 1) / 60.0)
    elif tier == "211":
        return max(0.0, 1.0 - (rank - 1) / 120.0)
    elif tier == "双一流":
        return max(0.0, 1.0 - (rank - 1) / 200.0)
    else:
        # 普通高校：rank最高可能到3000+
        return max(0.0, 1.0 - (rank - 1) / 2000.0)


def pick_weighted(choices, weights):
    """加权随机选择"""
    total = sum(weights)
    r = random.random() * total
    for choice, w in zip(choices, weights):
        r -= w
        if r <= 0:
            return choice
    return choices[-1]


def lerp(a, b, t):
    """线性插值"""
    return a + (b - a) * t


def estimate_employment(school, disc_scores: dict) -> dict:
    """
    估算单所学校就业数据
    disc_scores: {school_name: [grade, ...]} - 该校所有学科评估等级列表
    """
    tier = school.tier or "普通"
    params = TIER_PARAMS.get(tier, TIER_PARAMS["普通"])

    # 排名百分位 (rank_2024 is empty; rank_2025 has data)
    rank = school.rank_2025 or school.rank_2024 or 0
    pct = rank_percentile(rank, tier)

    # 学科评估加分
    grades = disc_scores.get(school.name, [])
    grade_bonus = 0.0
    grade_values = {"A+": 1.0, "A": 0.8, "A-": 0.6, "B+": 0.35, "B": 0.2, "B-": 0.1}
    if grades:
        top_grade = max(grade_values.get(g, 0) for g in grades)
        grade_bonus = top_grade * 0.15  # 最好学科加成上限15%

    # 地域系数
    city_factor = city_coeff(school.province or "", school.city or "")

    # ── 薪资估算 ──
    sal_min, sal_max = params["salary_base"]
    # pct越大（排名越靠前）→ 薪资越高
    effective_pct = min(1.0, pct + grade_bonus)
    base_sal = lerp(sal_min, sal_max, effective_pct)
    base_sal *= city_factor
    # 加随机噪声 ±8%
    noise = 1.0 + random.uniform(-0.08, 0.08)
    avg_salary = int(base_sal * noise)

    # ── 就业率 ──
    rate_min, rate_max = params["employment_rate"]
    employment_rate = lerp(rate_min, rate_max, effective_pct)
    employment_rate += random.uniform(-0.015, 0.015)
    employment_rate = round(min(0.99, max(0.70, employment_rate)), 4)

    # ── 深造率 ──
    pg_min, pg_max = params["postgrad_rate"]
    postgrad_rate = lerp(pg_min, pg_max, effective_pct)
    postgrad_rate += random.uniform(-0.02, 0.02)
    postgrad_rate = round(min(0.75, max(0.03, postgrad_rate)), 4)

    # ── 出国率 ──
    ov_min, ov_max = params["overseas_rate"]
    overseas_rate = lerp(ov_min, ov_max, effective_pct)
    overseas_rate += random.uniform(-0.005, 0.005)
    overseas_rate = round(min(0.30, max(0.0, overseas_rate)), 4)

    # ── 顶级雇主层级 ──
    tier_p = params["employer_tier_p"]
    employer_tier = pick_weighted(["头部", "中等", "一般"], tier_p)
    # 顶尖985提升为头部
    if tier == "985" and pct >= 0.85:
        employer_tier = "头部"

    # ── 行业分布（基于学校类型）──
    school_type = school.school_type or ""
    if "理工" in school_type or "工业" in school_type:
        industries = {"制造业/工程": 0.28, "互联网/IT": 0.25, "能源/电力": 0.15,
                      "金融": 0.10, "通信": 0.10, "其他": 0.12}
    elif "财经" in school_type:
        industries = {"金融/银行/保险": 0.42, "互联网/IT": 0.18, "咨询/审计": 0.15,
                      "国有企业": 0.12, "其他": 0.13}
    elif "师范" in school_type:
        industries = {"教育/科研": 0.45, "政府/机关": 0.15, "互联网/IT": 0.12,
                      "金融": 0.10, "其他": 0.18}
    elif "医" in (school.name or ""):
        industries = {"医疗/健康": 0.55, "制药/生物": 0.18, "科研/高校": 0.12,
                      "其他": 0.15}
    else:
        # 综合类
        industries = {"互联网/IT": 0.20, "金融/银行": 0.18, "政府/机关": 0.15,
                      "教育/科研": 0.12, "制造业": 0.12, "其他": 0.23}

    # ── 城市分布 ──
    province = school.province or ""
    city = school.city or province
    cities = {}
    if province == "北京":
        cities = {"北京": 0.52, "上海": 0.10, "深圳": 0.08, "其他": 0.30}
    elif province == "上海":
        cities = {"上海": 0.50, "北京": 0.12, "深圳": 0.08, "其他": 0.30}
    elif province in ["广东"]:
        cities = {"深圳": 0.22, "广州": 0.22, "北京": 0.10, "上海": 0.10, "其他": 0.36}
    elif province in ["浙江", "江苏"]:
        cities = {"上海": 0.22, city: 0.20, "北京": 0.12, "深圳": 0.10, "其他": 0.36}
    else:
        cities = {city: 0.30, "北京": 0.15, "上海": 0.12, "深圳": 0.10, "其他": 0.33}

    return {
        "school_name": school.name,
        "year": 2024,
        "employment_rate": employment_rate,
        "avg_salary": avg_salary,
        "postgrad_rate": postgrad_rate,
        "overseas_rate": overseas_rate,
        "top_employer_tier": employer_tier,
        "top_industries": json.dumps(industries, ensure_ascii=False),
        "top_cities": json.dumps(cities, ensure_ascii=False),
        "top_employers": "[]",
        "postgrad_schools": "",
        "data_source": "估算模型",
        "report_url": "",
    }


def main():
    db = SessionLocal()

    print("加载学科评估数据...")
    rows = db.execute(text("SELECT school_name, grade FROM subject_evaluations")).fetchall()
    disc_scores = {}
    for school_name, grade in rows:
        disc_scores.setdefault(school_name, []).append(grade)
    print(f"  学科评估覆盖 {len(disc_scores)} 所学校")

    print("加载学校数据...")
    schools = db.query(School).all()
    print(f"  共 {len(schools)} 所学校")

    # 清除旧的估算数据（保留scraped数据）
    deleted = db.execute(
        text("DELETE FROM school_employment WHERE data_source = '估算模型'")
    ).rowcount
    db.commit()
    if deleted:
        print(f"  已清除旧估算记录 {deleted} 条")

    # 批量生成
    records = []
    for school in schools:
        try:
            data = estimate_employment(school, disc_scores)
            records.append(SchoolEmployment(**data))
        except Exception as e:
            print(f"  ⚠ {school.name}: {e}")

    print(f"\n生成 {len(records)} 条记录，写入数据库...")
    db.bulk_save_objects(records)
    db.commit()

    # 验证
    total = db.query(SchoolEmployment).count()
    print(f"✅ 写入完成！school_employment 表共 {total} 条记录")

    # 抽样展示
    print("\n抽样展示（按层次各取2条）：")
    for tier_filter, tier_name in [
        ("985", "985"), ("211", "211"), ("双一流", "双一流"), ("普通", "普通")
    ]:
        samples = (
            db.query(SchoolEmployment, School)
            .join(School, SchoolEmployment.school_name == School.name)
            .filter(School.tier == tier_filter)
            .order_by(School.rank_2025)
            .limit(2)
            .all()
        )
        for se, s in samples:
            print(
                f"  [{tier_name}] {s.name} | "
                f"就业率={se.employment_rate:.1%} | "
                f"月薪={se.avg_salary:,} | "
                f"深造率={se.postgrad_rate:.1%} | "
                f"雇主={se.top_employer_tier}"
            )

    db.close()


if __name__ == "__main__":
    main()
