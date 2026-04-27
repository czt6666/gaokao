"""报告追踪路由 — GET /r/{report_id}  扫码跳转 + 记录日志"""
import datetime, os
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from database import get_db, ReportLog, ReportScan

router = APIRouter(tags=["tracking"])

SITE_URL = os.getenv("SITE_URL", "https://www.theyuanxi.cn")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")


def _verify_admin(x_admin_token: str = Header(...)):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid admin token")


@router.get("/r/{report_id}")
async def track_scan(report_id: str, request: Request, db: Session = Depends(get_db)):
    """
    二维码落地页：记录扫描信息，跳转首页。
    每次有人扫描报告上的二维码，就会命中这里。
    """
    ip         = request.client.host if request.client else ""
    user_agent = request.headers.get("user-agent", "")[:500]
    referer    = request.headers.get("referer", "")[:500]

    # 写扫描记录
    scan = ReportScan(
        report_id  = report_id,
        scanned_at = datetime.datetime.utcnow(),
        ip         = ip,
        user_agent = user_agent,
        referer    = referer,
    )
    db.add(scan)

    # 更新报告的扫描计数
    log = db.query(ReportLog).filter(ReportLog.report_id == report_id).first()
    if log:
        log.scan_count = (log.scan_count or 0) + 1

    try:
        db.commit()
    except Exception:
        db.rollback()

    return RedirectResponse(url=SITE_URL, status_code=302)


@router.get("/api/admin/report-scans", dependencies=[Depends(_verify_admin)])
async def report_scan_stats(db: Session = Depends(get_db)):
    """
    后台查看报告传播数据（后续加鉴权）。
    返回：总报告数、总扫描次数、Top 10 传播报告。
    """
    total_reports = db.query(ReportLog).count()
    total_scans   = db.query(ReportScan).count()

    top_reports = (
        db.query(ReportLog)
        .filter(ReportLog.scan_count > 0)
        .order_by(ReportLog.scan_count.desc())
        .limit(20)
        .all()
    )

    # 最近24小时扫描来源分布
    since = datetime.datetime.utcnow() - datetime.timedelta(hours=24)
    recent_scans = (
        db.query(ReportScan)
        .filter(ReportScan.scanned_at >= since)
        .order_by(ReportScan.scanned_at.desc())
        .limit(100)
        .all()
    )

    return {
        "total_reports": total_reports,
        "total_scans":   total_scans,
        "top_reports": [
            {
                "report_id":  r.report_id,
                "province":   r.province,
                "rank":       r.rank,
                "scan_count": r.scan_count,
                "created_at": r.created_at.isoformat() if r.created_at else "",
            }
            for r in top_reports
        ],
        "recent_scans": [
            {
                "report_id": s.report_id,
                "ip":        s.ip,
                "referer":   s.referer,
                "user_agent": s.user_agent[:80],
                "scanned_at": s.scanned_at.isoformat() if s.scanned_at else "",
            }
            for s in recent_scans
        ],
    }
