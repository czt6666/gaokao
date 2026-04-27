import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "scripts/audit/out/recommend_local_1777294058.json"
d = json.load(open(path, encoding="utf-8"))
print("cases:", len(d["cases"]))
c = d["cases"][6]
print("label:", c["label"], "status:", c["status"])
data = c["data"]
print("top keys:", list(data.keys()))
for k in ["surge", "stable", "safe", "hidden_gems"]:
    if k in data:
        print(f"  {k}: {len(data[k])} items")

# Show fields on a sample school
print("--- surge[0] keys ---")
s0 = (data.get("surge") or [{}])[0]
print(sorted(list(s0.keys())))

print("--- surge[0] selected fields ---")
for k in ("school_name", "probability", "prob_low", "prob_high",
         "avg_min_rank_3yr", "rank_diff", "confidence",
         "is_hidden_gem", "is_swarm_pick", "category",
         "school_info", "city", "tier"):
    if k in s0:
        v = s0[k]
        if isinstance(v, dict):
            print(f"  {k}: {{{', '.join(list(v.keys())[:10])}}}")
        else:
            print(f"  {k}: {v}")

print("--- hidden_gems[0] sample ---")
g0 = (data.get("hidden_gems") or [{}])[0]
for k in ("school_name", "probability", "avg_min_rank_3yr", "gem_score",
         "is_hidden_gem", "school_info", "top_gem"):
    if k in g0:
        v = g0[k]
        if isinstance(v, dict):
            print(f"  {k}: keys={list(v.keys())}")
            if k == "school_info":
                print(f"    is_985={v.get('is_985')} is_211={v.get('is_211')} 双一流={v.get('is_shuangyiliu')} rank_2025={v.get('rank_2025')} city={v.get('city')}")
            if k == "top_gem":
                print(f"    gem_type={v.get('gem_type')} score={v.get('gem_score')}")
        else:
            print(f"  {k}: {v}")
