"""校验 推荐 API 返回中 (avg_min_rank_3yr, avg_min_score_3yr) 的换算。

方法：
  1. 加载 2025 一分一段表（CSV）
  2. 对推荐里每行（学校×专业），用 avg_min_rank_3yr 反查 2025 一分一段表，
     拿到"该位次理论分数"
  3. 与 avg_min_score_3yr 比较 — 由于 score 是 3 年加权平均，理论分数 vs 历史分数允许浮动 ±10 分
  4. 大于 ±25 分的视为可疑

⚠️ 注意：由于历年位次有归一化（P4），avg_min_score_3yr 不一定能用 2025 表反查得对。
但用户角度（"我考 X 分，按今年位次能上什么学校"）：API 返回的 score 应能在今年表里找到接近位次。
"""
import csv
import json
import bisect
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).parent.parent.parent
CSV = ROOT / "data" / "rank_tables_2025_export.csv"
OUT = Path(__file__).parent / "out"

# ── 加载一分一段 ─────────────────────────────────────────────
rank_tables = defaultdict(list)
with open(CSV, encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    for row in reader:
        if row.get("year") != "2025":
            continue
        try:
            score = int(row["score"])
            rmax = int(row["rank_max"])
        except (ValueError, TypeError):
            continue
        rank_tables[(row["province"], row["category"])].append((rmax, score))
for k in rank_tables:
    rank_tables[k].sort()

# ── 选科 → category 映射 ──────────────────────────────────────
COMBINED_PROVS = {"北京", "上海", "天津", "海南", "山东", "浙江"}  # 3+3 综合
OLD_MODE_PROVS = {"新疆"}  # 老高考 文科/理科
def map_category(province, subject):
    if province in COMBINED_PROVS:
        return "综合"
    if province in OLD_MODE_PROVS:
        return "理科" if "物理" in subject else "文科"
    return "物理类" if "物理" in subject else "历史类"


def score_for_rank(province, subject, rank):
    cat = map_category(province, subject)
    table = rank_tables.get((province, cat))
    if not table:
        return None, cat
    ranks = [t[0] for t in table]
    idx = bisect.bisect_left(ranks, rank)
    if idx >= len(table):
        return table[-1][1], cat
    return table[idx][1], cat


# ── 加载推荐结果 ─────────────────────────────────────────────
b = json.load(open(list(OUT.glob("recommend_local_*.json"))[-1], encoding="utf-8"))

mismatches = []
sample_check = []
for c in b["cases"]:
    if c["status"] != 200:
        continue
    prov = c["province"]; subj = c["subject"]
    for cat in ("surge", "stable", "safe"):
        for s in c["data"].get(cat, []):
            avg_rank = s.get("avg_min_rank_3yr", 0)
            avg_score = s.get("avg_min_score_3yr", 0)
            if not avg_rank or not avg_score:
                continue
            pred_score, csv_cat = score_for_rank(prov, subj, avg_rank)
            if pred_score is None:
                continue  # 该省 csv 无数据
            diff = avg_score - pred_score
            sample_check.append({
                "case": c["label"], "school": s["school_name"],
                "major": (s.get("major_name") or "")[:30],
                "avg_rank": avg_rank, "avg_score_api": avg_score,
                "pred_score_2025": pred_score, "diff": diff,
                "csv_category": csv_cat,
            })
            # 严重不一致：API给出的score和"按位次反查2025表"差距>25 分
            if abs(diff) > 25:
                mismatches.append({
                    "case": c["label"], "school": s["school_name"],
                    "major": (s.get("major_name") or "")[:30],
                    "avg_rank": avg_rank, "avg_score_api": avg_score,
                    "pred_score_2025": pred_score, "diff": diff
                })

# ── 同时校验 candidate_rank → score（用户输入位次→对应分数）────
# 这是 "学生位次转分数" 的合理性，影响推荐展示
print(f"\n样本数: {len(sample_check)}, 大偏差(>25分)数: {len(mismatches)}")
print("\n=== 大偏差样本 ===")
for m in mismatches[:25]:
    print(f"  {m['case']:<22s} {m['school']:<14s} avg_rank={m['avg_rank']:>6} | API_score={m['avg_score_api']:>4} 反查={m['pred_score_2025']:>4} diff={m['diff']:+5}")

# 偏差分布
import statistics
diffs = [s["diff"] for s in sample_check]
if diffs:
    print(f"\n偏差分布: 中位数={statistics.median(diffs):+.0f}, 均值={statistics.mean(diffs):+.1f}")
    print(f"  |diff|<=5: {sum(1 for d in diffs if abs(d)<=5)} ({sum(1 for d in diffs if abs(d)<=5)/len(diffs)*100:.0f}%)")
    print(f"  |diff|<=10: {sum(1 for d in diffs if abs(d)<=10)} ({sum(1 for d in diffs if abs(d)<=10)/len(diffs)*100:.0f}%)")
    print(f"  |diff|<=25: {sum(1 for d in diffs if abs(d)<=25)} ({sum(1 for d in diffs if abs(d)<=25)/len(diffs)*100:.0f}%)")
    print(f"  |diff|>25: {sum(1 for d in diffs if abs(d)>25)} ({sum(1 for d in diffs if abs(d)>25)/len(diffs)*100:.0f}%)")

# 落盘
out_path = OUT / "findings_rank_score.json"
out_path.write_text(json.dumps({
    "n_samples": len(sample_check),
    "n_mismatches": len(mismatches),
    "mismatches": mismatches,
    "diff_stats": {
        "median": statistics.median(diffs) if diffs else None,
        "mean": statistics.mean(diffs) if diffs else None,
        "abs_le_5_pct": sum(1 for d in diffs if abs(d)<=5)/len(diffs)*100 if diffs else 0,
        "abs_le_10_pct": sum(1 for d in diffs if abs(d)<=10)/len(diffs)*100 if diffs else 0,
        "abs_le_25_pct": sum(1 for d in diffs if abs(d)<=25)/len(diffs)*100 if diffs else 0,
    }
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\n[OK] -> {out_path}")
