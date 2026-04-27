"""统计去重后真实有多少所「冷门」学校，分别什么校"""
import json
from pathlib import Path
from collections import Counter, defaultdict
OUT = Path(__file__).parent / "out"
b = json.load(open(list(OUT.glob("recommend_local_*.json"))[-1], encoding="utf-8"))

# per case unique school name in gems
print("各 case 去重后冷门学校数：")
all_uniq = set()
for c in b["cases"]:
    if c["status"] != 200:
        continue
    gems = c["data"].get("hidden_gems", [])
    uniq = {g["school_name"] for g in gems}
    all_uniq |= uniq
    print(f"  {c['label']:<22s}  rows={len(gems):>3}  uniq_schools={len(uniq):>3}")

print(f"\n全部 case 合并 unique school = {len(all_uniq)}")

# 按出现次数排序——被多 case 重复推的"标杆冷门"
counter = Counter()
for c in b["cases"]:
    if c["status"] != 200:
        continue
    for g in c["data"].get("hidden_gems", []):
        counter[g["school_name"]] += 1

print("\n=== 被推次数 Top20（rows） ===")
for sch, cnt in counter.most_common(20):
    print(f"  {sch:<14s}  {cnt}")

# 但同一 case 一个学校多次也被算一次（即不同专业）
counter2 = Counter()
for c in b["cases"]:
    if c["status"] != 200:
        continue
    seen = set()
    for g in c["data"].get("hidden_gems", []):
        nm = g["school_name"]
        if nm in seen:
            continue
        seen.add(nm)
        counter2[nm] += 1

print(f"\n=== 被多少 case 推（不计同 case 重复） Top20 / 总 case 20 ===")
for sch, cnt in counter2.most_common(20):
    print(f"  {sch:<14s}  {cnt} cases")

# Type A B C D E F 各占多少（按 rows）
type_counter = Counter()
for c in b["cases"]:
    for g in c["data"].get("hidden_gems", []):
        t = (g.get("top_gem") or {}).get("gem_type", "?")
        type_counter[t] += 1
print(f"\ngem_type 分布: {dict(type_counter)}")
