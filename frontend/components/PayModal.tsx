"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// 唯一产品：2026高考填报季
const PRODUCT = {
  productType: "single_report",
  price: 1.99,
  label: "解锁完整报告",
  desc: "本次查询的完整分析报告",
};

interface PayModalProps {
  onClose: () => void;
  onSuccess?: (orderNo: string) => void;
  queryParams?: { province?: string; rank?: number; subject?: string };
  totalSchools?: number;
  isPaid?: boolean; // 由父组件传入，替代 localStorage 判断
}

type OrderStatus = "idle" | "pending" | "paid" | "failed" | "timeout";

export default function PayModal({ onClose, onSuccess, queryParams, totalSchools, isPaid }: PayModalProps) {
  const router = useRouter();

  // Key for persisting pending payment across page reloads (iOS Safari kills bg tabs)
  const pendingKey = queryParams
    ? `pay_pending_${queryParams.province || ""}_${queryParams.rank || ""}_${queryParams.subject || ""}`
    : "pay_pending_unknown";

  const [orderNo, setOrderNo] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [status, setStatus] = useState<OrderStatus>("idle");
  const [creating, setCreating] = useState(false);
  const [payConfirmed, setPayConfirmed] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const [manualCheckLoading, setManualCheckLoading] = useState(false);
  const [manualCheckResult, setManualCheckResult] = useState<"idle" | "not_paid" | "error">("idle");
  const [qrExpiry, setQrExpiry] = useState(0);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const pollStartRef = useRef<number>(0);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  const POLL_TIMEOUT_MS = 8 * 60 * 1000;

  const isMobile = typeof window !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const isWeChat = typeof window !== "undefined" && /MicroMessenger/i.test(navigator.userAgent);
  const isLoggedIn = typeof window !== "undefined" && !!localStorage.getItem("auth_token");

  // 支付环境分支：微信内 JSAPI / 手机外 H5 / 桌面 Native 二维码
  type PayEnv = "wechat_jsapi" | "h5" | "native";
  const payEnv: PayEnv = isMobile && isWeChat ? "wechat_jsapi" : isMobile ? "h5" : "native";

  // 微信内 JSAPI 需要的 openid（由 results 页 OAuth2 静默授权后写入 sessionStorage）
  const [openid, setOpenid] = useState<string>("");
  useEffect(() => {
    if (payEnv !== "wechat_jsapi") return;
    try {
      const s = sessionStorage.getItem("wx_openid");
      if (s) setOpenid(s);
    } catch {}
  }, [payEnv]);

  const [h5Url, setH5Url] = useState<string | null>(null);
  const [jsapiError, setJsapiError] = useState<string>("");
  const [fallbackUsed, setFallbackUsed] = useState(false); // 当原本应该 H5/JSAPI 但失败回退到二维码

  // QR 倒计时
  useEffect(() => {
    if (qrExpiry <= 0) return;
    const t = setTimeout(() => {
      setQrExpiry((s) => {
        if (s <= 1) {
          setStatus("timeout");
          try { localStorage.removeItem(pendingKey); } catch {}
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [qrExpiry]);

  // 卸载时清理轮询
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // 从 localStorage 恢复待付款订单（应对 iOS Safari 后台杀页面）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(pendingKey);
      if (!saved) return;
      const { orderNo: no, qrCode: qr, timestamp } = JSON.parse(saved);
      // QR 码 2 小时内有效
      if (no && qr && Date.now() - timestamp < 2 * 60 * 60 * 1000) {
        const remainSecs = Math.max(0, Math.floor((timestamp + 2 * 60 * 60 * 1000 - Date.now()) / 1000));
        setOrderNo(no);
        setQrCode(qr);
        setQrExpiry(remainSecs);
        setStatus("pending");
        setPayConfirmed(true);
        startPolling(no);
      } else {
        localStorage.removeItem(pendingKey);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fallbackToNative(): Promise<boolean> {
    // H5/JSAPI 失败兜底：调 Native 接口拿 code_url 渲染二维码
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
      const res = await fetch(`${API}/api/payment/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          product_type: PRODUCT.productType,
          pay_method: "wechat",
          province: queryParams?.province || "",
          rank_input: queryParams?.rank || 0,
          subject: queryParams?.subject || "",
        }),
      });
      if (!res.ok) return false;
      const d = await res.json();
      const qr = d.qr_code || d.code_url || null;
      if (!qr || d.error) return false;
      setOrderNo(d.order_no);
      setQrCode(qr);
      setQrExpiry(7200);
      setFallbackUsed(true);
      setStatus("pending");
      try {
        localStorage.setItem(pendingKey, JSON.stringify({
          orderNo: d.order_no, qrCode: qr, timestamp: Date.now(),
        }));
      } catch {}
      startPolling(d.order_no);
      return true;
    } catch {
      return false;
    }
  }

  async function createOrder() {
    if (pollRef.current) clearInterval(pollRef.current);
    setCreating(true);
    setQrCode(null);
    setH5Url(null);
    setJsapiError("");
    setFallbackUsed(false);
    setStatus("pending");

    const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const basePayload = {
      product_type: PRODUCT.productType,
      province: queryParams?.province || "",
      rank_input: queryParams?.rank || 0,
      subject: queryParams?.subject || "",
    };

    try {
      if (payEnv === "native") {
        // 桌面端：Native 二维码
        const res = await fetch(`${API}/api/payment/create`, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...basePayload, pay_method: "wechat" }),
        });
        if (!res.ok) { setStatus("failed"); return; }
        const d = await res.json();
        if (d.error) { setStatus("failed"); return; }
        const resolvedQr = d.qr_code || d.code_url || null;
        setOrderNo(d.order_no);
        setQrCode(resolvedQr);
        setQrExpiry(7200);
        try {
          localStorage.setItem(pendingKey, JSON.stringify({
            orderNo: d.order_no, qrCode: resolvedQr, timestamp: Date.now(),
          }));
        } catch {}
        startPolling(d.order_no);

      } else if (payEnv === "h5") {
        // 手机浏览器（非微信）：H5 支付，跳微信 App
        const res = await fetch(`${API}/api/payment/wechat/h5`, {
          method: "POST",
          headers,
          body: JSON.stringify(basePayload),
        });
        const httpFailed = !res.ok;
        let d: any = null;
        if (!httpFailed) { try { d = await res.json(); } catch {} }
        if (httpFailed || !d || d.error || !d.h5_url) {
          // H5 失败（多半是商户号未开通 H5 支付）→ 兜底到 Native 二维码
          const ok = await fallbackToNative();
          if (!ok) { setJsapiError("当前网络不支持 H5 支付"); setStatus("failed"); }
          return;
        }
        setOrderNo(d.order_no);
        // 持久化，等用户从微信返回时继续查单
        try {
          localStorage.setItem(pendingKey, JSON.stringify({
            orderNo: d.order_no, h5: true, timestamp: Date.now(),
          }));
        } catch {}
        // 构造 redirect_url：支付完成后用户点"返回商家"回到本页，URL 带 ?paid=<order_no>
        const origin = window.location.origin;
        const qp = new URLSearchParams({
          province: queryParams?.province || "",
          rank: String(queryParams?.rank || ""),
          subject: queryParams?.subject || "",
          paid: d.order_no,
        });
        const redirectUrl = `${origin}/results?${qp.toString()}`;
        const finalUrl = `${d.h5_url}${d.h5_url.includes("?") ? "&" : "?"}redirect_url=${encodeURIComponent(redirectUrl)}`;
        setH5Url(finalUrl);
        // 直接跳转到微信 H5 支付中间页
        window.location.href = finalUrl;

      } else {
        // 微信内：公众号 JSAPI
        if (!openid) {
          const SERVICE_APPID = process.env.NEXT_PUBLIC_WECHAT_SERVICE_APP_ID || "";
          if (!SERVICE_APPID) {
            setJsapiError("服务号未配置，请联系客服（NEXT_PUBLIC_WECHAT_SERVICE_APP_ID 缺失）");
            setStatus("failed");
            return;
          }
          // 主动跳 OAuth2 静默授权，回跳后由 results 页换 openid 写入 sessionStorage
          setJsapiError("正在跳转微信授权…");
          try { sessionStorage.removeItem("wx_openid"); } catch {}
          const redirect = encodeURIComponent(window.location.href);
          window.location.href =
            `https://open.weixin.qq.com/connect/oauth2/authorize` +
            `?appid=${SERVICE_APPID}&redirect_uri=${redirect}` +
            `&response_type=code&scope=snsapi_base&state=wxpay#wechat_redirect`;
          return;
        }
        const res = await fetch(`${API}/api/payment/wechat/jsapi_web`, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...basePayload, openid }),
        });
        const httpFailed = !res.ok;
        let d: any = null;
        if (!httpFailed) { try { d = await res.json(); } catch {} }
        if (httpFailed || !d || d.error || !d.pay_params) {
          // JSAPI 创建失败 → 兜底二维码（在微信内只能由其他设备扫，但比报错强）
          const ok = await fallbackToNative();
          if (!ok) { setJsapiError(d?.error || "下单失败"); setStatus("failed"); }
          return;
        }
        setOrderNo(d.order_no);
        try {
          localStorage.setItem(pendingKey, JSON.stringify({
            orderNo: d.order_no, jsapi: true, timestamp: Date.now(),
          }));
        } catch {}
        invokeWxJsapi(d.pay_params, d.order_no);
      }
    } catch (e) {
      if (payEnv !== "native") {
        const ok = await fallbackToNative();
        if (!ok) setStatus("failed");
      } else {
        setStatus("failed");
      }
    } finally {
      setCreating(false);
    }
  }

  function invokeWxJsapi(payParams: any, orderNoVal: string) {
    const invoke = () => {
      const bridge: any = (window as any).WeixinJSBridge;
      if (!bridge) {
        setJsapiError("当前环境不支持微信支付");
        setStatus("failed");
        return;
      }
      bridge.invoke("getBrandWCPayRequest", payParams, (res: any) => {
        const msg = res && res.err_msg;
        if (msg === "get_brand_wcpay_request:ok") {
          // 调起成功，开始轮询订单状态（最终以回调为准）
          startPolling(orderNoVal);
        } else if (msg === "get_brand_wcpay_request:cancel") {
          setJsapiError("您已取消支付");
          setStatus("failed");
        } else {
          setJsapiError(msg || "支付调起失败");
          setStatus("failed");
        }
      });
    };
    if (typeof (window as any).WeixinJSBridge === "undefined") {
      document.addEventListener("WeixinJSBridgeReady", invoke, false);
    } else {
      invoke();
    }
  }

  function startPolling(no: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollStartRef.current = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - pollStartRef.current > POLL_TIMEOUT_MS) {
        clearInterval(pollRef.current!);
        setStatus("timeout");
        try { localStorage.removeItem(pendingKey); } catch {}
        return;
      }
      try {
        const res = await fetch(`${API}/api/payment/status/${no}`);
        if (res.ok) {
          const d = await res.json();
          if (d.status === "paid") {
            clearInterval(pollRef.current!);
            setStatus("paid");
            try {
              localStorage.setItem("gaokao_order", no);
              localStorage.removeItem(pendingKey); // 清除待付款记录
            } catch {}
            setTimeout(() => { onSuccessRef.current?.(no); }, 1500);
          }
        }
      } catch {}
    }, 3000);
  }

  async function manualCheck() {
    if (!orderNo || manualCheckLoading) return;
    setManualCheckLoading(true);
    try {
      const res = await fetch(`${API}/api/payment/status/${orderNo}`);
      if (res.ok) {
        const d = await res.json();
        if (d.status === "paid") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("paid");
          try {
            localStorage.setItem("gaokao_order", orderNo);
            localStorage.removeItem(pendingKey);
          } catch {}
          setTimeout(() => { onSuccess?.(orderNo); }, 1500);
        } else {
          setManualCheckResult("not_paid");
          setTimeout(() => setManualCheckResult("idle"), 3000);
        }
      }
    } catch {
      setManualCheckResult("error");
      setTimeout(() => setManualCheckResult("idle"), 3000);
    } finally {
      setManualCheckLoading(false);
    }
  }

  // ── 支付成功界面 ──
  if (status === "paid") {
    const shareText = `我刚用「水卢冷门高报引擎」查了高考志愿，${queryParams?.province || ""}位次${queryParams?.rank || ""}的冷门宝藏学校一键筛出来了！还有就业薪资分析，比机构便宜多了 👉 www.theyuanxi.cn`;
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-sheet" style={{ padding: "32px 28px", textAlign: "center", maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 48, marginBottom: 12, lineHeight: 1 }}>✅</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>支付成功</div>

          <div style={{
            background: "rgba(52,199,89,0.06)", border: "1px solid rgba(52,199,89,0.2)",
            borderRadius: 10, padding: "12px 16px", margin: "14px 0", textAlign: "left",
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#34c759", marginBottom: 6 }}>
              解锁完整报告 · ¥1.99
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              有效期至：<strong>2026年7月31日</strong> · 期内可无限次重新查询
            </div>
          </div>

          <div style={{
            background: "var(--color-bg-secondary)", borderRadius: 10,
            padding: "12px 14px", marginBottom: 14, textAlign: "left",
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>分享给同学家长，帮他们也找到冷门机会</div>
            <div style={{
              fontSize: 11, color: "var(--color-text-secondary)", background: "var(--color-bg)",
              borderRadius: 6, padding: "8px 10px", lineHeight: 1.5, marginBottom: 8, wordBreak: "break-all",
            }}>
              {shareText}
            </div>
            <button
              onClick={() => {
                try { navigator.clipboard.writeText(shareText); } catch {}
                setCopyDone(true);
                setTimeout(() => setCopyDone(false), 2500);
              }}
              style={{
                width: "100%", padding: "8px", borderRadius: 8, fontSize: 13,
                background: copyDone ? "#34C759" : "#07C160", color: "#fff",
                border: "none", cursor: "pointer", fontWeight: 600, transition: "background 0.2s",
              }}
            >
              {copyDone ? "✓ 已复制，粘贴到微信发送即可" : "复制分享文案"}
            </button>
          </div>

          <button onClick={onClose} style={{
            width: "100%", padding: "10px", borderRadius: 8, fontSize: 13,
            background: "var(--color-accent)", color: "#fff", border: "none", cursor: "pointer",
          }}>
            查看完整报告 →
          </button>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 10 }}>祝高考顺利！</div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" style={{ padding: "24px 24px 28px", maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>

        {/* 标题 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.2, marginBottom: 4 }}>
              解锁{totalSchools ? ` ${totalSchools} 所` : "全部"}院校完整分析
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              冷门价值 · 就业薪资 · 2026专项因素 · 填报策略
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: "var(--color-text-tertiary)", cursor: "pointer", padding: "0 4px", marginTop: -2 }}>×</button>
        </div>

        {/* 已解锁提示（由父组件传入 isPaid） */}
        {isPaid && (
          <div style={{
            background: "rgba(52,199,89,0.08)", border: "1px solid rgba(52,199,89,0.3)",
            borderRadius: 8, padding: "10px 12px", marginBottom: 14, fontSize: 12, color: "#1a7f37",
          }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>您已解锁过报告</div>
            <div style={{ lineHeight: 1.5 }}>
              请关闭此窗口，刷新页面即可查看。如未显示请
              <a href="/dashboard" style={{ color: "var(--color-accent)", marginLeft: 4 }}>检查账户 →</a>
            </div>
          </div>
        )}

        {/* 解锁内容清单 */}
        <div style={{
          background: "var(--color-bg-secondary)", borderRadius: 10,
          padding: "10px 14px", marginBottom: 14, fontSize: 12,
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 12px",
          color: "var(--color-text-secondary)",
        }}>
          {["💎 冷门价值分析", "💼 就业薪资详情", "⚡ 2026专项因素", "⚠️ 风险精准提示", "✅ 最佳填报位置", "🗣 学生真实口碑"].map((item) => (
            <div key={item} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ color: "#34c759", fontSize: 11, flexShrink: 0 }}>✓</span>
              <span>{item}</span>
            </div>
          ))}
        </div>

        {/* 定价块 — 唯一方案 */}
        <div style={{
          background: "rgba(201,146,42,0.06)", border: "2px solid var(--color-accent)",
          borderRadius: 12, padding: "14px 16px", marginBottom: 12,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)" }}>
              2026高考填报季完整解锁
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 3 }}>
              即日起至 2026年7月31日 · 无限次重新查询
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: "var(--color-accent)", lineHeight: 1 }}>¥1.99</div>
            <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 2, textDecoration: "line-through" }}>机构收费¥3000+</div>
          </div>
        </div>

        {/* 确认 + 支付区域 */}
        {!payConfirmed ? (
          <div style={{
            background: "rgba(0,113,227,0.04)", border: "1px solid rgba(0,113,227,0.18)",
            borderRadius: 12, padding: "14px 16px", marginBottom: 12,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>确认支付内容</div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6, marginBottom: 10 }}>
              <div>套餐：<strong style={{ color: "var(--color-text-primary)" }}>2026填报季 · ¥1.99</strong></div>
              {queryParams?.province && <div>省份：<strong style={{ color: "var(--color-text-primary)" }}>{queryParams.province}</strong></div>}
              {queryParams?.rank && <div>位次：<strong style={{ color: "var(--color-text-primary)" }}>{queryParams.rank.toLocaleString()} 名</strong></div>}
              <div style={{ marginTop: 6, padding: "5px 8px", background: "rgba(255,59,48,0.06)", borderRadius: 6, color: "#c0392b", fontSize: 11 }}>
                ⚠️ 本报告为虚拟数字商品，支付成功后立即交付，不支持退款。
              </div>
            </div>
            {!isLoggedIn ? (
              /* 未登录：强制先登录，支付后账户自动绑定 */
              <button
                onClick={() => {
                  const redirect = typeof window !== "undefined"
                    ? window.location.pathname + window.location.search
                    : "/results";
                  router.push(`/login?redirect=${encodeURIComponent(redirect)}`);
                }}
                style={{
                  width: "100%", padding: "11px", borderRadius: 8, fontSize: 14,
                  background: "#07C160", color: "#fff", border: "none", cursor: "pointer", fontWeight: 700,
                }}
              >
                登录后支付 →
              </button>
            ) : (
              <button
                onClick={() => { setPayConfirmed(true); createOrder(); }}
                style={{
                  width: "100%", padding: "11px", borderRadius: 8, fontSize: 14,
                  background: "var(--color-accent)", color: "#fff", border: "none", cursor: "pointer", fontWeight: 700,
                }}
              >
                {payEnv === "native" ? "确认，显示支付码 →" : payEnv === "h5" ? "确认，微信支付 →" : "确认，调起微信支付 →"}
              </button>
            )}
          </div>
        ) : (

          /* 支付码区域 */
          <div style={{
            background: "var(--color-bg-secondary)", borderRadius: 12, padding: "16px",
            display: "flex", flexDirection: "column", alignItems: "center",
            marginBottom: 12, minHeight: 150, justifyContent: "center",
          }}>
            {creating ? (
              <div className="spinner" style={{ width: 28, height: 28 }} />
            ) : status === "failed" || status === "timeout" ? (
              /* ━━ 付费验证 Layer 3/3：失败/超时 UI ━━━━━━━━━━━━━━━━━
               * Layer 1/3 订单级匹配 → backend/main.py recommend (order_no+province/rank/subject)
               * Layer 2/3 订阅过期   → backend/routers/auth.py:573-623 (lazy expiry)
               * 订阅到期时间设置     → backend/routers/payment.py:246-261 (_finalize_order) */
              <div style={{ textAlign: "center" }}>
                <div style={{ width: 100, height: 100, background: "var(--color-separator)", borderRadius: 6, margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>
                  {status === "timeout" ? "⏱" : "💚"}
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
                  {status === "timeout" ? (
                    <span style={{ color: "var(--color-text-secondary)" }}>
                      二维码已过期，<button onClick={createOrder} style={{ color: "var(--color-accent)", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>重新获取</button>
                    </span>
                  ) : (
                    <span>
                      {jsapiError || "创建订单失败"}，
                      <button onClick={createOrder} style={{ color: "var(--color-accent)", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>点击重试</button>
                    </span>
                  )}
                </div>
              </div>
            ) : (payEnv === "native" || fallbackUsed) ? (
              /* 桌面 Native 二维码 / H5/JSAPI 失败兜底二维码 */
              qrCode && qrCode !== "placeholder" ? (
                <>
                  {fallbackUsed && (
                    <div style={{
                      fontSize: 11, color: "#c0392b", textAlign: "center", marginBottom: 8,
                      padding: "6px 10px", background: "rgba(255,59,48,0.06)", borderRadius: 6, lineHeight: 1.5,
                    }}>
                      当前环境暂不支持直接调起，请用<strong>另一台手机的微信</strong>扫下方二维码完成支付
                    </div>
                  )}
                  <div style={{ background: "#fff", padding: 8, borderRadius: 6 }}>
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrCode)}&size=140x140&bgcolor=ffffff&color=000000&margin=0`}
                      alt="微信支付二维码"
                      width={140}
                      height={140}
                      style={{ display: "block", borderRadius: 6 }}
                    />
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-text-tertiary)", textAlign: "center" }}>
                    微信扫码支付 · 自动确认解锁
                  </div>
                  {qrExpiry > 0 && (
                    <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 3 }}>
                      二维码 {Math.floor(qrExpiry / 60)}:{String(qrExpiry % 60).padStart(2, "0")} 后失效
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>加载中…</div>
              )
            ) : payEnv === "h5" ? (
              /* 手机浏览器（非微信）：H5 跳转到微信 App */
              <div style={{ textAlign: "center", width: "100%" }}>
                <div className="spinner" style={{ width: 28, height: 28, margin: "0 auto 12px" }} />
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>正在打开微信支付…</div>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
                  支付完成后请点击"返回商家"回到本页
                </div>
                {h5Url && (
                  <a
                    href={h5Url}
                    style={{
                      display: "inline-block", marginTop: 12, fontSize: 12,
                      color: "var(--color-accent)", textDecoration: "underline",
                    }}
                  >
                    未自动跳转？点此手动打开
                  </a>
                )}
              </div>
            ) : (
              /* 微信内置浏览器：调起 JSAPI */
              <div style={{ textAlign: "center", width: "100%" }}>
                <div className="spinner" style={{ width: 28, height: 28, margin: "0 auto 12px" }} />
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>正在调起微信支付…</div>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                  若未弹出支付框，请点击下方重试
                </div>
                <button
                  onClick={createOrder}
                  style={{
                    marginTop: 10, fontSize: 12, color: "var(--color-accent)",
                    background: "none", border: "none", cursor: "pointer", fontWeight: 600,
                  }}
                >
                  重新调起 →
                </button>
              </div>
            )}
          </div>
        )}

        {/* 我已完成支付 — 兜底手动核验 */}
        {orderNo && payConfirmed && (status as string) !== "paid" && (status as string) !== "failed" && (
          <div style={{ marginBottom: 12 }}>
            <button
              onClick={manualCheck}
              disabled={manualCheckLoading}
              style={{
                width: "100%", padding: "10px", borderRadius: 8, fontSize: 13,
                background: "none", border: "1.5px solid var(--color-separator)",
                color: "var(--color-text-secondary)", cursor: "pointer", fontWeight: 500,
                opacity: manualCheckLoading ? 0.6 : 1,
              }}
            >
              {manualCheckLoading ? "查询中…" : "✓ 我已完成支付"}
            </button>
            {manualCheckResult === "not_paid" && (
              <div style={{ textAlign: "center", fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 6 }}>
                暂未收到支付通知，请稍等片刻再试（通常10秒内自动更新）
              </div>
            )}
            {manualCheckResult === "error" && (
              <div style={{ textAlign: "center", fontSize: 11, color: "#ff3b30", marginTop: 6 }}>
                查询失败，网络异常，请稍后重试
              </div>
            )}
          </div>
        )}

        {/* 社会信任 */}
        <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 8 }}>
          已有 <strong style={{ color: "var(--color-text-secondary)" }}>8,800+</strong> 个家庭解锁 · 远低于机构咨询费
        </div>
        <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", textAlign: "center", margin: 0 }}>
          支付安全由微信保障 · 虚拟商品·解锁后不支持退款
        </p>

      </div>
    </div>
  );
}
