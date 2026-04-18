#!/usr/bin/env python3
"""
算法暴力测试 — 高考志愿推荐系统输出质量检验
用法：
  python test_algorithm_brutal.py                  # 测试服务器
  python test_algorithm_brutal.py --target local   # 测试本地
"""

import sys
import math
import time
import json
import argparse
import requests
from collections import defaultdict

# ── 配置 ─────────────────────────────────────────────────────────
SERVER_BASE  = "https://www.theyuanxi.cn"
LOCAL_BASE   = "http://localhost:8000"

PASS = "✅ PASS"
FAIL = "❌ FAIL"
WARN = "⚠️  WARN"
INFO = "ℹ️  INFO"

results_log = []   # (level, msg)
fail_count  = 0
warn_count  = 0
pass_count  = 0

# ── 工具函数 ──────────────────────────────────────────────────────

def log(level, msg):
    global fail_count, warn_count, pass_count
    tag = f"[{level}]"
    print(f"{tag} {msg}")
    results_log.append((level, msg))
    if level == FAIL: fail_count += 1
    elif level == WARN: warn_count += 1
    elif level == PASS: pass_count += 1


def api_call(base, rank, province, subject="物理", mode="all", timeout=30):
    """调用推荐 API，返回 (status_code, data)"""
    url = f"{base}/api/recommend"
    params = {"rank": rank, "province": province, "subject": subject, "mode": mode}
    try:
        r = requests.get(url, params=params, timeout=timeout)
        return r.status_code, r.json() if r.status_code == 200 else {}
    except requests.exceptions.ConnectionError:
        return -1, {}
    except requests.exceptions.Timeout:
        return -2, {}
    except Exception as e:
        return -3, {"error": str(e)}


def all_schools(data: dict) -> list:
    """从推荐结果中提取所有学校"""
    schools = []
    for key in ("surge", "stable", "safe"):
        schools.extend(data.get(key, []))
    return schools


def find_school(data: dict, name: str) -> dict | None:
    """在结果中查找特定学校"""
    for s in all_schools(data):
        if s.get("school_name") == name:
            return s
    return None


# ════════════════════════════════════════════════════════════════
# 第一层：极端输入测试
# ════════════════════════════════════════════════════════════════

def layer1_edge_inputs(base):
    print("\n" + "="*60)
    print("第一层：极端输入（边界值攻击）")
    print("="*60)

    cases = [
        # (rank, province, subject, desc, expect_non_empty, expect_status)
        (1,       "北京", "物理",   "全省第1名（顶尖）",       True,  200),
        (100,     "北京", "物理",   "全省第100名（清北线）",   True,  200),
        (200,     "广东", "物理",   "广东前200名",             True,  200),
        (8000,    "北京", "物理",   "正常中档位次（基准）",    True,  200),
        (50000,   "河南", "物理",   "大省中等偏下",            True,  200),
        (400000,  "河南", "物理",   "高考刚及格线",            False, 200),  # 可能空
        (600000,  "安徽", "历史",   "极低位次",                False, 200),  # 可能空
        (5000,    "西藏", "历史",   "数据稀疏省份-西藏",       False, 200),  # 允许空
        (5000,    "新疆", "物理",   "数据稀疏省份-新疆",       False, 200),  # 允许空
        (5000,    "青海", "物理",   "数据稀疏省份-青海",       False, 200),  # 允许空
        (0,       "北京", "物理",   "rank=0（无效）",          False, None), # 应报错
        (-1,      "北京", "物理",   "rank=-1（负数）",         False, None), # 应报错
    ]

    for rank, province, subject, desc, expect_non_empty, expect_status in cases:
        status, data = api_call(base, rank, province, subject)

        if status == -1:
            log(FAIL, f"{desc}: 无法连接到服务器")
            continue
        if status == -2:
            log(WARN, f"{desc}: 请求超时")
            continue

        total = len(all_schools(data))

        # 对 rank=0 / rank=-1，只要不是 500 就基本可接受
        if expect_status is None:
            if status == 500:
                log(FAIL, f"{desc} (rank={rank}): 返回 500 服务器崩溃，应返回 400/422")
            elif status in (400, 422):
                log(PASS, f"{desc} (rank={rank}): 正确拒绝无效输入 → HTTP {status}")
            elif status == 200 and total == 0:
                log(WARN, f"{desc} (rank={rank}): 返回 200 但空结果（期望 4xx）")
            else:
                log(WARN, f"{desc} (rank={rank}): 返回 HTTP {status}，结果数={total}")
            continue

        if status != 200:
            log(FAIL, f"{desc}: HTTP {status}（期望 200）")
            continue

        if expect_non_empty and total == 0:
            log(FAIL, f"{desc} (rank={rank}, {province}): 推荐结果为空（期望有结果）")
        elif not expect_non_empty and total == 0:
            log(WARN, f"{desc} (rank={rank}, {province}): 结果为空（数据不足，可接受）")
        elif total < 10 and expect_non_empty:
            log(WARN, f"{desc} (rank={rank}): 结果仅 {total} 所（少于预期96所）")
        else:
            log(PASS, f"{desc} (rank={rank}, {province}): {total} 所 ✓")

    # 专项：rank=1 顶尖生 — 清华/北大应该在列表里
    status, data = api_call(base, 1, "北京", "物理")
    if status == 200 and all_schools(data):
        top_schools = {s["school_name"] for s in all_schools(data)}
        for expected in ["清华大学", "北京大学"]:
            if expected in top_schools:
                log(PASS, f"rank=1 北京 物理 → {expected} 出现在推荐中 ✓")
            else:
                log(WARN, f"rank=1 北京 物理 → {expected} 未出现（可能位次窗口截断）")


# ════════════════════════════════════════════════════════════════
# 第二层：算法不变量检验
# ════════════════════════════════════════════════════════════════

def layer2_invariants(base):
    print("\n" + "="*60)
    print("第二层：算法不变量（数学正确性）")
    print("="*60)

    # 2A. 概率边界：所有学校 prob 必须在 [0, 100]，无 NaN/None/负数
    print("\n--- 2A. 概率边界检验 ---")
    status, data = api_call(base, 8000, "北京", "物理")
    if status == 200:
        schools = all_schools(data)
        for s in schools:
            p = s.get("probability")
            pl = s.get("prob_low")
            ph = s.get("prob_high")
            name = s.get("school_name", "?")

            if p is None or (isinstance(p, float) and math.isnan(p)):
                log(FAIL, f"概率为 None/NaN: {name}")
            elif not (0 <= p <= 100):
                log(FAIL, f"概率越界 {p:.1f}%: {name}")

            if pl is not None and ph is not None:
                if not (0 <= pl <= 100):
                    log(FAIL, f"prob_low 越界 {pl:.1f}%: {name}")
                if not (0 <= ph <= 100):
                    log(FAIL, f"prob_high 越界 {ph:.1f}%: {name}")
                if pl > p + 0.5:  # 允许微小浮点误差
                    log(FAIL, f"置信区间倒置 prob_low={pl} > prob={p}: {name}")
                if ph < p - 0.5:
                    log(FAIL, f"置信区间倒置 prob_high={ph} < prob={p}: {name}")
                interval = ph - pl
                if interval > 50:
                    log(WARN, f"置信区间过宽 [{pl},{ph}] (差{interval:.0f}pp): {name}")
                elif interval == 0:
                    log(WARN, f"置信区间为 0（数据假精确?）: {name}")

        log(INFO, f"概率边界检验完成，共检验 {len(schools)} 所学校")
    else:
        log(WARN, f"2A 基准查询失败（HTTP {status}），跳过")

    # 2B. 单调性：对同一所学校，位次越好概率越高
    print("\n--- 2B. 单调性检验 ---")
    base_status, base_data = api_call(base, 5000, "北京", "物理")
    if base_status == 200:
        sample_schools = [s["school_name"] for s in all_schools(base_data)[:10]]
        rank_ladder = [3000, 5000, 7000, 10000, 15000]
        rank_probs = {}
        for r in rank_ladder:
            st, dt = api_call(base, r, "北京", "物理")
            if st == 200:
                rank_probs[r] = {s["school_name"]: s["probability"] for s in all_schools(dt)}

        violations = []
        for school in sample_schools:
            probs = []
            for r in rank_ladder:
                p = rank_probs.get(r, {}).get(school)
                if p is not None:
                    probs.append((r, p))
            if len(probs) < 2:
                continue
            # 检查单调递减（位次越大，概率应越低）
            for i in range(len(probs) - 1):
                r1, p1 = probs[i]
                r2, p2 = probs[i+1]
                if p1 < p2 - 1.0:  # 允许 1pp 浮动（竞争惩罚可能影响）
                    violations.append(f"{school}: rank={r1}→prob={p1}%, rank={r2}→prob={p2}% (逆序 +{p2-p1:.1f}pp)")

        if violations:
            for v in violations:
                log(FAIL, f"单调性违反: {v}")
        else:
            log(PASS, f"单调性检验通过（{len(sample_schools)} 所学校 × {len(rank_ladder)} 个位次）")
    else:
        log(WARN, "2B 基准查询失败，跳过单调性检验")

    # 2C. 冲稳保分布验证
    print("\n--- 2C. 冲稳保分布验证 ---")
    for rank, province, subject in [(8000, "北京", "物理"), (30000, "广东", "物理"), (15000, "江苏", "历史")]:
        st, dt = api_call(base, rank, province, subject)
        if st != 200:
            log(WARN, f"查询失败: rank={rank} {province} {subject}")
            continue
        surge_n  = len(dt.get("surge", []))
        stable_n = len(dt.get("stable", []))
        safe_n   = len(dt.get("safe", []))
        total_n  = surge_n + stable_n + safe_n
        if total_n == 0:
            log(WARN, f"rank={rank} {province}: 结果为空")
            continue
        surge_r  = surge_n  / total_n * 100
        stable_r = stable_n / total_n * 100
        safe_r   = safe_n   / total_n * 100

        # 期望分布：冲 15-35% / 稳 35-55% / 保 15-35%
        ok = (10 <= surge_r <= 40) and (30 <= stable_r <= 60) and (10 <= safe_r <= 40)
        msg = f"rank={rank} {province}: 冲{surge_n}({surge_r:.0f}%) 稳{stable_n}({stable_r:.0f}%) 保{safe_n}({safe_r:.0f}%) 共{total_n}所"
        log(PASS if ok else WARN, msg)

    # 2D. 排序合理性：冲区均概率 < 稳区均概率 < 保区均概率
    print("\n--- 2D. 排序合理性 ---")
    st, dt = api_call(base, 8000, "北京", "物理")
    if st == 200:
        for group, name in [("surge", "冲"), ("stable", "稳"), ("safe", "保")]:
            items = dt.get(group, [])
            if items:
                avg_p = sum(s["probability"] for s in items) / len(items)
                probs = [s["probability"] for s in items]
                log(INFO, f"{name}区: {len(items)}所, 概率均值={avg_p:.1f}%, 范围=[{min(probs):.1f}%, {max(probs):.1f}%]")

        surge_avg  = sum(s["probability"] for s in dt.get("surge", []))  / max(1, len(dt.get("surge", [])))
        stable_avg = sum(s["probability"] for s in dt.get("stable", [])) / max(1, len(dt.get("stable", [])))
        safe_avg   = sum(s["probability"] for s in dt.get("safe", []))   / max(1, len(dt.get("safe", [])))

        if surge_avg < stable_avg < safe_avg:
            log(PASS, f"冲稳保均概率顺序正确: {surge_avg:.1f}% < {stable_avg:.1f}% < {safe_avg:.1f}%")
        else:
            log(FAIL, f"冲稳保均概率顺序异常: 冲={surge_avg:.1f}% 稳={stable_avg:.1f}% 保={safe_avg:.1f}%")


# ════════════════════════════════════════════════════════════════
# 第三层：数据纯洁性检验
# ════════════════════════════════════════════════════════════════

def layer3_data_purity(base):
    print("\n" + "="*60)
    print("第三层：数据纯洁性检验（宪法准则）")
    print("="*60)

    # 3A. 提前批污染：北航
    print("\n--- 3A. 提前批污染检测 ---")
    EARLY_BATCH_TESTS = [
        # (rank查询, province, school_name, expected_avg_rank_range, description)
        (8000,  "北京", "北京航空航天大学",  (1000, 4000),  "北航 — 提前批均位次约18k，普通批约1.6k"),
        (20000, "北京", "中国民航大学",       (10000, 80000), "民航大 — 飞行员提前批 vs 普通批"),
        (5000,  "北京", "北京体育大学",       (2000, 20000),  "北体大 — 运动员提前批 vs 文化课"),
    ]

    for rank, province, school_name, (lo, hi), desc in EARLY_BATCH_TESTS:
        st, dt = api_call(base, rank, province, "物理")
        if st != 200:
            log(WARN, f"查询失败: {desc}")
            continue
        school = find_school(dt, school_name)
        if school is None:
            log(INFO, f"{school_name}: 未出现在 rank={rank} 结果中（可能位次不匹配，无法验证）")
            continue
        avg = school.get("avg_min_rank_3yr", 0)
        if lo <= avg <= hi:
            log(PASS, f"{school_name} avg_rank={avg} 在预期范围 [{lo},{hi}] — 提前批过滤有效")
        else:
            log(FAIL, f"{school_name} avg_rank={avg} 超出预期范围 [{lo},{hi}] — 疑似提前批污染")

    # 3B. 专项计划污染：清华/北大
    print("\n--- 3B. 专项计划污染检测 ---")
    # 用极低位次查询，看清华是否以异常低的avg_rank出现
    SPECIAL_PLAN_TESTS = [
        ("北京",   "清华大学", 200,   "国家专项计划 rank=175 不应混入"),
        ("北京",   "北京大学", 200,   "国家专项计划 rank≈200 不应混入"),
        ("广东",   "清华大学", 300,   "广东清华专项计划"),
        ("湖南",   "中南大学", 1000,  "中南大地方专项计划"),
    ]
    for province, school_name, contaminated_rank, desc in SPECIAL_PLAN_TESTS:
        # 用 rank=500（普通生能看到的最强学校区间）查询
        st, dt = api_call(base, 500, province, "物理")
        if st != 200:
            continue
        school = find_school(dt, school_name)
        if school is None:
            # 用 rank=50 再试
            st2, dt2 = api_call(base, 50, province, "物理")
            if st2 == 200:
                school = find_school(dt2, school_name)
        if school is None:
            log(INFO, f"{school_name}({province}): 未出现在结果中（位次不匹配）")
            continue
        avg = school.get("avg_min_rank_3yr", 0)
        if avg <= contaminated_rank:
            log(FAIL, f"{school_name}({province}) avg_rank={avg} ≤ {contaminated_rank} — 专项计划污染！（{desc}）")
        elif avg <= contaminated_rank * 3:
            log(WARN, f"{school_name}({province}) avg_rank={avg} 偏低（专项污染临界？）— {desc}")
        else:
            log(PASS, f"{school_name}({province}) avg_rank={avg} — 专项计划未污染 ✓")

    # 3C. 专科批污染：所有学校均位次不应超过 200000
    print("\n--- 3C. 专科批污染检测 ---")
    for rank, province, subject in [(8000, "北京", "物理"), (50000, "河南", "物理")]:
        st, dt = api_call(base, rank, province, subject)
        if st != 200:
            continue
        contaminated = [s for s in all_schools(dt) if s.get("avg_min_rank_3yr", 0) > 200000]
        if contaminated:
            for s in contaminated:
                log(FAIL, f"专科批污染: {s['school_name']} avg_rank={s['avg_min_rank_3yr']} > 200000")
        else:
            log(PASS, f"rank={rank} {province}: 无专科批污染（所有学校均位次 ≤ 200000）")

    # 3D. 已知 Bug 回归：北航
    print("\n--- 3D. 已知 Bug 回归测试（北航）---")
    st, dt = api_call(base, 8000, "北京", "物理")
    if st == 200:
        bei_hang = find_school(dt, "北京航空航天大学")
        if bei_hang:
            avg = bei_hang.get("avg_min_rank_3yr", 0)
            prob = bei_hang.get("probability", 0)
            tier = "冲" if prob < 55 else ("稳" if prob < 82 else "保")
            if avg > 10000:
                log(FAIL, f"北航回归测试 FAIL: avg_rank={avg} > 10000，提前批污染仍存在！")
            elif tier == "保":
                log(FAIL, f"北航回归测试 FAIL: 出现在\"保\"区（prob={prob}%），avg_rank={avg}，不合理")
            else:
                log(PASS, f"北航回归测试 PASS: avg_rank={avg}，概率={prob}%，层次={tier}")
        else:
            log(INFO, "北航: 未出现在 rank=8000 结果中（位次不匹配，可能正常）")
            # 用 rank=2000 再查
            st2, dt2 = api_call(base, 2000, "北京", "物理")
            if st2 == 200:
                bei_hang2 = find_school(dt2, "北京航空航天大学")
                if bei_hang2:
                    avg2 = bei_hang2.get("avg_min_rank_3yr", 0)
                    log(INFO, f"北航 at rank=2000: avg_rank={avg2}，概率={bei_hang2.get('probability')}%")
                    if avg2 > 10000:
                        log(FAIL, f"北航回归测试 FAIL: avg_rank={avg2} > 10000，提前批污染！")
                    else:
                        log(PASS, f"北航回归测试 PASS: avg_rank={avg2}")
                else:
                    log(WARN, "北航: rank=2000 结果中也未出现")


# ════════════════════════════════════════════════════════════════
# 第四层：业务逻辑验证
# ════════════════════════════════════════════════════════════════

def layer4_business_logic(base):
    print("\n" + "="*60)
    print("第四层：业务逻辑验证")
    print("="*60)

    st, dt = api_call(base, 8000, "北京", "物理")
    if st != 200:
        log(WARN, "基准查询失败，跳过第四层")
        return

    schools = all_schools(dt)

    # 4A. 就业数据合理性
    print("\n--- 4A. 就业数据合理性 ---")
    salary_issues = []
    emp_rate_issues = []
    postgrad_issues = []
    for s in schools:
        name = s.get("school_name", "?")
        emp = s.get("employment_data") or {}
        salary = emp.get("avg_salary", 0)
        emp_rate = emp.get("employment_rate", None)
        postgrad = emp.get("postgrad_rate", None)

        if salary and not (2000 <= salary <= 60000):
            salary_issues.append(f"{name}: 月薪={salary}")
        if emp_rate is not None and not (0 <= emp_rate <= 1.0):
            emp_rate_issues.append(f"{name}: 就业率={emp_rate}")
        if postgrad is not None and not (0 <= postgrad <= 0.9):
            postgrad_issues.append(f"{name}: 深造率={postgrad}")

    if salary_issues:
        for issue in salary_issues:
            log(FAIL, f"就业数据异常-薪资: {issue}")
    else:
        log(PASS, f"就业薪资数据合理（{len(schools)} 所学校均在 2k-60k 范围）")

    if emp_rate_issues:
        for issue in emp_rate_issues:
            log(FAIL, f"就业数据异常-就业率: {issue}")
    else:
        log(PASS, "就业率数据合理（均在 0-100% 范围）")

    if postgrad_issues:
        for issue in postgrad_issues:
            log(FAIL, f"就业数据异常-深造率: {issue}")
    else:
        log(PASS, "深造率数据合理（均在 0-90% 范围）")

    # 4B. 冷门宝藏检验
    print("\n--- 4B. 冷门宝藏检验 ---")
    gems = dt.get("hidden_gems", [])
    log(INFO, f"冷门宝藏数量: {len(gems)} 所")

    gem_score_issues = []
    gem_type_issues  = []
    gem_surge_overlap = []
    valid_gem_types = {"A", "B", "C", "D", "E"}

    for g in gems:
        name = g.get("school_name", "?")
        gs = g.get("gem_score", 0)
        top_gem = g.get("top_gem") or {}
        gem_type = top_gem.get("gem_type", "")
        prob = g.get("probability", 0)

        if gs < 40:
            gem_score_issues.append(f"{name}: gem_score={gs} < 40")
        if gem_type and gem_type not in valid_gem_types:
            gem_type_issues.append(f"{name}: gem_type='{gem_type}' 非法")

    # gem 与 swarm（群体强推）同时标注检查
    for s in schools:
        if s.get("is_hidden_gem") and s.get("is_swarm_pick"):
            log(WARN, f"矛盾标注: {s.get('school_name')} 同时是 gem（冷门）和 swarm（群体强推）")

    if gem_score_issues:
        for i in gem_score_issues:
            log(WARN, f"gem_score 偏低: {i}")
    else:
        log(PASS, f"所有 gem 的 gem_score ≥ 40 ✓")

    if gem_type_issues:
        for i in gem_type_issues:
            log(FAIL, f"gem_type 非法: {i}")
    else:
        log(PASS, "所有 gem 的 gem_type 合法 ✓")

    # 4C. 推荐数量完整性
    print("\n--- 4C. 推荐数量完整性 ---")
    STANDARD_CASES = [
        (8000,  "北京", "物理"),
        (15000, "广东", "物理"),
        (5000,  "江苏", "历史"),
        (20000, "河南", "物理"),
        (8000,  "浙江", "物理"),
    ]
    for rank, prov, subj in STANDARD_CASES:
        st2, dt2 = api_call(base, rank, prov, subj)
        if st2 != 200:
            log(WARN, f"查询失败: {rank} {prov} {subj}")
            continue
        total = len(all_schools(dt2))
        expected = 96
        if total == expected:
            log(PASS, f"rank={rank} {prov} {subj}: {total}所 ✓")
        elif 60 <= total < expected:
            log(WARN, f"rank={rank} {prov} {subj}: {total}所（期望{expected}所，数据不足？）")
        elif total < 10:
            log(FAIL, f"rank={rank} {prov} {subj}: 仅{total}所（严重不足）")
        else:
            log(WARN, f"rank={rank} {prov} {subj}: {total}所（非标准值{expected}）")

    # 4D. 置信度分布检验
    print("\n--- 4D. 置信度分布 ---")
    conf_counts = defaultdict(int)
    for s in schools:
        conf_counts[s.get("confidence", "未知")] += 1
    total_s = len(schools)
    for conf, cnt in sorted(conf_counts.items()):
        pct = cnt / total_s * 100
        log(INFO, f"置信度 '{conf}': {cnt}所 ({pct:.0f}%)")
    low_pct = conf_counts.get("低", 0) / total_s * 100
    if low_pct > 50:
        log(WARN, f"低置信度学校过多（{low_pct:.0f}%），数据年份覆盖可能不足")
    else:
        log(PASS, f"置信度分布合理（低置信度 {low_pct:.0f}%）")


# ════════════════════════════════════════════════════════════════
# 第五层：跨维度一致性
# ════════════════════════════════════════════════════════════════

def layer5_consistency(base):
    print("\n" + "="*60)
    print("第五层：跨维度一致性")
    print("="*60)

    # 5A. 科目一致性：物理 vs 历史 结果不应大量重叠
    print("\n--- 5A. 科目一致性 ---")
    st_p, dt_p = api_call(base, 8000, "北京", "物理")
    st_h, dt_h = api_call(base, 8000, "北京", "历史")
    if st_p == 200 and st_h == 200:
        physics_names  = {s["school_name"] for s in all_schools(dt_p)}
        history_names  = {s["school_name"] for s in all_schools(dt_h)}
        overlap        = physics_names & history_names
        overlap_rate   = len(overlap) / max(1, max(len(physics_names), len(history_names))) * 100
        log(INFO, f"物理结果: {len(physics_names)}所, 历史结果: {len(history_names)}所, 重叠: {len(overlap)}所 ({overlap_rate:.0f}%)")
        if overlap_rate > 40:
            log(FAIL, f"科目过滤疑似失效：物理/历史重叠率 {overlap_rate:.0f}% > 40%")
        elif overlap_rate > 20:
            log(WARN, f"物理/历史重叠率 {overlap_rate:.0f}% 偏高（部分学校跨池招生属正常）")
        else:
            log(PASS, f"科目过滤有效：物理/历史重叠率 {overlap_rate:.0f}% ✓")

        # 列出重叠学校供人工核查
        if overlap:
            log(INFO, f"重叠学校样本（前5）: {list(overlap)[:5]}")

    # 5B. 省份一致性：中国人民大学在不同省份的 avg_rank 应基本一致
    print("\n--- 5B. 跨省 avg_rank 一致性 ---")
    SCHOOL = "中国人民大学"
    provinces_to_check = [
        ("北京", "物理", 3000),
        ("广东", "物理", 3000),
        ("江苏", "物理", 3000),
        ("浙江", "物理", 3000),
    ]
    renda_ranks = {}
    for prov, subj, test_rank in provinces_to_check:
        st2, dt2 = api_call(base, test_rank, prov, subj)
        if st2 != 200:
            continue
        s = find_school(dt2, SCHOOL)
        if s:
            renda_ranks[prov] = s.get("avg_min_rank_3yr", 0)
        else:
            log(INFO, f"{SCHOOL} 未出现在 {prov} rank={test_rank} 结果中")

    if len(renda_ranks) >= 2:
        vals = list(renda_ranks.values())
        avg_v = sum(vals) / len(vals)
        max_v, min_v = max(vals), min(vals)
        spread = (max_v - min_v) / avg_v * 100 if avg_v > 0 else 0
        for prov, rk in renda_ranks.items():
            log(INFO, f"  {SCHOOL} {prov}: avg_rank={rk}")
        if spread > 100:
            log(WARN, f"{SCHOOL} 跨省 avg_rank 差异过大（{spread:.0f}%），可能有省份数据质量问题")
        else:
            log(PASS, f"{SCHOOL} 跨省数据一致性正常（差异 {spread:.0f}%）")

    # 5C. 确定性：同一查询两次结果完全相同
    print("\n--- 5C. 查询确定性 ---")
    _, dt1 = api_call(base, 8000, "北京", "物理")
    time.sleep(1)
    _, dt2 = api_call(base, 8000, "北京", "物理")
    if dt1 and dt2:
        names1 = [s["school_name"] for s in all_schools(dt1)]
        names2 = [s["school_name"] for s in all_schools(dt2)]
        if names1 == names2:
            log(PASS, "查询确定性：两次相同查询结果完全一致 ✓")
        elif set(names1) == set(names2):
            log(WARN, "查询结果集相同但顺序不同（排序有随机性？）")
        else:
            diff = set(names1) ^ set(names2)
            log(FAIL, f"查询不确定性！同一参数两次结果不同，差异学校: {list(diff)[:5]}")


# ════════════════════════════════════════════════════════════════
# 第六层：特殊场景深挖
# ════════════════════════════════════════════════════════════════

def layer6_deep_cases(base):
    print("\n" + "="*60)
    print("第六层：特殊场景深挖")
    print("="*60)

    # 6A. 全省前50名 — 清华北大概率是否合理（应 >60%）
    print("\n--- 6A. 顶尖考生概率合理性 ---")
    st, dt = api_call(base, 50, "北京", "物理")
    if st == 200:
        for school_name in ["清华大学", "北京大学"]:
            s = find_school(dt, school_name)
            if s:
                p = s.get("probability", 0)
                avg = s.get("avg_min_rank_3yr", 0)
                if p < 50:
                    log(WARN, f"rank=50 → {school_name}: 概率仅 {p}%（期望 >50%），avg_rank={avg}")
                elif p > 99:
                    log(WARN, f"rank=50 → {school_name}: 概率 {p}% 过高（sigmoid 上溢?）")
                else:
                    log(PASS, f"rank=50 → {school_name}: 概率 {p}%，avg_rank={avg} ✓")
            else:
                log(INFO, f"rank=50 结果中未找到 {school_name}")

    # 6B. 高校层次完整性 — 985/211/双一流比例合理性
    print("\n--- 6B. 高校层次分布 ---")
    st, dt = api_call(base, 8000, "北京", "物理")
    if st == 200:
        tier_counts = defaultdict(int)
        for s in all_schools(dt):
            si = s.get("school_info") or {}
            if si.get("is_985"): tier_counts["985"] += 1
            elif si.get("is_211"): tier_counts["211"] += 1
            elif si.get("is_shuangyiliu"): tier_counts["双一流"] += 1
            else: tier_counts["普通"] += 1
        total = sum(tier_counts.values())
        for tier, cnt in sorted(tier_counts.items()):
            log(INFO, f"  {tier}: {cnt}所 ({cnt/max(1,total)*100:.0f}%)")

    # 6C. 学校名不重复检验
    print("\n--- 6C. 推荐结果去重检验 ---")
    st, dt = api_call(base, 8000, "北京", "物理")
    if st == 200:
        names = [s["school_name"] for s in all_schools(dt)]
        unique = set(names)
        if len(names) != len(unique):
            duplicates = [n for n in unique if names.count(n) > 1]
            log(FAIL, f"推荐结果存在重复学校！重复项: {duplicates[:5]}")
        else:
            log(PASS, f"推荐结果无重复学校（{len(names)} 所）✓")

    # 6D. 大小年检测数据合理性
    print("\n--- 6D. 大小年标记 ---")
    st, dt = api_call(base, 8000, "北京", "物理")
    if st == 200:
        big_small_count = sum(1 for s in all_schools(dt) if s.get("big_small_year"))
        log(INFO, f"标记大小年的学校: {big_small_count}所 / {len(all_schools(dt))}所")
        if big_small_count == 0:
            log(WARN, "无任何学校标记大小年（大小年检测可能未运行）")
        elif big_small_count > 50:
            log(WARN, f"大小年标记过多（{big_small_count}所），可能阈值太低")
        else:
            log(PASS, f"大小年标记数量合理: {big_small_count}所")


# ════════════════════════════════════════════════════════════════
# 主程序
# ════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["server", "local"], default="server")
    parser.add_argument("--layer", type=int, default=0, help="只运行指定层（0=全部）")
    args = parser.parse_args()

    base = SERVER_BASE if args.target == "server" else LOCAL_BASE
    print(f"\n{'='*60}")
    print(f"高考志愿推荐算法 — 暴力测试")
    print(f"目标: {base}")
    print(f"时间: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}")

    # 连通性检查
    try:
        r = requests.get(f"{base}/api/health", timeout=5)
        if r.status_code == 200:
            print(f"✅ 服务器连接正常: {r.json()}")
        else:
            print(f"⚠️  服务器响应异常: HTTP {r.status_code}")
    except Exception as e:
        print(f"❌ 无法连接服务器: {e}")
        sys.exit(1)

    t0 = time.time()

    if args.layer == 0 or args.layer == 1: layer1_edge_inputs(base)
    if args.layer == 0 or args.layer == 2: layer2_invariants(base)
    if args.layer == 0 or args.layer == 3: layer3_data_purity(base)
    if args.layer == 0 or args.layer == 4: layer4_business_logic(base)
    if args.layer == 0 or args.layer == 5: layer5_consistency(base)
    if args.layer == 0 or args.layer == 6: layer6_deep_cases(base)

    elapsed = time.time() - t0

    # 最终汇总
    total = pass_count + fail_count + warn_count
    print(f"\n{'='*60}")
    print(f"测试完成  用时 {elapsed:.1f}s")
    print(f"{'='*60}")
    print(f"总计: {total}项")
    print(f"  {PASS}: {pass_count}")
    print(f"  {FAIL}: {fail_count}")
    print(f"  {WARN}: {warn_count}")

    if fail_count > 0:
        print(f"\n【严重 Bug 清单】")
        for level, msg in results_log:
            if level == FAIL:
                print(f"  ❌ {msg}")

    if warn_count > 0:
        print(f"\n【警告清单】")
        for level, msg in results_log:
            if level == WARN:
                print(f"  ⚠️  {msg}")

    print()
    sys.exit(0 if fail_count == 0 else 1)


if __name__ == "__main__":
    main()
