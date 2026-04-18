"""
种子数据（用于MVP演示）
包含20所代表性院校，覆盖985/211/双一流/行业特色类型
数据基于公开信息构造，接入真实数据后替换
"""
from database import School, Major, AdmissionRecord, SessionLocal, init_db


SCHOOLS = [
    {"name": "北京大学", "province": "北京", "city": "北京", "tier": "985", "tags": "顶尖,综合"},
    {"name": "清华大学", "province": "北京", "city": "北京", "tier": "985", "tags": "顶尖,工科"},
    {"name": "复旦大学", "province": "上海", "city": "上海", "tier": "985", "tags": "顶尖,综合"},
    {"name": "浙江大学", "province": "浙江", "city": "杭州", "tier": "985", "tags": "顶尖,综合"},
    {"name": "武汉大学", "province": "湖北", "city": "武汉", "tier": "985", "tags": "综合"},
    {"name": "中国科学技术大学", "province": "安徽", "city": "合肥", "tier": "985", "tags": "理工,小而精"},
    {"name": "西北工业大学", "province": "陕西", "city": "西安", "tier": "985", "tags": "军工,航空"},
    {"name": "兰州大学", "province": "甘肃", "city": "兰州", "tier": "985", "tags": "西部,地学"},
    {"name": "中国石油大学（北京）", "province": "北京", "city": "北京", "tier": "211", "tags": "能源,行业"},
    {"name": "中国矿业大学", "province": "江苏", "city": "徐州", "tier": "211", "tags": "矿业,能源"},
    {"name": "中国海洋大学", "province": "山东", "city": "青岛", "tier": "985", "tags": "海洋,水产"},
    {"name": "西北农林科技大学", "province": "陕西", "city": "咸阳", "tier": "985", "tags": "农林,西部"},
    {"name": "东北大学", "province": "辽宁", "city": "沈阳", "tier": "985", "tags": "工科,东北"},
    {"name": "吉林大学", "province": "吉林", "city": "长春", "tier": "985", "tags": "综合,东北"},
    {"name": "哈尔滨工业大学", "province": "黑龙江", "city": "哈尔滨", "tier": "985", "tags": "理工,军工"},
    {"name": "燕山大学", "province": "河北", "city": "秦皇岛", "tier": "双一流", "tags": "机械,工科"},
    {"name": "中国地质大学（武汉）", "province": "湖北", "city": "武汉", "tier": "211", "tags": "地质,资源"},
    {"name": "成都信息工程大学", "province": "四川", "city": "成都", "tier": "普通", "tags": "信息,气象"},
    {"name": "南京信息工程大学", "province": "江苏", "city": "南京", "tier": "双一流", "tags": "气象,信息"},
    {"name": "中国传媒大学", "province": "北京", "city": "北京", "tier": "211", "tags": "传媒,艺术"},
]

# 专业数据（含学科评估）
MAJORS = [
    {"school_name": "兰州大学", "major_name": "地球物理学", "subject_strength": "A-", "subject_req": "物理+化学", "plan_count": 30},
    {"school_name": "兰州大学", "major_name": "大气科学", "subject_strength": "A+", "subject_req": "物理", "plan_count": 25},
    {"school_name": "兰州大学", "major_name": "生态学", "subject_strength": "A+", "subject_req": "生物", "plan_count": 20},
    {"school_name": "中国海洋大学", "major_name": "海洋工程", "subject_strength": "A+", "subject_req": "物理+化学", "plan_count": 40},
    {"school_name": "中国海洋大学", "major_name": "水产养殖学", "subject_strength": "A+", "subject_req": "生物", "plan_count": 35},
    {"school_name": "西北工业大学", "major_name": "航空航天工程", "subject_strength": "A+", "subject_req": "物理", "plan_count": 50},
    {"school_name": "西北工业大学", "major_name": "材料科学与工程", "subject_strength": "A-", "subject_req": "物理+化学", "plan_count": 45},
    {"school_name": "中国矿业大学", "major_name": "矿业工程", "subject_strength": "A+", "subject_req": "物理", "plan_count": 60},
    {"school_name": "中国矿业大学", "major_name": "安全工程", "subject_strength": "A+", "subject_req": "物理", "plan_count": 50},
    {"school_name": "中国石油大学（北京）", "major_name": "石油工程", "subject_strength": "A+", "subject_req": "物理+化学", "plan_count": 80},
    {"school_name": "中国地质大学（武汉）", "major_name": "地质学", "subject_strength": "A+", "subject_req": "物理+化学", "plan_count": 40},
    {"school_name": "哈尔滨工业大学", "major_name": "航天工程", "subject_strength": "A+", "subject_req": "物理", "plan_count": 45},
    {"school_name": "哈尔滨工业大学", "major_name": "核工程与核技术", "subject_strength": "A-", "subject_req": "物理+化学", "plan_count": 30},
    {"school_name": "吉林大学", "major_name": "地球物理学", "subject_strength": "A-", "subject_req": "物理+化学", "plan_count": 25},
    {"school_name": "东北大学", "major_name": "冶金工程", "subject_strength": "A+", "subject_req": "物理+化学", "plan_count": 50},
    {"school_name": "西北农林科技大学", "major_name": "农业资源与环境", "subject_strength": "A+", "subject_req": "生物+化学", "plan_count": 40},
    {"school_name": "南京信息工程大学", "major_name": "大气科学", "subject_strength": "A+", "subject_req": "物理", "plan_count": 60},
    {"school_name": "燕山大学", "major_name": "机械工程", "subject_strength": "A-", "subject_req": "物理", "plan_count": 80},
    {"school_name": "中国科学技术大学", "major_name": "核工程与核技术", "subject_strength": "A+", "subject_req": "物理+化学", "plan_count": 25},
    {"school_name": "中国传媒大学", "major_name": "广播电视学", "subject_strength": "A+", "subject_req": "", "plan_count": 50},
]

# 历年录取数据（以广东省为例，模拟数据）
# min_rank 是当年广东省该专业最低录取位次
ADMISSION_RECORDS = [
    # 兰州大学 地球物理学（典型城市冷专业强）
    {"school_name": "兰州大学", "major_name": "地球物理学", "province": "广东", "year": 2022, "min_score": 601, "min_rank": 28500, "plan_count": 5},
    {"school_name": "兰州大学", "major_name": "地球物理学", "province": "广东", "year": 2023, "min_score": 595, "min_rank": 31200, "plan_count": 5},
    {"school_name": "兰州大学", "major_name": "地球物理学", "province": "广东", "year": 2024, "min_score": 598, "min_rank": 29800, "plan_count": 5},

    # 兰州大学 大气科学（A+，城市折价）
    {"school_name": "兰州大学", "major_name": "大气科学", "province": "广东", "year": 2022, "min_score": 597, "min_rank": 30100, "plan_count": 4},
    {"school_name": "兰州大学", "major_name": "大气科学", "province": "广东", "year": 2023, "min_score": 592, "min_rank": 33000, "plan_count": 4},
    {"school_name": "兰州大学", "major_name": "大气科学", "province": "广东", "year": 2024, "min_score": 594, "min_rank": 31500, "plan_count": 4},

    # 中国海洋大学 海洋工程（A+，城市中等，专业强）
    {"school_name": "中国海洋大学", "major_name": "海洋工程", "province": "广东", "year": 2022, "min_score": 618, "min_rank": 16200, "plan_count": 8},
    {"school_name": "中国海洋大学", "major_name": "海洋工程", "province": "广东", "year": 2023, "min_score": 612, "min_rank": 18500, "plan_count": 8},
    {"school_name": "中国海洋大学", "major_name": "海洋工程", "province": "广东", "year": 2024, "min_score": 615, "min_rank": 17100, "plan_count": 8},

    # 西北工业大学 航空航天（985但西安，有城市折价）
    {"school_name": "西北工业大学", "major_name": "航空航天工程", "province": "广东", "year": 2022, "min_score": 643, "min_rank": 5800, "plan_count": 10},
    {"school_name": "西北工业大学", "major_name": "航空航天工程", "province": "广东", "year": 2023, "min_score": 638, "min_rank": 7200, "plan_count": 10},
    {"school_name": "西北工业大学", "major_name": "航空航天工程", "province": "广东", "year": 2024, "min_score": 641, "min_rank": 6300, "plan_count": 10},

    # 中国矿业大学 矿业工程（A+，徐州，典型冷门）
    {"school_name": "中国矿业大学", "major_name": "矿业工程", "province": "广东", "year": 2022, "min_score": 578, "min_rank": 52000, "plan_count": 10},
    {"school_name": "中国矿业大学", "major_name": "矿业工程", "province": "广东", "year": 2023, "min_score": 568, "min_rank": 62000, "plan_count": 10},
    {"school_name": "中国矿业大学", "major_name": "矿业工程", "province": "广东", "year": 2024, "min_score": 560, "min_rank": 71000, "plan_count": 10},

    # 哈尔滨工业大学 核工程（985，哈尔滨，典型冷门）
    {"school_name": "哈尔滨工业大学", "major_name": "核工程与核技术", "province": "广东", "year": 2022, "min_score": 649, "min_rank": 4600, "plan_count": 6},
    {"school_name": "哈尔滨工业大学", "major_name": "核工程与核技术", "province": "广东", "year": 2023, "min_score": 644, "min_rank": 5900, "plan_count": 6},
    {"school_name": "哈尔滨工业大学", "major_name": "核工程与核技术", "province": "广东", "year": 2024, "min_score": 647, "min_rank": 5100, "plan_count": 6},

    # 中国石油大学 石油工程（冷门但高薪）
    {"school_name": "中国石油大学（北京）", "major_name": "石油工程", "province": "广东", "year": 2022, "min_score": 581, "min_rank": 48000, "plan_count": 15},
    {"school_name": "中国石油大学（北京）", "major_name": "石油工程", "province": "广东", "year": 2023, "min_score": 574, "min_rank": 56000, "plan_count": 15},
    {"school_name": "中国石油大学（北京）", "major_name": "石油工程", "province": "广东", "year": 2024, "min_score": 569, "min_rank": 62000, "plan_count": 15},

    # 南京信息工程大学 大气科学（A+，超性价比）
    {"school_name": "南京信息工程大学", "major_name": "大气科学", "province": "广东", "year": 2022, "min_score": 575, "min_rank": 55000, "plan_count": 10},
    {"school_name": "南京信息工程大学", "major_name": "大气科学", "province": "广东", "year": 2023, "min_score": 570, "min_rank": 61000, "plan_count": 10},
    {"school_name": "南京信息工程大学", "major_name": "大气科学", "province": "广东", "year": 2024, "min_score": 572, "min_rank": 59000, "plan_count": 10},

    # 武汉大学（对比参照）
    {"school_name": "武汉大学", "major_name": "计算机科学与技术", "province": "广东", "year": 2022, "min_score": 668, "min_rank": 1900, "plan_count": 20},
    {"school_name": "武汉大学", "major_name": "计算机科学与技术", "province": "广东", "year": 2023, "min_score": 661, "min_rank": 2600, "plan_count": 20},
    {"school_name": "武汉大学", "major_name": "计算机科学与技术", "province": "广东", "year": 2024, "min_score": 665, "min_rank": 2100, "plan_count": 20},

    # 西北农林科技大学 农业资源与环境（A+，碳中和概念）
    {"school_name": "西北农林科技大学", "major_name": "农业资源与环境", "province": "广东", "year": 2022, "min_score": 554, "min_rank": 82000, "plan_count": 8},
    {"school_name": "西北农林科技大学", "major_name": "农业资源与环境", "province": "广东", "year": 2023, "min_score": 548, "min_rank": 91000, "plan_count": 8},
    {"school_name": "西北农林科技大学", "major_name": "农业资源与环境", "province": "广东", "year": 2024, "min_score": 551, "min_rank": 87000, "plan_count": 8},
]


def seed():
    """写入种子数据"""
    init_db()
    db = SessionLocal()

    # 清空已有数据
    db.query(AdmissionRecord).delete()
    db.query(Major).delete()
    db.query(School).delete()
    db.commit()

    # 插入学校
    school_map = {}
    for s in SCHOOLS:
        school = School(**s)
        db.add(school)
        db.flush()
        school_map[s["name"]] = school.id

    # 插入专业
    for m in MAJORS:
        school_id = school_map.get(m["school_name"], 0)
        major = Major(
            school_id=school_id,
            school_name=m["school_name"],
            major_name=m["major_name"],
            subject_req=m.get("subject_req", ""),
            plan_count=m.get("plan_count", 30)
        )
        db.add(major)

    # 插入录取记录
    for r in ADMISSION_RECORDS:
        school_id = school_map.get(r["school_name"], 0)
        record = AdmissionRecord(
            school_id=school_id,
            school_name=r["school_name"],
            major_name=r["major_name"],
            province=r["province"],
            year=r["year"],
            min_score=r["min_score"],
            min_rank=r["min_rank"],
            plan_count=r.get("plan_count", 30)
        )
        db.add(record)

    db.commit()
    db.close()
    print("✅ 种子数据写入完成")


if __name__ == "__main__":
    seed()
