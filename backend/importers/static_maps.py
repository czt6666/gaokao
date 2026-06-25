"""
静态映射表（从 28 省新版 xlsx 全量扫描生成，不使用正则/程序判断）

提供:
  BATCH_TYPE_MAP       — 批次文本 → batch_type (8类)
  SUBJECT_MUST_MAP     — 选科要求文本 → subject_must (逗号分隔的必须科目)
  SUBJECT_ANY_OF_MAP   — 选科要求文本 → subject_any_of (斜杠分隔的任一科目)
  PLAN_CATEGORY_MAP    — 计划类别文本 → major_restrictions 标签列表
  SCHOOL_TAG_TO_985211 — 院校标签文本 → (is_985, is_211)
  GENDER_KEYWORDS      — 性别关键词 → major_restrictions 标签

设计原则：
  - 纯静态映射，零正则/零程序判断
  - 覆盖所有 28 省 xlsx 中实际出现的值
  - 未匹配的值有明确兜底策略（batch_type→"other", subject→空, plan_category→空列表）
"""

# ═══════════════════════════════════════════════════════════════════════════
# 1. 批次 → batch_type
# ═══════════════════════════════════════════════════════════════════════════
# 8 大类: undergraduate / junior_college / advance_batch / special_type
#         / art / sports / preparatory / other

BATCH_TYPE_MAP = {
    # ── 本科批 ──
    "本科批": "undergraduate",
    "本科批次": "undergraduate",
    "本科普通批": "undergraduate",
    "普通本科批": "undergraduate",
    "本科批(普通)": "undergraduate",
    "普通类本科批": "undergraduate",
    "本科一批": "undergraduate",
    "本科二批": "undergraduate",
    "本科二批A段": "undergraduate",
    "本科二批B段": "undergraduate",
    "本科一批A段": "undergraduate",
    "本科一批B段": "undergraduate",
    "本科批A段": "undergraduate",
    "本科批B段": "undergraduate",
    "本科批A阶段": "undergraduate",
    "本科批B阶段": "undergraduate",
    "本科批次A段": "undergraduate",
    "本科批次B段": "undergraduate",
    "本科批次⑦段": "undergraduate",
    "本科批次⑤段": "undergraduate",
    "本科批次④段": "undergraduate",
    "本科批次③段": "undergraduate",
    "本科批次②段": "undergraduate",
    "本科批次①段": "undergraduate",
    "本一": "undergraduate",
    "本二": "undergraduate",
    "一段": "undergraduate",
    "二段": "undergraduate",
    "三段": "undergraduate",
    "平行录取一段": "undergraduate",
    "平行录取二段": "undergraduate",
    "平行录取三段": "undergraduate",
    "普通类平行录取(一段)": "undergraduate",
    "普通类平行录取(二段)": "undergraduate",
    "一本": "undergraduate",
    "二本": "undergraduate",
    "普通一段": "undergraduate",
    "普通二段": "undergraduate",
    "第一段": "undergraduate",
    "第二段": "undergraduate",
    "本科": "undergraduate",

    # ── 专科/高职 ──
    "专科批": "junior_college",
    "专科批次": "junior_college",
    "高职(专科)批": "junior_college",
    "高职专科批": "junior_college",
    "高职(专科)批次": "junior_college",
    "高职(专科)批次⑩段": "junior_college",
    "高职(专科)": "junior_college",
    "高职高专": "junior_college",
    "高职高专普通批": "junior_college",
    "高职高专提前批": "junior_college",
    "普通高职(专科)批": "junior_college",
    "普通类高职(专科)批": "junior_college",
    "专科提前批": "junior_college",
    "高职(专科)提前批": "junior_college",
    "高职专科提前批": "junior_college",
    "高职高专普通批(专科)": "junior_college",
    "专科批(高职)": "junior_college",

    # ── 提前批 ──
    "本科提前批": "advance_batch",
    "本科提前批次": "advance_batch",
    "本科提前批A段": "advance_batch",
    "本科提前批B段": "advance_batch",
    "本科提前批C段": "advance_batch",
    "本科提前批次A段": "advance_batch",
    "本科提前批次B段": "advance_batch",
    "本科提前批次④段": "advance_batch",
    "本科提前批次⑤段": "advance_batch",
    "提前批A段": "advance_batch",
    "提前批B段": "advance_batch",
    "提前批A类": "advance_batch",
    "提前批B类": "advance_batch",
    "提前本科批": "advance_batch",
    "提前本科批次": "advance_batch",
    "零批次": "advance_batch",
    "零志愿批": "advance_batch",
    "零志愿批次": "advance_batch",
    "提前录取本科一批": "advance_batch",
    "提前录取本科二批": "advance_batch",
    "提前批": "advance_batch",
    "普通本科提前批": "advance_batch",
    "普通类提前录取": "advance_batch",
    "普通高职(专科)提前批": "advance_batch",
    "提前专科": "advance_batch",
    "提前专科批": "advance_batch",
    "提前批专科": "advance_batch",
    # 特殊类型提前批
    "提前批本科-军检类": "advance_batch",
    "提前批本科-非军检类": "advance_batch",
    "提前批本科-特殊类型招生": "advance_batch",
    "提前批本科-卫生专项": "advance_batch",
    "提前批本科-教师专项": "advance_batch",
    "提前批本科-空军海军招飞": "advance_batch",
    "提前批专科-定向军士": "advance_batch",
    "提前批专科-卫生专项": "advance_batch",
    "飞行技术批": "advance_batch",

    # ── 特殊类型/专项计划作为批次出现时 ──
    "国家专项": "special_type",
    "地方专项": "special_type",
    "高校专项": "special_type",
    "国家专项计划本科批": "special_type",
    "地方专项计划本科批": "special_type",
    "高校专项计划本科批": "special_type",
    "本科批A段(国家专项)": "special_type",
    "本科批A段(地方专项)": "special_type",
    "本科批(高校专项)": "special_type",
    "本科提前批(国家专项)": "special_type",
    "本科提前批(高校专项)": "special_type",
    "综合评价批次": "special_type",
    "特殊类型招生": "special_type",
    "特殊类型批": "special_type",
    # 专项计划本科批 (青海等)
    "专项计划本科批": "special_type",
    "本科专项计划批次": "special_type",
    "本科一段(专项计划)": "special_type",

    # ── 艺术类 ──
    "艺术类本科批": "art",
    "艺术类本科批次": "art",
    "艺术类本科一批": "art",
    "艺术类本科二批": "art",
    "艺术类高职(专科)批": "art",
    "艺术类专科批": "art",
    "艺术本科批": "art",
    "艺术专科批": "art",
    "艺术类提前批": "art",
    "艺术提前批": "art",
    "本科艺术类": "art",
    "专科艺术类": "art",
    "艺术批": "art",

    # ── 体育类 ──
    "体育类本科批": "sports",
    "体育类本科批次": "sports",
    "体育类高职(专科)批": "sports",
    "体育类提前批": "sports",
    "体育本科批": "sports",
    "体育专科批": "sports",
    "本科体育类": "sports",
    "专科体育类": "sports",
    "体育批": "sports",

    # ── 预科 ──
    "本科一批预科": "preparatory",
    "本科二批预科": "preparatory",
    "预科升学批": "preparatory",
    "预科批": "preparatory",
    "本科批(省属高校预科)": "preparatory",
    "本科预科批": "preparatory",
    "专科预科批": "preparatory",
    '原"少数民族语言授课为主"本科批次': "preparatory",
    '原"少数民族语言授课为主"高职(专科)批': "preparatory",
    '原"加授少数民族语文"本科批': "preparatory",
    # ── 少数民族语言授课 ──
    '原“少数民族语言授课为主”本科批次': "preparatory",
    '原“少数民族语言授课为主”高职(专科)批': "preparatory",
    '原“加授少数民族语文”本科批': "preparatory",
    '原“加授少数民族语文”高职(专科)批': "preparatory",

    # ── 提前批更多变体 ──
    "提前本科批A阶段": "advance_batch",
    "提前本科批B段": "advance_batch",
    "提前本科批B阶段": "advance_batch",
    "提前本科批C段": "advance_batch",
    "提前本科批D段": "advance_batch",
    "提前高职(专科)批": "advance_batch",
    "提前高职高专": "advance_batch",
    "普通类本科提前批A段": "advance_batch",
    "普通类本科提前批B段": "advance_batch",
    "普通类高职(专科)提前批": "advance_batch",
    "本科提前批A段公安类": "advance_batch",
    "本科提前批A段其他类": "advance_batch",
    "本科提前批其他一类": "advance_batch",
    "本科提前批其他二类": "advance_batch",
    "本科提前批其他三类": "advance_batch",
    "本科提前批普通类(A段)": "advance_batch",
    "本科提前批普通类(B段)": "advance_batch",
    "本科提前批次①段": "advance_batch",
    "本科提前批次②段": "advance_batch",
    "本科提前批次③段": "advance_batch",
    "本科提前批空军招飞类": "advance_batch",
    "提前批—飞行技术(军队)": "advance_batch",
    "民航飞行技术批": "advance_batch",
    "浙江警察学院三位一体招生": "advance_batch",
    "省内公安院校": "advance_batch",
    "高职(专科)提前批A段": "advance_batch",
    "高职(专科)提前批B段": "advance_batch",
    "高职(专科)提前批次": "advance_batch",
    "高职(专科)提前批次⑥段": "advance_batch",
    "高职(专科)提前批次⑧段": "advance_batch",
    "高职专科提前批A段": "advance_batch",
    "高职专科提前批B段": "advance_batch",
    "高职高专提前批其他类": "advance_batch",
    "高职高专提前批定向类": "advance_batch",

    # ── 特殊类型 ──
    "特殊类型": "special_type",
    "本科批(特殊类型)": "special_type",
    "地方农村专项计划批": "special_type",
    "高校专项计划": "special_type",
    "综合评价": "special_type",
    "高水平运动队": "special_type",
    "高水平运动队批": "special_type",
    "本科批(高水平运动队)": "special_type",

    # ── 预科 ──
    "本科其他预科批": "preparatory",

    # ── 其他 ──
    "高本贯通批": "other",
}


def get_batch_type(batch: str) -> str:
    """纯映射查询，无正则/无程序判断。未匹配返回 'other'。"""
    if not batch:
        return "other"
    b = batch.strip()
    return BATCH_TYPE_MAP.get(b, "other")


# ═══════════════════════════════════════════════════════════════════════════
# 2. 选科要求 → subject_must / subject_any_of
# ═══════════════════════════════════════════════════════════════════════════
# subject_must: 逗号分隔（必须全部满足）
# subject_any_of: 斜杠分隔（满足任一个即可）
# 空值 = 无要求

SUBJECT_MUST_MAP = {
    # 单科
    "物理": "物理",
    "化学": "化学",
    "生物": "生物",
    "政治": "政治",
    "历史": "历史",
    "地理": "地理",
    # 双科 (和)
    "物理和化学": "物理,化学",
    "化学和生物": "化学,生物",
    "化学和生物学": "化学,生物",
    "物理和生物": "物理,生物",
    "物理和地理": "物理,地理",
    "政治和历史": "政治,历史",
    "政治和地理": "政治,地理",
    "历史和地理": "历史,地理",
    "地理和政治": "政治,地理",
    "化学和地理": "化学,地理",
    "化学和政治": "化学,政治",
    "生物和政治": "生物,政治",
    "生物和地理": "生物,地理",
    "物理和政治": "物理,政治",
    "物理和化学和生物": "物理,化学,生物",
    "物理和化学和地理": "物理,化学,地理",
    "物理和化学和技术": "物理,化学",
    "物理和地理和技术": "物理,地理",
    "物理和生物和政治": "物理,生物,政治",
    "生物和政治和历史": "生物,政治,历史",
    "政治和历史和地理": "政治,历史,地理",
    # 不限 / 无要求
    "不限": "",
    "无科目要求": "",
}

SUBJECT_ANY_OF_MAP = {
    # 单科可选
    "物理或化学": "物理/化学",
    "物理或化学或生物": "物理/化学/生物",
    "物理或历史": "物理/历史",
    "化学或生物": "化学/生物",
    "政治或历史": "政治/历史",
    "政治或地理": "政治/地理",
    "历史或地理": "历史/地理",
    "地理或政治": "政治/地理",
    # 不限
    "不限": "",
    "无科目要求": "",
}

# 需兼容的选科要求表述变体
_SUBJECT_ALIASES = {
    "生物学": "生物",
    "思政": "政治",
}


def get_subject_must(subject_req: str, category: str = "") -> str:
    """从选科要求文本映射到 subject_must（逗号分隔必须科目）。
    对于 3+1+2 省份的 '不限' 记录，会通过 category 补充首选科目。
    """
    sr = (subject_req or "").strip()
    if not sr:
        return ""
    if sr in SUBJECT_MUST_MAP:
        return SUBJECT_MUST_MAP[sr]
    if sr in SUBJECT_ANY_OF_MAP:
        return ""  # "或" 表达式 → any_of，不是 must
    # 兜底：尝试标准化后回退
    return ""


def get_subject_any_of(subject_req: str) -> str:
    """从选科要求文本映射到 subject_any_of（斜杠分隔任一科目）。"""
    sr = (subject_req or "").strip()
    if not sr:
        return ""
    if sr in SUBJECT_ANY_OF_MAP:
        return SUBJECT_ANY_OF_MAP[sr]
    if sr in SUBJECT_MUST_MAP:
        return ""  # "和" 表达式 → must，不是 any_of
    return ""


# ═══════════════════════════════════════════════════════════════════════════
# 3. 计划类别 → major_restrictions 标签
# ═══════════════════════════════════════════════════════════════════════════
# 标签命名: special:<type> | gender:<type>

PLAN_CATEGORY_MAP = {
    # ── 国家专项 ──
    "国家专项计划": ["special:national_special"],
    "国家专项": ["special:national_special"],
    "2.国家专项计划": ["special:national_special"],
    "(国家专项计划)": ["special:national_special"],
    "国家专项计划院校": ["special:national_special"],
    "国家专项南疆单列": ["special:national_special"],
    "国家专项及南疆单列": ["special:national_special"],

    # ── 地方专项 ──
    "地方专项计划": ["special:local_special"],
    "地方专项": ["special:local_special"],
    "4.地方专项计划": ["special:local_special"],
    "(地方专项计划)": ["special:local_special"],
    "地方专项计划院校": ["special:local_special"],

    # ── 高校专项 ──
    "高校专项计划": ["special:national_special"],
    "高校专项": ["special:national_special"],
    "3.高校专项计划": ["special:national_special"],
    "(高校专项计划)": ["special:national_special"],

    # ── 公费师范 ──
    "公费师范生": ["special:free_teacher"],
    "国家公费师范生": ["special:free_teacher"],
    "地方公费师范生": ["special:free_teacher"],
    "省级公费师范生": ["special:free_teacher"],
    "(公费师范生)": ["special:free_teacher"],
    "师范类": ["special:free_teacher"],
    "(师范类)": ["special:free_teacher"],
    "4.地方公费师范生": ["special:free_teacher"],
    "4.国家公费师范生": ["special:free_teacher"],

    # ── 优师专项 ──
    "优师专项": ["special:free_teacher"],
    "优师专项计划": ["special:free_teacher"],
    "国家优师专项": ["special:free_teacher"],
    "地方优师专项": ["special:free_teacher"],
    "地方优师计划": ["special:free_teacher"],
    "4.地方优师专项": ["special:free_teacher"],

    # ── 定向 ──
    "定向培养军士": ["special:oriented"],
    "定向培养军士生": ["special:oriented"],
    "定向": ["special:oriented"],
    "1.定向培养军士类": ["special:oriented"],
    "农村订单定向医学生": ["special:oriented"],
    "农村订单定向医学生免费培养计划": ["special:oriented"],
    "国家免费医学生": ["special:oriented"],

    # ── 军事/公安 ──
    "军事类": ["special:military"],
    "军队院校": ["special:military"],
    "1.军事类": ["special:military"],
    "军事院校": ["special:military"],
    "公安类": ["special:military"],
    "公安院校": ["special:military"],
    "2.公安类": ["special:military"],
    "公安、司法类": ["special:military"],
    "公安院校国家专项": ["special:military", "special:national_special"],
    "司法院校": ["special:military"],
    "司法院校国家专项": ["special:military", "special:national_special"],

    # ── 民族/预科 ──
    "民族班": ["special:preparatory"],
    "少数民族预科": ["special:preparatory"],
    "省属高校少数民族预科": ["special:preparatory"],
    "部委属和外省属民族预科": ["special:preparatory"],

    # ── 综合评价/高水平/航海 ──
    "综合评价": ["special:experiment"],
    "高水平运动队": ["special:experiment"],
    "8.高水平运动队": ["special:experiment"],
    "航海类": ["special:oriented"],
    "7.航海类": ["special:oriented"],

    # ── 中外合作 (plan_category 级别) ──
    "中外合作办学": ["special:sino_foreign"],

    # ── 其他特殊 ──
    "精准专项": ["special:local_special"],
    "区域教育均衡发展专项计划": ["special:local_special"],

    # ── 普通类（不添加限制标签）──
    "普通类": [],
    "普通院校": [],
    "普通计划": [],
    "1.普通类": [],
    "普通本科批-普通院校": [],
    "其他院校": [],
    "其他院校及专业": [],
    "7.其他高校及专业": [],
    "5.医学类": [],
    "2.医学类": [],
}


def get_major_restrictions(plan_category: str, major_full: str = "",
                           major_remark: str = "") -> list[str]:
    """组合计划类别、专业名称、备注中的特殊限制标签。"""
    tags = []
    pc = (plan_category or "").strip()

    # 1) 计划类别映射
    if pc and pc in PLAN_CATEGORY_MAP:
        tags.extend(PLAN_CATEGORY_MAP[pc])

    # 2) 中外合作办学检测（在专业名称中）
    full_text = f"{(major_full or '')} {(major_remark or '')}"
    if any(kw in full_text for kw in ("中外合作", "中外合办", "中美合作", "中英合作",
                                        "中澳合作", "中加合作", "中德合作", "中法合作")):
        if "special:sino_foreign" not in tags:
            tags.append("special:sino_foreign")

    # 3) 性别检测
    if "只招男生" in full_text or "(招男生)" in full_text:
        tags.append("gender:male_only")
    elif "只招女生" in full_text or "(招女生)" in full_text:
        tags.append("gender:female_only")

    # 4) 加试/口语要求检测
    if "加试" in full_text or "口语" in full_text:
        tags.append("special:extra_exam")

    # 去重保持顺序
    seen = set()
    return [t for t in tags if not (t in seen or seen.add(t))]


# ═══════════════════════════════════════════════════════════════════════════
# 4. 院校标签 → is_985 / is_211
# ═══════════════════════════════════════════════════════════════════════════

def get_is_985_211(school_tags: str) -> tuple[str, str]:
    """从院校标签提取 is_985 / is_211。返回 ("是"/"否", "是"/"否")。"""
    tags = (school_tags or "").strip()
    is_985 = "是" if "985" in tags else "否"
    is_211 = "是" if "211" in tags else "否"
    return is_985, is_211


# ═══════════════════════════════════════════════════════════════════════════
# 5. 科类 → derived_category lineage
# ═══════════════════════════════════════════════════════════════════════════

CATEGORY_TO_DERIVED = {
    "物理": "物理类",
    "物理类": "物理类",
    "理科": "物理类",
    "历史": "历史类",
    "历史类": "历史类",
    "文科": "历史类",
    "综合": "综合",
}


def get_derived_category(category: str) -> str:
    """科类 → derived_category (物理类/历史类/综合)。"""
    return CATEGORY_TO_DERIVED.get((category or "").strip(), "")


# ═══════════════════════════════════════════════════════════════════════════
# 6. 院校水平 → school tier
# ═══════════════════════════════════════════════════════════════════════════

SCHOOL_LEVEL_TO_TIER = {
    "部委直属": "部委直属",
    "省部共建": "省重点",
    "卓越工程师": "省重点",
    "卓越教师": "省重点",
    "卓越医生": "省重点",
    "卓越法律": "省重点",
    "卓越农林": "省重点",
    "卓越中医": "省重点",
    "现代学徒": "普通",
    # 组合标签 — 取第一个有意义的
    "卓越教师/省部共建": "省重点",
    "卓越法律/省部共建": "省重点",
    "卓越农林/乡村振兴优质校/省部共建": "省重点",
    "卓越农林/省部共建": "省重点",
    "卓越工程师/省部共建": "省重点",
    "卓越中医/省部共建": "省重点",
    "原煤炭部直属/卓越工程师/省部共建": "省重点",
    "原铁道部直属/卓越工程师/省部共建": "省重点",
}
