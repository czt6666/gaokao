"""PDF报告导出路由 — GET /api/report/export
缓存层：同一 (province, rank, subject) 生成一次 PDF 后缓存 30 分钟，
  重复请求直接返回，解决小程序 fetchBinary timeout 问题。
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Header
from fastapi.responses import Response, HTMLResponse
from sqlalchemy.orm import Session
from urllib.parse import quote
from typing import Optional

import random, string, datetime, time, hashlib
from database import get_db, Order, User, ReportLog

# ── PDF 内存缓存（LRU-like，最多缓存 20 份，每份有效 30 分钟）──────
_pdf_cache: dict = {}          # key → {"bytes": bytes, "ts": float, "report_id": str}
_PDF_CACHE_TTL  = 1800         # 30 分钟
_PDF_CACHE_MAX  = 20           # 最多缓存 20 份（每份 ~2-5 MB，总内存 ~100 MB 上限）

def _pdf_cache_key(province: str, rank: int, subject: str) -> str:
    """生成缓存 key：同省份+位次+选科共享同一份 PDF"""
    raw = f"{province}:{rank}:{subject}"
    return hashlib.md5(raw.encode()).hexdigest()

def _pdf_cache_get(key: str):
    """读取缓存，过期返回 None"""
    entry = _pdf_cache.get(key)
    if not entry:
        return None
    if time.time() - entry["ts"] > _PDF_CACHE_TTL:
        _pdf_cache.pop(key, None)
        return None
    return entry

def _pdf_cache_set(key: str, pdf_bytes: bytes, report_id: str):
    """写入缓存，超容量时淘汰最旧条目"""
    if len(_pdf_cache) >= _PDF_CACHE_MAX:
        oldest_key = min(_pdf_cache, key=lambda k: _pdf_cache[k]["ts"])
        _pdf_cache.pop(oldest_key, None)
    _pdf_cache[key] = {"bytes": pdf_bytes, "ts": time.time(), "report_id": report_id}


def _new_report_id() -> str:
    """生成8位唯一报告ID，用于二维码追踪"""
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=8))


def _save_report_log(db, report_id: str, province: str, rank: int, user_id=None):
    """写入报告生成记录"""
    try:
        log = ReportLog(
            report_id  = report_id,
            province   = province,
            rank       = rank,
            user_id    = user_id,
            created_at = datetime.datetime.utcnow(),
            scan_count = 0,
        )
        db.add(log)
        db.commit()
    except Exception:
        db.rollback()

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

router = APIRouter(prefix="/api/report", tags=["report"])


def _flatten_results(recommend_data: dict) -> list:
    """将冲稳保+冷门结果展平成列表，打上 tier 字段，用于 PDF"""
    out = []
    for tier_key, tier_label in [("surge", "冲"), ("stable", "稳"), ("safe", "保")]:
        for item in recommend_data.get(tier_key, []):
            item = dict(item)
            item["tier"] = tier_label
            # 映射 PDF 模板需要的字段
            item["ci_low"]  = item.get("prob_low")
            item["ci_high"] = item.get("prob_high")
            emp = item.get("employment") or {}
            item["avg_salary"]       = emp.get("avg_salary") or item.get("avg_salary")
            item["employment_rate"]  = emp.get("school_employment_rate") or emp.get("employment_rate")
            item["postgrad_rate"]    = emp.get("school_postgrad_rate") or emp.get("postgrad_rate")
            item["employer_tier"]    = emp.get("school_employer_tier") or emp.get("employer_tier")
            # 历史位次
            item["historical_ranks"] = [
                {"year": r.get("year"), "rank": r.get("min_rank")}
                for r in (item.get("recent_data") or [])
            ]
            # 保留 big_small_year 为 dict（PDF模板使用结构化版本）
            # 兼容旧版字符串格式：不做转换，直接保留原始 dict
            bsy = item.get("big_small_year") or {}
            if not isinstance(bsy, dict):
                item["big_small_year"] = {}  # normalize to dict
            out.append(item)
    return out


@router.get("/export")
async def export_report(
    order_no: str = Query(..., description="已支付的订单号"),
    subject: str = Query("物理", description="选科（与查询时一致）"),
    db: Session = Depends(get_db),
):
    """
    验证订单已支付，生成 PDF 报告并返回文件流。
    前端在支付成功后调用此接口触发下载。
    """
    # 1. 验证订单
    order = db.query(Order).filter(Order.order_no == order_no).first()
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    if order.status != "paid":
        raise HTTPException(status_code=402, detail="订单尚未支付，无法导出报告")

    province  = order.province or "北京"
    rank      = order.rank_input or 5000

    # 2. 调用核心推荐逻辑（is_paid=True，返回完整数据）
    try:
        from services.recommend_core import _run_recommend_core
        recommend_data = _run_recommend_core(
            province=province, rank=rank,
            subject=subject, mode="all",
            db=db, is_paid=True
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成报告数据失败：{str(e)}")

    results = _flatten_results(recommend_data)
    if not results:
        raise HTTPException(status_code=404, detail="未找到推荐结果，请确认省份和位次")

    # 3. 生成 report_id 并写库
    report_id = _new_report_id()
    _save_report_log(db, report_id, province, rank, user_id=order.user_id)

    # 4. 生成 PDF
    try:
        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
        from services.pdf_export import generate_pdf
        pdf_bytes = generate_pdf(province=province, rank=rank, results=results, report_id=report_id)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF生成失败：{str(e)}")

    filename = f"志愿报告_{province}_{rank}.pdf"
    filename_encoded = quote(filename, safe="")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=\"report_{rank}.pdf\"; filename*=UTF-8''{filename_encoded}",
            "Content-Length": str(len(pdf_bytes)),
        }
    )


@router.get("/preview")
async def preview_report_html(
    order_no: str = Query(...),
    subject: str = Query("物理"),
    db: Session = Depends(get_db),
):
    """返回 HTML 预览（需已支付订单）"""
    order = db.query(Order).filter(Order.order_no == order_no).first()
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    if order.status != "paid":
        raise HTTPException(status_code=402, detail="订单尚未支付，无法预览报告")

    province = order.province or "北京"
    rank     = order.rank_input or 5000

    try:
        from services.recommend_core import _run_recommend_core
        recommend_data = _run_recommend_core(
            province=province, rank=rank, subject=subject,
            mode="all", db=db, is_paid=True
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    results = _flatten_results(recommend_data)

    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    from services.pdf_export import _html_template
    html = _html_template(province=province, rank=rank, results=results)
    return HTMLResponse(content=html)


@router.get("/generate")
async def generate_report_free(
    province: str = Query(..., description="省份"),
    rank: int = Query(..., description="位次"),
    subject: str = Query("物理", description="选科"),
    order_no: str = Query("", description="付费订单号，有效则允许下载"),
    part: int = Query(0, description="分册：0=全部（旧兼容），1=上册(冲+稳)，2=下册(保+冷门)"),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """
    PDF报告生成（需已付费用户）。支持 order_no 或 JWT 两种验证方式。
    """
    PUBLIC_TESTING = False

    # 验证付费状态：order_no 优先，fallback 到 JWT user.is_paid
    is_paid = False
    user = None

    if order_no:
        paid_order = db.query(Order).filter(
            Order.order_no == order_no,
            Order.status == "paid"
        ).first()
        if paid_order:
            is_paid = True

    if not is_paid:
        from routers.auth import _verify_token
        if authorization and authorization.startswith("Bearer "):
            token = authorization[7:]
            payload = _verify_token(token)
            if payload:
                uid = payload.get("uid")
                phone = payload.get("phone")
                if uid:
                    user = db.query(User).filter(User.id == uid).first()
                elif phone:
                    user = db.query(User).filter(User.phone == phone).first()
                if user and user.is_paid:
                    is_paid = True

    if not PUBLIC_TESTING and not is_paid:
        raise HTTPException(status_code=403, detail="请先完成支付后再下载报告")

    # ── 缓存层：同参数+分册 30 分钟内直接返回 ──────────
    cache_suffix = f"_p{part}" if part in (1, 2) else ""
    cache_key = _pdf_cache_key(province, rank, subject + cache_suffix)
    cached = _pdf_cache_get(cache_key)
    if cached:
        report_id = cached["report_id"]
        pdf_bytes = cached["bytes"]
        _save_report_log(db, report_id, province, rank, user_id=user.id if user else None)
    else:
        try:
            from services.recommend_core import _run_recommend_core
            recommend_data = _run_recommend_core(
                province=province, rank=rank,
                subject=subject, mode="all",
                db=db, is_paid=True
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"生成报告数据失败：{str(e)}")

        results = _flatten_results(recommend_data)
        if not results:
            raise HTTPException(status_code=404, detail="未找到推荐结果，请确认省份和位次")

        # ── 分册过滤：part=1 上册(冲+稳), part=2 下册(保+冷门) ──
        if part == 1:
            results = [r for r in results if r.get("tier") in ("冲", "稳")]
        elif part == 2:
            # 保底层 + 不在冲稳层的冷门宝藏（避免和上册重复）
            results = [r for r in results if r.get("tier") == "保" or (r.get("is_hidden_gem") and r.get("tier") not in ("冲", "稳"))]
        # part=0 或其他值：全量（向后兼容）

        if not results:
            raise HTTPException(status_code=404, detail="该分册无推荐结果")

        report_id = _new_report_id()
        _save_report_log(db, report_id, province, rank, user_id=user.id if user else None)

        try:
            import sys, os
            sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
            from services.pdf_export import generate_pdf
            pdf_bytes = generate_pdf(province=province, rank=rank, results=results, report_id=report_id)
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"PDF生成失败：{str(e)}")

        _pdf_cache_set(cache_key, pdf_bytes, report_id)

    part_label = {1: "上册_冲稳", 2: "下册_保底"}.get(part, "")
    filename = f"水卢报告_{province}_{rank}{'_' + part_label if part_label else ''}.pdf"
    filename_encoded = quote(filename, safe="")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=\"report_{rank}.pdf\"; filename*=UTF-8''{filename_encoded}",
            "Content-Length": str(len(pdf_bytes)),
        }
    )


@router.post("/warmup-outlook")
async def warmup_outlook(
    province: str = Query(...),
    rank: int = Query(...),
    subject: str = Query("物理"),
    db: Session = Depends(get_db),
):
    """支付完成后异步预热冷门学校「未来展望」缓存。
    前端在支付成功后 fire-and-forget 调用，不阻塞用户。"""
    import threading
    def _do_warmup():
        try:
            from services.recommend_core import _run_recommend_core
            data = _run_recommend_core(province=province, rank=rank, subject=subject, mode="all", db=db, is_paid=True)
            from routers.report import _flatten_results
            results = _flatten_results(data)
            from services.future_outlook import generate_outlooks_batch
            outlooks = generate_outlooks_batch(results, max_schools=5)
            print(f"[warmup-outlook] 完成: {len(outlooks)} 所学校")
        except Exception as e:
            print(f"[warmup-outlook] 失败: {e}")
    threading.Thread(target=_do_warmup, daemon=True).start()
    return {"ok": True, "message": "展望生成已启动（后台异步）"}


@router.post("/email")
async def email_report(
    province: str = Query(..., description="省份"),
    rank: int = Query(..., description="位次"),
    subject: str = Query("", description="选科"),
    to_email: str = Query(..., description="收件人邮箱"),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """生成PDF报告并发送到用户邮箱（需已付费）"""
    # 验证付费状态
    from routers.auth import _verify_token
    user = None
    if authorization and authorization.startswith("Bearer "):
        payload = _verify_token(authorization[7:])
        if payload:
            uid = payload.get("uid")
            phone = payload.get("phone")
            if uid:
                user = db.query(User).filter(User.id == uid).first()
            elif phone:
                user = db.query(User).filter(User.phone == phone).first()
    if not user or not user.is_paid:
        raise HTTPException(status_code=403, detail="请先解锁报告后再发送邮件")

    # 1. 生成推荐数据
    try:
        from services.recommend_core import _run_recommend_core
        recommend_data = _run_recommend_core(
            province=province, rank=rank,
            subject=subject, mode="all",
            db=db, is_paid=True
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成报告数据失败：{str(e)}")

    results = _flatten_results(recommend_data)
    if not results:
        raise HTTPException(status_code=404, detail="未找到推荐结果")

    # 2. 生成 PDF
    try:
        from services.pdf_export import generate_pdf
        pdf_bytes = generate_pdf(province=province, rank=rank, results=results)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF生成失败：{str(e)}")

    # 统计冲稳保数量，传给邮件模板
    chong = sum(1 for r in results if r.get("tier") == "冲")
    wen   = sum(1 for r in results if r.get("tier") == "稳")
    bao   = sum(1 for r in results if r.get("tier") == "保")
    gems  = sum(1 for r in results if r.get("is_hidden_gem"))

    # 3. 发送邮件
    try:
        from services.email_service import send_report_email
        send_report_email(
            to_email=to_email,
            pdf_bytes=pdf_bytes,
            province=province,
            rank=rank,
            chong=chong, wen=wen, bao=bao, gems=gems,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"邮件发送失败：{str(e)}")

    return {"ok": True, "message": f"报告已发送至 {to_email}，请查收邮件（含附件）"}
