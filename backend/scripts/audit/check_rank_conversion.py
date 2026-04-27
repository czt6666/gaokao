"""
位次转换准确性校验

输入：用户提供的"预期"分数→位次对照表
方法：
  1. 直接查 2025 一分一段表 CSV，看我们的数据里该分数对应的位次
  2. 调用 /api/recommend 接口，输入预期位次，看返回结果中的 last_year_min_score
     是否与表格中的分数接近（间接验证）
"""
import csv
import statistics
import requests
from collections import defaultdict

CSV_PATH = "data/rank_tables_2025_export.csv"

# 用户提供的预期数据
EXPECTED = [
    ("广东", "物理", 555, 88000),
    ("广东", "物理", 666, 1200),
    ("广东", "历史", 555, 23000),
    ("广东", "历史", 666, 300),
    ("江苏", "物理", 555, 85000),
    ("江苏", "物理", 666, 1000),
    ("江苏", "历史", 555, 21000),
    ("江苏", "历史", 666, 200),
    ("四川", "物理", 555, 62000),
    ("四川", "物理", 666, 900),
    ("四川", "历史", 555, 18000),
    ("四川", "历史", 666, 150),
    ("河南", "物理", 555, 112000),
    ("河南", "物理", 666, 1300),
    ("河南", "历史", 555, 24000),
    ("河南", "历史", 666, 220),
    ("江西", "物理", 555, 78000),
    ("江西", "物理", 666, 1100),
    ("江西", "历史", 555, 20000),
    ("江西", "历史", 666, 180),
    ("浙江", "综合", 555, 105000),
    ("浙江", "综合", 666, 800),
]

# 科类映射：用户输入的科类 -> CSV 中的科类名
CAT_MAP = {
    "物理": "物理类",
    "历史": "历史类",
    "综合": "综合",
}

# API 选科映射
SUBJ_MAP = {
    "物理": "物理",
    "历史": "历史",
    "综合": "物理",
}


def load_csv():
    tables = defaultdict(dict)
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("year") != "2025":
                continue
            prov = row["province"]
            cat = row["category"]
            try:
                score = int(row["score"])
                rmax = int(row["rank_max"])
            except (ValueError, TypeError):
                continue
            tables[(prov, cat)][score] = rmax
    return tables


def csv_lookup(tables, prov, csv_cat, score):
    table = tables.get((prov, csv_cat))
    if not table:
        return None, f"no_data"
    if score in table:
        return table[score], "exact"
    scores = sorted(table.keys())
    lo = max((s for s in scores if s <= score), default=scores[0])
    hi = min((s for s in scores if s >= score), default=scores[-1])
    if lo == hi:
        return table[lo], "exact"
    r_lo, r_hi = table[lo], table[hi]
    ratio = (score - lo) / (hi - lo)
    interpolated = round(r_lo + ratio * (r_hi - r_lo))
    return interpolated, f"interp"


def api_check(prov, rank, subject):
    subj = SUBJ_MAP.get(subject, subject)
    try:
        r = requests.get("http://localhost:8000/api/recommend", params={
            "rank": rank, "province": prov, "subject": subj
        }, timeout=30)
        d = r.json()
        results = d.get("surge", []) + d.get("stable", []) + d.get("safe", [])
        scores = [s.get("last_year_min_score", 0) for s in results if s.get("last_year_min_score", 0) > 0]
        if scores:
            return round(statistics.median(scores))
    except Exception as e:
        return f"ERR:{e}"
    return None


def main():
    tables = load_csv()
    header = "省份    科类    分数   预期位次    CSV位次      偏差   方式        API中位分"
    print("=" * len(header))
    print(header)
    print("=" * len(header))

    mismatches = []
    for prov, cat, score, expected_rank in EXPECTED:
        csv_cat = CAT_MAP.get(cat, cat)
        csv_rank, method = csv_lookup(tables, prov, csv_cat, score)
        diff = csv_rank - expected_rank if csv_rank else None
        diff_pct = round(diff / expected_rank * 100, 1) if diff else None
        api_score = api_check(prov, expected_rank, cat)

        status = ""
        if csv_rank and diff and abs(diff_pct) > 10:
            status = "** 偏差>10%"
            mismatches.append((prov, cat, score, expected_rank, csv_rank, diff_pct))

        print(f"{prov:<6} {cat:<6} {score:>5} {expected_rank:>10} {str(csv_rank) if csv_rank else 'N/A':>10} "
              f"{str(diff_pct)+'%' if diff_pct is not None else 'N/A':>8} {method:<10} {str(api_score) if api_score else 'N/A':>10} {status}")

    print("=" * len(header))
    if mismatches:
        print(f"\n** 偏差 >10% 的条目：{len(mismatches)} 条")
        for m in mismatches:
            print(f"  {m[0]}/{m[1]} {m[2]}分: 预期{m[3]} vs CSV{m[4]} (偏差{m[5]}%)")
    else:
        print("\n[OK] 所有条目 CSV 位次与预期偏差 <= 10%")


if __name__ == "__main__":
    main()
