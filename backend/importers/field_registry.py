"""规范字段注册表。

各省 Excel 列集不同（56~84 列、表头在第2或第3行、字段名有别名），
这里用「规范字段」统一描述：每个字段声明它在各省可能出现的所有表头别名。
column_mapper 据此把任意一省的「列号」对应到「规范字段」。

两类字段：
  PLAN_FIELDS    —— 2026 招生计划 + 院校信息 + 专业信息，写入 admission_2026 表。
  HISTORY_FIELDS —— 历年录取块（录取人数/最低分/最低位次…），回填 admission_records。
                    历年块按「基名 + 序号」出现（最低分1/最低分2…），少数省份表头重名
                    （吉林/宁夏/河北 出现 3 个裸「最低分」），由 column_mapper 按位置兜底分块。
"""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Field:
    key: str                    # admission_2026 的列名（规范名）
    aliases: tuple              # 各省表头里可能出现的写法
    type: str = "str"           # "str" | "int"
    comment: str = ""           # 数据字典里的中文说明


# ── 2026 计划 / 院校信息 / 专业信息（写入 admission_2026）──────────────────────
PLAN_FIELDS = [
    # 招生计划带
    Field("id_src",          ("ID",),                       "str", "源表行ID（部分省份有）"),
    Field("plan_year",       ("年份",),                     "int", "招生年份（2026）"),
    Field("province",        ("生源地",),                   "str", "考生生源地省份（数据归属省）"),
    Field("batch",           ("批次",),                     "str", "录取批次"),
    Field("category",        ("科类",),                     "str", "科类（综合/物理/历史等）"),
    Field("plan_category",   ("计划类别",),                 "str", "计划类别（部分省份）"),
    Field("school_code",     ("院校代码",),                 "str", "院校招生代码（省内代码，跨省不通用）"),
    Field("school_name",     ("院校名称",),                 "str", "院校名称（跨表关联主键）"),
    Field("group_full_code", ("院校专业组代码",),           "str", "院校专业组完整代码"),
    Field("group_code",      ("专业组代码",),               "str", "专业组代码"),
    Field("group_name",      ("专业组名称",),               "str", "专业组名称"),
    Field("major_code",      ("专业代码",),                 "str", "专业代码"),
    Field("major_full",      ("专业全称",),                 "str", "专业全称（含备注）"),
    Field("major_name",      ("专业名称",),                 "str", "专业名称（跨表关联主键）"),
    Field("major_remark",    ("专业备注",),                 "str", "专业备注（方向/办学地点等）"),
    Field("foreign_lang",    ("外语要求", "外语语种"),      "str", "外语语种要求"),
    Field("major_level",     ("专业层次",),                 "str", "本科/专科"),
    Field("subject_req",     ("选科要求",),                 "str", "2026选科要求"),
    Field("subject_req_25",  ("25选科要求",),               "str", "2025选科要求（个别省份）"),
    Field("duration",        ("学制",),                     "str", "学制"),
    Field("tuition",         ("学费",),                     "str", "学费（含'待定'，故存文本）"),
    Field("plan_count",      ("计划人数",),                 "int", "2026计划招生人数"),
    Field("group_majors",    ("组内专业",),                 "str", "专业组内全部专业摘要"),
    Field("group_plan",      ("专业组计划人数",),           "int", "专业组计划总人数"),
    Field("group_major_num", ("组内专业数",),               "int", "组内专业数量"),
    Field("group_purity",    ("专业组干净度",),             "str", "专业组干净度指标"),
    Field("discipline",      ("门类",),                     "str", "学科门类"),
    Field("major_class",     ("专业类",),                   "str", "专业类"),
    Field("est_rank_26",     ("26年预估位次",),             "int", "2026预估录取位次"),
    Field("is_new",          ("是否新增",),                 "str", "是否2026新增专业"),
    # 专业组 2025 数据
    Field("group_admit_2025",     ("专业组录取人数1", "专业组录取人数"), "int", "2025专业组录取人数"),
    Field("group_min_score_2025", ("专业组最低分1", "专业组最低分"),     "int", "2025专业组最低分"),
    Field("group_min_rank_2025",  ("专业组最低位次1", "专业组最低位次"), "int", "2025专业组最低位次"),
    # 院校基础信息
    Field("school_province", ("所在省",),                   "str", "院校所在省"),
    Field("city",            ("城市",),                     "str", "院校所在城市"),
    Field("city_level",      ("城市水平标签",),             "str", "城市层级（一线/新一线…）"),
    Field("school_tags",     ("院校标签",),                 "str", "院校标签（985/211/双一流…）"),
    Field("school_level",    ("院校水平",),                 "str", "院校水平"),
    Field("rename_merge",    ("更名合并转设",),             "str", "更名/合并/转设历史"),
    Field("admin_dept",      ("隶属单位",),                 "str", "主管/隶属单位"),
    Field("school_type",     ("类型",),                     "str", "院校类型（综合/理工…）"),
    Field("nature",          ("公私性质",),                 "str", "公办/民办"),
    Field("ben_zhuan",       ("本科/专科",),                "str", "本科/专科"),
    Field("postgrad_rate",   ("保研率",),                   "str", "保研率"),
    Field("school_rank",     ("院校排名",),                 "str", "院校排名"),
    Field("transfer_policy", ("转专业情况",),               "str", "转专业政策"),
    Field("master_num",      ("全校硕士专业数",),           "int", "全校硕士点数"),
    Field("master_list",     ("全校硕士专业",),             "str", "全校硕士专业列表"),
    Field("phd_num",         ("全校博士专业数",),           "int", "全校博士点数"),
    Field("phd_list",        ("全校博士专业",),             "str", "全校博士专业列表"),
    Field("admit_rule",      ("录取规则",),                 "str", "录取规则"),
    Field("zhangcheng",      ("招生章程",),                 "str", "招生章程链接"),
    Field("admit_unit",      ("招生单位",),                 "str", "招生单位（个别省份）"),
    Field("other_remark",    ("其他备注",),                 "str", "其他备注（个别省份）"),
    # 专业基础信息
    Field("ruanke_grade",    ("软科评级",),                 "str", "软科专业评级"),
    Field("ruanke_rank",     ("软科排名",),                 "str", "软科专业排名"),
    Field("discipline_eval", ("学科评估",),                 "str", "教育部学科评估等级"),
    Field("major_level_tag", ("专业水平",),                 "str", "专业水平标签"),
    Field("major_master",    ("本专业硕士点",),             "str", "本专业硕士点"),
    Field("major_phd",       ("本专业博士点",),             "str", "本专业博士点"),
]

# ── 历年录取块字段（基名；实际表头为 基名+序号 或 重名）─────────────────────
# key 即在 admission_records 中的列名；None 表示该统计在现有表无对应列、丢弃。
HISTORY_FIELDS = [
    Field("admit_count", ("录取人数",), "int", "该年录取人数"),
    Field("min_score",   ("最低分",),   "int", "该年最低分"),
    Field("min_rank",    ("最低位次",), "int", "该年最低位次"),
    Field("_avg_score",  ("平均分",),   "int", "该年平均分（现表无列，丢弃）"),
    Field("_avg_rank",   ("平均位次",), "int", "该年平均位次（现表无列，丢弃）"),
    Field("_max_score",  ("最高分",),   "int", "该年最高分（现表无列，丢弃）"),
    Field("_max_rank",   ("最高位次",), "int", "该年最高位次（现表无列，丢弃）"),
    Field("_old_batch",  ("老批次",),   "str", "该年所属老批次（丢弃）"),
    Field("_plan_result",("计划人数结果",), "int", "该年计划结果（丢弃）"),
]

# 历年块基名集合（用于 column_mapper 识别哪些列属于历年块）
HISTORY_BASENAMES = {a for f in HISTORY_FIELDS for a in f.aliases}

# 识别表头行用的锚点字段
ANCHOR_HEADERS = {"院校名称", "专业名称", "专业全称", "年份", "院校代码"}

# 别名 -> 规范字段（PLAN_FIELDS）
ALIAS_TO_FIELD = {}
for _f in PLAN_FIELDS:
    for _a in _f.aliases:
        ALIAS_TO_FIELD[_a] = _f

# 历年块基名 -> admission_records 列名
HISTBASE_TO_KEY = {}
for _f in HISTORY_FIELDS:
    for _a in _f.aliases:
        HISTBASE_TO_KEY[_a] = _f.key
