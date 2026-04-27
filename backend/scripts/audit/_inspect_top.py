"""检查顶尖位次 case 的完整推荐结构"""
import json
from pathlib import Path

OUT = Path(__file__).parent / "out"
b = json.load(open(list(OUT.glob("recommend_local_*.json"))[-1], encoding="utf-8"))

# 找 rank<=500 的 case
for c in b["cases"]:
    if c["rank"] > 1000 or c["status"] != 200:
        continue
    print(f"\n========== {c['label']} (rank={c['rank']}) ==========")
    data = c["data"]
    for cat in ("surge", "stable", "safe"):
        items = data.get(cat, [])
        print(f"  [{cat}] {len(items)} items")
        for s in items[:8]:
            print(f"    - {s['school_name']:24s} prob={s['probability']:5.1f}% avg_rank={s.get('avg_min_rank_3yr',0):>6} conf={s.get('confidence','?')} cat_internal={s.get('category','?')} major={s.get('major_name','?')[:24]}")
        if len(items) > 8:
            print(f"    ... ({len(items)-8} more)")
    gems = data.get("hidden_gems", [])
    print(f"  [hidden_gems] {len(gems)} items")
