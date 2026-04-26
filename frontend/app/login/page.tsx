"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Step = "input" | "verify";

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|Android|Mobile|WeChat|MicroMessenger/i.test(navigator.userAgent);
}

function isInWeChatBrowser() {
  if (typeof navigator === "undefined") return false;
  return /MicroMessenger/i.test(navigator.userAgent);
}

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("input");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // WeChat QR code state (desktop only)
  const [wechatMode, setWechatMode] = useState<"idle" | "qr" | "done" | "error">("idle");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrRefreshKey, setQrRefreshKey] = useState(0);
  const [copyHinted, setCopyHinted] = useState(false);      // 复制链接提示
  const [showWxHint, setShowWxHint] = useState(false);      // 手机非微信浏览器提示
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const sessionRef = useRef<string | null>(null);

  const redirectTarget =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("redirect") ||
        new URLSearchParams(window.location.search).get("redirect_to") ||
        "/"
      : "/";

  // Handle WeChat OAuth callback token (mobile flow returns token in URL)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const qrDone = params.get("qr_done");
    if (token) {
      localStorage.setItem("auth_token", token);
      router.push(params.get("redirect_to") || params.get("redirect") || "/");
    }
    if (qrDone === "1") {
      setWechatMode("done");
    }
  }, [router]);

  // Cleanup polling on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function startCountdown() {
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((c) => { if (c <= 1) { clearInterval(timer); return 0; } return c - 1; });
    }, 1000);
  }

  async function handleWechatLogin() {
    // 手机微信内：直跳 OAuth 授权
    if (isMobileDevice() && isInWeChatBrowser()) {
      window.location.href = `${API}/api/auth/wechat/mp/authorize?redirect_to=${encodeURIComponent(redirectTarget)}`;
      return;
    }
    // 手机非微信浏览器：提示复制链接去微信打开（必须带完整路径+参数）
    if (isMobileDevice() && !isInWeChatBrowser()) {
      setShowWxHint(true);
      return;
    }
    // 桌面端：显示二维码

    try {
      const res = await fetch(`${API}/api/auth/qr/create`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.detail || "微信登录暂时不可用，请使用手机号登录");
        return;
      }
      const { session_id, wechat_url } = await res.json();
      sessionRef.current = session_id;
      setQrUrl(wechat_url);
      setWechatMode("qr");
      startQrPoll(session_id);
    } catch {
      setError("网络错误，请稍后重试");
    }
  }

  function startQrPoll(sessionId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/auth/qr/poll/${sessionId}`);
        if (!res.ok) return;
        const d = await res.json();
        if (d.status === "success") {
          clearInterval(pollRef.current!);
          localStorage.setItem("auth_token", d.token);
          setWechatMode("done");
          setTimeout(() => router.push(redirectTarget), 800);
        } else if (d.status === "expired") {
          clearInterval(pollRef.current!);
          setWechatMode("error");
        }
      } catch {}
    }, 2000);
  }

  function refreshQr() {
    if (pollRef.current) clearInterval(pollRef.current);
    setQrUrl(null);
    setWechatMode("idle");
    setQrRefreshKey((k) => k + 1);
  }

  async function sendCode() {
    if (!/^1[3-9]\d{9}$/.test(phone)) { setError("请输入有效的手机号码"); return; }
    setError(""); setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/sms/send`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (res.ok) { setStep("verify"); startCountdown(); }
      else { const d = await res.json(); setError(d.detail || "发送失败，请稍后重试"); }
    } catch { setError("网络错误，请稍后重试"); }
    finally { setLoading(false); }
  }

  async function verifyCode() {
    if (code.length !== 6) { setError("请输入6位验证码"); return; }
    setError(""); setLoading(true);
    try {
      const refCode = typeof window !== "undefined" ? localStorage.getItem("gaokao_ref") || "" : "";
      const res = await fetch(`${API}/api/auth/sms/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, ref_code: refCode }),
      });
      if (res.ok) {
        const d = await res.json();
        localStorage.setItem("auth_token", d.token);
        localStorage.setItem("auth_phone", phone);
        router.push(redirectTarget);
      } else { const d = await res.json(); setError(d.detail || "验证码错误"); }
    } catch { setError("网络错误，请稍后重试"); }
    finally { setLoading(false); }
  }

  // ── WeChat QR code view ──────────────────────────────────────────────────
  if (wechatMode === "done") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--color-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>✅</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>微信登录成功</div>
          <div style={{ fontSize: 14, color: "var(--color-text-tertiary)", marginTop: 8 }}>正在跳转…</div>
        </div>
      </div>
    );
  }

  if (wechatMode === "qr" || wechatMode === "error") {
    const qrImgUrl = qrUrl
      ? `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrUrl)}&size=180x180&bgcolor=ffffff&color=000000&margin=4`
      : null;
    return (
      <div style={{ minHeight: "100vh", background: "var(--color-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ width: "100%", maxWidth: 360, background: "var(--color-surface)", borderRadius: 20, padding: "36px 28px", boxShadow: "var(--shadow-lg)", border: "1px solid var(--color-separator)", textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>微信扫码登录</div>
          <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", marginBottom: 24 }}>用微信扫描下方二维码</div>

          {wechatMode === "error" ? (
            <div>
              <div style={{ fontSize: 13, color: "var(--color-danger)", marginBottom: 16 }}>二维码已过期</div>
              <button className="btn-secondary" onClick={refreshQr} style={{ fontSize: 14, padding: "10px 24px", borderRadius: 980 }}>刷新二维码</button>
            </div>
          ) : (
            <div style={{ position: "relative", display: "inline-block" }}>
              {qrImgUrl ? (
                <img src={qrImgUrl} alt="微信扫码" style={{ width: 180, height: 180, borderRadius: 12, display: "block" }} />
              ) : (
                <div style={{ width: 180, height: 180, background: "var(--color-bg-secondary)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div className="spinner" style={{ width: 24, height: 24 }} />
                </div>
              )}
              {/* WeChat logo overlay */}
              <div style={{ position: "absolute", bottom: -12, left: "50%", transform: "translateX(-50%)", background: "#07c160", borderRadius: "50%", width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M8.69 11.3c-.65 0-1.17-.53-1.17-1.18s.52-1.18 1.17-1.18 1.17.53 1.17 1.18-.52 1.18-1.17 1.18zm6.62 0c-.65 0-1.17-.53-1.17-1.18s.52-1.18 1.17-1.18 1.17.53 1.17 1.18-.52 1.18-1.17 1.18z"/></svg>
              </div>
            </div>
          )}

          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 28, marginBottom: 20 }}>
            扫码后在手机上点击确认即可完成登录
          </div>

          <button
            style={{ background: "none", border: "none", fontSize: 13, color: "var(--color-accent)", cursor: "pointer" }}
            onClick={refreshQr}
          >
            ← 返回手机号登录
          </button>
        </div>
      </div>
    );
  }

  // ── Main login form ──────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      {/* 手机非微信浏览器：提示去微信打开（复制完整链接，含路径+参数） */}
      {showWxHint && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ width: "100%", maxWidth: 340, background: "var(--color-surface)", borderRadius: 16, padding: "28px 24px", textAlign: "center", boxShadow: "var(--shadow-lg)" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>微信登录需在微信中打开</div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6, marginBottom: 20 }}>
              点击按钮复制当前页面链接，发送到微信（文件传输助手或好友），在微信内打开即可一键登录。
            </div>
            <button
              className="btn-primary"
              style={{ width: "100%", fontSize: 15, padding: "12px 0", marginBottom: 10 }}
              onClick={() => {
                const url = typeof window !== "undefined" ? window.location.href : "";
                try {
                  navigator.clipboard.writeText(url);
                  setCopyHinted(true);
                  setTimeout(() => setCopyHinted(false), 2500);
                } catch {
                  // fallback
                  const ta = document.createElement("textarea");
                  ta.value = url;
                  document.body.appendChild(ta);
                  ta.select();
                  document.execCommand("copy");
                  document.body.removeChild(ta);
                  setCopyHinted(true);
                  setTimeout(() => setCopyHinted(false), 2500);
                }
              }}
            >
              {copyHinted ? "✓ 已复制，去微信粘贴打开" : "复制链接，去微信中打开"}
            </button>
            <button
              style={{ width: "100%", fontSize: 14, padding: "10px 0", background: "none", border: "none", color: "var(--color-text-tertiary)", cursor: "pointer" }}
              onClick={() => setShowWxHint(false)}
            >
              改用手机号登录
            </button>
          </div>
        </div>
      )}

      <div style={{ width: "100%", maxWidth: 400, background: "var(--color-surface)", borderRadius: 20, padding: "40px 32px", boxShadow: "var(--shadow-lg)", border: "1px solid var(--color-separator)" }}>

        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 6 }}>
            继续使用志愿决策引擎
          </div>
          <div style={{ fontSize: 14, color: "var(--color-text-tertiary)" }}>
            {step === "input" ? "登录或注册，付费记录自动绑定" : `验证码已发送至 ${phone}`}
          </div>
        </div>

        {step === "input" ? (
          <div>
            <input
              className="apple-input"
              type="tel"
              placeholder="手机号"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendCode()}
              style={{ marginBottom: 12, fontSize: 16 }}
              maxLength={11}
            />
            {error && <div style={{ fontSize: 13, color: "var(--color-danger)", marginBottom: 10 }}>{error}</div>}
            <button
              className="btn-primary"
              onClick={sendCode}
              disabled={loading}
              style={{ width: "100%", fontSize: 16, padding: "14px 0", opacity: loading ? 0.6 : 1 }}
            >
              {loading ? "发送中…" : "获取验证码"}
            </button>

            <div style={{ display: "flex", alignItems: "center", margin: "20px 0", gap: 12 }}>
              <div style={{ flex: 1, height: 1, background: "var(--color-separator)" }} />
              <span style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>或</span>
              <div style={{ flex: 1, height: 1, background: "var(--color-separator)" }} />
            </div>

            <button
              className="btn-secondary"
              style={{ width: "100%", fontSize: 15, padding: "13px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
              onClick={handleWechatLogin}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#07c160">
                <path d="M8.69 12.15c-.65 0-1.17-.53-1.17-1.18s.52-1.18 1.17-1.18 1.17.53 1.17 1.18-.52 1.18-1.17 1.18zm6.62 0c-.65 0-1.17-.53-1.17-1.18s.52-1.18 1.17-1.18 1.17.53 1.17 1.18-.52 1.18-1.17 1.18zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
              </svg>
              {isMobileDevice() ? "微信一键登录" : "微信扫码登录"}
            </button>
          </div>
        ) : (
          <div>
            <input
              className="apple-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="6位验证码"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && verifyCode()}
              style={{ marginBottom: 12, fontSize: 20, letterSpacing: "0.2em", textAlign: "center" }}
              maxLength={6}
            />
            {error && <div style={{ fontSize: 13, color: "var(--color-danger)", marginBottom: 10 }}>{error}</div>}
            <button
              className="btn-primary"
              onClick={verifyCode}
              disabled={loading}
              style={{ width: "100%", fontSize: 16, padding: "14px 0", opacity: loading ? 0.6 : 1, marginBottom: 12 }}
            >
              {loading ? "验证中…" : "确认登录"}
            </button>
            {countdown > 0 ? (
              <div style={{ textAlign: "center", fontSize: 14, color: "var(--color-text-tertiary)", padding: "8px 0" }}>
                重新发送（{countdown}s）
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "center", gap: 20, paddingTop: 4 }}>
                <button
                  style={{ background: "none", border: "none", fontSize: 14, color: "var(--color-accent)", cursor: "pointer", padding: "8px 0" }}
                  disabled={loading}
                  onClick={() => { setCode(""); setError(""); sendCode(); }}
                >
                  重新发送
                </button>
                <button
                  style={{ background: "none", border: "none", fontSize: 14, color: "var(--color-text-tertiary)", cursor: "pointer", padding: "8px 0" }}
                  onClick={() => { setStep("input"); setCode(""); setError(""); }}
                >
                  修改手机号
                </button>
              </div>
            )}
          </div>
        )}

        <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", textAlign: "center", marginTop: 24, lineHeight: 1.6 }}>
          登录即代表同意
          <a href="/terms" style={{ color: "var(--color-accent)", textDecoration: "none" }}>《用户协议》</a>
          和
          <a href="/privacy" style={{ color: "var(--color-accent)", textDecoration: "none" }}>《隐私政策》</a>
        </p>
      </div>

    </div>
  );
}
