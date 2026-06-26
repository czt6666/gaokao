"""统一行为埋点写入工具 — 写入 UserEvent 表。

服务端主动埋点入口（与前端 /api/track 互补）：
PDF 下载、AI 提问等关键行为在后端落库，保证记录可靠 + 参数完整。
失败一律静默，绝不影响主流程。
"""
import json

from database import UserEvent


def log_event(
    db,
    *,
    event_type: str,
    user_id=None,
    session_id: str = "",
    event_data=None,
    page: str = "",
    province: str = "",
    rank_input=None,
    subject: str = "",
    exam_mode: str = "",
    c_major: str = "",
    c_city: str = "",
    c_nature: str = "",
    c_tier: str = "",
    ip: str = "",
    user_agent: str = "",
) -> None:
    """写入一条用户行为事件。任何异常都吞掉（埋点不得影响业务）。"""
    try:
        ev = UserEvent(
            user_id=user_id,
            session_id=session_id or "",
            event_type=event_type,
            event_data=json.dumps(event_data or {}, ensure_ascii=False),
            page=page or "",
            province=province or "",
            rank_input=rank_input or None,
            subject=subject or "",
            exam_mode=exam_mode or "",
            c_major=c_major or "",
            c_city=c_city or "",
            c_nature=c_nature or "",
            c_tier=c_tier or "",
            ip=ip or "",
            user_agent=user_agent or "",
        )
        db.add(ev)
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
