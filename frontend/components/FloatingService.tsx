"use client";
import { useState } from "react";
// Customer service floating button — renders client-side only

const SUPPORT_EMAIL = "superfy@gmail.com";

export default function FloatingService() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="联系客服"
        style={{
          position: "fixed", bottom: 80, right: 16, zIndex: 1000,
          width: 48, height: 48, borderRadius: "50%",
          background: "#07C160", color: "#fff",
          border: "none", cursor: "pointer",
          boxShadow: "0 4px 16px rgba(7,193,96,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, transition: "transform 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.1)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        💬
      </button>

      {/* Popup card */}
      {open && (
        <div style={{
          position: "fixed", bottom: 136, right: 16, zIndex: 1001,
          background: "var(--color-bg-secondary, #f5f5f7)",
          border: "1px solid var(--color-separator, #e5e5ea)",
          borderRadius: 14, padding: "16px 18px", width: 220,
          boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
        }}>
          {/* Close */}
          <button
            onClick={() => setOpen(false)}
            style={{ position: "absolute", top: 8, right: 10, background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#aeaeb2" }}
          >×</button>

          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>遇到问题？联系我们</div>

          {/* Email */}
          <div style={{
            background: "var(--color-bg, #fafaf8)", borderRadius: 8,
            padding: "10px 12px", marginBottom: 10,
            fontSize: 12, color: "var(--color-text-secondary, #6e6e73)", lineHeight: 1.7,
          }}>
            发邮件至<br/>
            <strong style={{ color: "#0071E3", userSelect: "all" }}>{SUPPORT_EMAIL}</strong>
          </div>

          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            style={{
              display: "block", width: "100%", padding: "8px", borderRadius: 8, fontSize: 12,
              background: "#0071E3", color: "#fff", border: "none", cursor: "pointer",
              fontWeight: 600, marginBottom: 8, textAlign: "center", textDecoration: "none",
              boxSizing: "border-box",
            }}
          >
            发送邮件
          </a>

          <div style={{ fontSize: 10, color: "var(--color-text-tertiary, #aeaeb2)", textAlign: "center", lineHeight: 1.5 }}>
            支付问题 · 退款申请 · 数据咨询
          </div>
        </div>
      )}
    </>
  );
}
