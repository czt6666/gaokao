"""
Agent 对话路由
POST /api/agent/chat         → JSON 非流式
POST /api/agent/chat/stream  → SSE 流式
"""
import time
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Optional

from services.agent_service import run_agent_turn, stream_agent_turn

router = APIRouter(prefix="/api/agent", tags=["agent"])

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
async def agent_chat(request: Request, body: AgentChatRequest):
    """非流式对话端点"""
    if not _check_agent_rate_limit(request):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试（每分钟最多10次）")

    messages = body.get_trimmed_messages()
    result = run_agent_turn(messages)
    return result


@router.post("/chat/stream")
async def agent_chat_stream(request: Request, body: AgentChatRequest):
    """SSE 流式对话端点"""
    if not _check_agent_rate_limit(request):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试（每分钟最多10次）")

    messages = body.get_trimmed_messages()
    session_id = body.session_id or ""

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
