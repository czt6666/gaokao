"""管理后台 API — /api/admin/* （X-Admin-Token 鉴权）"""
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from typing import List, Optional
import datetime, os, json, csv, io
from pydantic import BaseModel

from database import get_db, User, Order, UserEvent, ReportLog, ReportScan, Feedback

router = APIRouter(prefix="/api/admin", tags=["admin"])

ADMIN_TOKEN = os.getenv("ADMIN_TOKEN")
if not ADMIN_TOKEN:
    raise RuntimeError("环境变量 ADMIN_TOKEN 未设置，无法启动服务")


def _verify_admin(x_admin_token: str = Header(...)):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid admin token")


# ── 今日概览 ──────────────────────────────────────────────────
@router.get("/stats/today", dependencies=[Depends(_verify_admin)])
def stats_today(db: Session = Depends(get_db)):
    today_start = datetime.datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    queries      = db.query(func.count(UserEvent.id)).filter(UserEvent.event_type == "query_submit", UserEvent.created_at >= today_start).scalar() or 0
    paid_orders  = db.query(func.count(Order.id)).filter(Order.status == "paid", Order.pay_time >= today_start).scalar() or 0
    revenue_fen  = db.query(func.sum(Order.amount)).filter(Order.status == "paid", Order.pay_time >= today_start).scalar() or 0
    new_users    = db.query(func.count(User.id)).filter(User.created_at >= today_start).scalar() or 0

    total_users         = db.query(func.count(User.id)).scalar() or 0
    total_paid          = db.query(func.count(Order.id)).filter(Order.status == "paid").scalar() or 0
    total_revenue_fen   = db.query(func.sum(Order.amount)).filter(Order.status == "paid").scalar() or 0
    total_queries       = db.query(func.count(UserEvent.id)).filter(UserEvent.event_type == "query_submit").scalar() or 0
    export_clicks       = db.query(func.count(UserEvent.id)).filter(UserEvent.event_type == "export_click", UserEvent.created_at >= today_start).scalar() or 0

    # 付费转化率（今日点击解锁 vs 今日付费）
    conv_rate = round(paid_orders / export_clicks * 100, 1) if export_clicks > 0 else 0

    return {
        "today_queries":    queries,
        "today_paid":       paid_orders,
        "today_revenue":    round((revenue_fen or 0) / 100, 2),
        "today_new_users":  new_users,
        "today_export_clicks": export_clicks,
        "today_conv_rate":  conv_rate,
        "total_users":      total_users,
        "total_paid":       total_paid,
        "total_revenue":    round((total_revenue_fen or 0) / 100, 2),
        "total_queries":    total_queries,
        # 来源分布（小程序 vs 网页）
        "users_mini":       db.query(func.count(User.id)).filter(User.wechat_mini_openid.isnot(None)).scalar() or 0,
        "users_web":        (db.query(func.count(User.id)).filter(User.wechat_mini_openid.is_(None)).scalar() or 0),
    }


# ── 近30天趋势折线 ─────────────────────────────────────────────
@router.get("/stats/chart", dependencies=[Depends(_verify_admin)])
def stats_chart(days_back: int = Query(30, ge=7, le=90), db: Session = Depends(get_db)):
    """近N天每日：查询量、付费量、新用户、收入"""
    result = []
    for i in range(days_back - 1, -1, -1):
        d = datetime.datetime.utcnow() - datetime.timedelta(days=i)
        d_start = d.replace(hour=0, minute=0, second=0, microsecond=0)
        d_end   = d_start + datetime.timedelta(days=1)

        queries = db.query(func.count(UserEvent.id)).filter(
            UserEvent.event_type == "query_submit",
            UserEvent.created_at >= d_start, UserEvent.created_at < d_end,
        ).scalar() or 0

        paid = db.query(func.count(Order.id)).filter(
            Order.status == "paid",
            Order.pay_time >= d_start, Order.pay_time < d_end,
        ).scalar() or 0

        new_users = db.query(func.count(User.id)).filter(
            User.created_at >= d_start, User.created_at < d_end,
        ).scalar() or 0

        revenue_fen = db.query(func.sum(Order.amount)).filter(
            Order.status == "paid",
            Order.pay_time >= d_start, Order.pay_time < d_end,
        ).scalar() or 0

        result.append({
            "date":      d.strftime("%m/%d"),
            "queries":   queries,
            "paid":      paid,
            "new_users": new_users,
            "revenue":   round((revenue_fen or 0) / 100, 2),
        })
    return result


# ── 转化漏斗 ─────────────────────────────────────────────────
@router.get("/stats/funnel", dependencies=[Depends(_verify_admin)])
def stats_funnel(days: int = Query(30, ge=1, le=90), db: Session = Depends(get_db)):
    """过去N天的转化漏斗：访问→查询→点击解锁→付费"""
    since = datetime.datetime.utcnow() - datetime.timedelta(days=days)

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
            school = data.get("school_name", r.event_data or "")
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
            school = data.get("school_name", r.event_data or "")
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
            school = data.get("school_name", r.event_data or "")
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
    """过去7天每小时查询量（了解用户活跃时段）"""
    since = datetime.datetime.utcnow() - datetime.timedelta(days=7)
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
    db: Session = Depends(get_db)
):
    q = db.query(Order)
    if status:
        q = q.filter(Order.status == status)
    if q_search:
        q = q.filter(
            Order.order_no.contains(q_search) | Order.province.contains(q_search)
        )
    total = q.count()
    orders = q.order_by(Order.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "total": total,
        "page":  page,
        "items": [_order_row(o) for o in orders]
    }


def _order_row(o):
    return {
        "order_no":   o.order_no,
        "amount":     round(o.amount / 100, 2),
        "status":     o.status,
        "pay_method": o.pay_method,
        "province":   o.province,
        "rank_input": o.rank_input,
        "created_at": o.created_at.strftime("%Y-%m-%d %H:%M") if o.created_at else "",
        "pay_time":   o.pay_time.strftime("%Y-%m-%d %H:%M") if o.pay_time else "",
        "user_id":    o.user_id,
    }


# ── 订单导出 CSV ─────────────────────────────────────────────
@router.get("/export/orders", dependencies=[Depends(_verify_admin)])
def export_orders_csv(status: str = Query(""), db: Session = Depends(get_db)):
    q = db.query(Order)
    if status:
        q = q.filter(Order.status == status)
    orders = q.order_by(Order.created_at.desc()).limit(5000).all()

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["订单号", "金额(元)", "状态", "支付方式", "省份", "位次", "用户ID", "创建时间", "支付时间"])
    for o in orders:
        w.writerow([
            o.order_no, round(o.amount/100, 2), o.status, o.pay_method,
            o.province, o.rank_input, o.user_id,
            o.created_at.strftime("%Y-%m-%d %H:%M") if o.created_at else "",
            o.pay_time.strftime("%Y-%m-%d %H:%M") if o.pay_time else "",
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
@router.post("/users/{user_id}/grant_paid", dependencies=[Depends(_verify_admin)])
def grant_paid(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    user.is_paid = 1
    db.commit()
    return {"ok": True, "message": f"已为用户 {user.phone or user_id} 开通付费权限"}


@router.post("/users/{user_id}/revoke_paid", dependencies=[Depends(_verify_admin)])
def revoke_paid(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    user.is_paid = 0
    db.commit()
    return {"ok": True, "message": f"已撤销用户 {user.phone or user_id} 的付费权限"}


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
    哪些学校点击最多 vs 实际带来付费转化最多。
    逻辑：school_click事件 → 同session内export_click → 同session付费
    简化版：统计 school_click TOP20，再关联同用户付费情况。
    """
    since = datetime.datetime.utcnow() - datetime.timedelta(days=days)

    # 学校点击 TOP20
    click_rows = db.query(
        UserEvent.event_data,
        func.count(UserEvent.id).label("clicks"),
    ).filter(
        UserEvent.event_type == "school_click",
        UserEvent.created_at >= since,
    ).group_by(UserEvent.event_data).order_by(func.count(UserEvent.id).desc()).limit(20).all()

    result = []
    for row in click_rows:
        try:
            data = json.loads(row.event_data or "{}")
            school = data.get("school_name", "未知")
        except Exception:
            school = row.event_data or "未知"

        # 点击该学校的用户中，有多少后来付费了
        clicker_ids = db.query(UserEvent.user_id).filter(
            UserEvent.event_type == "school_click",
            UserEvent.event_data == row.event_data,
            UserEvent.user_id.isnot(None),
            UserEvent.created_at >= since,
        ).distinct().subquery()

        paid_count = db.query(func.count(Order.id)).filter(
            Order.user_id.in_(clicker_ids),
            Order.status == "paid",
        ).scalar() or 0

        result.append({
            "school":     school,
            "clicks":     row.clicks,
            "paid_users": paid_count,
            "conv_rate":  round(paid_count / row.clicks * 100, 1) if row.clicks > 0 else 0,
        })

    return sorted(result, key=lambda x: -x["paid_users"])


# ── 收入产品拆分 ─────────────────────────────────────────────
@router.get("/stats/revenue_breakdown", dependencies=[Depends(_verify_admin)])
def revenue_breakdown(days: int = Query(30), db: Session = Depends(get_db)):
    """按产品类型拆分收入：单次/月度/季度各贡献多少，含转化数量"""
    since = datetime.datetime.utcnow() - datetime.timedelta(days=days)
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
    """推荐关系统计：Top推荐人、推荐转化数、奖励天数"""
    # 找到有被推荐用户的推荐人
    referrers = (
        db.query(User.id, User.phone, User.referral_code, func.count(User.id.label("c")))
        .filter(User.referred_by.isnot(None))
        .all()
    )
    # 统计每个推荐人带来的注册数和付费数
    referrer_rows = {}
    referred_users = db.query(User).filter(User.referred_by.isnot(None)).all()
    for u in referred_users:
        rid = u.referred_by
        if rid not in referrer_rows:
            referrer_rows[rid] = {"referrals": 0, "paid": 0}
        referrer_rows[rid]["referrals"] += 1
        # 检查被推荐人是否已付费
        paid = db.query(Order).filter(Order.user_id == u.id, Order.status == "paid").count()
        if paid > 0:
            referrer_rows[rid]["paid"] += 1

    result = []
    for rid, stats in referrer_rows.items():
        referrer = db.query(User).filter(User.id == rid).first()
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
    since = datetime.datetime.utcnow() - datetime.timedelta(days=30)
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

    # 最近7天每日扫描量
    daily = []
    for i in range(6, -1, -1):
        d = datetime.datetime.utcnow() - datetime.timedelta(days=i)
        d_start = d.replace(hour=0, minute=0, second=0, microsecond=0)
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
                "content": i.content,
                "contact": i.contact,
                "ip": i.ip,
                "created_at": i.created_at.strftime("%Y-%m-%d %H:%M:%S") if i.created_at else "",
            }
            for i in items
        ],
    }
