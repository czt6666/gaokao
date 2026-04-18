"""
回测框架：用2021-2024训练 → 预测2025 → 对比实际
===============================================
验证概率校准质量：当预测70%概率时，实际命中率是否接近70%
参考 CollegeVine 校准方法论

用法：
  python scripts/backtest_calibration.py --province 广东 --subject 物理
  python scripts/backtest_calibration.py --all
"""
import sys, os, json, argparse, sqlite3
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from algorithms.rank_method import predict_admission
from algorithms.population_data import get_province_total

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "gaokao.db")


def get_backtest_pairs(conn, province: str, subject_filter: str = ""):
    """获取有2025实际数据 + 2021-2024历史数据的学校-专业对"""
    # 2025年实际数据
    actual_2025 = {}
    rows = conn.execute("""
        SELECT school_name, major_name, min_rank, subject_req
        FROM admission_records
        WHERE year = 2025 AND min_rank > 0 AND province = ?
    """, (province,)).fetchall()
    for school, major, rank, subj in rows:
        if subject_filter and subject_filter not in (subj or ""):
            continue
        actual_2025[(school, major)] = rank

    # 2021-2024历史数据
    history = defaultdict(list)
    rows = conn.execute("""
        SELECT school_name, major_name, year, min_rank, min_score
        FROM admission_records
        WHERE year >= 2021 AND year <= 2024 AND min_rank > 0 AND province = ?
    """, (province,)).fetchall()
    for school, major, year, rank, score in rows:
        key = (school, major)
        if key in actual_2025:
            history[key].append({"year": year, "min_rank": rank, "min_score": score or 0})

    # 只保留有3+年历史数据的
    valid = {}
    for key, records in history.items():
        if len(records) >= 2:  # 至少2年历史才能预测
            valid[key] = {
                "history": sorted(records, key=lambda x: x["year"]),
                "actual_2025_rank": actual_2025[key],
            }
    return valid


def run_backtest(province: str, subject_filter: str = ""):
    """对指定省份运行回测"""
    conn = sqlite3.connect(DB_PATH)
    pairs = get_backtest_pairs(conn, province, subject_filter)

    if not pairs:
        print(f"  {province}: 无可用回测数据")
        conn.close()
        return None

    # 模拟不同位次的考生
    province_total = get_province_total(province, 2025)
    # 用2025实际数据的中位rank作为考生位次样本
    all_actual_ranks = sorted([v["actual_2025_rank"] for v in pairs.values()])
    test_ranks = []
    for pct in [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]:
        idx = int(len(all_actual_ranks) * pct)
        test_ranks.append(all_actual_ranks[min(idx, len(all_actual_ranks) - 1)])

    # 概率桶统计
    buckets = defaultdict(lambda: {"predicted": 0, "actual_admitted": 0})

    predictions_count = 0
    for (school, major), data in pairs.items():
        for candidate_rank in test_ranks:
            # 用predict_admission（只用2021-2024数据）
            pred = predict_admission(
                candidate_rank=candidate_rank,
                school_records=data["history"],
                province=province,
            )
            prob = pred.get("probability", 0) or 0

            # 2025实际结果：如果考生位次 <= 实际录取位次，视为"会被录取"
            actual_admitted = 1 if candidate_rank <= data["actual_2025_rank"] else 0

            # 按10%桶分组
            bucket = int(prob // 10) * 10  # 0,10,20,...90
            bucket = min(bucket, 90)
            buckets[bucket]["predicted"] += 1
            buckets[bucket]["actual_admitted"] += actual_admitted
            predictions_count += 1

    conn.close()

    # 计算校准结果
    results = {
        "province": province,
        "subject": subject_filter or "all",
        "total_pairs": len(pairs),
        "total_predictions": predictions_count,
        "calibration": {},
        "ece": 0.0,  # Expected Calibration Error
    }

    ece_sum = 0
    ece_weight = 0
    for bucket in sorted(buckets.keys()):
        b = buckets[bucket]
        n = b["predicted"]
        actual_rate = b["actual_admitted"] / n if n > 0 else 0
        expected_mid = (bucket + 5) / 100  # bucket中位数
        error = abs(actual_rate - expected_mid)
        ece_sum += error * n
        ece_weight += n
        results["calibration"][f"{bucket}-{bucket+10}%"] = {
            "count": n,
            "predicted_mid": f"{expected_mid:.0%}",
            "actual_rate": f"{actual_rate:.1%}",
            "error": f"{error:.1%}",
        }

    results["ece"] = round(ece_sum / ece_weight, 4) if ece_weight > 0 else 0
    return results


def main():
    parser = argparse.ArgumentParser(description="概率校准回测")
    parser.add_argument("--province", default="", help="省份")
    parser.add_argument("--subject", default="", help="选科过滤（物理/历史）")
    parser.add_argument("--all", action="store_true", help="跑所有有2025数据的省份")
    args = parser.parse_args()

    if args.all:
        conn = sqlite3.connect(DB_PATH)
        provinces = [r[0] for r in conn.execute("""
            SELECT DISTINCT province FROM admission_records
            WHERE year = 2025 AND min_rank > 0
            ORDER BY province
        """).fetchall()]
        conn.close()

        all_results = []
        for prov in provinces[:10]:  # top 10省份
            print(f"回测: {prov}...")
            r = run_backtest(prov, args.subject)
            if r:
                all_results.append(r)
                print(f"  pairs={r['total_pairs']}, ECE={r['ece']:.4f}")
                for bk, bv in sorted(r["calibration"].items()):
                    print(f"    {bk}: n={bv['count']}, predicted={bv['predicted_mid']}, actual={bv['actual_rate']}, err={bv['error']}")

        if all_results:
            avg_ece = sum(r["ece"] for r in all_results) / len(all_results)
            print(f"\n=== 平均ECE: {avg_ece:.4f} ===")
            print(f"(CollegeVine参考: ECE≈0.02, 我们的校准目标: ECE<0.05)")
    elif args.province:
        r = run_backtest(args.province, args.subject)
        if r:
            print(json.dumps(r, ensure_ascii=False, indent=2))
    else:
        print("用法: python scripts/backtest_calibration.py --province 广东 --subject 物理")
        print("      python scripts/backtest_calibration.py --all")


if __name__ == "__main__":
    main()
