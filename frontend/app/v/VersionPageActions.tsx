"use client";

import { useRouter } from "next/navigation";

export default function VersionPageActions() {
  const router = useRouter();
  return (
    <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 10 }}>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          padding: "10px 18px",
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 600,
          border: "1px solid var(--color-border, #dee2e6)",
          background: "var(--color-bg, #fff)",
          color: "var(--color-text-primary, #212529)",
          cursor: "pointer",
        }}
      >
        刷新
      </button>
      <button
        onClick={() => router.push("/")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "10px 18px",
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 600,
          border: "none",
          cursor: "pointer",
          background: "var(--color-accent, #0071e3)",
          color: "#fff",
        }}
      >
        返回首页
      </button>
    </div>
  );
}
