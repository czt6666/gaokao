"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import FeedbackModal from "@/components/FeedbackModal";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? "https://api.theyuanxi.cn"
    : "http://localhost:5198");

interface Source {
  title: string;
  url: string;
}

interface Action {
  label: string;
  url: string;
  icon: string;
  desc?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  searched?: boolean;
  searchQuery?: string;
  sources?: Source[];
  actions?: Action[];
  pending?: boolean;
}

function renderInline(text: string, keyPrefix: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let last = 0;
  let match;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[2] !== undefined) {
      parts.push(<strong key={`${keyPrefix}-b${i}`}>{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      parts.push(<em key={`${keyPrefix}-i${i}`}>{match[3]}</em>);
    } else if (match[4] !== undefined) {
      parts.push(
        <code key={`${keyPrefix}-c${i}`} style={{ background: "rgba(26,39,68,0.07)", borderRadius: 4, padding: "1px 5px", fontSize: "0.88em", fontFamily: "monospace" }}>
          {match[4]}
        </code>
      );
    }
    last = match.index + match[0].length;
    i++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { nodes.push(<div key={i} style={{ height: 6 }} />); i++; continue; }
    if (/^---+$/.test(line.trim())) { nodes.push(<hr key={i} style={{ border: "none", borderTop: "1px solid rgba(26,39,68,0.1)", margin: "6px 0" }} />); i++; continue; }
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) { nodes.push(<div key={i} style={{ fontWeight: 700, fontSize: 14, color: "#1a2744", marginTop: 8, marginBottom: 2 }}>{renderInline(h3[1], String(i))}</div>); i++; continue; }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) { nodes.push(<div key={i} style={{ fontWeight: 700, fontSize: 15, color: "#1a2744", marginTop: 10, marginBottom: 2, borderBottom: "1px solid rgba(26,39,68,0.08)", paddingBottom: 3 }}>{renderInline(h2[1], String(i))}</div>); i++; continue; }
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) { nodes.push(<div key={i} style={{ fontWeight: 800, fontSize: 16, color: "#1a2744", marginTop: 10, marginBottom: 4 }}>{renderInline(h1[1], String(i))}</div>); i++; continue; }
    if (/^[-*]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(<li key={i} style={{ marginBottom: 2, lineHeight: 1.6 }}>{renderInline(lines[i].replace(/^[-*]\s+/, ""), String(i))}</li>);
        i++;
      }
      nodes.push(<ul key={`ul-${i}`} style={{ margin: "4px 0", paddingLeft: 18, listStyleType: "disc" }}>{items}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(<li key={i} style={{ marginBottom: 2, lineHeight: 1.6 }}>{renderInline(lines[i].replace(/^\d+\.\s+/, ""), String(i))}</li>);
        i++;
      }
      nodes.push(<ol key={`ol-${i}`} style={{ margin: "4px 0", paddingLeft: 20 }}>{items}</ol>);
      continue;
    }
    nodes.push(<div key={i} style={{ lineHeight: 1.7, marginBottom: 1 }}>{renderInline(line, String(i))}</div>);
    i++;
  }
  return <>{nodes}</>;
}

const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content:
    "你好！我是 AI 志愿助手，支持**联网搜索**实时获取最新数据。\n\n你可以问我：\n- 「北京大学计算机专业2025录取分数线」\n- 「冲稳保志愿怎么搭配比较合理？」\n- 「物理选科适合报哪些专业？」\n- 「双非学校有哪些值得报考？」",
};

function LoadingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "#1a2744", display: "inline-block", animation: `blink 1.2s ease-in-out ${i * 0.2}s infinite` }} />
      ))}
    </span>
  );
}

export default function AIChatPage() {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, statusText]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setLoading(true);
    setStatusText("");

    const userMsg: Message = { role: "user", content: text };
    const historyMessages = messages.filter((m) => !m.pending);

    setMessages((prev) => [
      ...prev,
      userMsg,
      { role: "assistant", content: "", pending: true },
    ]);

    const apiMessages = [
      ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: text },
    ];

    abortRef.current = new AbortController();

    try {
      const resp = await fetch(`${API_BASE}/api/agent/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
        signal: abortRef.current.signal,
      });

      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      let searched = false;
      let searchQuery = "";
      let sources: Source[] = [];
      let actions: Action[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try {
            const evt = JSON.parse(raw);
            if (evt.type === "status") {
              setStatusText(evt.content || "");
            } else if (evt.type === "token") {
              accumulated += evt.content || "";
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.pending) next[next.length - 1] = { ...last, content: accumulated };
                return next;
              });
            } else if (evt.type === "meta") {
              searched = !!evt.searched;
              searchQuery = evt.query || "";
              sources = evt.sources || [];
              setStatusText("");
            } else if (evt.type === "actions") {
              actions = evt.actions || [];
            }
          } catch { /* ignore */ }
        }
      }

      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.pending) {
          next[next.length - 1] = {
            role: "assistant",
            content: accumulated || "（未获取到回答）",
            pending: false,
            searched,
            searchQuery,
            sources,
            actions,
          };
        }
        return next;
      });
    } catch (err: unknown) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.pending) next[next.length - 1] = { role: "assistant", content: "请求失败，请检查网络或稍后重试。", pending: false };
          return next;
        });
      }
    } finally {
      setLoading(false);
      setStatusText("");
      abortRef.current = null;
    }
  }, [input, loading, messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const clearChat = () => {
    if (loading) abortRef.current?.abort();
    setMessages([WELCOME_MESSAGE]);
    setInput("");
    setStatusText("");
    setLoading(false);
  };

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "#f5f5f7" }}>
      <style>{`
        @keyframes blink { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* 顶部导航 */}
      <header style={{
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        height: 52,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/" style={{ fontSize: 13, color: "#666", textDecoration: "none" }}>← 返回</Link>
          <span style={{ color: "#ddd" }}>|</span>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1a2744" }}>✦ AI 志愿助手</span>
            <span style={{ fontSize: 11, color: "#999", marginLeft: 8 }}>联网搜索 · 实时分析</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setFeedbackOpen(true)}
            style={{ fontSize: 12, padding: "5px 12px", borderRadius: 980, border: "1px solid #e0e0e0", background: "transparent", color: "#666", cursor: "pointer" }}
          >
            反馈
          </button>
          <button
            onClick={clearChat}
            style={{ fontSize: 12, padding: "5px 12px", borderRadius: 980, border: "1px solid #e0e0e0", background: "transparent", color: "#666", cursor: "pointer" }}
          >
            清空
          </button>
        </div>
      </header>

      {/* 消息列表 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 0" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
              {/* 气泡 */}
              <div style={msg.role === "user" ? {
                background: "linear-gradient(135deg, #1a2744 0%, #2b4a8a 100%)",
                color: "#fff",
                borderRadius: "18px 18px 4px 18px",
                padding: "12px 16px",
                maxWidth: "75%",
                fontSize: 14,
                lineHeight: 1.6,
                wordBreak: "break-word",
              } : {
                background: "#fff",
                color: "#1a2744",
                borderRadius: "18px 18px 18px 4px",
                padding: "12px 16px",
                maxWidth: "85%",
                fontSize: 14,
                lineHeight: 1.7,
                wordBreak: "break-word",
                boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
                border: "1px solid rgba(0,0,0,0.06)",
              }}>
                {msg.pending && !msg.content ? (
                  <span style={{ opacity: 0.5 }}><LoadingDots /></span>
                ) : (
                  renderMarkdown(msg.content)
                )}
              </div>

              {/* 来源 */}
              {msg.role === "assistant" && msg.searched && (
                <div style={{ marginTop: 6, maxWidth: "85%" }}>
                  {msg.sources && msg.sources.length > 0 ? (
                    <>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>参考来源</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {msg.sources.map((s, si) => {
                          const href = s.url || `https://www.baidu.com/s?wd=${encodeURIComponent(s.title)}`;
                          const label = s.url
                            ? (s.title && s.title !== s.url ? s.title : (() => { try { return new URL(s.url).hostname; } catch { return s.url; } })())
                            : s.title;
                          return (
                            <a key={si} href={href} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: 11, color: "#c9922a", textDecoration: "none", padding: "2px 8px", background: "rgba(201,146,42,0.07)", borderRadius: 6, border: "1px solid rgba(201,146,42,0.2)" }}>
                              🔗 {label}
                            </a>
                          );
                        })}
                      </div>
                    </>
                  ) : msg.searchQuery ? (
                    <div style={{ fontSize: 11, color: "#c9922a" }}>🔍 联网搜索：{msg.searchQuery}</div>
                  ) : null}
                </div>
              )}

              {/* 导航按钮 */}
              {msg.role === "assistant" && msg.actions && msg.actions.length > 0 && (
                <div style={{ marginTop: 10, maxWidth: "85%", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 11, color: "#888" }}>快速跳转</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {msg.actions.map((action, ai) => (
                      <a key={ai} href={action.url}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "linear-gradient(135deg, rgba(26,39,68,0.05) 0%, rgba(201,146,42,0.07) 100%)", border: "1px solid rgba(26,39,68,0.12)", borderRadius: 12, textDecoration: "none", color: "#1a2744", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(26,39,68,0.1) 0%, rgba(201,146,42,0.15) 100%)"; e.currentTarget.style.borderColor = "rgba(201,146,42,0.4)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(26,39,68,0.05) 0%, rgba(201,146,42,0.07) 100%)"; e.currentTarget.style.borderColor = "rgba(26,39,68,0.12)"; }}
                      >
                        <span style={{ fontSize: 16 }}>{action.icon}</span>
                        <div>
                          <div style={{ lineHeight: 1.3 }}>{action.label}</div>
                          {action.desc && <div style={{ fontSize: 11, color: "#888", fontWeight: 400, lineHeight: 1.3, marginTop: 1 }}>{action.desc}</div>}
                        </div>
                        <span style={{ marginLeft: 4, color: "#c9922a", fontSize: 12 }}>→</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* 搜索状态 */}
          {statusText && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "rgba(201,146,42,0.08)", borderRadius: 10, fontSize: 12, color: "#c9922a", border: "1px solid rgba(201,146,42,0.2)", alignSelf: "flex-start" }}>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
              {statusText}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* 输入区 */}
      <div style={{
        background: "rgba(255,255,255,0.9)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderTop: "1px solid rgba(0,0,0,0.08)",
        padding: "12px 20px 16px",
        flexShrink: 0,
      }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", gap: 10, alignItems: "flex-end" }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题…（Enter 发送，Shift+Enter 换行）"
            rows={1}
            disabled={loading}
            style={{
              flex: 1,
              resize: "none",
              border: "1px solid rgba(0,0,0,0.15)",
              borderRadius: 14,
              padding: "11px 14px",
              fontSize: 14,
              outline: "none",
              fontFamily: "inherit",
              lineHeight: 1.5,
              maxHeight: 120,
              overflowY: "auto",
              color: "#1a2744",
              background: loading ? "rgba(0,0,0,0.03)" : "#fff",
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
              transition: "border-color 0.2s, box-shadow 0.2s",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(26,39,68,0.4)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(26,39,68,0.1)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(0,0,0,0.15)"; e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)"; }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              border: "none",
              background: !input.trim() || loading
                ? "rgba(26,39,68,0.1)"
                : "linear-gradient(135deg, #1a2744 0%, #c9922a 100%)",
              color: !input.trim() || loading ? "rgba(26,39,68,0.3)" : "#fff",
              cursor: !input.trim() || loading ? "default" : "pointer",
              fontSize: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 0.2s",
              boxShadow: !input.trim() || loading ? "none" : "0 2px 8px rgba(26,39,68,0.3)",
            }}
          >
            ▶
          </button>
        </div>
      </div>

      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </div>
  );
}
