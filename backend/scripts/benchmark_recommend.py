#!/usr/bin/env python3
"""
推荐系统 Benchmark 测试用例

在旧库和新库上分别运行，对比推荐结果是否一致。
只读操作，不修改数据库。

用法（在 backend 目录）:
  python scripts/benchmark_recommend.py [--output old_bench.json]
  python scripts/benchmark_recommend.py --output new_bench.json --db gaokao_new.db
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal, init_db
from services.recommend_core import _run_recommend_core

# ── 测试场景定义 ──────────────────────────────────────────────────────────
# (省份, 首选科目, 位次, 标签)
# 位次按 percentile 选取：p10(高分), p25, p50(中位), p75, p90(低分)
# 对应大约 650分, 550分, 480分, 420分, 350分 区间

SCENARIOS = [
    # ── 3+1+2 省份 ──
    # 广东 物理类 (max_rank ~448k)
    ("广东", "物理+化学+生物", 30000, "广东-物理-高分"),
    ("广东", "物理+化学+生物", 80000, "广东-物理-中上"),
    ("广东", "物理+化学+生物", 155000, "广东-物理-中位"),
    ("广东", "物理+化学+生物", 250000, "广东-物理-中下"),
    ("广东", "物理+化学+生物", 380000, "广东-物理-低分"),
    # 广东 历史类 (max_rank ~288k)
    ("广东", "历史+政治+地理", 8000, "广东-历史-高分"),
    ("广东", "历史+政治+地理", 40000, "广东-历史-中上"),
    ("广东", "历史+政治+地理", 85000, "广东-历史-中位"),
    ("广东", "历史+政治+地理", 160000, "广东-历史-中下"),
    ("广东", "历史+政治+地理", 250000, "广东-历史-低分"),

    # 河南 物理类 (max_rank ~566k)
    ("河南", "物理+化学+生物", 50000, "河南-物理-高分"),
    ("河南", "物理+化学+生物", 130000, "河南-物理-中上"),
    ("河南", "物理+化学+生物", 260000, "河南-物理-中位"),
    ("河南", "物理+化学+生物", 400000, "河南-物理-中下"),
    ("河南", "物理+化学+生物", 520000, "河南-物理-低分"),
    # 河南 历史类 (max_rank ~355k)
    ("河南", "历史+政治+地理", 10000, "河南-历史-高分"),
    ("河南", "历史+政治+地理", 40000, "河南-历史-中上"),
    ("河南", "历史+政治+地理", 85000, "河南-历史-中位"),
    ("河南", "历史+政治+地理", 200000, "河南-历史-中下"),
    ("河南", "历史+政治+地理", 320000, "河南-历史-低分"),

    # 湖北 物理类 (max_rank ~248k)
    ("湖北", "物理+化学+生物", 20000, "湖北-物理-高分"),
    ("湖北", "物理+化学+生物", 60000, "湖北-物理-中位"),
    ("湖北", "物理+化学+生物", 150000, "湖北-物理-中下"),
    ("湖北", "物理+化学+生物", 220000, "湖北-物理-低分"),

    # ── 3+3 省份 ──
    # 浙江 综合 (max_rank ~291k)
    ("浙江", "物理+化学+生物", 15000, "浙江-高分"),
    ("浙江", "物理+化学+生物", 60000, "浙江-中上"),
    ("浙江", "物理+化学+生物", 120000, "浙江-中位"),
    ("浙江", "物理+化学+生物", 200000, "浙江-中下"),
    ("浙江", "物理+化学+生物", 270000, "浙江-低分"),
    # 浙江 文科选科
    ("浙江", "历史+政治+地理", 50000, "浙江-文科-中上"),
    ("浙江", "历史+政治+地理", 150000, "浙江-文科-中下"),

    # 山东 综合 (max_rank ~681k - 综合类)
    ("山东", "物理+化学+生物", 80000, "山东-高分"),
    ("山东", "物理+化学+生物", 240000, "山东-中位"),
    ("山东", "物理+化学+生物", 500000, "山东-中下"),
    ("山东", "物理+化学+生物", 650000, "山东-低分"),
    # 山东 文科选科
    ("山东", "历史+政治+地理", 150000, "山东-文科-中位"),
    ("山东", "历史+政治+地理", 400000, "山东-文科-中下"),

    # 上海 综合 (max_rank ~49k)
    ("上海", "物理+化学+生物", 5000, "上海-高分"),
    ("上海", "物理+化学+生物", 22000, "上海-中位"),
    ("上海", "物理+化学+生物", 40000, "上海-低分"),

    # ── 四川 物理类 (大数据省) ──
    ("四川", "物理+化学+生物", 40000, "四川-物理-高分"),
    ("四川", "物理+化学+生物", 130000, "四川-物理-中位"),
    ("四川", "物理+化学+生物", 260000, "四川-物理-低分"),
]


def run_one(db, province: str, rank: int, subject: str) -> dict:
    """执行单次推荐，返回摘要（捕获异常）。"""
    t0 = time.time()
    try:
        result = _run_recommend_core(
            province=province,
            rank=rank,
            subject=subject,
            mode="all",
            db=db,
            is_paid=True,
        )
        elapsed = time.time() - t0

        # 提取关键统计量（结果在 surge/stable/safe 三个分层中）
        all_entries = (result.get("surge") or []) + (result.get("stable") or []) + (result.get("safe") or [])
        summary = {
            "elapsed": round(elapsed, 2),
            "total_matched": result.get("total_matched", 0),
            "total_raw": result.get("total_raw", 0),
            "surge": len(result.get("surge") or []),
            "stable": len(result.get("stable") or []),
            "safe": len(result.get("safe") or []),
            "gems": len(result.get("hidden_gems") or []),
            "entries": [],
        }
        for c in all_entries[:30]:  # 保留前30条用于对比
            summary["entries"].append({
                "school": c.get("school_name", ""),
                "major": c.get("major_name", ""),
                "prob": c.get("probability"),
                "avg_rank": c.get("avg_min_rank_3yr"),
                "rank_diff": c.get("rank_diff"),
                "batch_type": c.get("batch_type", ""),
                "is_985": c.get("is_985", ""),
                "is_211": c.get("is_211", ""),
                "major_remark": (c.get("major_remark") or "")[:80],
            })
        return summary
    except Exception as e:
        return {"elapsed": time.time() - t0, "error": str(e), "candidates": []}


def main():
    parser = argparse.ArgumentParser(description="推荐系统 Benchmark")
    parser.add_argument("--output", default="bench_result.json", help="输出 JSON 路径")
    parser.add_argument("--db", default=None, help="数据库路径（默认使用项目默认库）")
    parser.add_argument("--scenarios", default=None, help="只跑指定标签（逗号分隔）")
    parser.add_argument("--limit", type=int, default=0, help="只跑前 N 个场景")
    args = parser.parse_args()

    # 如果指定了 db，通过环境变量覆盖
    if args.db:
        db_url = f"sqlite:///{os.path.abspath(args.db)}"
        os.environ["DATABASE_URL"] = db_url

    init_db()
    db = SessionLocal()

    filter_labels = set(s.strip() for s in (args.scenarios or "").split(",") if s.strip())
    scenarios = SCENARIOS
    if filter_labels:
        scenarios = [s for s in SCENARIOS if s[3] in filter_labels]
    if args.limit:
        scenarios = scenarios[:args.limit]

    results = {}
    total = len(scenarios)
    print(f"Benchmark: {total} 个场景")
    print(f"{'标签':25s} | {'省份':6s} | {'位次':>8s} | {'结果数':>6s} | {'耗时':>6s}")
    print("-" * 65)

    for i, (prov, subj, rank, label) in enumerate(scenarios):
        r = run_one(db, prov, rank, subj)
        results[label] = {
            "province": prov,
            "subject": subj,
            "rank": rank,
            **r,
        }
        n = r.get("total_matched", 0)
        err = r.get("error", "")
        status = f"ERR: {err[:30]}" if err else f"{n}条"
        print(f"{label:25s} | {prov:6s} | {rank:>8,} | {status:>6s} | {r['elapsed']:>5.1f}s")

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n结果已保存: {args.output}")

    # 简单统计
    ok = sum(1 for v in results.values() if "error" not in v)
    err_count = sum(1 for v in results.values() if "error" in v)
    avg_matched = sum(v.get("total_matched", 0) for v in results.values()) / max(ok, 1)
    avg_surge = sum(v.get("surge", 0) for v in results.values()) / max(ok, 1)
    avg_stable = sum(v.get("stable", 0) for v in results.values()) / max(ok, 1)
    avg_safe = sum(v.get("safe", 0) for v in results.values()) / max(ok, 1)
    print(f"成功: {ok}/{total}, 错误: {err_count}")
    print(f"平均: matched={avg_matched:.0f} surge={avg_surge:.0f} stable={avg_stable:.0f} safe={avg_safe:.0f}")

    db.close()


if __name__ == "__main__":
    main()
