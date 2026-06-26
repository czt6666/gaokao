"""
Agent 对话路由
POST /api/agent/chat         → JSON 非流式
POST /api/agent/chat/stream  → SSE 流式
"""
import time
from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Optional
from sqlalchemy.orm import Session

from database import get_db
from services.agent_service import run_agent_turn, stream_agent_turn

router = APIRouter(prefix="/api/agent", tags=["agent"])


def _log_ai_chat(request: Request, db: Session, messages: List[dict], session_id: str) -> None:
    """埋点：记录 AI 提问（用户 + 提问内容 + 提取到的参数）。失败静默。"""
    try:
        # 解析用户（与 /api/track 同逻辑）
        user_id = None
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            from routers.auth import _verify_token
            payload = _verify_token(auth.replace("Bearer ", ""))
            if payload:
                user_id = payload.get("uid")

        # 最后一条用户提问
        question = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                question = (m.get("content") or "")[:2000]
                break

        from services.agent_service import _extract_params
        params = _extract_params(messages)

        from services.event_log import log_event
        log_event(
            db,
            event_type="ai_chat",
            user_id=user_id,
            session_id=session_id or "",
            event_data={
                "question": question,
                "message_count": len(messages),
                "rank": params.get("rank", ""),
                "score": params.get("score", ""),
            },
            page="/ai-chat",
            province=params.get("province", ""),
            subject=params.get("subject", ""),
            ip=(request.client.host if request.client else ""),
            user_agent=request.headers.get("user-agent", ""),
        )
    except Exception:
        pass

# ── 简易 IP 限流 ──────────────────────────────────────────────
_AGENT_RATE_WINDOW = 60
_AGENT_RATE_MAX    = 10
_agent_rate_store: dict = {}


def _check_agent_rate_limit(request: Request) -> bool:
    """返回 True 表示通过，False 表示被限流"""
    ip = request.headers.get(
        "X-Forwarded-For", request.client.host if request.client else "unknown"
    ).split(",")[0].strip()

    now = time.time()
    if ip in _agent_rate_store:
        _agent_rate_store[ip] = [t for t in _agent_rate_store[ip] if now - t < _AGENT_RATE_WINDOW]
    else:
        _agent_rate_store[ip] = []

    if len(_agent_rate_store[ip]) >= _AGENT_RATE_MAX:
        return False

    _agent_rate_store[ip].append(now)

    if len(_agent_rate_store) > 5000:
        oldest = sorted(
            _agent_rate_store.keys(),
            key=lambda k: _agent_rate_store[k][0] if _agent_rate_store[k] else 0,
        )
        for k in oldest[:2500]:
            del _agent_rate_store[k]

    return True


# ── 请求体模型 ─────────────────────────────────────────────────
class ChatMessage(BaseModel):
    role: str
    content: str


class AgentChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(..., description="对话历史")
    session_id: Optional[str] = Field(None, description="会话 ID（可选）")

    def get_trimmed_messages(self, max_count: int = 20) -> List[dict]:
        """最多保留最近 max_count 条"""
        msgs = [{"role": m.role, "content": m.content} for m in self.messages]
        return msgs[-max_count:]


# ── 端点 ──────────────────────────────────────────────────────
@router.post("/chat")
async def agent_chat(request: Request, body: AgentChatRequest, db: Session = Depends(get_db)):
    """非流式对话端点"""
    if not _check_agent_rate_limit(request):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试（每分钟最多10次）")

    messages = body.get_trimmed_messages()
    _log_ai_chat(request, db, messages, body.session_id or "")
    result = run_agent_turn(messages)
    return result


@router.post("/chat/stream")
async def agent_chat_stream(request: Request, body: AgentChatRequest, db: Session = Depends(get_db)):
    """SSE 流式对话端点"""
    if not _check_agent_rate_limit(request):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试（每分钟最多10次）")

    messages = body.get_trimmed_messages()
    session_id = body.session_id or ""
    # 埋点在流式输出前同步写入（此时 db 会话仍打开）
    _log_ai_chat(request, db, messages, session_id)

    def generate():
        yield from stream_agent_turn(messages, session_id)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
