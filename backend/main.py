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
    get_db,
    init_db,
    School,
    Major,
    AdmissionRecord,
    SubjectEvaluation,
    MajorEmployment,
    RankTable,
    NationalProgram,
    ProvinceControlLine,
    User,
    UserEvent,
    SchoolEmployment,
    SchoolReview,
    Order,
)
from algorithms.rank_method import build_gradient_plan, detect_big_small_year
from algorithms.hidden_gem import (
    hidden_gem_type_b,
    school_quality_score,
    COGNITIVE_DISCOUNT_MAJORS,
)
from routers import (
    auth as auth_router,
    payment as payment_router,
    track as track_router,
)
from routers import report as report_router, admin as admin_router
from routers import tracking as tracking_router
from routers import agent as agent_router
from routers import commission as commission_router
from routers.auth import _verify_token as _auth_verify_token

from services.recommend_core import (
    _run_recommend_core, _load_2026_recruit, _norm_major, aggregate_plan_2026, _PLAN_COLS,
    _filter_stopped_2026, parse_user_subjects, subject_match_struct,
)
from services._prewarm_cache import start_prewarm_daemon

app = FastAPI(title="高考志愿填报决策引擎", version="3.0.0")
app.include_router(auth_router.router)
app.include_router(payment_router.router)
app.include_router(track_router.router)
app.include_router(report_router.router)
app.include_router(admin_router.router)
app.include_router(tracking_router.router)
app.include_router(agent_router.router)
app.include_router(commission_router.router)

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
    # 预热城市线级缓存（避免首个 /api/cities 请求阻塞） + 推荐缓存
    _prewarm_caches()
    # start_prewarm_daemon()


def _prewarm_caches():
    """启动时预热缓存：城市线级映射。不阻塞启动。"""
    import threading
    def _warm():
        try:
            from database import SessionLocal
            db = SessionLocal()
            try:
                _get_tier_cities_map(db)
                logger.info("[prewarm] 城市线级缓存已预热")
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"[prewarm] 城市缓存预热失败: {e}")
    threading.Thread(target=_warm, daemon=True).start()


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
        logger.warning(
            "[Scheduler] apscheduler 未安装，跳过定时任务（pip install apscheduler）"
        )
    except Exception as e:
        logger.error(f"[Scheduler] 启动失败: {e}", exc_info=True)


# ── 工具函数：获取学校最强学科评估 ───────────────────────────────
def get_school_top_subjects(school_name: str, db: Session) -> List[dict]:
    """从 subject_evaluations 表查询该校的学科评估，返回A类学科列表"""
    grade_order = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-"]

    evals = (
        db.query(SubjectEvaluation)
        .filter(SubjectEvaluation.school_name == school_name)
        .all()
    )

    result = []
    for ev in evals:
        grade = ev.grade.strip() if ev.grade else ""
        result.append(
            {
                "subject_name": ev.subject_name,
                "grade": grade,
                "grade_rank": grade_order.index(grade) if grade in grade_order else 99,
            }
        )
    # 只返回 A 类（A+ A A-）
    a_class = [r for r in result if r["grade_rank"] <= 2]
    return sorted(a_class, key=lambda x: x["grade_rank"])


def get_major_employment(major_name: str, db: Session) -> Optional[dict]:
    """从 major_employment 表查询专业就业信息"""
    emp = (
        db.query(MajorEmployment)
        .filter(MajorEmployment.major_name == major_name)
        .first()
    )
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
_RATE_LIMIT_WINDOW = 60  # 窗口：60秒
_RATE_LIMIT_MAX = 15  # 每个IP每分钟最多15次 recommend 请求


def _build_recent_data_simple(
    records: list, school_name: str, baseline_cache: dict
) -> list:
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
    ip = (
        request.headers.get(
            "X-Forwarded-For", request.client.host if request.client else "unknown"
        )
        .split(",")[0]
        .strip()
    )
    now = time.time()
    # 清理过期记录（懒清理，每次只清当前IP）
    if ip in _rate_limit_store:
        _rate_limit_store[ip] = [
            t for t in _rate_limit_store[ip] if now - t < _RATE_LIMIT_WINDOW
        ]
    else:
        _rate_limit_store[ip] = []
    if len(_rate_limit_store[ip]) >= _RATE_LIMIT_MAX:
        return False
    _rate_limit_store[ip].append(now)
    # 定期清理：如果总IP数超过5000，清掉最旧的一半（防止内存泄漏）
    if len(_rate_limit_store) > 5000:
        oldest = sorted(
            _rate_limit_store.keys(),
            key=lambda k: _rate_limit_store[k][0] if _rate_limit_store[k] else 0,
        )
        for k in oldest[:2500]:
            del _rate_limit_store[k]
    return True


# 分科类省份(3+1+2/旧文理)必须先选首选科目；缺失时返回 428 让前端弹出科目选择。
# 不能静默默认物理——否则历史考生分数被按物理换算，跨科类串档（见 derived_category 修复）。
def _require_first_choice(province: str, subject: str, db: Session):
    cats = {
        c[0]
        for c in db.query(RankTable.category)
        .filter(RankTable.province == province)
        .distinct()
        .all()
    }
    is_split = bool(cats) and "综合" not in cats
    if not is_split:
        return
    if not any(k in (subject or "") for k in ("物理", "历史", "理科", "文科")):
        raise HTTPException(
            status_code=428,
            detail={
                "error_code": "FIRST_CHOICE_REQUIRED",
                "message": "该省份为新高考3+1+2，请先选择首选科目（物理类 / 历史类）再查询。",
                "province": province,
            },
        )


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
    c_city: str = Query("", description="目标城市名，逗号分隔（城市筛选弹窗按一二三线分组多选）"),
    c_city_level: str = Query(
        "", description="[兼容旧版] 目标城市线级，逗号分隔（如 一线,二线），自动展开为对应城市名"
    ),
    c_nature: str = Query("", description="办学性质，逗号分隔"),
    c_tier: str = Query("", description="院校档次，逗号分隔"),
    batch_filter: str = Query(
        "",
        description="批次类型筛选，逗号分隔（undergraduate,junior_college,advance_batch,special_type,art,sports,preparatory,other）",
    ),
    exclude_restrictions: str | None = Query(
        None,
        description="排除的专业限制标签，逗号分隔。不传=默认排除所有已知限制；空字符串=不排除任何限制",
    ),
    discipline_filter: str = Query(
        "",
        description="门类+专业类筛选，竖线分隔。每项为「门类」(该门类全选) 或「门类:专业类」(仅该专业类)。例：工学:计算机类|工学:机械类|管理学",
    ),
    score: int | None = Query(
        None, description="考生分数（用于分数分桶，优先于位次分桶）"
    ),
    db: Session = Depends(get_db),
):
    """主推荐接口（wrapper，调用核心逻辑）"""
    if not _check_rate_limit(request):
        raise HTTPException(
            status_code=429, detail="请求过于频繁，请稍后再试（每分钟最多15次）"
        )
    if rank <= 0:
        raise HTTPException(status_code=422, detail=f"rank 必须大于 0，当前值: {rank}")
    if rank > 2000000:
        raise HTTPException(
            status_code=422,
            detail=f"rank 超出合理范围（最大 2,000,000），当前值: {rank}",
        )
    if len(province) > 20 or not province.strip():
        raise HTTPException(status_code=422, detail="省份格式不正确")

    _require_first_choice(province, subject, db)

    # ━━━ 付费验证（多层链路，勿误判为缺失） ━━━━━━━━━━━━━━━━━━━━━━
    # 本层（Layer 1/3）：订单级匹配 — order_no + province + rank_bucket + subject
    # Layer 2/3：订阅过期检查 → routers/auth.py:573-623 (lazy expiry in /api/auth/me)
    #   - auth.py 的 /me 端点会检查 subscription_end_at，过期则返回 is_paid=False
    #   - 前端据此决定是否传 order_no（不传则此处 is_paid 保持 False）
    # Layer 3/3：支付失败 UI → frontend/components/PayModal.tsx:439-442
    #   - 创建订单失败时显示「创建订单失败，点击重试」按钮
    #   - 二维码超时时显示「二维码已过期，重新获取」按钮
    # 订阅到期时间设置 → routers/payment.py:246-261 (_finalize_order)
    #   - season_2026: 2026-09-01, monthly: +30天, quarterly: +90天
    # ¥39 = 解锁「某省×某位次×某选科」单次查询
    # order_no 必须同时满足：已支付 + province/rank/subject 与当前查询匹配
    is_paid = False
    if order_no:
        paid_order = (
            db.query(Order)
            .filter(Order.order_no == order_no, Order.status == "paid")
            .first()
        )
        if paid_order:
            # 省份必须匹配（空字符串=历史兼容，视为匹配）
            province_match = (
                paid_order.province == "" or paid_order.province == province
            )
            # 位次微调容差 ±50 视为同次查询
            rank_match = (
                paid_order.rank_input is None or abs(paid_order.rank_input - rank) <= 50
            )
            # 选科必须匹配（空字符串=历史兼容订单，视为匹配）
            subject_match = paid_order.subject == "" or paid_order.subject == subject
            is_paid = province_match and rank_match and subject_match

            # 订阅制订单：即使订单本身有效，也需检查用户订阅状态是否仍然有效
            if is_paid and paid_order.product_type in (
                "season_2026",
                "monthly_sub",
                "quarterly_sub",
            ):
                if paid_order.user_id:
                    order_user = (
                        db.query(User).filter(User.id == paid_order.user_id).first()
                    )
                    now = datetime.datetime.utcnow()
                    if (
                        not order_user
                        or not order_user.is_paid
                        or not (
                            order_user.subscription_end_at
                            and order_user.subscription_end_at > now
                        )
                    ):
                        is_paid = False

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
                    # 位次微调容差 ±50 视为同次查询
                    matching_order = (
                        db.query(Order)
                        .filter(
                            Order.user_id == u.id,
                            Order.status == "paid",
                            Order.province == province,
                            Order.subject == subject,
                            Order.rank_input >= rank - 50,
                            Order.rank_input <= rank + 50,
                        )
                        .first()
                    )
                    if matching_order:
                        is_paid = True
                    # 订阅制会员：未过期内无限次查询（不依赖单笔订单匹配）
                    # 只要有 is_paid + 未过期的 subscription_end_at 即视为有效
                    if not is_paid and u.is_paid:
                        now = datetime.datetime.utcnow()
                        if u.subscription_end_at and u.subscription_end_at > now:
                            is_paid = True

    constraints = {}
    if c_major.strip():
        constraints["major_keywords"] = [
            k.strip() for k in c_major.strip().split() if k.strip()
        ]
    # 收集目标城市：新版 c_city（具体城市名）+ 旧版 c_city_level（线级展开）
    _city_names: list[str] = []
    if c_city.strip():
        _city_names.extend(x.strip() for x in c_city.strip().split(",") if x.strip())
    if c_city_level.strip():
        tier_map = _get_tier_cities_map(db)
        for t in c_city_level.strip().split(","):
            t = t.strip()
            if t and t in tier_map:
                _city_names.extend(tier_map[t])
    if _city_names:
        constraints["cities"] = _city_names
    if c_nature.strip():
        constraints["natures"] = [
            x.strip() for x in c_nature.strip().split(",") if x.strip()
        ]
    if c_tier.strip():
        constraints["tiers"] = [
            x.strip() for x in c_tier.strip().split(",") if x.strip()
        ]

    # 试看层门控：trial_report 只解锁前 3 所
    trial_limit = None
    if is_paid and order_no:
        paid_order = (
            db.query(Order)
            .filter(Order.order_no == order_no, Order.status == "paid")
            .first()
        )
        if paid_order and paid_order.product_type == "trial_report":
            trial_limit = 3

    _DEFAULT_SPECIAL = [
        "special:experiment",
        "special:national_special",
        "special:local_special",
        "special:oriented",
        "special:free_teacher",
        "special:sino_foreign",
    ]
    _batch_filter = (
        [x.strip() for x in batch_filter.split(",") if x.strip()]
        if batch_filter
        else None
    )
    if exclude_restrictions is None:
        # 无参数 = 默认排除所有特殊计划
        _exclude_restrictions = _DEFAULT_SPECIAL
    elif exclude_restrictions == "":
        _exclude_restrictions = []
    else:
        _parsed = [x.strip() for x in exclude_restrictions.split(",") if x.strip()]
        if "special:none" in _parsed:
            # 显式允许所有特殊计划
            _exclude_restrictions = [r for r in _parsed if r != "special:none"]
        elif not any(r.startswith("special:") for r in _parsed):
            # 参数中不含 special:*（如只传了 gender），默认加上特殊计划
            _exclude_restrictions = _parsed + _DEFAULT_SPECIAL
        else:
            _exclude_restrictions = _parsed

    # 门类+专业类筛选解析：竖线分隔，每项「门类」或「门类:专业类」
    _discipline_filter = None
    if discipline_filter.strip():
        _df = []
        for item in discipline_filter.split("|"):
            item = item.strip()
            if not item:
                continue
            if ":" in item:
                d, mc = item.split(":", 1)
                _df.append({"discipline": d.strip(), "major_class": mc.strip()})
            else:
                _df.append({"discipline": item, "major_class": None})
        _discipline_filter = _df or None

    try:
        result = _run_recommend_core(
            province=province,
            rank=rank,
            subject=subject,
            exam_mode=exam_mode,
            mode=mode,
            db=db,
            is_paid=is_paid,
            constraints=constraints or None,
            trial_limit=trial_limit,
            batch_filter=_batch_filter or None,
            exclude_restrictions=_exclude_restrictions or None,
            discipline_filter=_discipline_filter,
            user_score=score,
        )
        result["is_trial"] = trial_limit is not None
        result["trial_limit"] = trial_limit
        return result
    except Exception as e:
        logger.error(
            f"recommend error province={province} rank={rank}: {e}", exc_info=True
        )
        raise HTTPException(
            status_code=500, detail="推荐系统暂时无法处理该请求，请稍后重试"
        )


# ── 2026 招生计划（推荐理由展开时按需调用）──────────────────────
@app.get("/api/plan_2026")
def plan_2026(
    province: str = Query(...),
    school: str = Query(...),
    major: str = Query(...),
    db: Session = Depends(get_db),
):
    """返回某 (省, 校, 专业) 的 2026 招生计划：聚合计划数/学费 + 各方向明细 + 专业基础信息。
    注：推荐列表已在响应里内联 plan_2026，前端无需逐条调用；此接口供单点查询备用。"""
    from sqlalchemy import text as _text
    rows = db.execute(_text(
        f"SELECT {_PLAN_COLS} FROM admission_2026 "
        "WHERE province=:p AND school_name=:s AND major_name=:m"
    ), {"p": province, "s": school, "m": major}).fetchall()
    if not rows:
        return {"found": False, "province": province, "school_name": school, "major_name": major}
    return {
        "found": True, "province": province, "school_name": school, "major_name": major,
        **aggregate_plan_2026([tuple(r) for r in rows]),
    }


# ── 学校详情 ──────────────────────────────────────────────────
@app.get("/api/school/{school_name}")
def school_detail(
    school_name: str, province: str = Query("北京"), db: Session = Depends(get_db)
):
    school = db.query(School).filter(School.name == school_name).first()
    if not school:
        return {"error": "学校不存在"}

    # 从 admission_2026 获取该校在该省的招生专业（新版 xlsx 导入，含 major_full + 2026预估位次）
    from sqlalchemy import text as _sqla_text
    a26_rows = db.execute(
        _sqla_text(
            "SELECT DISTINCT major_name, major_full, major_remark, subject_req, "
            "plan_count, tuition, duration, major_code, group_name, group_code, "
            "discipline, major_class, major_level, ruanke_grade, ruanke_rank, "
            "discipline_eval, major_level_tag, est_rank_26 "
            "FROM admission_2026 "
            "WHERE school_name=:sn AND province=:p"
        ),
        {"sn": school_name, "p": province}
    ).fetchall()
    # 建立 major_full -> info 的映射（不同校区/方向按 full name 区分，不再合并）
    # fallback：若 major_full 为空，用 major_name 兜底（历史数据兼容）
    majors_by_full = {}
    for r in a26_rows:
        mf = (r[1] or "").strip() or r[0]  # major_full  or fallback to major_name
        _est = r[17]
        if mf not in majors_by_full:
            majors_by_full[mf] = {
                "major_name": r[0] or mf,
                "major_full": mf,
                "major_remark": r[2] or "",
                "subject_req": r[3] or "",
                "est_rank_26": _est,
                "plan_count": r[4],
                "tuition": r[5] or "",
                "duration": r[6] or "",
                "major_code": r[7] or "",
                "group_name": r[8] or "",
                "group_code": r[9] or "",
                "discipline": r[10] or "",
                "major_class": r[11] or "",
                "major_level": r[12] or "",
                "ruanke_grade": r[13] or "",
                "ruanke_rank": r[14] or "",
                "discipline_eval": r[15] or "",
                "major_level_tag": r[16] or "",
            }
        else:
            # 同 full 多行（极少数重复）：取更优预估位次
            _cur = majors_by_full[mf]["est_rank_26"]
            if _est and (not _cur or _est < _cur):
                majors_by_full[mf]["est_rank_26"] = _est

    # 历年录取记录
    records = (
        db.query(AdmissionRecord)
        .filter(
            AdmissionRecord.school_name == school_name,
            AdmissionRecord.province == province,
        )
        .order_by(AdmissionRecord.year)
        .all()
    )

    # 按 专业名 + 备注 分组（相同 major_full 对应相同 major_remark，以此区分不同校区/方向）。
    # 每年保留一条代表记录：优先普通批(无特殊限制)，再取 min_rank 最大(最易录取的主线)，
    # 避免定向/专项等异常高位次记录污染该专业的历年展示。
    _by_key_year = defaultdict(dict)  # "major_name||major_remark" -> {year: best_rec}
    for r in records:
        # 院校最低分是学校级底线占位行，不作为独立专业展示
        if not r.major_name or "院校最低分" in r.major_name:
            continue
        rec = {
            "year": r.year,
            "min_rank": r.min_rank,
            "min_score": r.min_score,
            "plan_count": r.admit_count,
            "major_remark": r.major_remark or "",
            "restricted": bool((r.major_restrictions or "").strip()),
        }
        key = f"{r.major_name}||{r.major_remark or ''}"
        slot = _by_key_year[key]
        cur = slot.get(r.year)
        if cur is None:
            slot[r.year] = rec
        else:
            # 代表性优先级：普通批 > 特殊计划；同类取 min_rank 更大者(更典型的主录取线)
            cur_key = (not cur["restricted"], cur.get("min_rank") or 0)
            new_key = (not rec["restricted"], rec.get("min_rank") or 0)
            if new_key > cur_key:
                slot[r.year] = rec

    major_records = {name: list(yrs.values()) for name, yrs in _by_key_year.items()}

    # 学科评估
    evals = (
        db.query(SubjectEvaluation)
        .filter(SubjectEvaluation.school_name == school_name)
        .order_by(SubjectEvaluation.grade)
        .all()
    )

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
        ][:12],
    }

    major_analysis = []
    # 以 major_full 为维度生成条目（不同校区/方向不再合并）
    for major_full, mi in majors_by_full.items():
        major_name = mi.get("major_name", major_full)
        major_remark = mi.get("major_remark", "")
        # 匹配历年录取记录：按 major_name + major_remark 查找（同向优先，回退到仅按名匹配）
        key_exact = f"{major_name}||{major_remark}"
        key_plain = f"{major_name}||"
        recs = major_records.get(key_exact) or major_records.get(key_plain) or []
        # 若仍无匹配，尝试所有以该 major_name 开头的 key（兜底取第一个）
        if not recs:
            for k, v in major_records.items():
                if k.startswith(f"{major_name}||"):
                    recs = v
                    break
        valid_recs = [r for r in recs if (r.get("min_rank") or 0) > 0]
        recs_sorted = sorted(valid_recs, key=lambda x: x["year"])
        bsy = detect_big_small_year(recs_sorted[-3:])
        gem_b = hidden_gem_type_b(major_name)
        emp = get_major_employment(major_name, db)
        major_analysis.append(
            {
                "major_name": major_name,
                "major_full": major_full,
                "major_remark": major_remark,
                "subject_req": mi.get("subject_req", ""),
                "plan_count": mi.get("plan_count"),
                "tuition": mi.get("tuition"),
                "duration": mi.get("duration"),
                "major_code": mi.get("major_code", ""),
                "group_name": mi.get("group_name", ""),
                "group_code": mi.get("group_code", ""),
                "discipline": mi.get("discipline", ""),
                "major_class": mi.get("major_class", ""),
                "major_level": mi.get("major_level", ""),
                "ruanke_grade": mi.get("ruanke_grade", ""),
                "ruanke_rank": mi.get("ruanke_rank", ""),
                "discipline_eval": mi.get("discipline_eval", ""),
                "major_level_tag": mi.get("major_level_tag", ""),
                "est_rank_26": mi.get("est_rank_26"),  # 2026预估位次（前端高亮展示）
                "records": recs_sorted,                 # 仅历年真实录取(2023-2025)
                "big_small_year": bsy,
                "cognitive_gem": gem_b,
                "employment": emp,
            }
        )
    # 按最近一年位次降序排列（位次高的 = 更难考 = 放前面）
    major_analysis.sort(
        key=lambda x: -(x["records"][-1]["min_rank"] if x["records"] else 0)
    )

    # admission_2026 有数据但 admission_records 完全缺失的情况：保留条目但 records 为空
    if not major_analysis and majors_by_full:
        for major_full, mi in majors_by_full.items():
            major_name = mi.get("major_name", major_full)
            bsy = detect_big_small_year([])
            gem_b = hidden_gem_type_b(major_name)
            emp = get_major_employment(major_name, db)
            major_analysis.append(
                {
                    "major_name": major_name,
                    "major_full": major_full,
                    "major_remark": mi.get("major_remark", ""),
                    "subject_req": mi.get("subject_req", ""),
                    "plan_count": mi.get("plan_count"),
                    "tuition": mi.get("tuition"),
                    "duration": mi.get("duration"),
                    "major_code": mi.get("major_code", ""),
                    "group_name": mi.get("group_name", ""),
                    "group_code": mi.get("group_code", ""),
                    "discipline": mi.get("discipline", ""),
                    "major_class": mi.get("major_class", ""),
                    "major_level": mi.get("major_level", ""),
                    "ruanke_grade": mi.get("ruanke_grade", ""),
                    "ruanke_rank": mi.get("ruanke_rank", ""),
                    "discipline_eval": mi.get("discipline_eval", ""),
                    "major_level_tag": mi.get("major_level_tag", ""),
                    "est_rank_26": mi.get("est_rank_26"),  # 2026预估位次（前端高亮展示）
                    "records": [],
                    "big_small_year": bsy,
                    "cognitive_gem": gem_b,
                    "employment": emp,
                }
            )

    # 仅显示 2026 仍在招的专业：该校在 2026 数据中出现时按名过滤（带归一化）；
    # 该校未出现在 2026 数据中（数据缺失）则不过滤，避免误删整校专业。
    _pairs, _pairs_norm, _schools_2026 = _load_2026_recruit(db, province)
    if school_name in _schools_2026:
        _recruit = {mj for (s, mj) in _pairs if s == school_name}
        _recruit_norm = {mj for (s, mj) in _pairs_norm if s == school_name}
        major_analysis = [
            ma for ma in major_analysis
            if ma["major_name"] in _recruit or _norm_major(ma["major_name"]) in _recruit_norm
        ]

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
    quality = school_quality_score(
        school_dict_for_quality, strong_subjects_for_quality, emp_list
    )

    return {
        "school": {
            "name": school.name,
            "province": school.province,
            "city": school.city,
            "tier": school.tier,
            "tags": school_tags,
            **school_info_extra,
        },
        "majors": major_analysis,
        "quality": quality,
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
        ev.subject_name
        for ev in db.query(SubjectEvaluation)
        .filter(
            SubjectEvaluation.school_name == school_name,
            SubjectEvaluation.grade.in_(["A+", "A", "A-"]),
        )
        .all()
    ]
    emp_row = (
        db.query(SchoolEmployment)
        .filter(SchoolEmployment.school_name == school_name)
        .first()
    )
    emp = {}
    if emp_row:
        emp = {
            "avg_salary": emp_row.avg_salary or 0,
            "school_employment_rate": emp_row.employment_rate or 0,
            "school_postgrad_rate": emp_row.postgrad_rate or 0,
        }

    # 最近 5 年录取位次
    recent = (
        db.query(
            AdmissionRecord.year, func.min(AdmissionRecord.min_rank).label("min_rank")
        )
        .filter(
            AdmissionRecord.school_name == school_name, AdmissionRecord.min_rank > 0
        )
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
    year: int | None = Query(None, description="留空=自动取该省最新年份（有 2026 用 2026）"),
    score: int = Query(..., description="高考分数"),
    db: Session = Depends(get_db),
):
    """根据分数查询对应的全省位次。year 留空时自动取该省最新一分一段年份（有 2026 用 2026）。"""
    if year is None:
        year = (
            db.query(RankTable.year)
            .filter(RankTable.province == province)
            .order_by(RankTable.year.desc())
            .limit(1)
            .scalar()
        ) or 2025
    row = (
        db.query(RankTable)
        .filter(
            RankTable.province == province,
            RankTable.year == year,
            RankTable.score == score,
        )
        .first()
    )

    if row:
        return {
            "province": province,
            "year": year,
            "score": score,
            "rank": row.count_cum,
            "count_this_score": row.count_this,
            "rank_min": row.rank_min,
            "rank_max": row.rank_max,
        }

    # 找最近的分数段
    closest = (
        db.query(RankTable)
        .filter(
            RankTable.province == province,
            RankTable.year == year,
            RankTable.score <= score,
        )
        .order_by(RankTable.score.desc())
        .first()
    )

    if closest:
        return {
            "province": province,
            "year": year,
            "score": score,
            "rank": closest.count_cum,
            "closest_score": closest.score,
            "note": f"未找到精确分数，返回 {closest.score} 分对应的位次",
        }

    return {"error": f"未找到 {province} {year} 年的一分一段数据"}


# ── 模拟填报（考前预测）────────────────────────────────────────
@app.get("/api/simulate")
def simulate(
    mock_score: int = Query(..., description="模拟考分数"),
    province: str = Query("北京"),
    subject: str = Query(""),
    db: Session = Depends(get_db),
):
    """考前模拟：将高考分数转换为预估位次区间"""
    _require_first_choice(province, subject, db)
    try:
        return _simulate_inner(
            mock_score=mock_score, province=province, subject=subject, db=db
        )
    except Exception as e:
        logger.error(
            f"simulate error province={province} mock_score={mock_score}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail="模拟估分暂时不可用，请稍后重试")


def _estimate_rank_from_admissions(
    target_score: int, province: str, db
) -> Optional[dict]:
    """
    P0.2: 当省份无一分一段数据时，用录取记录反推估算考生位次。
    原理：admission_records 中的 (min_score, min_rank) 是省份考生分数-位次曲线的采样点。
    某校min_score=580且min_rank=5000 → 该省第5000名考生分数约为580分。
    取最近3年最小min_rank（最高学校门槛），构建单调的分数-位次曲线，线性插值。
    误差：因招生计划、志愿波动等因素，误差约±30%，必须加免责声明。
    """
    from sqlalchemy import text as _text

    # 步骤1：从录取记录提取该省分数-位次映射（最近3年，取每个分数点的最小min_rank）
    rows = db.execute(
        _text("""
        SELECT min_score, MIN(min_rank) AS best_rank
        FROM admission_records
        WHERE province = :prov
          AND min_score > 0 AND min_rank > 0
          AND year >= 2021
        GROUP BY min_score
        HAVING COUNT(*) >= 1
        ORDER BY min_score DESC
    """),
        {"prov": province},
    ).fetchall()

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
        s1, r1 = above[-1]  # 分数略高于目标（位次更小/更难）
        s2, r2 = below[0]  # 分数略低于目标（位次更大/更容易）
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
    margin = max(5000, round(est_rank * 0.35))  # ±35%，最小±5000

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
        cats = {
            c[0]
            for c in db.query(RankTable.category)
            .filter(RankTable.province == province, RankTable.year >= 2024)
            .distinct()
            .all()
        }
        # 只要该省一分一段含「综合」即视为 3+3（按综合排名），不按选科过滤。
        # 注意：山东 2024 年附带了分科目补充表(物理类/化学类…)，但 2025/2026 仅有综合，
        # 故判定依据「是否存在综合」而非「科类数量>1」，否则会被旧年份补充表误导，
        # 把选科过滤锁到只有 2024 才有的物理类，导致取到 2024 而非最新年份。
        if cats and "综合" not in cats:
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
            RankTable.score <= target_score,
        )
        if rank_category_filter:
            q2 = q2.filter(RankTable.category == rank_category_filter)
        rank_row = q2.order_by(RankTable.score.desc()).first()

        if rank_row:
            estimated_rank = rank_row.count_cum
            from algorithms.population_data import get_province_total as _pop_total

            _prov_total = (
                _pop_total(province, latest_year)
                or _pop_total(province, 2025)
                or 500_000
            )
            # 不确定区间用「分数带」表示更符合直觉：模考与真实分差大致是固定的分数浮动，
            # 而非固定位次浮动。固定位次余量在高分稀疏段会对应几十分、在密集段只对应一两分。
            # 做法：用位次余量(0.8%省总量)÷本段人数(局部密度)得到分数带，夹到 ±[3,25] 分，
            # 再经一分一段换算回位次（稀疏段触 25 分上限、密集段触 3 分下限）。
            _rank_margin = max(2000, int(_prov_total * 0.008))
            _density = rank_row.count_this or 0
            _band = (_rank_margin / _density) if _density else 10
            _band = int(round(max(3, min(25, _band))))

            def _cum_at_score(sc: int):
                qy = db.query(RankTable.count_cum).filter(
                    RankTable.province == province,
                    RankTable.year == latest_year,
                    RankTable.score <= sc,
                )
                if rank_category_filter:
                    qy = qy.filter(RankTable.category == rank_category_filter)
                row = qy.order_by(RankTable.score.desc()).first()
                return row[0] if row else None

            _rank_best = _cum_at_score(target_score + _band)   # 高分端 → 更优位次
            _rank_worst = _cum_at_score(target_score - _band)  # 低分端 → 更差位次
            return {
                "mock_score": mock_score,
                "estimated_real_score": target_score,
                "estimated_rank": estimated_rank,
                "estimated_rank_range": [
                    max(100, _rank_best or estimated_rank),
                    min(_prov_total, _rank_worst or estimated_rank),
                ],
                "based_on_year": latest_year,
                "reliability": "high",
                "note": (
                    f"基于{latest_year}年{province}一分一段表估算。"
                    f"实际成绩约浮动±{_band}分，对应上方位次区间，"
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
            "estimated_rank_range": [
                admission_est["range_lo"],
                admission_est["range_hi"],
            ],
            "based_on_year": "2022-2024录取数据",
            "method": "admission_records",
            "reliability": "low",  # 无一分一段，插值误差大，不可靠
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
        "note": f"暂未收录{province}一分一段数据，无法自动转换位次。请出分后直接输入您的高考位次查询。",
    }


# ── 学校搜索 ──────────────────────────────────────────────────
@app.get("/api/search/schools")
def search_schools(
    q: str = Query("", description="学校名称关键词"),
    tier: str = Query("", description="985/211/双一流/普通"),
    province_school: str = Query("", description="学校所在省份"),
    limit: int = Query(20),
    db: Session = Depends(get_db),
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
        ],
    }


# ── 冷门专业词库 ──────────────────────────────────────────────
@app.get("/api/hidden-gems/majors")
def list_cognitive_gems():
    """返回认知折价专业完整词库"""
    result = []
    for name, info in COGNITIVE_DISCOUNT_MAJORS.items():
        result.append(
            {
                "major_name": name,
                "real_direction": info["real_direction"],
                "industry_prospect": info["industry_prospect"],
                "misconception": info["misconception"],
                "discount_level": info["discount_level"],
            }
        )
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
    records = (
        db.query(AdmissionRecord)
        .filter(
            AdmissionRecord.province == province,
            AdmissionRecord.major_name.contains(major),
            AdmissionRecord.major_name != "[院校最低分]",
        )
        .all()
    )

    if not records:
        return {
            "major_query": major,
            "province": province,
            "rank": rank,
            "schools": [],
            "total": 0,
        }

    # 2. 按(学校, 专业)分组，计算位次和概率
    from collections import defaultdict

    grouped: dict = defaultdict(list)
    for r in records:
        grouped[(r.school_name, r.major_name)].append(
            {
                "year": r.year,
                "min_rank": r.min_rank,
                "min_score": r.min_score,
                "subject_req": r.subject_req or "",
                "subject_must": r.subject_must or "",
                "subject_any_of": r.subject_any_of or "",
                "derived_category": r.derived_category or "",
            }
        )

    # 2b. 预加载学校级院校最低分（补充近年数据缺失）
    _school_names_mfq = list({k[0] for k in grouped.keys()})
    _bl_cache_mfq: dict = defaultdict(list)
    _bl_rows = (
        db.query(AdmissionRecord)
        .filter(
            AdmissionRecord.province == province,
            AdmissionRecord.major_name.contains("院校最低分"),
            AdmissionRecord.min_rank > 0,
            AdmissionRecord.school_name.in_(_school_names_mfq),
        )
        .order_by(AdmissionRecord.year.desc())
        .all()
    )
    for _br in _bl_rows:
        _bl_cache_mfq[_br.school_name].append(
            {
                "year": _br.year,
                "min_rank": _br.min_rank,
                "min_score": _br.min_score,
                "plan_count": 0,
                "is_school_baseline": True,
            }
        )

    # 3. 选科过滤（结构化 subject_must/any_of，与主推荐引擎同口径）+ 概率计算
    from sqlalchemy import text as _sqla_text
    user_subjects = parse_user_subjects(subject)
    # 首选科目（物理/历史）— 3+1+2 省份按派生科类硬过滤，防跨科类串档
    _prov_cats = {r[0] for r in db.execute(_sqla_text(
        "SELECT DISTINCT category FROM rank_tables WHERE province=:prov"), {"prov": province}).fetchall()}
    _is_split = bool(_prov_cats) and "综合" not in _prov_cats
    _first = "物理" if "物理" in user_subjects else ("历史" if "历史" in user_subjects else None)
    _lineage = None
    if _is_split and _first:
        _lineage = {"物理类", "物理", "理科"} if _first == "物理" else {"历史类", "历史", "文科"}

    school_cache = {s.name: s for s in db.query(School).all()}
    results = []
    _rank_buf = max(3000, rank * 0.4)

    for (school_name, major_name), recs in grouped.items():
        # 选科过滤（取最近一年记录的结构化选科字段）
        latest = sorted(recs, key=lambda x: x["year"], reverse=True)[0]
        latest_req = latest["subject_req"]
        if subject:
            if not subject_match_struct(user_subjects, latest["subject_must"], latest["subject_any_of"]):
                continue
            # 首选科类硬过滤（仅 3+1+2 省份）
            if _lineage is not None and latest["derived_category"] not in _lineage:
                continue

        # 简单位次预测
        from algorithms.rank_method import predict_admission

        pred = predict_admission(rank, recs)
        avg_rank = pred.get("avg_min_rank_3yr", 0)
        if avg_rank == 0:
            continue
        # 位次窗口
        if avg_rank > rank * 3.0 + _rank_buf:
            continue
        if avg_rank < rank * 0.3 - _rank_buf:
            continue

        school_info = school_cache.get(school_name)
        # 查学科评估等级
        eval_records = (
            db.query(SubjectEvaluation)
            .filter(
                SubjectEvaluation.school_name == school_name,
                SubjectEvaluation.subject_name.contains(major),
            )
            .order_by(SubjectEvaluation.grade)
            .first()
        )
        grade = eval_records.grade if eval_records else ""

        results.append(
            {
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
                "recent_data": _build_recent_data_simple(
                    recs, school_name, _bl_cache_mfq
                ),
            }
        )

    # 隐藏 2026 停招专业 + 给保留项挂上 2026 招生计划摘要（与主推荐引擎同口径）
    results = _filter_stopped_2026(db, province, results)

    # 按综合排序：概率×0.4 + 学校质量×0.4 + 学科评估×0.2
    _grade_score = {
        "A+": 100,
        "A": 90,
        "A-": 80,
        "B+": 70,
        "B": 60,
        "B-": 50,
        "C+": 40,
        "C": 30,
        "": 0,
    }
    results.sort(
        key=lambda x: (
            -(
                x["probability"] * 0.4
                + (
                    100 - min(x["rank_2025"], 100)
                    if x["rank_2025"] and x["rank_2025"] > 0
                    else 30
                )
                * 0.4
                + _grade_score.get(x["subject_eval_grade"], 0) * 0.2
            )
        )
    )

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
        province=province,
        rank=rank,
        subject=subject,
        exam_mode=exam_mode,
        mode="all",
        db=db,
        is_paid=True,
    )

    # 将冲稳保结果展平为候选列表
    candidates = []
    all_results = (
        recommend_data.get("surge", [])
        + recommend_data.get("stable", [])
        + recommend_data.get("safe", [])
        + recommend_data.get("hidden_gems", [])
    )
    for r in all_results:
        if r.get("probability", 0) <= 0:
            continue
        candidates.append(
            {
                "school_name": r["school_name"],
                "major_name": r["major_name"],
                "probability": r["probability"] / 100,
                "utility": r.get("quality_score", 50) / 100,
                "avg_rank": r.get("avg_min_rank_3yr", rank),
                "std_rank": max(500, r.get("avg_min_rank_3yr", rank) * 0.12),
                # school_tier = 985/211/普通 quality label; intentionally NOT "tier"
                # so Monte Carlo falls through to _classify_tier(probability) → 冲/稳/保/垫
                "school_tier": r.get("tier", "普通"),
                "is_985": r.get("is_985", "否"),
                "city": r.get("city", ""),
                "is_hidden_gem": r.get("is_hidden_gem", False),
            }
        )

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
        return t - (c[0] + c[1] * t + c[2] * t * t) / (
            1 + d[0] * t + d[1] * t * t + d[2] * t * t * t
        )

    recommend_data = _run_recommend_core(
        province=province,
        rank=rank,
        subject=subject,
        exam_mode=exam_mode,
        mode="all",
        db=db,
        is_paid=True,
    )
    candidates = []
    all_results = (
        recommend_data.get("surge", [])
        + recommend_data.get("stable", [])
        + recommend_data.get("safe", [])
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
        candidates.append(
            {
                "school_name": r["school_name"],
                "major_name": r["major_name"],
                "probability": p_cal,
                "utility": r.get("quality_score", 50) / 100,
                "avg_rank": max(100, round(effective_avg_rank)),
                "std_rank": sim_std,
                # school_tier stores 985/211/普通 category; intentionally NOT "tier"
                # so that _run_single_simulation falls through to _classify_tier(probability)
                # and labels outcomes as 冲/稳/保/垫 based on admission probability.
                "school_tier": r.get("tier", "普通"),
                "student_rank": rank,
            }
        )

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
        from algorithms.population_data import (
            get_province_total,
            get_population_scale_factor,
        )
    except ImportError:
        from population_data import get_province_total, get_population_scale_factor
    total = get_province_total(province, year)
    scale_2026 = get_population_scale_factor(province, year, 2026)
    return {
        "province": province,
        "year": year,
        "total_candidates": total,
        "scale_to_2026": round(scale_2026, 4),
        "note": "scale_to_2026 = 2026预测人数/当年人数，用于调整历史位次的可比性",
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
            func.count(func.distinct(AdmissionRecord.school_name)).label(
                "school_count"
            ),
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
        {
            "year": r.year,
            "admit": int(r.total_admit or 0),
            "schools": int(r.school_count or 0),
        }
        for r in rows
        if r.year >= 2019 and (r.total_admit or 0) > 0
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


# 本科学科门类的习惯排序（不在表内的按字典序兜底排在最后）
_BENKE_ORDER = [
    "哲学", "经济学", "法学", "教育学", "文学", "历史学", "理学", "工学",
    "农学", "医学", "管理学", "艺术学", "军事学", "交叉学科",
]


_CITY_TIERS = ["一线", "新一线", "二线", "三线", "四线", "五线"]
_MUNICIPALITIES = ("北京", "上海", "天津", "重庆")

# 线级→城市名缓存（首次调用时从 admission_2026 构建，兼容旧版 c_city_level 参数）
_tier_cities_cache: dict | None = None


def _get_tier_cities_map(db: Session) -> dict:
    """返回 {线级: [城市名列表]}，首次调用时从 admission_2026 构建并缓存。"""
    global _tier_cities_cache
    if _tier_cities_cache is not None:
        return _tier_cities_cache
    from collections import Counter
    from sqlalchemy import text as _text
    rows = db.execute(_text(
        "SELECT DISTINCT "
        "CASE WHEN school_province IN ('北京','上海','天津','重庆') THEN school_province ELSE city END AS disp_city, "
        "city_level FROM admission_2026 WHERE COALESCE(city,'') != ''"
    )).fetchall()
    votes: dict = defaultdict(Counter)
    for disp_city, lv in rows:
        if disp_city:
            votes[disp_city][_norm_city_tier(lv)] += 1
    tier_cities: dict = defaultdict(list)
    for city, c in votes.items():
        tier_cities[c.most_common(1)[0][0]].append(city)
    out = {}
    for t in _CITY_TIERS + ["其他"]:
        cities = sorted(tier_cities.get(t, []))
        if cities:
            out[t] = cities
    _tier_cities_cache = out
    return out


def _norm_city_tier(city_level: str) -> str:
    """城市层级归一：取首段、去「城市」后缀 → 一线/新一线/二线/三线/四线/五线，其余归「其他」。"""
    s = (city_level or "").split("/")[0].strip().replace("城市", "")
    return s if s in _CITY_TIERS else "其他"


@app.get("/api/cities")
def list_cities(db: Session = Depends(get_db)):
    """全国城市按一二三线分组（供城市筛选弹窗用）。
    复用 _get_tier_cities_map 缓存，首次调用后零 SQL。"""
    tier_map = _get_tier_cities_map(db)
    groups = [{"tier": t, "cities": c} for t, c in tier_map.items()]
    return {"groups": groups}


@app.get("/api/major/catalog")
def major_catalog(province: str = Query(...), db: Session = Depends(get_db)):
    """返回某省录取数据中的「门类→专业类」层级目录（供前端层级筛选器使用）。
    数据来自 admission_records 的 discipline(门类/大类) / major_class(专业类/小类) 列。
    discipline 混了两套并行分类：本科学科门类 与 专科「…大类」，按 level 分组返回。
    规则：discipline 以「大类」结尾 → 专科；否则 → 本科。"""
    from sqlalchemy import text as _text
    rows = db.execute(_text(
        "SELECT DISTINCT discipline, major_class FROM admission_records "
        "WHERE province=:p AND COALESCE(discipline,'') != '' "
        "AND COALESCE(major_class,'') != ''"
    ), {"p": province}).fetchall()
    grouped: dict = defaultdict(set)
    for disc, mc in rows:
        grouped[disc].add(mc)

    def _level(d: str) -> str:
        return "专科" if d.endswith("大类") else "本科"

    def _benke_key(d: str):
        return (_BENKE_ORDER.index(d) if d in _BENKE_ORDER else len(_BENKE_ORDER), d)

    entries = [
        {"discipline": d, "level": _level(d), "major_classes": sorted(mcs)}
        for d, mcs in grouped.items()
    ]
    benke = sorted([e for e in entries if e["level"] == "本科"],
                   key=lambda x: _benke_key(x["discipline"]))
    zhuanke = sorted([e for e in entries if e["level"] == "专科"],
                     key=lambda x: -len(x["major_classes"]))
    return {"province": province, "catalog": benke + zhuanke}


# ── 用户反馈 ──────────────────────────────────────────────────
from pydantic import BaseModel as _BaseModel


class _FeedbackPayload(_BaseModel):
    content: str
    contact: str = ""
    user_id: int | None = None


@app.post("/api/feedback")
def submit_feedback(
    req: _FeedbackPayload, request: Request, db: Session = Depends(get_db)
):
    from database import Feedback

    fb = Feedback(
        content=req.content[:2000],
        contact=req.contact[:100],
        user_id=req.user_id,
        ip=request.headers.get(
            "X-Forwarded-For", request.client.host if request.client else ""
        ),
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
        },
    }


if __name__ == "__main__":
    import sys as _sys
    import uvicorn

    # 命令行带 --reload 时启用热加载（改完代码自动重启，开发用）
    _reload = "--reload" in _sys.argv
    uvicorn.run("main:app", host="0.0.0.0", port=5198, reload=_reload)
