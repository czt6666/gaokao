"""
产业信号层 v1.0 — 冷门算法 2.0 数据基础
静态数据，每年4月高考前更新一次。

数据来源（按权重排序）：
  - china_policy (0.95)：国家"十四五"重点产业、工信部战略报告
  - huang_jensen (1.00)：黄仁勋 GTC 2024/2025 演讲，Physical AI 核心观点
  - cao_dewang_fuyao (0.90)：曹德旺福耀科技大学，中国制造业委培模式标杆
  - openai_exposure (0.85)：OpenAI "Occupational Exposure" 研究（Penn/NYU 2023）
  - mckinsey_wef (0.70)：麦肯赛/WEF 就业替代风险报告
  - musk_elon (0.45)：马斯克观点（参考但降权，预测极端化）

更新说明：
  2026-04: 初始版本
"""

# ── 信息来源权重 ────────────────────────────────────────────────
VISION_SOURCE_WEIGHTS: dict[str, float] = {
    "huang_jensen":     1.00,  # 黄仁勋：Physical AI 是下一波工业革命，确定性最高
    "china_policy":     0.95,  # 国家政策：战略新兴产业清单，政策驱动力强
    "cao_dewang_fuyao": 0.90,  # 曹德旺：制造业+AI，实业家视角，委培模式标杆
    "openai_exposure":  0.85,  # OpenAI/Penn：职业AI暴露研究，方法论严谨
    "mckinsey_wef":     0.70,  # 麦肯赛/WEF：行业级分析，滞后性较高
    "musk_elon":        0.45,  # 马斯克：方向正确但时间线激进，需折扣
}

# ── 产业 S 曲线信号 ────────────────────────────────────────────
# stage: early(萌芽)/growth(高速成长)/mature(成熟)/decline(衰退)
# score: (-1.0 ~ +1.0)，越高对专业越利好
# source: 主要信号来源（用于加权）
INDUSTRY_SCURVE: dict[str, dict] = {
    # ── 黄仁勋主题：Physical AI + 算力基础设施 ────────────────
    "芯片/半导体":       {"stage": "growth",  "score": 0.95, "source": "huang_jensen",
                           "note": "AI算力需求驱动，国产替代叠加，十年窗口"},
    "人形机器人":        {"stage": "early",   "score": 0.90, "source": "huang_jensen",
                           "note": "2026-2030年量产爬坡期，工程师窗口最大"},
    "工业自动化":        {"stage": "growth",  "score": 0.85, "source": "huang_jensen",
                           "note": "Physical AI落地核心，智能工厂改造全面铺开"},
    "新能源汽车":        {"stage": "mature",  "score": 0.55, "source": "china_policy",
                           "note": "渗透率已>50%，竞争加剧，增量放缓但基数大"},
    "AI/算法":           {"stage": "growth",  "score": 0.88, "source": "huang_jensen",
                           "note": "模型层竞争激烈但工程落地需求持续扩张"},

    # ── 中国政策主题：战略安全 + 绿色转型 ─────────────────────
    "核能/小堆":         {"stage": "growth",  "score": 0.88, "source": "china_policy",
                           "note": "国家核电规划重启，小型堆商业化提速"},
    "海洋工程":          {"stage": "growth",  "score": 0.82, "source": "china_policy",
                           "note": "南海开发+深远海养殖+军工，政策红利明确"},
    "国防军工":          {"stage": "growth",  "score": 0.85, "source": "china_policy",
                           "note": "军民融合持续扩张，就业稳定性极高"},
    "碳中和/新能源":     {"stage": "growth",  "score": 0.80, "source": "china_policy",
                           "note": "2060碳中和目标，政策资金持续注入"},
    "生物医药":          {"stage": "growth",  "score": 0.75, "source": "china_policy",
                           "note": "老龄化驱动+国产替代，研发端扩张"},
    "智慧农业":          {"stage": "early",   "score": 0.72, "source": "china_policy",
                           "note": "农机无人化政策推进，但落地周期长"},
    "公共卫生":          {"stage": "growth",  "score": 0.70, "source": "china_policy",
                           "note": "疫情后CDC体系重建，编制扩张明显"},

    # ── 曹德旺/制造业主题 ──────────────────────────────────────
    "高端制造":          {"stage": "growth",  "score": 0.82, "source": "cao_dewang_fuyao",
                           "note": "中国制造业升级核心，工程人才需求持续"},
    "新材料":            {"stage": "growth",  "score": 0.80, "source": "cao_dewang_fuyao",
                           "note": "半导体材料+航空材料+锂电材料，底层支撑"},
    "精密仪器":          {"stage": "growth",  "score": 0.78, "source": "cao_dewang_fuyao",
                           "note": "国产替代进行中，中高端仪器工程师稀缺"},

    # ── 衰退行业 ──────────────────────────────────────────────
    "传统媒体/出版":     {"stage": "decline", "score": -0.55, "source": "mckinsey_wef",
                           "note": "广告市场持续萎缩，AI内容生成替代加速"},
    "房地产开发":        {"stage": "decline", "score": -0.65, "source": "china_policy",
                           "note": "调控政策+人口见顶，长期结构性萎缩"},
    "传统金融中介":      {"stage": "decline", "score": -0.40, "source": "openai_exposure",
                           "note": "AI替代文书/分析类岗位，中层岗位压缩"},
    "传统零售":          {"stage": "decline", "score": -0.45, "source": "mckinsey_wef",
                           "note": "电商+即时零售持续替代线下，管培岗缩量"},
}

# ── 专业→产业映射 ──────────────────────────────────────────────
# 格式：专业名 -> 所属产业（对应 INDUSTRY_SCURVE 的 key）
MAJOR_TO_INDUSTRY: dict[str, str] = {
    # 芯片/半导体
    "微电子科学与工程": "芯片/半导体",
    "集成电路设计与集成系统": "芯片/半导体",
    "光电信息科学与工程": "芯片/半导体",
    "电子科学与技术": "芯片/半导体",
    "材料科学与工程": "新材料",  # 半导体材料属新材料
    "新能源材料与器件": "碳中和/新能源",
    # AI/算法
    "人工智能": "AI/算法",
    "智能科学与技术": "AI/算法",
    "数据科学与大数据技术": "AI/算法",
    "计算机科学与技术": "AI/算法",
    "软件工程": "AI/算法",
    # 人形机器人/工业自动化
    "机器人工程": "人形机器人",
    "智能制造工程": "工业自动化",
    "自动化": "工业自动化",
    "机械设计制造及其自动化": "高端制造",
    "工业工程": "工业自动化",
    # 新能源汽车
    "车辆工程": "新能源汽车",
    "新能源汽车工程": "新能源汽车",
    # 核能
    "核工程与核技术": "核能/小堆",
    "核物理": "核能/小堆",
    "放射医学": "核能/小堆",
    # 海洋
    "海洋工程": "海洋工程",
    "海洋技术": "海洋工程",
    "船舶与海洋工程": "海洋工程",
    "水产养殖学": "海洋工程",
    # 国防军工
    "飞行器制造工程": "国防军工",
    "飞行器设计与工程": "国防军工",
    "弹药工程与爆炸技术": "国防军工",
    "探测制导与控制技术": "国防军工",
    "航海技术": "国防军工",
    # 碳中和/新能源
    "林学": "碳中和/新能源",
    "农业资源与环境": "碳中和/新能源",
    "地球物理学": "碳中和/新能源",
    "资源勘查工程": "碳中和/新能源",
    "石油工程": "碳中和/新能源",
    "矿物加工工程": "碳中和/新能源",
    # 生物医药
    "生物医学工程": "生物医药",
    "生物技术": "生物医药",
    "药学": "生物医药",
    "预防医学": "公共卫生",
    "卫生检验与检疫": "公共卫生",
    # 智慧农业
    "农业机械化及其自动化": "智慧农业",
    "农业工程": "智慧农业",
    # 新材料
    "高分子材料与工程": "新材料",
    "复合材料与工程": "新材料",
    "冶金工程": "新材料",
    "宝石及材料工艺学": "新材料",
    # 精密仪器
    "测控技术与仪器": "精密仪器",
    "仪器科学与技术": "精密仪器",
    "遥感科学与技术": "精密仪器",
    "地理信息科学": "精密仪器",
    # 高端制造
    "过程装备与控制工程": "高端制造",
    "化学工程与工艺": "高端制造",
    "矿业工程": "高端制造",
    "安全工程": "高端制造",
    # 衰退行业
    "新闻学": "传统媒体/出版",
    "广播电视学": "传统媒体/出版",
    "编辑出版学": "传统媒体/出版",
    "广告学": "传统媒体/出版",
    "房地产开发与管理": "房地产开发",
    "工程管理": "房地产开发",
    "金融学": "传统金融中介",
    "会计学": "传统金融中介",
    "财务管理": "传统金融中介",
    "市场营销": "传统零售",
    "电子商务": "传统零售",  # 注：电商本身仍有增长但岗位层次下移
}

# ── AI 职业暴露系数 ────────────────────────────────────────────
# 来源：OpenAI/Penn "GPTs are GPTs: An LLT Look at the Occupational Exposure"
# + 中国工信部 AI 岗位替代研究（2024）
# 系数：+1.0 = AI高度互补（受益）；-1.0 = AI高度替代（受冲击）
# 说明：此系数用于微调冷门分，不作为主信号
MAJOR_AI_COMPLEMENTARITY: dict[str, float] = {
    # 强受益（AI 是工具，人是主体）
    "机器人工程":            +1.0,
    "人工智能":              +1.0,
    "智能制造工程":          +0.95,
    "核工程与核技术":        +0.90,  # 核安全需要人类判断，AI辅助检测
    "生物医学工程":          +0.88,
    "材料科学与工程":        +0.85,
    "微电子科学与工程":      +0.85,
    "飞行器制造工程":        +0.82,
    "测控技术与仪器":        +0.80,
    "海洋工程":              +0.80,
    "地球物理学":            +0.78,
    "遥感科学与技术":        +0.78,
    "地理信息科学":          +0.75,
    "光电信息科学与工程":    +0.85,
    "农业机械化及其自动化":  +0.80,
    "预防医学":              +0.70,  # 流行病学建模受益
    "卫生检验与检疫":        +0.68,
    # 中性
    "工商管理":              +0.10,
    "汉语言文学":            +0.05,
    "历史学":                +0.05,
    "哲学":                  +0.15,
    "法学":                  -0.15,  # 合同/文书类受冲击，诉讼类相对安全
    # 受冲击（AI替代核心工作内容）
    "会计学":                -0.55,
    "财务管理":              -0.50,
    "新闻学":                -0.60,
    "广告学":                -0.55,
    "翻译":                  -0.70,
    "编辑出版学":            -0.65,
    "金融学":                -0.30,
    "市场营销":              -0.35,
    "人力资源管理":          -0.40,
    "行政管理":              -0.45,
    "房地产开发与管理":      -0.60,
}

# ── 已知委培关系表 ──────────────────────────────────────────────
# 来源：公开就业质量报告 + 院校招生简章 + 企业校园招聘公告
# 格式：(学校名称模式, 专业名称模式) -> {employer, tier, note}
# tier: guaranteed(定向就业)/tier1_tech(头部科技)/tier1_mfg(头部制造)/
#        tier1_soe(央企国企)/tier1_mil(军工涉密)/tier_public(编制/公务员)
KNOWN_ENTRUSTED_TRAINING: list[dict] = [
    # ── 制造业委培 ───────────────────────────────────────────────
    {
        "school_pattern":  "福耀科技大学",
        "major_pattern":   "",  # 所有专业
        "employer":        "福耀集团",
        "tier":            "tier1_mfg",
        "cooperation_note": "曹德旺捐资100亿，学费全免，全员定向福耀及供应链就业"
    },
    {
        "school_pattern":  "华为大学",
        "major_pattern":   "",
        "employer":        "华为",
        "tier":            "tier1_tech",
        "cooperation_note": "内部培训机构，面向在职员工，外部极少"
    },
    # ── 军工/国防委培 ────────────────────────────────────────────
    {
        "school_pattern":  "国防科技大学",
        "major_pattern":   "",
        "employer":        "解放军",
        "tier":            "tier1_mil",
        "cooperation_note": "直属中央军委，毕业定向军队岗位，编制保障"
    },
    {
        "school_pattern":  "解放军信息工程大学",
        "major_pattern":   "",
        "employer":        "解放军",
        "tier":            "tier1_mil",
        "cooperation_note": "军校定向"
    },
    {
        "school_pattern":  "海军工程大学",
        "major_pattern":   "",
        "employer":        "解放军海军",
        "tier":            "tier1_mil",
        "cooperation_note": "海军直属院校"
    },
    # ── 能源央企委培 ─────────────────────────────────────────────
    {
        "school_pattern":  "中国石油大学",
        "major_pattern":   "石油",
        "employer":        "中石油/中石化",
        "tier":            "tier1_soe",
        "cooperation_note": "石油工程专业与三桶油长期定向输送"
    },
    {
        "school_pattern":  "中国石油大学",
        "major_pattern":   "油气",
        "employer":        "中石油/中石化",
        "tier":            "tier1_soe",
        "cooperation_note": "油气专业定向央企"
    },
    {
        "school_pattern":  "中国矿业大学",
        "major_pattern":   "采矿",
        "employer":        "国家能源集团/中煤",
        "tier":            "tier1_soe",
        "cooperation_note": "采矿专业80%+进大型煤矿央企"
    },
    {
        "school_pattern":  "中国矿业大学",
        "major_pattern":   "安全",
        "employer":        "应急管理部/能源央企",
        "tier":            "tier1_soe",
        "cooperation_note": "安全工程监管岗位定向"
    },
    {
        "school_pattern":  "中国地质大学",
        "major_pattern":   "资源勘查",
        "employer":        "自然资源部/地质调查局",
        "tier":            "tier_public",
        "cooperation_note": "地勘专业60%+进自然资源系统"
    },
    # ── 海事/港航委培 ────────────────────────────────────────────
    {
        "school_pattern":  "大连海事大学",
        "major_pattern":   "航海",
        "employer":        "中远海运/招商轮船",
        "tier":            "tier1_soe",
        "cooperation_note": "航海技术定向航运央企，毕业薪资20万+"
    },
    {
        "school_pattern":  "上海海事大学",
        "major_pattern":   "航海",
        "employer":        "中远海运/上港集团",
        "tier":            "tier1_soe",
        "cooperation_note": "上港、中远定向合作"
    },
    # ── 核能委培 ─────────────────────────────────────────────────
    {
        "school_pattern":  "哈尔滨工程大学",
        "major_pattern":   "核",
        "employer":        "中核/中广核",
        "tier":            "tier1_soe",
        "cooperation_note": "核工程专业与中核集团长期定向"
    },
    {
        "school_pattern":  "南华大学",
        "major_pattern":   "核",
        "employer":        "中核/中广核",
        "tier":            "tier1_soe",
        "cooperation_note": "核工程特色校，与中核定向输送"
    },
    # ── 气象/水利委培 ────────────────────────────────────────────
    {
        "school_pattern":  "南京信息工程大学",
        "major_pattern":   "气象",
        "employer":        "中国气象局",
        "tier":            "tier_public",
        "cooperation_note": "全国最大气象人才培养基地，定向气象局系统"
    },
    {
        "school_pattern":  "南京信息工程大学",
        "major_pattern":   "大气",
        "employer":        "中国气象局",
        "tier":            "tier_public",
        "cooperation_note": "大气科学定向气象系统"
    },
    {
        "school_pattern":  "河海大学",
        "major_pattern":   "水利",
        "employer":        "水利部/地方水利局",
        "tier":            "tier_public",
        "cooperation_note": "水利专业进水利系统比例极高"
    },
    # ── 监狱/司法委培 ────────────────────────────────────────────
    {
        "school_pattern":  "中央司法警官学院",
        "major_pattern":   "",
        "employer":        "司法部/监狱系统",
        "tier":            "guaranteed",
        "cooperation_note": "毕业生直接进编制，就业率接近100%"
    },
    {
        "school_pattern":  "中国人民公安大学",
        "major_pattern":   "",
        "employer":        "公安系统",
        "tier":            "guaranteed",
        "cooperation_note": "公安类院校定向"
    },
]


def get_entrusted_training(school_name: str, major_name: str):
    """
    查找某学校+专业是否存在委培关系。
    返回委培信息 dict 或 None。
    """
    for entry in KNOWN_ENTRUSTED_TRAINING:
        s_match = entry["school_pattern"] in school_name if entry["school_pattern"] else True
        m_match = entry["major_pattern"] in major_name if entry["major_pattern"] else True
        if s_match and m_match:
            return entry
    return None


def get_industry_score(major_name: str) -> tuple[float, str, str]:
    """
    获取某专业的产业信号综合分。
    返回 (industry_score, industry_name, note)
    industry_score: -1.0 ~ +1.0
    """
    industry = MAJOR_TO_INDUSTRY.get(major_name)
    if not industry:
        return 0.0, "", ""
    info = INDUSTRY_SCURVE.get(industry, {})
    raw_score = info.get("score", 0.0)
    source = info.get("source", "mckinsey_wef")
    weight = VISION_SOURCE_WEIGHTS.get(source, 0.70)
    weighted = raw_score * weight
    return weighted, industry, info.get("note", "")


def get_ai_complementarity(major_name: str) -> float:
    """
    获取某专业的 AI 互补性系数。
    返回 -1.0 ~ +1.0，正值受益，负值受冲击。
    """
    return MAJOR_AI_COMPLEMENTARITY.get(major_name, 0.0)
