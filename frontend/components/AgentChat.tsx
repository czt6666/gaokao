"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import FeedbackModal from "./FeedbackModal";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? "https://api.theyuanxi.cn"
    : "http://localhost:8000");

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

// 将行内 Markdown（**bold**、*italic*、`code`）转为 React 节点
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
        <code
          key={`${keyPrefix}-c${i}`}
          style={{
            background: "rgba(26,39,68,0.07)",
            borderRadius: 4,
            padding: "1px 5px",
            fontSize: "0.88em",
            fontFamily: "monospace",
          }}
        >
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

// 完整 Markdown 渲染：标题、列表、分割线、加粗、斜体、行内代码
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (line.trim() === "") {
      nodes.push(<div key={i} style={{ height: 6 }} />);
      i++;
      continue;
    }

    // 分割线
    if (/^---+$/.test(line.trim())) {
      nodes.push(
        <hr key={i} style={{ border: "none", borderTop: "1px solid rgba(26,39,68,0.1)", margin: "6px 0" }} />
      );
      i++;
      continue;
    }

    // 标题 ###
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) {
      nodes.push(
        <div key={i} style={{ fontWeight: 700, fontSize: 13, color: "#1a2744", marginTop: 8, marginBottom: 2 }}>
          {renderInline(h3[1], String(i))}
        </div>
      );
      i++;
      continue;
    }

    // 标题 ##
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) {
      nodes.push(
        <div key={i} style={{ fontWeight: 700, fontSize: 14, color: "#1a2744", marginTop: 10, marginBottom: 2, borderBottom: "1px solid rgba(26,39,68,0.08)", paddingBottom: 3 }}>
          {renderInline(h2[1], String(i))}
        </div>
      );
      i++;
      continue;
    }

    // 标题 #
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) {
      nodes.push(
        <div key={i} style={{ fontWeight: 800, fontSize: 15, color: "#1a2744", marginTop: 10, marginBottom: 4 }}>
          {renderInline(h1[1], String(i))}
        </div>
      );
      i++;
      continue;
    }

    // 无序列表（- 或 *）
    if (/^[-*]\s+/.test(line)) {
      const listItems: React.ReactNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        const content = lines[i].replace(/^[-*]\s+/, "");
        listItems.push(
          <li key={i} style={{ marginBottom: 2, lineHeight: 1.6 }}>
            {renderInline(content, String(i))}
          </li>
        );
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} style={{ margin: "4px 0", paddingLeft: 18, listStyleType: "disc" }}>
          {listItems}
        </ul>
      );
      continue;
    }

    // 有序列表（1. 2. ）
    if (/^\d+\.\s+/.test(line)) {
      const listItems: React.ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\d+\.\s+/, "");
        listItems.push(
          <li key={i} style={{ marginBottom: 2, lineHeight: 1.6 }}>
            {renderInline(content, String(i))}
          </li>
        );
        i++;
      }
      nodes.push(
        <ol key={`ol-${i}`} style={{ margin: "4px 0", paddingLeft: 20 }}>
          {listItems}
        </ol>
      );
      continue;
    }

    // 普通段落
    nodes.push(
      <div key={i} style={{ lineHeight: 1.7, marginBottom: 1 }}>
        {renderInline(line, String(i))}
      </div>
    );
    i++;
  }

  return <>{nodes}</>;
}

const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content:
    "你好！我是 AI 志愿助手，支持**联网搜索**实时获取最新数据。\n\n你可以问我：\n- 「北京大学计算机专业2025录取分数线」\n- 「冲稳保志愿怎么搭配比较合理？」\n- 「物理选科适合报哪些专业？」\n- 「双非学校有哪些值得报考？」",
};

export default function AgentChat() {
  // AI 助手已隐藏，保留全部代码以便恢复
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open, statusText]);

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

      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }

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
                if (last?.pending) {
                  next[next.length - 1] = { ...last, content: accumulated };
                }
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
          } catch {
            // ignore parse errors
          }
        }
      }

      // 最终确认消息
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
      if (err instanceof Error && err.name === "AbortError") {
        // user cancelled
      } else {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.pending) {
            next[next.length - 1] = {
              role: "assistant",
              content: "请求失败，请检查网络或稍后重试。",
              pending: false,
            };
          }
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    if (loading) {
      abortRef.current?.abort();
    }
    setMessages([WELCOME_MESSAGE]);
    setInput("");
    setStatusText("");
    setLoading(false);
  };

  return (
    <>
      <style>{`
        @keyframes agentHaloPulse {
          0%   { box-shadow: 0 0 0 0 rgba(201,146,42,0.55); }
          70%  { box-shadow: 0 0 0 14px rgba(201,146,42,0); }
          100% { box-shadow: 0 0 0 0 rgba(201,146,42,0); }
        }
        @keyframes agentSparkle {
          0%, 100% { transform: scale(1) rotate(0deg); opacity: .95; }
          50%      { transform: scale(1.18) rotate(45deg); opacity: 1; }
        }
      `}</style>

      {/* ===== AI 助手已隐藏（详见 docs/hidden-features.md） ===== */}
      {/* 如需恢复，把下面 block 的 false 改为 !open 并显示按钮即可 */}
      {false && !open && (
        <span
          aria-hidden
          style={{
            position: "fixed",
            bottom: 90,
            right: 16,
            width: 56,
            height: 56,
            borderRadius: "50%",
            pointerEvents: "none",
            zIndex: 1001,
            animation: "agentHaloPulse 2.4s ease-out infinite",
          }}
        />
      )}
      {false && (
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="AI 助手 · 家长任何问题都能问"
          title="AI 助手 · 家长任何问题都能问"
          style={{
            position: "fixed",
            bottom: 90,
            right: 16,
            zIndex: 1002,
            width: 56,
            height: 56,
            borderRadius: "50%",
            border: "none",
            cursor: "pointer",
            background: "linear-gradient(135deg, #1a2744 0%, #c9922a 100%)",
            boxShadow: "0 4px 16px rgba(26,39,68,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "transform 0.2s, box-shadow 0.2s",
            color: "#fff",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.08)";
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              "0 6px 20px rgba(26,39,68,0.55)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              "0 4px 16px rgba(26,39,68,0.4)";
          }}
        >
          {open ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="#fff"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              {/* 对话气泡 */}
              <path
                d="M4 7.4a3.2 3.2 0 0 1 3.2-3.2h9.6a3.2 3.2 0 0 1 3.2 3.2v5.4a3.2 3.2 0 0 1-3.2 3.2h-3l-3.4 3.2v-3.2H7.2A3.2 3.2 0 0 1 4 12.8V7.4z"
                fill="#fff"
              />
              {/* 内部 AI 灵感星 */}
              <path
                d="M12 6.6c.25 1.65.7 2.1 2.35 2.35-1.65.25-2.1.7-2.35 2.35-.25-1.65-.7-2.1-2.35-2.35 1.65-.25 2.1-.7 2.35-2.35z"
                fill="#1a2744"
                style={{ transformOrigin: "12px 9.3px", animation: "agentSparkle 2.6s ease-in-out infinite" }}
              />
              {/* 副小星点 */}
              <circle cx="16.4" cy="12.3" r="0.9" fill="#c9922a" />
            </svg>
          )}
        </button>
      )}

      {/* ===== 问题反馈按钮（占据原 AI 助手位置） ===== */}
      <button
        onClick={() => setFeedbackOpen(true)}
        aria-label="意见反馈"
        style={{
          position: "fixed",
          bottom: 80,
          right: 16,
          zIndex: 1000,
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "rgb(7, 193, 96)",
          color: "rgb(255, 255, 255)",
          border: "none",
          cursor: "pointer",
          boxShadow: "rgba(7, 193, 96, 0.4) 0px 4px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          transition: "transform 0.15s",
          transform: "scale(1)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.08)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
        }}
      >
        💬
      </button>

      {/* 反馈弹窗 */}
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}

      {/* 对话面板 */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 154,
            right: 16,
            zIndex: 1001,
            width: 380,
            maxWidth: "calc(100vw - 32px)",
            height: "min(600px, calc(100vh - 186px))",
            display: "flex",
            flexDirection: "column",
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderRadius: 18,
            boxShadow: "0 8px 40px rgba(26,39,68,0.22)",
            border: "1px solid rgba(201,146,42,0.18)",
            overflow: "hidden",
          }}
        >
          {/* 标题栏 */}
          <div
            style={{
              background: "linear-gradient(90deg, #1a2744 0%, #2b4a8a 100%)",
              padding: "14px 16px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0,
            }}
          >
            <div>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>
                ✦ AI 志愿助手
              </div>
              <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 2 }}>
                联网搜索 · 实时分析
              </div>
            </div>
            <button
              onClick={clearChat}
              title="清空对话"
              style={{
                background: "rgba(255,255,255,0.12)",
                border: "none",
                borderRadius: 8,
                color: "rgba(255,255,255,0.75)",
                fontSize: 12,
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              清空
            </button>
          </div>

          {/* 消息列表 */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                {/* 气泡 */}
                <div
                  style={
                    msg.role === "user"
                      ? {
                          background: "linear-gradient(135deg, #1a2744 0%, #2b4a8a 100%)",
                          color: "#fff",
                          borderRadius: "14px 14px 4px 14px",
                          padding: "10px 14px",
                          maxWidth: "85%",
                          fontSize: 13.5,
                          lineHeight: 1.6,
                          wordBreak: "break-word",
                        }
                      : {
                          background: "#fff",
                          color: "#1a2744",
                          borderRadius: "14px 14px 14px 4px",
                          padding: "10px 14px",
                          maxWidth: "95%",
                          fontSize: 13.5,
                          lineHeight: 1.7,
                          wordBreak: "break-word",
                          boxShadow: "0 1px 6px rgba(26,39,68,0.08)",
                          border: "1px solid rgba(26,39,68,0.06)",
                        }
                  }
                >
                  {msg.pending && !msg.content ? (
                    <span style={{ opacity: 0.5 }}>
                      <LoadingDots />
                    </span>
                  ) : (
                    renderMarkdown(msg.content)
                  )}
                </div>

                {/* 来源 / 搜索标记 */}
                {msg.role === "assistant" && msg.searched && (
                  <div style={{ marginTop: 6, maxWidth: "95%" }}>
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
                              <a
                                key={si}
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  fontSize: 11,
                                  color: "#c9922a",
                                  textDecoration: "none",
                                  padding: "2px 8px",
                                  background: "rgba(201,146,42,0.07)",
                                  borderRadius: 6,
                                  border: "1px solid rgba(201,146,42,0.2)",
                                }}
                              >
                                🔗 {label}
                              </a>
                            );
                          })}
                        </div>
                      </>
                    ) : msg.searchQuery ? (
                      <div style={{ fontSize: 11, color: "#c9922a", display: "flex", alignItems: "center", gap: 4 }}>
                        🔍 联网搜索：{msg.searchQuery}
                      </div>
                    ) : null}
                  </div>
                )}

                {/* 意图导航按钮 */}
                {msg.role === "assistant" && msg.actions && msg.actions.length > 0 && (
                  <div style={{ marginTop: 10, maxWidth: "95%", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 11, color: "#888" }}>快速跳转</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {msg.actions.map((action, ai) => (
                        <a
                          key={ai}
                          href={action.url}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "7px 12px",
                            background: "linear-gradient(135deg, rgba(26,39,68,0.06) 0%, rgba(201,146,42,0.08) 100%)",
                            border: "1px solid rgba(26,39,68,0.12)",
                            borderRadius: 10,
                            textDecoration: "none",
                            color: "#1a2744",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            transition: "all 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "linear-gradient(135deg, rgba(26,39,68,0.1) 0%, rgba(201,146,42,0.15) 100%)";
                            e.currentTarget.style.borderColor = "rgba(201,146,42,0.4)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "linear-gradient(135deg, rgba(26,39,68,0.06) 0%, rgba(201,146,42,0.08) 100%)";
                            e.currentTarget.style.borderColor = "rgba(26,39,68,0.12)";
                          }}
                        >
                          <span style={{ fontSize: 14 }}>{action.icon}</span>
                          <div>
                            <div style={{ lineHeight: 1.3 }}>{action.label}</div>
                            {action.desc && (
                              <div style={{ fontSize: 10, color: "#888", fontWeight: 400, lineHeight: 1.3, marginTop: 1 }}>{action.desc}</div>
                            )}
                          </div>
                          <span style={{ marginLeft: 2, color: "#c9922a", fontSize: 11 }}>→</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* 搜索状态条 */}
            {statusText && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  background: "rgba(201,146,42,0.08)",
                  borderRadius: 10,
                  fontSize: 12,
                  color: "#c9922a",
                  border: "1px solid rgba(201,146,42,0.2)",
                  alignSelf: "flex-start",
                }}
              >
                <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>
                  ⟳
                </span>
                {statusText}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* 输入区 */}
          <div
            style={{
              padding: "10px 12px 12px",
              borderTop: "1px solid rgba(26,39,68,0.07)",
              flexShrink: 0,
              background: "rgba(255,255,255,0.8)",
              display: "flex",
              gap: 8,
              alignItems: "flex-end",
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入问题... (Enter 发送，Shift+Enter 换行)"
              rows={1}
              disabled={loading}
              style={{
                flex: 1,
                resize: "none",
                border: "1px solid rgba(26,39,68,0.15)",
                borderRadius: 12,
                padding: "9px 12px",
                fontSize: 13.5,
                outline: "none",
                fontFamily: "inherit",
                lineHeight: 1.5,
                maxHeight: 100,
                overflowY: "auto",
                color: "#1a2744",
                background: loading ? "rgba(0,0,0,0.03)" : "#fff",
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "rgba(26,39,68,0.4)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "rgba(26,39,68,0.15)";
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                border: "none",
                background:
                  !input.trim() || loading
                    ? "rgba(26,39,68,0.12)"
                    : "linear-gradient(135deg, #1a2744 0%, #c9922a 100%)",
                color: !input.trim() || loading ? "rgba(26,39,68,0.3)" : "#fff",
                cursor: !input.trim() || loading ? "default" : "pointer",
                fontSize: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "background 0.2s",
              }}
            >
              ▶
            </button>
          </div>
        </div>
      )}

      {/* CSS 动画 */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes blink { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
      `}</style>
    </>
  );
}

function LoadingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "#1a2744",
            display: "inline-block",
            animation: `blink 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </span>
  );
}
