"""认证路由 — 手机号+短信验证码 + 微信扫码登录"""
from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
import random, string, hashlib, time, os, json
from database import get_db, User, SmsCode, Order

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ── 微信扫码会话（内存存储，10分钟TTL）────────────────────────────────────
_QR_SESSIONS: dict = {}   # {session_id: {"status": "pending"|"success"|"expired", "token": str|None, "expires": float}}

SECRET_KEY = os.getenv("JWT_SECRET", "gaokao-dev-secret-change-in-prod")
TOKEN_EXPIRE_DAYS = 30
SMS_CODE_TTL = 300        # 验证码有效期 5分钟
SMS_COOLDOWN = 60         # 同一手机号发送冷却 60秒
SMS_IP_DAILY_LIMIT = 20  # 同一IP每天最多发送次数
SMS_MAX_ATTEMPTS = 5      # 验证码连续错误上限
SMS_LOCKOUT_SECS = 600    # 锁定时长 10分钟

# 内存中的验证失败计数器 {phone: {"count": int, "window_start": float}}
_verify_failures: dict = {}


# ── JWT helpers ──────────────────────────────────────────────────────────────

def _make_token(user_id: int, phone: str) -> str:
    import base64, hmac
    payload = json.dumps({"uid": user_id, "phone": phone, "exp": int(time.time()) + TOKEN_EXPIRE_DAYS * 86400})
    payload_b64 = base64.b64encode(payload.encode()).decode()
    sig = hmac.new(SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def _verify_token(token: str) -> dict | None:
    import base64, hmac
    try:
        parts = token.split(".")
        if len(parts) != 2: return None
        payload_b64, sig = parts
        expected = hmac.new(SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        if sig != expected: return None
        payload = json.loads(base64.b64decode(payload_b64).decode())
        if payload.get("exp", 0) < time.time(): return None
        return payload
    except Exception:
        return None


# ── SMS helpers ───────────────────────────────────────────────────────────────

def _cleanup_expired_codes(db: Session):
    """清理过期验证码（顺带执行，保持表干净）"""
    db.query(SmsCode).filter(SmsCode.expires_at < time.time()).delete()
    db.commit()


def _check_rate_limit(phone: str, client_ip: str, db: Session):
    """检查发送频率限制，超限时抛出 HTTPException"""
    now = time.time()

    # 1. 同一手机号 60秒冷却
    recent = (
        db.query(SmsCode)
        .filter(SmsCode.phone == phone, SmsCode.created_at > now - SMS_COOLDOWN)
        .first()
    )
    if recent:
        wait = int(SMS_COOLDOWN - (now - recent.created_at)) + 1
        raise HTTPException(status_code=429, detail=f"请等待 {wait} 秒后再次获取验证码")

    # 2. 同一IP每天限 SMS_IP_DAILY_LIMIT 次
    if client_ip:
        day_start = now - 86400
        ip_count = (
            db.query(SmsCode)
            .filter(SmsCode.ip == client_ip, SmsCode.created_at > day_start)
            .count()
        )
        if ip_count >= SMS_IP_DAILY_LIMIT:
            raise HTTPException(status_code=429, detail="今日发送次数已达上限，请明天再试")


async def _send_sms(phone: str, code: str):
    """
    发送短信验证码。优先使用腾讯云短信，其次阿里云，否则打印日志（开发模式）。
    真实渠道发送失败时抛出 HTTPException(503)，由调用方回滚DB记录。
    """
    # ── 腾讯云短信（优先）──────────────────────────────────────
    tencent_secret_id  = os.getenv("TENCENT_SECRET_ID", "")
    tencent_secret_key = os.getenv("TENCENT_SECRET_KEY", "")
    tencent_app_id     = os.getenv("TENCENT_SMS_APP_ID", "")
    tencent_sign       = os.getenv("TENCENT_SMS_SIGN", "水卢冷门高报引擎")
    tencent_tpl_id     = os.getenv("TENCENT_SMS_TEMPLATE_ID", "")

    if tencent_secret_id and tencent_secret_key and tencent_app_id and tencent_tpl_id:
        try:
            from tencentcloud.common import credential
            from tencentcloud.sms.v20210111 import sms_client, models as sms_models

            cred = credential.Credential(tencent_secret_id, tencent_secret_key)
            client = sms_client.SmsClient(cred, "ap-guangzhou")

            req = sms_models.SendSmsRequest()
            req.SmsSdkAppId   = tencent_app_id
            req.SignName       = tencent_sign
            req.TemplateId     = tencent_tpl_id
            req.TemplateParamSet = [code]
            req.PhoneNumberSet   = [f"+86{phone}"]

            resp = client.SendSms(req)
            status = resp.SendStatusSet[0] if resp.SendStatusSet else None
            if status and status.Code == "Ok":
                print(f"[TENCENT SMS OK] {phone}: {code}")
                return
            err = status.Message if status else "unknown"
            print(f"[TENCENT SMS FAIL] {phone}: {err}")
            raise HTTPException(status_code=503, detail="短信发送失败，请稍后重试")
        except HTTPException:
            raise
        except Exception as e:
            print(f"[TENCENT SMS ERROR] {phone}: {e}")
            raise HTTPException(status_code=503, detail="短信服务暂时不可用，请稍后重试")

    # ── 阿里云短信（备选）──────────────────────────────────────
    access_key_id     = os.getenv("ALIYUN_ACCESS_KEY_ID", "")
    access_key_secret = os.getenv("ALIYUN_ACCESS_KEY_SECRET", "")
    sign_name         = os.getenv("ALIYUN_SMS_SIGN", "水卢冷门高报引擎")
    template_code     = os.getenv("ALIYUN_SMS_TEMPLATE", "")

    if access_key_id and access_key_secret and template_code:
        try:
            from alibabacloud_dysmsapi20170525 import models as sms_models
            from alibabacloud_dysmsapi20170525.client import Client
            from alibabacloud_tea_openapi import models as open_api_models

            config = open_api_models.Config(
                access_key_id=access_key_id,
                access_key_secret=access_key_secret,
                endpoint="dysmsapi.aliyuncs.com",
            )
            client = Client(config)
            req = sms_models.SendSmsRequest(
                phone_numbers=phone,
                sign_name=sign_name,
                template_code=template_code,
                template_param=json.dumps({"code": code}),
            )
            client.send_sms(req)
            print(f"[ALIYUN SMS SENT] {phone}: {code}")
            return
        except HTTPException:
            raise
        except Exception as e:
            print(f"[ALIYUN SMS ERROR] {phone}: {e}")
            raise HTTPException(status_code=503, detail="短信服务暂时不可用，请稍后重试")

    # ── 开发模式（无凭证）——始终成功 ──────────────────────────
    print(f"[DEV SMS] {phone}: {code}  (配置 TENCENT_SECRET_ID 等环境变量以启用真实发送)")


# ── Request models ────────────────────────────────────────────────────────────

class SmsSendRequest(BaseModel):
    phone: str


class SmsVerifyRequest(BaseModel):
    phone: str
    code: str
    ref_code: str = ""  # 推荐码（可选）


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/sms/send")
async def sms_send(req: SmsSendRequest, request: Request, db: Session = Depends(get_db)):
    if not req.phone or len(req.phone) != 11 or not req.phone.isdigit():
        raise HTTPException(status_code=400, detail="手机号格式不正确")

    client_ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "")

    _cleanup_expired_codes(db)
    _check_rate_limit(req.phone, client_ip, db)

    code = "".join(random.choices(string.digits, k=6))
    now = time.time()

    sms_entry = SmsCode(
        phone=req.phone,
        code=code,
        expires_at=now + SMS_CODE_TTL,
        created_at=now,
        ip=client_ip,
    )
    db.add(sms_entry)
    db.commit()

    try:
        await _send_sms(req.phone, code)
    except HTTPException:
        # 发送失败：回滚DB记录，避免用户看到"已发送"但收不到短信
        db.delete(sms_entry)
        db.commit()
        raise

    return {"ok": True, "message": "验证码已发送，请在5分钟内输入"}


@router.post("/sms/verify")
async def sms_verify(req: SmsVerifyRequest, db: Session = Depends(get_db)):
    now = time.time()

    # ── 暴力破解防护 ─────────────────────────────────────────────────────────
    fail_rec = _verify_failures.get(req.phone)
    if fail_rec:
        # 超过锁定窗口则重置
        if now - fail_rec["window_start"] > SMS_LOCKOUT_SECS:
            del _verify_failures[req.phone]
            fail_rec = None
        elif fail_rec["count"] >= SMS_MAX_ATTEMPTS:
            remain = int(SMS_LOCKOUT_SECS - (now - fail_rec["window_start"]))
            raise HTTPException(
                status_code=429,
                detail=f"验证码错误次数过多，请 {remain} 秒后重新获取"
            )

    entry = (
        db.query(SmsCode)
        .filter(SmsCode.phone == req.phone, SmsCode.expires_at > now)
        .order_by(SmsCode.created_at.desc())
        .first()
    )
    if not entry:
        raise HTTPException(status_code=400, detail="验证码已过期，请重新获取")
    if entry.code != req.code:
        # 记录失败次数
        if req.phone not in _verify_failures:
            _verify_failures[req.phone] = {"count": 0, "window_start": now}
        _verify_failures[req.phone]["count"] += 1
        remaining_attempts = SMS_MAX_ATTEMPTS - _verify_failures[req.phone]["count"]
        detail = "验证码错误" if remaining_attempts > 0 else f"验证码错误次数过多，请重新获取验证码"
        raise HTTPException(status_code=400, detail=detail)

    # 删除已使用的验证码，清除失败计数
    db.delete(entry)
    db.commit()
    _verify_failures.pop(req.phone, None)

    user = db.query(User).filter(User.phone == req.phone).first()
    is_new = False
    if not user:
        is_new = True
        own_ref = "".join(random.choices(string.ascii_uppercase + string.digits, k=8))
        # 查找推荐人
        referrer_id = None
        if req.ref_code:
            referrer = db.query(User).filter(User.referral_code == req.ref_code).first()
            if referrer:
                referrer_id = referrer.id
        user = User(phone=req.phone, referral_code=own_ref, referred_by=referrer_id)
        db.add(user)
        db.commit()
        db.refresh(user)

    token = _make_token(user.id, req.phone)
    return {"token": token, "is_new": is_new, "user_id": user.id}


@router.get("/wechat/qr")
async def wechat_qr():
    """
    获取微信扫码登录二维码。
    需要配置：
      WECHAT_OPEN_APP_ID     — 微信开放平台 AppID（需开放平台认证，300元/年）
      WECHAT_OPEN_APP_SECRET — 微信开放平台 AppSecret
    当前状态：等待ICP备案 + 微信开放平台认证后启用。
    """
    app_id = os.getenv("WECHAT_OPEN_APP_ID", "")
    if not app_id:
        return {
            "available": False,
            "message": "微信扫码登录需ICP备案及微信开放平台认证，功能即将上线",
        }
    # 生成 state（防CSRF）
    state = "".join(random.choices(string.ascii_letters + string.digits, k=16))
    redirect_uri = os.getenv("SITE_URL", "https://theyuanxi.cn") + "/api/auth/wechat/callback"
    import urllib.parse
    qr_url = (
        f"https://open.weixin.qq.com/connect/qrconnect"
        f"?appid={app_id}"
        f"&redirect_uri={urllib.parse.quote(redirect_uri)}"
        f"&response_type=code"
        f"&scope=snsapi_login"
        f"&state={state}"
        f"#wechat_redirect"
    )
    return {"available": True, "qr_url": qr_url, "state": state}


@router.post("/qr/create")
async def qr_create():
    """
    PC端微信扫码登录：创建会话，返回 session_id + 微信授权URL（供前端渲染二维码）。
    前端轮询 /api/auth/qr/poll/{session_id}；手机扫码完成OAuth后会话标记为 success。
    """
    import urllib.parse
    app_id  = os.getenv("WECHAT_MP_APP_ID", "")
    if not app_id:
        raise HTTPException(status_code=503, detail="微信登录暂未配置")

    # 清理过期会话
    expired = [k for k, v in list(_QR_SESSIONS.items()) if time.time() > v["expires"]]
    for k in expired:
        _QR_SESSIONS.pop(k, None)

    session_id = "".join(random.choices(string.ascii_letters + string.digits, k=24))
    _QR_SESSIONS[session_id] = {"status": "pending", "token": None, "expires": time.time() + 600}

    site_url = os.getenv("SITE_URL", "https://www.theyuanxi.cn")
    callback = f"{site_url}/api/auth/wechat/mp/callback"
    # state 编码格式: "qr_{session_id}|{redirect_to}"
    state_param = f"qr_{session_id}|/"
    wechat_url = (
        "https://open.weixin.qq.com/connect/oauth2/authorize"
        f"?appid={app_id}"
        f"&redirect_uri={urllib.parse.quote(callback, safe='')}"
        f"&response_type=code"
        f"&scope=snsapi_userinfo"
        f"&state={urllib.parse.quote(state_param, safe='')}"
        f"#wechat_redirect"
    )
    return {"session_id": session_id, "wechat_url": wechat_url}


@router.get("/qr/poll/{session_id}")
async def qr_poll(session_id: str):
    """PC端轮询：返回 pending / success(含token) / expired"""
    session = _QR_SESSIONS.get(session_id)
    if not session or time.time() > session["expires"]:
        _QR_SESSIONS.pop(session_id, None)
        return {"status": "expired"}
    if session["status"] == "success":
        token = session["token"]
        _QR_SESSIONS.pop(session_id, None)
        return {"status": "success", "token": token}
    return {"status": "pending"}


@router.get("/wechat/mp/authorize")
async def wechat_mp_authorize(redirect_to: str = "/"):
    """
    公众号网页授权登录入口（支持手机微信直接授权 + PC二维码扫码）。
    WECHAT_MP_APP_ID / WECHAT_MP_APP_SECRET — 公众号 AppID/AppSecret
    """
    import urllib.parse
    app_id = os.getenv("WECHAT_MP_APP_ID", "")
    if not app_id:
        return {"available": False, "message": "公众号未配置"}

    state = "".join(random.choices(string.ascii_letters + string.digits, k=16))
    site_url = os.getenv("SITE_URL", "https://www.theyuanxi.cn")
    callback = f"{site_url}/api/auth/wechat/mp/callback"
    # 拼接到 state 里带上 redirect_to，方便回调后跳回原页
    state_param = f"{state}|{redirect_to}"

    oauth_url = (
        "https://open.weixin.qq.com/connect/oauth2/authorize"
        f"?appid={app_id}"
        f"&redirect_uri={urllib.parse.quote(callback, safe='')}"
        f"&response_type=code"
        f"&scope=snsapi_userinfo"
        f"&state={urllib.parse.quote(state_param, safe='')}"
        f"#wechat_redirect"
    )
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=oauth_url)


@router.get("/wechat/mp/callback")
async def wechat_mp_callback(code: str, state: str = "", db: Session = Depends(get_db)):
    """
    公众号网页授权回调：用 code 换取 openid + 用户信息，登录/注册用户。
    """
    import httpx, urllib.parse
    from fastapi.responses import RedirectResponse

    app_id     = os.getenv("WECHAT_MP_APP_ID", "")
    app_secret = os.getenv("WECHAT_MP_APP_SECRET", "")
    site_url   = os.getenv("SITE_URL", "https://www.theyuanxi.cn")

    if not app_id or not app_secret:
        raise HTTPException(status_code=503, detail="公众号未配置")

    # 解析 redirect_to from state
    parts = state.split("|", 1)
    redirect_to = parts[1] if len(parts) == 2 else "/"

    # 用 code 换取 access_token + openid
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://api.weixin.qq.com/sns/oauth2/access_token",
            params={
                "appid": app_id, "secret": app_secret,
                "code": code, "grant_type": "authorization_code"
            },
            timeout=10,
        )
    data = resp.json()
    openid       = data.get("openid")
    access_token = data.get("access_token")
    if not openid:
        raise HTTPException(status_code=400, detail="微信授权失败，请重试")

    # 获取用户昵称（可选，snsapi_userinfo scope）
    nickname = ""
    try:
        async with httpx.AsyncClient() as client:
            u = await client.get(
                "https://api.weixin.qq.com/sns/userinfo",
                params={"access_token": access_token, "openid": openid, "lang": "zh_CN"},
                timeout=10,
            )
        udata    = u.json()
        nickname = udata.get("nickname", "")
    except Exception:
        pass

    # 查找或创建用户
    user = db.query(User).filter(User.wechat_openid == openid).first()
    is_new = False
    if not user:
        is_new = True
        ref  = "".join(random.choices(string.ascii_uppercase + string.digits, k=8))
        user = User(wechat_openid=openid, nickname=nickname, referral_code=ref)
        db.add(user)
        db.commit()
        db.refresh(user)
    elif nickname and not user.nickname:
        user.nickname = nickname
        db.commit()

    token = _make_token(user.id, user.phone or f"wx_{openid[:8]}")

    # 检查是否是PC扫码会话（state 以 "qr_" 开头）
    raw_state = parts[0] if parts else ""
    if raw_state.startswith("qr_"):
        session_id = raw_state[3:]
        if session_id in _QR_SESSIONS:
            _QR_SESSIONS[session_id]["status"] = "success"
            _QR_SESSIONS[session_id]["token"] = token
        # 手机端显示扫码成功页
        return RedirectResponse(url=f"{site_url}/login?qr_done=1")

    return RedirectResponse(
        url=f"{site_url}/login?token={token}&is_new={1 if is_new else 0}&redirect_to={urllib.parse.quote(redirect_to, safe='')}"
    )


@router.get("/wechat/callback")
async def wechat_callback(code: str, state: str, db: Session = Depends(get_db)):
    """
    微信扫码登录回调。用 code 换取 openid，登录/注册用户。
    """
    import httpx
    app_id     = os.getenv("WECHAT_OPEN_APP_ID", "")
    app_secret = os.getenv("WECHAT_OPEN_APP_SECRET", "")

    if not app_id or not app_secret:
        raise HTTPException(status_code=503, detail="微信登录暂未开放，请使用手机号登录")

    # 用 code 换取 access_token + openid
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://api.weixin.qq.com/sns/oauth2/access_token",
            params={"appid": app_id, "secret": app_secret, "code": code, "grant_type": "authorization_code"},
            timeout=10,
        )
    data = resp.json()
    openid = data.get("openid")
    if not openid:
        raise HTTPException(status_code=400, detail="微信授权失败，请重试")

    # 查找或创建用户
    user = db.query(User).filter(User.wechat_openid == openid).first()
    is_new = False
    if not user:
        is_new = True
        ref = "".join(random.choices(string.ascii_uppercase + string.digits, k=8))
        user = User(wechat_openid=openid, referral_code=ref)
        db.add(user)
        db.commit()
        db.refresh(user)

    token = _make_token(user.id, user.phone or f"wx_{openid[:8]}")
    # 回调后重定向到前端，携带 token
    site_url = os.getenv("SITE_URL", "https://www.theyuanxi.cn")
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=f"{site_url}/login?token={token}&is_new={1 if is_new else 0}")


class MiniLoginRequest(BaseModel):
    code: str = ""     # wx.login() 获取的 code（云函数通常不需要）
    openid: str = ""   # 可选：云函数已有 openid 时直接传入


@router.post("/wechat/mini/login")
async def wechat_mini_login(req: MiniLoginRequest, db: Session = Depends(get_db)):
    """
    小程序登录：使用 wx.login() 的 code 换取 openid，创建/查找用户，返回 JWT。
    如果云函数已经拿到 openid，可直接传入跳过 code2session。
    """
    import httpx

    openid = req.openid
    if not openid and req.code:
        # 用 code 调微信 code2session 换取 openid
        mini_app_id = os.getenv("WECHAT_MINI_APP_ID", "")
        mini_app_secret = os.getenv("WECHAT_MINI_APP_SECRET", "")
        if not mini_app_id or not mini_app_secret:
            raise HTTPException(status_code=503, detail="小程序未配置")
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://api.weixin.qq.com/sns/jscode2session",
                params={
                    "appid": mini_app_id,
                    "secret": mini_app_secret,
                    "js_code": req.code,
                    "grant_type": "authorization_code",
                },
                timeout=10,
            )
        data = resp.json()
        openid = data.get("openid", "")
        if not openid:
            raise HTTPException(status_code=400, detail=f"小程序登录失败: {data.get('errmsg', '未知错误')}")

    if not openid:
        raise HTTPException(status_code=400, detail="缺少 code 或 openid")

    # 查找或创建用户（小程序 openid 独立字段）
    user = db.query(User).filter(User.wechat_mini_openid == openid).first()
    is_new = False
    if not user:
        is_new = True
        ref = "".join(random.choices(string.ascii_uppercase + string.digits, k=8))
        user = User(wechat_mini_openid=openid, referral_code=ref)
        db.add(user)
        db.commit()
        db.refresh(user)

    token = _make_token(user.id, user.phone or f"mini_{openid[:8]}")
    return {
        "token": token,
        "user_id": user.id,
        "is_new": is_new,
        "is_paid": bool(user.is_paid),
    }


@router.get("/me")
async def get_me(request: Request, db: Session = Depends(get_db)):
    auth = request.headers.get("Authorization", "")
    token = auth.replace("Bearer ", "") if auth.startswith("Bearer ") else ""
    payload = _verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")

    user = db.query(User).filter(User.id == payload["uid"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # ━━━ 付费验证 Layer 2/3：订阅过期 lazy expiry ━━━━━━━━━━━━━━━
    # Layer 1/3：订单级匹配 → main.py recommend 端点（order_no + province/rank/subject）
    # Layer 3/3：支付失败 UI → frontend/components/PayModal.tsx:439-442
    # 订阅到期时间由 payment.py:246-261 (_finalize_order) 设置
    # 本层逻辑：若 subscription_end_at 已过期，返回 is_paid=False
    #   → 前端收到 is_paid=False 后不传 order_no → Layer 1 自然拒绝
    # 计算订阅剩余天数 + lazy expiry（不写DB，仅影响返回值）
    import datetime as _dt
    sub_end = user.subscription_end_at
    now_utc = _dt.datetime.utcnow()
    days_remaining = None
    is_paid_effective = bool(user.is_paid)

    if sub_end:
        if sub_end <= now_utc:
            # 已到期
            is_paid_effective = False
            days_remaining = 0
        else:
            # 向上取整：23小时算1天，不能显示为0（否则前端误判为过期）
            total_secs = (sub_end - now_utc).total_seconds()
            days_remaining = max(1, int(total_secs // 86400))

    sub_label_map = {
        "season_2026":    "2026填报季",
        "monthly_sub":    "月度会员",
        "quarterly_sub":  "季度会员",
        "single_report":  "单次报告",
        "report_export":  "单次报告",
    }
    # 推荐统计
    referral_count = 0
    try:
        from database import Order as _Order
        referral_count = db.query(_Order).filter(
            _Order.user_id.in_(
                db.query(User.id).filter(User.referred_by == user.id)
            ),
            _Order.status == "paid"
        ).count()
    except Exception:
        pass

    return {
        "user_id": user.id,
        "phone": user.phone,
        "wechat_nickname": (user.nickname or None) if user.wechat_openid else None,
        "wechat_avatar":   None,
        "is_paid": is_paid_effective,
        "province": user.province,
        "subscription_type":   user.subscription_type or "",
        "subscription_label":  sub_label_map.get(user.subscription_type or "", ""),
        "subscription_end_at": sub_end.isoformat() if sub_end else None,
        "days_remaining":      days_remaining,
        "referral_code":       user.referral_code or "",
        "referral_count":      referral_count,
    }


@router.get("/paid-orders")
async def get_paid_orders(request: Request, db: Session = Depends(get_db)):
    """返回当前用户的已付费订单列表（用于 Dashboard 历史查询入口）"""
    auth = request.headers.get("Authorization", "")
    token = auth.replace("Bearer ", "") if auth.startswith("Bearer ") else ""
    payload = _verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")

    user = db.query(User).filter(User.id == payload["uid"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    orders = (
        db.query(Order)
        .filter(Order.user_id == user.id, Order.status == "paid")
        .order_by(Order.pay_time.desc())
        .limit(20)
        .all()
    )

    result = []
    for o in orders:
        if not o.province or not o.rank_input:
            continue
        subject = o.subject or ""
        results_url = (
            f"/results?province={o.province}&rank={o.rank_input}"
            + (f"&subject={subject}" if subject else "")
            + f"&order_no={o.order_no}"
        )
        result.append({
            "order_no":   o.order_no,
            "province":   o.province,
            "rank_input": o.rank_input,
            "subject":    subject,
            "amount":     round((o.amount or 0) / 100, 2),
            "pay_time":   o.pay_time.strftime("%Y-%m-%d %H:%M") if o.pay_time else "",
            "results_url": results_url,
        })

    return {"orders": result}
