#!/usr/bin/env python3
"""
批次类型映射器

把各省Excel中179种自由文本批次名统一映射为8大类 batch_type：
  undergraduate  -> 普通本科（本科批、本科一批、平行录取一段等）
  junior_college -> 专科/高职（专科批、高职专科等）
  advance_batch  -> 提前批（本科提前批、零批次等）
  special_type   -> 特殊类型/专项计划（国家专项、综合评价、单列类等）
  art            -> 艺术类
  sports         -> 体育类
  preparatory    -> 预科
  other          -> 其他（高本贯通等）
"""


def get_batch_type(batch: str) -> str:
    if not batch:
        return "other"
    b = batch.strip()

    # 1. 艺术类（最优先，因为艺术类也可能带"提前批"）
    if "艺术" in b:
        return "art"

    # 2. 体育类
    if "体育" in b:
        return "sports"

    # 3. 预科（排除"及预科"这种附属于本科批次的表述）
    if "预科" in b and "及预科" not in b:
        return "preparatory"

    # 4. 专科/高职
    if "专科" in b or "高职" in b:
        return "junior_college"

    # 5. 提前批 / 零批次 / 提前录取 / 公安院校（公安类按提前批录取）
    if ("提前批" in b or "提前录取" in b or "零批次" in b or "零志愿" in b
            or "公安" in b or b.startswith("提前")):
        return "advance_batch"

    # 6. 特殊类型 / 专项计划
    special_keywords = [
        "专项", "单列", "对口援疆", "南疆", "综合评价",
        "特殊类型", "免费定向", "农村专项", "高校专项",
        "国家专项", "地方专项",
    ]
    if any(k in b for k in special_keywords):
        return "special_type"

    # 7. 本科（兜底）
    undergrad_keywords = ["本科", "本一", "本二", "一段", "二段", "三段", "平行录取"]
    if any(k in b for k in undergrad_keywords):
        return "undergraduate"

    return "other"


# ═══════════════════════════════════════════════════════════════
# 快速验证
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    test_cases = [
        ("本科批", "undergraduate"),
        ("本科一批", "undergraduate"),
        ("本科二批A段", "undergraduate"),
        ("平行录取一段", "undergraduate"),
        ("本一", "undergraduate"),
        ("专科批", "junior_college"),
        ("高职专科", "junior_college"),
        ("本科提前批", "advance_batch"),
        ("提前批B段", "advance_batch"),
        ("零批次", "advance_batch"),
        ("提前录取本科一批", "advance_batch"),
        ("国家专项计划本科批", "special_type"),
        ("综合评价批次", "special_type"),
        ("单列类本科一批", "special_type"),
        ("本科一批预科", "preparatory"),
        ("预科升学批", "preparatory"),
        ("本科二批及预科", "undergraduate"),  # 注意：主体是本科二批
        ("艺术类本科批", "art"),
        ("体育类本科提前批", "sports"),
        ("高本贯通批", "other"),
    ]

    all_pass = True
    for batch, expected in test_cases:
        result = get_batch_type(batch)
        status = "PASS" if result == expected else "FAIL"
        if status == "FAIL":
            all_pass = False
        print(f"[{status}] '{batch}' -> {result} (期望 {expected})")

    print(f"\n结果: {'全部通过' if all_pass else '有失败'}")
