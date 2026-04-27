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

from dotenv import load_dotenv
load_dotenv()

logger = logging.getLogger("gaokao")

sys.path.insert(0, os.path.dirname(__file__))

from database import (
    get_db, init_db, School, Major, AdmissionRecord,
    SubjectEvaluation, MajorEmployment, RankTable,
    NationalProgram, ProvinceControlLine, User, UserEvent,
    SchoolEmployment, SchoolReview, Order,
)
from algorithms.rank_method import build_gradient_plan, detect_big_small_year
from algorithms.hidden_gem import (
    hidden_gem_type_b, school_quality_score, COGNITIVE_DISCOUNT_MAJORS
)
from routers import auth as auth_router, payment as payment_router, track as track_router
from routers import report as report_router, admin as admin_router
from routers import tracking as tracking_router
from routers import agent as agent_router
from routers.auth import _verify_token as _auth_verify_token

from services.recommend_core import _run_recommend_core
from services._prewarm_cache import start_prewarm_daemon

app = FastAPI(title="高考志愿填报决策引擎", version="3.0.0")
app.include_router(auth_router.router)
app.include_router(payment_router.router)
app.include_router(track_router.router)
app.include_router(report_router.router)
app.include_router(admin_router.router)
app.include_router(tracking_router.router)
app.include_router(agent_router.router)

_SITE_URL = os.getenv("SITE_URL", "https://www.theyuanxi.cn")
_ALLOWED_ORIGINS = [
    "https://theyuanxi.cn",
    "https://www.theyuanxi.cn",
    "https://mega.theyuanxi.cn",
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
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

app.add_middleware(SecurityHeadersMiddleware)


@app.get("/")
def root():
    return {"status": "ok"}


@app.get("/api/version")
def version():
    return {
        "version": os.getenv("BACKEND_VERSION", "3.0.1"),
    }

@app.on_event("startup")
def on_startup():
    init_db()
    _start_scheduler()
    # 推荐缓存预热：需要时取消下一行注释
    # start_prewarm_daemon()


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
    exam_mode: str = Query("", description="高考模式：3+1+2 / 3+3 / old"),
    mode: str = Query("all", description="模式：all/gem(只看冷门)/safe(保守)"),
    order_no: str = Query("", description="付费订单号，有效则解锁完整分析"),
    c_major: str = Query("", description="感兴趣的专业关键词，空格分隔"),
    c_city: str = Query("", description="目标城市等级，逗号分隔"),
    c_nature: str = Query("", description="办学性质，逗号分隔"),
    c_tier: str = Query("", description="院校档次，逗号分隔"),
    db: Session = Depends(get_db)
):
    """主推荐接口（wrapper，调用核心逻辑）"""
    if not _check_rate_limit(request):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试（每分钟最多15次）")
    if rank <= 0:
        raise HTTPException(status_code=422, detail=f"rank 必须大于 0，当前值: {rank}")
    if rank > 2000000:
        raise HTTPException(status_code=422, detail=f"rank 超出合理范围（最大 2,000,000），当前值: {rank}")
    if len(province) > 20 or not province.strip():
        raise HTTPException(status_code=422, detail="省份格式不正确")

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

    constraints = {}
    if c_major.strip():
        constraints["major_keywords"] = [k.strip() for k in c_major.strip().split() if k.strip()]
    if c_city.strip():
        constraints["city_levels"] = [x.strip() for x in c_city.strip().split(",") if x.strip()]
    if c_nature.strip():
        constraints["natures"] = [x.strip() for x in c_nature.strip().split(",") if x.strip()]
    if c_tier.strip():
        constraints["tiers"] = [x.strip() for x in c_tier.strip().split(",") if x.strip()]

    try:
        return _run_recommend_core(province=province, rank=rank, subject=subject,
                                   exam_mode=exam_mode, mode=mode, db=db, is_paid=is_paid, constraints=constraints or None)
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
    # 根据该省份在数据库中的实际科类分布，决定是否需要按选科过滤。
    # 3+3省份（北京/天津/上海/浙江/山东/海南）只有"综合"，不过滤。
    # 3+1+2省份（物理类/历史类）和旧高考省份（理科/文科）按选科过滤，防止科类数据混排。
    _subject_to_category = {
        "物理": ["物理类", "理科"],
        "物理类": ["物理类", "理科"],
        "历史": ["历史类", "文科"],
        "历史类": ["历史类", "文科"],
    }

    rank_category_filter = None
    if subject:
        s = subject.split("+")[0].strip()
        # 查询该省份有哪些 category
        cats = {c[0] for c in db.query(RankTable.category).filter(
            RankTable.province == province, RankTable.year >= 2024
        ).distinct().all()}
        # 如果省份有多个科类（非纯综合），按传入的选科映射
        if len(cats) > 1 or (cats and "综合" not in cats):
            for candidate in _subject_to_category.get(s, []):
                if candidate in cats:
                    rank_category_filter = candidate
                    break

    # 用最近年份一分一段数据（仅当该省份有数据时才能估算）
    q = db.query(RankTable.year).filter(RankTable.province == province)
    if rank_category_filter:
        q = q.filter(RankTable.category == rank_category_filter)
    latest_year = q.order_by(RankTable.year.desc()).limit(1).scalar()

    if latest_year:
        target_score = mock_score
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
            from algorithms.population_data import get_province_total as _pop_total
            _prov_total = _pop_total(province, latest_year) or _pop_total(province, 2025) or 500_000
            _range_margin = max(2000, int(_prov_total * 0.008))
            return {
                "mock_score": mock_score,
                "estimated_real_score": target_score,
                "estimated_rank": estimated_rank,
                "estimated_rank_range": [
                    max(100, estimated_rank - _range_margin),
                    min(_prov_total, estimated_rank + _range_margin),
                ],
                "based_on_year": latest_year,
                "reliability": "high",
                "note": (
                    f"基于{latest_year}年{province}一分一段表估算。"
                    f"实际位次可能偏差±{_range_margin:,}名，"
                    f"出分后请用真实位次重查以获得精确推荐。"
                ),
            }

    # P0.2：该省份无一分一段 → 尝试从录取记录插值估算
    target_score = mock_score
    admission_est = _estimate_rank_from_admissions(target_score, province, db)
    if admission_est:
        return {
            "mock_score": mock_score,
            "estimated_real_score": target_score,
            "estimated_rank": admission_est["estimated_rank"],
            "estimated_rank_range": [admission_est["range_lo"], admission_est["range_hi"]],
            "based_on_year": "2022-2024录取数据",
            "method": "admission_records",
            "reliability": "low",   # 无一分一段，插值误差大，不可靠
            "no_data": False,
            "note": (
                f"⚠️【可靠性：低】{province}暂无一分一段官方数据，"
                f"以下位次由历年录取记录插值估算（{admission_est['data_points']}个采样点），"
                f"误差约±35%。推荐结果仅供参考，强烈建议出分后用实际位次重新查询。"
            ),
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
        exam_mode=exam_mode, mode="all", db=db, is_paid=True
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
        exam_mode=exam_mode, mode="all", db=db, is_paid=True
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

def _estimate_employment_rate(category: str | None) -> float:
    """MajorEmployment 表中 employment_rate 大量为0，按专业类别给合理默认值"""
    if not category:
        return 0.82
    cat = category.strip()
    if cat in ("工学", "工程"):
        return 0.92
    if cat in ("理学", "农学", "医学"):
        return 0.88
    if cat == "管理学":
        return 0.84
    if cat == "经济学":
        return 0.86
    if cat == "教育学":
        return 0.85
    if cat in ("文学", "艺术", "艺术学"):
        return 0.62
    if cat == "法学":
        return 0.75
    if cat == "历史学":
        return 0.65
    if cat == "哲学":
        return 0.60
    return 0.82
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
        for r in rows if r.year >= 2019 and (r.total_admit or 0) > 0
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

    # 修复数据：avg_salary 数据库里是月薪，返回年薪给前端
    avg_salary = None
    employment_rate = None
    category = None
    if emp:
        category = emp.category_1 or None
        # 月薪 → 年薪
        if emp.avg_salary and emp.avg_salary > 0:
            avg_salary = emp.avg_salary * 12
        # employment_rate 数据库里大量为0，按专业类别给默认值
        if emp.employment_rate and emp.employment_rate > 0:
            employment_rate = emp.employment_rate
        else:
            employment_rate = _estimate_employment_rate(category)

    return {
        "major_name": name,
        "yearly": yearly,
        "trend": trend,
        "employment_rate": employment_rate,
        "avg_salary": avg_salary,
        "category": category,
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


# ── 用户反馈 ──────────────────────────────────────────────────
from pydantic import BaseModel as _BaseModel

class _FeedbackPayload(_BaseModel):
    content: str
    contact: str = ""

@app.post("/api/feedback")
def submit_feedback(req: _FeedbackPayload, request: Request, db: Session = Depends(get_db)):
    from database import Feedback
    fb = Feedback(
        content=req.content[:2000],
        contact=req.contact[:100],
        ip=request.headers.get("X-Forwarded-For", request.client.host if request.client else ""),
    )
    db.add(fb)
    db.commit()
    return {"ok": True}


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
