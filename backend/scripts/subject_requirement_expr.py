#!/usr/bin/env python3
"""
选科要求表达式解析器

把 Excel 里 200 种自由文本的"选科要求"解析为结构化的布尔表达式，
支持 AND/OR/NOT 语义，最终输出为 6 个学科的布尔值。

6 个学科：物理、化学、生物、政治、历史、地理
"""

import re
from typing import Optional

SUBJECTS = ["物理", "化学", "生物", "政治", "历史", "地理"]

# 单字缩写（部分省份用 物/化/生(3选1) 这种写法）
_ABBREV = {"物": "物理", "化": "化学", "生": "生物", "史": "历史", "政": "政治", "地": "地理"}


def _find_subjects(text):
    """识别一段文本里的学科：优先全名(物理)；无全名时按单字缩写(物/化/生、物化生)。
    避免对全名逐字误拆（如 生物 不会被拆成 生→生物 + 物→物理）。保持 SUBJECTS 顺序。"""
    text = text or ""
    full = [s for s in SUBJECTS if s in text]
    if full:
        return full
    found = {_ABBREV[ch] for ch in text if ch in _ABBREV}
    return [s for s in SUBJECTS if s in found]


class SubjectRequirement:
    """
    选科要求的结构化表达。

    属性:
      first_choice   -> "物理" | "历史" | None（无首选要求）
      required       -> set[str]  必须同时选择的科目（AND）
      one_of         -> list[set[str]]  每组任选其一（OR组）
      excluded       -> set[str]  明确排除的科目
    """

    def __init__(self):
        self.first_choice: Optional[str] = None
        self.required: set[str] = set()
        self.one_of: list[set[str]] = []
        self.excluded: set[str] = set()

    def __repr__(self):
        parts = []
        if self.first_choice:
            parts.append(f"首选{self.first_choice}")
        if self.required:
            parts.append("必选:" + ",".join(sorted(self.required)))
        for group in self.one_of:
            parts.append("选其一:" + "/".join(sorted(group)))
        if self.excluded:
            parts.append("排除:" + ",".join(sorted(self.excluded)))
        return f"SubjectRequirement({' ; '.join(parts)})"

    def to_expr_string(self) -> str:
        """输出人类可读的布尔表达式字符串。"""
        parts = []
        if self.first_choice:
            parts.append(f"首选={self.first_choice}")
        if self.required:
            parts.append(" && ".join(sorted(self.required)))
        for group in self.one_of:
            parts.append("(" + " || ".join(sorted(group)) + ")")
        if self.excluded:
            parts.append("NOT(" + ",".join(sorted(self.excluded)) + ")")
        return " && ".join(parts) if parts else "不限"

    def evaluate(self, user_subjects: set[str]) -> bool:
        """
        判断考生选科是否符合要求。
        user_subjects: 考生实际选择的科目集合，例如 {"物理","化学","生物"}
        """
        # 首选科目检查
        if self.first_choice and self.first_choice not in user_subjects:
            return False

        # 必选科目检查（AND）
        for subj in self.required:
            if subj not in user_subjects:
                return False

        # 选其一检查（OR组）
        for group in self.one_of:
            if not any(s in user_subjects for s in group):
                return False

        # 排除科目检查
        for subj in self.excluded:
            if subj in user_subjects:
                return False

        return True

    def to_db_fields(self) -> dict:
        """输出为数据库字段字典，便于建 6 个布尔列。"""
        return {
            "req_first": self.first_choice or "",
            "req_物理": "物理" in self.required or any("物理" in g for g in self.one_of),
            "req_化学": "化学" in self.required or any("化学" in g for g in self.one_of),
            "req_生物": "生物" in self.required or any("生物" in g for g in self.one_of),
            "req_政治": "政治" in self.required or any("政治" in g for g in self.one_of),
            "req_历史": "历史" in self.required or any("历史" in g for g in self.one_of),
            "req_地理": "地理" in self.required or any("地理" in g for g in self.one_of),
            "req_expr": self.to_expr_string(),
        }


def parse_subject_req(text: str) -> SubjectRequirement:
    """
    把 Excel 选科要求文本解析为 SubjectRequirement 对象。

    支持的文本模式:
      "不限"                    -> 无任何要求
      "物理"                    -> 首选物理
      "物理必选"                -> 必选物理
      "物理,化学"               -> 必选物理 AND 化学
      "首选物理，再选不限"      -> 首选物理
      "首选物理，再选化学"      -> 首选物理 AND 化学
      "首选物理，再选化学/生物(2选1)" -> 首选物理 AND (化学 OR 生物)
      "物理、化学(2科必选)"     -> 必选物理 AND 化学
      "化学、物理(2科必选)"     -> 必选化学 AND 物理
      "物理/化学"               -> 物理 OR 化学
      "物理/化学/生物"          -> 物理 OR 化学 OR 生物
      "历史,政治,地理"          -> 必选历史 AND 政治 AND 地理
      "思想政治必选"            -> 必选政治
    """
    req = SubjectRequirement()
    text = text.strip()

    if not text or text in ("不限", "-", "—"):
        return req

    # 1. 识别"首选物理/历史"
    first_match = re.search(r"首选(物理|历史)", text)
    if first_match:
        req.first_choice = first_match.group(1)

    # 2. 识别"再选不限" -> 无额外要求
    if "再选不限" in text or "不提科目要求" in text:
        return req

    # 3. 识别 "X、Y、Z(3科必选)" 或 "X、Y(2科必选)"
    #    也兼容 "X、Y(2科必选)" 和 "X、Y、Z(3科必选)" 的变体
    multi_req_match = re.search(r"(.*?)(\d+科必选)", text)
    if multi_req_match:
        subj_part = multi_req_match.group(1)
        req.required.update(_find_subjects(subj_part))   # 兼容缩写 物化生(3科必选)
        return req

    # 4. 识别 "首选物理，再选化学、生物(2科必选)"
    rexian_match = re.search(r"再选(.*?)(?:\(|$)", text)
    if rexian_match:
        subj_part = rexian_match.group(1)
        # 先检查是否有 (2选1) 或 (3选1)
        choice_match = re.search(r"(\d+选\d+)", text)
        if choice_match:
            # 再选化学/生物(2选1) -> 化学 OR 生物
            found = [s for s in SUBJECTS if s in subj_part]
            if found:
                req.one_of.append(set(found))
        else:
            # 再选化学、地理(2科必选)
            found = [s for s in SUBJECTS if s in subj_part]
            req.required.update(found)
        return req

    # 5. 识别 "物理/化学" 或 "物理或化学或生物" 或缩写 "物/化/生(3选1)"（OR关系）。"或"=OR
    if "/" in text or "或" in text:
        found = _find_subjects(text)
        if found:
            req.one_of.append(set(found))
        return req

    # 6. 识别 "物理,化学" 或 "物理和化学"（AND关系）。"和"=AND（专家版表常用）
    if "," in text or "，" in text or "、" in text or "和" in text:
        found = _find_subjects(text)
        if found:
            req.required.update(found)
        return req

    # 6. 单学科必选，如 "物理必选" "思想政治必选"
    for s in SUBJECTS:
        if s in text and ("必选" in text or "必须" in text):
            req.required.add(s)
            return req

    # 7. 单学科首选/要求，如 "物理" "历史"
    for s in SUBJECTS:
        if text == s or text.startswith(s):
            if not req.first_choice:
                req.required.add(s)
            return req

    # 8. 兜底：只要文本里出现了学科名，就认为是必选
    found = [s for s in SUBJECTS if s in text]
    if found:
        req.required.update(found)

    return req


# ═══════════════════════════════════════════════════════════════
# 测试用例
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    test_cases = [
        ("不限", "不限", True, {"物理", "化学"}),
        ("物理", "物理", True, {"物理"}),
        ("物理", "物理", False, {"历史"}),
        ("物理,化学", "物理 && 化学", True, {"物理", "化学"}),
        ("物理,化学", "物理 && 化学", False, {"物理", "生物"}),
        ("首选物理，再选不限", "首选=物理", True, {"物理", "地理"}),
        ("首选物理，再选化学", "首选=物理 && 化学", True, {"物理", "化学"}),
        ("首选物理，再选化学/生物(2选1)", "首选=物理 && (化学 || 生物)", True, {"物理", "生物"}),
        ("首选物理，再选化学/生物(2选1)", "首选=物理 && (化学 || 生物)", False, {"物理", "地理"}),
        ("化学、物理(2科必选)", "化学 && 物理", True, {"物理", "化学"}),
        ("历史,政治,地理", "历史 && 政治 && 地理", True, {"历史", "政治", "地理"}),
        ("物理/化学/生物", "(物理 || 化学 || 生物)", True, {"化学"}),
        ("思想政治必选", "政治", True, {"政治"}),
        ("首选历史，再选化学、地理(2科必选)", "首选=历史 && 化学 && 地理", True, {"历史", "化学", "地理"}),
    ]

    print("=" * 80)
    print("选科要求表达式解析器测试")
    print("=" * 80)

    all_pass = True
    for text, expected_expr, should_pass, user_subjects in test_cases:
        req = parse_subject_req(text)
        expr = req.to_expr_string()
        result = req.evaluate(user_subjects)
        status = "PASS" if result == should_pass else "FAIL"
        if status == "FAIL":
            all_pass = False
        print(f"[{status}] 输入: '{text}'")
        print(f"       表达式: {expr}")
        print(f"       考生选科: {user_subjects} -> 结果: {result} (期望: {should_pass})")
        print()

    print("=" * 80)
    print(f"测试结果: {'全部通过' if all_pass else '有失败'}")
    print("=" * 80)
