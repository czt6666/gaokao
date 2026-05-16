#!/usr/bin/env python3
"""
选科要求字段映射器

对 subject_requirement_expr.py 的薄封装，把自由文本选科要求解析为
数据库可存储的 subject_must / subject_any_of 两个字段。
"""
import sys
import os

# 确保能 import 同目录的 subject_requirement_expr
sys.path.insert(0, os.path.dirname(__file__))

from subject_requirement_expr import parse_subject_req, SUBJECTS


def _order_subjects(subjects: set[str]) -> list[str]:
    """按 SUBJECTS 标准顺序排列科目，不调整原始顺序"""
    return [s for s in SUBJECTS if s in subjects]


def parse_subject_fields(text: str) -> tuple[str, str]:
    """
    解析选科要求文本，返回 (subject_must, subject_any_of)

    subject_must:
      - 首选科目 + 必选科目，逗号分隔
      - 首选科目本身也作为必须条件（考生必须选这门科目）
      - 例: "物理,化学" 表示必须选物理和化学
      - 例: "化学"      表示必须选化学
      - 无要求时返回空串

    subject_any_of:
      - OR 组，分号分隔多组，组内斜杠分隔
      - 例: "化学/生物" 表示化学或生物任选其一
      - 多组例: "化学/生物;政治/历史"
      - 无 OR 要求时返回空串
    """
    if not text or not isinstance(text, str):
        return "", ""

    req = parse_subject_req(text)

    # 构建 subject_must：首选 + 必选（去重）
    must_parts = []
    if req.first_choice:
        must_parts.append(req.first_choice)
    remaining = req.required - {req.first_choice} if req.first_choice else req.required
    must_parts.extend(_order_subjects(remaining))
    subject_must = ",".join(must_parts)

    # 构建 subject_any_of
    any_parts = []
    for group in req.one_of:
        any_parts.append("/".join(_order_subjects(group)))
    subject_any_of = ";".join(any_parts)

    return subject_must, subject_any_of


# ═══════════════════════════════════════════════════════════════
# 快速验证
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    test_cases = [
        ("不限", "", ""),
        ("物理", "物理", ""),
        ("物理,化学", "物理,化学", ""),
        ("首选物理，再选不限", "物理", ""),
        ("首选物理，再选化学", "物理,化学", ""),
        ("首选物理，再选化学/生物(2选1)", "物理", "化学/生物"),
        ("物理/化学/生物", "", "物理/化学/生物"),
        ("思想政治必选", "政治", ""),
        ("首选历史，再选化学、地理(2科必选)", "历史,化学,地理", ""),
    ]

    all_pass = True
    for text, expected_must, expected_any in test_cases:
        must, any_of = parse_subject_fields(text)
        ok = (must == expected_must and any_of == expected_any)
        if not ok:
            all_pass = False
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] '{text}'")
        print(f"       must={must} (期望 {expected_must})")
        print(f"       any_of={any_of} (期望 {expected_any})")
        print()

    print(f"结果: {'全部通过' if all_pass else '有失败'}")
