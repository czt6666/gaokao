"""推荐准确性审计 — 主分析脚本

输入：scripts/audit/out/recommend_*.json （由 collect_recommend.py 产出）
输出：scripts/audit/out/findings.json + 控制台摘要

检测项：
  L1. 「上不了」：被分到 stable/safe 但 prob 极低 / student_rank ≫ school_avg
  L2. 「太吃亏」：被分到 surge 但 prob 极高 / student_rank ≪ school_avg
  L3. 概率与档位不匹配（surge>safe 排序错乱、勿入档）
  L4. 置信度低 + 极端结论 → 高风险噪音
  L5. 同分跨省 / 同分跨选科 漂移过大
  L6. 重要学校缺位（清北/复旦/交大 在顶尖位次中应出现）
"""
import json
import sys
import statistics
from pathlib import Path
from collections import defaultdict

OUT_DIR = Path(__file__).parent / "out"


def latest_bundle():
    files = sorted(OUT_DIR.glob("recommend_*.json"))
    if not files:
        sys.exit("no collected data")
    return json.loads(files[-1].read_text(encoding="utf-8"))


def all_schools(data, with_category=False):
    out = []
    for cat in ("surge", "stable", "safe"):
        for s in data.get(cat, []):
            if with_category:
                out.append((cat, s))
            else:
                out.append(s)
    return out


def analyze(bundle):
    findings = {
        "summary": {
            "cases": len(bundle["cases"]),
            "total_schools": 0,
            "errors": defaultdict(int),
        },
        "L1_unreachable": [],
        "L2_overshoot": [],
        "L3_misclassified": [],
        "L4_low_conf_extreme": [],
        "L5_cross_drift": [],
        "L6_missing_top": [],
        "stats_by_case": [],
    }

    # ── 单 case 内部检查 ────────────────────────────────────────────
    for c in bundle["cases"]:
        if c["status"] != 200:
            continue
        data = c["data"]
        rank = c["rank"]
        prov = c["province"]
        label = c["label"]

        case_stats = {
            "label": label, "rank": rank, "province": prov,
            "subject": c["subject"],
            "surge_n": len(data.get("surge", [])),
            "stable_n": len(data.get("stable", [])),
            "safe_n": len(data.get("safe", [])),
            "gems_n": len(data.get("hidden_gems", [])),
        }

        for cat, s in all_schools(data, with_category=True):
            findings["summary"]["total_schools"] += 1
            name = s.get("school_name", "?")
            prob = s.get("probability", 0)
            avg = s.get("avg_min_rank_3yr", 0)
            conf = s.get("confidence", "?")
            si = s.get("school_info") or {}

            # L1. 上不了：被推但 student_rank ≫ school_avg → 学生根本进不去
            #    定义：avg_rank > 0 且 student_rank > avg_rank * 2 时仍 prob ≥ 30%（数学上不该）
            if avg > 0 and rank > avg * 2.0 and prob >= 30:
                findings["L1_unreachable"].append({
                    "case": label, "school": name, "category": cat,
                    "student_rank": rank, "school_avg_rank": avg,
                    "prob": prob, "ratio": round(rank / avg, 2),
                    "issue": f"学生位次{rank}远大于学校均位{avg}（{round(rank/avg,1)}倍），却报{prob}% 概率"
                })

            # L1b. 上不了的反向：被分到 surge/stable 但 prob<5% 且 学生位次差距远
            if cat in ("surge", "stable") and prob < 5 and avg > 0 and rank > avg * 1.5:
                findings["L1_unreachable"].append({
                    "case": label, "school": name, "category": cat,
                    "student_rank": rank, "school_avg_rank": avg,
                    "prob": prob, "ratio": round(rank / avg, 2),
                    "issue": f"被列入{cat}档但概率仅{prob}%，且学生位次远低于学校"
                })

            # L2. 太吃亏：被分到 surge（冲）但学校档次太低 → 学生 rank ≪ school_avg
            #    定义：cat=surge 且 student_rank < avg_rank * 0.3 且 prob > 90%
            if cat == "surge" and avg > 0 and rank < avg * 0.3 and prob > 90:
                findings["L2_overshoot"].append({
                    "case": label, "school": name, "category": cat,
                    "student_rank": rank, "school_avg_rank": avg,
                    "prob": prob, "ratio": round(avg / rank, 2),
                    "issue": f"该学校均位{avg}，学生位次{rank}（学生比学校均位低{round(avg/rank,1)}倍），不应被列入「冲」"
                })
            # L2b. safe（保）档但学校档次远高于学生
            if cat == "safe" and avg > 0 and rank > avg * 1.2:
                findings["L2_overshoot"].append({
                    "case": label, "school": name, "category": cat,
                    "student_rank": rank, "school_avg_rank": avg,
                    "prob": prob,
                    "issue": f"被分到「保」但学生位次{rank}差于学校均位{avg}（学生在该校录取线之外），不该是保底"
                })

            # L3. 档位与概率自相矛盾：surge prob>85，或 safe prob<40
            if cat == "surge" and prob > 88:
                findings["L3_misclassified"].append({
                    "case": label, "school": name, "category": cat,
                    "prob": prob,
                    "issue": f"分到「冲」但概率{prob}%（>88%，应入「保」或「稳」）"
                })
            if cat == "safe" and prob < 50:
                findings["L3_misclassified"].append({
                    "case": label, "school": name, "category": cat,
                    "prob": prob,
                    "issue": f"分到「保」但概率仅{prob}%（<50%，至多算「稳」）"
                })

            # L4. 低置信度 + 极端断言
            if conf == "低" and (prob >= 90 or prob <= 5):
                findings["L4_low_conf_extreme"].append({
                    "case": label, "school": name, "category": cat,
                    "prob": prob, "confidence": conf,
                    "issue": f"低置信度（数据不足）却给出极端概率{prob}%"
                })

        findings["stats_by_case"].append(case_stats)

    # ── 跨 case 一致性 ────────────────────────────────────────────
    # L5. 重叠学校在不同 case 间的位次预测漂移
    school_rank_by_case = defaultdict(list)  # name -> [(label, avg_rank, prob, student_rank, prov)]
    for c in bundle["cases"]:
        if c["status"] != 200:
            continue
        for s in all_schools(c["data"]):
            school_rank_by_case[s["school_name"]].append({
                "case": c["label"], "avg": s.get("avg_min_rank_3yr", 0),
                "prob": s.get("probability", 0), "student_rank": c["rank"],
                "prov": c["province"], "subj": c["subject"]
            })

    # 对每个跨 ≥3 case 出现的学校，看 same prov 内 avg 漂移
    for name, recs in school_rank_by_case.items():
        # 同省 same subject 但不同 student rank → school avg 应基本一致（仅 ±5%）
        from collections import defaultdict as dd
        bucket = dd(list)
        for r in recs:
            bucket[(r["prov"], r["subj"])].append(r)
        for key, items in bucket.items():
            avgs = [x["avg"] for x in items if x["avg"] > 0]
            if len(avgs) >= 3:
                m = statistics.mean(avgs)
                if m == 0:
                    continue
                spread = (max(avgs) - min(avgs)) / m
                if spread > 0.30:
                    findings["L5_cross_drift"].append({
                        "school": name, "scope": f"{key[0]}/{key[1]}",
                        "avgs": avgs, "spread_pct": round(spread * 100, 1),
                        "issue": f"同省同选科下，该校 avg_rank 在不同位次查询里漂移 {round(spread*100)}%（应≤30%）"
                    })

    # L6. 顶尖位次缺重要学校
    # rank<=100 北京/物理 → 清华、北大必出现
    for c in bundle["cases"]:
        if c["status"] != 200:
            continue
        if c["rank"] > 200:
            continue
        names = {s["school_name"] for s in all_schools(c["data"])}
        expected = []
        if c["province"] == "北京":
            expected = ["清华大学", "北京大学"]
        elif c["province"] in ("江苏", "浙江", "广东"):
            expected = ["清华大学", "北京大学", "复旦大学", "上海交通大学"]
        for e in expected:
            if e not in names:
                findings["L6_missing_top"].append({
                    "case": c["label"], "missing": e,
                    "issue": f"顶尖位次（rank={c['rank']}）{c['province']}查询中未出现{e}"
                })

    # ── 摘要 ────────────────────────────────────────────
    findings["summary"]["errors"] = {
        "L1_unreachable": len(findings["L1_unreachable"]),
        "L2_overshoot": len(findings["L2_overshoot"]),
        "L3_misclassified": len(findings["L3_misclassified"]),
        "L4_low_conf_extreme": len(findings["L4_low_conf_extreme"]),
        "L5_cross_drift": len(findings["L5_cross_drift"]),
        "L6_missing_top": len(findings["L6_missing_top"]),
    }
    return findings


def main():
    b = latest_bundle()
    f = analyze(b)
    out_path = OUT_DIR / "findings_recommend.json"
    out_path.write_text(json.dumps(f, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] -> {out_path}")
    print("\n=== summary ===")
    print(json.dumps(f["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
