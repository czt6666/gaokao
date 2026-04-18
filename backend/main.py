"""
高考志愿填报决策引擎 - FastAPI 后端（真实数据版）
"""
from fastapi import FastAPI, Depends, Query, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from collections import defaultdict
import sys, os, json, datetime, logging, re, time

# 加载 .env 文件（优先于系统环境变量）
_env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())

logger = logging.getLogger("gaokao")

sys.path.insert(0, os.path.dirname(__file__))

from database import (
    get_db, init_db, School, Major, AdmissionRecord,
    SubjectEvaluation, MajorEmployment, RankTable,
    NationalProgram, ProvinceControlLine, User, UserEvent,
    SchoolEmployment, SchoolReview, Order,
)
from algorithms.rank_method import predict_admission, build_gradient_plan, detect_big_small_year
from algorithms.hidden_gem import (
    score_overall_gem, hidden_gem_type_b, school_quality_score, value_index, COGNITIVE_DISCOUNT_MAJORS
)
from algorithms.population_data import get_province_total as _pop_province_total
from routers import auth as auth_router, payment as payment_router, track as track_router
from routers import report as report_router, admin as admin_router
from routers import tracking as tracking_router
from routers.auth import _verify_token as _auth_verify_token

app = FastAPI(title="高考志愿填报决策引擎", version="3.0.0")
app.include_router(auth_router.router)
app.include_router(payment_router.router)
app.include_router(track_router.router)
app.include_router(report_router.router)
app.include_router(admin_router.router)
app.include_router(tracking_router.router)

_SITE_URL = os.getenv("SITE_URL", "https://www.theyuanxi.cn")
_ALLOWED_ORIGINS = [
    "https://theyuanxi.cn",
    "https://www.theyuanxi.cn",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
# 从环境变量动态追加（支持域名切换无需改代码）
if _SITE_URL and _SITE_URL not in _ALLOWED_ORIGINS:
    _ALLOWED_ORIGINS.append(_SITE_URL)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Admin-Token"],
    allow_credentials=False,
)


# ── 安全响应头 ───────────────────────────────────────────────
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

app.add_middleware(SecurityHeadersMiddleware)


def _get_province_total(province: str, year: int = 2025) -> int:
    """获取省份总考生数（缓存，用于value_index计算）"""
    try:
        return _pop_province_total(province, year)
    except Exception:
        return 500000  # fallback


@app.on_event("startup")
def on_startup():
    init_db()
    _start_scheduler()
    # 启动后异步预热高频省份缓存，避免首个用户承受冷启动延迟
    import threading
    threading.Thread(target=_prewarm_cache, daemon=True).start()


def _prewarm_cache():
    """预热高频省份的常用位次段缓存（后台线程，启动后5秒开始）"""
    import time as _time
    _time.sleep(5)  # 等服务完全启动
    try:
        from database import SessionLocal as _SL
        _db = _SL()
        # 高频省份 × 典型位次 × 选科
        _WARM_TARGETS = [
            ("广东", [5000, 30000, 60000, 100000], "物理"),
            ("广东", [5000, 30000], "历史"),
            ("河南", [30000, 60000, 100000], "物理"),
            ("山东", [20000, 60000], "物理"),
            ("浙江", [20000, 60000], "综合"),
            ("北京", [5000, 20000, 50000], "物理"),
            ("湖北", [20000, 50000], "物理"),
            ("湖南", [20000, 50000], "物理"),
            ("四川", [20000, 60000], "物理"),
            ("江苏", [20000, 60000], "物理"),
        ]
        warmed = 0
        for province, ranks, subject in _WARM_TARGETS:
            for rank in ranks:
                try:
                    if _rec_cache_get(province, rank, subject, True) is None:
                        result = _run_recommend_core(
                            province=province, rank=rank,
                            subject=subject, mode="all",
                            db=_db, is_paid=True
                        )
                        if result:
                            warmed += 1
                    _time.sleep(0.5)  # 避免启动时过载
                except Exception:
                    pass
        _db.close()
        logger.info(f"[Prewarm] 缓存预热完成，共预热 {warmed} 个查询组合")
    except Exception as e:
        logger.warning(f"[Prewarm] 预热失败（不影响服务）: {e}")


def _start_scheduler():
    """启动 APScheduler：每周日凌晨3点自动爬取学生口碑数据"""
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger

        scheduler = BackgroundScheduler(timezone="Asia/Shanghai")

        def _run_review_scraper():
            logger.info("[Scheduler] 开始每周口碑数据更新...")
            try:
                from scrapers.student_review_scraper import run as scraper_run
                scraper_run(limit=200, delay=3.0)
                logger.info("[Scheduler] 口碑数据更新完成")
            except Exception as e:
                logger.error(f"[Scheduler] 口碑爬虫失败: {e}", exc_info=True)

        # 每周日 03:00 (Asia/Shanghai)
        scheduler.add_job(
            _run_review_scraper,
            CronTrigger(day_of_week="sun", hour=3, minute=0),
            id="weekly_review_scrape",
            replace_existing=True,
        )
        scheduler.start()
        logger.info("[Scheduler] APScheduler 已启动（每周日03:00更新口碑数据）")
    except ImportError:
        logger.warning("[Scheduler] apscheduler 未安装，跳过定时任务（pip install apscheduler）")
    except Exception as e:
        logger.error(f"[Scheduler] 启动失败: {e}", exc_info=True)


# ── 工具函数：获取学校最强学科评估 ───────────────────────────────
def get_school_top_subjects(school_name: str, db: Session) -> List[dict]:
    """从 subject_evaluations 表查询该校的学科评估，返回A类学科列表"""
    grade_order = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-"]

    evals = db.query(SubjectEvaluation).filter(
        SubjectEvaluation.school_name == school_name
    ).all()

    result = []
    for ev in evals:
        grade = ev.grade.strip() if ev.grade else ""
        result.append({
            "subject_name": ev.subject_name,
            "grade": grade,
            "grade_rank": grade_order.index(grade) if grade in grade_order else 99
        })
    # 只返回 A 类（A+ A A-）
    a_class = [r for r in result if r["grade_rank"] <= 2]
    return sorted(a_class, key=lambda x: x["grade_rank"])


def get_major_employment(major_name: str, db: Session) -> Optional[dict]:
    """从 major_employment 表查询专业就业信息"""
    emp = db.query(MajorEmployment).filter(
        MajorEmployment.major_name == major_name
    ).first()
    if not emp:
        return None
    return {
        "avg_salary": emp.avg_salary,
        "top_city": emp.top_city,
        "top_industry": emp.top_industry,
        "common_jobs": emp.common_jobs,
        "employment_rank": emp.employment_rank,
        "satisfaction": emp.satisfaction,
        "career_direction": emp.career_direction,
        "salary_trend": emp.salary_trend,
        "gender_male": emp.gender_male,
        "gender_female": emp.gender_female,
        "intro": emp.intro[:200] if emp.intro else "",
    }


# ── 付费墙工具函数 ────────────────────────────────────────────
def _get_paid_status(request: Request, db: Session) -> bool:
    """Check if the request carries a valid JWT from a paid user."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False
    payload = _auth_verify_token(auth[7:])
    if not payload:
        return False
    user = db.query(User).filter(User.id == payload["uid"]).first()
    return bool(user and user.is_paid)


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


# ── 核心接口：智能推荐 ────────────────────────────────────────
def _run_recommend_core(province: str, rank: int, subject: str, mode: str, db: Session, is_paid: bool = False) -> dict:
    """
    核心推荐逻辑（纯函数，不依赖 Request）。
    供 /api/recommend 端点和 PDF 报告生成共同调用。
    主推荐接口：输入位次，返回冲稳保分层推荐 + 冷门挖掘（接入真实学科评估）
    """
    # 缓存命中快速返回
    _cached = _rec_cache_get(province, rank, subject, is_paid)
    if _cached is not None:
        return _cached

    # 2. 按 (学校, 专业) 分组 — 新高考选科分池过滤，避免物理/历史位次池污染
    # 新高考省份（北京/广东/江苏等）物理类和历史类的位次来自完全不同的排名池，不可混用。
    # 若混入，同一专业的 avg_min_rank_3yr 会是两个池位次的无意义平均值，导致概率算错。
    _POOL_PHYSICS = {"物理类", "物理", "理科"}
    _POOL_HISTORY = {"历史类", "历史", "文科"}
    # 根据用户选科确定所属位次池（在查询前确定，以便SQL级别过滤）
    _student_pool = ""  # "" = 未指定，不过滤（旧高考未传选科时）
    if subject:
        for _s in subject.split("+"):
            _s = _s.strip()
            _s_norm = {"理科": "物理", "物理类": "物理", "文科": "历史", "历史类": "历史"}.get(_s, _s)
            if _s_norm == "物理":
                _student_pool = "物理"; break
            elif _s_norm == "历史":
                _student_pool = "历史"; break

    # 1. 获取省份录取记录（原生SQL+轻量tuple，比ORM对象快5-10x；SQL级过滤减少传输量）
    from sqlalchemy import text as _sqla_text
    _sql_extra = ""
    # SQL级别选科过滤（P0：跳过对立位次池，最大降低数据量）
    if _student_pool == "物理":
        _sql_extra += " AND COALESCE(subject_req,'') NOT IN ('历史类','历史','文科')"
    elif _student_pool == "历史":
        _sql_extra += " AND COALESCE(subject_req,'') NOT IN ('物理类','物理','理科')"
    # SQL级别批次过滤（P5：排除非普通本科批，进一步减少数据量）
    for _bkw in ("提前批", "艺术", "专科", "高职", "专项", "预科", "蒙授", "民航飞行"):
        _sql_extra += f" AND COALESCE(batch,'') NOT LIKE '%{_bkw}%'"
    _raw_rows = db.execute(_sqla_text(
        "SELECT school_name, major_name, year, min_rank, min_score, "
        "COALESCE(admit_count,0), COALESCE(subject_req,''), COALESCE(batch,'') "
        f"FROM admission_records WHERE province=:prov AND year>=2017{_sql_extra}"
    ), {"prov": province}).fetchall()

    # ── P5：数据池纯洁性过滤（宪法准则）──────────────────────────────
    # 注：主要过滤已在SQL完成；Python层保留兜底（理论上无命中）
    _EXCLUDE_BATCH_KEYWORDS = (
        "提前批", "艺术", "专科", "高职", "专项", "预科", "蒙授", "民航飞行",
    )

    grouped = defaultdict(list)
    for _row in _raw_rows:
        _school_name, _major_name, _year, _min_rank, _min_score, _admit_count, _subject_req, _batch = _row
        # P0兜底：Python层选科过滤（SQL已过滤，此处极少命中）
        if _student_pool:
            _sr = _subject_req.strip()
            if _student_pool == "物理" and _sr in _POOL_HISTORY:
                continue
            if _student_pool == "历史" and _sr in _POOL_PHYSICS:
                continue
        # P5兜底：批次过滤
        if any(kw in _batch for kw in _EXCLUDE_BATCH_KEYWORDS):
            continue
        # P5b：校名专科过滤（批次字段不可靠时的补充防线）
        # 规则：校名含专科关键词 且 校名中无"大学"字样 → 排除
        _EXCLUDE_SCHOOL_NAME_KW = ("高等专科学校", "职业技术学院", "高职学院", "职业学院", "专科学校")
        if any(kw in _school_name for kw in _EXCLUDE_SCHOOL_NAME_KW) and "大学" not in _school_name:
            continue
        grouped[(_school_name, _major_name)].append({
            "year": _year,
            "min_rank": _min_rank,
            "min_score": _min_score,
            "plan_count": _admit_count,
        })

    # P6修复：历史池 — 全国范围内只招物理生的专业应从历史推荐中剔除
    # 问题：subject_req 有多种物理标记（物理类/物理必选/物理、化学/理科），
    #       且不同省份 major_name 有括号差异，须用 LIKE 匹配 + 归一化名称比对。
    if _student_pool == "历史" and grouped:
        import re as _re
        from sqlalchemy import or_ as _or_
        _grouped_schools = list({k[0] for k in grouped.keys()})
        # LIKE 匹配：涵盖"物理类/物理必选/物理、化学(2科必选)"等所有物理标记
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
        # P6修复：使用精确专业名匹配，避免括号归一化导致误伤同名不同方向专业
        # （例："统计学（数学方向）"和"统计学（经济方向）"不可混同）
        _has_p_exact = {(r.school_name, r.major_name) for r in _phy_rows}
        _has_h_exact = {(r.school_name, r.major_name) for r in _hist_rows}
        _physics_only_exact = _has_p_exact - _has_h_exact
        for _k in list(grouped.keys()):
            if _k in _physics_only_exact:
                grouped.pop(_k, None)

    # 3. 预加载学校信息（避免 N+1 查询）
    school_cache = {}
    for s in db.query(School).all():
        school_cache[s.name] = s

    # 3b. 预加载学校级「院校最低分」历史（用于补充专业级 recent_data 缺失的近年数据）
    # 根因：2024-2025年数据的专业名格式变为"[XXX组]专业名（详情）"，与2021-2023的大类名不匹配
    # 导致按(school_name, major_name)分组时，许多专业只有旧年份数据
    # 补救：用同校的[本科批]院校最低分做近年参照，让家长至少能看到该校最新录取趋势
    _school_baseline_cache: dict = defaultdict(list)  # school_name -> [{year, min_rank, min_score}]
    _baseline_rows = db.execute(_sqla_text(
        "SELECT school_name, year, MAX(min_rank) as min_rank, MIN(min_score) as min_score "
        "FROM admission_records "
        "WHERE province=:prov AND major_name LIKE '%院校最低分%' AND min_rank > 0 "
        "GROUP BY school_name, year "
        "ORDER BY school_name, year DESC"
    ), {"prov": province}).fetchall()
    for _br in _baseline_rows:
        _school_baseline_cache[_br[0]].append({
            "year": _br[1], "min_rank": _br[2], "min_score": _br[3],
            "plan_count": 0, "is_school_baseline": True,
        })

    # 4. 预加载学科评估（按学校名汇总A类学科）
    subject_eval_cache = defaultdict(list)
    for ev in db.query(SubjectEvaluation).filter(
        SubjectEvaluation.grade.in_(["A+", "A", "A-"])
    ).all():
        subject_eval_cache[ev.school_name].append({
            "major_name": ev.subject_name,
            "subject_strength": ev.grade,
            "subject_req": ""
        })

    # 4b. 预加载专业就业（用于Type E口碑折价 + 质量评分 + 结果展示）
    emp_cache = defaultdict(list)       # 用于 gem 评分（轻量）
    emp_full_cache: dict = {}           # 用于结果展示（完整字段，替代 N+1 查询）
    for emp in db.query(MajorEmployment).all():
        emp_cache[emp.major_name].append({
            "major_name": emp.major_name,
            "avg_salary": emp.avg_salary or 0,
            "satisfaction": emp.satisfaction or 0.0,
        })
        if emp.major_name not in emp_full_cache:
            emp_full_cache[emp.major_name] = {
                "avg_salary": emp.avg_salary,
                "top_city": emp.top_city,
                "top_industry": emp.top_industry,
                "common_jobs": emp.common_jobs,
                "employment_rank": emp.employment_rank,
                "satisfaction": emp.satisfaction,
                "career_direction": emp.career_direction,
                "salary_trend": emp.salary_trend,
                "gender_male": emp.gender_male,
                "gender_female": emp.gender_female,
                "intro": emp.intro[:200] if emp.intro else "",
            }

    # 4b-2. 预加载学校级就业数据（school_employment 表）
    # 多源交叉验证：同校有官方+估算两条记录时，取中位数并标记可靠度
    def _sanitize_source(raw: str) -> str:
        """清洗数据来源标签，去除第三方品牌名/技术实现细节，避免法律风险"""
        if not raw:
            return ""
        if "官方" in raw:
            return raw  # 官方报告保留原标签
        if "估算" in raw:
            return "综合估算"
        # 所有第三方来源统一为通用标签
        return "公开数据整理"

    _se_raw: dict = defaultdict(list)
    for se in db.query(SchoolEmployment).order_by(SchoolEmployment.year.desc()).all():
        _se_raw[se.school_name].append({
            "avg_salary": se.avg_salary or 0,
            "employment_rate": se.employment_rate or 0.0,
            "postgrad_rate": se.postgrad_rate or 0.0,
            "overseas_rate": se.overseas_rate or 0.0,
            "top_employer_tier": se.top_employer_tier or "",
            "top_employers": se.top_employers or "[]",
            "year": se.year,
            "data_source": _sanitize_source(se.data_source or ""),
        })
    school_emp_cache: dict = {}
    for _sname, _entries in _se_raw.items():
        official = [e for e in _entries if "官方" in (e["data_source"] or "")]
        estimated = [e for e in _entries if "估算" in (e["data_source"] or "")]
        if official and estimated:
            # 多源交叉验证：比较官方 vs 估算薪资
            off_sal = official[0]["avg_salary"]
            est_sal = estimated[0]["avg_salary"]
            if off_sal > 0 and est_sal > 0:
                divergence = abs(off_sal - est_sal) / max(off_sal, est_sal)
                if divergence > 0.30:
                    # 偏差>30%：标记存疑，使用官方数据
                    merged = {**official[0], "data_reliability": "数据存疑",
                              "reliability_note": f"官方{off_sal}元 vs 估算{est_sal}元，偏差{divergence:.0%}"}
                else:
                    # 偏差合理：取中位数，标记已验证
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

    # 4c-review. 预加载学生口碑数据（school_reviews 表）
    review_cache: dict[str, dict] = {}
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
                "source":           "公开社区内容",  # 脱敏：不暴露搜狗/百度等第三方品牌名
            }
    except Exception:
        pass  # 表不存在时静默忽略（旧DB兼容）

    # 4d. 预加载选科要求 — 改进版：正确处理同时招收物理/历史两类的跨批次专业
    # 旧逻辑"先写优先"的 bug：若专业同时有物理类和历史类记录，只存第一条，
    # 导致另一类学生被随机误拦截（非确定性错误，每次重启可能不同）。
    # 新逻辑：若某专业同时出现在物理类和历史类批次 → 视为"不限"，两类均可报。
    major_subject_cache: dict[tuple, str] = {}
    if subject:
        # 收集每个 (school, major) 的所有批次类型
        _sr_sets: dict = defaultdict(set)
        for _row in _raw_rows:
            _sr = _row[6].strip()  # subject_req
            if _sr and _sr not in ("不限", "nan", "-", "综合"):
                _sr_sets[(_row[0], _row[1])].add(_sr)  # (school_name, major_name)
        # 根据收集的批次集合决定是否限制：双轨均有 → 不限；单轨 → 锁定
        for key, sr_set in _sr_sets.items():
            _has_phys = bool(sr_set & _POOL_PHYSICS)
            _has_hist = bool(sr_set & _POOL_HISTORY)
            if _has_phys and _has_hist:
                pass  # 两类均可报 → 不加入 cache → _subject_match 返回 True（视为"不限"）
            elif _has_phys:
                major_subject_cache[key] = "物理类"
            elif _has_hist:
                major_subject_cache[key] = "历史类"
            else:
                major_subject_cache[key] = next(iter(sr_set))  # 再选科目要求
        # 补充来源：Major 表精细数据（主要覆盖北京再选科目）
        for m in db.query(Major).filter(Major.province == province).all():
            key = (m.school_name, m.major_name)
            if key not in major_subject_cache:
                sr = (m.subject_req or "").strip()
                if sr and sr not in ("不限", "nan", "-"):
                    major_subject_cache[key] = sr

    # 4e. 预加载"该学生可报的具体专业" —— 用于替代 flagship_majors 展示
    # P0修复：SQL层已过滤对立选科池，_raw_rows只含本学生位次池记录
    _school_majors_raw: dict = defaultdict(list)
    for _row in _raw_rows:
        _mname, _yr, _mrank, _mscore, _sr = _row[1], _row[2], _row[3], _row[4], _row[6]
        if _mname and _mname != "[院校最低分]" and _mrank and _mrank > 0:
            _school_majors_raw[_row[0]].append({
                "major_name": _mname,
                "min_score": _mscore,
                "min_rank": _mrank,
                "year": _yr,
                "subject_req": _sr.strip(),
            })
    # 仅在用户指定选科时才构建过滤版
    school_available_majors_cache: dict = {}
    # (将在subject解析完成后填充，见下方)

    # 用户科目集合，并做别名规范化
    # 注意：旧高考"理科/文科"自动映射到新高考"物理/历史"首选科目
    _alias = {
        "政治": "思想政治", "思政": "思想政治", "生物学": "生物",
        "理科": "物理",   # 旧高考理科 → 首选物理
        "文科": "历史",   # 旧高考文科 → 首选历史
        "物理类": "物理", # 统一各种表达
        "历史类": "历史",
    }
    user_subjects = set()
    for s in (subject.split("+") if subject else []):
        s = s.strip()
        user_subjects.add(_alias.get(s, s))
    # 判断用户的"首选科目"（3+1+2 新高考：物理 or 历史）
    _user_has_wuli  = "物理" in user_subjects
    _user_has_lishi = "历史" in user_subjects

    def _subject_match(school_nm: str, major_nm: str) -> bool:
        """
        新高考选科匹配 v2（全格式覆盖）
        支持：首选物理/历史、物理类/历史类/理科/文科、物必选/史必选、
              再选科目 AND/OR 逻辑、及各种缩写格式
        逻辑：无要求（不限/空）= 所有人可报；
              有首选限定时，用户首选必须匹配；
              再选要求用 AND 逻辑（所有必选科目用户都要有）。
        """
        if not subject:
            return True

        req = major_subject_cache.get((school_nm, major_nm), "")
        if not req:
            # 无科目要求记录 → 允许报考（不限）
            return True

        req_norm = req.strip()
        _OPEN = {"不限", "nan", "-", "", "综合", "不限选科"}
        if req_norm in _OPEN:
            return True

        # ── 1. 首选科目逻辑（新高考 3+1+2）──────────────────────────────
        req_l = req_norm.lower()
        if ("首选物理" in req_norm or req_norm in ("物理类", "理科", "物理必选")
                or req_norm.startswith("物+") or req_norm == "物理"):
            if not _user_has_wuli:
                return False
            # 如果只要求首选物理，再选不限，则通过
            if req_norm in ("物理类", "理科", "物理必选", "物理",
                            "首选物理，再选不限", "物+不限"):
                return True
            # 继续检查再选要求（下方统一处理）
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
            # 含 "物理" 但不含 "历史" 的规则 → 需要物理
            if not _user_has_wuli:
                return False

        elif "历史" in req_norm and "物理" not in req_norm:
            # 含 "历史" 但不含 "物理" 的规则 → 需要历史
            if not _user_has_lishi:
                return False

        # ── 2. 再选科目 OR/AND 逻辑 ───────────────────────────────────────
        # 统一分隔符，拆出 OR 组（"/"）
        req_clean = req_norm.replace("（", "(").replace("）", ")").strip()
        # 去掉括号内的说明 "N科必选" / "N选1"
        req_clean = re.sub(r"\(.*?\)", "", req_clean).strip()
        # 别名
        req_clean = req_clean.replace("思想政治", "政治").replace("思政", "政治").replace("生物学", "生物")
        # OR 分组
        or_groups = req_clean.split("/")
        for grp in or_groups:
            parts = [p.strip() for p in re.split(r"[,，、+]", grp) if p.strip() and p.strip() not in _OPEN]
            parts_norm = {_alias.get(p, p) for p in parts}
            # 用户的别名版本
            user_norm = {_alias.get(s, s) for s in user_subjects}
            if not parts_norm or parts_norm.issubset(user_norm):
                return True
        return False

    # 4f. 构建"学生可报的具体专业"缓存（在 _subject_match 可用之后填充）
    # P2修复：按与学生位次的接近程度排序，过滤掉完全无法企及的专业
    if subject and _school_majors_raw:
        # 先按(school, major)去重，取最近年份（保留 min_rank 用于排序）
        _best_major: dict = {}  # (school_name, major_name) -> record
        for sname, entries in _school_majors_raw.items():
            for entry in entries:
                key = (sname, entry["major_name"])
                if key not in _best_major or entry["year"] > _best_major[key]["year"]:
                    _best_major[key] = entry
        # 过滤出本学生可报的专业，保留 (major_name, min_rank) 对用于排序
        _avail_with_rank: dict = defaultdict(list)  # school_name -> [(major_name, min_rank)]
        for (sname, mname), entry in _best_major.items():
            if _subject_match(sname, mname):
                mrank = entry.get("min_rank", 0) or 0
                # P2：过滤掉完全无法企及的专业（历史最低线远低于学生位次 → 太难）
                # min_rank < rank * 0.25 意味着该专业录取门槛是学生位次的4倍以上，几乎不可能
                if mrank > 0 and mrank < rank * 0.25:
                    continue
                _avail_with_rank[sname].append((mname, mrank))
        # 按与学生位次的接近程度排序（最相关的专业优先）
        for sname, majors in _avail_with_rank.items():
            majors.sort(key=lambda x: abs(x[1] - rank) if x[1] > 0 else float("inf"))
            school_available_majors_cache[sname] = [m[0] for m in majors[:10]]

    # 4g. 计算学校级先验位次（贝叶斯平滑用：同校所有专业最近年位次均值）
    _school_rank_sums: dict = defaultdict(lambda: [0.0, 0])  # school -> [sum, count]
    for (sname, _), recs in grouped.items():
        latest = max((r for r in recs if (r.get("min_rank") or 0) > 0), key=lambda r: r["year"], default=None)
        if latest:
            _school_rank_sums[sname][0] += latest["min_rank"]
            _school_rank_sums[sname][1] += 1
    _school_prior_rank: dict = {}
    for sname, (s, c) in _school_rank_sums.items():
        if c > 0:
            _school_prior_rank[sname] = s / c
    del _school_rank_sums

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
    for (school_name, major_name), records in grouped.items():

        # 选科过滤（使用预加载缓存，O(1) 查询）
        if subject and not _subject_match(school_name, major_name):
            continue

        school_info = school_cache.get(school_name)

        # 预测录取概率（小样本专业使用学校先验做贝叶斯平滑）
        prediction = predict_admission(rank, records,
                                       school_prior_rank=_school_prior_rank.get(school_name, 0))

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
            continue
        # P0.1修复：收窄rank窗口（原4倍过宽，导致680/690/700分结果相同）
        # 新逻辑：上界=考生位次×2.5（够看到冲志愿），下界=考生位次×0.4（够看到保底）
        # 最小缓冲3000防止顶尖分段窗口过窄
        _rank_buf = max(3000, rank * 0.3)
        if avg_rank > rank * 2.5 + _rank_buf or avg_rank < rank * 0.4 - _rank_buf:
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

    # 6. 综合排序：质量 × 概率 × 冷门价值
    # 对每类桶按 quality_score 二次排序，保证同等概率下优质学校在前
    def _sort_score(x):
        # 综合排序：概率 × 质量 × 冷门价值 × 机会分
        # opportunity_score（-20~45）归一化到 0~1 范围后参与加权，权重10%
        # 这使得同概率区间内，有大年反转/扩招信号的学校优先展示——这是竞品算法的盲区。
        opp_norm = (x.get("opportunity_score", 0) + 20) / 65  # map [-20,45]→[0,1]
        score = -(x["probability"] * 0.40 + x["quality_score"] * 0.35
                  + x["gem_score"] * 0.15 + opp_norm * 100 * 0.10)
        return (score, x.get("school_name", ""), x.get("major_name", ""))

    results.sort(key=_sort_score)

    # 7. 冲稳保分层（先分桶，再对少量结果做精细调整）
    # 宪法准则：surge 门槛降至 10%，10-24% 标记"极冲"，确保高排名考生也有足够数量
    for _r in results:
        if 10 <= _r["probability"] < 25:
            _r["suggested_action"] = "极冲"
    surge  = [r for r in results if 10 <= r["probability"] < 55]
    stable = [r for r in results if 55 <= r["probability"] < 82]
    safe   = [r for r in results if r["probability"] >= 82]
    # 截取展示数量（目标96所，覆盖高考平行志愿全部可填槽位）
    # 分配：冲25 + 稳46 + 保25 = 96
    # P7修复：每所学校最多展示 _SCHOOL_CAP 个专业，防止单校霸屏（如西南交通大学占13/96槽）
    # 计数器跨三个桶共享，避免同校在冲/稳/保中各出现 cap 次（总共 3×cap）
    _SCHOOL_CAP = 5
    _sch_cnt: dict = defaultdict(int)

    def _capped_pick(pool: list, n: int) -> list:
        out = []
        for r in pool:
            if len(out) >= n:
                break
            sn = r.get("school_name", "")
            if _sch_cnt[sn] < _SCHOOL_CAP:
                out.append(r)
                _sch_cnt[sn] += 1
        return out

    surge_list  = _capped_pick(surge, 25)
    stable_list = _capped_pick(stable, 46)
    safe_list   = _capped_pick(safe, 25)
    combined_96 = surge_list + stable_list + safe_list

    # 冷门宝藏：从96所中提取并按冷门价值×录取概率复合排序
    # P0.3：probability 权重0.6确保与考生位次匹配的冷门排在前面
    gems_list = sorted(
        [r for r in combined_96 if r["is_hidden_gem"] and r["probability"] >= 10],
        key=lambda x: -(x["gem_score"] * 0.4 + x["probability"] * 0.6)
    )

    display_list = combined_96  # 竞争密度惩罚只需对96所运算，无重复

    # 7a. 竞争密度惩罚（PLOS ONE 2022 竞争感知模型）
    # 仅对展示结果运算（~42条），避免全量 O(n²) 扫描
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

    # 7b. 热门学校流量惩罚（相关性忽视纠正，Jiang SJTU 2021）
    try:
        week_ago = datetime.datetime.utcnow() - datetime.timedelta(days=7)
        click_events = db.query(UserEvent).filter(
            UserEvent.event_type == "school_click",
            UserEvent.created_at >= week_ago
        ).all()
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
    except Exception:
        pass

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

    # 7d. 惩罚后重新分桶（热门惩罚可能改变冲/稳/保归属）
    # 用与初始排序相同的 deterministic key（含机会分）重排，保证查询稳定性
    def _resort_key(x):
        opp_norm = (x.get("opportunity_score", 0) + 20) / 65
        return (-(x["probability"]*0.40 + x["quality_score"]*0.35
                  + x["gem_score"]*0.15 + opp_norm * 100 * 0.10),
                x.get("school_name",""), x.get("major_name",""))

    surge_list  = sorted([r for r in display_list if 10 <= r["probability"] < 55],
                         key=_resort_key)[:25]
    stable_list = sorted([r for r in display_list if 55 <= r["probability"] < 82],
                         key=_resort_key)[:46]
    safe_list   = sorted([r for r in display_list if r["probability"] >= 82],
                         key=_resort_key)[:25]
    combined_96 = surge_list + stable_list + safe_list

    # P8修复（终稿）：惩罚后重新分桶后再次检查数量不足
    # 场景A：所有结果概率<10%，三桶均空 → 取最高30条填入safe，标"参考"
    # 场景B：combined_96不足30条 → 用概率最高的未入桶结果补齐至30条
    if not combined_96 and results:
        _fallback = sorted(results, key=lambda x: -x["probability"])[:30]
        for _fb in _fallback:
            _fb["suggested_action"] = "参考"
        safe_list   = _fallback
        combined_96 = _fallback
    elif len(combined_96) < 30 and results:
        # 补齐：把已选的school-major组合排除，补入剩余高概率结果
        _in_96 = {(r["school_name"], r["major_name"]) for r in combined_96}
        _extras = [r for r in results if (r["school_name"], r["major_name"]) not in _in_96]
        _extras_sorted = sorted(_extras, key=lambda x: -x["probability"])
        _need = 30 - len(combined_96)
        for _ex in _extras_sorted[:_need]:
            _ex["suggested_action"] = "参考"
            safe_list.append(_ex)
            combined_96.append(_ex)

    gems_list = sorted(
        [r for r in combined_96 if r["is_hidden_gem"] and r["probability"] >= 10],
        key=lambda x: (-(x["gem_score"]*0.4 + x["probability"]*0.6),
                       x.get("school_name",""), x.get("major_name",""))
    )

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
    _rec_cache_set(province, rank, subject, is_paid, _result)
    return _result


# ── 简易IP限流（防止恶意请求打死数据库）──────────────────────
_RATE_LIMIT_WINDOW = 60       # 窗口：60秒
_RATE_LIMIT_MAX    = 15       # 每个IP每分钟最多15次 recommend 请求
def _build_recent_data_simple(records: list, school_name: str,
                              baseline_cache: dict) -> list:
    """专业级数据 + 学校级院校最低分补充，返回最新6年。
    复用于 major_first_query 等非核心推荐端点。"""
    major_data = sorted(records, key=lambda x: x["year"], reverse=True)
    major_years = {r["year"] for r in major_data}
    latest_major_year = max(major_years) if major_years else 0
    if latest_major_year >= 2024:
        return major_data[:6]
    baselines = baseline_cache.get(school_name, [])
    supplemented = list(major_data)
    for bl in baselines:
        if bl["year"] not in major_years and bl["year"] >= 2024:
            supplemented.append(bl)
    return sorted(supplemented, key=lambda x: x["year"], reverse=True)[:6]


_rate_limit_store: dict = {}  # {ip: [timestamp, ...]}

def _check_rate_limit(request: Request):
    """返回 True 表示通过，False 表示被限流"""
    ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown").split(",")[0].strip()
    now = time.time()
    # 清理过期记录（懒清理，每次只清当前IP）
    if ip in _rate_limit_store:
        _rate_limit_store[ip] = [t for t in _rate_limit_store[ip] if now - t < _RATE_LIMIT_WINDOW]
    else:
        _rate_limit_store[ip] = []
    if len(_rate_limit_store[ip]) >= _RATE_LIMIT_MAX:
        return False
    _rate_limit_store[ip].append(now)
    # 定期清理：如果总IP数超过5000，清掉最旧的一半（防止内存泄漏）
    if len(_rate_limit_store) > 5000:
        oldest = sorted(_rate_limit_store.keys(), key=lambda k: _rate_limit_store[k][0] if _rate_limit_store[k] else 0)
        for k in oldest[:2500]:
            del _rate_limit_store[k]
    return True


@app.get("/api/recommend")
def recommend(
    request: Request,
    rank: int = Query(..., description="考生全省位次"),
    province: str = Query("北京", description="考生所在省份"),
    subject: str = Query("", description="选科，如：物理+化学"),
    mode: str = Query("all", description="模式：all/gem(只看冷门)/safe(保守)"),
    order_no: str = Query("", description="付费订单号，有效则解锁完整分析"),
    db: Session = Depends(get_db)
):
    """主推荐接口（wrapper，调用核心逻辑）"""
    if not _check_rate_limit(request):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试（每分钟最多15次）")
    if rank <= 0:
        raise HTTPException(status_code=422, detail=f"rank 必须大于 0，当前值: {rank}")
    if rank > 2000000:
        raise HTTPException(status_code=422, detail=f"rank 超出合理范围（最大 2,000,000），当前值: {rank}")

    # ━━━ 付费验证（多层链路，勿误判为缺失） ━━━━━━━━━━━━━━━━━━━━━━
    # 本层（Layer 1/3）：订单级匹配 — order_no + province + rank_bucket + subject
    # Layer 2/3：订阅过期检查 → routers/auth.py:573-623 (lazy expiry in /api/auth/me)
    #   - auth.py 的 /me 端点会检查 subscription_end_at，过期则返回 is_paid=False
    #   - 前端据此决定是否传 order_no（不传则此处 is_paid 保持 False）
    # Layer 3/3：支付失败 UI → frontend/components/PayModal.tsx:439-442
    #   - 创建订单失败时显示「创建订单失败，点击重试」按钮
    #   - 二维码超时时显示「二维码已过期，重新获取」按钮
    # 订阅到期时间设置 → routers/payment.py:246-261 (_finalize_order)
    #   - season_2026: 2026-07-31, monthly: +30天, quarterly: +90天
    # ¥1.99 = 解锁「某省×某位次×某选科」单次查询
    # order_no 必须同时满足：已支付 + province/rank/subject 与当前查询匹配
    is_paid = False
    if order_no:
        paid_order = db.query(Order).filter(
            Order.order_no == order_no,
            Order.status == "paid"
        ).first()
        if paid_order:
            # 省份必须匹配（空字符串=历史兼容，视为匹配）
            province_match = (paid_order.province == "" or paid_order.province == province)
            # 位次在同一 1000-bucket 内视为同次查询（允许用户微调位次重查）
            rank_match = (
                paid_order.rank_input is None or
                abs((paid_order.rank_input // 1000) - (rank // 1000)) <= 1
            )
            # 选科必须匹配（空字符串=历史兼容订单，视为匹配）
            subject_match = (paid_order.subject == "" or paid_order.subject == subject)
            is_paid = province_match and rank_match and subject_match

    if not is_paid:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            from routers.auth import _verify_token
            tok_payload = _verify_token(auth_header[7:])
            if tok_payload:
                uid = tok_payload.get("uid")
                phone = tok_payload.get("phone")
                u = None
                if uid:
                    u = db.query(User).filter(User.id == uid).first()
                elif phone:
                    u = db.query(User).filter(User.phone == phone).first()
                if u:
                    # JWT路径：查该用户是否有与当前 province+rank+subject 匹配的 paid order
                    rank_bucket_lo = (rank // 1000) * 1000 - 1000
                    rank_bucket_hi = (rank // 1000) * 1000 + 1999
                    matching_order = db.query(Order).filter(
                        Order.user_id == u.id,
                        Order.status == "paid",
                        Order.province == province,
                        Order.subject == subject,
                        Order.rank_input >= rank_bucket_lo,
                        Order.rank_input <= rank_bucket_hi,
                    ).first()
                    if matching_order:
                        is_paid = True

    try:
        return _run_recommend_core(province=province, rank=rank, subject=subject,
                                   mode=mode, db=db, is_paid=is_paid)
    except Exception as e:
        logger.error(f"recommend error province={province} rank={rank}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="推荐系统暂时无法处理该请求，请稍后重试")


# ── 学校详情 ──────────────────────────────────────────────────
@app.get("/api/school/{school_name}")
def school_detail(
    school_name: str,
    province: str = Query("北京"),
    db: Session = Depends(get_db)
):
    school = db.query(School).filter(School.name == school_name).first()
    if not school:
        return {"error": "学校不存在"}

    # 该校在该省的招生专业（取最新年份）
    majors = (
        db.query(Major)
        .filter(Major.school_name == school_name, Major.province == province)
        .order_by(Major.year.desc())
        .all()
    )
    # 去重专业名（取最新年份的条目）
    seen_majors = {}
    for m in majors:
        if m.major_name not in seen_majors:
            seen_majors[m.major_name] = m
    majors_dedup = list(seen_majors.values())

    # 历年录取记录
    records = (
        db.query(AdmissionRecord)
        .filter(AdmissionRecord.school_name == school_name, AdmissionRecord.province == province)
        .order_by(AdmissionRecord.year)
        .all()
    )

    major_records = defaultdict(list)
    for r in records:
        major_records[r.major_name].append({
            "year": r.year,
            "min_rank": r.min_rank,
            "min_score": r.min_score,
            "plan_count": r.admit_count
        })

    # 学科评估
    evals = db.query(SubjectEvaluation).filter(
        SubjectEvaluation.school_name == school_name
    ).order_by(SubjectEvaluation.grade).all()

    subject_eval_map = {}
    for ev in evals:
        subject_eval_map[ev.subject_name] = ev.grade

    # 学校摘要
    school_tags = school.tags.split(",") if school.tags else []
    school_info_extra = {
        "postgrad_rate": school.postgrad_rate,
        "is_985": school.is_985,
        "is_211": school.is_211,
        "is_shuangyiliu": school.is_shuangyiliu,
        "nature": school.nature,
        "male_ratio": school.male_ratio,
        "female_ratio": school.female_ratio,
        "website": school.website,
        "admission_website": school.admission_website,
        "intro": school.intro[:500] if school.intro else "",
        "rank_2025": school.rank_2025,
        "city_level": school.city_level,
        "admin_dept": school.admin_dept,
        "flagship_majors": school.flagship_majors,
        "employment_quality": school.employment_quality,
        "founded_year": school.founded_year,
        "subject_evaluations": [
            {"subject": k, "grade": v}
            for k, v in sorted(subject_eval_map.items(), key=lambda x: x[1])
            if v in ["A+", "A", "A-", "B+"]
        ][:12]
    }

    major_analysis = []
    for major in majors_dedup:
        recs = sorted(major_records.get(major.major_name, []), key=lambda x: x["year"])
        bsy = detect_big_small_year(recs[-3:])
        gem_b = hidden_gem_type_b(major.major_name)
        emp = get_major_employment(major.major_name, db)
        major_analysis.append({
            "major_name": major.major_name,
            "subject_req": major.subject_req,
            "plan_count": major.plan_count,
            "tuition": major.tuition,
            "duration": major.duration,
            "records": recs,
            "big_small_year": bsy,
            "cognitive_gem": gem_b,
            "employment": emp
        })

    # 非北京省份：majors表无数据，直接从录取记录构建
    if not major_analysis and major_records:
        for major_name, recs in major_records.items():
            valid_recs = [r for r in recs if (r.get("min_rank") or 0) > 0]
            if not valid_recs:
                continue
            recs_sorted = sorted(valid_recs, key=lambda x: x["year"])
            bsy = detect_big_small_year(recs_sorted[-3:])
            emp = get_major_employment(major_name, db)
            major_analysis.append({
                "major_name": major_name,
                "subject_req": "",
                "plan_count": None,
                "tuition": None,
                "duration": None,
                "records": recs_sorted,
                "big_small_year": bsy,
                "cognitive_gem": None,
                "employment": emp
            })
        major_analysis.sort(key=lambda x: -(x["records"][-1]["min_rank"] if x["records"] else 0))

    # 计算学校综合质量评分
    strong_subjects_raw = get_school_top_subjects(school_name, db)
    # 转换 key: get_school_top_subjects 返回 {subject_name, grade}，quality_score 需要 {major_name, subject_strength}
    strong_subjects_for_quality = [
        {"major_name": s["subject_name"], "subject_strength": s["grade"]}
        for s in strong_subjects_raw
    ]
    emp_list = []
    for ma in major_analysis:
        if ma.get("employment"):
            emp_list.append(ma["employment"])
    school_dict_for_quality = {
        "name": school.name,
        "tier": school.tier,
        "is_985": school.is_985,
        "is_211": school.is_211,
        "is_shuangyiliu": school.is_shuangyiliu,
        "rank_2025": school.rank_2025,
        "postgrad_rate": school.postgrad_rate,
    }
    quality = school_quality_score(school_dict_for_quality, strong_subjects_for_quality, emp_list)

    return {
        "school": {
            "name": school.name,
            "province": school.province,
            "city": school.city,
            "tier": school.tier,
            "tags": school_tags,
            **school_info_extra
        },
        "majors": major_analysis,
        "quality": quality
    }


# ── 学校「未来展望」──────────────────────────────────────────
@app.get("/api/school/{school_name}/outlook")
def school_outlook(school_name: str, db: Session = Depends(get_db)):
    """为指定学校生成 5-10 年未来展望分析（DeepSeek API，有缓存）"""
    from services.future_outlook import generate_outlook, _cache_get, _cache_key

    school = db.query(School).filter(School.name == school_name).first()
    if not school:
        return {"outlook": ""}

    # 先查缓存
    key = _cache_key(school_name, "")
    cached = _cache_get(key)
    if cached:
        return {"outlook": cached, "cached": True}

    # 构造 school_data
    strong = [
        ev.subject_name for ev in
        db.query(SubjectEvaluation)
        .filter(SubjectEvaluation.school_name == school_name, SubjectEvaluation.grade.in_(["A+", "A", "A-"]))
        .all()
    ]
    emp_row = db.query(SchoolEmployment).filter(SchoolEmployment.school_name == school_name).first()
    emp = {}
    if emp_row:
        emp = {
            "avg_salary": emp_row.avg_salary or 0,
            "school_employment_rate": emp_row.employment_rate or 0,
            "school_postgrad_rate": emp_row.postgrad_rate or 0,
        }

    # 最近 5 年录取位次
    recent = (
        db.query(AdmissionRecord.year, func.min(AdmissionRecord.min_rank).label("min_rank"))
        .filter(AdmissionRecord.school_name == school_name, AdmissionRecord.min_rank > 0)
        .group_by(AdmissionRecord.year)
        .order_by(AdmissionRecord.year.desc())
        .limit(5)
        .all()
    )
    recent_data = [{"year": r.year, "min_rank": r.min_rank} for r in recent]

    school_data = {
        "school_name": school.name,
        "major_name": "",
        "city": school.city,
        "tier": school.tier,
        "tags": school.tags.split(",") if school.tags else [],
        "strong_subjects": strong,
        "employment": emp,
        "recent_data": recent_data,
    }

    text = generate_outlook(school_data)
    return {"outlook": text, "cached": False}


# ── 一分一段位次查询 ──────────────────────────────────────────
@app.get("/api/rank-table")
def rank_lookup(
    province: str = Query("北京"),
    year: int = Query(2025),
    score: int = Query(..., description="高考分数"),
    db: Session = Depends(get_db)
):
    """根据分数查询对应的全省位次"""
    row = db.query(RankTable).filter(
        RankTable.province == province,
        RankTable.year == year,
        RankTable.score == score
    ).first()

    if row:
        return {
            "province": province,
            "year": year,
            "score": score,
            "rank": row.count_cum,
            "count_this_score": row.count_this,
            "rank_min": row.rank_min,
            "rank_max": row.rank_max
        }

    # 找最近的分数段
    closest = db.query(RankTable).filter(
        RankTable.province == province,
        RankTable.year == year,
        RankTable.score <= score
    ).order_by(RankTable.score.desc()).first()

    if closest:
        return {
            "province": province,
            "year": year,
            "score": score,
            "rank": closest.count_cum,
            "closest_score": closest.score,
            "note": f"未找到精确分数，返回 {closest.score} 分对应的位次"
        }

    return {"error": f"未找到 {province} {year} 年的一分一段数据"}


# ── 模拟填报（考前预测）────────────────────────────────────────
@app.get("/api/simulate")
def simulate(
    mock_score: int = Query(..., description="模拟考分数"),
    province: str = Query("北京"),
    subject: str = Query(""),
    db: Session = Depends(get_db)
):
    """考前模拟：将模考分数转换为预估位次区间"""
    try:
        return _simulate_inner(mock_score=mock_score, province=province, subject=subject, db=db)
    except Exception as e:
        logger.error(f"simulate error province={province} mock_score={mock_score}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="模拟估分暂时不可用，请稍后重试")


def _estimate_rank_from_admissions(target_score: int, province: str, db) -> Optional[dict]:
    """
    P0.2: 当省份无一分一段数据时，用录取记录反推估算考生位次。
    原理：admission_records 中的 (min_score, min_rank) 是省份考生分数-位次曲线的采样点。
    某校min_score=580且min_rank=5000 → 该省第5000名考生分数约为580分。
    取最近3年最小min_rank（最高学校门槛），构建单调的分数-位次曲线，线性插值。
    误差：因招生计划、志愿波动等因素，误差约±30%，必须加免责声明。
    """
    from sqlalchemy import text as _text

    # 步骤1：从录取记录提取该省分数-位次映射（最近3年，取每个分数点的最小min_rank）
    rows = db.execute(_text("""
        SELECT min_score, MIN(min_rank) AS best_rank
        FROM admission_records
        WHERE province = :prov
          AND min_score > 0 AND min_rank > 0
          AND year >= 2022
        GROUP BY min_score
        HAVING COUNT(*) >= 1
        ORDER BY min_score DESC
    """), {"prov": province}).fetchall()

    if len(rows) < 5:
        return None  # 数据点太少，无法可靠插值

    # 步骤2：构建单调曲线（高分→低rank number，去掉不单调的噪点）
    # 规则：沿分数降序遍历，rank只能递增（分数越低排名越靠后）
    monotonic: list = []
    max_rank_seen = 0
    for row in rows:
        s, r = row.min_score, row.best_rank
        if r > max_rank_seen:
            monotonic.append((s, r))
            max_rank_seen = r

    if len(monotonic) < 3:
        return None

    # 步骤3：线性插值
    above = [(s, r) for s, r in monotonic if s >= target_score]
    below = [(s, r) for s, r in monotonic if s < target_score]

    if above and below:
        s1, r1 = above[-1]   # 分数略高于目标（位次更小/更难）
        s2, r2 = below[0]    # 分数略低于目标（位次更大/更容易）
        if s1 != s2:
            t = (target_score - s2) / (s1 - s2)
            est_rank = round(r2 + t * (r1 - r2))
        else:
            est_rank = round((r1 + r2) / 2)
    elif above:
        est_rank = above[-1][1]
    elif below:
        est_rank = below[0][1]
    else:
        return None

    est_rank = max(100, est_rank)
    margin = max(5000, round(est_rank * 0.35))   # ±35%，最小±5000

    return {
        "estimated_rank": est_rank,
        "range_lo": max(100, est_rank - margin),
        "range_hi": est_rank + margin,
        "data_points": len(monotonic),
        "method": "admission_records_interpolation",
    }


def _simulate_inner(mock_score: int, province: str, subject: str, db):
    """考前模拟内部实现"""
    # 新高考省份按选科确定位次池类别（物理类/历史类分开排名）
    _NEW_GAOKAO_PROVINCES = {"广东", "江苏", "浙江", "山东", "湖北", "湖南", "福建", "辽宁", "重庆"}
    rank_category_filter = None
    if province in _NEW_GAOKAO_PROVINCES and subject:
        s = subject.split("+")[0].strip()
        if s in {"物理", "物理类"}:
            rank_category_filter = "物理类"
        elif s in {"历史", "历史类"}:
            rank_category_filter = "历史类"

    # 用最近年份一分一段数据（仅当该省份有数据时才能估算）
    q = db.query(RankTable.year).filter(RankTable.province == province)
    if rank_category_filter:
        q = q.filter(RankTable.category == rank_category_filter)
    latest_year = q.order_by(RankTable.year.desc()).limit(1).scalar()

    if latest_year:
        # 模考偏难，高考分数通常略低（约96%）
        target_score = round(mock_score * 0.96)
        q2 = db.query(RankTable).filter(
            RankTable.province == province,
            RankTable.year == latest_year,
            RankTable.score <= target_score
        )
        if rank_category_filter:
            q2 = q2.filter(RankTable.category == rank_category_filter)
        rank_row = q2.order_by(RankTable.score.desc()).first()

        if rank_row:
            estimated_rank = rank_row.count_cum
            return {
                "mock_score": mock_score,
                "estimated_real_score": target_score,
                "estimated_rank": estimated_rank,
                "estimated_rank_range": [
                    max(100, estimated_rank - 3000),
                    estimated_rank + 3000
                ],
                "based_on_year": latest_year,
                "note": f"基于{latest_year}年{province}一分一段估算，高考难度有波动，请以实际出分为准"
            }

    # P0.2：该省份无一分一段 → 尝试从录取记录插值估算
    target_score = round(mock_score * 0.96)
    admission_est = _estimate_rank_from_admissions(target_score, province, db)
    if admission_est:
        return {
            "mock_score": mock_score,
            "estimated_real_score": target_score,
            "estimated_rank": admission_est["estimated_rank"],
            "estimated_rank_range": [admission_est["range_lo"], admission_est["range_hi"]],
            "based_on_year": "2022-2024录取数据",
            "method": "admission_records",
            "no_data": False,
            "note": (
                f"⚠️ {province}暂无一分一段官方数据，以下位次由历年录取记录插值估算（{admission_est['data_points']}个采样点），"
                f"误差约±35%，仅供参考。建议出分后用实际高考位次重新查询。"
            )
        }

    # 确实无任何数据可用 → 返回明确错误
    return {
        "mock_score": mock_score,
        "estimated_real_score": None,
        "estimated_rank": None,
        "no_data": True,
        "note": f"暂未收录{province}一分一段数据，无法自动转换位次。请出分后直接输入您的高考位次查询。"
    }


# ── 学校搜索 ──────────────────────────────────────────────────
@app.get("/api/search/schools")
def search_schools(
    q: str = Query("", description="学校名称关键词"),
    tier: str = Query("", description="985/211/双一流/普通"),
    province_school: str = Query("", description="学校所在省份"),
    limit: int = Query(20),
    db: Session = Depends(get_db)
):
    query = db.query(School)
    if q:
        query = query.filter(School.name.contains(q))
    if tier:
        query = query.filter(School.tier == tier)
    if province_school:
        query = query.filter(School.province == province_school)
    total = query.count()
    schools = query.order_by(School.rank_2025).limit(limit).all()
    return {
        "total": total,
        "schools": [
            {
                "name": s.name,
                "province": s.province,
                "city": s.city,
                "tier": s.tier,
                "is_985": s.is_985,
                "is_211": s.is_211,
                "postgrad_rate": s.postgrad_rate,
                "nature": s.nature,
                "rank_2025": s.rank_2025,
                "flagship_majors": s.flagship_majors,
                "city_level": s.city_level,
                "intro": s.intro[:120] if s.intro else "",
            }
            for s in schools
        ]
    }


# ── 冷门专业词库 ──────────────────────────────────────────────
@app.get("/api/hidden-gems/majors")
def list_cognitive_gems():
    """返回认知折价专业完整词库"""
    result = []
    for name, info in COGNITIVE_DISCOUNT_MAJORS.items():
        result.append({
            "major_name": name,
            "real_direction": info["real_direction"],
            "industry_prospect": info["industry_prospect"],
            "misconception": info["misconception"],
            "discount_level": info["discount_level"]
        })
    return {"gems": result, "total": len(result)}


# ── 专业优先查询 ──────────────────────────────────────────────
@app.get("/api/search/by-major")
def search_by_major(
    major: str = Query(..., description="专业关键词，如'计算机科学'或'法学'"),
    province: str = Query(...),
    rank: int = Query(...),
    subject: str = Query("", description="选科，如'物理'或'历史'"),
    db: Session = Depends(get_db),
):
    """
    专业优先查询：给定专业关键词+位次，返回在该专业有录取数据且位次匹配的学校列表。
    适合"我想学X，有哪些学校可以去"的查询模式。
    """
    # 1. 找所有包含关键词的专业名
    records = db.query(AdmissionRecord).filter(
        AdmissionRecord.province == province,
        AdmissionRecord.major_name.contains(major),
        AdmissionRecord.major_name != "[院校最低分]",
    ).all()

    if not records:
        return {"major_query": major, "province": province, "rank": rank, "schools": [], "total": 0}

    # 2. 按(学校, 专业)分组，计算位次和概率
    from collections import defaultdict
    grouped: dict = defaultdict(list)
    for r in records:
        grouped[(r.school_name, r.major_name)].append({
            "year": r.year, "min_rank": r.min_rank, "min_score": r.min_score,
            "subject_req": r.subject_req or "",
        })

    # 2b. 预加载学校级院校最低分（补充近年数据缺失）
    _school_names_mfq = list({k[0] for k in grouped.keys()})
    _bl_cache_mfq: dict = defaultdict(list)
    _bl_rows = db.query(AdmissionRecord).filter(
        AdmissionRecord.province == province,
        AdmissionRecord.major_name.contains("院校最低分"),
        AdmissionRecord.min_rank > 0,
        AdmissionRecord.school_name.in_(_school_names_mfq),
    ).order_by(AdmissionRecord.year.desc()).all()
    for _br in _bl_rows:
        _bl_cache_mfq[_br.school_name].append({
            "year": _br.year, "min_rank": _br.min_rank, "min_score": _br.min_score,
            "plan_count": 0, "is_school_baseline": True,
        })

    # 3. 选科过滤 + 概率计算
    _alias = {"理科": "物理", "文科": "历史", "物理类": "物理", "历史类": "历史"}
    user_subjects = set(_alias.get(s.strip(), s.strip()) for s in subject.split("+") if s.strip()) if subject else set()
    _has_wuli = "物理" in user_subjects
    _has_lishi = "历史" in user_subjects
    _OPEN = {"不限", "nan", "-", "", "综合", "不限选科"}

    def _subj_ok(req: str) -> bool:
        if not subject: return True
        req = req.strip()
        if not req or req in _OPEN: return True
        if "物理" in req and "历史" not in req: return _has_wuli
        if "历史" in req and "物理" not in req: return _has_lishi
        return True

    school_cache = {s.name: s for s in db.query(School).all()}
    results = []
    _rank_buf = max(3000, rank * 0.4)

    for (school_name, major_name), recs in grouped.items():
        # 选科过滤
        latest_req = sorted(recs, key=lambda x: x["year"], reverse=True)[0]["subject_req"]
        if not _subj_ok(latest_req): continue

        # 简单位次预测
        from algorithms.rank_method import predict_admission
        pred = predict_admission(rank, recs)
        avg_rank = pred.get("avg_min_rank_3yr", 0)
        if avg_rank == 0: continue
        # 位次窗口
        if avg_rank > rank * 3.0 + _rank_buf: continue
        if avg_rank < rank * 0.3 - _rank_buf: continue

        school_info = school_cache.get(school_name)
        # 查学科评估等级
        eval_records = db.query(SubjectEvaluation).filter(
            SubjectEvaluation.school_name == school_name,
            SubjectEvaluation.subject_name.contains(major),
        ).order_by(SubjectEvaluation.grade).first()
        grade = eval_records.grade if eval_records else ""

        results.append({
            "school_name": school_name,
            "major_name": major_name,
            "subject_req": latest_req,
            "probability": pred["probability"],
            "avg_min_rank_3yr": avg_rank,
            "rank_diff": pred.get("rank_diff", 0),
            "confidence": pred["confidence"],
            "tier": school_info.tier if school_info else "普通",
            "is_985": school_info.is_985 if school_info else "否",
            "is_211": school_info.is_211 if school_info else "否",
            "rank_2025": school_info.rank_2025 if school_info else 0,
            "city": school_info.city if school_info else "",
            "province_school": school_info.province if school_info else "",
            "subject_eval_grade": grade,  # A+/A/B+等学科评估等级
            "recent_data": _build_recent_data_simple(recs, school_name, _bl_cache_mfq),
        })

    # 按综合排序：概率×0.4 + 学校质量×0.4 + 学科评估×0.2
    _grade_score = {"A+": 100, "A": 90, "A-": 80, "B+": 70, "B": 60, "B-": 50, "C+": 40, "C": 30, "": 0}
    results.sort(key=lambda x: -(
        x["probability"] * 0.4 +
        (100 - min(x["rank_2025"], 100) if x["rank_2025"] and x["rank_2025"] > 0 else 30) * 0.4 +
        _grade_score.get(x["subject_eval_grade"], 0) * 0.2
    ))

    return {
        "major_query": major,
        "province": province,
        "rank": rank,
        "schools": results[:50],  # 最多50所
        "total": len(results),
    }


# ── 投资组合优化 ──────────────────────────────────────────────
@app.post("/api/portfolio/optimize")
def portfolio_optimize(
    request: Request,
    province: str = Query(...),
    rank: int = Query(...),
    subject: str = Query(""),
    max_slots: int = Query(96),
    risk_floor: float = Query(0.99),
    db: Session = Depends(get_db),
):
    """
    最优志愿排列：基于平行志愿期望价值公式，输出按最优顺序排列的96个志愿。
    理论来源：Chade, Lewis & Smith (2014, RES) + Chen & Kesten (2017, JPE)
    """
    try:
        from algorithms.portfolio_optimizer import optimize_volunteer_list
    except ImportError:
        from portfolio_optimizer import optimize_volunteer_list

    # 复用推荐引擎获取候选学校
    recommend_data = _run_recommend_core(
        province=province, rank=rank, subject=subject,
        mode="all", db=db, is_paid=True
    )

    # 将冲稳保结果展平为候选列表
    candidates = []
    all_results = (
        recommend_data.get("surge", []) +
        recommend_data.get("stable", []) +
        recommend_data.get("safe", []) +
        recommend_data.get("hidden_gems", [])
    )
    for r in all_results:
        if r.get("probability", 0) <= 0:
            continue
        candidates.append({
            "school_name": r["school_name"],
            "major_name":  r["major_name"],
            "probability": r["probability"] / 100,
            "utility":     r.get("quality_score", 50) / 100,
            "avg_rank":    r.get("avg_min_rank_3yr", rank),
            "std_rank":    max(500, r.get("avg_min_rank_3yr", rank) * 0.12),
            # school_tier = 985/211/普通 quality label; intentionally NOT "tier"
            # so Monte Carlo falls through to _classify_tier(probability) → 冲/稳/保/垫
            "school_tier": r.get("tier", "普通"),
            "is_985":      r.get("is_985", "否"),
            "city":        r.get("city", ""),
            "is_hidden_gem": r.get("is_hidden_gem", False),
        })

    if not candidates:
        raise HTTPException(status_code=404, detail="未找到足够候选学校")

    result = optimize_volunteer_list(
        candidates=candidates,
        max_slots=max_slots,
        risk_floor=risk_floor,
    )
    return {
        "province": province,
        "rank": rank,
        "total_candidates": len(candidates),
        **result,
    }


@app.post("/api/portfolio/simulate")
def portfolio_simulate(
    province: str = Query(...),
    rank: int = Query(...),
    subject: str = Query(""),
    n_simulations: int = Query(5000, ge=100, le=20000),
    db: Session = Depends(get_db),
):
    """
    蒙特卡洛风险模拟：对最优志愿组合运行N次场景模拟，输出风险分布。
    """
    try:
        from algorithms.portfolio_optimizer import optimize_volunteer_list
        from algorithms.monte_carlo import simulate_portfolio
    except ImportError:
        from portfolio_optimizer import optimize_volunteer_list
        from monte_carlo import simulate_portfolio

    def _probit(p: float) -> float:
        """Normal inverse CDF approximation (Beasley-Springer-Moro)"""
        import math
        p = max(1e-6, min(1 - 1e-6, p))
        if p < 0.5:
            return -_probit(1 - p)
        # Rational approximation for p in [0.5, 1)
        t = math.sqrt(-2 * math.log(1 - p))
        c = [2.515517, 0.802853, 0.010328]
        d = [1.432788, 0.189269, 0.001308]
        return t - (c[0] + c[1]*t + c[2]*t*t) / (1 + d[0]*t + d[1]*t*t + d[2]*t*t*t)

    recommend_data = _run_recommend_core(
        province=province, rank=rank, subject=subject,
        mode="all", db=db, is_paid=True
    )
    candidates = []
    all_results = (
        recommend_data.get("surge", []) +
        recommend_data.get("stable", []) +
        recommend_data.get("safe", [])
    )
    for r in all_results:
        p_cal = r.get("probability", 0) / 100
        if p_cal <= 0:
            continue
        # 从校准后概率反推有效avg_rank，使得蒙特卡洛模拟结果与校准概率一致
        # P(admitted) = Φ((avg_rank - student_rank) / std_rank) = p_cal
        # → avg_rank = student_rank + std_rank × Φ^{-1}(p_cal)
        sim_std = max(800, rank * 0.15)  # 模拟用波动幅度
        effective_avg_rank = rank + sim_std * _probit(p_cal)
        candidates.append({
            "school_name": r["school_name"],
            "major_name":  r["major_name"],
            "probability": p_cal,
            "utility":     r.get("quality_score", 50) / 100,
            "avg_rank":    max(100, round(effective_avg_rank)),
            "std_rank":    sim_std,
            # school_tier stores 985/211/普通 category; intentionally NOT "tier"
            # so that _run_single_simulation falls through to _classify_tier(probability)
            # and labels outcomes as 冲/稳/保/垫 based on admission probability.
            "school_tier": r.get("tier", "普通"),
            "student_rank": rank,
        })

    if not candidates:
        raise HTTPException(status_code=404, detail="未找到足够候选学校")

    portfolio_result = optimize_volunteer_list(candidates=candidates, max_slots=30)
    ordered = portfolio_result.get("ordered_list", candidates[:30])
    # inject student_rank into each school for simulation
    for s in ordered:
        s["student_rank"] = rank

    sim_result = simulate_portfolio(ordered, n_simulations=n_simulations)
    return {
        "province": province,
        "rank": rank,
        "n_simulations": n_simulations,
        "portfolio_size": len(ordered),
        **sim_result,
    }


@app.get("/api/calibration/info")
def calibration_info():
    """返回概率校准模型的元数据（透明度接口）"""
    try:
        from algorithms.calibration import get_calibration_info
    except ImportError:
        from calibration import get_calibration_info
    return get_calibration_info()


@app.get("/api/population/province")
def population_info(province: str = Query(...), year: int = Query(2025)):
    """返回指定省份高考报名人数及2026预测"""
    try:
        from algorithms.population_data import get_province_total, get_population_scale_factor
    except ImportError:
        from population_data import get_province_total, get_population_scale_factor
    total = get_province_total(province, year)
    scale_2026 = get_population_scale_factor(province, year, 2026)
    return {
        "province": province,
        "year": year,
        "total_candidates": total,
        "scale_to_2026": round(scale_2026, 4),
        "note": "scale_to_2026 = 2026预测人数/当年人数，用于调整历史位次的可比性"
    }


# ── 专业风向标 ────────────────────────────────────────────────
@app.get("/api/major/trend")
def major_trend(name: str = Query(...), db: Session = Depends(get_db)):
    """查询指定专业的历年招生量趋势（用于专业风向标页面）"""
    # 跨省汇总：按年份统计招生总人数和开设该专业的院校数
    rows = (
        db.query(
            AdmissionRecord.year,
            func.sum(AdmissionRecord.admit_count).label("total_admit"),
            func.count(func.distinct(AdmissionRecord.school_name)).label("school_count"),
        )
        .filter(AdmissionRecord.major_name.ilike(f"%{name}%"))
        .group_by(AdmissionRecord.year)
        .order_by(AdmissionRecord.year)
        .all()
    )

    # 就业信息
    emp = (
        db.query(MajorEmployment)
        .filter(MajorEmployment.major_name.ilike(f"%{name}%"))
        .first()
    )

    yearly = [
        {"year": r.year, "admit": int(r.total_admit or 0), "schools": int(r.school_count or 0)}
        for r in rows if r.year >= 2019
    ]

    # 趋势方向：对比最近2年 vs 前2年
    trend = "unknown"
    if len(yearly) >= 4:
        recent = sum(y["admit"] for y in yearly[-2:]) / 2
        earlier = sum(y["admit"] for y in yearly[-4:-2]) / 2
        if earlier > 0:
            change = (recent - earlier) / earlier
            if change < -0.10:
                trend = "declining"
            elif change > 0.10:
                trend = "rising"
            else:
                trend = "stable"

    return {
        "major_name": name,
        "yearly": yearly,
        "trend": trend,
        "employment_rate": emp.employment_rate if emp else None,
        "avg_salary": emp.avg_salary if emp else None,
        "category": emp.category_1 if emp else None,
    }


@app.get("/api/major/search")
def major_search(q: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    """专业名称模糊搜索（自动补全用）"""
    results = (
        db.query(AdmissionRecord.major_name)
        .filter(AdmissionRecord.major_name.ilike(f"%{q}%"))
        .distinct()
        .limit(10)
        .all()
    )
    return {"suggestions": [r.major_name for r in results]}


# ── 健康检查 ──────────────────────────────────────────────────
@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    return {
        "status": "ok",
        "version": "4.0.0",
        "engine": "高考志愿决策引擎（全量数据版）",
        "data": {
            "schools": db.query(School).count(),
            "admission_records": db.query(AdmissionRecord).count(),
            "subject_evaluations": db.query(SubjectEvaluation).count(),
            "major_employment": db.query(MajorEmployment).count(),
            "national_programs": db.query(NationalProgram).count(),
            "province_control_lines": db.query(ProvinceControlLine).count(),
            "rank_tables": db.query(RankTable).count(),
        }
    }
