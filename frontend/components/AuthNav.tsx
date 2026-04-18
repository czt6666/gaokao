"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface UserInfo {
  uid: number;
  phone?: string;
  wechat_nickname?: string;
  is_paid: number;
}

interface AuthNavProps {
  redirectOnLogin?: string;
}

export default function AuthNav({ redirectOnLogin }: AuthNavProps) {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
    if (!token) { setLoading(false); return; }

    fetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setUser(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function logout() {
    try { localStorage.removeItem("auth_token"); } catch {}
    setUser(null);
    setShowMenu(false);
    router.push("/");
  }

  if (loading) return <div style={{ width: 60 }} />;

  if (!user) {
    const loginUrl = redirectOnLogin
      ? `/login?redirect=${encodeURIComponent(redirectOnLogin)}`
      : "/login";
    return (
      <button
        onClick={() => router.push(loginUrl)}
        style={{
          fontSize: 13, padding: "6px 14px", borderRadius: 980,
          border: "1px solid var(--color-separator)",
          background: "transparent", color: "var(--color-text-secondary)",
          cursor: "pointer",
        }}
      >
        登录
      </button>
    );
  }

  const displayName = user.wechat_nickname
    ? user.wechat_nickname
    : user.phone
    ? `****${user.phone.slice(-4)}`
    : "我的账户";

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        onClick={() => setShowMenu((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 13, padding: "5px 12px", borderRadius: 980,
          border: "1px solid var(--color-separator)",
          background: user.is_paid ? "rgba(52,199,89,0.08)" : "transparent",
          color: "var(--color-text-secondary)",
          cursor: "pointer",
        }}
      >
        {user.is_paid ? (
          <span style={{ color: "#34c759", fontSize: 11 }}>●</span>
        ) : (
          <span style={{ color: "#ff9500", fontSize: 11 }}>●</span>
        )}
        {displayName}
      </button>

      {showMenu && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0,
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-separator)",
          borderRadius: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
          minWidth: 160, padding: "4px 0", zIndex: 999,
        }}>
          <div style={{ padding: "8px 14px 6px", borderBottom: "1px solid var(--color-separator)" }}>
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
              {user.is_paid ? "✅ 报告已解锁" : "⚠️ 未解锁报告"}
            </div>
          </div>
          <button
            onClick={() => { setShowMenu(false); router.push("/dashboard"); }}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "9px 14px", fontSize: 13, background: "none",
              border: "none", cursor: "pointer", color: "var(--color-text-primary)",
            }}
          >
            我的账户
          </button>
          <button
            onClick={logout}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "9px 14px", fontSize: 13, background: "none",
              border: "none", cursor: "pointer", color: "#ff3b30",
            }}
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
