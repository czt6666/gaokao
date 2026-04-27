import json
from pathlib import Path
OUT = Path(__file__).parent / "out"
b = json.load(open(list(OUT.glob("recommend_local_*.json"))[-1], encoding="utf-8"))

# 第一个有 gem 的 case
for c in b["cases"]:
    gems = c["data"].get("hidden_gems", [])
    if not gems:
        continue
    g = gems[0]
    print(f"case={c['label']}")
    print(f"keys = {sorted(g.keys())}")
    print(f"  school_name = {g.get('school_name')}")
    print(f"  is_985 = {g.get('is_985')}  is_211 = {g.get('is_211')}")
    print(f"  city = {g.get('city')}  rank_2025 = {g.get('rank_2025')}")
    print(f"  school_info = {g.get('school_info')}")
    print(f"  tier = {g.get('tier')}")
    break

# 多看几所学校
print("\n--- 河南-中3000 case 前5个 gem ---")
for c in b["cases"]:
    if c["label"] != "河南-中3000":
        continue
    for g in c["data"].get("hidden_gems", [])[:5]:
        print(f"  {g['school_name']:14s} city={g.get('city','?'):8s} 985={g.get('is_985')} 211={g.get('is_211')} 软科={g.get('rank_2025')} top_gem.type={(g.get('top_gem') or {}).get('gem_type')}")
    break
