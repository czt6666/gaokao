"""把 findings_recommend.json 的代表性条目打印到控制台供人工核查。"""
import json
from pathlib import Path

OUT = Path(__file__).parent / "out"
f = json.load(open(OUT / "findings_recommend.json", encoding="utf-8"))


def show(label, items, k=10):
    print(f"\n========== {label} (共 {len(items)} 条) ==========")
    for x in items[:k]:
        print(json.dumps(x, ensure_ascii=False))


show("L1 上不了 (sample 12)", f["L1_unreachable"], 12)
show("L2 太吃亏 (sample 12)", f["L2_overshoot"], 12)
show("L3 档位错配 (sample 12)", f["L3_misclassified"], 12)
show("L4 低置信极端断言 (sample 8)", f["L4_low_conf_extreme"], 8)
show("L5 跨 case 漂移 (sample 8)", f["L5_cross_drift"], 8)
print("\n========== summary ==========")
print(json.dumps(f["summary"], ensure_ascii=False, indent=2))
print("\n========== stats by case ==========")
for s in f["stats_by_case"]:
    print(s)
