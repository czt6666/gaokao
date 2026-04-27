"""校验 推荐返回里 (avg_min_rank_3yr, avg_min_score_3yr) 的换算是否与 2025 一分一段表一致。

逻辑：从 csv 读入 2025 年各省一分一段；对推荐里每所学校，用 avg_min_rank_3yr 反查
csv 应该对应的分数；和 avg_min_score_3yr 比较。

注意：avg_min_rank_3yr/avg_min_score_3yr 是 3 年加权平均，并非单纯 2025 年。
但应该在 2025 年一分一段表上能找到一个"等位分"在合理范围内。
我们这里检查 score 是否大致"合理"——即 score 落在该位次相邻 ±50 名分数区间内。
"""
import csv
import json
import bisect
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).parent.parent.parent  # backend/
CSV = ROOT / "data" / "rank_tables_2025_export.csv"
OUT = Path(__file__).parent / "out"

# 加载 csv：{ (province, category): [(rank_max, score), ...] sorted by rank_max asc }
rank_tables = defaultdict(list)
with open(CSV, encoding="utf-8-sig") as f:
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
        rank_tables[(prov, cat)].append((rmax, score))

for k in rank_tables:
    rank_tables[k].sort()  # by rank_max asc

print(f"加载 2025 一分一段：{len(rank_tables)} 个 (province, category)")
for k in list(rank_tables.keys())[:10]:
    print(f"  {k}: {len(rank_tables[k])} rows; rank=[{rank_tables[k][0][0]},{rank_tables[k][-1][0]}]")


def score_for_rank(province, category, rank):
    """给定省份+科类+位次，返回对应分数"""
    table = rank_tables.get((province, category))
    if not table:
        return None
    ranks = [t[0] for t in table]
    idx = bisect.bisect_left(ranks, rank)
    if idx >= len(table):
        return table[-1][1]
    if idx == 0:
        return table[0][1]
    # 找最接近的（rank_max 是上界，rank 落在 (rank_max[idx-1], rank_max[idx]] 之间）
    return table[idx][1]


def rank_for_score(province, category, score):
    """给定省份+科类+分数，返回对应位次（rank_max）"""
    table = rank_tables.get((province, category))
    if not table:
        return None
    for rmax, s in table:
        if s == score:
            return rmax
    return None


# 推断 category：物理 → "物理类" / 历史 → "历史类" / 综合 → "综合"
# 看 csv 里的实际 category 名称
print("\n各省的 category 列表：")
prov_cats = defaultdict(set)
for (p, c) in rank_tables.keys():
    prov_cats[p].add(c)
for p in sorted(prov_cats):
    print(f"  {p}: {sorted(prov_cats[p])}")
