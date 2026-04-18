/**
 * 行为埋点工具 — 封装 POST /api/track
 * 所有参数可选，失败静默（不影响主流程）
 */
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type EventType =
  | "page_view"
  | "query_submit"
  | "school_click"
  | "export_click"
  | "email_click"
  | "add_to_form"
  | "compare_add"
  | "pay_click"
  | "pay_success"
  | "unlock_click";

let _sessionId: string | null = null;
function getSessionId(): string {
  if (_sessionId) return _sessionId;
  try {
    let sid = sessionStorage.getItem("_sid");
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("_sid", sid);
    }
    _sessionId = sid;
    return sid;
  } catch {
    return "anon";
  }
}

export function track(
  eventType: EventType,
  opts: {
    eventData?: Record<string, unknown>;
    page?: string;
    province?: string;
    rankInput?: number;
  } = {}
): void {
  try {
    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(`${API}/api/track`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        event_type: eventType,
        event_data: opts.eventData || {},
        page: opts.page || (typeof window !== "undefined" ? window.location.pathname : ""),
        province: opts.province || "",
        rank_input: opts.rankInput || 0,
        session_id: getSessionId(),
      }),
      // fire-and-forget: don't await, don't block UI
      keepalive: true,
    }).catch(() => {});
  } catch {
    // silent
  }
}
