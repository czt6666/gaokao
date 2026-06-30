"""管理后台 API — /api/admin/* （X-Admin-Token 鉴权）"""
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, text, distinct
from sqlalchemy.exc import OperationalError
from typing import List, Optional
import datetime, os, json, csv, io
from pydantic import BaseModel

from database import get_db, User, Order, UserEvent, ReportLog, ReportScan, Feedback, CommissionRecord, WithdrawalRecord
from services.city_tier import get_tier_cities_map, reduce_city_filter

router = APIRouter(prefix="/api/admin", tags=["admin"])

ADMIN_TOKEN = os.getenv("ADMIN_TOKEN")
if not ADMIN_TOKEN:
    raise RuntimeError("环境变量 ADMIN_TOKEN 未设置，无法启动服务")


def _verify_admin(x_admin_token: str = Header(...)):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid admin token")


def _bj_now() -> datetime.datetime:
    """获取当前北京时间（UTC+8）"""
    return datetime.datetime.utcnow() + datetime.timedelta(hours=8)


def _bj_today_start() -> datetime.datetime:
    """获取北京时间今天 0:00 对应的 UTC 时间，用于和数据库 UTC 时间比较"""
    bj = _bj_now()
    bj_start = bj.replace(hour=0, minute=0, second=0, microsecond=0)
    return bj_start - datetime.timedelta(hours=8)


def _day_bj(col):
    """SQLite: 按北京时间日期分组（UTC 时间 +8 小时）"""
    return func.strftime("%Y-%m-%d", col, '+8 hours')


# ── 今日概览 ──────────────────────────────────────────────────
@router.get("/stats/today", dependencies=[Depends(_verify_admin)])
def stats_today(db: Session = Depends(get_db)):
    today_start = _bj_today_start()

    queries      = db.query(func.count(UserEvent.id)).filter(UserEvent.event_type == "query_submit", UserEvent.created_at >= today_start).scalar() or 0
    paid_orders  = db.query(func.count(Order.id)).filter(Order.status == "paid", Order.pay_time >= today_start).scalar() or 0
    revenue_fen  = db.query(func.sum(Order.amount)).filter(Order.status == "paid", Order.pay_time >= today_start).scalar() or 0
    new_users    = db.query(func.count(User.id)).filter(User.created_at >= today_start).scalar() or 0

    # ── 匿名访客（按浏览器 session_id，不要求注册）──
    # 新访问 = 「首次出现」落在今天的 session（首次访问本站的浏览器）
    new_visitor_sessions = (
        db.query(UserEvent.session_id)
        .filter(UserEvent.session_id != "")
        .group_by(UserEvent.session_id)
        .having(func.min(UserEvent.created_at) >= today_start)
        .subquery()
    )
    new_visitors = db.query(func.count()).select_from(new_visitor_sessions).scalar() or 0
    # 新访问中点击查询的：今天首访 且 提交过查询 的 session
    new_visitor_queries = (
        db.query(func.count(distinct(UserEvent.session_id)))
        .filter(
            UserEvent.event_type == "query_submit",
            UserEvent.created_at >= today_start,
            UserEvent.session_id.in_(db.query(new_visitor_sessions.c.session_id)),
        )
        .scalar() or 0
    )
    # 今日活跃访客 UV / 访问量 PV / 加入志愿表
    active_visitors = db.query(func.count(distinct(UserEvent.session_id))).filter(
        UserEvent.created_at >= today_start, UserEvent.session_id != ""
    ).scalar() or 0
    page_views = db.query(func.count(UserEvent.id)).filter(
        UserEvent.event_type == "page_view", UserEvent.created_at >= today_start
    ).scalar() or 0
    add_form = db.query(func.count(UserEvent.id)).filter(
        UserEvent.event_type == "add_to_form", UserEvent.created_at >= today_start
    ).scalar() or 0

    total_users         = db.query(func.count(User.id)).scalar() or 0
    total_paid          = db.query(func.count(Order.id)).filter(Order.status == "paid").scalar() or 0
    total_revenue_fen   = db.query(func.sum(Order.amount)).filter(Order.status == "paid").scalar() or 0
    total_queries       = db.query(func.count(UserEvent.id)).filter(UserEvent.event_type == "query_submit").scalar() or 0
    export_clicks       = db.query(func.count(UserEvent.id)).filter(UserEvent.event_type == "export_click", UserEvent.created_at >= today_start).scalar() or 0

    # 付费转化率（今日点击解锁 vs 今日付费）
    conv_rate = round(paid_orders / export_clicks * 100, 1) if export_clicks > 0 else 0
    # 平均单价（今日收入 / 今日付费笔数，元）
    avg_price = round((revenue_fen or 0) / 100 / paid_orders, 2) if paid_orders > 0 else 0
    # 新访客 → 查询 转化率
    nv_query_rate = round(new_visitor_queries / new_visitors * 100, 1) if new_visitors > 0 else 0

    # 兼容历史库：部分环境 users 表尚未迁移 wechat_mini_openid 字段
    # 优先按小程序 openid 统计，缺列时回退到 wechat_openid，避免后台接口 500
    try:
        users_mini = db.query(func.count(User.id)).filter(User.wechat_mini_openid.isnot(None)).scalar() or 0
        users_web = db.query(func.count(User.id)).filter(User.wechat_mini_openid.is_(None)).scalar() or 0
    except OperationalError:
        users_mini = db.query(func.count(User.id)).filter(User.wechat_openid.isnot(None)).scalar() or 0
        users_web = db.query(func.count(User.id)).filter(User.wechat_openid.is_(None)).scalar() or 0

    return {
        "today_queries":    queries,
        "today_paid":       paid_orders,
        "today_revenue":    round((revenue_fen or 0) / 100, 2),
        "today_new_users":  new_users,
        "today_export_clicks": export_clicks,
        "today_conv_rate":  conv_rate,
        # 匿名访客（不要求注册）
        "today_new_visitors":         new_visitors,
        "today_new_visitor_queries":  new_visitor_queries,
        "today_nv_query_rate":        nv_query_rate,
        "today_active_visitors":      active_visitors,
        "today_page_views":           page_views,
        "today_add_form":             add_form,
        "today_avg_price":            avg_price,
        "total_users":      total_users,
        "total_paid":       total_paid,
        "total_revenue":    round((total_revenue_fen or 0) / 100, 2),
        "total_queries":    total_queries,
        # 来源分布（小程序 vs 网页）
        "users_mini":       users_mini,
        "users_web":        users_web,
    }


# ── 使用埋点统计：PDF 下载 + AI 提问 ──────────────────────────
@router.get("/stats/usage", dependencies=[Depends(_verify_admin)])
def stats_usage(db: Session = Depends(get_db)):
    """PDF 下载 + AI 提问的概览统计 + 最近明细。"""
    today_start = _bj_today_start()
    week_start = _bj_now().replace(hour=0, minute=0, second=0, microsecond=0) - datetime.timedelta(days=7, hours=8)

    def _count(event_type, since=None):
        q = db.query(func.count(UserEvent.id)).filter(UserEvent.event_type == event_type)
        if since is not None:
            q = q.filter(UserEvent.created_at >= since)
        return q.scalar() or 0

    pdf_total = _count("pdf_download")
    pdf_today = _count("pdf_download", today_start)
    pdf_week = _count("pdf_download", week_start)
    ai_total = _count("ai_chat")
    ai_today = _count("ai_chat", today_start)
    ai_week = _count("ai_chat", week_start)

    # PDF 下载 Top 省份
    pdf_provinces = (
        db.query(UserEvent.province, func.count(UserEvent.id))
        .filter(UserEvent.event_type == "pdf_download", UserEvent.province != "")
        .group_by(UserEvent.province)
        .order_by(func.count(UserEvent.id).desc())
        .limit(10)
        .all()
    )

    def _user_label(uid):
        if not uid:
            return ""
        u = db.query(User).filter(User.id == uid).first()
        if not u:
            return f"#{uid}"
        return u.phone or u.nickname or f"#{uid}"

    recent_pdf = (
        db.query(UserEvent)
        .filter(UserEvent.event_type == "pdf_download")
        .order_by(UserEvent.created_at.desc())
        .limit(50)
        .all()
    )
    recent_ai = (
        db.query(UserEvent)
        .filter(UserEvent.event_type == "ai_chat")
        .order_by(UserEvent.created_at.desc())
        .limit(50)
        .all()
    )

    def _pdf_row(e):
        try:
            data = json.loads(e.event_data or "{}")
        except Exception:
            data = {}
        return {
            "id": e.id,
            "user_id": e.user_id,
            "user_label": _user_label(e.user_id),
            "province": e.province or "",
            "rank_input": e.rank_input,
            "subject": e.subject or "",
            "exam_mode": e.exam_mode or "",
            "c_major": e.c_major or "",
            "c_city": e.c_city or "",
            "c_nature": e.c_nature or "",
            "c_tier": e.c_tier or "",
            "discipline_filter": data.get("discipline_filter", ""),
            "score": data.get("score"),
            "part": data.get("part"),
            "source": data.get("source", ""),
            "created_at": e.created_at.strftime("%Y-%m-%d %H:%M:%S") if e.created_at else "",
        }

    def _ai_row(e):
        try:
            data = json.loads(e.event_data or "{}")
        except Exception:
            data = {}
        return {
            "id": e.id,
            "user_id": e.user_id,
            "user_label": _user_label(e.user_id),
            "question": data.get("question", ""),
            "province": e.province or "",
            "subject": e.subject or "",
            "rank": data.get("rank", ""),
            "score": data.get("score", ""),
            "created_at": e.created_at.strftime("%Y-%m-%d %H:%M:%S") if e.created_at else "",
        }

    return {
        "pdf": {"total": pdf_total, "today": pdf_today, "week": pdf_week},
        "ai":  {"total": ai_total, "today": ai_today, "week": ai_week},
        "pdf_provinces": [{"province": p or "未知", "count": c} for p, c in pdf_provinces],
        "recent_pdf": [_pdf_row(e) for e in recent_pdf],
        "recent_ai": [_ai_row(e) for e in recent_ai],
    }


# ── 近30天趋势折线 ─────────────────────────────────────────────
@router.get("/stats/chart", dependencies=[Depends(_verify_admin)])
def stats_chart(days_back: int = Query(30, ge=7, le=90), db: Session = Depends(get_db)):
    """近N天每日：查询量、付费量、新用户、收入（按北京时间聚合）"""
    since = _bj_now() - datetime.timedelta(days=days_back)
    since = since.replace(hour=0, minute=0, second=0, microsecond=0) - datetime.timedelta(hours=8)

    # 查询量按天聚合（北京时间）
    q_rows = db.query(
        _day_bj(UserEvent.created_at).label("day"),
        func.count(UserEvent.id).label("cnt")
    ).filter(
        UserEvent.event_type == "query_submit",
        UserEvent.created_at >= since,
    ).group_by("day").all()
    q_map = {r.day: r.cnt for r in q_rows}

    # 付费量按天聚合（北京时间）
    p_rows = db.query(
        _day_bj(Order.pay_time).label("day"),
        func.count(Order.id).label("cnt")
    ).filter(
        Order.status == "paid",
        Order.pay_time >= since,
    ).group_by("day").all()
    p_map = {r.day: r.cnt for r in p_rows}

    # 新用户按天聚合（北京时间）
    u_rows = db.query(
        _day_bj(User.created_at).label("day"),
        func.count(User.id).label("cnt")
    ).filter(
        User.created_at >= since,
    ).group_by("day").all()
    u_map = {r.day: r.cnt for r in u_rows}

    # 收入按天聚合（北京时间）
    r_rows = db.query(
        _day_bj(Order.pay_time).label("day"),
        func.sum(Order.amount).label("amt")
    ).filter(
        Order.status == "paid",
        Order.pay_time >= since,
    ).group_by("day").all()
    r_map = {r.day: (r.amt or 0) for r in r_rows}

    result = []
    for i in range(days_back - 1, -1, -1):
        d = _bj_now() - datetime.timedelta(days=i)
        day_str = d.strftime("%Y-%m-%d")
        result.append({
            "date":      d.strftime("%m/%d"),
            "queries":   q_map.get(day_str, 0),
            "paid":      p_map.get(day_str, 0),
            "new_users": u_map.get(day_str, 0),
            "revenue":   round(r_map.get(day_str, 0) / 100, 2),
        })
    return result


# ── 转化漏斗 ─────────────────────────────────────────────────
@router.get("/stats/funnel", dependencies=[Depends(_verify_admin)])
def stats_funnel(days: int = Query(30, ge=1, le=90), db: Session = Depends(get_db)):
    """过去N天的转化漏斗：访问→查询→点击解锁→付费（北京时间）"""
    since = _bj_now() - datetime.timedelta(days=days)
    since = since.replace(hour=0, minute=0, second=0, microsecond=0) - datetime.timedelta(hours=8)

    page_views   = db.query(func.count(UserEvent.id)).filter(UserEvent.event_type == "page_view", UserEvent.created_at >= since).scalar() or 0
    queries      = db.query(func.count(UserEvent.id)).filter(UserEvent.event_type == "query_submit", UserEvent.created_at >= since).scalar() or 0
    export_clicks = db.query(func.count(UserEvent.id)).filter(UserEvent.event_type == "export_click", UserEvent.created_at >= since).scalar() or 0
    paid         = db.query(func.count(Order.id)).filter(Order.status == "paid", Order.pay_time >= since).scalar() or 0

    def pct(a, b): return round(a / b * 100, 1) if b > 0 else 0

    return [
        {"step": "访问首页",   "count": page_views,    "rate": 100},
        {"step": "提交查询",   "count": queries,       "rate": pct(queries, page_views)},
        {"step": "点击解锁",   "count": export_clicks, "rate": pct(export_clicks, queries)},
        {"step": "完成付费",   "count": paid,          "rate": pct(paid, export_clicks)},
    ]


# ── 省份分布 ─────────────────────────────────────────────────
@router.get("/stats/provinces", dependencies=[Depends(_verify_admin)])
def stats_provinces(db: Session = Depends(get_db)):
    rows = db.query(
        UserEvent.province,
        func.count(UserEvent.id).label("cnt")
    ).filter(
        UserEvent.event_type == "query_submit",
        UserEvent.province != "",
        UserEvent.province.isnot(None),
    ).group_by(UserEvent.province).order_by(func.count(UserEvent.id).desc()).limit(10).all()
    return [{"province": r.province, "count": r.cnt} for r in rows]


# ── 位次区间分布 ──────────────────────────────────────────────
@router.get("/stats/rank_distribution", dependencies=[Depends(_verify_admin)])
def stats_rank_distribution(db: Session = Depends(get_db)):
    """用户查询的位次分布，按区间分桶"""
    buckets = [
        ("1万以内",   0,      10000),
        ("1-3万",     10000,  30000),
        ("3-5万",     30000,  50000),
        ("5-10万",    50000,  100000),
        ("10-20万",   100000, 200000),
        ("20万以上",  200000, 9999999),
    ]
    result = []
    for label, lo, hi in buckets:
        cnt = db.query(func.count(UserEvent.id)).filter(
            UserEvent.event_type == "query_submit",
            UserEvent.rank_input >= lo,
            UserEvent.rank_input < hi,
        ).scalar() or 0
        result.append({"range": label, "count": cnt})
    return result


# ── 热门查询学校 TOP20 ────────────────────────────────────────
@router.get("/stats/hot_schools", dependencies=[Depends(_verify_admin)])
def stats_hot_schools(db: Session = Depends(get_db)):
    """被点击最多的学校（school_click 事件）"""
    rows = db.query(
        UserEvent.event_data,
        func.count(UserEvent.id).label("cnt")
    ).filter(
        UserEvent.event_type == "school_click",
    ).group_by(UserEvent.event_data).order_by(func.count(UserEvent.id).desc()).limit(20).all()

    result = []
    for r in rows:
        try:
            data = json.loads(r.event_data or "{}")
            school = data.get("school_name") or data.get("school", r.event_data or "")
        except Exception:
            school = r.event_data or ""
        result.append({"school": school, "clicks": r.cnt})
    return result


# ── 用户需求分析 ─────────────────────────────────────────────
@router.get("/stats/demand", dependencies=[Depends(_verify_admin)])
def stats_demand(db: Session = Depends(get_db)):
    """
    综合分析用户真实需求：
    - 最热门的省份+位次组合
    - 选科偏好
    - 加入志愿表的学校 TOP10（说明用户实际倾向）
    - 最多被对比的学校
    """
    # 省份+位次区间 热力
    province_rank_combos = db.query(
        UserEvent.province,
        UserEvent.rank_input,
        func.count(UserEvent.id).label("cnt")
    ).filter(
        UserEvent.event_type == "query_submit",
        UserEvent.province != "",
        UserEvent.province.isnot(None),
        UserEvent.rank_input.isnot(None),
        UserEvent.rank_input > 0,
    ).group_by(UserEvent.province, UserEvent.rank_input).order_by(func.count(UserEvent.id).desc()).limit(15).all()

    # 选科分布
    subject_rows = db.query(
        UserEvent.event_data,
        func.count(UserEvent.id).label("cnt")
    ).filter(UserEvent.event_type == "query_submit").group_by(UserEvent.event_data).all()

    subject_dist: dict = {}
    for r in subject_rows:
        try:
            data = json.loads(r.event_data or "{}")
            subj = data.get("subject", "未知")
        except Exception:
            subj = "未知"
        subject_dist[subj] = subject_dist.get(subj, 0) + r.cnt

    subject_list = sorted(subject_dist.items(), key=lambda x: -x[1])[:8]

    # 加入志愿表的学校
    form_schools = db.query(
        UserEvent.event_data,
        func.count(UserEvent.id).label("cnt")
    ).filter(UserEvent.event_type == "add_to_form").group_by(UserEvent.event_data).order_by(func.count(UserEvent.id).desc()).limit(10).all()

    form_list = []
    for r in form_schools:
        try:
            data = json.loads(r.event_data or "{}")
            school = data.get("school_name") or data.get("school", r.event_data or "")
        except Exception:
            school = r.event_data or ""
        form_list.append({"school": school, "count": r.cnt})

    # 对比的学校
    compare_schools = db.query(
        UserEvent.event_data,
        func.count(UserEvent.id).label("cnt")
    ).filter(UserEvent.event_type == "compare_add").group_by(UserEvent.event_data).order_by(func.count(UserEvent.id).desc()).limit(10).all()

    compare_list = []
    for r in compare_schools:
        try:
            data = json.loads(r.event_data or "{}")
            school = data.get("school_name") or data.get("school", r.event_data or "")
        except Exception:
            school = r.event_data or ""
        compare_list.append({"school": school, "count": r.cnt})

    return {
        "top_queries": [
            {"province": r.province, "rank": r.rank_input, "count": r.cnt}
            for r in province_rank_combos
        ],
        "subject_distribution": [
            {"subject": s, "count": c} for s, c in subject_list
        ],
        "top_form_schools": form_list,
        "top_compare_schools": compare_list,
    }


# ── 用户行为时间分布 ──────────────────────────────────────────
@router.get("/stats/hourly", dependencies=[Depends(_verify_admin)])
def stats_hourly(db: Session = Depends(get_db)):
    """过去7天每小时查询量（了解用户活跃时段，北京时间）"""
    since = _bj_now() - datetime.timedelta(days=7)
    since = since.replace(hour=0, minute=0, second=0, microsecond=0) - datetime.timedelta(hours=8)
    rows = db.query(UserEvent.created_at).filter(
        UserEvent.event_type == "query_submit",
        UserEvent.created_at >= since,
    ).all()

    hourly = [0] * 24
    for r in rows:
        if r.created_at:
            # 转换为北京时间（UTC+8）
            bj_hour = (r.created_at.hour + 8) % 24
            hourly[bj_hour] += 1

    return [{"hour": f"{h:02d}:00", "count": hourly[h]} for h in range(24)]


# ── 订单列表（含搜索）──────────────────────────────────────────
@router.get("/orders", dependencies=[Depends(_verify_admin)])
def list_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str = Query("", description="pending/paid/refunded 或空=全部"),
    q_search: str = Query("", description="搜索订单号或省份"),
    user_id: int | None = Query(None, description="用户ID"),
    db: Session = Depends(get_db)
):
    q = db.query(Order)
    if status:
        q = q.filter(Order.status == status)
    if user_id is not None:
        q = q.filter(Order.user_id == user_id)
    if q_search:
        q = q.filter(
            Order.order_no.contains(q_search) | Order.province.contains(q_search)
        )
    total = q.count()
    orders = q.order_by(Order.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    tier_map = get_tier_cities_map(db)
    return {
        "total": total,
        "page":  page,
        "items": [{**_order_row(o), "c_city_reduced": reduce_city_filter(o.c_city or "", tier_map)} for o in orders]
    }


def _order_row(o):
    return {
        "order_no":   o.order_no,
        "amount":     round(o.amount / 100, 2),
        "status":     o.status,
        "pay_method": o.pay_method,
        "province":   o.province or "",
        "subject":    o.subject or "",
        "rank_input": o.rank_input,
        "created_at": o.created_at.strftime("%Y-%m-%d %H:%M") if o.created_at else "",
        "pay_time":   o.pay_time.strftime("%Y-%m-%d %H:%M") if o.pay_time else "",
        "user_id":    o.user_id,
        "c_major":    o.c_major or "",
        "c_city":     o.c_city or "",
        "c_nature":   o.c_nature or "",
        "c_tier":     o.c_tier or "",
        "mock_score": o.mock_score or 0,
        "product_type": o.product_type or "",
        "transaction_id": o.transaction_id or "",
        "discipline_filter": o.discipline_filter or "",
        "batch_filter": o.batch_filter or "",
        "exclude_restrictions": o.exclude_restrictions or "",
        "gender_filter": _parse_gender_filter(o.exclude_restrictions or ""),
    }


def _parse_gender_filter(exclude_restrictions: str) -> str:
    if not exclude_restrictions:
        return ""
    parts = exclude_restrictions.split(",")
    for p in parts:
        if p == "gender:female_only":
            return "只招男生"
        elif p == "gender:male_only":
            return "只招女生"
    return ""

# ── 订单导出 CSV ─────────────────────────────────────────────
@router.get("/export/orders", dependencies=[Depends(_verify_admin)])
def export_orders_csv(status: str = Query(""), db: Session = Depends(get_db)):
    q = db.query(Order)
    if status:
        q = q.filter(Order.status == status)
    orders = q.order_by(Order.created_at.desc()).limit(5000).all()

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["订单号", "金额(元)", "状态", "支付方式", "省份", "选科", "位次", "用户ID", "创建时间", "支付时间", "筛选专业", "筛选城市", "筛选城市(归一)", "筛选性质", "筛选档次", "高考分数", "性别筛选"])
    tier_map = get_tier_cities_map(db)
    for o in orders:
        w.writerow([
            o.order_no, round(o.amount/100, 2), o.status, o.pay_method,
            o.province or "", o.subject or "", o.rank_input, o.user_id,
            o.created_at.strftime("%Y-%m-%d %H:%M") if o.created_at else "",
            o.pay_time.strftime("%Y-%m-%d %H:%M") if o.pay_time else "",
            o.c_major or "", o.c_city or "", reduce_city_filter(o.c_city or "", tier_map), o.c_nature or "", o.c_tier or "",
            o.mock_score or "", _parse_gender_filter(o.exclude_restrictions or ""),
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=orders_{datetime.date.today()}.csv"}
    )


# ── 用户列表（含搜索）──────────────────────────────────────────
@router.get("/users", dependencies=[Depends(_verify_admin)])
def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    paid_only: bool = Query(False),
    q_search: str = Query("", description="按手机号或省份搜索"),
    db: Session = Depends(get_db)
):
    q = db.query(User)
    if paid_only:
        q = q.filter(User.is_paid == 1)
    if q_search:
        from sqlalchemy import or_
        try:
            search_id = int(q_search)
            q = q.filter(
                or_(User.id == search_id, User.phone.contains(q_search), User.province.contains(q_search))
            )
        except ValueError:
            q = q.filter(
                User.phone.contains(q_search) | User.province.contains(q_search)
            )
    total = q.count()
    users = q.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    user_ids = [u.id for u in users]
    paid_map = {}
    for o in db.query(Order).filter(Order.user_id.in_(user_ids), Order.status == "paid").all():
        paid_map[o.user_id] = paid_map.get(o.user_id, 0) + 1

    query_map = {}
    for row in db.query(UserEvent.user_id, func.count(UserEvent.id).label("cnt")).filter(
        UserEvent.user_id.in_(user_ids), UserEvent.event_type == "query_submit"
    ).group_by(UserEvent.user_id).all():
        query_map[row.user_id] = row.cnt

    return {
        "total": total,
        "page":  page,
        "items": [_user_row(u, paid_map, query_map) for u in users]
    }


# ── 事件/查询记录列表（含丰富过滤）──────────────────────────────
@router.get("/events", dependencies=[Depends(_verify_admin)])
def list_events(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    user_id: int = Query(None),
    phone: str = Query(""),
    wechat_openid: str = Query(""),
    wechat_mini_openid: str = Query(""),
    province: str = Query(""),
    event_type: str = Query(""),
    rank_min: int = Query(None),
    rank_max: int = Query(None),
    date_from: str = Query(""),
    date_to: str = Query(""),
    subject: str = Query(""),
    exam_mode: str = Query(""),
    c_major: str = Query(""),
    c_city: str = Query(""),
    c_nature: str = Query(""),
    c_tier: str = Query(""),
    db: Session = Depends(get_db)
):
    """查询/事件记录列表，支持用户、省份、位次区间、时间范围等多维度过滤"""
    from sqlalchemy import or_
    q = db.query(UserEvent).outerjoin(User, UserEvent.user_id == User.id)

    if user_id:
        q = q.filter(UserEvent.user_id == user_id)
    if phone:
        q = q.filter(User.phone.contains(phone))
    if wechat_openid:
        q = q.filter(User.wechat_openid.contains(wechat_openid))
    if wechat_mini_openid:
        q = q.filter(User.wechat_mini_openid.contains(wechat_mini_openid))
    if province:
        q = q.filter(UserEvent.province == province)
    if event_type:
        q = q.filter(UserEvent.event_type == event_type)
    if rank_min is not None:
        q = q.filter(UserEvent.rank_input >= rank_min)
    if rank_max is not None:
        q = q.filter(UserEvent.rank_input <= rank_max)
    if date_from:
        try:
            dt_from = datetime.datetime.strptime(date_from, "%Y-%m-%d")
            q = q.filter(UserEvent.created_at >= dt_from)
        except ValueError:
            pass
    if date_to:
        try:
            dt_to = datetime.datetime.strptime(date_to, "%Y-%m-%d") + datetime.timedelta(days=1)
            q = q.filter(UserEvent.created_at < dt_to)
        except ValueError:
            pass
    if subject:
        q = q.filter(UserEvent.subject == subject)
    if exam_mode:
        q = q.filter(UserEvent.exam_mode == exam_mode)
    if c_major:
        q = q.filter(UserEvent.c_major.contains(c_major))
    if c_city:
        q = q.filter(UserEvent.c_city.contains(c_city))
    if c_nature:
        q = q.filter(UserEvent.c_nature.contains(c_nature))
    if c_tier:
        q = q.filter(UserEvent.c_tier.contains(c_tier))

    total = q.count()
    events = q.order_by(UserEvent.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    # 批量拉取用户基本信息（避免 N+1）
    uids = {e.user_id for e in events if e.user_id}
    user_map = {u.id: u for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}

    tier_map = get_tier_cities_map(db)

    def _event_row(e):
        u = user_map.get(e.user_id)
        try:
            data = json.loads(e.event_data or "{}")
        except Exception:
            data = {}
        c_city_reduced = reduce_city_filter(e.c_city or "", tier_map)
        return {
            "id": e.id,
            "user_id": e.user_id,
            "phone": (u.phone or "") if u else "",
            "wechat_openid": (u.wechat_openid or "") if u else "",
            "wechat_mini_openid": (u.wechat_mini_openid or "") if u else "",
            "user_source": _user_source(u) if u else "",
            "event_type": e.event_type,
            "province": e.province or "",
            "rank_input": e.rank_input,
            "subject": e.subject or "",
            "exam_mode": e.exam_mode or "",
            "c_major": e.c_major or "",
            "c_city": e.c_city or "",
            "c_city_reduced": c_city_reduced,
            "c_nature": e.c_nature or "",
            "c_tier": e.c_tier or "",
            "mock_score": data.get("mock_score"),
            "event_data": e.event_data or "",
            "page": e.page or "",
            "ip": e.ip or "",
            "created_at": e.created_at.strftime("%Y-%m-%d %H:%M:%S") if e.created_at else "",
        }

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_event_row(e) for e in events]
    }


# ── 事件/查询记录导出 CSV ─────────────────────────────────────
@router.get("/export/events", dependencies=[Depends(_verify_admin)])
def export_events_csv(
    user_id: int = Query(None),
    phone: str = Query(""),
    province: str = Query(""),
    event_type: str = Query(""),
    rank_min: int = Query(None),
    rank_max: int = Query(None),
    date_from: str = Query(""),
    date_to: str = Query(""),
    subject: str = Query(""),
    exam_mode: str = Query(""),
    c_major: str = Query(""),
    c_city: str = Query(""),
    c_nature: str = Query(""),
    c_tier: str = Query(""),
    db: Session = Depends(get_db)
):
    """导出查询/事件记录为 CSV（最多 50000 条）"""
    from sqlalchemy import or_
    q = db.query(UserEvent).outerjoin(User, UserEvent.user_id == User.id)

    if user_id:
        q = q.filter(UserEvent.user_id == user_id)
    if phone:
        q = q.filter(User.phone.contains(phone))
    if province:
        q = q.filter(UserEvent.province == province)
    if event_type:
        q = q.filter(UserEvent.event_type == event_type)
    if rank_min is not None:
        q = q.filter(UserEvent.rank_input >= rank_min)
    if rank_max is not None:
        q = q.filter(UserEvent.rank_input <= rank_max)
    if date_from:
        try:
            dt_from = datetime.datetime.strptime(date_from, "%Y-%m-%d")
            q = q.filter(UserEvent.created_at >= dt_from)
        except ValueError:
            pass
    if date_to:
        try:
            dt_to = datetime.datetime.strptime(date_to, "%Y-%m-%d") + datetime.timedelta(days=1)
            q = q.filter(UserEvent.created_at < dt_to)
        except ValueError:
            pass
    if subject:
        q = q.filter(UserEvent.subject == subject)
    if exam_mode:
        q = q.filter(UserEvent.exam_mode == exam_mode)
    if c_major:
        q = q.filter(UserEvent.c_major.contains(c_major))
    if c_city:
        q = q.filter(UserEvent.c_city.contains(c_city))
    if c_nature:
        q = q.filter(UserEvent.c_nature.contains(c_nature))
    if c_tier:
        q = q.filter(UserEvent.c_tier.contains(c_tier))

    events = q.order_by(UserEvent.created_at.desc()).limit(50000).all()

    uids = {e.user_id for e in events if e.user_id}
    user_map = {u.id: u for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["事件ID", "用户ID", "手机号", "微信网页", "微信小程序", "来源", "事件类型", "省份", "位次",
                "选科", "考试模式", "筛选专业", "筛选城市", "筛选性质", "筛选档次",
                "页面", "IP", "事件数据", "创建时间"])
    for e in events:
        u = user_map.get(e.user_id)
        w.writerow([
            e.id,
            e.user_id or "",
            (u.phone or "") if u else "",
            (u.wechat_openid or "") if u else "",
            (u.wechat_mini_openid or "") if u else "",
            _user_source(u) if u else "",
            e.event_type,
            e.province or "",
            e.rank_input or "",
            e.subject or "",
            e.exam_mode or "",
            e.c_major or "",
            e.c_city or "",
            e.c_nature or "",
            e.c_tier or "",
            e.page or "",
            e.ip or "",
            e.event_data or "",
            e.created_at.strftime("%Y-%m-%d %H:%M:%S") if e.created_at else "",
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=events_{datetime.date.today()}.csv"}
    )


def _user_source(u) -> str:
    """判断用户来源类型：手机号 / 微信网页 / 微信小程序 / 组合"""
    has_phone = bool(u.phone)
    has_web = bool(u.wechat_openid)
    has_mini = bool(u.wechat_mini_openid)
    parts = []
    if has_phone:
        parts.append("手机号")
    if has_web:
        parts.append("微信网页")
    if has_mini:
        parts.append("微信小程序")
    return " + ".join(parts) if parts else "未知"


def _user_row(u, paid_map=None, query_map=None):
    paid_map = paid_map or {}
    query_map = query_map or {}
    # Subscription days remaining
    days_remaining = None
    sub_type = getattr(u, "subscription_type", None) or ""
    sub_end = getattr(u, "subscription_end_at", None)
    if sub_end:
        delta = sub_end - datetime.datetime.utcnow()
        days_remaining = max(0, delta.days)
    return {
        "id":                 u.id,
        "phone":              u.phone or "",
        "province":           u.province or "",
        "is_paid":            u.is_paid,
        "subscription_type":  sub_type,
        "subscription_end":   sub_end.strftime("%Y-%m-%d") if sub_end else "",
        "days_remaining":     days_remaining,
        "referred_by":        u.referred_by,
        "referral_code":      u.referral_code or "",
        "paid_orders":        paid_map.get(u.id, 0),
        "query_count":        query_map.get(u.id, 0),
        "wechat":             "已绑定" if u.wechat_openid else "未绑定",
        "user_source":        _user_source(u),
        "created_at":         u.created_at.strftime("%Y-%m-%d %H:%M") if u.created_at else "",
        "last_active":        u.last_active_at.strftime("%Y-%m-%d %H:%M") if u.last_active_at else "",
    }


# ── 用户导出 CSV ─────────────────────────────────────────────
@router.get("/export/users", dependencies=[Depends(_verify_admin)])
def export_users_csv(paid_only: bool = Query(False), db: Session = Depends(get_db)):
    q = db.query(User)
    if paid_only:
        q = q.filter(User.is_paid == 1)
    users = q.order_by(User.created_at.desc()).limit(10000).all()

    user_ids = [u.id for u in users]
    paid_map = {}
    for o in db.query(Order).filter(Order.user_id.in_(user_ids), Order.status == "paid").all():
        paid_map[o.user_id] = paid_map.get(o.user_id, 0) + 1
    query_map = {}
    for row in db.query(UserEvent.user_id, func.count(UserEvent.id).label("cnt")).filter(
        UserEvent.user_id.in_(user_ids), UserEvent.event_type == "query_submit"
    ).group_by(UserEvent.user_id).all():
        query_map[row.user_id] = row.cnt

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["用户ID", "手机号", "省份", "是否付费", "付费订单数", "查询次数", "微信绑定", "注册时间", "最近活跃"])
    for u in users:
        w.writerow([
            u.id, u.phone or "", u.province or "", "是" if u.is_paid else "否",
            paid_map.get(u.id, 0), query_map.get(u.id, 0),
            "是" if u.wechat_openid else "否",
            u.created_at.strftime("%Y-%m-%d %H:%M") if u.created_at else "",
            u.last_active_at.strftime("%Y-%m-%d %H:%M") if u.last_active_at else "",
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=users_{datetime.date.today()}.csv"}
    )


# ── 手动开通/撤销付费权限 ──────────────────────────────────────
SEASON_END = datetime.datetime(2026, 9, 1, 23, 59, 59)


@router.post("/users/{user_id}/grant_paid", dependencies=[Depends(_verify_admin)])
def grant_paid(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    user.is_paid = 1
    user.subscription_type = "season_2026"
    user.subscription_end_at = SEASON_END
    db.commit()
    return {"ok": True, "message": f"已为用户 {user.phone or user_id} 开通 2026 填报季会员（到期 2026-09-01）"}


@router.post("/users/{user_id}/revoke_paid", dependencies=[Depends(_verify_admin)])
def revoke_paid(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    user.is_paid = 0
    user.subscription_type = ""
    user.subscription_end_at = None
    db.commit()
    return {"ok": True, "message": f"已撤销用户 {user.phone or user_id} 的付费权限"}


@router.get("/users/{user_id}/detail", dependencies=[Depends(_verify_admin)])
def user_detail(user_id: int, db: Session = Depends(get_db)):
    """用户详情：基本信息 + 查询记录 + 订单 + 交互记录"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 查询记录
    queries = db.query(UserEvent).filter(
        UserEvent.user_id == user_id,
        UserEvent.event_type == "query_submit"
    ).order_by(UserEvent.created_at.desc()).limit(200).all()

    # 所有订单
    orders = db.query(Order).filter(Order.user_id == user_id).order_by(Order.created_at.desc()).limit(200).all()

    # 交互记录（排除查询，避免重复）
    events = db.query(UserEvent).filter(
        UserEvent.user_id == user_id,
        UserEvent.event_type != "query_submit"
    ).order_by(UserEvent.created_at.desc()).limit(200).all()

    paid_map = {}
    for o in db.query(Order).filter(Order.user_id == user_id, Order.status == "paid").all():
        paid_map[o.user_id] = paid_map.get(o.user_id, 0) + 1

    query_map = {}
    for row in db.query(UserEvent.user_id, func.count(UserEvent.id).label("cnt")).filter(
        UserEvent.user_id == user_id, UserEvent.event_type == "query_submit"
    ).group_by(UserEvent.user_id).all():
        query_map[row.user_id] = row.cnt

    def fmt_dt(dt):
        return dt.strftime("%Y-%m-%d %H:%M:%S") if dt else ""

    return {
        "user": _user_row(user, paid_map, query_map),
        "queries": [
            {
                "id": e.id,
                "province": e.province or "",
                "rank_input": e.rank_input,
                "event_data": e.event_data or "",
                "page": e.page or "",
                "created_at": fmt_dt(e.created_at),
                "ip": e.ip or "",
            }
            for e in queries
        ],
        "orders": [
            {
                "order_no": o.order_no,
                "amount": round(o.amount / 100, 2),
                "status": o.status,
                "pay_method": o.pay_method or "",
                "product_type": o.product_type or "",
                "province": o.province or "",
                "rank_input": o.rank_input,
                "created_at": fmt_dt(o.created_at),
                "pay_time": fmt_dt(o.pay_time),
                "transaction_id": o.transaction_id or "",
            }
            for o in orders
        ],
        "events": [
            {
                "id": e.id,
                "event_type": e.event_type,
                "event_data": e.event_data or "",
                "page": e.page or "",
                "created_at": fmt_dt(e.created_at),
                "ip": e.ip or "",
            }
            for e in events
        ],
    }


@router.post("/orders/{order_no}/refund", dependencies=[Depends(_verify_admin)])
def mark_refunded(order_no: str, db: Session = Depends(get_db)):
    """标记退款：先调微信退款API，成功后再改数据库"""
    order = db.query(Order).filter(Order.order_no == order_no).first()
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    if order.status != "paid":
        raise HTTPException(status_code=400, detail=f"订单状态为 {order.status}，只有已支付订单可退款")

    # ── 调微信支付V3退款API ──────────────────────────────────────
    wechat_refund_ok = False
    wechat_err = ""
    try:
        import uuid as _uuid, time as _time, base64 as _b64
        from cryptography.hazmat.primitives import hashes as _hashes, serialization as _ser
        from cryptography.hazmat.primitives.asymmetric import padding as _pad
        import urllib.request as _ur, urllib.error as _ue

        MCH_ID      = os.getenv("WECHAT_MCH_ID", "")
        CERT_SERIAL = os.getenv("WECHAT_CERT_SERIAL", "")
        KEY_PATH    = os.getenv("WECHAT_PRIVATE_KEY_PATH", "/app/backend/certs/apiclient_key.pem")

        if MCH_ID and os.path.exists(KEY_PATH):
            with open(KEY_PATH, "rb") as _f:
                priv_key = _ser.load_pem_private_key(_f.read(), password=None)

            refund_no = f"RF{order_no}"
            body = json.dumps({
                "out_trade_no":  order_no,
                "out_refund_no": refund_no,
                "reason":        "管理员操作退款",
                "amount": {"refund": order.amount, "total": order.amount, "currency": "CNY"},
            }, ensure_ascii=False)

            url = "https://api.mch.weixin.qq.com/v3/refund/domestic/refunds"
            uri = "/v3/refund/domestic/refunds"
            ts    = str(int(_time.time()))
            nonce = _uuid.uuid4().hex.upper()
            msg   = f"POST\n{uri}\n{ts}\n{nonce}\n{body}\n"
            sig   = _b64.b64encode(priv_key.sign(msg.encode(), _pad.PKCS1v15(), _hashes.SHA256())).decode()
            auth  = (f'WECHATPAY2-SHA256-RSA2048 mchid="{MCH_ID}",'
                     f'serial_no="{CERT_SERIAL}",timestamp="{ts}",'
                     f'nonce_str="{nonce}",signature="{sig}"')

            req = _ur.Request(url, data=body.encode(), method="POST", headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": auth,
                "User-Agent": "YuanXi-Pay/1.0",
            })
            try:
                with _ur.urlopen(req, timeout=15) as r:
                    resp = json.loads(r.read().decode())
                # 微信退款受理成功时返回 status = PROCESSING 或 SUCCESS
                if resp.get("status") in ("SUCCESS", "PROCESSING", "PENDING"):
                    wechat_refund_ok = True
                else:
                    wechat_err = f"微信退款状态异常: {resp.get('status')} / {resp}"
            except _ue.HTTPError as e:
                wechat_err = f"微信退款API [{e.code}]: {e.read().decode()}"
        else:
            # 未配置微信支付（开发环境）— 直接标记退款
            wechat_refund_ok = True
            wechat_err = "未配置微信支付，直接标记退款（开发环境）"
    except Exception as e:
        wechat_err = f"退款异常: {e}"

    if not wechat_refund_ok:
        raise HTTPException(status_code=502, detail=wechat_err)

    # ── 微信退款成功后更新数据库 ──────────────────────────────────
    order.status = "refunded"

    # ━━━ 退款时扣除对应佣金 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if order.commission_fen and order.commission_fen > 0:
        comm = db.query(CommissionRecord).filter(
            CommissionRecord.order_no == order.order_no,
            CommissionRecord.status.in_(["frozen", "available"])
        ).first()
        if comm:
            referrer = db.query(User).filter(User.id == comm.user_id).first()
            if referrer:
                deduct = comm.amount_fen
                # 先扣 pending，不够扣 balance（允许负数）
                from_pending = min(referrer.pending_fen, deduct)
                referrer.pending_fen -= from_pending
                referrer.balance_fen -= (deduct - from_pending)
                referrer.total_earned_fen -= deduct
                logger.info(f"Commission deducted: user {referrer.id} -{deduct} fen for refunded order {order_no}")
            comm.status = "deducted"

    if order.user_id:
        paid_left = db.query(Order).filter(
            Order.user_id == order.user_id,
            Order.status == "paid",
            Order.order_no != order_no
        ).count()
        if paid_left == 0:
            user = db.query(User).filter(User.id == order.user_id).first()
            if user:
                user.is_paid = 0
    db.commit()
    return {"ok": True, "wechat_note": wechat_err or "退款已提交微信"}


# ── 学校转化分析（细粒度漏斗）────────────────────────────────
@router.get("/stats/school_conversion", dependencies=[Depends(_verify_admin)])
def school_conversion(days: int = Query(30), db: Session = Depends(get_db)):
    """
    哪些学校点击最多 vs 实际带来付费转化最多（北京时间）。
    逻辑：school_click事件 → 同session内export_click → 同session付费
    简化版：统计 school_click TOP20，再关联同用户付费情况。
    """
    since = _bj_now() - datetime.timedelta(days=days)
    since = since.replace(hour=0, minute=0, second=0, microsecond=0) - datetime.timedelta(hours=8)

    # 学校点击 TOP20
    click_rows = db.query(
        UserEvent.event_data,
        func.count(UserEvent.id).label("clicks"),
    ).filter(
        UserEvent.event_type == "school_click",
        UserEvent.created_at >= since,
    ).group_by(UserEvent.event_data).order_by(func.count(UserEvent.id).desc()).limit(20).all()

    # 优化：避免 N+1 查询，一次性查出所有点击用户，再一次性查付费用户
    event_data_list = [r.event_data for r in click_rows]
    clicker_rows = db.query(
        UserEvent.event_data,
        UserEvent.user_id,
    ).filter(
        UserEvent.event_type == "school_click",
        UserEvent.event_data.in_(event_data_list),
        UserEvent.created_at >= since,
        UserEvent.user_id.isnot(None),
    ).distinct().all()

    all_user_ids = {r.user_id for r in clicker_rows}
    paid_user_ids = {
        r.user_id for r in db.query(Order.user_id).filter(
            Order.user_id.in_(all_user_ids),
            Order.status == "paid",
        ).distinct().all()
    }

    paid_map: dict = {}
    for r in clicker_rows:
        if r.user_id in paid_user_ids:
            paid_map[r.event_data] = paid_map.get(r.event_data, 0) + 1

    result = []
    for row in click_rows:
        try:
            data = json.loads(row.event_data or "{}")
            school = data.get("school_name") or data.get("school", row.event_data or "未知")
        except Exception:
            school = row.event_data or "未知"
        pc = paid_map.get(row.event_data, 0)
        result.append({
            "school":     school,
            "clicks":     row.clicks,
            "paid_users": pc,
            "conv_rate":  round(pc / row.clicks * 100, 1) if row.clicks > 0 else 0,
        })

    return sorted(result, key=lambda x: -x["paid_users"])


# ── 收入产品拆分 ─────────────────────────────────────────────
@router.get("/stats/revenue_breakdown", dependencies=[Depends(_verify_admin)])
def revenue_breakdown(days: int = Query(30), db: Session = Depends(get_db)):
    """按产品类型拆分收入：单次/月度/季度各贡献多少，含转化数量（北京时间）"""
    since = _bj_now() - datetime.timedelta(days=days)
    since = since.replace(hour=0, minute=0, second=0, microsecond=0) - datetime.timedelta(hours=8)
    from sqlalchemy import case
    rows = (
        db.query(
            Order.product_type,
            func.count(Order.id).label("count"),
            func.sum(Order.amount).label("revenue_fen"),
        )
        .filter(Order.status == "paid", Order.pay_time >= since)
        .group_by(Order.product_type)
        .all()
    )
    label_map = {
        "single_report": "单次报告",
        "report_export": "单次报告",
        "monthly_sub":   "月度会员",
        "quarterly_sub": "季度会员",
    }
    result = []
    for r in rows:
        result.append({
            "product_type": r.product_type,
            "label":        label_map.get(r.product_type, r.product_type),
            "count":        r.count,
            "revenue":      round((r.revenue_fen or 0) / 100, 2),
        })
    return sorted(result, key=lambda x: -x["revenue"])


# ── 推荐分销统计 ─────────────────────────────────────────────
@router.get("/stats/referral", dependencies=[Depends(_verify_admin)])
def referral_stats(db: Session = Depends(get_db)):
    """推荐关系统计：Top推荐人、推荐转化数、奖励天数（优化版）"""
    # 一次性查出所有被推荐用户及其推荐人
    referred_users = db.query(User.id, User.referred_by).filter(
        User.referred_by.isnot(None)
    ).all()

    # 一次性查出所有付费用户ID
    paid_user_ids = {
        r.user_id for r in db.query(Order.user_id).filter(
            Order.status == "paid"
        ).distinct().all()
    }

    referrer_rows: dict = {}
    for uid, rid in referred_users:
        if rid not in referrer_rows:
            referrer_rows[rid] = {"referrals": 0, "paid": 0}
        referrer_rows[rid]["referrals"] += 1
        if uid in paid_user_ids:
            referrer_rows[rid]["paid"] += 1

    # 批量查询推荐人信息
    referrer_ids = list(referrer_rows.keys())
    referrer_map = {
        u.id: u for u in db.query(User).filter(User.id.in_(referrer_ids)).all()
    }

    result = []
    for rid, stats in referrer_rows.items():
        referrer = referrer_map.get(rid)
        if referrer:
            result.append({
                "referrer_id":    rid,
                "phone":          (referrer.phone or "")[:3] + "****" + (referrer.phone or "")[-4:] if referrer.phone else "微信用户",
                "referral_code":  referrer.referral_code or "",
                "referrals":      stats["referrals"],
                "paid_referrals": stats["paid"],
                "conv_rate":      round(stats["paid"] / stats["referrals"] * 100, 1) if stats["referrals"] > 0 else 0,
            })
    return sorted(result, key=lambda x: -x["paid_referrals"])[:50]


# ── 即将到期订阅 ─────────────────────────────────────────────
@router.get("/stats/expiring_soon", dependencies=[Depends(_verify_admin)])
def expiring_soon(days: int = Query(7), db: Session = Depends(get_db)):
    """获取N天内即将到期的订阅用户名单"""
    now = datetime.datetime.utcnow()
    cutoff = now + datetime.timedelta(days=days)
    users = db.query(User).filter(
        User.is_paid == 1,
        User.subscription_end_at.isnot(None),
        User.subscription_end_at <= cutoff,
        User.subscription_end_at > now,
    ).order_by(User.subscription_end_at).all()
    return [
        {
            "user_id":       u.id,
            "phone":         (u.phone or "")[:3] + "****" + (u.phone or "")[-4:] if u.phone else "微信用户",
            "subscription":  u.subscription_type or "",
            "expires":       u.subscription_end_at.strftime("%Y-%m-%d") if u.subscription_end_at else "",
            "days_left":     (u.subscription_end_at - now).days if u.subscription_end_at else 0,
        }
        for u in users
    ]


# ── QR二维码传播统计 ──────────────────────────────────────────
@router.get("/stats/viral", dependencies=[Depends(_verify_admin)])
def viral_stats(db: Session = Depends(get_db)):
    """报告传播数据：总量、Top传播、来源平台分析"""
    total_reports = db.query(ReportLog).count()
    total_scans   = db.query(ReportScan).count()

    # Top 20 传播报告
    top_reports = (
        db.query(ReportLog)
        .filter(ReportLog.scan_count > 0)
        .order_by(ReportLog.scan_count.desc())
        .limit(20).all()
    )

    # 来源平台分析（从referer推断）
    since = _bj_now() - datetime.timedelta(days=30)
    since = since.replace(hour=0, minute=0, second=0, microsecond=0) - datetime.timedelta(hours=8)
    scans = db.query(ReportScan).filter(ReportScan.scanned_at >= since).all()

    platform_map: dict = {}
    for s in scans:
        ref = (s.referer or "").lower()
        if "weixin" in ref or "wx" in ref:
            p = "微信"
        elif "weibo" in ref:
            p = "微博"
        elif "zhihu" in ref:
            p = "知乎"
        elif "baidu" in ref:
            p = "百度"
        elif "douyin" in ref or "tiktok" in ref:
            p = "抖音"
        elif ref == "":
            p = "直接访问/扫码"
        else:
            p = "其他"
        platform_map[p] = platform_map.get(p, 0) + 1

    platform_list = sorted(platform_map.items(), key=lambda x: -x[1])

    # 最近7天每日扫描量（北京时间）
    daily = []
    for i in range(6, -1, -1):
        d = _bj_now() - datetime.timedelta(days=i)
        d_bj_start = d.replace(hour=0, minute=0, second=0, microsecond=0)
        d_start = d_bj_start - datetime.timedelta(hours=8)
        d_end   = d_start + datetime.timedelta(days=1)
        cnt = db.query(func.count(ReportScan.id)).filter(
            ReportScan.scanned_at >= d_start, ReportScan.scanned_at < d_end
        ).scalar() or 0
        daily.append({"date": d.strftime("%m/%d"), "scans": cnt})

    return {
        "total_reports": total_reports,
        "total_scans":   total_scans,
        "daily_scans":   daily,
        "platform_dist": [{"platform": p, "count": c} for p, c in platform_list],
        "top_reports": [
            {
                "report_id":  r.report_id,
                "province":   r.province,
                "rank":       r.rank,
                "scan_count": r.scan_count,
                "created_at": r.created_at.strftime("%Y-%m-%d %H:%M") if r.created_at else "",
            }
            for r in top_reports
        ],
    }


# ── 录取数据批量导入 ────────────────────────────────────────────
class AdmissionRecord(BaseModel):
    school_name: str
    school_code: str
    major_name: str
    province: str
    year: int
    min_score: int
    min_rank: int
    admit_count: int
    batch: str
    subject_req: str
    school_province: str = ""

class ImportRequest(BaseModel):
    records: List[AdmissionRecord]
    delete_existing: bool = False  # if True, delete province+subject_req+years first
    confirm_code: str = ""  # 当 delete_existing=True 时必须提供确认码

@router.post("/import_admission_records", dependencies=[Depends(_verify_admin)])
def import_admission_records(req: ImportRequest, db: Session = Depends(get_db)):
    """批量导入录取数据（用于同步新爬取的省份数据）"""
    import re

    def extract_group(major_name: str) -> str:
        m = re.search(r'\[(\d+)组\]', major_name)
        if m:
            return m.group(1)
        m = re.search(r'(\d+)组', major_name)
        return m.group(1) if m else ''

    if req.delete_existing:
        # 二次确认：防止误操作或 token 泄露导致数据被批量删除
        if req.confirm_code != "DELETE_IMPORT_DATA":
            raise HTTPException(status_code=400, detail="批量删除需要 confirm_code='DELETE_IMPORT_DATA'")
        if not req.records:
            raise HTTPException(status_code=400, detail="delete_existing=True 时 records 不能为空")
        # Group by province+subject_req+year combos to delete
        combos = set((r.province, r.subject_req, r.year) for r in req.records)
        deleted_total = 0
        for prov, subj, yr in combos:
            result = db.execute(text(
                "DELETE FROM admission_records WHERE province=:p AND subject_req=:s AND year=:y"
            ), {"p": prov, "s": subj, "y": yr})
            deleted_total += result.rowcount
        db.commit()
    else:
        deleted_total = 0

    inserted = 0
    for r in req.records:
        major_group = extract_group(r.major_name)
        db.execute(text("""
            INSERT INTO admission_records
            (school_code, school_name, major_name, major_group, province, year,
             batch, subject_req, min_score, min_rank, admit_count, school_province,
             school_nature, is_985, is_211, batch_type)
            VALUES (:code,:name,:major,:group,:prov,:year,:batch,:subj,:score,:rank,:count,:sprov,NULL,0,0,NULL)
        """), {
            "code": r.school_code, "name": r.school_name, "major": r.major_name,
            "group": major_group, "prov": r.province, "year": r.year,
            "batch": r.batch, "subj": r.subject_req,
            "score": r.min_score, "rank": r.min_rank, "count": r.admit_count,
            "sprov": r.school_province,
        })
        inserted += 1

    db.commit()
    return {"ok": True, "deleted": deleted_total, "inserted": inserted}


# ── 算法洞察（行为反馈 → 算法校准）─────────────────────────────
@router.get("/insights", dependencies=[Depends(_verify_admin)])
def get_insights(db: Session = Depends(get_db)):
    """算法洞察：用户真实行为反馈，验证推荐质量"""

    total_queries = db.query(func.count(UserEvent.id)).filter(
        UserEvent.event_type == "query_submit"
    ).scalar() or 0

    total_clicks = db.query(func.count(UserEvent.id)).filter(
        UserEvent.event_type == "school_click"
    ).scalar() or 0

    total_adds = db.query(func.count(UserEvent.id)).filter(
        UserEvent.event_type == "add_to_form"
    ).scalar() or 0

    # ── 用户真实加入志愿表 TOP10（最强决策信号）──────────────────
    add_rows = db.execute(text("""
        SELECT json_extract(event_data, '$.school_name') AS school,
               COUNT(*) AS add_count
        FROM user_events
        WHERE event_type = 'add_to_form'
          AND event_data IS NOT NULL
          AND json_extract(event_data, '$.school_name') IS NOT NULL
        GROUP BY school
        ORDER BY add_count DESC
        LIMIT 10
    """)).fetchall()

    # ── 多次点击但未加志愿表（犹豫信号）────────────────────────
    hesitation_rows = db.execute(text("""
        SELECT json_extract(event_data, '$.school_name') AS school,
               COUNT(*) AS clicks
        FROM user_events
        WHERE event_type = 'school_click'
          AND event_data IS NOT NULL
          AND json_extract(event_data, '$.school_name') IS NOT NULL
        GROUP BY school
        HAVING school NOT IN (
            SELECT DISTINCT json_extract(event_data, '$.school_name')
            FROM user_events
            WHERE event_type = 'add_to_form'
              AND event_data IS NOT NULL
        )
        ORDER BY clicks DESC
        LIMIT 10
    """)).fetchall()

    # ── 群体智能校准数据密度（省份×位次段）──────────────────────
    calibration_rows = db.execute(text("""
        SELECT province,
               CASE
                   WHEN rank_input < 1000  THEN '0–1000'
                   WHEN rank_input < 5000  THEN '1000–5000'
                   WHEN rank_input < 20000 THEN '5000–2万'
                   WHEN rank_input < 50000 THEN '2万–5万'
                   ELSE '5万+'
               END AS rank_bucket,
               COUNT(*) AS sample_count
        FROM user_events
        WHERE event_type = 'query_submit'
          AND province IS NOT NULL
          AND rank_input IS NOT NULL
          AND rank_input > 0
        GROUP BY province, rank_bucket
        ORDER BY sample_count DESC
        LIMIT 20
    """)).fetchall()

    return {
        "overview": {
            "total_queries":   total_queries,
            "total_clicks":    total_clicks,
            "total_adds":      total_adds,
            "llm_cache_count": 0,
            "data_quality_note": (
                "数据基于用户真实行为实时计算。"
                f"加入志愿表/点击比 = {round(total_adds/total_clicks*100,1) if total_clicks else 0}%，"
                "反映推荐结果与用户真实意向的匹配度。"
            ),
        },
        "top_added_schools": [
            {"school": r[0], "add_count": r[1]} for r in add_rows if r[0]
        ],
        "hesitation_schools": [
            {"school": r[0], "clicks": r[1]} for r in hesitation_rows if r[0]
        ],
        "calibration_readiness": [
            {
                "province":          r[0],
                "rank_bucket":       r[1],
                "sample_count":      r[2],
                "calibration_ready": r[2] >= 8,
                "status": "可校准" if r[2] >= 8 else f"积累中({r[2]}/8)",
            }
            for r in calibration_rows
        ],
    }


# ── 用户反馈 ──────────────────────────────────────────────────
@router.get("/feedbacks", dependencies=[Depends(_verify_admin)])
def list_feedbacks(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    total = db.query(func.count(Feedback.id)).scalar() or 0
    items = (
        db.query(Feedback)
        .order_by(Feedback.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": i.id,
                "user_id": i.user_id,
                "content": i.content,
                "contact": i.contact,
                "ip": i.ip,
                "created_at": i.created_at.strftime("%Y-%m-%d %H:%M:%S") if i.created_at else "",
            }
            for i in items
        ],
    }


# ── 佣金管理 ────────────────────────────────────────────────────
@router.get("/commissions", dependencies=[Depends(_verify_admin)])
def list_commissions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str = Query("", description="frozen/available/deducted 或空=全部"),
    q: str = Query("", description="订单号或用户ID"),
    db: Session = Depends(get_db),
):
    query = db.query(CommissionRecord)
    if status:
        query = query.filter(CommissionRecord.status == status)
    if q:
        query = query.filter(
            (CommissionRecord.order_no.ilike(f"%{q}%")) |
            (CommissionRecord.user_id == int(q) if q.isdigit() else False)
        )
    total = query.count()
    items = query.order_by(CommissionRecord.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": r.id,
                "user_id": r.user_id,
                "order_no": r.order_no,
                "amount_fen": r.amount_fen,
                "amount_yuan": round(r.amount_fen / 100, 2),
                "status": r.status,
                "freeze_until": r.freeze_until.strftime("%Y-%m-%d %H:%M:%S") if r.freeze_until else "",
                "source": r.source,
                "created_at": r.created_at.strftime("%Y-%m-%d %H:%M:%S") if r.created_at else "",
            }
            for r in items
        ],
    }


@router.get("/withdrawals", dependencies=[Depends(_verify_admin)])
def list_withdrawals(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str = Query("", description="pending/paid/rejected 或空=全部"),
    q: str = Query("", description="用户ID"),
    db: Session = Depends(get_db),
):
    query = db.query(WithdrawalRecord)
    if status:
        query = query.filter(WithdrawalRecord.status == status)
    if q:
        query = query.filter(WithdrawalRecord.user_id == int(q)) if q.isdigit() else query
    total = query.count()
    items = query.order_by(WithdrawalRecord.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": r.id,
                "user_id": r.user_id,
                "amount_fen": r.amount_fen,
                "amount_yuan": round(r.amount_fen / 100, 2),
                "status": r.status,
                "admin_note": r.admin_note,
                "wechat_id": r.wechat_id,
                "created_at": r.created_at.strftime("%Y-%m-%d %H:%M:%S") if r.created_at else "",
                "processed_at": r.processed_at.strftime("%Y-%m-%d %H:%M:%S") if r.processed_at else "",
            }
            for r in items
        ],
    }


@router.post("/withdrawals/{withdrawal_id}/approve", dependencies=[Depends(_verify_admin)])
def approve_withdrawal(
    withdrawal_id: int,
    wechat_id: str = Query("", description="客服微信号（给用户展示）"),
    db: Session = Depends(get_db),
):
    rec = db.query(WithdrawalRecord).filter(WithdrawalRecord.id == withdrawal_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="提现记录不存在")
    if rec.status != "pending":
        raise HTTPException(status_code=400, detail=f"当前状态为 {rec.status}，无法审核通过")
    rec.status = "paid"
    rec.processed_at = datetime.datetime.utcnow()
    if wechat_id:
        rec.wechat_id = wechat_id
    db.commit()
    return {"ok": True}


@router.post("/withdrawals/{withdrawal_id}/reject", dependencies=[Depends(_verify_admin)])
def reject_withdrawal(
    withdrawal_id: int,
    note: str = Query("", description="拒绝原因"),
    db: Session = Depends(get_db),
):
    rec = db.query(WithdrawalRecord).filter(WithdrawalRecord.id == withdrawal_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="提现记录不存在")
    if rec.status != "pending":
        raise HTTPException(status_code=400, detail=f"当前状态为 {rec.status}，无法拒绝")
    # 退回余额
    user = db.query(User).filter(User.id == rec.user_id).first()
    if user:
        user.balance_fen += rec.amount_fen
    rec.status = "rejected"
    rec.admin_note = note
    rec.processed_at = datetime.datetime.utcnow()
    db.commit()
    return {"ok": True}


@router.get("/stats/commission", dependencies=[Depends(_verify_admin)])
def commission_stats(db: Session = Depends(get_db)):
    total_granted = db.query(func.sum(CommissionRecord.amount_fen)).filter(
        CommissionRecord.status.in_(["frozen", "available"])
    ).scalar() or 0
    total_deducted = db.query(func.sum(CommissionRecord.amount_fen)).filter(
        CommissionRecord.status == "deducted"
    ).scalar() or 0
    total_withdrawn = db.query(func.sum(WithdrawalRecord.amount_fen)).filter(
        WithdrawalRecord.status == "paid"
    ).scalar() or 0
    pending_withdrawals = db.query(func.count(WithdrawalRecord.id)).filter(
        WithdrawalRecord.status == "pending"
    ).scalar() or 0
    frozen_total = db.query(func.sum(CommissionRecord.amount_fen)).filter(
        CommissionRecord.status == "frozen"
    ).scalar() or 0
    available_total = db.query(func.sum(CommissionRecord.amount_fen)).filter(
        CommissionRecord.status == "available"
    ).scalar() or 0
    return {
        "total_granted_yuan": round(total_granted / 100, 2),
        "total_deducted_yuan": round(total_deducted / 100, 2),
        "total_withdrawn_yuan": round(total_withdrawn / 100, 2),
        "frozen_yuan": round(frozen_total / 100, 2),
        "available_yuan": round(available_total / 100, 2),
        "pending_withdrawals": pending_withdrawals,
    }
