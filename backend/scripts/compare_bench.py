#!/usr/bin/env python3
"""
对比新旧 benchmark 结果：推荐学校重叠率、概率差异。

用法:
  python scripts/compare_bench.py old_bench.json new_bench.json
"""
import json
import sys


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    old_path = sys.argv[1] if len(sys.argv) > 1 else "old_bench.json"
    new_path = sys.argv[2] if len(sys.argv) > 2 else "new_bench.json"
    old = load(old_path)
    new = load(new_path)

    print(f"{'场景':22s} | {'旧':>4s} | {'新':>4s} | {'学校重叠':>8s} | {'专业重叠':>8s} | 说明")
    print("-" * 90)

    total_school_overlap = []
    total_major_overlap = []

    for label in old:
        o = old[label]
        n = new.get(label, {})
        o_matched = o.get("total_matched", 0)
        n_matched = n.get("total_matched", 0)

        o_entries = o.get("entries", [])
        n_entries = n.get("entries", [])

        o_schools = {e["school"] for e in o_entries}
        n_schools = {e["school"] for e in n_entries}
        o_majors = {(e["school"], e["major"]) for e in o_entries}
        n_majors = {(e["school"], e["major"]) for e in n_entries}

        # 重叠率（以两者并集为分母）
        sch_union = o_schools | n_schools
        sch_inter = o_schools & n_schools
        sch_overlap = len(sch_inter) / len(sch_union) * 100 if sch_union else 100.0

        maj_union = o_majors | n_majors
        maj_inter = o_majors & n_majors
        maj_overlap = len(maj_inter) / len(maj_union) * 100 if maj_union else 100.0

        note = ""
        if o_matched == 0 and n_matched == 0:
            note = "双方均空"
        elif o_matched == 0:
            note = "旧空新有"
        elif n_matched == 0:
            note = "旧有新空"
        elif sch_overlap < 30:
            note = "⚠ 差异大"
        elif sch_overlap >= 70:
            note = "✓ 高度一致"

        if o_matched and n_matched:
            total_school_overlap.append(sch_overlap)
            total_major_overlap.append(maj_overlap)

        print(f"{label:22s} | {o_matched:>4d} | {n_matched:>4d} | "
              f"{sch_overlap:>7.0f}% | {maj_overlap:>7.0f}% | {note}")

    print("-" * 90)
    if total_school_overlap:
        avg_sch = sum(total_school_overlap) / len(total_school_overlap)
        avg_maj = sum(total_major_overlap) / len(total_major_overlap)
        print(f"平均学校重叠率: {avg_sch:.0f}%   平均专业重叠率: {avg_maj:.0f}%   "
              f"(基于 {len(total_school_overlap)} 个双方非空场景)")

    # 跨科类污染检测：历史场景里不应出现明显物理特征学校
    print("\n=== 跨科类污染检测（新数据）===")
    for label in new:
        if "历史" not in label:
            continue
        n = new[label]
        entries = n.get("entries", [])
        if not entries:
            continue
        # 抽样看前3个推荐
        sample = [f"{e['school']}·{e['major']}" for e in entries[:3]]
        print(f"  {label}: {' / '.join(sample)}")


if __name__ == "__main__":
    main()
