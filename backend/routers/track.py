"""行为埋点路由"""
from fastapi import APIRouter, Request, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
import json
from database import get_db, UserEvent
from routers.auth import _verify_token

router = APIRouter(prefix="/api", tags=["track"])


class TrackEvent(BaseModel):
    event_type: str
    event_data: dict = {}
    page: str = ""
    province: str = ""
    rank_input: int = 0
    session_id: str = ""
    subject: str = ""
    exam_mode: str = ""
    c_major: str = ""
    c_city: str = ""
    c_nature: str = ""
    c_tier: str = ""


@router.post("/track")
async def track(ev: TrackEvent, request: Request, db: Session = Depends(get_db)):
    user_id = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        payload = _verify_token(auth.replace("Bearer ", ""))
        if payload:
            user_id = payload.get("uid")

    event = UserEvent(
        user_id=user_id,
        session_id=ev.session_id,
        event_type=ev.event_type,
        event_data=json.dumps(ev.event_data, ensure_ascii=False),
        page=ev.page,
        province=ev.province,
        rank_input=ev.rank_input or None,
        subject=ev.subject,
        exam_mode=ev.exam_mode,
        c_major=ev.c_major,
        c_city=ev.c_city,
        c_nature=ev.c_nature,
        c_tier=ev.c_tier,
        ip=request.client.host if request.client else "",
        user_agent=request.headers.get("user-agent", ""),
    )
    db.add(event)
    db.commit()
    return {"ok": True}
