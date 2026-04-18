"""
backend/algorithms/swarm_predictor.py

群体智能预测层 — MiroFish思路本土化实现
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
核心思想：
  生成300个虚拟学生Agent，人格参数从真实录取/就业数据反推（非随机），
  让它们集体"选志愿"，涌现出的共识揭示统计概率模型低估的真正冷门。

性能：< 30ms / 次查询（numpy向量化，无LLM调用，零额外API成本）

四层架构中的位置：
  层0 (历史录取) → 层1 (就业/口碑) → 【层2 本模块】→ 层3 (行为校准)
"""

import math
import random
import numpy as np
from typing import Dict, List, Optional

# ── 省份参数缓存（启动后一次性初始化，避免重复查询）──────────────
_province_params_cache: Dict[str, Dict] = {}

# 全局默认参数（数据不足时的回退）
_DEFAULT_PARAMS = {
    "risk_tolerance_mean":  0.38,   # Beta(2,3)均值，偏保守
    "prestige_weight_mean": 0.60,   # 多数学生重视985/211
    "career_weight_mean":   0.55,   # 就业与学术均衡偏就业
    "city_weight_mean":     0.50,   # 中等城市偏好
    "gem_openness_mean":    0.28,   # 多数学生抗拒冷门
    "postgrad_focus_mean":  0.45,   # 适中考研意愿
}

_NOISE_STD = 0.15   # 个体差异噪声标准差

# 城市等级得分
_CITY_SCORE = {
    "一线": 1.00, "新一线": 0.80,
    "二线": 0.60, "三线": 0.42, "四线": 0.30,
}


# ── 省份参数初始化 ─────────────────────────────────────────────

def init_province_params(db_session, province: str) -> Dict:
    """
    从数据库反推该省考生的真实偏好分布参数，结果缓存。
    如果DB查询失败，静默回退到默认值。
    """
    if province in _province_params_cache:
        return _province_params_cache[province]

    params = dict(_DEFAULT_PARAMS)

    try:
        from sqlalchemy import text

        def q(sql, **kw):
            return db_session.execute(text(sql), kw).fetchone()

        # ① risk_tolerance：位次变异系数越大 → 学生越倾向保守
        r = q("""SELECT AVG(min_rank) m, AVG(min_rank*min_rank)-AVG(min_rank)*AVG(min_rank) v
                 FROM admission_records
                 WHERE province=:p AND min_rank>0 AND year>=2022""", p=province)
        if r and r.m and r.v and r.m > 0:
            cv = math.sqrt(max(float(r.v), 0)) / float(r.m)
            params["risk_tolerance_mean"] = round(max(0.20, min(0.60, 0.50 - cv * 0.50)), 3)

        # ② prestige_weight：985/211录取占比
        r_top = q("""SELECT COUNT(*) c FROM admission_records ar
                     JOIN schools s ON ar.school_name=s.name
                     WHERE ar.province=:p AND ar.year>=2022
                       AND (s.is_985='是' OR s.is_211='是')""", p=province)
        r_all = q("""SELECT COUNT(*) c FROM admission_records
                     WHERE province=:p AND year>=2022""", p=province)
        if r_all and r_all.c > 0:
            ratio = (r_top.c if r_top else 0) / r_all.c
            params["prestige_weight_mean"] = round(max(0.35, min(0.85, 0.35 + ratio * 1.5)), 3)

        # ③ career_weight / postgrad_focus：就业率/深造率平均值
        r_emp = q("""SELECT AVG(se.employment_rate) er, AVG(se.postgrad_rate) pr
                     FROM school_employment se
                     JOIN admission_records ar ON ar.school_name=se.school_name
                     WHERE ar.province=:p AND ar.year>=2022
                       AND se.employment_rate>0""", p=province)
        if r_emp and r_emp.er:
            params["career_weight_mean"]  = round(max(0.30, min(0.80, float(r_emp.er))), 3)
        if r_emp and r_emp.pr:
            params["postgrad_focus_mean"] = round(max(0.20, min(0.70, float(r_emp.pr))), 3)

        # ④ city_weight：跨省高校录取占比
        r_cross = q("""SELECT COUNT(*) c FROM admission_records ar
                       JOIN schools s ON ar.school_name=s.name
                       WHERE ar.province=:p AND ar.year>=2022
                         AND s.province!=:p""", p=province)
        if r_all and r_all.c > 0:
            cross = (r_cross.c if r_cross else 0) / r_all.c
            params["city_weight_mean"] = round(max(0.30, min(0.75, cross * 1.2)), 3)

        # ⑤ gem_openness：非知名校录取占比（越高说明该省学生越愿意选冷门）
        r_non = q("""SELECT COUNT(*) c FROM admission_records ar
                     LEFT JOIN schools s ON ar.school_name=s.name
                     WHERE ar.province=:p AND ar.year>=2022
                       AND (s.is_985 IS NULL OR s.is_985='否')
                       AND (s.is_211 IS NULL OR s.is_211='否')""", p=province)
        if r_all and r_all.c > 0:
            non_ratio = (r_non.c if r_non else 0) / r_all.c
            params["gem_openness_mean"] = round(max(0.15, min(0.55, non_ratio * 0.4)), 3)

    except Exception as e:
        print(f"[SwarmPredictor] 省份参数初始化失败({province})，使用默认值: {e}")

    _province_params_cache[province] = params
    return params


# ── 学校特征矩阵构建 ───────────────────────────────────────────

def _build_school_matrix(schools: List[Dict]) -> np.ndarray:
    """
    将学校列表转为特征矩阵 (N×6)。
    列：[prob_norm, quality_norm, city_score, employ_rate, gem_norm, sentiment]
    所有值归一化到 [0, 1]。
    """
    n = len(schools)
    mat = np.zeros((n, 6), dtype=np.float32)
    for i, s in enumerate(schools):
        emp = s.get("employment") or {}
        rev = s.get("review_data") or {}
        mat[i, 0] = min(float(s.get("probability", 0)) / 100.0, 1.0)
        mat[i, 1] = min(float(s.get("quality_score", 0)) / 100.0, 1.0)
        mat[i, 2] = _CITY_SCORE.get(s.get("city_level", ""), 0.35)
        mat[i, 3] = min(float(
            emp.get("school_employment_rate") or
            emp.get("employment_rate") or 0.85
        ), 1.0)
        mat[i, 4] = min(float(s.get("gem_score", 0)) / 100.0, 1.0)
        sentiment = rev.get("sentiment_score", 0.5) if rev else 0.5
        mat[i, 5] = float(sentiment) if sentiment is not None else 0.5
    return mat


# ── 核心模拟函数 ───────────────────────────────────────────────

def run_swarm_prediction(
    schools: List[Dict],
    base_rank: int,
    province: str,
    db_session=None,
    n_agents: int = 300,
    portfolio_size: int = 12,
) -> Dict[str, float]:
    """
    运行群体智能模拟，返回每所学校的共识分 {school_name: 0~1}。

    关键设计：按 school_name 去重后运行模拟（同一所学校多专业只算一次），
    再将共识分映射回所有条目。避免"选票分裂"问题。

    Args:
        schools:        候选学校列表（来自 _run_recommend_core 的 results，含重复学校）
        base_rank:      考生位次
        province:       考生所在省份
        db_session:     SQLAlchemy session（用于省份参数初始化）
        n_agents:       虚拟学生数量（默认300）
        portfolio_size: 每个 Agent 选几所志愿（默认12）

    Returns:
        {school_name: swarm_consensus_score}，范围 0~1，越高说明群体共识越强
    """
    if not schools:
        return {}

    # 1. 省份参数（有缓存）
    params = init_province_params(db_session, province) if db_session else _DEFAULT_PARAMS

    # 2. 按 school_name 去重：每所学校取概率最高的一条作为代表
    seen: Dict[str, Dict] = {}
    for s in schools:
        nm = s["school_name"]
        if nm not in seen or s.get("probability", 0) > seen[nm].get("probability", 0):
            seen[nm] = s
    unique_schools = list(seen.values())

    # 3. 学校特征矩阵 (N_unique, 6)
    school_names = [s["school_name"] for s in unique_schools]
    mat = _build_school_matrix(unique_schools)
    N = len(unique_schools)

    # 3. 生成 Agent 人格矩阵 (n_agents, 6)
    rng = np.random.default_rng(seed=base_rank % 99991)   # 可复现

    base_vec = np.array([
        params["risk_tolerance_mean"],
        params["prestige_weight_mean"],
        params["career_weight_mean"],
        params["city_weight_mean"],
        params["gem_openness_mean"],
        params["postgrad_focus_mean"],
    ], dtype=np.float32)

    noise = rng.normal(0, _NOISE_STD, (n_agents, 6)).astype(np.float32)
    personalities = np.clip(base_vec + noise, 0.05, 0.95)   # (n_agents, 6)

    # 4. 构建权重矩阵 (n_agents, 6)：每个Agent对6个特征的重视程度
    #    特征顺序：[prob, quality, city, employment, gem, sentiment]
    #    人格维度：[risk, prestige, career, city, gem, postgrad]
    #
    #    prob固定权重0.40（最重要）
    #    其余特征由对应人格维度控制，缩放到总和1
    W = np.column_stack([
        np.full(n_agents, 0.40, dtype=np.float32),     # prob（固定）
        personalities[:, 1] * 0.22,                     # quality × prestige
        personalities[:, 3] * 0.12,                     # city × city_weight
        personalities[:, 2] * 0.12,                     # employ × career
        personalities[:, 4] * 0.10,                     # gem × gem_openness
        np.full(n_agents, 0.04, dtype=np.float32),      # sentiment（固定）
    ])  # (n_agents, 6)
    W = W / W.sum(axis=1, keepdims=True)                 # 归一化

    # 5. 打分矩阵 (n_agents, N)
    scores = W @ mat.T   # (n_agents, N)

    # 风险调整：保守Agent偏好高概率学校，冒险Agent愿意冲
    risk_adj = 1.0 + (personalities[:, 0:1] - 0.5) * 0.20
    scores = scores * risk_adj

    # 6. Softmax 选校（temperature=0.30，在区分度与多样性之间平衡）
    def softmax(x: np.ndarray, temp: float = 0.30) -> np.ndarray:
        x = x / temp
        x -= x.max()
        e = np.exp(x)
        return e / e.sum()

    choice_counts = np.zeros(N, dtype=np.float32)
    p_size = min(portfolio_size, N)
    for i in range(n_agents):
        p = softmax(scores[i]).astype(np.float64)
        p /= p.sum()  # 防止浮点误差
        chosen = rng.choice(N, size=p_size, replace=False, p=p)
        choice_counts[chosen] += 1.0

    # 7. 归一化为共识分
    max_c = choice_counts.max()
    consensus = (choice_counts / max_c) if max_c > 0 else choice_counts

    return {name: float(score) for name, score in zip(school_names, consensus)}


# ── 结果融合与标记 ────────────────────────────────────────────

def tag_swarm_discoveries(
    results: List[Dict],
    swarm_scores: Dict[str, float],
    behavior_boosts: Optional[Dict[str, float]] = None,
    behavior_sample_count: int = 0,
) -> List[Dict]:
    """
    将群体智能分融合到结果 dict 中（in-place）。

    新增字段：
      swarm_score:      群体共识分（0~1）
      swarm_discovery:  bool，是否为"群体强推"冷门
      _swarm_final:     融合排序分（内部用）

    自适应权重（随行为数据量成长）：
      < 20条  → stat 65% / swarm 30% / behavior  5%
      20-100  → stat 60% / swarm 25% / behavior 15%
      > 100   → stat 55% / swarm 20% / behavior 25%
    """
    bb = behavior_boosts or {}

    if behavior_sample_count < 20:
        W_stat, W_swarm, W_beh = 0.65, 0.30, 0.05
    elif behavior_sample_count < 100:
        W_stat, W_swarm, W_beh = 0.60, 0.25, 0.15
    else:
        W_stat, W_swarm, W_beh = 0.55, 0.20, 0.25

    for r in results:
        sname = r["school_name"]
        sc    = swarm_scores.get(sname, 0.0)
        bv    = bb.get(sname, 0.0)
        prob  = r["probability"] / 100.0

        r["swarm_score"]     = round(sc, 3)
        # 群体强推：统计概率处于冲/稳区间（30-65%），但群体共识≥60%
        # → 说明多维综合优秀，但单纯看位次匹配会被低估
        r["swarm_discovery"] = bool(30 <= r["probability"] <= 65 and sc >= 0.60)
        r["_swarm_final"]    = prob * W_stat + sc * W_swarm + bv * W_beh

    return results


def get_behavior_sample_count(db_session, province: str) -> int:
    """返回该省的 add_to_form 行为数据量，用于自适应权重计算。"""
    try:
        from sqlalchemy import text
        r = db_session.execute(
            text("SELECT COUNT(*) FROM user_events WHERE event_type='add_to_form' AND province=:p"),
            {"p": province}
        ).scalar()
        return int(r or 0)
    except Exception:
        return 0
