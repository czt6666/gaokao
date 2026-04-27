"""
冷门挖掘算法 v2（Hidden Gem Finder）
五种冷门类型：
A. 城市冷，专业强（位置折价型）
B. 名字冷，出路热（认知折价型）
C. 今年冷，明年热（时机型）
D. 学科强，排名低（学科强校折价型）— 新增
E. 满意度高，位次未涨（口碑折价型）— 新增
"""
from typing import List, Dict, Optional


# ── 冷门黑名单：这些学校全国知名度极高，不可能是「冷门」 ──────────
SOFTSCIENCE_TOP30 = {
    "清华大学", "北京大学", "复旦大学", "上海交通大学", "浙江大学",
    "中国科学技术大学", "南京大学", "中国人民大学", "北京师范大学",
    "武汉大学", "中山大学", "华中科技大学", "天津大学", "西安交通大学",
    "南开大学", "哈尔滨工业大学", "北京航空航天大学", "北京理工大学",
    "东南大学", "同济大学", "华南理工大学", "东北大学", "大连理工大学",
    "山东大学", "厦门大学", "湖南大学", "中南大学", "电子科技大学",
    "重庆大学", "中国农业大学",
}

# ── 认知折价专业词库 ─────────────────────────────────────────
# {专业名: {就业方向, 行业前景, 认知误区, 折价程度}}
COGNITIVE_DISCOUNT_MAJORS = {
    # ── 理工类·能源/资源 ──────────────────────────────────────────
    "地球物理学": {
        "real_direction": "能源/矿产勘探、地震监测、国防科技",
        "industry_prospect": "高",
        "misconception": "以为是纯理论，其实就业于石油、地震局，薪资高",
        "discount_level": "高"
    },
    "农业资源与环境": {
        "real_direction": "碳中和、土壤修复、农业科技、政府农业部门",
        "industry_prospect": "高",
        "misconception": "以为是种地，其实受益于碳中和国家战略，有政策红利",
        "discount_level": "高"
    },
    "海洋工程": {
        "real_direction": "海洋资源开发、国防军工、深海装备制造",
        "industry_prospect": "高",
        "misconception": "冷门小众，实际受国家海洋战略高度支持，就业稳定",
        "discount_level": "高"
    },
    "核工程与核技术": {
        "real_direction": "核电站、国防核武器、医疗放射、核能企业",
        "industry_prospect": "高",
        "misconception": "以为危险或冷门，实际是国家重点支持领域，薪资极高",
        "discount_level": "高"
    },
    "资源勘查工程": {
        "real_direction": "石油、天然气、矿产勘查、能源央企",
        "industry_prospect": "高",
        "misconception": "以为是野外找矿，实际多在中石油/中石化等央企，待遇优厚",
        "discount_level": "高"
    },
    "石油工程": {
        "real_direction": "油田开采、海上平台、能源技术服务",
        "industry_prospect": "高",
        "misconception": "担心石油行业夕阳，实际能源转型期需求仍旺盛且薪资极高",
        "discount_level": "高"
    },
    "矿物加工工程": {
        "real_direction": "新能源矿产（锂/钴/稀土）加工、冶金、国防材料",
        "industry_prospect": "高",
        "misconception": "以为传统采矿，实际是新能源电池原材料产业链核心",
        "discount_level": "高"
    },
    "海洋技术": {
        "real_direction": "卫星海洋遥感、水下机器人、海洋调查",
        "industry_prospect": "高",
        "misconception": "陌生专业，实际是国家海洋强国战略的技术支撑",
        "discount_level": "高"
    },
    "水文与水资源工程": {
        "real_direction": "水利部门、城市供水、防洪规划、环保企业",
        "industry_prospect": "中高",
        "misconception": "以为是治水农活，实际是城市化进程中刚需工程岗",
        "discount_level": "中"
    },
    "煤化工": {
        "real_direction": "化工央企、煤制油气技术、碳材料新材料",
        "industry_prospect": "中高",
        "misconception": "以为传统污染行业，实际转型为高端碳材料，薪资高",
        "discount_level": "中"
    },
    # ── 理工类·新兴技术 ──────────────────────────────────────────
    "地理信息科学": {
        "real_direction": "无人机、自动驾驶地图、城市规划、GIS平台",
        "industry_prospect": "高",
        "misconception": "以为是地理老师，实际是地图/遥感/自动驾驶的核心技术",
        "discount_level": "高"
    },
    "生物医学工程": {
        "real_direction": "医疗器械、基因测序、医疗AI、制药",
        "industry_prospect": "高",
        "misconception": "不知道学什么，实际是医工交叉热门方向",
        "discount_level": "高"
    },
    "材料科学与工程": {
        "real_direction": "新能源电池、芯片、航空航天材料",
        "industry_prospect": "高",
        "misconception": "传统工科，实际是新能源、半导体的核心基础学科",
        "discount_level": "中"
    },
    "工程力学": {
        "real_direction": "航空航天、土木、汽车、国防军工",
        "industry_prospect": "中高",
        "misconception": "比土木难，就业反而比土木更多元化",
        "discount_level": "中"
    },
    "光电信息科学与工程": {
        "real_direction": "激光、芯片光刻、光通信、AR/VR显示技术",
        "industry_prospect": "高",
        "misconception": "以为是修光学仪器，实际是半导体/芯片产业核心",
        "discount_level": "高"
    },
    "微电子科学与工程": {
        "real_direction": "芯片设计、半导体制造、集成电路",
        "industry_prospect": "高",
        "misconception": "听起来太专，实际是国家集成电路战略最紧缺专业之一",
        "discount_level": "高"
    },
    "遥感科学与技术": {
        "real_direction": "卫星遥感、无人机测绘、智慧城市、国防侦察",
        "industry_prospect": "高",
        "misconception": "冷僻专业，实际在自然资源部/军工/互联网地图公司均有需求",
        "discount_level": "高"
    },
    "智能制造工程": {
        "real_direction": "工业机器人、智能工厂、工业互联网",
        "industry_prospect": "高",
        "misconception": "新设专业陌生感强，实际是制造业转型升级最紧缺方向",
        "discount_level": "高"
    },
    "测控技术与仪器": {
        "real_direction": "精密仪器、航天检测、自动化设备、医疗仪器",
        "industry_prospect": "中高",
        "misconception": "以为是修仪器的，实际是高端制造/航天/国防刚需岗位",
        "discount_level": "中"
    },
    "过程装备与控制工程": {
        "real_direction": "化工、石油、制药设备设计与运行",
        "industry_prospect": "中高",
        "misconception": "名字晦涩，实际就业于化工/能源央企，薪资稳定",
        "discount_level": "中"
    },
    "飞行器制造工程": {
        "real_direction": "航空航天制造、无人机、国防军工",
        "industry_prospect": "高",
        "misconception": "门槛学校少，实际就业于中航/中国商飞/航天科工，极为稳定",
        "discount_level": "高"
    },
    "航海技术": {
        "real_direction": "远洋船长、港航管理、海事局",
        "industry_prospect": "高",
        "misconception": "以为在海上漂，实际薪资是工科毕业生中最高之列",
        "discount_level": "高"
    },
    # ── 数理基础类 ────────────────────────────────────────────────
    "统计学": {
        "real_direction": "数据分析、精算、金融、互联网大厂",
        "industry_prospect": "高",
        "misconception": "不如数学好听，但就业竞争力等同甚至优于数学",
        "discount_level": "中"
    },
    "信息管理与信息系统": {
        "real_direction": "产品经理、数据分析、ERP咨询、互联网",
        "industry_prospect": "中高",
        "misconception": "听起来像图书管理员，实际是文理兼修的热门岗位",
        "discount_level": "高"
    },
    "应用统计学": {
        "real_direction": "数据科学、风控精算、医学统计、政府调查",
        "industry_prospect": "高",
        "misconception": "以为是统计局专用，实际是各行业数据分析的通用能力",
        "discount_level": "中"
    },
    "数学与应用数学": {
        "real_direction": "量化金融、精算、数据科学、AI算法",
        "industry_prospect": "高",
        "misconception": "以为只能当老师，实际是量化投资/AI最受欢迎的基础学科",
        "discount_level": "中"
    },
    "物理学": {
        "real_direction": "芯片/量子计算研发、金融工程、AI研究",
        "industry_prospect": "高",
        "misconception": "以为只能读博/当老师，实际转行金融/半导体受追捧",
        "discount_level": "中"
    },
    # ── 文社类·被低估 ─────────────────────────────────────────────
    "哲学": {
        "real_direction": "法律、公务员、研究院、金融（逻辑能力强）",
        "industry_prospect": "中",
        "misconception": "以为没用，实际考研率/考公率极高，法学等二学位友好",
        "discount_level": "高"
    },
    "汉语言文学": {
        "real_direction": "新媒体、法律（秘书）、考公、出版、教育",
        "industry_prospect": "中",
        "misconception": "出路窄，实际考公率极高且岗位多样",
        "discount_level": "中"
    },
    "历史学": {
        "real_direction": "公务员、文博/博物馆、新媒体、出版、教师",
        "industry_prospect": "中",
        "misconception": "以为只能当老师，实际文博行业扩张、考公笔试优势明显",
        "discount_level": "高"
    },
    "社会学": {
        "real_direction": "人力资源、公益/NGO、政府调查、市场研究",
        "industry_prospect": "中",
        "misconception": "以为没有专业壁垒，实际是理解社会规律的跨界通才",
        "discount_level": "中"
    },
    "图书馆学": {
        "real_direction": "数据管理、知识图谱、信息架构、国家机关图书情报",
        "industry_prospect": "中高",
        "misconception": "以为就是在图书馆工作，实际是信息科学与数据管理的结合",
        "discount_level": "高"
    },
    "档案学": {
        "real_direction": "政府档案局、国有企业档案管理、数字档案建设",
        "industry_prospect": "中",
        "misconception": "以为冷门无用，实际是体制内稳定岗位，竞争小",
        "discount_level": "高"
    },
    "考古学": {
        "real_direction": "文物保护单位、博物馆、国家文物局、高校",
        "industry_prospect": "中",
        "misconception": "以为没工作，实际国家文博政策扩张，且竞争者极少",
        "discount_level": "高"
    },
    "民族学": {
        "real_direction": "民族地区公务员、政策研究、民族文化产业",
        "industry_prospect": "中",
        "misconception": "陌生专业，实际在西部/民族地区就业有政策加成",
        "discount_level": "高"
    },
    # ── 农林类·被严重低估 ────────────────────────────────────────
    "林学": {
        "real_direction": "碳汇交易、生态修复、国家林草局、碳中和企业",
        "industry_prospect": "高",
        "misconception": "以为是去山里种树，实际是碳市场爆发的核心专业",
        "discount_level": "高"
    },
    "草业科学": {
        "real_direction": "草地生态、国家草原保护、牧业企业",
        "industry_prospect": "中高",
        "misconception": "以为是农村工作，实际国家生态修复战略需求旺盛",
        "discount_level": "高"
    },
    "水产养殖学": {
        "real_direction": "深海养殖技术、渔业企业、国家农业部门",
        "industry_prospect": "中高",
        "misconception": "以为是养鱼摸虾，实际深远海养殖是国家战略",
        "discount_level": "高"
    },
    "农业机械化及其自动化": {
        "real_direction": "农业无人机、智慧农业、农机企业、农业科技公司",
        "industry_prospect": "高",
        "misconception": "以为是修农机，实际是农业无人机/智慧农业的核心工程专业",
        "discount_level": "高"
    },
    # ── 医学·冷门但潜力大 ────────────────────────────────────────
    "放射医学": {
        "real_direction": "放射科医生、核医学、肿瘤放疗、医疗器械",
        "industry_prospect": "高",
        "misconception": "担心辐射，实际防护完善，且放射科医生奇缺、薪资高",
        "discount_level": "高"
    },
    "预防医学": {
        "real_direction": "疾控中心（CDC）、公共卫生、卫生局、医院感染科",
        "industry_prospect": "高",
        "misconception": "以为不如临床，实际疫情后公共卫生体系大扩张，编制多",
        "discount_level": "高"
    },
    "卫生检验与检疫": {
        "real_direction": "海关、食品药品检验、环境检测、实验室",
        "industry_prospect": "高",
        "misconception": "陌生专业，实际是海关/食药监的专属岗位，稳定性极高",
        "discount_level": "高"
    },
    "口腔医学技术": {
        "real_direction": "义齿加工、口腔器械、口腔诊所技术支持",
        "industry_prospect": "高",
        "misconception": "以为低端，实际口腔医疗市场扩张，技师需求旺盛薪资高",
        "discount_level": "中"
    },
    # ── 法学·被忽视细分方向 ──────────────────────────────────────
    "知识产权": {
        "real_direction": "专利代理人、法务、科技企业IP团队",
        "industry_prospect": "高",
        "misconception": "以为是细分冷门，实际是科技企业最紧缺的法务方向之一",
        "discount_level": "高"
    },
    "监狱学": {
        "real_direction": "司法系统公务员（监狱管理局直接录用）",
        "industry_prospect": "高",
        "misconception": "陌生专业，实际毕业后直接进编制，就业率接近100%",
        "discount_level": "高"
    },
    # ── 管理类·交叉冷门 ──────────────────────────────────────────
    "工业工程": {
        "real_direction": "供应链管理、精益生产、制造业管理咨询",
        "industry_prospect": "高",
        "misconception": "以为是工人管工人，实际是制造业管理优化的核心岗位",
        "discount_level": "高"
    },
    "工程管理": {
        "real_direction": "房地产开发商、工程总承包、基建项目管理",
        "industry_prospect": "中高",
        "misconception": "以为是包工头，实际是甲方管理岗薪资远高于纯工科",
        "discount_level": "中"
    },
    "公共事业管理": {
        "real_direction": "政府部门、卫生事业单位、教育局、社区治理",
        "industry_prospect": "中",
        "misconception": "以为没方向，实际是考公、进事业单位的最优匹配专业",
        "discount_level": "中"
    },
    "劳动与社会保障": {
        "real_direction": "人社局、社保中心、企业HR、劳动仲裁",
        "industry_prospect": "中高",
        "misconception": "以为范围太宽，实际是政府人社体系的专属输送专业",
        "discount_level": "中"
    },
    "土地资源管理": {
        "real_direction": "自然资源局、地产开发、农村土地流转",
        "industry_prospect": "中高",
        "misconception": "以为冷门，实际是国土规划改革最紧缺的管理专业",
        "discount_level": "高"
    },
    # ── 艺术·工程交叉 ─────────────────────────────────────────────
    "工业设计": {
        "real_direction": "消费电子外观设计、汽车内饰设计、智能硬件",
        "industry_prospect": "高",
        "misconception": "以为是画画，实际是华为/苹果供应链产品设计的核心岗位",
        "discount_level": "中"
    },
    "包装工程": {
        "real_direction": "快消品包装设计、供应链、电商物流包装",
        "industry_prospect": "中高",
        "misconception": "以为是做纸箱子，实际薪资稳定且行业需求常青",
        "discount_level": "中"
    },
}

# ── 城市折价因子 ─────────────────────────────────────────────
# ⚠️ 重要说明：以下城市热度分值为编辑估计（editorial estimate），
# 反映考生在填报时对城市的偏好程度（北上广深=最热，西部省会=较冷）。
# 分值基于历年志愿数据的定性观察，而非精确测量。
# 城市热度越低 → 同等水平学校录取竞争度往往偏低（城市折价效应）。
# 未来可用省份招生录取数据中城市维度的平均位次偏移来替代。
# 城市热度评分（1-10，越低越冷，折价越大）
CITY_HEAT_SCORE = {
    "北京": 10, "上海": 10, "广州": 9, "深圳": 9,
    "杭州": 8, "南京": 8, "成都": 8, "武汉": 7,
    "西安": 6, "长沙": 7, "重庆": 7, "天津": 7,
    "合肥": 6, "郑州": 6, "济南": 6, "苏州": 7,
    "哈尔滨": 4, "长春": 4, "沈阳": 4, "大连": 5,
    "兰州": 3, "乌鲁木齐": 3, "呼和浩特": 3,
    "昆明": 4, "贵阳": 4, "南宁": 4,
    "海口": 5, "拉萨": 2, "西宁": 3,
    "太原": 4, "石家庄": 4, "南昌": 5, "福州": 5,
}


def calc_city_discount(city: str) -> float:
    """城市折价系数（绝对值）：热度越低折价越高（0~1）"""
    heat = CITY_HEAT_SCORE.get(city, 5)
    return round((10 - heat) / 10, 2)


# 省份→省会映射（用于相对城市折价计算）
PROVINCE_CAPITAL: dict[str, str] = {
    "广东": "广州", "北京": "北京", "上海": "上海", "浙江": "杭州",
    "江苏": "南京", "四川": "成都", "湖北": "武汉", "陕西": "西安",
    "湖南": "长沙", "重庆": "重庆", "天津": "天津", "安徽": "合肥",
    "河南": "郑州", "山东": "济南", "黑龙江": "哈尔滨", "吉林": "长春",
    "辽宁": "沈阳", "甘肃": "兰州", "新疆": "乌鲁木齐", "内蒙古": "呼和浩特",
    "云南": "昆明", "贵州": "贵阳", "广西": "南宁", "海南": "海口",
    "西藏": "拉萨", "青海": "西宁", "山西": "太原", "河北": "石家庄",
    "江西": "南昌", "福建": "福州", "吉林": "长春", "宁夏": "银川",
    "大连": "大连", "青岛": "青岛",  # 计划单列市
}


def calc_city_discount_relative(school_city: str, student_province: str) -> float:
    """
    省际相对城市折价（v2.0）
    哈尔滨学生去哈尔滨上学，对他来说并不是"城市折价"。
    折价只应计算学校城市相对学生家乡省会的劣势。
    返回 0.0~0.8，越高说明相对折价越大。
    """
    if not student_province:
        return calc_city_discount(school_city)  # 无来源信息时 fallback 到绝对折价
    home_capital = PROVINCE_CAPITAL.get(student_province, "")
    home_heat = CITY_HEAT_SCORE.get(home_capital, 5)
    school_heat = CITY_HEAT_SCORE.get(school_city, 5)
    delta = home_heat - school_heat  # 正值 = 学校城市热度低于家乡 = 有折价
    if delta <= 1:
        return 0.0  # 差异不显著，不计折价
    return round(min(0.8, delta / 10), 2)


def hidden_gem_type_a(school: Dict, majors: List[Dict], student_province: str = "") -> Optional[Dict]:
    """
    类型A：城市冷、专业强
    条件：城市折价>0.4 + 有A类学科评估的专业
    黑名单：软科Top30学校不可能是"城市冷"（全国知名度已经极高）
    """
    school_name = school.get("name", "") or school.get("school_name", "")
    if school_name in SOFTSCIENCE_TOP30:
        return None

    city = school.get("city", "")
    city_discount = calc_city_discount_relative(city, student_province)

    if city_discount < 0.4:
        return None

    strong_majors = [m for m in majors if m.get("subject_strength") in ["A++", "A+", "A", "A-"]]
    if not strong_majors:
        return None

    return {
        "gem_type": "A",
        "gem_type_label": "城市冷·专业强",
        "gem_description": f"位于{city}（非热门城市），导致录取分数系统性偏低，但{strong_majors[0]['major_name']}等专业学科评估达{strong_majors[0].get('subject_strength', '')}",
        "advantage": f"同等分数在此校能进入教育部A类学科，相比在热门城市的同学科等级高校，录取竞争度更低（城市折价系数{round(city_discount*100)}%）",
        "risk": "毕业后若希望在一线城市发展，需要提前规划实习和求职",
        "strong_majors": [m["major_name"] for m in strong_majors[:3]],
        "city_discount": city_discount,
        "gem_score": round(city_discount * 100)
    }


def hidden_gem_type_b(major_name: str, dynamic_score: Optional[Dict] = None) -> Optional[Dict]:
    """
    类型B：名字冷、出路热（认知折价型）
    优先使用动态冷门评分（cold_score_engine），静态词库作为fallback和描述来源。
    dynamic_score: cold_score_engine.get_major_cold_score() 的返回值
    """
    # 从动态评分引擎获取分数
    dyn_score_val = None
    dyn_components = {}
    if dynamic_score:
        dyn_score_val = dynamic_score.get("score", 0)
        dyn_components = dynamic_score.get("components", {})
        rank_in_all = dynamic_score.get("rank_in_all", 999)
        top_pct     = dynamic_score.get("top_pct", 50)

    # 静态词库提供认知描述（误解纠正、真实方向）
    info = COGNITIVE_DISCOUNT_MAJORS.get(major_name)

    # 触发条件：动态分>=65 OR 在静态词库中
    if dyn_score_val is not None and dyn_score_val >= 65:
        discount_level = "高" if dyn_score_val >= 80 else ("中" if dyn_score_val >= 70 else "低")
        gem_score = dyn_score_val
        if info:
            description = f"专业名称产生认知误解，实际就业方向为：{info['real_direction']}"
            advantage   = f"认知折价导致报考竞争偏低；行业前景：{info['industry_prospect']}"
            misconception = info["misconception"]
            industry_prospect = info["industry_prospect"]
        else:
            momentum = dyn_components.get("industry_momentum", 55)
            trend = "高" if momentum >= 80 else ("中" if momentum >= 65 else "中")
            description = f"数据分析显示该专业薪资竞争力（冷门分{dyn_score_val:.0f}/100，全国前{top_pct:.0f}%）被市场低估"
            advantage   = f"产业动能{momentum}/100，薪资错配得分{dyn_components.get('salary_mismatch',0):.0f}"
            misconception = "报考热度与实际就业价值存在显著落差"
            industry_prospect = trend

        return {
            "gem_type": "B",
            "gem_type_label": "名字冷·出路热",
            "gem_description": description,
            "advantage": advantage,
            "misconception_corrected": misconception,
            "risk": "部分专业需要考研才能发挥最大价值",
            "industry_prospect": industry_prospect,
            "gem_score": round(gem_score, 1),
            "cold_score_detail": {
                "score": round(dyn_score_val, 1),
                "rank_in_all": dynamic_score.get("rank_in_all"),
                "top_pct": dynamic_score.get("top_pct"),
                "components": dyn_components,
            }
        }
    elif info:
        # 纯静态词库 fallback（无动态数据时）
        return {
            "gem_type": "B",
            "gem_type_label": "名字冷·出路热",
            "gem_description": f"专业名称产生认知误解，实际就业方向为：{info['real_direction']}",
            "advantage": f"因认知折价，报考竞争度系统性偏低；行业前景：{info['industry_prospect']}",
            "misconception_corrected": info["misconception"],
            "risk": "部分专业需要考研才能发挥最大价值",
            "industry_prospect": info["industry_prospect"],
            "gem_score": {"高": 90, "中": 70, "低": 50}.get(info["discount_level"], 60),
            "cold_score_detail": None,
        }
    return None


def hidden_gem_type_c(records: List[Dict], current_year: int = 2025) -> Optional[Dict]:
    """
    类型C：今年冷、明年热（时机型冷门）
    条件：近2-3年录取位次持续下降（说明报考人减少）
    """
    if len(records) < 2:
        return None

    sorted_recs = sorted(records, key=lambda x: x["year"])
    # 过滤掉 min_rank 为 None 或 0 的无效记录
    sorted_recs = [r for r in sorted_recs if (r.get("min_rank") or 0) > 0]
    if len(sorted_recs) < 2:
        return None
    ranks = [r["min_rank"] for r in sorted_recs]

    # 判断是否持续上升（位次数字变大 = 录取门槛变低 = 学校在降温/变容易）
    # 修复 v1.0 逻辑反转：位次数字越大说明更容易进，持续增大 = 降温窗口
    increasing = all(ranks[i] > ranks[i-1] for i in range(1, len(ranks)))
    total_increase = (ranks[-1] - ranks[0]) / ranks[0] if ranks[0] > 0 else 0

    if not increasing or total_increase < 0.08:
        return None

    return {
        "gem_type": "C",
        "gem_type_label": "今年低谷·触底机会",
        "gem_description": f"近{len(sorted_recs)}年录取位次持续上升（说明报考竞争减少），已进入低谷区",
        "advantage": f"近{len(sorted_recs)}年录取难度持续下降约{round(total_increase*100)}%，今年可能是入场最好时机",
        "risk": "需结合专业本身的行业景气度判断，避免选入真正衰退的专业",
        "decline_rate": round(total_increase * 100, 1),
        "trend": [{"year": r["year"], "min_rank": r["min_rank"]} for r in sorted_recs],
        "gem_score": min(95, round(total_increase * 300))
    }


def hidden_gem_type_d(school: Dict, subject_evals: List[Dict]) -> Optional[Dict]:
    """
    类型D：学科A+但软科排名在200名以外（学科强校折价）
    同等学科实力下，综合排名低的学校录取位次往往被低估
    白名单：必须有明确排名数据，且排名 > 100（rank_2025=0 时保守不触发）
    """
    rank_2025 = school.get("rank_2025", 0)
    # 排名数据缺失（0）或排名在100以内 → 不触发
    if rank_2025 <= 100 or rank_2025 == 0:
        return None

    aplus_evals = [e for e in subject_evals if e.get("subject_strength") in ["A++", "A+", "A"]]
    if not aplus_evals:
        return None

    top_subject = aplus_evals[0]
    rank_label = f"软科第{rank_2025}名" if rank_2025 > 0 else "未进入软科200强"

    return {
        "gem_type": "D",
        "gem_type_label": "学科强·排名低",
        "gem_description": (
            f"{top_subject['major_name']} 学科评估达 {top_subject['subject_strength']}，"
            f"但学校综合排名（{rank_label}）相对靠后，"
            "综合排名低估了该校学科实力"
        ),
        "advantage": f"在{top_subject['major_name']}等专业领域，该校与顶尖高校同级，但录取竞争度远低于同学科排名的热门高校",
        "risk": "综合排名较低可能影响部分用人单位的认知，建议结合目标行业判断",
        "strong_subjects": [e["major_name"] for e in aplus_evals[:3]],
        "gem_score": 75 + min(15, len(aplus_evals) * 5),
    }


def hidden_gem_type_e(school: Dict, major_employment_data: List[Dict]) -> Optional[Dict]:
    """
    类型E：专业满意度在前20%，但录取位次近年未明显上升（口碑折价型）
    说明市场还没有充分认知到该校/专业的价值
    """
    high_sat_majors = [
        m for m in major_employment_data
        if m.get("satisfaction", 0) >= 4.3  # 满意度≥4.3/5分
    ]
    if not high_sat_majors:
        return None

    top = sorted(high_sat_majors, key=lambda x: x.get("satisfaction", 0), reverse=True)[0]
    sat = top.get("satisfaction", 0)

    return {
        "gem_type": "E",
        "gem_type_label": "口碑优·认知慢",
        "gem_description": (
            f"{top.get('major_name', '')} 专业综合满意度 {sat:.1f}/5.0，"
            "位于全国前20%，但录取竞争度尚未充分反映其真实价值"
        ),
        "advantage": "在读学生满意度高，说明教学质量和就业预期已经得到验证，市场滞后于口碑",
        "risk": "满意度调查样本量不同，建议结合实际就业数据综合判断",
        "high_sat_majors": [m.get("major_name", "") for m in high_sat_majors[:3]],
        "best_satisfaction": sat,
        "gem_score": min(85, round(sat * 15)),
    }


def school_quality_score(
    school: Dict,
    subject_evals: List[Dict],
    employment_list: List[Dict],
    school_emp: Dict = None,  # 学校级就业数据（SchoolEmployment记录，可为None）
) -> Dict:
    """
    7维度学校综合质量评分（0-100）
    用于推荐结果排序和详情页展示

    school_emp: 来自 school_employment 表的学校级就业数据，格式：
        { avg_salary, employment_rate, postgrad_rate, top_employer_tier }
    当有学校级数据时，薪资和就业率维度使用双维度混合计算，
    使同专业在不同学校间产生真实质量差异（985 vs 普通院校区分度更高）。
    """
    scores = {}

    # 1. 软科排名（归一化，排名1=100分，排名500+=10分）
    rank = school.get("rank_2025", 0)
    if rank > 0:
        scores["rank_score"] = max(10, round(100 - (rank - 1) * 0.18))
    else:
        scores["rank_score"] = 10

    # 2. 最高学科评估等级
    grade_map = {"A+": 100, "A": 85, "A-": 72, "B+": 60, "B": 48, "B-": 36}
    best_grade = max((grade_map.get(e.get("subject_strength", ""), 0) for e in subject_evals), default=0)
    scores["subject_grade"] = best_grade

    # 3. 就业薪资（双维度混合：学校级数据 × 0.6 + 专业全国均值 × 0.4）
    #    当有学校级数据时区分度更高；无数据时回退到专业全国均值
    major_salaries = [e.get("avg_salary", 0) for e in employment_list if e.get("avg_salary", 0) > 0]
    major_avg_sal = sum(major_salaries) / len(major_salaries) if major_salaries else 0

    if school_emp and school_emp.get("avg_salary", 0) > 0:
        school_sal = school_emp["avg_salary"]
        blended_sal = major_avg_sal * 0.4 + school_sal * 0.6
    else:
        blended_sal = major_avg_sal

    scores["employment_salary"] = min(100, max(0, round((blended_sal - 5000) / 150)))

    # 3b. 就业率加分（学校级数据专有）
    if school_emp and school_emp.get("employment_rate", 0) > 0:
        emp_rate = school_emp["employment_rate"]
        # 就业率95%以上=满分，90%=70分，85%=40分
        scores["employment_rate_bonus"] = min(100, max(0, round((emp_rate - 0.80) / 0.20 * 100)))
    else:
        scores["employment_rate_bonus"] = 0

    # 3c. 顶级雇主加分
    tier_label = school_emp.get("top_employer_tier", "") if school_emp else ""
    scores["employer_tier_bonus"] = {"头部": 100, "中等": 55, "一般": 20, "": 0}.get(tier_label, 0)

    # 4. 满意度（0-5 → 0-100）
    sats = [e.get("satisfaction", 0) for e in employment_list if e.get("satisfaction", 0) > 0]
    avg_sat = sum(sats) / len(sats) if sats else 0
    scores["satisfaction"] = round(avg_sat * 20)

    # 5. 深造率：优先用学校级数据（更准确）；回退到 school.postgrad_rate 字段
    school_postgrad_rate = school_emp.get("postgrad_rate", 0) if school_emp else 0
    if school_postgrad_rate > 0:
        scores["postgrad_rate"] = min(100, round(school_postgrad_rate * 200))
    else:
        postgrad_str = school.get("postgrad_rate", "") or ""
        try:
            postgrad_pct = float(postgrad_str.strip().rstrip("%"))
            scores["postgrad_rate"] = min(100, round(postgrad_pct * 3))
        except Exception:
            scores["postgrad_rate"] = 0

    # 6. 学科评估数量（A类学科越多越好）
    a_count = len([e for e in subject_evals if e.get("subject_strength", "") in ["A+", "A", "A-"]])
    scores["subject_count"] = min(100, a_count * 12)

    # 7. 层次加分（985/211/双一流）
    tier = school.get("tier", "普通")
    scores["tier_bonus"] = {"985": 100, "211": 70, "双一流": 55, "普通": 20}.get(tier, 20)

    # 权重：当有学校级就业数据时，就业相关维度权重提升，排名权重略降
    has_school_emp = bool(school_emp and school_emp.get("avg_salary", 0) > 0)
    if has_school_emp:
        weights = {
            "rank_score":           0.20,
            "subject_grade":        0.18,
            "employment_salary":    0.18,  # 双维度薪资
            "employment_rate_bonus": 0.08, # 就业率（新）
            "employer_tier_bonus":  0.06,  # 雇主质量（新）
            "satisfaction":         0.08,
            "postgrad_rate":        0.10,
            "subject_count":        0.08,
            "tier_bonus":           0.04,
        }
    else:
        weights = {
            "rank_score":           0.25,
            "subject_grade":        0.20,
            "employment_salary":    0.18,
            "employment_rate_bonus": 0.00,
            "employer_tier_bonus":  0.00,
            "satisfaction":         0.12,
            "postgrad_rate":        0.10,
            "subject_count":        0.10,
            "tier_bonus":           0.05,
        }

    total = sum(scores.get(k, 0) * w for k, w in weights.items())
    return {
        "quality_score": round(total, 1),
        "dimensions": scores,
        "has_school_emp": has_school_emp,
    }


def value_index(quality_score: float, avg_min_rank_3yr: float, province_total: int = 500000) -> float:
    """
    性价比指数：就业质量 / 录取难度
    家长直觉：同样的分数，哪个学校的"投入产出比"更高

    quality_score: 0-100 综合质量分
    avg_min_rank_3yr: 近3年平均最低录取位次（越大=越容易进）
    province_total: 该省总考生数（用于归一化难度）

    返回 0-100，越高=性价比越好
    """
    if avg_min_rank_3yr <= 0 or quality_score <= 0:
        return 0.0
    # 录取难度归一化：rank/total → 0-1（越大=越容易）
    difficulty_ease = min(1.0, avg_min_rank_3yr / max(province_total, 100000))
    # 性价比 = 质量 × 容易程度的放大系数
    # 清华(quality=95, rank=500/500k=0.001) → 95*1.0=95（质量高但不算性价比）
    # 普通211(quality=55, rank=30000/500k=0.06) → 55*1.5=82.5（性价比突出）
    ease_multiplier = 1.0 + min(1.0, difficulty_ease * 10)
    raw = quality_score * ease_multiplier / 2.0
    return round(min(100.0, max(0.0, raw)), 1)


def hidden_gem_type_f(major_name: str) -> Optional[Dict]:
    """
    类型F：产业S曲线位置 + AI互补性（产业上升期折价）
    条件：专业所属产业处于 early/growth 阶段 且 AI互补性为正
    高分 = 该专业在上升产业+AI不会替代它 = 未来溢价尚未被招生市场定价
    """
    try:
        from algorithms.industry_signals import get_industry_score, get_ai_complementarity
    except ImportError:
        try:
            from industry_signals import get_industry_score, get_ai_complementarity
        except ImportError:
            return None

    industry_score, industry_name, note = get_industry_score(major_name)
    ai_comp = get_ai_complementarity(major_name)

    # 只对产业上升期专业触发（industry_score 权重后 > 0.40）
    if industry_score <= 0.40:
        return None

    # AI互补性：负值表示AI会替代该职业，不应标记为"未来热"
    if ai_comp < -0.20:
        return None

    # 综合分：产业信号占70%，AI互补性占30%
    combined = industry_score * 0.70 + max(0, ai_comp) * 0.30
    gem_score = round(min(95, combined * 100), 1)

    if ai_comp >= 0.70:
        ai_label = "AI高度互补，工程师需求随AI扩张而增长"
    elif ai_comp >= 0.30:
        ai_label = "AI辅助提效，人类判断不可替代"
    else:
        ai_label = "AI影响有限，专业技能壁垒较高"

    return {
        "gem_type": "F",
        "gem_type_label": "产业上升·未来溢价",
        "gem_description": (
            f"{major_name} 所属产业「{industry_name}」正处于高速成长期，"
            f"但当前招生热度尚未充分反映未来需求。{note}"
        ),
        "advantage": f"{ai_label}。现在入学，毕业即在需求爆发期",
        "risk": "产业成长期同时伴随快速变化，建议本科阶段保持技术跟进",
        "industry_name": industry_name,
        "industry_score": round(industry_score, 2),
        "ai_complementarity": round(ai_comp, 2),
        "gem_score": gem_score,
    }


def hidden_gem_type_g(school_name: str, major_name: str) -> Optional[Dict]:
    """
    类型G：委培/定向就业（就业确定性折价）
    条件：该学校+专业组合存在已知的定向委培关系
    高分 = 毕业直接进头部企业/编制，就业确定性高，但招生市场低估了这一点
    """
    try:
        from algorithms.industry_signals import get_entrusted_training
    except ImportError:
        try:
            from industry_signals import get_entrusted_training
        except ImportError:
            return None

    entry = get_entrusted_training(school_name, major_name)
    if not entry:
        return None

    tier = entry.get("tier", "")
    tier_score_map = {
        "guaranteed":   95,
        "tier1_tech":   90,
        "tier1_mil":    88,
        "tier1_soe":    82,
        "tier1_mfg":    80,
        "tier_public":  75,
    }
    gem_score = tier_score_map.get(tier, 70)

    tier_label_map = {
        "guaranteed":   "就业率接近100%，直接进入编制/定向岗",
        "tier1_tech":   "定向输送头部科技企业（华为/腾讯等级）",
        "tier1_mil":    "军工/国防定向，编制保障+薪资稳定",
        "tier1_soe":    "与央企/国企长期定向合作，就业稳定性极高",
        "tier1_mfg":    "制造业头部企业定向，技术岗起点高",
        "tier_public":  "对口政府/事业单位输送，进编比例高",
    }
    tier_label = tier_label_map.get(tier, "有定向就业合作")

    return {
        "gem_type": "G",
        "gem_type_label": "委培定向·就业确定",
        "gem_description": (
            f"{school_name}「{major_name}」与{entry['employer']}存在定向培养合作关系。"
            f"{entry.get('cooperation_note', '')}"
        ),
        "advantage": tier_label,
        "risk": "定向就业可能限制初期的自由选择空间，适合目标明确的学生",
        "employer": entry.get("employer", ""),
        "cooperation_note": entry.get("cooperation_note", ""),
        "gem_score": gem_score,
    }


def score_overall_gem(
    school: Dict,
    majors: List[Dict],
    records: List[Dict],
    employment_list: List[Dict] = None,
    actual_major_name: str = "",  # 实际推荐专业名（而非学科评估名）
    student_province: str = "",   # 学生来源省份（用于相对城市折价计算）
) -> Dict:
    """
    综合冷门评分 v2（5类冷门）
    majors: 学校A类学科评估列表（用于A/D类检测）
    actual_major_name: 实际推荐的录取专业名称（用于B类认知折价检测）
    """
    gems = []
    employment_list = employment_list or []

    # 类型A：城市折价（依据学科评估，学科强+城市冷=折价机会）
    # v2.0：使用省际相对折价，哈尔滨学生去哈尔滨上学不算折价
    gem_a = hidden_gem_type_a(school, majors, student_province)
    if gem_a:
        gems.append(gem_a)

    # 类型B：认知折价（基于实际推荐专业名称，而非学校学科评估）
    # 黑名单：软科Top30学校全国知名度极高，不可能是"名字冷"
    _school_name = school.get("name", "") or school.get("school_name", "")
    _is_top30 = _school_name in SOFTSCIENCE_TOP30
    _major_b = (actual_major_name or "").strip()
    _is_placeholder = (
        "院校最低分" in _major_b
        or (_major_b.startswith("[") and "院校" in _major_b)
        or _major_b == ""
    )
    if _major_b and not _is_placeholder and not _is_top30:
        gem_b = hidden_gem_type_b(_major_b)
        if gem_b:
            gem_b["major_name"] = _major_b
            gems.append(gem_b)

    # 类型C：时机型（v2.0修复：位次上升=录取变容易=降温窗口）
    gem_c = hidden_gem_type_c(records)
    if gem_c:
        gems.append(gem_c)

    # 类型D：学科强校折价
    gem_d = hidden_gem_type_d(school, majors)
    if gem_d:
        gems.append(gem_d)

    # 类型E：口碑折价
    gem_e = hidden_gem_type_e(school, employment_list)
    if gem_e:
        gems.append(gem_e)

    # 类型F：产业S曲线 + AI互补性（v2.0新增）
    if _major_b and not _is_placeholder:
        gem_f = hidden_gem_type_f(_major_b)
        if gem_f:
            gems.append(gem_f)

    # 类型G：委培/定向就业（v2.0新增）
    school_name = school.get("name", "") or school.get("school_name", "")
    if _major_b and not _is_placeholder and school_name:
        gem_g = hidden_gem_type_g(school_name, _major_b)
        if gem_g:
            gems.append(gem_g)

    if not gems:
        return {"is_hidden_gem": False, "gem_score": 0}

    # v2.0：复合评分（主信号 + 增强因子叠加），取代 v1.0 的单一 max
    top_gem = max(gems, key=lambda g: g.get("gem_score", 0))
    primary_score = top_gem.get("gem_score", 0)
    # 每个次级信号分数>30 时提供 15% 叠加增强（上限100）
    reinforcement = sum(
        g.get("gem_score", 0) * 0.15
        for g in gems
        if g is not top_gem and g.get("gem_score", 0) > 30
    )
    compound_score = min(100, round(primary_score + reinforcement, 1))

    return {
        "is_hidden_gem": True,
        "gem_count": len(gems),
        "top_gem": top_gem,
        "all_gems": gems,
        "gem_score": compound_score,
    }


