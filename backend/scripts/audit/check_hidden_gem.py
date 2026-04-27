"""检验 hidden_gem（冷门）标签的真实性。

「真冷门」的合理特征：
  C1. 不是 985 综合排名 Top 50（清华/北大/复旦/交大不可能是冷门）
  C2. 不是 "985 + 综合排名 ≤ 30" 的明显热门校
  C3. 学校所在城市不是「北京/上海/广州/深圳」（除非 gem_type=B 是专业层冷门）
  C4. avg_min_rank_3yr 在该 case（同省同选科）所有学校中位数偏后（即"录取相对容易"）
  C5. 在我们的多 case 数据里，被反复推 → 多 case 命中说明 gem 标签稳定

我们对每个 gem 学校算一个"冷门可信度分"（0-100，越高越像真冷门），
并按这个分排序，列出最低/最高条目供人工核查。
"""
import json
import statistics
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).parent / "out"
b = json.load(open(list(OUT.glob("recommend_local_*.json"))[-1], encoding="utf-8"))

HOT_CITIES = {"北京", "上海", "广州", "深圳"}
HOT_TIER1_CITIES = HOT_CITIES | {"杭州", "南京", "成都", "武汉", "西安"}

# 软科前 30 / 前 50 名单（粗略）
SOFTSCIENCE_TOP30_NAMES = {
    "清华大学", "北京大学", "复旦大学", "上海交通大学", "浙江大学", "中国科学技术大学",
    "南京大学", "中国人民大学", "北京师范大学", "武汉大学", "中山大学", "华中科技大学",
    "天津大学", "西安交通大学", "南开大学", "哈尔滨工业大学", "北京航空航天大学",
    "北京理工大学", "东南大学", "同济大学", "华南理工大学", "东北大学", "大连理工大学",
    "山东大学", "厦门大学", "湖南大学", "中南大学", "电子科技大学", "重庆大学", "中国农业大学",
}

results = {
    "case_summaries": [],
    "all_gems": [],          # 所有 gem 条目 + 可信度
    "suspicious_gems": [],   # 可信度 ≤ 40 的可疑标签
}


def _truthy(v):
    """字段值可能是 True/False 或 中文「是」/「否」/「" "」"""
    if v is True or v == "是" or v == 1:
        return True
    return False

def credibility(school, gem, case_avg_rank_median, student_rank, student_province):
    score = 50.0
    reasons = []
    name = school.get("school_name", "")
    si = school.get("school_info") or {}
    city = school.get("city", "") or si.get("city", "")
    is_985 = _truthy(si.get("is_985")) or _truthy(school.get("is_985"))
    is_211 = _truthy(si.get("is_211")) or _truthy(school.get("is_211"))
    rank_2025 = si.get("rank_2025", 0) or school.get("rank_2025", 0) or 0
    avg_rank = school.get("avg_min_rank_3yr", 0)
    gem_type = (gem or {}).get("gem_type", "")

    # C1. 软科 Top 30 强一律不像冷门
    if name in SOFTSCIENCE_TOP30_NAMES:
        score -= 35; reasons.append("软科Top30")
    elif rank_2025 and rank_2025 <= 50:
        score -= 25; reasons.append(f"软科第{rank_2025}名")
    elif rank_2025 and rank_2025 <= 100:
        score -= 10; reasons.append(f"软科第{rank_2025}名")
    elif rank_2025 and rank_2025 >= 200:
        score += 15; reasons.append(f"软科{rank_2025}名以外")

    # C2. 985+城市热 → 不冷
    if is_985 and city in HOT_CITIES:
        score -= 25; reasons.append(f"985+热城（{city}）")
    elif is_985:
        score -= 10; reasons.append("985校")
    elif is_211 and city in HOT_CITIES:
        score -= 5; reasons.append(f"211+热城")

    # C3. gem_type B (专业冷门) 应该允许学校在热城
    # 但 gem_type A (城市冷专业强) 学校城市必须不热
    if gem_type == "A" and city in HOT_TIER1_CITIES:
        score -= 30; reasons.append(f"标A型(城市冷)但城市={city}")
    if gem_type == "D" and rank_2025 and rank_2025 <= 100:
        score -= 25; reasons.append(f"标D型(排名低)但软科{rank_2025}名")

    # C4. 录取位次 vs 同 case 中位数
    if avg_rank > 0 and case_avg_rank_median > 0:
        ratio = avg_rank / case_avg_rank_median
        if ratio >= 1.3:
            score += 15; reasons.append(f"录取位次比同 case 中位数靠后{round(ratio*100)}%")
        elif ratio < 0.7:
            score -= 15; reasons.append(f"录取位次比同 case 中位数靠前（更难进）{round(ratio*100)}%")

    # C5. 学生位次 vs 学校位次：合理"够得着"才有意义
    if avg_rank and student_rank:
        # gem 应该是"学生有可能进的相对冷门" — student_rank 与 school_avg 不能差太多
        gap = (avg_rank - student_rank) / max(student_rank, 1)
        if gap < -0.3:
            score -= 10; reasons.append(f"学校比学生rank高{round(-gap*100)}%（学生进不去）")
        elif gap > 1.0:
            score -= 8; reasons.append(f"学校比学生rank低{round(gap*100)}%（学生屈才）")

    return round(max(0, min(100, score)), 1), reasons


for c in b["cases"]:
    if c["status"] != 200:
        continue
    data = c["data"]
    gems = data.get("hidden_gems", [])

    # 该 case 所有学校 avg_rank 中位数
    all_avgs = [s.get("avg_min_rank_3yr", 0) for s in data.get("surge", []) + data.get("stable", []) + data.get("safe", []) if s.get("avg_min_rank_3yr", 0) > 0]
    case_med = statistics.median(all_avgs) if all_avgs else 0

    case_sum = {
        "case": c["label"], "rank": c["rank"], "subject": c["subject"],
        "n_gems": len(gems), "case_avg_rank_med": case_med,
        "gem_types": defaultdict(int),
        "gem_985_count": 0, "gem_211_count": 0,
        "gem_top30_count": 0, "gem_hot_city_count": 0,
        "credibility_distribution": defaultdict(int),
        "low_cred_examples": [],
    }
    for g in gems:
        si = g.get("school_info") or {}
        city = g.get("city", "") or si.get("city", "")
        is_985 = _truthy(si.get("is_985")) or _truthy(g.get("is_985"))
        is_211 = _truthy(si.get("is_211")) or _truthy(g.get("is_211"))
        rank_2025 = si.get("rank_2025", 0) or g.get("rank_2025", 0) or 0
        top_gem = g.get("top_gem") or {}
        gtype = top_gem.get("gem_type", "?")
        case_sum["gem_types"][gtype] += 1
        if is_985: case_sum["gem_985_count"] += 1
        if is_211: case_sum["gem_211_count"] += 1
        if g.get("school_name") in SOFTSCIENCE_TOP30_NAMES: case_sum["gem_top30_count"] += 1
        if city in HOT_CITIES: case_sum["gem_hot_city_count"] += 1

        cred, reasons = credibility(g, top_gem, case_med, c["rank"], c["province"])
        bucket = "高(≥70)" if cred >= 70 else "中(40-70)" if cred >= 40 else "低(<40)"
        case_sum["credibility_distribution"][bucket] += 1

        entry = {
            "case": c["label"], "school": g["school_name"], "city": city,
            "is_985": is_985, "is_211": is_211, "rank_2025": rank_2025,
            "avg_rank": g.get("avg_min_rank_3yr", 0),
            "gem_type": gtype, "gem_score": top_gem.get("gem_score", 0),
            "credibility": cred, "reasons": reasons,
        }
        results["all_gems"].append(entry)
        if cred < 40:
            results["suspicious_gems"].append(entry)
            if len(case_sum["low_cred_examples"]) < 5:
                case_sum["low_cred_examples"].append({
                    "school": g["school_name"], "city": city,
                    "is_985": is_985, "rank_2025": rank_2025,
                    "gem_type": gtype, "credibility": cred,
                    "reasons": reasons,
                })

    case_sum["gem_types"] = dict(case_sum["gem_types"])
    case_sum["credibility_distribution"] = dict(case_sum["credibility_distribution"])
    results["case_summaries"].append(case_sum)

# ── 全局统计 ────────────────────────────────────────────
all_creds = [g["credibility"] for g in results["all_gems"]]
print(f"总 gem 标记数: {len(results['all_gems'])}")
print(f"可疑（可信度<40）: {len(results['suspicious_gems'])} 占 {len(results['suspicious_gems'])/max(1,len(results['all_gems']))*100:.0f}%")
if all_creds:
    print(f"可信度分布：均值 {statistics.mean(all_creds):.1f}, 中位 {statistics.median(all_creds)}")
    print(f"  高(≥70): {sum(1 for c in all_creds if c >= 70)} ({sum(1 for c in all_creds if c >= 70)/len(all_creds)*100:.0f}%)")
    print(f"  中(40-70): {sum(1 for c in all_creds if 40 <= c < 70)} ({sum(1 for c in all_creds if 40 <= c < 70)/len(all_creds)*100:.0f}%)")
    print(f"  低(<40): {sum(1 for c in all_creds if c < 40)} ({sum(1 for c in all_creds if c < 40)/len(all_creds)*100:.0f}%)")

# 985 / 软科Top30 比例
n = len(results["all_gems"])
n985 = sum(1 for g in results["all_gems"] if g["is_985"])
ntop30 = sum(1 for g in results["all_gems"] if g["school"] in SOFTSCIENCE_TOP30_NAMES)
nhot = sum(1 for g in results["all_gems"] if g["city"] in HOT_CITIES)
print(f"\ngem 中 985 占比: {n985}/{n} = {n985/max(n,1)*100:.0f}%")
print(f"gem 中 软科Top30 占比: {ntop30}/{n} = {ntop30/max(n,1)*100:.0f}%")
print(f"gem 中 北上广深 占比: {nhot}/{n} = {nhot/max(n,1)*100:.0f}%")

# 落盘
out = OUT / "findings_hidden_gem.json"
out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\n[OK] -> {out}")

# 抽样可疑gem
print("\n=== 可疑 gem 样例（前20）===")
for x in sorted(results["suspicious_gems"], key=lambda y: y["credibility"])[:20]:
    print(f"  {x['case']:<22s} {x['school']:<14s} city={x['city']:<8s} 985={x['is_985']} 软科={x['rank_2025']} gem_type={x['gem_type']} cred={x['credibility']:.0f}  {x['reasons']}")
