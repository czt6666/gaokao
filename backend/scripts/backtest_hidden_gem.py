"""
冷门评分命中率回测
=================
验证：被标记为"冷门"的学校-专业，下一年录取是否真的更容易？

逻辑：
  - 用 2021-2024 数据检测哪些 school-major 会被标记为 Type C（触底机会）
  - 对比 2025 实际录取位次：位次上升（数字更大）= 更容易 = 命中
  - 统计命中率：命中数 / 被标记数

用法：
  python scripts/backtest_hidden_gem.py --province 广东
  python scripts/backtest_hidden_gem.py --all
"""
import sys, os, sqlite3, argparse, json
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from algorithms.hidden_gem import hidden_gem_type_c

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "gaokao.db")


def backtest_type_c(province: str):
    """回测 Type C（触底机会）的命中率"""
    conn = sqlite3.connect(DB_PATH)

    # 获取 2025 实际数据
    actual_2025 = {}
    rows = conn.execute("""
        SELECT school_name, major_name, min_rank
        FROM admission_records
        WHERE year = 2025 AND min_rank > 0 AND province = ?
    """, (province,)).fetchall()
    for school, major, rank in rows:
        actual_2025[(school, major)] = rank

    # 获取 2021-2024 历史数据（按 school-major 分组）
    history = defaultdict(list)
    rows = conn.execute("""
        SELECT school_name, major_name, year, min_rank
        FROM admission_records
        WHERE year >= 2021 AND year <= 2024 AND min_rank > 0 AND province = ?
    """, (province,)).fetchall()
    for school, major, year, rank in rows:
        key = (school, major)
        if key in actual_2025:
            history[key].append({"year": year, "min_rank": rank})

    conn.close()

    # 对每个 school-major，用 2021-2024 数据运行 type_c 检测
    tagged = []
    not_tagged = []

    for key, records in history.items():
        if len(records) < 2:
            continue
        gem_c = hidden_gem_type_c(records, current_year=2025)
        actual_rank_2025 = actual_2025[key]
        last_hist_rank = max(records, key=lambda r: r["year"])["min_rank"]

        entry = {
            "school": key[0],
            "major": key[1],
            "last_hist_rank": last_hist_rank,
            "actual_2025_rank": actual_rank_2025,
            "rank_change": actual_rank_2025 - last_hist_rank,
            "change_pct": round((actual_rank_2025 - last_hist_rank) / last_hist_rank * 100, 1) if last_hist_rank > 0 else 0,
        }

        if gem_c:
            entry["decline_rate"] = gem_c.get("decline_rate", 0)
            entry["gem_score"] = gem_c.get("gem_score", 0)
            # 命中 = 2025 位次 >= 2024 位次（录取不变难或更容易）
            entry["hit"] = actual_rank_2025 >= last_hist_rank * 0.95  # 5%容差
            tagged.append(entry)
        else:
            not_tagged.append(entry)

    # 统计
    n_tagged = len(tagged)
    n_hit = sum(1 for t in tagged if t["hit"])
    hit_rate = n_hit / n_tagged if n_tagged > 0 else 0

    # 对比组：未被标记的 school-major 的平均位次变化
    control_changes = [e["change_pct"] for e in not_tagged if e["change_pct"] != 0]
    control_avg = sum(control_changes) / len(control_changes) if control_changes else 0

    tagged_changes = [e["change_pct"] for e in tagged]
    tagged_avg = sum(tagged_changes) / len(tagged_changes) if tagged_changes else 0

    result = {
        "province": province,
        "type_c_tagged": n_tagged,
        "type_c_hit": n_hit,
        "hit_rate": f"{hit_rate:.1%}",
        "tagged_avg_change_pct": f"{tagged_avg:+.1f}%",
        "control_avg_change_pct": f"{control_avg:+.1f}%",
        "advantage": f"{tagged_avg - control_avg:+.1f}pp",
    }

    return result, tagged


def main():
    parser = argparse.ArgumentParser(description="冷门评分命中率回测")
    parser.add_argument("--province", default="", help="省份")
    parser.add_argument("--all", action="store_true", help="所有省份")
    parser.add_argument("--detail", action="store_true", help="打印每条命中/未命中")
    args = parser.parse_args()

    if args.all:
        conn = sqlite3.connect(DB_PATH)
        provinces = [r[0] for r in conn.execute("""
            SELECT DISTINCT province FROM admission_records
            WHERE year = 2025 AND min_rank > 0
            ORDER BY province
        """).fetchall()]
        conn.close()

        total_tagged = 0
        total_hit = 0
        for prov in provinces[:15]:
            r, tagged = backtest_type_c(prov)
            total_tagged += r["type_c_tagged"]
            total_hit += r["type_c_hit"]
            if r["type_c_tagged"] > 0:
                print(f"{prov}: tagged={r['type_c_tagged']}, hit={r['type_c_hit']}, "
                      f"rate={r['hit_rate']}, tagged_avg={r['tagged_avg_change_pct']}, "
                      f"control_avg={r['control_avg_change_pct']}, advantage={r['advantage']}")

        if total_tagged > 0:
            print(f"\n=== 总计: tagged={total_tagged}, hit={total_hit}, "
                  f"rate={total_hit/total_tagged:.1%} ===")
    elif args.province:
        r, tagged = backtest_type_c(args.province)
        print(json.dumps(r, ensure_ascii=False, indent=2))
        if args.detail and tagged:
            print("\n--- 详细 ---")
            for t in sorted(tagged, key=lambda x: -x["change_pct"])[:20]:
                marker = "✓" if t["hit"] else "✗"
                print(f"  {marker} {t['school']} | {t['major']} | "
                      f"2024rank={t['last_hist_rank']} → 2025rank={t['actual_2025_rank']} "
                      f"({t['change_pct']:+.1f}%) gem_score={t['gem_score']}")
    else:
        print("用法: python scripts/backtest_hidden_gem.py --province 广东 --detail")
        print("      python scripts/backtest_hidden_gem.py --all")


if __name__ == "__main__":
    main()
