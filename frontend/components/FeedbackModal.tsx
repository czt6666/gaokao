"use client";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface FeedbackModalProps {
  onClose: () => void;
}

export default function FeedbackModal({ onClose }: FeedbackModalProps) {
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (!content.trim()) { alert("请填写反馈内容"); return; }
    setSending(true);
    try {
      const res = await fetch(`${API}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim(), contact: contact.trim() }),
      });
      if (!res.ok) throw new Error("提交失败");
      setSent(true);
      setTimeout(onClose, 1500);
    } catch {
      alert("提交失败，请稍后重试");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff", borderRadius: 16, padding: "28px 24px",
          width: "min(420px, 92vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>意见反馈</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#6e6e73", cursor: "pointer" }}>×</button>
        </div>

        {sent ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>反馈已提交，感谢您的建议！</div>
            <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", marginTop: 8 }}>我们会认真阅读每一条反馈</div>
          </div>
        ) : (
          <>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="请描述您遇到的问题，或对产品提出建议…"
              style={{
                width: "100%", minHeight: 100, padding: 12, borderRadius: 10,
                border: "1px solid var(--color-separator)", fontSize: 14,
                lineHeight: 1.6, resize: "vertical", outline: "none",
                color: "var(--color-text-primary)", background: "var(--color-bg)",
              }}
            />
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="微信号 / 手机号（选填，方便我们联系您跟进）"
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 10,
                border: "1px solid var(--color-separator)", fontSize: 14,
                marginTop: 12, outline: "none",
                color: "var(--color-text-primary)", background: "var(--color-bg)",
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={sending || !content.trim()}
              style={{
                width: "100%", padding: "11px", borderRadius: 10, marginTop: 16,
                border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer",
                background: content.trim() ? "var(--color-navy)" : "#e5e5ea",
                color: content.trim() ? "#fff" : "#8e8e93",
              }}
            >
              {sending ? "提交中…" : "提交反馈"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
