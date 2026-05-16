#!/usr/bin/env python3
"""
专业备注表达式引擎

通过可配置的规则，把 Excel "专业备注"列的自由文本映射为结构化限制标签。

规则语义（JSON配置）：
  {
    "rules": [
      {
        "name": "gender_male",
        "match": "contains_any",      // 匹配模式
        "keywords": ["只招男生", "限男生"], // 关键词列表
        "exclude": ["女生"],          // 排除词（出现则此规则不匹配）
        "priority": 10,               // 优先级（数字越大越优先）
        "label": "gender:male_only"   // 输出的标签
      },
      {
        "name": "special_military",
        "match": "contains_any",
        "keywords": ["军", "武警", "定向培养军士", "空军", "海军", "陆军", "火箭军"],
        "exclude": [],
        "priority": 5,
        "label": "special:military"
      },
      {
        "name": "health_color_blind",
        "match": "contains_any",
        "keywords": ["不招色盲", "色盲限报", "色盲不予录取", "色盲不录", "色盲受限", "无色盲"],
        "exclude": ["色弱"],  // 如果出现"色弱"，说明可能是 color_blind+color_weak 的组合
        "priority": 20,
        "label": "health:color_blind"
      }
    ]
  }

匹配模式说明：
  contains_any    -> 文本中只要包含任意一个关键词，即匹配
  contains_all    -> 文本中必须同时包含所有关键词，才匹配
  regex           -> 使用正则表达式匹配
  exact           -> 完全相等才匹配

输出格式：
  逗号分隔的标签字符串，例如 "gender:male_only,health:color_blind"
"""

import json
import re
from typing import Optional


class NoteRule:
    """单条规则定义"""

    def __init__(self, data: dict):
        self.name = data["name"]
        self.match = data.get("match", "contains_any")
        self.keywords = data.get("keywords", [])
        self.exclude = data.get("exclude", [])
        self.priority = data.get("priority", 0)
        self.label = data["label"]
        self.regex_patterns = [re.compile(kw) for kw in self.keywords] if self.match == "regex" else []

    def __repr__(self):
        return f"NoteRule({self.name}: {self.label}, priority={self.priority})"

    def matches(self, text: str) -> bool:
        """判断文本是否匹配本条规则"""
        # 排除词检查
        for ex in self.exclude:
            if ex in text:
                return False

        if self.match == "contains_any":
            return any(kw in text for kw in self.keywords)

        elif self.match == "contains_all":
            return all(kw in text for kw in self.keywords)

        elif self.match == "regex":
            return any(p.search(text) for p in self.regex_patterns)

        elif self.match == "exact":
            return text in self.keywords

        return False


class NoteExpressionEngine:
    """专业备注表达式引擎"""

    DEFAULT_RULES = [
        # ══ 性别限制（高优先级）══
        {"name": "gender_male", "match": "contains_any",
         "keywords": ["只招男生", "限男生", "招男生", "（男）", "(男)", "公安专业）（男", "消防救援方向）（男", "森林消防方向）（男"],
         "exclude": ["女生", "女性考生"],
         "priority": 100, "label": "gender:male_only"},

        {"name": "gender_female", "match": "contains_any",
         "keywords": ["只招女生", "限女生", "招女生", "（女）", "(女)", "公安专业）（女", "消防救援方向）（女"],
         "exclude": ["男生", "男性考生", "男女生", "女生身高"],
         "priority": 100, "label": "gender:female_only"},

        # ══ 体检限制（高优先级）══
        {"name": "health_color_blind_weak", "match": "contains_any",
         "keywords": ["色盲、色弱不录", "色盲、色弱限报", "色盲、色弱考生限报", "色盲色弱不录", "色盲色弱限报", "色盲色弱受限",
                      "无色盲色弱", "不招色盲色弱", "不招色盲、色弱"],
         "exclude": [],
         "priority": 95, "label": "health:color_blind_weak"},

        {"name": "health_color_blind", "match": "contains_any",
         "keywords": ["不招色盲", "色盲限报", "色盲不予录取", "色盲不录", "色盲受限", "无色盲",
                      "色盲、单色识别不全", "色盲、色弱者，不予录取"],
         "exclude": ["色弱"],  # 如果同时包含色弱，让上面的 health_color_blind_weak 匹配
         "priority": 90, "label": "health:color_blind"},

        {"name": "health_color_weak", "match": "contains_any",
         "keywords": ["不招色弱", "色弱限报", "色弱不录", "色弱受限", "无色弱"],
         "exclude": ["色盲"],
         "priority": 90, "label": "health:color_weak"},

        {"name": "health_monochrome", "match": "contains_any",
         "keywords": ["不招单色识别不全", "单色识别不全", "单色识别能力异常", "单色识别不全者"],
         "exclude": [],
         "priority": 90, "label": "health:monochrome"},

        # ══ 外语限制（高优先级）══
        {"name": "lang_english_only", "match": "contains_any",
         "keywords": ["只招英语", "招英语", "外语语种英语", "语种:英语", "语种：英语", "语种为英语",
                      "外语语种:英语", "外语语种：英语", "外语语种要求英语", "语种要求英语",
                      "外语要求:英语", "外语要求：英语", "外语语种要求：英语", "语种要求：英语"],
         "exclude": ["不限", "日语", "俄语", "法语", "德语", "英日", "英俄"],
         "priority": 80, "label": "lang:english_only"},

        {"name": "lang_english_japanese", "match": "contains_any",
         "keywords": ["外语语种:英日", "语种:英语,日语", "语种：英语，日语", "只招英语，日语"],
         "exclude": [],
         "priority": 85, "label": "lang:english_japanese"},

        {"name": "lang_english_russian", "match": "contains_any",
         "keywords": ["语种:英语,俄语", "语种：英语，俄语", "只招英语，俄语", "只招英语、俄语"],
         "exclude": [],
         "priority": 85, "label": "lang:english_russian"},

        # ══ 特殊类型（中优先级）══
        {"name": "special_military", "match": "contains_any",
         "keywords": ["定向培养军士", "武警部队", "空军", "海军", "陆军", "火箭军", "（空军）", "（海军）", "（陆军）", "（火箭军）"],
         "exclude": [],
         "priority": 60, "label": "special:military"},

        {"name": "special_national", "match": "contains_any",
         "keywords": ["国家专项", "国家专项计划"],
         "exclude": [],
         "priority": 55, "label": "special:national_special"},

        {"name": "special_local", "match": "contains_any",
         "keywords": ["地方专项", "地方专项计划"],
         "exclude": [],
         "priority": 55, "label": "special:local_special"},

        {"name": "special_oriented", "match": "contains_any",
         "keywords": ["定向", "定向培养", "定向就业", "定向西藏", "履约任教"],
         "exclude": ["定向培养军士"],  # 军士定向由 special_military 处理
         "priority": 55, "label": "special:oriented"},

        {"name": "special_free_teacher", "match": "contains_any",
         "keywords": ["公费师范", "师范类", "（师范）", "(师范)", "师范", "优师专项"],
         "exclude": [],
         "priority": 50, "label": "special:free_teacher"},

        {"name": "special_sino_foreign", "match": "contains_any",
         "keywords": ["中外合作办学", "中外合作", "中美合作", "中英合作", "中法合作", "中德合作", "中加合作", "中马合作", "中澳合作", "中俄合作"],
         "exclude": [],
         "priority": 50, "label": "special:sino_foreign"},

        {"name": "special_experiment", "match": "contains_any",
         "keywords": ["实验班", "基地班", "拔尖班", "卓越班", "创新班", "菁英班", "英才班",
                      "大师班", "阶平班", "韬奋班", "自强班", "梁希班", "华佗班", "岐黄班",
                      "屠呦呦班", "启明班", "成思危班", "侯宗濂班", "钱学森班", "吕振羽班",
                      "正谊明道班", "未来技术班", "卓越工程师", "卓越法治人才", "卓越新闻传播",
                      "拔尖人才", "荣誉项目班", "ACCA", "CFA"],
         "exclude": [],
         "priority": 45, "label": "special:experiment"},
    ]

    def __init__(self, rules: Optional[list] = None):
        """
        初始化引擎。
        rules: 自定义规则列表，不传则使用默认规则。
        """
        raw_rules = rules if rules is not None else self.DEFAULT_RULES
        self.rules = [NoteRule(r) for r in raw_rules]
        # 按优先级降序排列
        self.rules.sort(key=lambda r: -r.priority)

    def evaluate(self, text: str) -> str:
        """
        对单条专业备注文本进行规则匹配，返回逗号分隔的标签字符串。
        """
        if not text or not isinstance(text, str):
            return ""

        text = text.strip()
        if not text:
            return ""

        matched_labels = []
        matched_categories = set()

        for rule in self.rules:
            # 每个大类只取最高优先级的匹配结果
            category = rule.label.split(":")[0]
            if category in matched_categories:
                continue

            if rule.matches(text):
                matched_labels.append(rule.label)
                matched_categories.add(category)

        return ",".join(matched_labels)

    def to_json(self) -> str:
        """导出当前规则为 JSON 字符串"""
        rules_data = []
        for r in self.rules:
            rules_data.append({
                "name": r.name,
                "match": r.match,
                "keywords": r.keywords,
                "exclude": r.exclude,
                "priority": r.priority,
                "label": r.label,
            })
        return json.dumps({"rules": rules_data}, ensure_ascii=False, indent=2)

    @classmethod
    def from_json(cls, json_str: str):
        """从 JSON 字符串加载规则引擎"""
        data = json.loads(json_str)
        return cls(data.get("rules", []))


# ═══════════════════════════════════════════════════════════════
# 测试用例
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    engine = NoteExpressionEngine()

    test_cases = [
        ("（只招男生）", "gender:male_only"),
        ("（只招女生）", "gender:female_only"),
        ("（不招色盲）", "health:color_blind"),
        ("（色盲色弱不录）", "health:color_blind_weak"),
        ("（不招色弱）", "health:color_weak"),
        ("（只招英语语种的考生）", "lang:english_only"),
        ("（国家专项）", "special:national_special"),
        ("（地方专项）", "special:local_special"),
        ("（定向培养军士）", "special:military"),
        ("（中外合作办学）", "special:sino_foreign"),
        ("（实验班）", "special:experiment"),
        ("（师范）", "special:free_teacher"),
        ("（公费师范）", "special:free_teacher"),
        ("（只招男生；不招色盲）", "gender:male_only,health:color_blind"),
        ("", ""),
        ("（办学地点：北校区）", ""),
        ("（不招单色识别不全考生）", "health:monochrome"),
        ("（公安专业）（男）", "gender:male_only"),
        ("（女）（国家专项计划）", "gender:female_only,special:national_special"),
        ("（要求高考英语单科成绩不得低于110分；只招英语语种的考生）", "lang:english_only"),
    ]

    print("=" * 80)
    print("专业备注表达式引擎测试")
    print("=" * 80)

    all_pass = True
    for text, expected in test_cases:
        result = engine.evaluate(text)
        status = "PASS" if result == expected else "FAIL"
        if status == "FAIL":
            all_pass = False
        print(f"[{status}] 输入: '{text}'")
        print(f"       输出: '{result}' (期望: '{expected}')")
        print()

    # 导出规则到文件
    with open("note_expression_rules.json", "w", encoding="utf-8") as f:
        f.write(engine.to_json())
    print("[Saved] 规则已导出到 note_expression_rules.json")

    print("=" * 80)
    print(f"测试结果: {'全部通过' if all_pass else '有失败'}")
    print("=" * 80)
