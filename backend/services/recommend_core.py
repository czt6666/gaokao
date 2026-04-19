"""高考志愿智能推荐核心逻辑（由 main.py 抽离）。"""
import datetime
import json
import os
import random
import re
import statistics
import time
from collections import defaultdict

from sqlalchemy.orm import Session
from sqlalchemy import text as _sqla_text

from database import (
    School,
    Major,
    AdmissionRecord,
    SubjectEvaluation,
    MajorEmployment,
    UserEvent,
    SchoolEmployment,
    SchoolReview,
)
from algorithms.rank_method import predict_admission
from algorithms.hidden_gem import score_overall_gem, school_quality_score, value_index
from algorithms.population_data import get_province_total as _pop_province_total


def _get_province_total(province: str, year: int = 2025) -> int:
    """获取省份总考生数（缓存，用于value_index计算）"""
    try:
        return _pop_province_total(province, year)
    except Exception:
        return 500000  # fallback


# ── 上市公司招聘数据辅助函数（供 _build_reason 使用）────────────
# 数据来源：A股上市公司2024-2025年真实招聘数据，37,000条本科应届样本

# 专业方向 → 真实薪资（上市公司本科应届中位数）
_RECRUIT_SALARY = {
    "计算机": 11500, "软件": 11500, "人工智能": 11500, "数据": 11500, "信息": 11500,
    "芯片": 11500, "集成电路": 11500, "微电子": 11500, "半导体": 11500,
    "通信": 10250, "电子信息": 10250,
    "电气": 9750, "自动化": 9750, "控制": 9750,
    "机械": 9000, "制造": 9000, "车辆": 9000,
    "化工": 8500, "材料": 8500, "化学": 8500,
    "生物": 8500, "药": 8500, "医学": 8500, "临床": 8500,
    "土木": 8000, "建筑": 8000,
    "市场营销": 8000, "营销": 8000,
    "金融": 7500, "经济": 7500, "投资": 7500,
    "法学": 7750, "法律": 7750,
    "环境": 7500, "环保": 7500, "安全": 7500,
    "会计": 6500, "财务": 6500, "审计": 6500,
    "人力": 7000, "行政": 7000,
    "物流": 7000, "供应链": 7000, "采购": 7000,
}

# 专业方向 → 硕士溢价百分比
_MASTER_PREMIUM = {
    "计算机": 97, "软件": 97, "人工智能": 97,
    "芯片": 65, "集成电路": 65, "微电子": 65, "半导体": 65, "电子": 65,
    "生物": 67, "药": 67, "医学": 67, "临床": 67, "制药": 67,
    "机械": 50, "制造": 50, "车辆": 50,
    "新能源": 39, "储能": 39, "光伏": 39,
    "电气": 50, "自动化": 50,
    "化工": 47, "材料": 47, "化学": 47,
    "金融": 33, "经济": 33,
    "市场营销": 50, "营销": 50,
}

# 城市 → 本科应届岗位数（就业机会指数）
_CITY_JOBS = {
    "杭州": 1516, "苏州": 1246, "上海": 1158, "南京": 1125, "宁波": 1048,
    "北京": 969, "深圳": 907, "成都": 881, "广州": 829, "无锡": 812,
    "合肥": 749, "佛山": 713, "重庆": 709, "珠海": 688, "武汉": 673,
    "常州": 642, "南通": 583, "长沙": 581, "中山": 561, "惠州": 497,
    "东莞": 489, "西安": 424, "昆明": 422, "嘉兴": 386, "台州": 347,
}

# 城市 → 薪资系数（相对全国中位数8000）
_CITY_SALARY_COEFF = {
    "上海": 1.25, "北京": 1.25, "深圳": 1.25,
    "杭州": 1.12, "惠州": 1.12, "南京": 1.06, "广州": 1.06, "济南": 1.06,
    "苏州": 1.04, "合肥": 1.00, "成都": 1.00, "武汉": 1.00, "长沙": 1.00,
    "重庆": 0.94, "昆明": 0.75,
}


def _get_recruit_salary_ref(major_name: str) -> str:
    """根据专业名查上市公司薪资参考，返回一句话描述或空字符串"""
    if not major_name:
        return ""
    for kw, sal in _RECRUIT_SALARY.items():
        if kw in major_name:
            return f"该方向本科应届中位月薪约 ¥{sal/1000:.1f}k（全国本科应届整体中位 ¥8.0k）。"
    return ""


def _get_master_premium_text(major_name: str) -> str:
    """根据专业名查硕士溢价，返回读研建议或空字符串"""
    if not major_name:
        return ""
    for kw, pct in _MASTER_PREMIUM.items():
        if kw in major_name:
            if pct >= 60:
                return (f"读研参考：该方向硕士比本科起薪高约{pct}%，"
                        f"读研投入回报比高，建议有条件的同学优先考虑深造。")
            elif pct >= 40:
                return (f"读研参考：该方向硕士比本科起薪高约{pct}%，"
                        f"读研有一定回报，可结合个人兴趣决定。")
            else:
                return (f"读研参考：该方向硕士比本科起薪高约{pct}%，"
                        f"溢价相对有限，建议优先积累工作经验。")
    return ""


def _get_city_employment_text(city: str) -> str:
    """根据城市返回就业机会描述"""
    if not city:
        return ""
    # 匹配城市名（兼容"北京市"→"北京"）
    _city = city.replace("市", "").replace("省", "")
    jobs = _CITY_JOBS.get(_city, 0)
    coeff = _CITY_SALARY_COEFF.get(_city, 0)
    if jobs > 0 and coeff > 0:
        coeff_desc = "高于" if coeff > 1.1 else ("接近" if coeff >= 0.95 else "略低于")
        return (f"{_city}在A股上市公司招聘中提供约{jobs:,}个本科应届岗位，"
                f"薪资水平{coeff_desc}全国均值（系数{coeff:.2f}x）。")
    elif jobs > 0:
        return f"{_city}在A股上市公司招聘中提供约{jobs:,}个本科应届岗位。"
    return ""


def _build_reason(result: dict, rank: int) -> str:
    """
    生成深度推荐理由——9模块权威分析报告（约500-800字/校）。
    返回纯文本字符串（各模块以双换行分隔），同时在 result 中注入
    result['reason_sections'] 列表（结构化版本供前端分段渲染）。
    """
    avg_rank    = result.get("avg_min_rank_3yr") or 0
    rank_diff   = result.get("rank_diff") or 0
    rank_std    = result.get("rank_std") or 0
    prob        = result.get("probability") or 0
    prob_low    = result.get("prob_low")
    prob_high   = result.get("prob_high")
    confidence  = result.get("confidence") or "中"
    bsy         = result.get("big_small_year") or {}
    bsy_status  = bsy.get("status") or ""
    bsy_trend   = bsy.get("heat_trend") or ""
    bsy_pred    = bsy.get("prediction") or ""
    bsy_reason  = bsy.get("reason") or ""
    recent_data = result.get("recent_years_data") or result.get("recent_data") or []
    plan_warn   = result.get("plan_warning") or ""
    emp         = result.get("employment") or {}
    is_gem      = result.get("is_hidden_gem", False)
    top_gem     = result.get("top_gem") or {}
    all_gems    = result.get("all_gems") or []
    quality     = result.get("quality_score") or 0
    is_985      = result.get("is_985", "否") == "是"
    is_211      = result.get("is_211", "否") == "是"
    tier        = result.get("tier") or "普通"
    strong_subs = result.get("strong_subjects") or []
    major_name  = result.get("major_name") or "该专业"
    school_name = result.get("school_name") or "该校"
    city        = result.get("city") or ""
    action      = result.get("suggested_action") or ""
    comp_count  = result.get("competition_count") or 0

    sections = []

    # ────────────────────────────────────────────────────────────────
    # 【模块1】录取概率解析——数学过程透明化
    # ────────────────────────────────────────────────────────────────
    m1_lines = []
    n_years = len(recent_data)
    if avg_rank > 0:
        m1_lines.append(
            f"本系统基于 {n_years} 年（{recent_data[-1]['year'] if recent_data else '近年'}–"
            f"{recent_data[0]['year'] if recent_data else '2025'}）的录取数据，"
            f"采用指数加权平均计算历史最低位次均值约 {avg_rank:,} 位"
            f"（近年数据权重更高，以反映最新招生趋势）。"
        )
        if rank_diff > 0:
            pct_ahead = round(rank_diff / avg_rank * 100, 1)
            m1_lines.append(
                f"您的位次 {rank:,} 比历史均值低 {rank_diff:,} 位（领先 {pct_ahead}%），"
                f"处于历史录取线的安全区间内。"
            )
        elif rank_diff >= -500:
            m1_lines.append(
                f"您的位次 {rank:,} 与历史均值仅差 {abs(rank_diff):,} 位，属于贴线冲刺，"
                f"录取与否高度依赖当年报考人数变化。"
            )
        else:
            m1_lines.append(
                f"您的位次 {rank:,} 高于历史均值 {-rank_diff:,} 位，存在一定冲刺风险。"
            )
        if rank_std > 0:
            m1_lines.append(
                f"历史位次波动（标准差）约 ±{rank_std:,} 位，"
                f"{'波动较大，不确定性高' if rank_std > avg_rank * 0.15 else '波动较小，录取稳定性较好'}。"
            )
        if prob > 0:
            ci_str = f"（置信区间 {prob_low}%–{prob_high}%）" if prob_low and prob_high else ""
            m1_lines.append(
                f"Sigmoid概率模型综合以上参数，计算录取概率为 {prob}%{ci_str}。"
                f"通俗理解：若100位与您相同位次的考生同时报考，理论上约 {round(prob)} 人会被录取。"
            )
        conf_map = {"高": "历史数据充足（≥3年），置信度高", "中": "数据2-3年，具参考价值", "低": "数据较少，建议结合官方招生简章核实"}
        m1_lines.append(f"数据置信度：{conf_map.get(confidence, confidence)}。")
    else:
        m1_lines.append(f"{school_name}{major_name}暂无足够历史录取位次数据，概率仅供参考，建议重点参考该校整体录取线。")
    sections.append(("📊 录取概率解析", "\n".join(m1_lines)))

    # ────────────────────────────────────────────────────────────────
    # 【模块2】大小年深度研判
    # ────────────────────────────────────────────────────────────────
    m2_lines = []
    if bsy_status:
        m2_lines.append(
            f"系统检测到该专业今年预判为「{bsy_status}」{bsy_trend}。"
        )
        m2_lines.append(
            "大小年原理：当某专业某年进入门槛意外降低（小年），次年大量考生跟风报考导致门槛抬升（大年），"
            "形成周期性波动。准确判断大小年是超越位次的重要填报技巧。"
        )
        if bsy_reason:
            m2_lines.append(f"判断依据：{bsy_reason}")
        if bsy_pred:
            m2_lines.append(f"2026年预测：{bsy_pred}")
        if bsy_status in ("小年", "持续走冷"):
            m2_lines.append("策略建议：今年是积极报考的窗口期，可在概率基础上适当提高期望。")
        elif bsy_status in ("大年", "持续升温"):
            m2_lines.append("策略建议：今年竞争可能加剧，建议在位次基础上预留5%–10%安全边际。")
    else:
        m2_lines.append(f"近年录取位次相对平稳，未检测到明显大小年规律，可按历史均值正常参考。")
    if plan_warn:
        m2_lines.append(plan_warn)
    if recent_data:
        yr_strs = "、".join(f"{r['year']}年({r['min_rank']:,}位)" for r in recent_data[:4] if r.get('min_rank'))
        if yr_strs:
            m2_lines.append(f"历年最低位次参考：{yr_strs}。")
    sections.append(("📅 大小年研判", "\n".join(m2_lines)))

    # ────────────────────────────────────────────────────────────────
    # 【模块3】冷门价值量化分析（仅限冷门宝藏）
    # ────────────────────────────────────────────────────────────────
    if is_gem and top_gem:
        m3_lines = []
        gem_type  = top_gem.get("gem_type", "")
        gem_label = top_gem.get("gem_type_label", "")
        gem_desc  = top_gem.get("gem_description", "")
        gem_adv   = top_gem.get("advantage", "")
        gem_risk  = top_gem.get("risk", "")
        cd        = top_gem.get("cold_score_detail") or {}
        cs        = cd.get("score")
        cs_rank   = cd.get("rank_in_all")
        cs_total  = cd.get("components", {})

        m3_lines.append(
            f"本推荐被系统标记为「{gem_label}」型冷门宝藏（类型{gem_type}）。"
            f"冷门≠差，而是指「市场报考热度低于真实就业价值」的套利机会。"
        )
        if cs is not None and cs_rank:
            m3_lines.append(
                f"动态冷门评分：{cs}/100（全国{cs_rank}名）。"
                f"评分从认知差距、薪资错配、产业动能、供给稀缺四个维度综合计算。"
            )
            comps = cd.get("components", {})
            if comps:
                m3_lines.append(
                    f"  · 认知差距分 {comps.get('recognition_gap',0):.0f}/100——薪资竞争力远超报考热度"
                    f"\n  · 薪资错配分 {comps.get('salary_mismatch',0):.0f}/100——录取位次与薪资水平不匹配"
                    f"\n  · 产业动能分 {comps.get('industry_momentum',0)}/100——2026–2030年行业成长预期"
                    f"\n  · 供给稀缺分 {comps.get('supply_scarcity',0):.0f}/100——全国毕业生数量相对稀少"
                )
        if gem_desc:
            m3_lines.append(gem_desc)
        if gem_adv:
            m3_lines.append(f"价值优势：{gem_adv}")
        misc = top_gem.get("misconception_corrected", "")
        if misc:
            m3_lines.append(f"认知纠正：{misc}")
        if gem_risk:
            m3_lines.append(f"注意事项：{gem_risk}")
        # 如果有城市折价（Type A）
        if gem_type == "A" and city:
            m3_lines.append(
                f"城市因素：{city}城市热度低于一线城市，导致同等学科实力的学校报考位次系统性偏低——"
                f"这正是可以利用的信息差。大型企业校招更看重学校层次和学科评估，而非所在城市。"
            )
        sections.append(("💎 冷门价值分析", "\n".join(m3_lines)))

    # ────────────────────────────────────────────────────────────────
    # 【模块3b】专业冷门维度解读（冷门宝藏专属，紧接冷门分析后展示）
    # ────────────────────────────────────────────────────────────────
    if is_gem:
        m3b_lines = []
        gem_type_code = top_gem.get("gem_type", "") if top_gem else ""
        gem_major_name = (top_gem.get("major_name") if top_gem else None) or major_name
        # 如果是占位符（院校最低分），用学校名称替代，避免出现在用户可见文本中
        if not gem_major_name or '院校最低分' in gem_major_name:
            gem_major_name = school_name

        # 学科评估背书 ——逻辑修复：
        # A/D类冷门核心价值 = 学校学科强，展示A类学科有意义
        # B类冷门核心价值 = 推荐专业本身被认知低估，展示的A类学科必须与推荐专业相关
        # C/E类：可展示学校整体学科实力作为补充
        if strong_subs:
            if gem_type_code in ("A", "D"):
                # 城市折价/学科强校：A类学科本身是推荐依据，直接展示
                subs_str = "、".join(strong_subs[:3])
                m3b_lines.append(
                    f"学科评估加持：{school_name}的「{subs_str}」通过教育部A类评定。"
                    f"冷门院校中有A类学科，说明科研实力和师资配置已达全国顶尖梯队，"
                    f"但因学校整体排名或城市位置，报考热度仍被市场低估。"
                )
            elif gem_type_code == "B":
                # 认知折价：只展示与推荐专业名直接相关的学科，避免张冠李戴
                related_subs = [s for s in strong_subs
                                if s == gem_major_name or gem_major_name in s or s in gem_major_name]
                if related_subs:
                    m3b_lines.append(
                        f"学科支撑：{school_name}的「{related_subs[0]}」在教育部学科评估中达A类，"
                        f"直接支撑了推荐专业「{gem_major_name}」的培养质量，进一步验证其冷门价值。"
                    )
            elif gem_type_code in ("C", "E"):
                # 时机/口碑折价：展示整体学校实力作为补充信息
                subs_str = "、".join(strong_subs[:2])
                if subs_str:
                    m3b_lines.append(
                        f"学校实力背书：{school_name}的「{subs_str}」通过教育部A类评定，"
                        f"整体培养质量可信。"
                    )

        # 专业职业去向
        career = emp.get("career_direction") or ""
        if career:
            m3b_lines.append(
                f"专业去向：「{gem_major_name}」典型职业方向为——{career}。"
                f"该专业具备清晰的就业路径，并非「冷门」意义上的就业困难，"
                f"而是「报考人少但出口优质」的价值洼地。"
            )

        # 专业满意度
        satisfaction = emp.get("satisfaction") or 0
        if satisfaction >= 3.5:
            m3b_lines.append(
                f"专业满意度：{satisfaction:.1f}/5.0（毕业生调研）。"
                f"满意度高于3.5分意味着实际就读体验超出入学预期，"
                f"这是「认知差」带来的隐性优势。"
            )

        # 薪资水平（仅专业级数据）
        emp_source = emp.get("data_source", "")
        maj_sal = emp.get("avg_salary") or 0
        if maj_sal > 0 and emp_source not in ("school_official", "edu_platform"):
            m3b_lines.append(
                f"薪资参考：{gem_major_name}毕业生起薪均值约 ¥{maj_sal/1000:.1f}k/月"
                f"（与录取位次差相比，性价比显著）。"
            )

        # B类冷门的认知纠正专项提示
        if top_gem and top_gem.get("gem_type") == "B":
            misc = top_gem.get("misconception_corrected", "")
            if misc and misc not in "\n".join(m3_lines if is_gem and top_gem else []):
                m3b_lines.append(f"市场误解：{misc}")

        if m3b_lines:
            sections.append(("🎓 专业冷门维度", "\n".join(m3b_lines)))

    # ────────────────────────────────────────────────────────────────
    # 【模块4】就业数据深度解读
    # ────────────────────────────────────────────────────────────────
    m4_lines = []
    school_sal  = emp.get("avg_salary") or 0
    emp_rate    = emp.get("school_employment_rate") or 0
    postgrad    = emp.get("school_postgrad_rate") or 0
    emp_tier    = emp.get("school_employer_tier") or ""
    top_ind     = emp.get("top_industry") or ""
    top_city_e  = emp.get("top_city") or ""
    satisfaction = emp.get("satisfaction") or 0
    data_src    = emp.get("data_source") or ""
    src_label   = {"official_report": "学校官方就业质量年报", "edu_platform": "教育部就业数据平台"}.get(data_src, "综合估算")

    if school_sal > 0:
        m4_lines.append(f"就业数据来源：{src_label}。")
        sal_k = school_sal / 1000
        m4_lines.append(
            f"{school_name}毕业生平均月薪约 {sal_k:.1f}k 元"
            + (f"，就业率 {emp_rate*100:.0f}%" if emp_rate > 0 else "")
            + (f"，深造率 {postgrad*100:.0f}%（含保研、考研、出国）" if postgrad > 0.1 else "")
            + "。"
        )
        if postgrad > 0.25:
            m4_lines.append(f"深造率高达 {postgrad*100:.0f}%，意味着超过四分之一的毕业生选择继续读研，学术资源和考研成功率较高。")
        if emp_tier == "头部":
            m4_lines.append("该校毕业生以头部企业（华为、腾讯、阿里、国央企一类等）为主要就业去向，校企合作资源强。")
        elif emp_tier == "中等":
            m4_lines.append("毕业生就业以规模以上企业为主，就业质量稳健。")
        if top_ind:
            m4_lines.append(f"主要就业行业：{top_ind}。")
        if top_city_e:
            m4_lines.append(f"主要就业城市：{top_city_e}。")
    elif satisfaction > 0:
        m4_lines.append(f"{major_name}全国专业满意度评分 {satisfaction:.1f}/5.0（基于毕业生调研）。")
        if top_ind:
            m4_lines.append(f"主要流向行业：{top_ind}。")
    else:
        m4_lines.append(f"暂未收录 {school_name} 的就业质量数据，建议参考该校官网发布的年度就业质量报告。")
    if strong_subs:
        m4_lines.append(
            f"学科支撑：{school_name}的 {'/'.join(strong_subs[:3])} 等学科通过教育部评估达到A类，"
            f"这是专业培养质量的重要背书，直接影响就业竞争力。"
        )
    sections.append(("💼 就业数据解读", "\n".join(m4_lines)))

    # ────────────────────────────────────────────────────────────────
    # 【模块5】2026年专项因素
    # ────────────────────────────────────────────────────────────────
    m5_lines = []
    m5_lines.append(
        "以下因素为2026年高考专属分析，对今年填报决策具有直接参考价值："
    )
    if plan_warn:
        m5_lines.append(f"① 招生计划变动：{plan_warn}")
    else:
        m5_lines.append("① 招生计划：今年计划人数与历史持平，位次预测参考价值正常。")

    # 机会信号（来自 opportunity_signals，这是竞品看不到的差异化分析）
    opp_signals = result.get("opportunity_signals") or []
    opp_score = result.get("opportunity_score") or 0
    if opp_signals:
        m5_lines.append(
            "⭐ 机会信号（独家分析）：" + "；".join(opp_signals) + "。"
            + ("建议在概率基础上提高报考意愿。" if opp_score > 10 else
               "建议谨慎，注意招生计划收缩带来的风险。" if opp_score < 0 else "")
        )

    # 行业前景（基于冷门动能分 → 上市公司招聘数据实证）
    gem_momentum = 0
    if top_gem and top_gem.get("cold_score_detail"):
        gem_momentum = top_gem["cold_score_detail"].get("components", {}).get("industry_momentum", 0)
    if gem_momentum == 0:
        # 用 cold_score_engine 的 INDUSTRY_MOMENTUM_2030 直接查（已含上市公司数据校准）
        from algorithms.cold_score_engine import _industry_momentum
        gem_momentum = _industry_momentum(major_name)
    if gem_momentum >= 80:
        outlook = "爆发增长期，国家政策重点支持，上市公司招聘数据显示该方向岗位薪资处于前列"
    elif gem_momentum >= 65:
        outlook = "稳定成长期，上市公司招聘数据显示需求端持续扩张，就业竞争相对温和"
    elif gem_momentum >= 50:
        outlook = "基本平稳，行业存在周期性波动，就业需结合个人能力提升"
    else:
        outlook = "行业招聘量近年持续收缩（据A股上市公司数据），建议关注细分方向的差异化发展路径"
    _outlook_label = major_name if major_name and '院校最低分' not in major_name else school_name
    m5_lines.append(f"② 2030年就业展望（{_outlook_label}方向）：{outlook}。")

    # 薪资参考（来自上市公司真实招聘数据）
    _recruit_sal = _get_recruit_salary_ref(major_name)
    if _recruit_sal:
        m5_lines.append(f"③ 薪资参考（A股上市公司招聘数据）：{_recruit_sal}")

    m5_lines.append(
        "④ 特别提示：本报告所有录取预测基于历史数据，2026年实际情况受政策调整、"
        "报考热度变化等因素影响，建议在系统预测基础上保留±10%的决策弹性空间。"
    )
    sections.append(("⚡ 2026年专项因素", "\n".join(m5_lines)))

    # ────────────────────────────────────────────────────────────────
    # 【模块6】风险提示
    # ────────────────────────────────────────────────────────────────
    m6_lines = []
    risks = []
    if rank_diff < -1000:
        risks.append(f"录取概率偏低（{prob}%），建议仅作冲刺用途，不可作为唯一志愿")
    if comp_count > 20:
        risks.append(f"该位次段竞争者较多（约{comp_count}所学校竞争），报考热度高，实际难度可能高于历史数据")
    if confidence == "低":
        risks.append("历史数据年份较少，预测精度有限，建议参考学校官方招生简章")
    if bsy_status in ("大年", "持续升温"):
        risks.append("今年为大年，历史均值偏乐观，实际录取线可能高于预期")
    if plan_warn and "缩招" in plan_warn:
        risks.append("招生计划缩减，历史录取位次参考价值下降，实际门槛可能上升")
    if not risks:
        risks.append("当前数据未发现显著风险因素")
    for i, r in enumerate(risks, 1):
        m6_lines.append(f"{'①②③④⑤'[i-1]} {r}。")
    m6_lines.append("填报建议：所有志愿均应查阅招生简章确认选科/体检要求及调剂政策。")
    sections.append(("⚠️ 风险提示", "\n".join(m6_lines)))

    # ────────────────────────────────────────────────────────────────
    # 【模块7】填报策略
    # ────────────────────────────────────────────────────────────────
    m7_lines = []
    if rank_diff < -500:
        pos_advice = "冲刺区（建议放在志愿表前1/3位置）"
        combo = "需搭配55%–80%概率的稳妥志愿作为核心保障，不可全部填冲刺"
    elif rank_diff > 3000:
        pos_advice = "保底区（建议放在志愿表后1/3位置）"
        combo = "前面填写更有挑战性的冲刺和稳妥志愿，此志愿作为最终兜底"
    else:
        pos_advice = "稳妥核心区（建议放在志愿表中段）"
        combo = "是本次志愿的核心竞争区间，前后分别搭配冲刺和保底志愿"
    m7_lines.append(f"建议位置：{pos_advice}。")
    m7_lines.append(f"组合逻辑：{combo}。")
    tier_label = "985院校" if is_985 else ("211院校" if is_211 else ("双一流院校" if "双一流" in tier else ""))
    if tier_label:
        m7_lines.append(f"{school_name}为{tier_label}，综合质量评分{quality:.0f}/100，在同录取概率的院校中竞争力较强。")
    m7_lines.append(
        f"数据说明：本分析基于系统录取数据库（近年省市录取记录），"
        f"置信度「{confidence}」——{'数据充足，预测可靠' if confidence=='高' else ('数据适中，具参考价值' if confidence=='中' else '数据较少，建议综合参考')}。"
    )
    sections.append(("✅ 填报建议", "\n".join(m7_lines)))

    # ────────────────────────────────────────────────────────────────
    # 【模块8】读研ROI + 城市就业（上市公司数据驱动）
    # ────────────────────────────────────────────────────────────────
    m8_career_lines = []
    # 读研建议
    master_text = _get_master_premium_text(major_name)
    if master_text:
        m8_career_lines.append(master_text)
    # 城市就业机会
    city_text = _get_city_employment_text(city)
    if city_text:
        m8_career_lines.append(city_text)
    # 经验增长曲线（通用）
    if emp.get("avg_salary") and emp["avg_salary"] > 0:
        _base = emp["avg_salary"]
        m8_career_lines.append(
            f"薪资增长参考（上市公司数据）：起薪→3年经验约×1.6→5年约×2.1→10年约×3.3。"
            f"即该方向5年后月薪预期约 ¥{int(_base * 2.1 / 1000):.0f}k。"
        )
    if m8_career_lines:
        m8_career_lines.append("（以上数据来源：A股上市公司2024-2025年招聘岗位统计，仅供参考。）")
        sections.append(("📈 职业发展参考", "\n".join(m8_career_lines)))

    # ────────────────────────────────────────────────────────────────
    # 【模块9】学生口碑参考（有数据时才展示）
    # ────────────────────────────────────────────────────────────────
    review_data = result.get("review_data")
    if review_data and (review_data.get("positive_count", 0) + review_data.get("negative_count", 0)) >= 3:
        m8_lines = []
        sc = review_data.get("sentiment_score", 0.5)
        delta = review_data.get("sentiment_delta", 0.0)
        pos_c = review_data.get("positive_count", 0)
        neg_c = review_data.get("negative_count", 0)
        review_cnt = review_data.get("review_count", 0)

        # 口碑定性描述
        if sc >= 0.75:
            label = "整体口碑优秀"
            label_detail = "在同类学校中，该校学生满意度处于较高水平"
        elif sc >= 0.60:
            label = "整体口碑良好"
            label_detail = "学生评价以正面为主，有一定改进空间"
        elif sc >= 0.45:
            label = "口碑褒贬参半"
            label_detail = "正负评价较为均衡，不同学生体验差异较大"
        else:
            label = "口碑存在明显争议"
            label_detail = "负面评价较多，建议深入了解后再做决策"

        m8_lines.append(
            f"基于公开渠道的讨论分析（采样{review_cnt}条相关内容），"
            f"{school_name}{label}。{label_detail}。"
        )
        m8_lines.append(
            f"情感分布：正向信号 {pos_c} 次 / 负向信号 {neg_c} 次，"
            f"口碑指数 {sc*100:.0f}/100。"
        )

        # 相对同层次纠偏说明
        if abs(delta) >= 0.05:
            if delta > 0:
                m8_lines.append(
                    f"横向比较：相比同层次学校，该校口碑偏高约 {delta*100:.0f} 个百分点，"
                    f"说明实际体验可能优于排名所示。"
                )
            else:
                m8_lines.append(
                    f"横向比较：相比同层次学校，该校口碑偏低约 {abs(delta)*100:.0f} 个百分点，"
                    f"建议提前详细了解校园环境和管理情况。"
                )

        # 高频词展示
        try:
            top_pos = json.loads(review_data.get("top_positive", "[]"))
            top_neg = json.loads(review_data.get("top_negative", "[]"))
            if top_pos:
                pos_words = "、".join(w for w, _ in top_pos[:3])
                m8_lines.append(f"学生常提及的正向特质：{pos_words}。")
            if top_neg:
                neg_words = "、".join(w for w, _ in top_neg[:3])
                m8_lines.append(f"学生提及的待改进方面：{neg_words}。")
        except Exception:
            pass

        # 代表性原文
        try:
            quotes = json.loads(review_data.get("sample_quotes", "[]"))
            if quotes:
                m8_lines.append(f"代表性讨论片段：「{quotes[0][:60]}」")
        except Exception:
            pass

        m8_lines.append(
            "⚠️ 以上口碑数据来源于公开社区内容的自动分析，仅供参考，"
            "建议结合官方数据和个人实地考察综合判断。"
        )
        sections.append(("🗣 学生口碑参考", "\n".join(m8_lines)))

    # ── 组装输出 ──────────────────────────────────────────────────
    # 结构化版本注入 result（供前端分段渲染）
    result["reason_sections"] = [
        {"title": title, "content": content}
        for title, content in sections
    ]

    # 纯文本版本（向后兼容PDF）
    text_parts = []
    for title, content in sections:
        text_parts.append(f"【{title}】\n{content}")
    return "\n\n".join(text_parts)


def _paywall_strip(r: dict) -> dict:
    """For unpaid users: return a minimal locked placeholder — school name, tier,
    city visible for teaser; all analysis fields hidden."""
    # Teaser fields for locked cards: enough to show value tags, no analysis data
    emp = r.get("employment") or {}
    tg = r.get("top_gem")
    return {
        "locked": True,
        "school_name":  r.get("school_name", ""),
        "major_name":   r.get("major_name", ""),
        "city":         r.get("city", ""),
        "is_985":       r.get("is_985", ""),
        "is_211":       r.get("is_211", ""),
        "tier":         r.get("tier", ""),
        "is_hidden_gem": r.get("is_hidden_gem", False),
        "city_level":   r.get("city_level", ""),
        "flagship_majors": r.get("flagship_majors", ""),
        "top_gem":      {"gem_type_label": tg.get("gem_type_label", "")} if tg else None,
        "employment":   {"school_employment_rate": emp.get("school_employment_rate")} if emp.get("school_employment_rate") else None,
    }


# ── 推荐结果缓存（进程内，按位次桶缓存30分钟）──────────────────────────────────
_rec_cache: dict = {}   # key → (result_dict, timestamp)
_REC_CACHE_TTL = 1800   # 30分钟
_REC_RANK_BUCKET = 1000 # 每1000位次共用一个缓存桶

def _rec_cache_get(province: str, rank: int, subject: str, is_paid: bool):
    key = f"{province}|{(rank//_REC_RANK_BUCKET)*_REC_RANK_BUCKET}|{subject}|{is_paid}"
    entry = _rec_cache.get(key)
    if entry and time.time() - entry[1] < _REC_CACHE_TTL:
        return entry[0]
    return None

def _rec_cache_set(province: str, rank: int, subject: str, is_paid: bool, result: dict):
    key = f"{province}|{(rank//_REC_RANK_BUCKET)*_REC_RANK_BUCKET}|{subject}|{is_paid}"
    _rec_cache[key] = (result, time.time())
    if len(_rec_cache) > 500:  # 超过500项时清理最旧的50项
        oldest = sorted(_rec_cache.items(), key=lambda x: x[1][1])[:50]
        for k, _ in oldest:
            _rec_cache.pop(k, None)


# ── 数据层：加载全部 cache + 组合候选学校画像 ──────────────────
def _build_recommend_data(
    province: str,
    rank: int,
    subject: str,
    db: Session,
) -> dict:
    """
    推荐主流程的**数据基座**：一次性完成
      ① SQL 拉取 admission_records  ② 分组 + 兜底过滤
      ③ P6 历史池剔除仅招物理专业   ④ 院校最低分 baseline 近年补充
      ⑤ School / 学科评估 / MajorEmployment / SchoolEmployment(多源验证) /
         SchoolReview 全部预加载
      ⑥ major_subject_cache + _subject_match 闭包
      ⑦ school_majors_raw + school_prior_rank（贝叶斯平滑用）
      ⑧ 组装 candidates（每条含录取统计 + 画像 + 薪资回退源标记）

    返回各键一句说明：
      candidates — 各校各专业一条：录取统计 + 学校画像 + 薪资与就业摘要 + 口碑计数。
        province_admission — 招生省（考生省）。
        school_name / major_name — 学校名、专业名。
        subject_req / batch — 最近一年的选科要求、批次。
        subject_req_matched — 与用户选科比对用的归一化选科要求。
        school_prior_rank — 该校先验平均位次。
        years_count — 参与统计的年份条数。
        admission_by_year — 近年逐年录取明细。
        max/median/min_score — 近年最低分的高/中/低。
        max/median/min_rank — 近年最低位次的高/中/低。
        recent_year / recent_min_rank / recent_min_score / recent_admit_count — 最近年及对应位次分与计划数。
        city / province_school — 所在城市、学校所在省。
        tier — 院校档次。
        school_type — 院校类型。
        is_985 / is_211 / is_shuangyiliu / nature — 985、211、双一流、办学性质。
        city_level — 城市层级。
        rank_2025 / rank_2024 — 排名两年数据。
        admin_dept — 主管部门。
        postgrad_rate — 保研率等文字说明。
        male_ratio / female_ratio — 男女比例说明。
        flagship_majors — 王牌专业说明。
        employment_quality — 学校就业质量摘要。
        satisfaction_score_school — 学校综合满意度。
        admission_website / website — 招生网、官网。
        school_intro — 学校简介节选。
        founded_year — 建校年。
        tags — 学校标签。
        avg_salary — 展示用月薪（多源回退后）。
        salary_source — 月薪数据来源标记。
        major_satisfaction / major_employment_rate — 专业满意度、专业就业率。
        school_avg_salary / school_employment_rate / school_postgrad_rate / school_overseas_rate — 学校级薪资与就业深造率。
        top_employer_tier — 头部雇主档位。
        school_top_employers / school_top_industries / school_top_cities — 头部雇主、行业、去向城市。
        school_employment_year / school_employment_data_source — 学校就业数据年份与来源。
        data_reliability — 学校就业多源可靠度结论。
        review_count / positive_count / negative_count — 口碑样本量与正负面计数。
      grouped — 按校+专业聚合的历年录取点。
      school_cache — 全表学校实体。
      school_baseline_cache — 各校「院校最低分」近年曲线。
      subject_eval_cache — 各校强学科评估条目。
      emp_cache — 专业就业轻量缓存（打分用）。
      emp_full_cache — 专业就业全字段缓存（文案用，不全进 candidates）。
      school_emp_cache — 学校就业合并后一条（含可靠度）。
      review_cache — 学校口碑全量。
      major_subject_cache — 校+专业对应的归一化选科要求。
      school_majors_raw — 各校各专业有效录取点原始列表。
      school_prior_rank — 各校先验位次均值表。
      subject_match — 判断某校某专业是否匹配用户选科。
      user_subjects — 用户选科拆分结果。
      student_pool — 从选科推断的物理/历史池（空串表示未识别）。
    """
    assert db is not None, "db (Session) 必填"

    # ── 1. 选科池解析 ────────────────────────────────────────────
    _POOL_PHYSICS = {"物理类", "物理", "理科"}
    _POOL_HISTORY = {"历史类", "历史", "文科"}
    _student_pool = ""
    if subject:
        for s in subject.split("+"):
            s = s.strip()
            s_norm = {"理科": "物理", "物理类": "物理",
                      "文科": "历史", "历史类": "历史"}.get(s, s)
            if s_norm == "物理":
                _student_pool = "物理"; break
            if s_norm == "历史":
                _student_pool = "历史"; break

    # ── 2. SQL 级过滤 + 拉取 admission_records ───────────────────
    _sql_extra = ""
    _sql_params: dict = {"prov": province}
    if _student_pool == "物理":
        _sql_extra += " AND COALESCE(subject_req,'') NOT IN ('历史类','历史','文科')"
    elif _student_pool == "历史":
        _sql_extra += " AND COALESCE(subject_req,'') NOT IN ('物理类','物理','理科')"
    for _bkw in ("提前批", "艺术", "专科", "高职", "专项", "预科", "蒙授", "民航飞行"):
        _sql_extra += f" AND COALESCE(batch,'') NOT LIKE '%{_bkw}%'"
    # ── 位次区间过滤（gap_rate 方法）────────────────────────────
    # gap_rate = (avg_school_rank - student_rank) / student_rank
    # 冲区：[-0.20, -0.10)  → school_rank ∈ [0.80X, 0.90X)
    # 稳区：[-0.10, +0.10]  → school_rank ∈ [0.90X, 1.10X]
    # 保区：(+0.10, +0.40]  → school_rank ∈ (1.10X, 1.40X]
    # SQL 预过滤取 ±5% 额外缓冲（单年 min_rank 与多年加权均值有偏差）
    if rank > 0:
        _rank_lo = max(1, int(rank * 0.75))   # 冲下界 0.80 - 5% 缓冲
        _rank_hi = int(rank * 1.45)            # 保上界 1.40 + 5% 缓冲
        _prov_cap = _get_province_total(province, 2025)
        if _prov_cap > 0:
            _rank_hi = min(_prov_cap, _rank_hi)
        _sql_extra += " AND (min_rank IS NULL OR min_rank = 0 OR (min_rank >= :rank_lo AND min_rank <= :rank_hi))"
        _sql_params["rank_lo"] = _rank_lo
        _sql_params["rank_hi"] = _rank_hi
        print(
            f"[_build_recommend_data] gap_rate filter: rank={rank} "
            f"min_rank ∈ [{_rank_lo}, {_rank_hi}]（gap_rate±5%缓冲）",
            flush=True,
        )
    raw_rows = db.execute(_sqla_text(
        "SELECT school_name, major_name, year, min_rank, min_score, "
        "COALESCE(admit_count,0), COALESCE(subject_req,''), COALESCE(batch,'') "
        f"FROM admission_records WHERE province=:prov AND year>=2017{_sql_extra}"
    ), _sql_params).fetchall()

    # ── 3. 按 (校, 专业) 分组 + Python 层兜底过滤 ────────────────
    _EXCLUDE_BATCH_KW = ("提前批", "艺术", "专科", "高职", "专项", "预科", "蒙授", "民航飞行")
    _EXCLUDE_SCHOOL_KW = ("高等专科学校", "职业技术学院", "高职学院", "职业学院", "专科学校")
    grouped: dict = defaultdict(list)
    for row in raw_rows:
        s_name, m_name, year, mrank, mscore, admit, sreq, batch = row
        sr_strip = sreq.strip() if sreq else ""
        if _student_pool == "物理" and sr_strip in _POOL_HISTORY:
            continue
        if _student_pool == "历史" and sr_strip in _POOL_PHYSICS:
            continue
        if any(kw in batch for kw in _EXCLUDE_BATCH_KW):
            continue
        if any(kw in s_name for kw in _EXCLUDE_SCHOOL_KW) and "大学" not in s_name:
            continue
        grouped[(s_name, m_name)].append({
            "year": year, "min_rank": mrank, "min_score": mscore,
            "plan_count": admit,
            "subject_req": (sreq or "").strip(),
            "batch": (batch or "").strip(),
        })

    # ── 4. P6：历史池剔除「全国仅招物理」的专业 ───────────────────
    #     避免本省 subject_req 填"不限"但全国范围只招物理的专业混入历史推荐
    if _student_pool == "历史" and grouped:
        from sqlalchemy import or_ as _or_
        _grouped_schools = list({k[0] for k in grouped.keys()})
        _phy_rows = db.query(AdmissionRecord.school_name, AdmissionRecord.major_name)\
            .filter(
                AdmissionRecord.school_name.in_(_grouped_schools),
                _or_(
                    AdmissionRecord.subject_req.like("%物理%"),
                    AdmissionRecord.subject_req == "理科",
                )
            ).distinct().all()
        _hist_rows = db.query(AdmissionRecord.school_name, AdmissionRecord.major_name)\
            .filter(
                AdmissionRecord.school_name.in_(_grouped_schools),
                _or_(
                    AdmissionRecord.subject_req.like("%历史%"),
                    AdmissionRecord.subject_req == "文科",
                )
            ).distinct().all()
        _has_p = {(r.school_name, r.major_name) for r in _phy_rows}
        _has_h = {(r.school_name, r.major_name) for r in _hist_rows}
        _physics_only = _has_p - _has_h
        for _k in list(grouped.keys()):
            if _k in _physics_only:
                grouped.pop(_k, None)

    # ── 5. School 预加载 ─────────────────────────────────────────
    school_cache = {s.name: s for s in db.query(School).all()}

    # ── 6. 院校最低分 baseline（补充专业级近年数据缺失）───────────
    school_baseline_cache: dict = defaultdict(list)
    baseline_rows = db.execute(_sqla_text(
        "SELECT school_name, year, MAX(min_rank) as min_rank, MIN(min_score) as min_score "
        "FROM admission_records "
        "WHERE province=:prov AND major_name LIKE '%院校最低分%' AND min_rank > 0 "
        "GROUP BY school_name, year "
        "ORDER BY school_name, year DESC"
    ), {"prov": province}).fetchall()
    for br in baseline_rows:
        school_baseline_cache[br[0]].append({
            "year": br[1], "min_rank": br[2], "min_score": br[3],
            "plan_count": 0, "is_school_baseline": True,
        })

    # ── 7. A 类学科评估 ──────────────────────────────────────────
    subject_eval_cache: dict = defaultdict(list)
    for ev in db.query(SubjectEvaluation).filter(
        SubjectEvaluation.grade.in_(["A+", "A", "A-"])
    ).all():
        subject_eval_cache[ev.school_name].append({
            "major_name":       ev.subject_name,
            "subject_strength": ev.grade,
            "subject_req":      "",
            "category":         ev.category or "",
            "major_category":   ev.major_category or "",
            "subject_code":     ev.subject_code or "",
        })

    # ── 8. MajorEmployment（双 cache：gem 评分用 + 展示用）────────
    emp_cache: dict = defaultdict(list)
    emp_full_cache: dict = {}
    for emp in db.query(MajorEmployment).all():
        emp_cache[emp.major_name].append({
            "major_name":   emp.major_name,
            "avg_salary":   emp.avg_salary or 0,
            "satisfaction": emp.satisfaction or 0.0,
        })
        if emp.major_name not in emp_full_cache:
            emp_full_cache[emp.major_name] = {
                "avg_salary":        emp.avg_salary,
                "top_city":          emp.top_city,
                "top_industry":      emp.top_industry,
                "common_jobs":       emp.common_jobs,
                "employment_rank":   emp.employment_rank,
                "satisfaction":      emp.satisfaction,
                "career_direction":  emp.career_direction,
                "salary_trend":      emp.salary_trend,
                "gender_male":       emp.gender_male,
                "gender_female":     emp.gender_female,
                "intro":             (emp.intro or "")[:4000],
                "employment_rate":   emp.employment_rate,
                "job_directions":    emp.job_directions,
                "salary_by_exp":     emp.salary_by_exp,
                "training_goal":     emp.training_goal,
                "industry_dist":     emp.industry_dist,
                "city_dist":         emp.city_dist,
                "major_code":        emp.major_code,
                "edu_level":         emp.edu_level,
                "category_1":        emp.category_1,
                "category_2":        emp.category_2,
            }

    # ── 9. SchoolEmployment 多源交叉验证 ─────────────────────────
    def _sanitize_source(raw: str) -> str:
        if not raw:
            return ""
        if "官方" in raw:
            return raw
        if "估算" in raw:
            return "综合估算"
        return "公开数据整理"

    _se_raw: dict = defaultdict(list)
    for se in db.query(SchoolEmployment).order_by(SchoolEmployment.year.desc()).all():
        _se_raw[se.school_name].append({
            "avg_salary":         se.avg_salary or 0,
            "employment_rate":  se.employment_rate or 0.0,
            "postgrad_rate":      se.postgrad_rate or 0.0,
            "overseas_rate":      se.overseas_rate or 0.0,
            "top_employer_tier":  se.top_employer_tier or "",
            "top_employers":      se.top_employers or "[]",
            "top_industries":     se.top_industries or "",
            "top_cities":         se.top_cities or "",
            "postgrad_schools":   se.postgrad_schools or "",
            "report_url":         se.report_url or "",
            "year":               se.year,
            "data_source":        _sanitize_source(se.data_source or ""),
        })
    school_emp_cache: dict = {}
    for _sname, _entries in _se_raw.items():
        official  = [e for e in _entries if "官方" in (e["data_source"] or "")]
        estimated = [e for e in _entries if "估算" in (e["data_source"] or "")]
        if official and estimated:
            off_sal = official[0]["avg_salary"]
            est_sal = estimated[0]["avg_salary"]
            if off_sal > 0 and est_sal > 0:
                divergence = abs(off_sal - est_sal) / max(off_sal, est_sal)
                if divergence > 0.30:
                    merged = {**official[0], "data_reliability": "数据存疑",
                              "reliability_note": f"官方{off_sal}元 vs 估算{est_sal}元，偏差{divergence:.0%}"}
                else:
                    median_sal = (off_sal + est_sal) // 2
                    merged = {**official[0], "avg_salary": median_sal,
                              "data_reliability": "多源验证", "reliability_note": ""}
            else:
                merged = {**official[0], "data_reliability": "官方数据", "reliability_note": ""}
            school_emp_cache[_sname] = merged
        elif official:
            school_emp_cache[_sname] = {**official[0], "data_reliability": "官方数据", "reliability_note": ""}
        elif _entries:
            school_emp_cache[_sname] = {**_entries[0], "data_reliability": "参考", "reliability_note": ""}
    del _se_raw

    # ── 10. 学生口碑（SchoolReview）──────────────────────────────
    review_cache: dict = {}
    try:
        for rv in db.query(SchoolReview).all():
            review_cache[rv.school_name] = {
                "sentiment_score":  rv.sentiment_score,
                "sentiment_delta":  rv.sentiment_delta,
                "positive_count":   rv.positive_count,
                "negative_count":   rv.negative_count,
                "review_count":     rv.review_count,
                "top_positive":     rv.top_positive,
                "top_negative":     rv.top_negative,
                "sample_quotes":    rv.sample_quotes,
                "review_source":    rv.source or "",
                "source":           "公开社区内容",
            }
    except Exception:
        pass

    # ── 11. major_subject_cache（识别双轨专业：同时招物理/历史视为不限）──
    major_subject_cache: dict = {}
    if subject:
        _sr_sets: dict = defaultdict(set)
        for row in raw_rows:
            sr = (row[6] or "").strip()
            if sr and sr not in ("不限", "nan", "-", "综合"):
                _sr_sets[(row[0], row[1])].add(sr)
        for key, sr_set in _sr_sets.items():
            _has_phys = bool(sr_set & _POOL_PHYSICS)
            _has_hist = bool(sr_set & _POOL_HISTORY)
            if _has_phys and _has_hist:
                pass  # 双轨 → 不入 cache → _subject_match 返回 True（视为不限）
            elif _has_phys:
                major_subject_cache[key] = "物理类"
            elif _has_hist:
                major_subject_cache[key] = "历史类"
            else:
                major_subject_cache[key] = next(iter(sr_set))
        # 从 Major 表补充再选科目（主要覆盖北京）
        for m in db.query(Major).filter(Major.province == province).all():
            key = (m.school_name, m.major_name)
            if key not in major_subject_cache:
                sr = (m.subject_req or "").strip()
                if sr and sr not in ("不限", "nan", "-"):
                    major_subject_cache[key] = sr

    # ── 12. school_majors_raw（供下游 school_available_majors_cache 生成）──
    school_majors_raw: dict = defaultdict(list)
    for row in raw_rows:
        mname, yr, mrank, mscore, sr = row[1], row[2], row[3], row[4], row[6]
        if mname and mname != "[院校最低分]" and mrank and mrank > 0:
            school_majors_raw[row[0]].append({
                "major_name": mname, "min_score": mscore,
                "min_rank":   mrank, "year":     yr,
                "subject_req": (sr or "").strip(),
            })

    # ── 13. _subject_match 闭包（精细选科匹配）──────────────────
    _alias = {
        "政治": "思想政治", "思政": "思想政治", "生物学": "生物",
        "理科": "物理", "文科": "历史",
        "物理类": "物理", "历史类": "历史",
    }
    user_subjects: set = set()
    for s in (subject.split("+") if subject else []):
        s = s.strip()
        user_subjects.add(_alias.get(s, s))
    _user_has_wuli  = "物理" in user_subjects
    _user_has_lishi = "历史" in user_subjects

    def _subject_match(school_nm: str, major_nm: str) -> bool:
        """新高考选科匹配 v2（首选物理/历史 + 再选 AND/OR 逻辑）"""
        if not subject:
            return True
        req = major_subject_cache.get((school_nm, major_nm), "")
        if not req:
            return True
        req_norm = req.strip()
        _OPEN = {"不限", "nan", "-", "", "综合", "不限选科"}
        if req_norm in _OPEN:
            return True

        # 1. 首选科目逻辑（新高考 3+1+2）
        if ("首选物理" in req_norm or req_norm in ("物理类", "理科", "物理必选")
                or req_norm.startswith("物+") or req_norm == "物理"):
            if not _user_has_wuli:
                return False
            if req_norm in ("物理类", "理科", "物理必选", "物理",
                            "首选物理，再选不限", "物+不限"):
                return True
            req_norm = req_norm.replace("首选物理，再选", "").replace("物+", "").strip()
            if not req_norm or req_norm in _OPEN:
                return True
        elif ("首选历史" in req_norm or req_norm in ("历史类", "文科", "历史必选")
              or req_norm.startswith("史+") or req_norm == "历史"):
            if not _user_has_lishi:
                return False
            if req_norm in ("历史类", "文科", "历史必选", "历史",
                            "首选历史，再选不限", "史+不限"):
                return True
            req_norm = req_norm.replace("首选历史，再选", "").replace("史+", "").strip()
            if not req_norm or req_norm in _OPEN:
                return True
        elif "物理" in req_norm and "历史" not in req_norm:
            if not _user_has_wuli:
                return False
        elif "历史" in req_norm and "物理" not in req_norm:
            if not _user_has_lishi:
                return False

        # 2. 再选科目 AND/OR 逻辑
        req_clean = req_norm.replace("（", "(").replace("）", ")").strip()
        req_clean = re.sub(r"\(.*?\)", "", req_clean).strip()
        req_clean = req_clean.replace("思想政治", "政治").replace("思政", "政治").replace("生物学", "生物")
        or_groups = req_clean.split("/")
        for grp in or_groups:
            parts = [p.strip() for p in re.split(r"[,，、+]", grp)
                     if p.strip() and p.strip() not in _OPEN]
            parts_norm = {_alias.get(p, p) for p in parts}
            user_norm  = {_alias.get(s, s) for s in user_subjects}
            if not parts_norm or parts_norm.issubset(user_norm):
                return True
        return False

    # ── 14. 学校先验位次（贝叶斯平滑用）──────────────────────────
    _school_rank_sums: dict = defaultdict(lambda: [0.0, 0])
    for (sname, _), recs in grouped.items():
        latest = max((r for r in recs if (r.get("min_rank") or 0) > 0),
                     key=lambda r: r["year"], default=None)
        if latest:
            _school_rank_sums[sname][0] += latest["min_rank"]
            _school_rank_sums[sname][1] += 1
    school_prior_rank: dict = {}
    for sname, (s, c) in _school_rank_sums.items():
        if c > 0:
            school_prior_rank[sname] = s / c

    # ── 15. 薪资回退链：major → school → recruit_reference ───────
    def _lookup_salary(s_name: str, m_name: str) -> tuple:
        me_full = emp_full_cache.get(m_name)
        if me_full and (me_full.get("avg_salary") or 0) > 0:
            return me_full["avg_salary"], "major_employment"
        se = school_emp_cache.get(s_name)
        if se and (se.get("avg_salary") or 0) > 0:
            return se["avg_salary"], "school_employment"
        if m_name:
            for kw, sal in _RECRUIT_SALARY.items():
                if kw in m_name:
                    return sal, "recruit_reference"
        return 0, "unknown"

    # ── 16. 组装 candidates（统计量 + 全量画像，字段尽量打满）──────
    candidates: list = []
    for key, recs in grouped.items():
        s_name, m_name = key
        recs_sorted = sorted(recs, key=lambda r: r["year"], reverse=True)[:5]
        ranks  = [r["min_rank"]  for r in recs_sorted if r.get("min_rank") and r["min_rank"] > 0]
        scores = [r["min_score"] for r in recs_sorted if r.get("min_score") and r["min_score"] > 0]
        if not ranks:
            continue
        sch     = school_cache.get(s_name)
        me_full = emp_full_cache.get(m_name) or {}
        se_cache = school_emp_cache.get(s_name) or {}
        rv      = review_cache.get(s_name) or {}
        salary, salary_src = _lookup_salary(s_name, m_name)
        _admission_by_year = [
            {
                "year": r["year"],
                "min_rank": r.get("min_rank"),
                "min_score": r.get("min_score"),
                "plan_count": r.get("plan_count"),
                "subject_req": r.get("subject_req", ""),
                "batch": r.get("batch", ""),
            }
            for r in recs_sorted
        ]

        candidates.append({
            "province_admission": province,
            "school_name": s_name,
            "major_name":  m_name,
            "subject_req": recs_sorted[0].get("subject_req", "") if recs_sorted else "",
            "batch":       recs_sorted[0].get("batch", "") if recs_sorted else "",
            "subject_req_matched": major_subject_cache.get((s_name, m_name), ""),
            "school_prior_rank": round(school_prior_rank.get(s_name, 0.0), 2),
            "years_count": len(recs_sorted),
            "admission_by_year": _admission_by_year,
            "max_score":    max(scores) if scores else 0,
            "median_score": statistics.median(scores) if scores else 0,
            "min_score":    min(scores) if scores else 0,
            "max_rank":     max(ranks),
            "median_rank":  statistics.median(ranks),
            "min_rank":     min(ranks),
            "recent_year":        recs_sorted[0]["year"],
            "recent_min_rank":    recs_sorted[0]["min_rank"],
            "recent_min_score":   recs_sorted[0]["min_score"],
            "recent_admit_count": recs_sorted[0]["plan_count"],
            # ── 学校画像（低填充率字段已裁剪，语义见本函数文档）──
            "city":            sch.city if sch else "",
            "province_school": sch.province if sch else "",
            "tier":            sch.tier if sch else "普通",
            "school_type":     sch.school_type if sch else "",
            "is_985":          sch.is_985 if sch else "否",
            "is_211":          sch.is_211 if sch else "否",
            "is_shuangyiliu":  sch.is_shuangyiliu if sch else "否",
            "nature":          sch.nature if sch else "",
            "city_level":      sch.city_level if sch else "",
            "rank_2025":       sch.rank_2025 if sch else 0,
            "rank_2024":       sch.rank_2024 if sch else 0,
            "admin_dept":      sch.admin_dept if sch else "",
            "postgrad_rate":   sch.postgrad_rate if sch else "",
            "male_ratio":      sch.male_ratio if sch else "",
            "female_ratio":    sch.female_ratio if sch else "",
            "flagship_majors": sch.flagship_majors if sch else "",
            "employment_quality": sch.employment_quality if sch else "",
            "satisfaction_score_school": sch.satisfaction_score if sch else 0.0,
            "admission_website": sch.admission_website if sch else "",
            "website":         sch.website if sch else "",
            "school_intro":    (sch.intro or "")[:4000] if sch else "",
            "founded_year":    sch.founded_year if sch else 0,
            "tags": sch.tags.split(",") if sch and sch.tags else [],
            "avg_salary":    salary,
            "salary_source": salary_src,
            # 专业就业：仅保留库中覆盖率较高的指标（其余仍在 emp_full_cache 供主流程）
            "major_satisfaction":    me_full.get("satisfaction") or 0,
            "major_employment_rate": me_full.get("employment_rate") or 0,
            # ── 学校级就业（含多源验证字段）────────────────────────
            "school_avg_salary":      se_cache.get("avg_salary", 0) or 0,
            "school_employment_rate": se_cache.get("employment_rate", 0) or 0,
            "school_postgrad_rate":   se_cache.get("postgrad_rate", 0) or 0,
            "school_overseas_rate":   se_cache.get("overseas_rate", 0) or 0,
            "top_employer_tier":      se_cache.get("top_employer_tier", ""),
            "school_top_employers":   se_cache.get("top_employers", ""),
            "school_top_industries":  se_cache.get("top_industries", ""),
            "school_top_cities":      se_cache.get("top_cities", ""),
            "school_employment_year": se_cache.get("year", 0) or 0,
            "school_employment_data_source": se_cache.get("data_source", ""),
            "data_reliability":       se_cache.get("data_reliability", ""),
            # 口碑：仅保留计数类（情感分/原文摘要等缺失率>70% 不进入候选行）
            "review_count":    rv.get("review_count", 0),
            "positive_count":  rv.get("positive_count", 0),
            "negative_count":  rv.get("negative_count", 0),
        })

    return {
        "candidates":             candidates,
        "grouped":                grouped,
        "school_cache":           school_cache,
        "school_baseline_cache":  school_baseline_cache,
        "subject_eval_cache":     subject_eval_cache,
        "emp_cache":              emp_cache,
        "emp_full_cache":         emp_full_cache,
        "school_emp_cache":       school_emp_cache,
        "review_cache":           review_cache,
        "major_subject_cache":    major_subject_cache,
        "school_majors_raw":      school_majors_raw,
        "school_prior_rank":      school_prior_rank,
        "subject_match":          _subject_match,
        "user_subjects":          user_subjects,
        "student_pool":           _student_pool,
    }



# ── 核心接口：智能推荐 ────────────────────────────────────────
def _run_recommend_core(province: str, rank: int, subject: str, mode: str, db: Session, is_paid: bool = False) -> dict:
    """
    核心推荐逻辑（纯函数，不依赖 Request）。
    供 /api/recommend 端点和 PDF 报告生成共同调用。
    主推荐接口：输入位次，返回冲稳保分层推荐 + 冷门挖掘（接入真实学科评估）
    """
    print(11, province,rank,subject)
    _debug_rc = 1

    def _rc(step: str, **kw: object) -> None:
        """调试：统一前缀打印各阶段状态。关闭：环境变量 GAOKAO_RECOMMEND_DEBUG=0"""
        if not _debug_rc:
            return
        if kw:
            parts = ", ".join(f"{k}={v!r}" for k, v in kw.items())
            print(f"[recommend_core] {step} | {parts}", flush=True)
        else:
            print(f"[recommend_core] {step}", flush=True)

    # 缓存命中快速返回
    _cached = _rec_cache_get(province, rank, subject, is_paid)
    if _cached is not None:
        _rc("① 缓存命中，直接返回（未执行后续阶段）", province=province, rank=rank, subject=subject, is_paid=is_paid)
        return _cached

    _rc(
        "② 开始全量计算",
        province=province,
        rank=rank,
        subject=subject or "(空)",
        mode=mode + "（当前未参与分支，仅占位）",
        is_paid=is_paid,
    )

    # ── 数据层：一次性加载全部 cache + 组合候选画像 ───────────
    data = _build_recommend_data(province, rank, subject, db)
    grouped                = data["grouped"]
    school_cache           = data["school_cache"]
    _school_baseline_cache = data["school_baseline_cache"]
    subject_eval_cache     = data["subject_eval_cache"]
    emp_cache              = data["emp_cache"]
    emp_full_cache         = data["emp_full_cache"]
    school_emp_cache       = data["school_emp_cache"]
    review_cache           = data["review_cache"]
    major_subject_cache    = data["major_subject_cache"]
    _school_majors_raw     = data["school_majors_raw"]
    _school_prior_rank     = data["school_prior_rank"]
    _subject_match         = data["subject_match"]
    user_subjects          = data["user_subjects"]
    _student_pool          = data["student_pool"]

    # 调试：随机打印至多 5 条 candidates（长字符串截断便于终端阅读）
    def _truncate_log_strings(obj: object, maxlen: int = 20) -> object:
        if isinstance(obj, str):
            return obj[:maxlen] + ("..." if len(obj) > maxlen else "")
        if isinstance(obj, dict):
            return {k: _truncate_log_strings(v, maxlen) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_truncate_log_strings(v, maxlen) for v in obj]
        if isinstance(obj, tuple):
            return tuple(_truncate_log_strings(v, maxlen) for v in obj)
        return obj

    print("=" * 72, flush=True)
    _cands = data.get("candidates") or []
    _n_cand = len(_cands)
    _sample = random.sample(_cands, min(5, _n_cand)) if _cands else []
    print(
        f"[_run_recommend_core] 省={province} rank={rank} 选科={subject or '(空)'} "
        f"candidates={_n_cand} 条 — 随机抽样 {len(_sample)} 条（字符串字段≤20字）",
        flush=True,
    )
    for _ci, _crow in enumerate(_sample, 1):
        _row = _truncate_log_strings(_crow, 20)
        _rest = {k: v for k, v in _row.items() if k not in ("median_rank", "median_score")}
        print(
            json.dumps(
                {
                    "_i": _ci,
                    "_n_sample": len(_sample),
                    "_n_total": _n_cand,
                    "◆ median_rank": _crow.get("median_rank"),
                    "◆ median_score": _crow.get("median_score"),
                    **_rest,
                },
                ensure_ascii=False,
                default=str,
            ),
            flush=True,
        )
    print("=" * 72, flush=True)

    _rc("③ 位次池/选科解析", student_pool=_student_pool or "(未指定)")
    _rc(
        "④-⑮ 数据层加载完成（_build_recommend_data）",
        grouped=len(grouped),
        schools=len(school_cache),
        strong_subjects=sum(len(v) for v in subject_eval_cache.values()),
        emp_majors=len(emp_full_cache),
        school_emp=len(school_emp_cache),
        reviews=len(review_cache),
        subject_cache=len(major_subject_cache),
        prior_rank=len(_school_prior_rank),
    )

    # ⑯ 学生可报专业缓存（依赖 rank，不能内联到 _build_recommend_data）
    # P2修复：按与学生位次的接近程度排序，过滤掉完全无法企及的专业
    school_available_majors_cache: dict = {}
    if subject and _school_majors_raw:
        # 先按(school, major)去重，取最近年份（保留 min_rank 用于排序）
        _best_major: dict = {}
        for sname, entries in _school_majors_raw.items():
            for entry in entries:
                key = (sname, entry["major_name"])
                if key not in _best_major or entry["year"] > _best_major[key]["year"]:
                    _best_major[key] = entry
        # 过滤出本学生可报的专业
        _avail_with_rank: dict = defaultdict(list)
        for (sname, mname), entry in _best_major.items():
            if _subject_match(sname, mname):
                mrank = entry.get("min_rank", 0) or 0
                # P2：min_rank < rank * 0.25 意味着录取门槛是学生位次的4倍以上，几乎不可能
                if mrank > 0 and mrank < rank * 0.25:
                    continue
                _avail_with_rank[sname].append((mname, mrank))
        for sname, majors in _avail_with_rank.items():
            majors.sort(key=lambda x: abs(x[1] - rank) if x[1] > 0 else float("inf"))
            school_available_majors_cache[sname] = [m[0] for m in majors[:10]]
    _rc(
        "⑰ 学生可报专业缓存 school_available_majors_cache",
        schools=len(school_available_majors_cache),
        user_subjects=sorted(user_subjects),
    )

    # 4e. recent_data 构建函数：专业级数据 + 学校级补充
    def _build_recent_data(records: list, school_name: str,
                           baseline_cache: dict) -> list:
        """
        返回最多6年的历史数据，按年份降序。
        策略：
        1. 先取专业级数据的全部年份
        2. 如果最新年份 < 2024（说明该专业缺少近年数据），
           从学校级「院校最低分」补充缺失的近年，标记 is_school_baseline=True
        3. 去重（同年只保留专业级数据，优先级更高）
        4. 取最新6年
        """
        major_data = sorted(records, key=lambda x: x["year"], reverse=True)
        major_years = {r["year"] for r in major_data}
        latest_major_year = max(major_years) if major_years else 0

        # 如果专业级数据已覆盖2024+，无需补充
        if latest_major_year >= 2024:
            return major_data[:6]

        # 补充学校级近年数据（仅补充专业级缺失的年份）
        baselines = baseline_cache.get(school_name, [])
        supplemented = list(major_data)
        for bl in baselines:
            if bl["year"] not in major_years and bl["year"] >= 2024:
                supplemented.append(bl)

        return sorted(supplemented, key=lambda x: x["year"], reverse=True)[:6]

    # 5. 遍历所有专业组合，计算推荐结果
    results = []
    _scan = {"skip_subject": 0, "skip_avg_rank_0": 0, "skip_rank_window": 0, "kept": 0}
    for (school_name, major_name), records in grouped.items():

        # 选科过滤（使用预加载缓存，O(1) 查询）
        if subject and not _subject_match(school_name, major_name):
            _scan["skip_subject"] += 1
            continue

        school_info = school_cache.get(school_name)

        # 预测录取概率（小样本专业使用学校先验做贝叶斯平滑）
        prediction = predict_admission(rank, records, province=province,
                                       school_prior_rank=_school_prior_rank.get(school_name, 0))

        # 去年（基础集中年份最新、且有录取位次的一条）最低分；与 predict_admission 相同的基础记录集
        _base_recs = sorted(
            [r for r in records if (r.get("min_rank") or 0) > 0],
            key=lambda r: r["year"], reverse=True
        )[:5]
        _latest_ms = (_base_recs[0].get("min_score") or 0) if _base_recs else 0
        _avg_score = round(float(_latest_ms)) if _latest_ms > 0 else 0

        # 从真实学科评估表获取该校A类学科（用于Type A冷门检测）
        strong_subjects = subject_eval_cache.get(school_name, [])

        school_dict = {
            "name": school_name,  # 供 Type G 委培检测使用
            "city": school_info.city if school_info else "",
            "province": school_info.province if school_info else "",
            "rank_2025": school_info.rank_2025 if school_info else 0,
            "tier": school_info.tier if school_info else "普通",
        }

        # 该专业就业数据（用于冷门评分 Type E 和质量评分）
        emp_list = emp_cache.get(major_name, [])

        # 综合冷门评分（7类：A城市折价/B认知折价/C时机/D学科强/E满意度/F产业信号/G委培）
        gem_result = score_overall_gem(school_dict, strong_subjects, records, emp_list,
                                       actual_major_name=major_name, student_province=province)

        # 学校级就业数据（用于双维度质量评分）
        school_emp = school_emp_cache.get(school_name)

        # 综合质量评分（7维度，有学校级数据时精度更高）
        quality_raw = school_quality_score(school_dict, strong_subjects, emp_list, school_emp)

        # 【阶段3】口碑soft修正：sentiment_delta ±10% 调整 quality_score
        review_data = review_cache.get(school_name)
        quality = quality_raw
        if review_data:
            delta = review_data.get("sentiment_delta", 0.0) or 0.0
            review_cnt = review_data.get("review_count", 0) or 0
            # 仅当样本量≥5条时才应用修正，防噪
            if review_cnt >= 5 and abs(delta) >= 0.05:
                # 最大修正幅度10%，按delta线性缩放
                correction = max(-10.0, min(10.0, delta * 100 * 0.8))
                quality = {**quality_raw, "quality_score": round(quality_raw["quality_score"] + correction, 1)}

        # 就业信息（完整，从预加载缓存读取，避免 N+1 查询）
        emp = emp_full_cache.get(major_name)
        # 覆盖/增强：当有学校级就业数据时，在 employment 字段中注入学校实际月薪
        _emp_reliability = school_emp.get("data_reliability", "参考") if school_emp else "参考"
        _emp_reliability_note = school_emp.get("reliability_note", "") if school_emp else ""
        if emp and school_emp and school_emp.get("avg_salary", 0) > 0:
            emp = {**emp, "avg_salary": school_emp["avg_salary"],
                   "school_employment_rate": school_emp.get("employment_rate", 0),
                   "school_postgrad_rate": school_emp.get("postgrad_rate", 0),
                   "school_employer_tier": school_emp.get("top_employer_tier", ""),
                   "data_reliability": _emp_reliability,
                   "reliability_note": _emp_reliability_note}
        elif school_emp and school_emp.get("avg_salary", 0) > 0:
            emp = {"avg_salary": school_emp["avg_salary"],
                   "school_employment_rate": school_emp.get("employment_rate", 0),
                   "school_postgrad_rate": school_emp.get("postgrad_rate", 0),
                   "school_employer_tier": school_emp.get("top_employer_tier", ""),
                   "data_reliability": _emp_reliability,
                   "reliability_note": _emp_reliability_note}

        # 学校附加信息
        is_985 = school_info.is_985 if school_info else "否"
        is_211 = school_info.is_211 if school_info else "否"
        tier = school_info.tier if school_info else "普通"

        # ── 机会分（Opportunity Score）────────────────────────────────────
        # 捕捉传统算法完全忽略的两类结构性信号：
        # 1. 大年反转：2025年录取位次较2024年大幅拉高（大年）→ 2026年大概率回落（小年机会）
        # 2. 扩招红利：本年度计划招生数明显超过历史均值 → 录取门槛下移
        # 两者均会让真实录取概率高于简单历史均值所预测的值，形成"定价偏低"的套利窗口。
        _opp_score = 0.0
        _opp_signals: list[str] = []

        _yr_data = {r["year"]: r for r in records}
        _r2025 = (_yr_data.get(2025) or {}).get("min_rank", 0)
        _r2024 = (_yr_data.get(2024) or {}).get("min_rank", 0)
        _r2023 = (_yr_data.get(2023) or {}).get("min_rank", 0)

        # Signal A：大年反转（2025年录取位次较2024年升高≥25% → 2026年预期回落）
        if _r2025 > 0 and _r2024 > 0 and _r2025 > _r2024 * 1.25:
            _jump_pct = (_r2025 - _r2024) / _r2024
            _a_score = min(25.0, _jump_pct * 60)   # 最大贡献25分
            _opp_score += _a_score
            _opp_signals.append(f"2025大年(+{_jump_pct:.0%})，预计2026回落")

        # Signal B：小年延续确认（2024和2025都比2023高 → 持续小年，更安全）
        elif _r2025 > 0 and _r2024 > 0 and _r2023 > 0:
            if _r2025 > _r2023 * 1.15 and _r2024 > _r2023 * 1.10:
                _b_score = 8.0
                _opp_score += _b_score
                _opp_signals.append("近两年持续偏难，竞争相对稳定")

        # Signal C：扩招红利（计划数超历史均值≥20%）
        _plan_nums = [r.get("plan_count", 0) or 0 for r in records if r.get("plan_count", 0)]
        if _plan_nums and prediction.get("plan_change"):
            _pc = prediction["plan_change"]
            _expand_ratio = _pc.get("change_ratio", 0)
            if _expand_ratio and _expand_ratio > 0.20:
                _c_score = min(20.0, _expand_ratio * 50)
                _opp_score += _c_score
                _opp_signals.append(f"扩招{_expand_ratio:.0%}，录取门槛下移")
            elif _expand_ratio and _expand_ratio < -0.20:
                # 缩招警告：降低机会分
                _opp_score -= min(15.0, abs(_expand_ratio) * 40)
                _opp_signals.append(f"缩招{abs(_expand_ratio):.0%}，注意风险")

        # Signal D：连续两年缩减后本年扩招（V型反转，稀有机会）
        if len(_plan_nums) >= 2:
            _recent_plans = sorted(
                [(r["year"], r.get("plan_count", 0) or 0) for r in records if r.get("plan_count", 0)],
                key=lambda x: x[0]
            )
            if len(_recent_plans) >= 3:
                _p_old = _recent_plans[-3][1]
                _p_mid = _recent_plans[-2][1]
                _p_new = _recent_plans[-1][1]
                if _p_mid < _p_old * 0.85 and _p_new > _p_mid * 1.30:
                    _opp_score += 12.0
                    _opp_signals.append("V型扩招（缩减后大幅反弹），稀有机会")

        _opp_score = round(max(-20.0, min(45.0, _opp_score)), 1)

        # 跳过无效或明显异常的位次数据
        avg_rank = prediction.get("avg_min_rank_3yr", 0)
        if avg_rank == 0:
            _scan["skip_avg_rank_0"] += 1
            continue

        # ── gap_rate 分桶预计算 ──────────────────────────────────
        # gap_rate = (avg_school_rank - student_rank) / student_rank
        #   < 0 → 学校更难（冲刺方向）；> 0 → 学校更容易（保底方向）
        # 分桶边界：
        #   冲：[-0.20, -0.10)   学校比学生难 10~20%
        #   稳：[-0.10, +0.10]   学校与学生位次相近 ±10%
        #   保：(+0.10, +0.40]   学校比学生容易 10~40%
        # 超出范围（< -0.20 或 > +0.40）直接跳过
        _gap_rate = (avg_rank - rank) / rank if rank > 0 else 0

        if _gap_rate < -0.20 or _gap_rate > 0.40:
            _scan["skip_rank_window"] += 1
            continue

        # 展示名称清理：CDN 校级占位行转为对用户友好的名称
        _display_major = major_name
        if "院校最低分" in major_name:
            _display_major = f"{school_name}·综合录取线"

        result = {
            "school_name": school_name,
            "major_name": _display_major,
            "city": school_info.city if school_info else "",
            "province_school": school_info.province if school_info else "",
            "tier": tier,
            "is_985": is_985,
            "is_211": is_211,
            "rank_2025": school_info.rank_2025 if school_info else 0,
            "flagship_majors": school_info.flagship_majors if school_info else "",
            # 该学生实际可报的专业列表（按其选科过滤，替代通用flagship展示）
            "available_majors": school_available_majors_cache.get(school_name, []),
            "city_level": school_info.city_level if school_info else "",
            "tags": school_info.tags.split(",") if school_info and school_info.tags else [],
            "probability": prediction["probability"],
            "prob_low": prediction.get("prob_low"),
            "prob_high": prediction.get("prob_high"),
            "suggested_action": prediction["suggested_action"],
            "avg_min_rank_3yr": prediction.get("avg_min_rank_3yr", 0),
            "avg_min_score_3yr": _avg_score,
            "rank_diff": prediction.get("rank_diff", 0),
            "confidence": prediction["confidence"],
            "big_small_year": prediction.get("big_small_year", {}),
            "is_hidden_gem": gem_result["is_hidden_gem"],
            "gem_score": gem_result.get("gem_score", 0),
            "top_gem": gem_result.get("top_gem"),
            "all_gems": gem_result.get("all_gems", []),
            "quality_score": quality["quality_score"],
            "value_index": value_index(quality["quality_score"], prediction.get("avg_min_rank_3yr", 0),
                                       _get_province_total(province)),
            "employment": emp,
            "strong_subjects": [s["major_name"] for s in strong_subjects[:3]],
            # recent_data：优先用专业级数据，近年缺失时补充学校级院校最低分
            # 解决2024-2025专业名格式变更导致的"只显示2021-2022数据"问题
            "recent_data": _build_recent_data(records, school_name, _school_baseline_cache),
            "review_data": review_data,
            "rank_cv": prediction.get("rank_cv", 0),
            "volatility_warning": (
                "⚠️ 该校专业近年位次波动较大，冲稳保分类可能偏差，建议留足梯度"
                if prediction.get("rank_cv", 0) > 0.20 else
                ""
            ),
            "opportunity_score": _opp_score,
            "opportunity_signals": _opp_signals,
            "gap_rate": round(_gap_rate, 4),   # (avg_school_rank - student_rank) / student_rank
            "surge_label": (
                "大冲" if _gap_rate < -0.15      # 学校难15~20%
                else "小冲" if _gap_rate < -0.10  # 学校难10~15%
                else ""
            ),
            "reason": "",  # filled after result dict is built
        }
        result["reason"] = _build_reason(result, rank)

        # ── feature_tags：快扫标签，让每张卡片一眼可区分 ─────────────
        # 最多4个标签，按信息密度降序：城市等级 > 学科强项 > 就业数据 > 趋势信号
        _ftags = []
        # 城市等级标签
        _cl = result.get("city_level", "")
        if _cl in ("一线城市", "一线"):
            _ftags.append("一线城市")
        elif _cl in ("新一线", "新一线城市"):
            _ftags.append("新一线")
        # 学科强项标签（A级以上学科）
        _ssubj = result.get("strong_subjects", [])
        if _ssubj:
            _ftags.append(f"强势学科：{_ssubj[0]}")
        # 就业薪资标签
        _emp = result.get("employment") or {}
        _salary = _emp.get("avg_monthly_salary", 0) or 0
        if _salary >= 10000:
            _ftags.append(f"应届≈¥{_salary:,}/月")
        elif _salary >= 7000:
            _ftags.append(f"应届≈¥{_salary:,}/月")
        # 就业率标签
        _emp_rate = _emp.get("employment_rate", 0) or 0
        if _emp_rate >= 95:
            _ftags.append(f"就业率{_emp_rate}%")
        # 趋势信号标签（大小年 / 机会窗口）
        _bsy = result.get("big_small_year") or {}
        _bsy_label = _bsy.get("label", "")
        if "小年" in _bsy_label:
            _ftags.append("今年可能小年↓")
        # 控制最多4个
        result["feature_tags"] = _ftags[:4]

        results.append(result)
        _scan["kept"] += 1

    _rc(
        "⑯ 逐专业评分结束",
        grouped=len(grouped),
        results=len(results),
        skip_subject=_scan["skip_subject"],
        skip_avg_rank_0=_scan["skip_avg_rank_0"],
        skip_rank_window=_scan["skip_rank_window"],
        gap_rate_surge=f"[{-0.20}, {-0.10})",
        gap_rate_stable=f"[{-0.10}, {+0.10}]",
        gap_rate_safe=f"({+0.10}, {+0.40}]",
        rank_surge_lo=int(rank * 0.80),
        rank_stable_hi=int(rank * 1.10),
        rank_safe_hi=int(rank * 1.40),
    )

    # 6. 按桶定义独立排序函数（各桶权重不同，体现不同决策逻辑）
    def _opp_n(x): return (x.get("opportunity_score", 0) + 20) / 65  # [-20,45]→[0,1]

    def _surge_sort(x):
        # 冲区：学生在冒险 → 冷门价值优先（同样是冲，选更值钱的险）
        return (-(x["gem_score"] * 0.40 + x["quality_score"] * 0.35 + _opp_n(x) * 100 * 0.25),
                x.get("school_name", ""), x.get("major_name", ""))

    def _stable_sort(x):
        # 稳区：核心推荐区 → 质量优先
        return (-(x["quality_score"] * 0.50 + x["gem_score"] * 0.30 + _opp_n(x) * 100 * 0.20),
                x.get("school_name", ""), x.get("major_name", ""))

    def _safe_sort(x):
        # 保区：安全网 → 质量压倒性（保底就保最好的）
        return (-(x["quality_score"] * 0.60 + x["gem_score"] * 0.25 + _opp_n(x) * 100 * 0.15),
                x.get("school_name", ""), x.get("major_name", ""))

    _rc("⑰ 三桶独立排序函数就绪（冲:gem0.4/质0.35 稳:质0.5/gem0.3 保:质0.6/gem0.25）")

    # 7. 冲/稳/保硬排名分桶（gap_rate = (avg_school_rank - student_rank) / student_rank）
    # ─────────────────────────────────────────────────────────────────────────────────
    # 冲：[-0.20, -0.10)  学校比学生难10~20%，有希望但需要努力
    # 稳：[-0.10, +0.10]  学校与学生位次相近±10%，录取把握大
    # 保：(+0.10, +0.40]  学校明显容易，学生位次高于录取线10%以上
    surge  = [r for r in results if -0.20 <= r["gap_rate"] < -0.10]
    stable = [r for r in results if -0.10 <= r["gap_rate"] <= 0.10]
    safe   = [r for r in results if  0.10 <  r["gap_rate"] <= 0.40]

    # 每所学校各桶独立计数（原来跨桶共享导致某桶学校不足）
    _SCHOOL_CAP = 5

    def _capped_pick(pool: list, n: int, cnt: dict) -> list:
        out = []
        for r in pool:
            if len(out) >= n:
                break
            sn = r.get("school_name", "")
            if cnt[sn] < _SCHOOL_CAP:
                out.append(r)
                cnt[sn] += 1
        return out

    surge_list  = _capped_pick(sorted(surge,  key=_surge_sort),  25, defaultdict(int))
    stable_list = _capped_pick(sorted(stable, key=_stable_sort), 46, defaultdict(int))
    safe_list   = _capped_pick(sorted(safe,   key=_safe_sort),   25, defaultdict(int))
    combined_96 = surge_list + stable_list + safe_list
    _rc(
        "⑱ 冲/稳/保初分桶（gap_rate硬边界）与校名额 cap",
        surge_pool=len(surge),
        stable_pool=len(stable),
        safe_pool=len(safe),
        surge_pick=len(surge_list),
        stable_pick=len(stable_list),
        safe_pick=len(safe_list),
        school_cap=_SCHOOL_CAP,
    )

    # 冷门宝藏：从冲+稳区（gap_rate ≤ 0.10）提取，保区宝藏价值低不展示
    gems_list = sorted(
        [r for r in combined_96 if r["is_hidden_gem"] and r["gap_rate"] <= 0.10],
        key=lambda x: -(x["gem_score"] * 0.55 + x["quality_score"] * 0.30 + _opp_n(x) * 100 * 0.15)
    )
    _rc("⑲ 冷门 gems_list（惩罚前）", n=len(gems_list))

    display_list = combined_96  # 竞争密度惩罚只需对96所运算，无重复

    # 7a. 竞争密度惩罚（PLOS ONE 2022 竞争感知模型）
    # 仅对展示结果运算（~42条），避免全量 O(n²) 扫描
    _comp_pen = 0
    for r in display_list:
        avg_rank = r["avg_min_rank_3yr"]
        if avg_rank <= 0:
            continue
        band_lo, band_hi = avg_rank * 0.8, avg_rank * 1.2
        competitors = sum(
            1 for other in display_list
            if other is not r and band_lo <= other["avg_min_rank_3yr"] <= band_hi
        )
        r["competition_count"] = competitors
        if competitors > 0:
            penalty = min(0.12, competitors * 0.004)
            r["probability"] = round(max(0, r["probability"] * (1 - penalty)), 1)
            if r["prob_low"] is not None:
                r["prob_low"] = round(max(0, r["prob_low"] * (1 - penalty)), 1)
            if r["prob_high"] is not None:
                r["prob_high"] = round(max(0, r["prob_high"] * (1 - penalty)), 1)
            _comp_pen += 1
    _rc("⑳ 竞争密度惩罚", display_n=len(display_list), rows_with_penalty=_comp_pen)

    # 7b. 热门学校流量惩罚（相关性忽视纠正，Jiang SJTU 2021）
    _heat_pen = 0
    _click_event_rows = 0
    try:
        week_ago = datetime.datetime.utcnow() - datetime.timedelta(days=7)
        click_events = db.query(UserEvent).filter(
            UserEvent.event_type == "school_click",
            UserEvent.created_at >= week_ago
        ).all()
        _click_event_rows = len(click_events)
        click_counts: dict = defaultdict(int)
        for ev in click_events:
            try:
                edata = json.loads(ev.event_data or "{}")
                sname = edata.get("school_name", "")
                if sname:
                    click_counts[sname] += 1
            except Exception:
                pass
        if click_counts:
            avg_clicks = sum(click_counts.values()) / len(click_counts)
            for r in display_list:
                heat = click_counts.get(r["school_name"], 0)
                if avg_clicks > 0 and heat > avg_clicks * 2:
                    heat_ratio = min(heat / avg_clicks, 5.0)
                    penalty_pct = min(0.10, (heat_ratio - 2.0) / 3.0 * 0.10)
                    r["probability"] = round(max(0, r["probability"] * (1 - penalty_pct)), 1)
                    if r["prob_low"] is not None:
                        r["prob_low"] = round(max(0, r["prob_low"] * (1 - penalty_pct)), 1)
                    if r["prob_high"] is not None:
                        r["prob_high"] = round(max(0, r["prob_high"] * (1 - penalty_pct)), 1)
                    _heat_pen += 1
    except Exception:
        pass
    _rc(
        "㉑ 近7日点击热度惩罚",
        school_click_events=_click_event_rows,
        rows_with_heat_penalty=_heat_pen,
    )

    # 7c. 惩罚后后处理
    for r in display_list:
        p = r.get("probability")
        pl = r.get("prob_low")
        ph = r.get("prob_high")
        if p is None:
            continue
        # 置信区间完整性：所有惩罚完成后确保 prob_low ≤ probability ≤ prob_high
        if pl is not None and pl > p:
            r["prob_low"] = p
        if ph is not None and ph < p:
            r["prob_high"] = p

    # 7d. 惩罚后重新分桶（gap_rate 不因惩罚变化，按各桶 sort_key 重排）
    surge_list  = _capped_pick(
        sorted([r for r in display_list if -0.20 <= r["gap_rate"] < -0.10], key=_surge_sort),
        25, defaultdict(int))
    stable_list = _capped_pick(
        sorted([r for r in display_list if -0.10 <= r["gap_rate"] <= 0.10],  key=_stable_sort),
        46, defaultdict(int))
    safe_list   = _capped_pick(
        sorted([r for r in display_list if  0.10 <  r["gap_rate"] <= 0.40],  key=_safe_sort),
        25, defaultdict(int))
    combined_96 = surge_list + stable_list + safe_list
    _rc(
        "㉒ 惩罚后重分桶+截断",
        surge=len(surge_list),
        stable=len(stable_list),
        safe=len(safe_list),
        combined=len(combined_96),
    )

    # P8修复（终稿）：惩罚后重新分桶后再次检查数量不足
    # 场景A：所有结果概率<10%，三桶均空 → 取最高30条填入safe，标"参考"
    # 场景B：combined_96不足30条 → 用概率最高的未入桶结果补齐至30条
    _p8_note = "无需"
    if not combined_96 and results:
        # 三桶皆空：取 gap_rate 最接近稳区中心（0）的30条，标"参考"
        _fallback = sorted(results, key=lambda x: abs(x["gap_rate"]))[:30]
        for _fb in _fallback:
            _fb["suggested_action"] = "参考"
        safe_list   = _fallback
        combined_96 = _fallback
        _p8_note = "三桶皆空→取gap_rate最近30条标「参考」"
    elif len(combined_96) < 30 and results:
        _in_96 = {(r["school_name"], r["major_name"]) for r in combined_96}
        _extras = [r for r in results if (r["school_name"], r["major_name"]) not in _in_96]
        _extras_sorted = sorted(_extras, key=lambda x: abs(x["gap_rate"]))
        _need = 30 - len(combined_96)
        for _ex in _extras_sorted[:_need]:
            _ex["suggested_action"] = "参考"
            safe_list.append(_ex)
            combined_96.append(_ex)
        _p8_note = f"不足30条→补齐{_need}条标「参考」"
    _rc("㉓ P8 数量兜底", action=_p8_note, combined=len(combined_96))

    gems_list = sorted(
        [r for r in combined_96 if r["is_hidden_gem"] and r["gap_rate"] <= 0.10],
        key=lambda x: (-(x["gem_score"]*0.55 + x["quality_score"]*0.30 + _opp_n(x)*100*0.15),
                       x.get("school_name",""), x.get("major_name",""))
    )
    _rc("㉔ 冷门 gems_list（惩罚+P8 后）", n=len(gems_list))

    # ── 智能精选：标记每档第一名为"本档首选" ─────────────────────────────
    # 从该校最强信号生成1行非模板化理由，让家长一眼看出重点
    def _make_top_pick_headline(r: dict) -> str:
        opp = r.get("opportunity_signals") or []
        if opp:
            return opp[0]
        prob    = r.get("probability", 0) or 0
        quality = r.get("quality_score", 0) or 0
        is_985  = r.get("is_985", "否") == "是"
        is_211  = r.get("is_211", "否") == "是"
        city_lv = r.get("city_level", "") or ""
        flagship = ((r.get("flagship_majors") or "").split("/")[0]
                    .split("、")[0].strip()[:12])
        if is_985 and quality > 65:
            return f"985院校·综合评分 {quality:.0f}/100，本档最优"
        if is_211 and quality > 55:
            city_str = f"·{city_lv}" if city_lv else ""
            return f"211院校{city_str}·综合评分 {quality:.0f}/100"
        if flagship:
            return f"王牌专业：{flagship}·综合评分本档最高"
        if prob > 0:
            return f"录取概率 {prob:.0f}%·综合评分本档最高"
        return "综合评分本档最高"

    # 每档标记前3名为"智能精选"，第1名额外标"本档首选"
    # 家长看到96所学校时，精选标签帮助快速定位最值得关注的9所
    for _top_list in [surge_list, stable_list, safe_list]:
        for _i, _item in enumerate(_top_list[:3]):
            _item["is_top_pick"]      = True
            _item["top_pick_headline"] = _make_top_pick_headline(_item)
            _item["top_pick_rank"]    = _i + 1  # 1=本档首选, 2-3=精选
    _rc("㉕ 智能精选", marked="冲/稳/保各前3条 is_top_pick")

    # ── 付费墙：由调用方传入 is_paid ────────────────────────────
    # 免费层：冲前2条、稳前2条、保前1条、冷门0条（共最多5所）
    FREE_LIMITS = {"surge": 2, "stable": 2, "safe": 1, "hidden_gems": 0}

    def _apply_paywall(lst: list, category: str) -> list:
        """For paid users: full data. For unpaid: first N items full, rest as locked placeholders."""
        if is_paid:
            return [{**r, "locked": False} for r in lst]
        free_n = FREE_LIMITS.get(category, 0)
        out = []
        for i, r in enumerate(lst):
            if i < free_n:
                out.append({**r, "locked": False})
            else:
                out.append(_paywall_strip(r))
        return out

    _result = {
        "candidate_rank": rank,
        "province": province,
        "total_matched": len(combined_96),
        "total_raw": len(results),
        "is_paid": is_paid,
        "surge":       _apply_paywall(surge_list,  "surge"),
        "stable":      _apply_paywall(stable_list, "stable"),
        "safe":        _apply_paywall(safe_list,   "safe"),
        "hidden_gems": _apply_paywall(gems_list,   "hidden_gems"),
    }
    _rc(
        "㉖ 写缓存前最终条数",
        total_raw=_result["total_raw"],
        total_matched=_result["total_matched"],
        surge=len(_result["surge"]),
        stable=len(_result["stable"]),
        safe=len(_result["safe"]),
        hidden_gems=len(_result["hidden_gems"]),
        is_paid=is_paid,
    )
    _rec_cache_set(province, rank, subject, is_paid, _result)
    _rc("㉗ 完成（已写入进程内缓存）")
    return _result
