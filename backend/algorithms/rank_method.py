"""
位次法核心算法 v4
- 等位分换算
- 录取概率预测（支持最多8年历史数据）
- P0：概率校准，19.2万条数据训练，ECE从0.177降至0.028
- P1：大小年识别，AR(2) ARIMA模型（替代滚动均值）
- P2：投资组合优化（平行志愿EV最大化）
- P3：蒙特卡洛风险模拟（单因子年份冲击模型）
- P4：考生人数规模归一化（历史位次→百分位→目标年等效位次）
"""
from typing import List, Dict, Optional
import statistics
import math

# 导入新模块（懒加载防止循环依赖）
def _get_calibrator():
    try:
        from algorithms.calibration import calibrate
        return calibrate
    except ImportError:
        try:
            from calibration import calibrate
            return calibrate
        except ImportError:
            return lambda p, province=None: p  # fallback: identity

def _get_arima():
    try:
        from algorithms.arima_model import detect_big_small_year_arima
        return detect_big_small_year_arima
    except ImportError:
        try:
            from arima_model import detect_big_small_year_arima
            return detect_big_small_year_arima
        except ImportError:
            return None

def _get_population():
    """懒加载人口数据模块（P4：考生人数规模归一化）"""
    try:
        from algorithms.population_data import rank_to_percentile, percentile_to_rank
        return rank_to_percentile, percentile_to_rank
    except ImportError:
        try:
            from population_data import rank_to_percentile, percentile_to_rank
            return rank_to_percentile, percentile_to_rank
        except ImportError:
            return None, None


def calc_equal_rank_score(
    target_rank: int,
    year_rank_score_map: Dict[int, List[Dict]]
) -> Dict[int, int]:
    """
    等位分换算：给定目标位次，计算每年对应的分数（等位分）
    year_rank_score_map: {年份: [{rank, score}]}
    """
    result = {}
    for year, records in year_rank_score_map.items():
        sorted_records = sorted(records, key=lambda x: x["rank"])
        for i, rec in enumerate(sorted_records):
            if rec["rank"] >= target_rank:
                if i == 0:
                    result[year] = rec["score"]
                else:
                    # 线性插值
                    prev = sorted_records[i - 1]
                    ratio = (target_rank - prev["rank"]) / (rec["rank"] - prev["rank"])
                    interpolated = prev["score"] + ratio * (rec["score"] - prev["score"])
                    result[year] = round(interpolated)
                break
        else:
            if sorted_records:
                result[year] = sorted_records[-1]["score"]
    return result


def predict_admission(
    candidate_rank: int,
    school_records: List[Dict],
    current_year: int = 2025,
    province: str = None,
    school_prior_rank: float = 0,  # 学校级先验位次（同校所有专业均值），用于小样本贝叶斯平滑
) -> Dict:
    """
    预测录取概率
    school_records: [{year, min_rank, plan_count}]
    返回: {probability, suggested_action, big_small_year, trend_score}
    """
    if not school_records:
        return {"probability": 0, "suggested_action": "数据不足", "confidence": "低"}

    # 过滤近5年（排除 min_rank=0 的无效数据）
    valid_records = [r for r in school_records if (r.get("min_rank") or 0) > 0]
    recent = sorted(valid_records, key=lambda x: x["year"], reverse=True)[:5]

    if not recent:
        return {"probability": 0, "suggested_action": "数据不足", "confidence": "低"}

    # P4：考生人数规模归一化
    # 不同年份省内总考生人数不同，直接比较位次会产生系统偏差。
    # 例如：2022年北京5000名 ≈ 2026年5200名（因总人数增加）
    # 做法：历史位次 → 百分位 → 2026等效位次，再做加权平均
    _r2p, _p2r = _get_population()
    # 目标年上限 2026：population_data 仅提供到2026的估计，超出范围则静默fallback
    TARGET_YEAR = min(current_year + 1, 2026)

    def _normalize_rank(raw_rank: int, rec_year: int) -> int:
        """把某年位次换算成目标年等效位次（跨年人口规模归一化）"""
        if _r2p is None or province is None:
            return raw_rank  # fallback：无province数据
        try:
            pct = _r2p(raw_rank, province, rec_year)
            if pct < 0:
                # sentinel -1.0: 该省份/年份在 population_data 中不存在
                return raw_rank
            result = _p2r(pct, province, TARGET_YEAR)
            if result < 0:
                return raw_rank  # TARGET_YEAR 数据缺失时同样fallback
            return max(1, result)
        except Exception:
            return raw_rank

    # 指数加权平均：最近年权重最高，按 ~0.7^i 衰减
    # [2.0, 1.4, 1.0, 0.7, 0.5] — 每年权重约为前一年的 70%
    # 理由：高考招生政策/院校计划每年有调整，近年数据与当前实际更相关
    weights = [2.0, 1.4, 1.0, 0.7, 0.5][:len(recent)]
    total_w = sum(weights)
    # 用归一化后的位次做加权平均（P4核心步骤）
    normalized_ranks = [_normalize_rank(recent[i]["min_rank"], recent[i]["year"]) for i in range(len(recent))]
    avg_rank = sum(normalized_ranks[i] * weights[i] for i in range(len(recent))) / total_w
    ranks_raw = normalized_ranks  # 标准差也基于归一化后的位次计算
    std_rank = statistics.stdev(ranks_raw) if len(ranks_raw) > 1 else avg_rank * 0.1

    # rank_diff 必须在贝叶斯平滑前计算，否则学校级先验会把专业级位次拉偏，
    # 导致用户看到的"位次差"不是该专业真实录取线，而是被学校其他专业稀释后的值。
    rank_diff = avg_rank - candidate_rank

    # ── 贝叶斯平滑：小样本专业向学校级先验收缩 ──────────────────
    # 当历史数据仅1-2年时，单专业均值不可靠。
    # 用层级贝叶斯思想：posterior = (n * sample_mean + k * prior) / (n + k)
    # k=2 表示先验等价于 2 年数据的权重，n=实际年数
    # 效果：1年数据 → 先验占67%；2年 → 50%；3年 → 40%；5年 → 29%
    if school_prior_rank > 0 and len(recent) <= 3:
        _k_prior = 2.0  # 先验强度（等价样本数）
        _n = len(recent)
        avg_rank = (_n * avg_rank + _k_prior * school_prior_rank) / (_n + _k_prior)
        # 标准差也收缩：小样本时放大不确定性
        if len(recent) == 1:
            std_rank = max(std_rank, avg_rank * 0.15)  # 至少15%不确定性
    # 用标准差归一化，使得波动大的专业不过于自信
    volatility_factor = min(2.0, 1 + std_rank / avg_rank) if avg_rank > 0 else 1
    rank_diff_ratio = (rank_diff / avg_rank) / volatility_factor if avg_rank > 0 else 0

    # 概率计算（sigmoid模型，限制输入范围防止溢出）
    clamped = max(-10.0, min(10.0, rank_diff_ratio * 9))
    prob_raw = 1 / (1 + math.exp(-clamped))

    # P0校准：19.2万条数据训练的分段线性校准（ECE 0.177→0.028）
    _calibrate = _get_calibrator()
    prob = _calibrate(prob_raw, province)

    # ── 高波动收缩：CV>0.20时概率向50%收缩，减轻中间区过度自信 ──
    # 回测发现：高波动校专业在40-80%概率段系统性偏乐观（河北ECE=0.07）
    # 收缩公式：prob = 0.5 + (prob - 0.5) * shrink_factor
    # CV=0.20 → 不收缩；CV=0.40 → 收缩20%（shrink=0.80）
    cv = std_rank / avg_rank if avg_rank > 0 else 1.0
    if cv > 0.20:
        shrink = max(0.70, 1.0 - (cv - 0.20) * 1.0)  # CV=0.50→0.70
        prob = 0.5 + (prob - 0.5) * shrink

    # ── 置信区间（基于历史位次标准差传播不确定性）────────────────
    # 原理：该院校历史最低位次有 std_rank 的波动 → 用 ±0.7σ 构造参考区间
    # 注意：这只是参考范围，不代表统计意义上的覆盖概率，因实际位次分布并非正态
    # 位次数字大 = 学校更容易 → 候选人概率更高（prob_high 对应 avg_rank + sigma）
    def _prob_at(assumed_avg: float) -> float:
        if assumed_avg <= 0:
            return 0.0
        diff = assumed_avg - candidate_rank
        vf = min(2.0, 1 + std_rank / assumed_avg)
        ratio = (diff / assumed_avg) / vf
        c = max(-10.0, min(10.0, ratio * 9))
        return round(1 / (1 + math.exp(-c)) * 100, 1)

    sigma_scale = 0.7   # 参考区间缩放系数（非统计置信区间）
    # 置信区间用 raw prob 计算后再校准（保持单调性）
    prob_high_raw = _prob_at(avg_rank + sigma_scale * std_rank) / 100
    prob_low_raw  = _prob_at(avg_rank - sigma_scale * std_rank) / 100
    prob_pct  = round(prob * 100, 1)
    prob_high = round(_calibrate(max(0.0, min(1.0, prob_high_raw)), province) * 100, 1)
    prob_low  = round(_calibrate(max(0.0, min(1.0, prob_low_raw)),  province) * 100, 1)
    prob_high = max(prob_pct, prob_high)
    prob_low  = min(prob_pct, prob_low)
    # Only report interval if spread is meaningful (> 3 points)
    if prob_high - prob_low < 3:
        prob_high = prob_low = None

    # 置信度：综合考虑数据年数 + 位次波动系数（CV = std/mean）
    # 数据多且波动小 → 高置信；数据少或波动大 → 中/低置信
    cv = std_rank / avg_rank if avg_rank > 0 else 1.0  # 变异系数
    if len(recent) >= 3 and cv < 0.20:
        confidence = "高"   # ≥3年数据 + 波动率<20%
    elif len(recent) >= 3 or (len(recent) == 2 and cv < 0.10):
        confidence = "中"   # 数据量或稳定性达标
    else:
        confidence = "低"   # 数据少（1-2年）且波动大

    # 大小年判断：优先使用 AR(2) ARIMA模型（更准确），回退到滚动均值法
    _arima_fn = _get_arima()
    if _arima_fn is not None:
        try:
            big_small = _arima_fn(recent)
        except Exception:
            big_small = detect_big_small_year(recent)
    else:
        big_small = detect_big_small_year(recent)

    # ── 招生计划变动惩罚 ─────────────────────────────────────────
    # 若今年招生计划显著少于历史均值，历史位次数据偏乐观，需下调概率
    plan_penalty = 0.0
    plan_warning = ""
    valid_plans = [r.get("plan_count") for r in recent if r.get("plan_count") and r.get("plan_count", 0) > 0]
    if len(valid_plans) >= 2:
        hist_avg_plan = sum(valid_plans[1:]) / len(valid_plans[1:])   # 往年均值
        latest_plan   = valid_plans[0]                                  # 最新年计划
        if hist_avg_plan > 0:
            change_ratio = (latest_plan - hist_avg_plan) / hist_avg_plan
            if change_ratio < -0.10:   # 缩招超10%（原30%阈值过高）
                # 缩招惩罚：概率下调量 = min(15%, 缩招幅度 × 0.3)
                # 对称设计：与扩招奖励使用同一系数，上下界均为±15%
                plan_penalty = min(0.15, abs(change_ratio) * 0.3)
                plan_warning = f"⚠️ 近年缩招{abs(change_ratio)*100:.0f}%，实际难度可能高于历史数据"
            elif change_ratio > 0.10:  # 扩招超10%
                # 扩招奖励：对称设计，奖励量 = min(15%, 扩招幅度 × 0.3)
                plan_penalty = -min(0.15, change_ratio * 0.3)          # 负惩罚=提升概率
                plan_warning = f"📈 近年扩招{change_ratio*100:.0f}%，录取机会大于历史数据"
    prob = min(0.99, max(0.01, prob - plan_penalty))
    prob_pct = round(prob * 100, 1)

    # 操作建议
    if prob >= 0.75:
        action = "稳妥保底" if prob >= 0.92 else "稳中有把握"
    elif prob >= 0.45:
        action = "有竞争力，值得冲"
    else:
        action = "风险较大，作为冲志愿"

    return {
        "probability": prob_pct,
        "prob_low": prob_low,    # 悲观边界（更难场景）
        "prob_high": prob_high,  # 乐观边界（更容易场景）
        "avg_min_rank_3yr": round(avg_rank),
        "rank_diff": round(rank_diff),
        "rank_std": round(std_rank),
        "rank_cv": round(cv, 3),  # 变异系数（CV<0.10=稳定，0.10-0.20=中等，>0.20=高波动）
        "suggested_action": action,
        "big_small_year": big_small,
        "confidence": confidence,
        "recent_years_data": recent,
        "plan_warning": plan_warning,   # 招生计划变动提示（空字符串=无异常）
    }


def detect_big_small_year(records: List[Dict]) -> Dict:
    """
    大小年检测 v2：使用最多8年历史 + 线性回归趋势预测
    records: 录取记录列表（含 year / min_rank）
    返回: {status, prediction, reason, heat_trend, trend_analysis}
    """
    if len(records) < 2:
        return {"status": "数据不足", "prediction": "无法判断", "reason": ""}

    sorted_recs = sorted(records, key=lambda x: x["year"])
    # 最多取最近8年
    sorted_recs = sorted_recs[-8:]
    ranks = [r["min_rank"] for r in sorted_recs]
    years = [r["year"] for r in sorted_recs]

    # 计算年度变化率（相邻年）
    changes = []
    for i in range(1, len(ranks)):
        if ranks[i - 1] > 0:
            change = (ranks[i] - ranks[i - 1]) / ranks[i - 1]
            changes.append({"year": years[i], "change": round(change * 100, 1)})

    # 线性回归：位次随年份的趋势（斜率>0=越来越难竞争，斜率<0=越来越容易）
    trend_slope, next_year_est, confidence = _linear_regression(years, ranks)

    last_change = changes[-1]["change"] / 100 if changes else 0
    last_year = years[-1]

    # P2.10修复：大小年判断需要滚动验证，避免单年噪声误判
    # 条件：最近一年变化显著 AND 最近2年平均变化方向一致（至少有2年变化数据）
    if len(changes) >= 2:
        # 注意：c["change"] 单位是百分点（如15.3表示15.3%），除以实际个数求均值
        # 原 /200 是错误的（混淆了百分点单位与计数），修正为除以实际元素数量
        recent_slice = changes[-2:]
        recent_avg_change = sum(c["change"] for c in recent_slice) / len(recent_slice) / 100
    else:
        recent_avg_change = last_change  # 仅1年变化时直接用

    # 双重确认：单年变化>15% 且 近两年均值方向一致(>5%)
    is_big_year   = last_change > 0.15 and recent_avg_change > 0.05
    is_small_year = last_change < -0.15 and recent_avg_change < -0.05

    if is_big_year:
        status = "去年大年"
        prediction = f"今年({last_year+1})预计小年，竞争可能减弱"
        reason = (f"去年录取位次上升{round(last_change*100)}%（竞争加剧）"
                  f"，近两年均值变化{round(recent_avg_change*100)}%，大年信号较强，今年有回调概率")
        heat_trend = "↓ 预计降温"
    elif is_small_year:
        status = "去年小年"
        prediction = f"今年({last_year+1})预计大年，竞争可能加剧"
        reason = (f"去年录取位次下降{round(abs(last_change)*100)}%（竞争减弱）"
                  f"，近两年均值变化{round(recent_avg_change*100)}%，小年信号较强，今年有反弹概率")
        heat_trend = "↑ 预计升温"
    elif abs(last_change) > 0.15:
        # 单年波动大但近两年平均不显著 → 弱信号
        direction = "大年" if last_change > 0 else "小年"
        status = f"去年疑似{direction}"
        prediction = "今年竞争格局尚不明朗，近两年信号不一致，建议保守参考"
        reason = f"去年录取位次变化{round(last_change*100)}%，但近两年均值波动有限，信号较弱"
        heat_trend = "→ 信号不稳定"
    else:
        status = "相对稳定"
        prediction = "今年竞争格局预计与近年相近"
        reason = "近年录取位次变化幅度在正常范围内（±15%以内）"
        heat_trend = "→ 预计平稳"

    return {
        "status": status,
        "prediction": prediction,
        "reason": reason,
        "heat_trend": heat_trend,
        "year_changes": changes,
        "last_year_min_rank": ranks[-1],
        "trend_analysis": {
            "years_used": len(sorted_recs),
            "slope": round(trend_slope, 1),       # 正=越来越难，负=越来越容易
            "next_year_estimate": int(next_year_est) if next_year_est else None,
            "confidence": confidence,
            "trend_label": (
                "长期升温" if trend_slope > 500 else
                "长期降温" if trend_slope < -500 else
                "长期平稳"
            )
        }
    }


def _linear_regression(years: List[int], ranks: List[int]):
    """简单线性回归，返回(斜率, 下一年预测位次, 置信度)"""
    n = len(years)
    if n < 2:
        return 0, None, "低"
    x_mean = sum(years) / n
    y_mean = sum(ranks) / n
    numerator = sum((years[i] - x_mean) * (ranks[i] - y_mean) for i in range(n))
    denominator = sum((years[i] - x_mean) ** 2 for i in range(n))
    if denominator == 0:
        return 0, y_mean, "低"
    slope = numerator / denominator
    intercept = y_mean - slope * x_mean
    next_year = max(years) + 1
    pred = slope * next_year + intercept
    confidence = "高" if n >= 5 else ("中" if n >= 3 else "低")
    return slope, max(1, pred), confidence


def normalize_rank_to_percentile(raw_rank: int, province_total: int) -> float:
    """
    将省内原始位次转为百分位（0-1），用于多省横向比较
    百分位越小 = 成绩越好
    """
    if province_total <= 0:
        return 0.5
    return min(1.0, raw_rank / province_total)


def current_year_hint(last_year: int) -> str:
    return str(last_year + 1)


def build_gradient_plan(
    candidate_rank: int,
    school_list: List[Dict],
    total_slots: int = 20
) -> Dict:
    """
    生成冲稳保梯度方案
    返回: {surge, stable, safe} 各占比的学校推荐列表
    """
    surge_schools = []   # 冲：位次比考生高10%-20%
    stable_schools = []  # 稳：位次与考生接近（±8%）
    safe_schools = []    # 保：位次比考生低10%-20%

    for school in school_list:
        avg_rank = school.get("avg_min_rank_3yr", 0)
        if avg_rank <= 0:
            continue

        ratio = (avg_rank - candidate_rank) / candidate_rank

        if 0.08 < ratio <= 0.22:
            surge_schools.append(school)
        elif -0.08 <= ratio <= 0.08:
            stable_schools.append(school)
        elif -0.22 <= ratio < -0.08:
            safe_schools.append(school)

    # 按总志愿数分配比例：冲30% / 稳50% / 保20%
    surge_n = max(1, round(total_slots * 0.3))
    stable_n = max(1, round(total_slots * 0.5))
    safe_n = max(1, round(total_slots * 0.2))

    return {
        "surge": surge_schools[:surge_n],
        "stable": stable_schools[:stable_n],
        "safe": safe_schools[:safe_n],
        "summary": {
            "surge_count": len(surge_schools),
            "stable_count": len(stable_schools),
            "safe_count": len(safe_schools)
        }
    }
