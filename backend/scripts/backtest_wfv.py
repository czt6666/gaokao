"""
Walk-Forward Validation 回测脚本（缺陷5修复）
================================================
严格的前向验证：每轮预测年份的校准器只用该年份之前的数据重新训练。

这是 v3 白皮书承诺的 WFV 基础设施。之前的 backtest_calibration.py 是单轮回测，
校准器用固定表（训练于 2021-2023，验证于 2024），存在数据泄露风险。

本脚本做法：
  预测 2023：校准器只用 2019-2022 数据重新拟合
  预测 2024：校准器只用 2019-2023 数据重新拟合
  预测 2025：校准器只用 2019-2024 数据重新拟合

用法：
  python scripts/backtest_wfv.py --province 广东
  python scripts/backtest_wfv.py --all
"""
import sys, os, json, argparse, sqlite3, bisect
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from algorithms.rank_method import predict_admission

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "gaokao.db")

# 测试年份：必须确保数据库中有该年的 admission_records 实际数据
TEST_YEARS = [2023, 2024, 2025]

# 训练时用于生成多样化考生位次的百分位采样点
# 用5个点代替9个，减少校准器拟合阶段的计算量
TRAIN_RANK_PCTS = [0.1, 0.3, 0.5, 0.7, 0.9]

# 验证时用9个点，更密集的覆盖
TEST_RANK_PCTS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]


def get_pairs_for_year(conn, province, test_year, min_hist=2):
    """获取在 test_year 有实际数据、且在 test_year 之前有至少 min_hist 年历史的对。"""
    actual = {}
    rows = conn.execute(
        """SELECT school_name, major_name, min_rank
           FROM admission_records
           WHERE year = ? AND min_rank > 0 AND province = ?""",
        (test_year, province),
    ).fetchall()
    for school, major, rank in rows:
        actual[(school, major)] = rank

    history = defaultdict(list)
    rows = conn.execute(
        """SELECT school_name, major_name, year, min_rank, min_score, plan_count
           FROM admission_records
           WHERE year < ? AND min_rank > 0 AND province = ?""",
        (test_year, province),
    ).fetchall()
    for school, major, year, rank, score, plan in rows:
        key = (school, major)
        if key in actual:
            history[key].append(
                {
                    "year": year,
                    "min_rank": rank,
                    "min_score": score or 0,
                    "plan_count": plan or 0,
                }
            )

    valid = {}
    for key, records in history.items():
        if len(records) >= min_hist:
            valid[key] = {
                "history": sorted(records, key=lambda x: x["year"]),
                "actual_rank": actual[key],
            }
    return valid


def _make_test_ranks(all_ranks, pcts):
    """从实际录取位次列表中按百分位提取测试位次。"""
    if not all_ranks:
        return []
    test_ranks = []
    for pct in pcts:
        idx = int(len(all_ranks) * pct)
        test_ranks.append(all_ranks[min(idx, len(all_ranks) - 1)])
    return test_ranks


def collect_training_samples(conn, province, train_end_year):
    """
    收集用于拟合校准器的训练样本。
    对 [train_end_year-4, train_end_year-1] 内的每一年 target_year：
      - 用 target_year 之前的历史数据预测 target_year
      - 返回 (raw_prob, actual_admitted) 列表
    """
    samples = []
    for target_year in range(train_end_year - 4, train_end_year):
        if target_year < 2019:
            continue
        pairs = get_pairs_for_year(conn, province, target_year, min_hist=2)
        if not pairs:
            continue

        all_ranks = sorted([v["actual_rank"] for v in pairs.values()])
        test_ranks = _make_test_ranks(all_ranks, TRAIN_RANK_PCTS)
        if not test_ranks:
            continue

        for data in pairs.values():
            for candidate_rank in test_ranks:
                pred = predict_admission(
                    candidate_rank=candidate_rank,
                    school_records=data["history"],
                    current_year=target_year,
                    province=province,
                    skip_calibration=True,
                )
                raw_prob = (pred.get("probability", 0) or 0) / 100.0
                actual_admitted = 1 if candidate_rank <= data["actual_rank"] else 0
                samples.append((raw_prob, actual_admitted))

    return samples


def fit_piecewise_linear(samples, n_bins=10):
    """
    用 (raw_prob, actual_admitted) 样本拟合分段线性校准表。
    分 n_bins 个等宽桶，计算每个桶的实际录取率。
    返回 [(raw, actual), ...]，已排序，含边界锚点 (0,0) 和 (1,1)。
    """
    if not samples:
        return [(0.0, 0.0), (1.0, 1.0)]

    buckets = defaultdict(lambda: {"sum": 0, "count": 0})
    for raw_prob, actual in samples:
        bin_idx = min(n_bins - 1, int(raw_prob * n_bins))
        buckets[bin_idx]["sum"] += actual
        buckets[bin_idx]["count"] += 1

    points = [(0.0, 0.0)]
    for i in range(n_bins):
        b = buckets.get(i, {"sum": 0, "count": 0})
        if b["count"] > 0:
            raw_mid = (i + 0.5) / n_bins
            actual_rate = b["sum"] / b["count"]
            points.append((raw_mid, actual_rate))
    points.append((1.0, 1.0))

    # 去重并排序（以 raw 为主键）
    seen = set()
    unique = []
    for r, a in sorted(points, key=lambda x: x[0]):
        if r not in seen:
            seen.add(r)
            unique.append((r, a))
    return unique


def _interpolate_table(raw_prob, table):
    """分段线性插值（calibration.py 的简化内联版）。"""
    raw_vals = [p[0] for p in table]
    actual_vals = [p[1] for p in table]
    idx = bisect.bisect_left(raw_vals, raw_prob)
    if idx == 0:
        return actual_vals[0]
    if idx >= len(table):
        return actual_vals[-1]
    x0, y0 = raw_vals[idx - 1], actual_vals[idx - 1]
    x1, y1 = raw_vals[idx], actual_vals[idx]
    if x1 == x0:
        return y0
    t = (raw_prob - x0) / (x1 - x0)
    return max(0.0, min(1.0, y0 + t * (y1 - y0)))


def run_wfv_fold(conn, province, test_year, cal_table):
    """对单一年份运行验证，使用给定的校准表。"""
    pairs = get_pairs_for_year(conn, province, test_year, min_hist=2)
    if not pairs:
        return None

    all_ranks = sorted([v["actual_rank"] for v in pairs.values()])
    test_ranks = _make_test_ranks(all_ranks, TEST_RANK_PCTS)
    if not test_ranks:
        return None

    buckets = defaultdict(lambda: {"predicted": 0, "actual_admitted": 0})
    total_predictions = 0

    for data in pairs.values():
        for candidate_rank in test_ranks:
            pred = predict_admission(
                candidate_rank=candidate_rank,
                school_records=data["history"],
                current_year=test_year,
                province=province,
                skip_calibration=True,  # 我们自己做校准
            )
            raw_prob = (pred.get("probability", 0) or 0) / 100.0
            prob = _interpolate_table(raw_prob, cal_table)

            actual_admitted = 1 if candidate_rank <= data["actual_rank"] else 0

            bucket = int(prob * 10) * 10
            bucket = min(bucket, 90)
            buckets[bucket]["predicted"] += 1
            buckets[bucket]["actual_admitted"] += actual_admitted
            total_predictions += 1

    ece_sum = 0
    ece_weight = 0
    calib = {}
    for bucket in sorted(buckets.keys()):
        b = buckets[bucket]
        n = b["predicted"]
        actual_rate = b["actual_admitted"] / n if n > 0 else 0
        expected_mid = (bucket + 5) / 100
        error = abs(actual_rate - expected_mid)
        ece_sum += error * n
        ece_weight += n
        calib[f"{bucket}-{bucket+10}%"] = {
            "count": n,
            "predicted_mid": f"{expected_mid:.0%}",
            "actual_rate": f"{actual_rate:.1%}",
            "error": f"{error:.1%}",
        }

    ece = round(ece_sum / ece_weight, 4) if ece_weight > 0 else 0
    return {
        "province": province,
        "test_year": test_year,
        "total_pairs": len(pairs),
        "total_predictions": total_predictions,
        "calibration_points": cal_table,
        "calibration": calib,
        "ece": ece,
    }


def run_province_wfv(province):
    """对一个省份跑完整 WFV（2023/2024/2025 三轮）。"""
    conn = sqlite3.connect(DB_PATH)
    all_fold_results = []

    for test_year in TEST_YEARS:
        print(f"  [{province}] 预测 {test_year} ...")

        # 1. 拟合校准器（只用 test_year 之前的数据）
        train_samples = collect_training_samples(conn, province, test_year)
        print(f"    训练样本数: {len(train_samples)}")
        if len(train_samples) < 200:
            print(f"    训练样本不足，跳过该轮")
            continue

        cal_table = fit_piecewise_linear(train_samples, n_bins=10)
        print(f"    校准锚点: {cal_table}")

        # 2. 验证
        result = run_wfv_fold(conn, province, test_year, cal_table)
        if result:
            print(
                f"    pairs={result['total_pairs']}, "
                f"predictions={result['total_predictions']}, ECE={result['ece']:.4f}"
            )
            all_fold_results.append(result)

    conn.close()

    if not all_fold_results:
        return None

    avg_ece = sum(r["ece"] for r in all_fold_results) / len(all_fold_results)
    return {
        "province": province,
        "folds": all_fold_results,
        "avg_ece": avg_ece,
    }


def main():
    parser = argparse.ArgumentParser(description="Walk-Forward Validation 回测")
    parser.add_argument("--province", default="", help="省份")
    parser.add_argument("--all", action="store_true", help="跑所有有数据的省份")
    args = parser.parse_args()

    if args.all:
        conn = sqlite3.connect(DB_PATH)
        provinces = [
            r[0]
            for r in conn.execute(
                """SELECT DISTINCT province FROM admission_records
                   WHERE year >= 2023 AND min_rank > 0
                   ORDER BY province"""
            ).fetchall()
        ]
        conn.close()

        all_results = []
        for prov in provinces:
            print(f"\n=== {prov} ===")
            r = run_province_wfv(prov)
            if r:
                all_results.append(r)
                print(f"  {prov} 平均ECE: {r['avg_ece']:.4f}")

        if all_results:
            overall_ece = sum(r["avg_ece"] for r in all_results) / len(all_results)
            print(f"\n\n====== 总体平均 ECE (WFV): {overall_ece:.4f} ======")
            print("注：这是严格的前向验证结果，预计比单轮回测的 0.028 略高。")
            print("CollegeVine 参考: ECE≈0.02, 校准目标: ECE<0.05")
    elif args.province:
        r = run_province_wfv(args.province)
        if r:
            print(json.dumps(r, ensure_ascii=False, indent=2))
    else:
        print("用法: python scripts/backtest_wfv.py --province 广东")
        print("      python scripts/backtest_wfv.py --all")


if __name__ == "__main__":
    main()
