"""支付路由 — 微信支付V3 Native + 支付宝直连"""
from fastapi import APIRouter, HTTPException, Request, Depends, BackgroundTasks
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
import uuid, time, datetime, json, os, base64, hashlib, hmac
from database import get_db, Order, User, SessionLocal
# User 已导入 — JSAPI 端点需要查找小程序用户
from routers.auth import _verify_token
from services.email_service import send_payment_notification
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/payment", tags=["payment"])

# 产品定价表（分）
PRODUCT_AMOUNTS: dict[str, int] = {
    "single_report":  199,   # ¥1.99 — 单次报告解锁
    # 以下为向后兼容旧订单，不再对外销售
    "report_export":  590,
    "monthly_sub":    990,
    "quarterly_sub": 2990,
}
AMOUNT_FEN = 199  # 默认兜底 ¥1.99

# ── 微信支付 V3 配置（从环境变量读取）──
WECHAT_MCH_ID       = os.getenv("WECHAT_MCH_ID", "")
WECHAT_MINI_APP_ID       = os.getenv("WECHAT_MINI_APP_ID", "")
WECHAT_SERVICE_APP_ID     = os.getenv("WECHAT_SERVICE_APP_ID", "")       # 服务号 AppID（公众号 JSAPI/H5）
WECHAT_SERVICE_APP_SECRET = os.getenv("WECHAT_SERVICE_APP_SECRET", "")   # 服务号 AppSecret（OAuth2 换 openid）
WECHAT_API_V3_KEY   = os.getenv("WECHAT_API_V3_KEY", "")   # 32位
WECHAT_CERT_SERIAL  = os.getenv("WECHAT_CERT_SERIAL", "")  # 证书序列号
WECHAT_PRIVATE_KEY  = os.getenv("WECHAT_PRIVATE_KEY_PATH", "/app/backend/certs/apiclient_key.pem")
NOTIFY_URL          = os.getenv("WECHAT_NOTIFY_URL", "https://www.theyuanxi.cn/api/payment/wechat/notify")


def _get_client_ip(request: Request) -> str:
    """从请求头解析用户真实 IP（H5 支付必需，反代下 request.client.host 是代理 IP）"""
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    xri = request.headers.get("X-Real-IP", "")
    if xri:
        return xri.strip()
    return request.client.host if request.client else ""

# ── 支付宝配置（预留）──
ALIPAY_APP_ID        = os.getenv("ALIPAY_APP_ID", "")
ALIPAY_PRIVATE_KEY   = os.getenv("ALIPAY_PRIVATE_KEY", "")
ALIPAY_PUBLIC_KEY    = os.getenv("ALIPAY_PUBLIC_KEY", "")


class CreateOrderRequest(BaseModel):
    product_type: str = "season_2026"
    pay_method: str = "wechat"   # wechat | alipay
    province: str = ""
    rank_input: int = 0
    subject: str = ""            # 选科，如"物理+化学"，绑定单次查询


@router.post("/create")
async def create_order(req: CreateOrderRequest, request: Request, db: Session = Depends(get_db)):
    """创建订单，返回微信支付二维码链接"""
    # 从 JWT 解析用户（访客也可支付）
    user_id = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        payload = _verify_token(auth.replace("Bearer ", ""))
        if payload:
            user_id = payload.get("uid")

    amount_fen = PRODUCT_AMOUNTS.get(req.product_type, AMOUNT_FEN)

    order_no = f"GK{int(time.time())}{uuid.uuid4().hex[:6].upper()}"
    order = Order(
        order_no=order_no,
        user_id=user_id,
        amount=amount_fen,
        product_type=req.product_type,
        pay_method=req.pay_method,
        province=req.province,
        rank_input=req.rank_input or None,
        subject=req.subject,
        ip=request.client.host if request.client else "",
    )
    db.add(order)
    db.commit()

    qr_code = None
    error_msg = None

    if req.pay_method == "wechat":
        if WECHAT_MCH_ID and WECHAT_MINI_APP_ID and WECHAT_API_V3_KEY:
            try:
                qr_code = await _wechat_create_native(order_no, req.province, req.rank_input, amount_fen)
            except Exception as e:
                logger.error(f"WeChat Pay create failed: {e}", exc_info=True)
                error_msg = str(e)
        else:
            error_msg = "微信支付未配置"
    elif req.pay_method == "alipay":
        if ALIPAY_APP_ID:
            try:
                qr_code = await _alipay_precreate(order_no)
            except Exception as e:
                logger.error(f"Alipay create failed: {e}", exc_info=True)
                error_msg = str(e)
        else:
            error_msg = "支付宝未配置"

    return {
        "order_no": order_no,
        "amount": amount_fen,
        "qr_code": qr_code,
        "status": "pending",
        "error": error_msg,
    }


class CreateJSAPIRequest(BaseModel):
    openid: str          # 小程序用户的 openid
    product_type: str = "single_report"
    province: str = ""
    rank_input: int = 0
    subject: str = ""    # 选科，绑定单次查询


@router.post("/wechat/jsapi")
async def create_jsapi_order(req: CreateJSAPIRequest, request: Request, db: Session = Depends(get_db)):
    """
    小程序 JSAPI 支付：返回 wx.requestPayment() 所需的全部参数。
    流程：创建订单 → 调微信 JSAPI 下单 → 签名 → 返回给小程序。
    """
    if not req.openid:
        raise HTTPException(status_code=400, detail="缺少 openid")

    amount_fen = PRODUCT_AMOUNTS.get(req.product_type, AMOUNT_FEN)

    # 查找用户
    user_id = None
    user = db.query(User).filter(User.wechat_mini_openid == req.openid).first()
    if user:
        user_id = user.id

    order_no = f"GK{int(time.time())}{uuid.uuid4().hex[:6].upper()}"
    order = Order(
        order_no=order_no,
        user_id=user_id,
        amount=amount_fen,
        product_type=req.product_type,
        pay_method="wechat",
        province=req.province,
        rank_input=req.rank_input or None,
        subject=req.subject,
        ip=request.client.host if request.client else "",
    )
    db.add(order)
    db.commit()

    if not WECHAT_MCH_ID or not WECHAT_API_V3_KEY:
        return {"order_no": order_no, "error": "微信支付未配置"}

    try:
        pay_params = await _wechat_create_jsapi(order_no, req.openid, req.province, amount_fen)
        return {
            "order_no": order_no,
            "amount": amount_fen,
            "pay_params": pay_params,
            "status": "pending",
        }
    except Exception as e:
        logger.error(f"JSAPI create failed: {e}", exc_info=True)
        return {"order_no": order_no, "error": str(e)}


class CreateH5Request(BaseModel):
    product_type: str = "single_report"
    province: str = ""
    rank_input: int = 0
    subject: str = ""


@router.post("/wechat/h5")
async def create_h5_order(req: CreateH5Request, request: Request, db: Session = Depends(get_db)):
    """手机浏览器（非微信）H5 支付：下单返回 h5_url，前端 window.location.href 跳转"""
    user_id = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        payload = _verify_token(auth.replace("Bearer ", ""))
        if payload:
            user_id = payload.get("uid")

    amount_fen = PRODUCT_AMOUNTS.get(req.product_type, AMOUNT_FEN)
    order_no = f"GK{int(time.time())}{uuid.uuid4().hex[:6].upper()}"
    client_ip = _get_client_ip(request)

    order = Order(
        order_no=order_no,
        user_id=user_id,
        amount=amount_fen,
        product_type=req.product_type,
        pay_method="wechat",
        province=req.province,
        rank_input=req.rank_input or None,
        subject=req.subject,
        ip=client_ip,
    )
    db.add(order)
    db.commit()

    if not WECHAT_MCH_ID or not WECHAT_API_V3_KEY:
        return {"order_no": order_no, "error": "微信支付未配置"}

    try:
        h5_url = await _wechat_create_h5(order_no, req.province, amount_fen, client_ip)
        return {
            "order_no": order_no,
            "amount": amount_fen,
            "h5_url": h5_url,
            "status": "pending",
        }
    except Exception as e:
        logger.error(f"H5 create failed: {e}", exc_info=True)
        return {"order_no": order_no, "error": str(e)}


class CodeToOpenidRequest(BaseModel):
    code: str


@router.post("/wechat/code_to_openid")
async def code_to_openid(req: CodeToOpenidRequest):
    """OAuth2 code 换服务号 openid（scope=snsapi_base 静默授权路径）"""
    if not req.code:
        raise HTTPException(status_code=400, detail="缺少 code")
    if not WECHAT_SERVICE_APP_ID or not WECHAT_SERVICE_APP_SECRET:
        raise HTTPException(status_code=500, detail="服务号未配置")

    import urllib.parse, urllib.request, urllib.error
    params = urllib.parse.urlencode({
        "appid": WECHAT_SERVICE_APP_ID,
        "secret": WECHAT_SERVICE_APP_SECRET,
        "code": req.code,
        "grant_type": "authorization_code",
    })
    url = f"https://api.weixin.qq.com/sns/oauth2/access_token?{params}"
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            data = json.loads(r.read().decode())
    except urllib.error.URLError as e:
        logger.error(f"OAuth2 exchange network error: {e}")
        raise HTTPException(status_code=502, detail="微信网络错误")

    if data.get("errcode"):
        logger.warning(f"OAuth2 exchange error: {data}")
        raise HTTPException(status_code=400, detail=data.get("errmsg", "授权失败"))

    openid = data.get("openid")
    if not openid:
        raise HTTPException(status_code=500, detail="微信未返回 openid")
    return {"openid": openid}


class CreateJSAPIWebRequest(BaseModel):
    openid: str
    product_type: str = "single_report"
    province: str = ""
    rank_input: int = 0
    subject: str = ""


@router.post("/wechat/jsapi_web")
async def create_jsapi_web_order(req: CreateJSAPIWebRequest, request: Request, db: Session = Depends(get_db)):
    """微信浏览器内 JSAPI 支付（服务号 AppID）：返回 WeixinJSBridge 调起参数"""
    if not req.openid:
        raise HTTPException(status_code=400, detail="缺少 openid")
    if not WECHAT_SERVICE_APP_ID:
        raise HTTPException(status_code=500, detail="服务号未配置")

    user_id = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        payload = _verify_token(auth.replace("Bearer ", ""))
        if payload:
            user_id = payload.get("uid")

    amount_fen = PRODUCT_AMOUNTS.get(req.product_type, AMOUNT_FEN)
    order_no = f"GK{int(time.time())}{uuid.uuid4().hex[:6].upper()}"
    order = Order(
        order_no=order_no,
        user_id=user_id,
        amount=amount_fen,
        product_type=req.product_type,
        pay_method="wechat",
        province=req.province,
        rank_input=req.rank_input or None,
        subject=req.subject,
        ip=_get_client_ip(request),
    )
    db.add(order)
    db.commit()

    try:
        pay_params = await _wechat_create_jsapi_web(order_no, req.openid, req.province, amount_fen)
        return {
            "order_no": order_no,
            "amount": amount_fen,
            "pay_params": pay_params,
            "status": "pending",
        }
    except Exception as e:
        logger.error(f"JSAPI-Web create failed: {e}", exc_info=True)
        return {"order_no": order_no, "error": str(e)}


@router.get("/status/{order_no}")
async def get_status(order_no: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_no == order_no).first()
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    return {"order_no": order_no, "status": order.status}


@router.post("/wechat/notify")
async def wechat_notify(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """微信支付异步回调 — 验签 + AES-GCM 解密 + 金额校验 + 异步入账"""
    body_bytes = await request.body()
    body_str   = body_bytes.decode("utf-8")

    # ── 1. 验证微信签名 ──
    timestamp  = request.headers.get("Wechatpay-Timestamp", "")
    nonce      = request.headers.get("Wechatpay-Nonce", "")
    signature  = request.headers.get("Wechatpay-Signature", "")

    if not _verify_wechat_signature(timestamp, nonce, body_str, signature):
        logger.warning("WeChat notify: signature verification failed")
        # 返回 401 让微信重试（可能是证书轮换或请求被篡改），便于监控告警
        return JSONResponse(
            status_code=401,
            content={"code": "SIGN_ERROR", "message": "签名验证失败"},
        )

    # ── 2. 解密资源 ──
    try:
        data = json.loads(body_str)
        resource     = data.get("resource", {})
        ciphertext   = resource.get("ciphertext", "")
        nonce_val    = resource.get("nonce", "")
        associated   = resource.get("associated_data", "")

        plaintext = _aes_gcm_decrypt(
            key=WECHAT_API_V3_KEY,
            nonce=nonce_val,
            ciphertext=ciphertext,
            associated_data=associated,
        )
        pay_info = json.loads(plaintext)
    except Exception as e:
        logger.error(f"WeChat notify decrypt error: {e}", exc_info=True)
        # 解密失败返回 500，让微信重试（通常是 APIv3 密钥配置错误）
        return JSONResponse(
            status_code=500,
            content={"code": "FAIL", "message": "解密失败"},
        )

    order_no       = pay_info.get("out_trade_no", "")
    transaction_id = pay_info.get("transaction_id", "")
    trade_state    = pay_info.get("trade_state", "")
    wechat_total   = pay_info.get("amount", {}).get("total", 0)

    # ── 3. 非成功状态直接 ACK，不走入账 ──
    if trade_state != "SUCCESS" or not order_no:
        logger.info(f"WeChat notify non-success state: {trade_state} order={order_no}")
        return {"code": "SUCCESS", "message": "成功"}

    # ── 4. 金额比对（安全强制项，防止伪造回调）──
    order = db.query(Order).filter(Order.order_no == order_no).first()
    if not order:
        logger.warning(f"WeChat notify: order not found {order_no}")
        return {"code": "SUCCESS", "message": "成功"}
    if wechat_total != order.amount:
        # 金额不一致视为伪造回调，拒绝入账；返回 SUCCESS 避免攻击者通过重试探测
        logger.error(
            f"WeChat notify AMOUNT MISMATCH order={order_no} "
            f"local={order.amount} wechat={wechat_total} — REJECTED"
        )
        return {"code": "SUCCESS", "message": "成功"}

    # ── 5. 异步入账（立即 ACK，避免 DB/邮件耗时触发微信 5 秒超时重试）──
    background_tasks.add_task(_mark_paid_task, order_no, transaction_id)
    logger.info(f"WeChat Pay success queued: {order_no} txn={transaction_id}")

    return {"code": "SUCCESS", "message": "成功"}


def _mark_paid_task(order_no: str, transaction_id: str):
    """BackgroundTasks 入口：开独立 DB session 执行入账（不能复用请求绑定的 session）"""
    db = SessionLocal()
    try:
        _mark_paid(db, order_no, transaction_id)
    finally:
        db.close()


@router.post("/alipay/notify")
async def alipay_notify(request: Request, db: Session = Depends(get_db)):
    """支付宝异步回调（预留）"""
    form = await request.form()
    trade_status = form.get("trade_status", "")
    order_no     = form.get("out_trade_no", "")
    trade_no     = form.get("trade_no", "")
    if trade_status == "TRADE_SUCCESS" and order_no:
        _mark_paid(db, order_no, trade_no)
    return "success"


# ─────────────────────────────────────────────
# 内部函数
# ─────────────────────────────────────────────

def _mark_paid(db: Session, order_no: str, transaction_id: str):
    """将订单标记为已支付，并升级用户付费状态（单事务原子操作）"""
    order = db.query(Order).filter(Order.order_no == order_no).first()
    if not order or order.status != "pending":
        return
    try:
        order.status         = "paid"
        order.transaction_id = transaction_id
        order.pay_time       = datetime.datetime.utcnow()
        # ━━━ 付费验证：订阅到期时间设置点 ━━━━━━━━━━━━━━━━━━━━━━━
        # 此处设置的 subscription_end_at 由以下两层消费：
        #   Layer 2/3 过期检查 → routers/auth.py:573-623 (/api/auth/me lazy expiry)
        #   Layer 1/3 订单匹配 → main.py recommend 端点（order_no + province/rank/subject）
        #   Layer 3/3 失败 UI  → frontend/components/PayModal.tsx:439-442
        # 在同一事务中更新 user.is_paid，防止 Order 已 paid 但 User 未升级的状态分裂
        SEASON_END = datetime.datetime(2026, 7, 31, 23, 59, 59)
        if order.user_id:
            user = db.query(User).filter(User.id == order.user_id).first()
            if user:
                user.is_paid = 1
                user.subscription_type = order.product_type or "season_2026"
                now = datetime.datetime.utcnow()
                if order.product_type == "season_2026":
                    user.subscription_end_at = SEASON_END
                elif order.product_type == "monthly_sub":
                    base = user.subscription_end_at if (user.subscription_end_at and user.subscription_end_at > now) else now
                    user.subscription_end_at = base + datetime.timedelta(days=30)
                elif order.product_type == "quarterly_sub":
                    base = user.subscription_end_at if (user.subscription_end_at and user.subscription_end_at > now) else now
                    user.subscription_end_at = base + datetime.timedelta(days=90)
                # single_report / report_export: is_paid=1 永久，subscription_end_at 不变
        # 推荐奖励：如果该用户是被推荐注册的，奖励推荐人7天（无论推荐人是否已付费）
        if order.user_id:
            paying_user = db.query(User).filter(User.id == order.user_id).first()
            if paying_user and paying_user.referred_by:
                referrer = db.query(User).filter(User.id == paying_user.referred_by).first()
                if referrer:
                    now = datetime.datetime.utcnow()
                    # 推荐人有有效订阅则顺延，否则从现在起给7天（不超过赛季结束）
                    base = referrer.subscription_end_at if (referrer.subscription_end_at and referrer.subscription_end_at > now) else now
                    new_end = min(base + datetime.timedelta(days=7), SEASON_END)
                    referrer.subscription_end_at = new_end
                    if not referrer.is_paid:
                        referrer.is_paid = 1
                        referrer.subscription_type = "season_2026"
                    logger.info(f"Referral reward: user {referrer.id} +7 days for referring {order.user_id}")
        db.commit()  # 单次 commit：Order + User 要么同时成功，要么同时回滚
        logger.info(f"Order {order_no} marked PAID, user={order.user_id}")
        # 发送支付成功通知邮件（静默失败，不影响支付结果）
        pay_time_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        send_payment_notification(
            order_no=order_no,
            amount_fen=order.amount,
            product_type=order.product_type or "report_export",
            pay_time=pay_time_str,
        )
    except Exception as e:
        db.rollback()
        logger.error(f"_mark_paid failed for {order_no}: {e}")


async def _wechat_create_native(order_no: str, province: str = "", rank: int = 0, amount_fen: int = AMOUNT_FEN) -> str:
    """
    调用微信支付 V3 Native 下单 API，返回 code_url（用于生成二维码）。
    直接实现 HTTP 签名，兼容新版"微信支付公钥"模式（无需平台证书）。
    文档: https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_4_1.shtml
    """
    import time, uuid, urllib.request, urllib.error
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding as asym_padding

    if not WECHAT_MCH_ID or not WECHAT_MINI_APP_ID or not WECHAT_API_V3_KEY:
        raise RuntimeError("微信支付未配置（缺少 MCH_ID/APP_ID/API_V3_KEY）")

    if not os.path.exists(WECHAT_PRIVATE_KEY):
        raise RuntimeError(f"商户私钥文件不存在: {WECHAT_PRIVATE_KEY}")
    with open(WECHAT_PRIVATE_KEY, "rb") as f:
        priv_key = serialization.load_pem_private_key(f.read(), password=None)

    desc = f"水卢冷门高报引擎·报告解锁"
    if province:
        desc = f"水卢冷门高报引擎·{province}"

    body = json.dumps({
        "appid": WECHAT_MINI_APP_ID,
        "mchid": WECHAT_MCH_ID,
        "description": desc,
        "out_trade_no": order_no,
        "notify_url": NOTIFY_URL,
        "amount": {"total": amount_fen, "currency": "CNY"},
    }, ensure_ascii=False)

    url = "https://api.mch.weixin.qq.com/v3/pay/transactions/native"
    method = "POST"
    uri = "/v3/pay/transactions/native"
    ts = str(int(time.time()))
    nonce = uuid.uuid4().hex.upper()
    msg = f"{method}\n{uri}\n{ts}\n{nonce}\n{body}\n"
    sig = base64.b64encode(
        priv_key.sign(msg.encode(), asym_padding.PKCS1v15(), hashes.SHA256())
    ).decode()
    auth = (f'WECHATPAY2-SHA256-RSA2048 mchid="{WECHAT_MCH_ID}",'
            f'serial_no="{WECHAT_CERT_SERIAL}",timestamp="{ts}",'
            f'nonce_str="{nonce}",signature="{sig}"')

    req = urllib.request.Request(url, data=body.encode(), method="POST", headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": auth,
        "User-Agent": "YuanXi-Pay/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            resp = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        raise RuntimeError(f"微信支付下单失败 [{e.code}]: {err}")

    code_url = resp.get("code_url")
    if not code_url:
        raise RuntimeError(f"微信支付未返回 code_url: {resp}")
    return code_url


async def _wechat_create_jsapi(order_no: str, openid: str, province: str = "", amount_fen: int = AMOUNT_FEN) -> dict:
    """
    调用微信支付 V3 JSAPI 下单 API，返回小程序 wx.requestPayment() 所需参数。
    文档: https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_5_1.shtml
    """
    import time as _time, uuid as _uuid, urllib.request, urllib.error
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding as asym_padding

    # 小程序的 AppID（与商户号关联的小程序 AppID）
    mini_app_id = os.getenv("WECHAT_MINI_APP_ID", WECHAT_MINI_APP_ID)

    if not os.path.exists(WECHAT_PRIVATE_KEY):
        raise RuntimeError(f"商户私钥文件不存在: {WECHAT_PRIVATE_KEY}")
    with open(WECHAT_PRIVATE_KEY, "rb") as f:
        priv_key = serialization.load_pem_private_key(f.read(), password=None)

    desc = f"水卢冷门高报引擎·报告解锁"
    if province:
        desc = f"水卢冷门高报引擎·{province}"

    body = json.dumps({
        "appid": mini_app_id,
        "mchid": WECHAT_MCH_ID,
        "description": desc,
        "out_trade_no": order_no,
        "notify_url": NOTIFY_URL,
        "amount": {"total": amount_fen, "currency": "CNY"},
        "payer": {"openid": openid},
    }, ensure_ascii=False)

    url = "https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi"
    method = "POST"
    uri = "/v3/pay/transactions/jsapi"
    ts = str(int(_time.time()))
    nonce = _uuid.uuid4().hex.upper()
    msg = f"{method}\n{uri}\n{ts}\n{nonce}\n{body}\n"
    sig = base64.b64encode(
        priv_key.sign(msg.encode(), asym_padding.PKCS1v15(), hashes.SHA256())
    ).decode()
    auth = (f'WECHATPAY2-SHA256-RSA2048 mchid="{WECHAT_MCH_ID}",'
            f'serial_no="{WECHAT_CERT_SERIAL}",timestamp="{ts}",'
            f'nonce_str="{nonce}",signature="{sig}"')

    req = urllib.request.Request(url, data=body.encode(), method="POST", headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": auth,
        "User-Agent": "YuanXi-Pay/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            resp = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        raise RuntimeError(f"微信 JSAPI 下单失败 [{e.code}]: {err}")

    prepay_id = resp.get("prepay_id")
    if not prepay_id:
        raise RuntimeError(f"微信 JSAPI 未返回 prepay_id: {resp}")

    # 生成小程序 wx.requestPayment() 所需的签名参数
    pay_ts = str(int(_time.time()))
    pay_nonce = _uuid.uuid4().hex.upper()
    package = f"prepay_id={prepay_id}"
    pay_msg = f"{mini_app_id}\n{pay_ts}\n{pay_nonce}\n{package}\n"
    pay_sign = base64.b64encode(
        priv_key.sign(pay_msg.encode(), asym_padding.PKCS1v15(), hashes.SHA256())
    ).decode()

    return {
        "timeStamp": pay_ts,
        "nonceStr": pay_nonce,
        "package": package,
        "signType": "RSA",
        "paySign": pay_sign,
    }


async def _wechat_create_h5(order_no: str, province: str, amount_fen: int, client_ip: str) -> str:
    """调用微信支付 V3 H5 下单 API，返回 h5_url（有效期 5 分钟）"""
    import time as _time, uuid as _uuid, urllib.request, urllib.error
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding as asym_padding

    # H5 支付 appid 只需已绑定商户号，优先服务号，回退小程序
    appid = WECHAT_SERVICE_APP_ID or WECHAT_MINI_APP_ID
    if not appid:
        raise RuntimeError("缺少已绑定商户号的 AppID（服务号或小程序）")

    if not os.path.exists(WECHAT_PRIVATE_KEY):
        raise RuntimeError(f"商户私钥文件不存在: {WECHAT_PRIVATE_KEY}")
    with open(WECHAT_PRIVATE_KEY, "rb") as f:
        priv_key = serialization.load_pem_private_key(f.read(), password=None)

    desc = "水卢冷门高报引擎·报告解锁"
    if province:
        desc = f"水卢冷门高报引擎·{province}"

    body = json.dumps({
        "appid": appid,
        "mchid": WECHAT_MCH_ID,
        "description": desc,
        "out_trade_no": order_no,
        "notify_url": NOTIFY_URL,
        "amount": {"total": amount_fen, "currency": "CNY"},
        "scene_info": {
            "payer_client_ip": client_ip or "0.0.0.0",
            "h5_info": {"type": "Wap"},
        },
    }, ensure_ascii=False)

    method = "POST"
    uri = "/v3/pay/transactions/h5"
    url = f"https://api.mch.weixin.qq.com{uri}"
    ts = str(int(_time.time()))
    nonce = _uuid.uuid4().hex.upper()
    msg = f"{method}\n{uri}\n{ts}\n{nonce}\n{body}\n"
    sig = base64.b64encode(
        priv_key.sign(msg.encode(), asym_padding.PKCS1v15(), hashes.SHA256())
    ).decode()
    auth = (f'WECHATPAY2-SHA256-RSA2048 mchid="{WECHAT_MCH_ID}",'
            f'serial_no="{WECHAT_CERT_SERIAL}",timestamp="{ts}",'
            f'nonce_str="{nonce}",signature="{sig}"')

    req = urllib.request.Request(url, data=body.encode(), method="POST", headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": auth,
        "User-Agent": "YuanXi-Pay/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            resp = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        raise RuntimeError(f"微信 H5 下单失败 [{e.code}]: {err}")

    h5_url = resp.get("h5_url")
    if not h5_url:
        raise RuntimeError(f"微信 H5 未返回 h5_url: {resp}")
    return h5_url


async def _wechat_create_jsapi_web(order_no: str, openid: str, province: str, amount_fen: int) -> dict:
    """公众号网页 JSAPI 下单（服务号 AppID），返回 WeixinJSBridge.invoke 所需参数"""
    import time as _time, uuid as _uuid, urllib.request, urllib.error
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding as asym_padding

    appid = WECHAT_SERVICE_APP_ID
    if not appid:
        raise RuntimeError("服务号 AppID 未配置")

    if not os.path.exists(WECHAT_PRIVATE_KEY):
        raise RuntimeError(f"商户私钥文件不存在: {WECHAT_PRIVATE_KEY}")
    with open(WECHAT_PRIVATE_KEY, "rb") as f:
        priv_key = serialization.load_pem_private_key(f.read(), password=None)

    desc = "水卢冷门高报引擎·报告解锁"
    if province:
        desc = f"水卢冷门高报引擎·{province}"

    body = json.dumps({
        "appid": appid,
        "mchid": WECHAT_MCH_ID,
        "description": desc,
        "out_trade_no": order_no,
        "notify_url": NOTIFY_URL,
        "amount": {"total": amount_fen, "currency": "CNY"},
        "payer": {"openid": openid},
    }, ensure_ascii=False)

    method = "POST"
    uri = "/v3/pay/transactions/jsapi"
    url = f"https://api.mch.weixin.qq.com{uri}"
    ts = str(int(_time.time()))
    nonce = _uuid.uuid4().hex.upper()
    msg = f"{method}\n{uri}\n{ts}\n{nonce}\n{body}\n"
    sig = base64.b64encode(
        priv_key.sign(msg.encode(), asym_padding.PKCS1v15(), hashes.SHA256())
    ).decode()
    auth = (f'WECHATPAY2-SHA256-RSA2048 mchid="{WECHAT_MCH_ID}",'
            f'serial_no="{WECHAT_CERT_SERIAL}",timestamp="{ts}",'
            f'nonce_str="{nonce}",signature="{sig}"')

    req = urllib.request.Request(url, data=body.encode(), method="POST", headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": auth,
        "User-Agent": "YuanXi-Pay/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            resp = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        raise RuntimeError(f"微信 JSAPI-Web 下单失败 [{e.code}]: {err}")

    prepay_id = resp.get("prepay_id")
    if not prepay_id:
        raise RuntimeError(f"微信 JSAPI-Web 未返回 prepay_id: {resp}")

    pay_ts = str(int(_time.time()))
    pay_nonce = _uuid.uuid4().hex.upper()
    package = f"prepay_id={prepay_id}"
    pay_msg = f"{appid}\n{pay_ts}\n{pay_nonce}\n{package}\n"
    pay_sign = base64.b64encode(
        priv_key.sign(pay_msg.encode(), asym_padding.PKCS1v15(), hashes.SHA256())
    ).decode()

    # WeixinJSBridge.invoke("getBrandWCPayRequest", ...) 所需字段
    return {
        "appId": appid,
        "timeStamp": pay_ts,
        "nonceStr": pay_nonce,
        "package": package,
        "signType": "RSA",
        "paySign": pay_sign,
    }


def _aes_gcm_decrypt(key: str, nonce: str, ciphertext: str, associated_data: str) -> str:
    """AES-256-GCM 解密微信支付回调密文"""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    key_bytes    = key.encode("utf-8")           # 32 bytes
    nonce_bytes  = nonce.encode("utf-8")         # 12 bytes
    ct_bytes     = base64.b64decode(ciphertext)
    aad_bytes    = associated_data.encode("utf-8") if associated_data else b""
    aesgcm       = AESGCM(key_bytes)
    plaintext    = aesgcm.decrypt(nonce_bytes, ct_bytes, aad_bytes)
    return plaintext.decode("utf-8")


def _verify_wechat_signature(timestamp: str, nonce: str, body: str, signature: str) -> bool:
    """验证微信支付回调签名 — RSA-SHA256。
    支持微信支付公钥（新版，PEM 公钥文件）→ WECHAT_PUBKEY_PATH
    优先读取公钥；未配置时记录错误并拒绝回调（return False）。
    """
    import time as _time

    if not signature or not timestamp or not nonce:
        logger.warning("WeChat notify: missing signature headers")
        return False

    # 时间戳防重放（±5 分钟），无论哪种模式都先校验
    try:
        ts = int(timestamp)
        if abs(ts - int(_time.time())) > 300:
            logger.warning("WeChat notify: timestamp out of range, possible replay attack")
            return False
    except (ValueError, TypeError):
        logger.warning("WeChat notify: invalid timestamp")
        return False

    # 优先：微信支付公钥（新版商户，2024+）
    key_file = os.getenv("WECHAT_PUBKEY_PATH", "/app/backend/certs/wechatpay_pubkey.pem")

    if key_file is None:
        logger.error(
            "WeChat notify: no public key or platform cert found. "
            "Download 微信支付公钥 from merchant dashboard → API安全 → 微信支付公钥, "
            "save to %s, then set WECHAT_PUBKEY_PATH. Rejecting callback.",
            pubkey_path
        )
        return False  # 严格拒绝，不允许未验签的回调通过

    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding as asym_padding
        from cryptography import x509

        with open(key_file, "rb") as f:
            pem_data = f.read()

        # 自动识别格式：X.509 证书 vs 原始公钥
        try:
            cert = x509.load_pem_x509_certificate(pem_data)
            pub_key = cert.public_key()
        except Exception:
            pub_key = serialization.load_pem_public_key(pem_data)

        message = f"{timestamp}\n{nonce}\n{body}\n".encode("utf-8")
        sig_bytes = base64.b64decode(signature)
        pub_key.verify(sig_bytes, message, asym_padding.PKCS1v15(), hashes.SHA256())
        return True
    except Exception as e:
        logger.warning("WeChat notify: signature verification failed: %s", e)
        return False


async def _alipay_precreate(order_no: str) -> str | None:
    """支付宝预创建（预留，待支付宝资质通过后实现）"""
    return None
