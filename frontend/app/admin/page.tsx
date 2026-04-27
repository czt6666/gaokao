"use client";
import { useState, useEffect, useRef } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "";
const STORAGE_KEY = "admin_token";

// ── Types ─────────────────────────────────────────────────────
interface TodayStats {
  today_queries: number; today_paid: number; today_revenue: number;
  today_new_users: number; today_export_clicks: number; today_conv_rate: number;
  total_users: number; total_paid: number; total_revenue: number; total_queries: number;
}
interface ChartDay { date: string; queries: number; paid: number; revenue: number; new_users: number; }
interface Order {
  order_no: string; amount: number; status: string; pay_method: string;
  province: string; rank_input: number; created_at: string; pay_time: string; user_id: number;
}
interface UserRow {
  id: number; phone: string; province: string; is_paid: number; wechat: string;
  paid_orders: number; query_count: number; created_at: string; last_active: string;
  subscription_type: string; subscription_end: string; days_remaining: number; referral_code: string;
}
interface RevenueBreakdown { product_type: string; count: number; amount: number; }
interface ReferralRow { referral_code: string; phone: string; referral_count: number; paid_referrals: number; conv_rate: number; }
interface ExpiringSoon { id: number; phone: string; subscription_type: string; subscription_end: string; days_remaining: number; }
interface FunnelStep { step: string; count: number; rate: number; }
interface ProvinceRow { province: string; count: number; }
interface RankBucket { range: string; count: number; }
interface HotSchool { school: string; clicks: number; }
interface HourlyData { hour: string; count: number; }
interface DemandData {
  top_queries: { province: string; rank: number; count: number }[];
  subject_distribution: { subject: string; count: number }[];
  top_form_schools: { school: string; count: number }[];
  top_compare_schools: { school: string; count: number }[];
}
interface SchoolConv { school: string; clicks: number; paid_users: number; conv_rate: number; }
interface ViralData {
  total_reports: number; total_scans: number;
  daily_scans: { date: string; scans: number }[];
  platform_dist: { platform: string; count: number }[];
  top_reports: { report_id: string; province: string; rank: number; scan_count: number; created_at: string }[];
}

// ── Mini SVG Line Chart ───────────────────────────────────────
function LineChart({ data, field, color }: { data: ChartDay[]; field: keyof ChartDay; color: string }) {
  if (!data.length) return <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center", color: "#aeaeb2", fontSize: 12 }}>暂无数据</div>;
  const vals = data.map(d => d[field] as number);
  const max = Math.max(...vals, 1);
  const W = 320, H = 80, PAD = 8;
  const pts = data.map((d, i) => {
    const x = PAD + (i / Math.max(data.length - 1, 1)) * (W - PAD * 2);
    const y = H - PAD - 20 - ((d[field] as number) / max) * (H - PAD * 2 - 20);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 80 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {data.map((d, i) => {
        const x = PAD + (i / Math.max(data.length - 1, 1)) * (W - PAD * 2);
        const y = H - PAD - 20 - ((d[field] as number) / max) * (H - PAD * 2 - 20);
        return <circle key={i} cx={x} cy={y} r={2.5} fill={color} />;
      })}
      {data.filter((_, i) => i % Math.ceil(data.length / 7) === 0 || i === data.length - 1).map((d, _, arr) => {
        const origIdx = data.indexOf(d);
        const x = PAD + (origIdx / Math.max(data.length - 1, 1)) * (W - PAD * 2);
        return <text key={origIdx} x={x} y={H - 2} textAnchor="middle" fontSize={8} fill="#6E6E73">{d.date}</text>;
      })}
    </svg>
  );
}

// ── Bar Chart (horizontal) ────────────────────────────────────
function BarList({ items, labelKey, valueKey, color = "#0071E3" }: { items: Record<string,any>[]; labelKey: string; valueKey: string; color?: string }) {
  if (!items.length) return <div style={{ fontSize: 13, color: "#aeaeb2", padding: "16px 0" }}>暂无数据</div>;
  const max = Math.max(...items.map(i => i[valueKey] as number), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 80, fontSize: 12, color: "#1d1d1f", textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item[labelKey]}</div>
          <div style={{ flex: 1, background: "#f5f5f7", borderRadius: 4, height: 16, overflow: "hidden" }}>
            <div style={{ width: `${(item[valueKey] / max) * 100}%`, height: "100%", background: color, borderRadius: 4, minWidth: 2 }} />
          </div>
          <div style={{ width: 36, fontSize: 12, color: "#6e6e73", flexShrink: 0 }}>{item[valueKey]}</div>
        </div>
      ))}
    </div>
  );
}

// ── Funnel Chart ─────────────────────────────────────────────
function FunnelChart({ data }: { data: FunnelStep[] }) {
  if (!data.length) return null;
  const colors = ["#0071E3", "#34a8ff", "#80cbff", "#c5e8ff"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {data.map((step, i) => (
        <div key={step.step}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 13, color: "#1d1d1f" }}>{step.step}</span>
            <span style={{ fontSize: 13, color: "#6e6e73" }}>{step.count.toLocaleString()} <span style={{ fontSize: 11, color: colors[i] }}>({step.rate}%)</span></span>
          </div>
          <div style={{ height: 10, background: "#f5f5f7", borderRadius: 5, overflow: "hidden" }}>
            <div style={{ width: `${step.rate}%`, height: "100%", background: colors[i], borderRadius: 5 }} />
          </div>
          {i < data.length - 1 && (
            <div style={{ fontSize: 10, color: "#aeaeb2", textAlign: "center", marginTop: 2 }}>
              ↓ 转化率 {data[i + 1].count > 0 && step.count > 0 ? `${((data[i + 1].count / step.count) * 100).toFixed(1)}%` : "0%"}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Hourly Heatmap ────────────────────────────────────────────
function HourlyBars({ data }: { data: HourlyData[] }) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 60 }}>
      {data.map(d => (
        <div key={d.hour} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div style={{ width: "100%", background: `rgba(0,113,227,${0.15 + (d.count / max) * 0.85})`, borderRadius: "2px 2px 0 0", height: `${Math.max((d.count / max) * 48, 2)}px` }} title={`${d.hour}: ${d.count}次`} />
          {parseInt(d.hour) % 6 === 0 && <span style={{ fontSize: 8, color: "#aeaeb2" }}>{d.hour.slice(0, 2)}</span>}
        </div>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
export default function AdminPage() {
  const [tokenInput, setTokenInput] = useState("");
  const [authed, setAuthed] = useState(false);
  const [activeTab, setActiveTab] = useState<"dashboard" | "analysis" | "orders" | "users" | "viral" | "insights" | "referral" | "feedback">("dashboard");
  const [insights, setInsights] = useState<any>(null);

  const [stats, setStats] = useState<TodayStats | null>(null);
  const [chart, setChart] = useState<ChartDay[]>([]);
  const [chartDays, setChartDays] = useState(30);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderPage, setOrderPage] = useState(1);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [userPaidOnly, setUserPaidOnly] = useState(false);

  // Analytics state
  const [funnel, setFunnel] = useState<FunnelStep[]>([]);
  const [provinces, setProvinces] = useState<ProvinceRow[]>([]);
  const [rankDist, setRankDist] = useState<RankBucket[]>([]);
  const [hotSchools, setHotSchools] = useState<HotSchool[]>([]);
  const [hourly, setHourly] = useState<HourlyData[]>([]);
  const [demand, setDemand] = useState<DemandData | null>(null);

  const [orderSearch, setOrderSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [schoolConv, setSchoolConv] = useState<SchoolConv[]>([]);
  const [viral, setViral] = useState<ViralData | null>(null);

  const [revenueBreakdown, setRevenueBreakdown] = useState<RevenueBreakdown[]>([]);
  const [referralStats, setReferralStats] = useState<ReferralRow[]>([]);
  const [expiringSoon, setExpiringSoon] = useState<ExpiringSoon[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [grantMsg, setGrantMsg] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<{ msg: string; onConfirm: () => void } | null>(null);

  const tokenRef = useRef("");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) { tokenRef.current = saved; setAuthed(true); }
  }, []);

  const apiFetch = async (path: string, opts?: RequestInit) => {
    const t = tokenRef.current;
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: { "X-Admin-Token": t, "Content-Type": "application/json", ...(opts?.headers || {}) },
    });
    if (res.status === 403) {
      // Token失效——自动退出，提示重新登录
      localStorage.removeItem(STORAGE_KEY);
      tokenRef.current = "";
      setAuthed(false);
      setError("Token已失效或不正确，请重新输入管理员 Token");
      throw new Error("403");
    }
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  };

  // Dashboard + chart
  useEffect(() => {
    if (!authed) return;
    setLoading(true);
    Promise.all([
      apiFetch("/api/admin/stats/today"),
      apiFetch(`/api/admin/stats/chart?days_back=${chartDays}`),
    ])
      .then(([s, c]) => { setStats(s); setChart(c); })
      .catch(e => setError("加载失败：" + e.message))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, chartDays]);

  // Analysis tab — 串行请求，避免并发打满后端连接
  useEffect(() => {
    if (!authed || activeTab !== "analysis") return;
    let cancelled = false;
    async function load() {
      try {
        const f = await apiFetch("/api/admin/stats/funnel");
        if (cancelled) return; setFunnel(f);
        const p = await apiFetch("/api/admin/stats/provinces");
        if (cancelled) return; setProvinces(p);
        const r = await apiFetch("/api/admin/stats/rank_distribution");
        if (cancelled) return; setRankDist(r);
        const h = await apiFetch("/api/admin/stats/hot_schools");
        if (cancelled) return; setHotSchools(h);
        const hr = await apiFetch("/api/admin/stats/hourly");
        if (cancelled) return; setHourly(hr);
        const d = await apiFetch("/api/admin/stats/demand");
        if (cancelled) return; setDemand(d);
        const sc = await apiFetch("/api/admin/stats/school_conversion");
        if (cancelled) return; setSchoolConv(sc);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      }
    }
    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, activeTab]);

  // Orders
  useEffect(() => {
    if (!authed || activeTab !== "orders") return;
    apiFetch(`/api/admin/orders?page=${orderPage}&page_size=20&q_search=${encodeURIComponent(orderSearch)}`)
      .then(d => { setOrders(d.items); setOrderTotal(d.total); })
      .catch(e => setError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, activeTab, orderPage, orderSearch]);

  // Users
  useEffect(() => {
    if (!authed || activeTab !== "users") return;
    apiFetch(`/api/admin/users?page=${userPage}&page_size=20&paid_only=${userPaidOnly}&q_search=${encodeURIComponent(userSearch)}`)
      .then(d => { setUsers(d.items); setUserTotal(d.total); })
      .catch(e => setError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, activeTab, userPage, userPaidOnly, userSearch]);

  // Viral tab
  useEffect(() => {
    if (!authed || activeTab !== "viral") return;
    apiFetch("/api/admin/stats/viral")
      .then(d => setViral(d))
      .catch(e => setError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, activeTab]);

  // Insights tab
  useEffect(() => {
    if (!authed || activeTab !== "insights") return;
    apiFetch("/api/admin/insights")
      .then(d => setInsights(d))
      .catch(e => setError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, activeTab]);

  // Referral tab
  useEffect(() => {
    if (!authed || activeTab !== "referral") return;
    Promise.all([
      apiFetch("/api/admin/stats/revenue_breakdown"),
      apiFetch("/api/admin/stats/referral"),
      apiFetch("/api/admin/stats/expiring_soon?days=7"),
    ]).then(([rb, rs, es]) => {
      setRevenueBreakdown(rb); setReferralStats(rs); setExpiringSoon(es);
    }).catch(e => setError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, activeTab]);

  // Feedback tab
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  const [feedbackTotal, setFeedbackTotal] = useState(0);
  const [feedbackPage, setFeedbackPage] = useState(1);
  useEffect(() => {
    if (!authed || activeTab !== "feedback") return;
    apiFetch(`/api/admin/feedbacks?page=${feedbackPage}&page_size=20`)
      .then(d => { setFeedbacks(d.items); setFeedbackTotal(d.total); })
      .catch(e => setError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, activeTab, feedbackPage]);

  const handleLogin = () => {
    tokenRef.current = tokenInput;
    localStorage.setItem(STORAGE_KEY, tokenInput);
    setAuthed(true);
  };

  const _refreshUsers = () =>
    apiFetch(`/api/admin/users?page=${userPage}&page_size=20&paid_only=${userPaidOnly}&q_search=${encodeURIComponent(userSearch)}`)
      .then(d => { setUsers(d.items); setUserTotal(d.total); });

  const _refreshOrders = () =>
    apiFetch(`/api/admin/orders?page=${orderPage}&page_size=20&q_search=${encodeURIComponent(orderSearch)}`)
      .then(d => { setOrders(d.items); setOrderTotal(d.total); });

  const handleGrantPaid = (userId: number, phone: string) => {
    setConfirmDialog({
      msg: `确认为「${phone || `用户${userId}`}」开通付费权限？`,
      onConfirm: async () => {
        try {
          await apiFetch(`/api/admin/users/${userId}/grant_paid`, { method: "POST" });
          setGrantMsg(`已为 ${phone || `用户${userId}`} 开通付费权限`);
          setTimeout(() => setGrantMsg(""), 3000);
          _refreshUsers();
        } catch { setError("操作失败"); }
      },
    });
  };

  const handleRevokePaid = (userId: number, phone: string) => {
    setConfirmDialog({
      msg: `确认撤销「${phone || `用户${userId}`}」的付费权限？`,
      onConfirm: async () => {
        try {
          await apiFetch(`/api/admin/users/${userId}/revoke_paid`, { method: "POST" });
          setGrantMsg(`已撤销 ${phone || userId} 的付费权限`);
          setTimeout(() => setGrantMsg(""), 3000);
          _refreshUsers();
        } catch { setError("操作失败"); }
      },
    });
  };

  const handleRefund = (orderNo: string) => {
    setConfirmDialog({
      msg: `确认对订单 ${orderNo.slice(0, 14)}… 发起微信退款？\n将同步调用微信退款API并撤销用户付费权限，不可撤销。`,
      onConfirm: async () => {
        try {
          const res = await apiFetch(`/api/admin/orders/${orderNo}/refund`, { method: "POST" });
          setGrantMsg(`订单 ${orderNo.slice(0, 14)}… 退款已提交。${res?.wechat_note ? `（${res.wechat_note}）` : ""}`);
          setTimeout(() => setGrantMsg(""), 5000);
          _refreshOrders();
        } catch (e: any) { setError(`退款失败：${e.message}`); }
      },
    });
  };

  const exportCsv = (path: string, filename: string) => {
    const t = tokenRef.current;
    fetch(`${API}${path}`, { headers: { "X-Admin-Token": t } })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} — 请检查 Token 是否有效`);
        const ct = r.headers.get("content-type") || "";
        if (!ct.includes("csv") && !ct.includes("octet")) throw new Error("返回格式异常，非CSV文件");
        return r.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      }).catch(e => setError(`导出失败：${e.message}`));
  };

  // ── Login screen ──
  if (!authed) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F5F5F7" }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: "40px 48px", width: 360, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>水卢冷门高报引擎</div>
          <div style={{ fontSize: 13, color: "#6E6E73", marginBottom: 28 }}>管理后台</div>
          <input
            type="password" placeholder="请输入管理员 Token" value={tokenInput}
            onChange={e => setTokenInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleLogin()}
            style={{ width: "100%", padding: "10px 14px", border: "1px solid #D2D2D7", borderRadius: 8, fontSize: 14, marginBottom: 16, outline: "none", boxSizing: "border-box" }}
          />
          <button onClick={handleLogin}
            style={{ width: "100%", padding: "12px", background: "#0071E3", color: "#fff", border: "none", borderRadius: 980, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            进入后台
          </button>
        </div>
      </div>
    );
  }

  // ── UI helpers ──
  const StatCard = ({ label, value, sub, color = "#1D1D1F" }: { label: string; value: string | number; sub?: string; color?: string }) => (
    <div style={{ background: "#fff", border: "1px solid #E5E5EA", borderRadius: 12, padding: "18px 20px", flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: "#6E6E73", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#86868B", marginTop: 4 }}>{sub}</div>}
    </div>
  );

  const Card = ({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={{ background: "#fff", border: "1px solid #E5E5EA", borderRadius: 12, padding: "20px 24px", ...style }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#6E6E73", marginBottom: 16, textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</div>
      {children}
    </div>
  );

  const Tab = ({ id, label }: { id: typeof activeTab; label: string }) => (
    <button onClick={() => setActiveTab(id)} style={{
      padding: "6px 16px", borderRadius: 980, fontSize: 13, fontWeight: 500,
      background: activeTab === id ? "#0071E3" : "transparent",
      color: activeTab === id ? "#fff" : "#6E6E73",
      border: "none", cursor: "pointer",
    }}>{label}</button>
  );

  const today = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div style={{ minHeight: "100vh", background: "#F5F5F7", fontFamily: "-apple-system, 'PingFang SC', sans-serif" }}>

      {/* ── 确认对话框（替代 confirm()）── */}
      {confirmDialog && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px 24px", maxWidth: 360, width: "90%", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "#1D1D1F", whiteSpace: "pre-line" }}>{confirmDialog.msg}</div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setConfirmDialog(null)}
                style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #E5E5EA", background: "#fff", fontSize: 14, cursor: "pointer", color: "#1D1D1F" }}>
                取消
              </button>
              <button onClick={() => { const fn = confirmDialog.onConfirm; setConfirmDialog(null); fn(); }}
                style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: "#FF3B30", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                确认执行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Top nav ── */}
      <div style={{ background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)", borderBottom: "1px solid #E5E5EA", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>水卢冷门高报引擎</div>
            <div style={{ width: 1, height: 16, background: "#E5E5EA" }} />
            <div style={{ display: "flex", gap: 2 }}>
              <Tab id="dashboard" label="概览" />
              <Tab id="analysis" label="用户分析" />
              <Tab id="insights" label="算法洞察" />
              <Tab id="orders" label="订单" />
              <Tab id="users" label="用户" />
              <Tab id="viral" label="传播追踪" />
              <Tab id="referral" label="分销订阅" />
              <Tab id="feedback" label={`反馈 ${feedbackTotal > 0 ? `(${feedbackTotal})` : ""}`} />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {loading && <span style={{ fontSize: 12, color: "#6E6E73" }}>加载中…</span>}
            <div style={{ fontSize: 12, color: "#6E6E73" }}>{today}</div>
            <button onClick={() => { localStorage.removeItem(STORAGE_KEY); tokenRef.current = ""; setAuthed(false); }}
              style={{ fontSize: 12, color: "#FF3B30", background: "none", border: "none", cursor: "pointer" }}>退出</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 24px" }}>
        {error && (
          <div style={{ background: "#FFF0EF", border: "1px solid #FFB0AD", borderRadius: 8, padding: "12px 16px", color: "#FF3B30", fontSize: 13, marginBottom: 20 }}>
            {error} <button onClick={() => setError("")} style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", color: "#FF3B30" }}>✕</button>
          </div>
        )}
        {grantMsg && (
          <div style={{ background: "#EDFBF2", border: "1px solid #34C759", borderRadius: 8, padding: "12px 16px", color: "#1a7f37", fontSize: 13, marginBottom: 20 }}>
            ✅ {grantMsg}
          </div>
        )}

        {/* ── Dashboard ── */}
        {activeTab === "dashboard" && (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#6E6E73", letterSpacing: 1, marginBottom: 12, textTransform: "uppercase" }}>今日实时</div>
            <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
              <StatCard label="今日查询" value={stats?.today_queries ?? "—"} sub="次" />
              <StatCard label="点击解锁" value={stats?.today_export_clicks ?? "—"} sub="次" />
              <StatCard label="今日付费" value={stats?.today_paid ?? "—"} sub="笔" color="#0071E3" />
              <StatCard label="转化率" value={stats ? `${stats.today_conv_rate}%` : "—"} sub="点击→付费" color={stats && stats.today_conv_rate > 5 ? "#34C759" : "#FF9500"} />
              <StatCard label="今日收入" value={stats ? `¥${stats.today_revenue}` : "—"} sub="元" color="#34C759" />
              <StatCard label="今日新用户" value={stats?.today_new_users ?? "—"} sub="人" />
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: "#6E6E73", letterSpacing: 1, marginBottom: 12, textTransform: "uppercase" }}>累计数据</div>
            <div style={{ display: "flex", gap: 10, marginBottom: 28, flexWrap: "wrap" }}>
              <StatCard label="总查询量" value={stats?.total_queries?.toLocaleString() ?? "—"} />
              <StatCard label="累计用户" value={stats?.total_users?.toLocaleString() ?? "—"} />
              <StatCard label="累计付费" value={stats?.total_paid?.toLocaleString() ?? "—"} color="#0071E3" />
              <StatCard label="累计收入" value={stats ? `¥${stats.total_revenue.toFixed(2)}` : "—"} color="#34C759" />
            </div>

            {/* Chart timeframe selector */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#6E6E73", textTransform: "uppercase", letterSpacing: 1 }}>趋势图</div>
              <div style={{ display: "flex", gap: 4 }}>
                {[7, 14, 30].map(d => (
                  <button key={d} onClick={() => setChartDays(d)} style={{
                    padding: "4px 10px", borderRadius: 980, fontSize: 11, border: "1px solid #E5E5EA",
                    background: chartDays === d ? "#0071E3" : "#fff",
                    color: chartDays === d ? "#fff" : "#6E6E73", cursor: "pointer",
                  }}>近{d}天</button>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              {([
                { field: "queries" as const, title: "查询量", color: "#0071E3" },
                { field: "new_users" as const, title: "新用户", color: "#AF52DE" },
                { field: "paid" as const, title: "付费笔数", color: "#34C759" },
                { field: "revenue" as const, title: "收入（元）", color: "#FF9F0A" },
              ]).map(({ field, title, color }) => (
                <Card key={field} title={title}>
                  <LineChart data={chart} field={field} color={color} />
                </Card>
              ))}
            </div>
          </>
        )}

        {/* ── User Analysis ── */}
        {activeTab === "analysis" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              {/* Funnel */}
              <Card title="转化漏斗（近30天）">
                <FunnelChart data={funnel} />
                {!funnel.length && <div style={{ fontSize: 13, color: "#aeaeb2" }}>暂无数据</div>}
              </Card>

              {/* Hourly */}
              <Card title="用户活跃时段（近7天，北京时间）">
                <HourlyBars data={hourly} />
                <div style={{ fontSize: 11, color: "#aeaeb2", marginTop: 8 }}>颜色深浅表示活跃程度，可指导推送时机</div>
              </Card>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              {/* Province */}
              <Card title="省份分布 TOP10">
                <BarList items={provinces} labelKey="province" valueKey="count" color="#0071E3" />
                {!provinces.length && <div style={{ fontSize: 13, color: "#aeaeb2" }}>暂无数据</div>}
              </Card>

              {/* Rank distribution */}
              <Card title="位次区间分布">
                <BarList items={rankDist} labelKey="range" valueKey="count" color="#AF52DE" />
                <div style={{ fontSize: 11, color: "#aeaeb2", marginTop: 8 }}>了解主力用户群，决定数据覆盖优先级</div>
              </Card>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
              {/* Hot schools */}
              <Card title="热门学校点击 TOP15">
                <BarList items={hotSchools.slice(0, 15)} labelKey="school" valueKey="clicks" color="#FF9F0A" />
              </Card>

              {/* Top form schools */}
              <Card title="用户加入志愿表 TOP10">
                {demand?.top_form_schools.length ? (
                  <BarList items={demand.top_form_schools} labelKey="school" valueKey="count" color="#34C759" />
                ) : <div style={{ fontSize: 13, color: "#aeaeb2" }}>暂无数据</div>}
                <div style={{ fontSize: 11, color: "#aeaeb2", marginTop: 8 }}>用户真实意向院校（高价值信号）</div>
              </Card>

              {/* Top compare schools */}
              <Card title="用户对比最多 TOP10">
                {demand?.top_compare_schools.length ? (
                  <BarList items={demand.top_compare_schools} labelKey="school" valueKey="count" color="#FF6B6B" />
                ) : <div style={{ fontSize: 13, color: "#aeaeb2" }}>暂无数据</div>}
                <div style={{ fontSize: 11, color: "#aeaeb2", marginTop: 8 }}>纠结中的学校（关键决策节点）</div>
              </Card>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* Subject distribution */}
              <Card title="选科偏好分布">
                {demand?.subject_distribution.length ? (
                  <BarList items={demand.subject_distribution} labelKey="subject" valueKey="count" color="#5856D6" />
                ) : <div style={{ fontSize: 13, color: "#aeaeb2" }}>暂无数据</div>}
              </Card>

              {/* Top query combos */}
              <Card title="最热查询组合（省份+位次）TOP15">
                {demand?.top_queries.length ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {demand.top_queries.slice(0, 15).map((q, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #f5f5f7" }}>
                        <span style={{ color: "#1d1d1f" }}>{q.province} · {q.rank?.toLocaleString()}名</span>
                        <span style={{ color: "#6e6e73" }}>{q.count}次</span>
                      </div>
                    ))}
                  </div>
                ) : <div style={{ fontSize: 13, color: "#aeaeb2" }}>暂无数据</div>}
                <div style={{ fontSize: 11, color: "#aeaeb2", marginTop: 8 }}>决定下一步要爬取哪个省份的数据</div>
              </Card>
            </div>

            {/* School Conversion */}
            <Card title="学校级转化分析 — 哪所学校点击后最容易付费" style={{ marginTop: 16 }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#F5F5F7" }}>
                      {["学校", "点击量", "付费用户数", "转化率"].map(h => (
                        <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#6E6E73", fontWeight: 600, borderBottom: "1px solid #E5E5EA" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {schoolConv.slice(0, 15).map((s, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #F5F5F7" }}>
                        <td style={{ padding: "8px 12px", fontWeight: 500 }}>{s.school}</td>
                        <td style={{ padding: "8px 12px", color: "#6E6E73" }}>{s.clicks}</td>
                        <td style={{ padding: "8px 12px", color: "#0071E3", fontWeight: 600 }}>{s.paid_users}</td>
                        <td style={{ padding: "8px 12px" }}>
                          <span style={{ padding: "2px 8px", borderRadius: 980, fontSize: 11,
                            background: s.conv_rate > 10 ? "#EDFBF2" : s.conv_rate > 5 ? "#FFF8E7" : "#F5F5F7",
                            color: s.conv_rate > 10 ? "#34C759" : s.conv_rate > 5 ? "#FF9500" : "#6E6E73"
                          }}>{s.conv_rate}%</span>
                        </td>
                      </tr>
                    ))}
                    {!schoolConv.length && <tr><td colSpan={4} style={{ padding: "24px", textAlign: "center", color: "#aeaeb2" }}>暂无数据</td></tr>}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: "#aeaeb2", marginTop: 8 }}>转化率高的学校 → 用户愿意为这所学校的深度分析付钱，优先补充其数据质量</div>
            </Card>
          </>
        )}

        {/* ── Viral ── */}
        {activeTab === "viral" && (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
              {[
                { label: "已生成报告", value: viral?.total_reports ?? "—", sub: "含二维码水印", color: "#1D1D1F" },
                { label: "累计扫码次数", value: viral?.total_scans ?? "—", sub: "报告被分享后的曝光", color: "#0071E3" },
                { label: "平均传播深度", value: viral && viral.total_reports > 0 ? (viral.total_scans / viral.total_reports).toFixed(1) : "—", sub: "次扫码/份报告", color: "#34C759" },
              ].map(({ label, value, sub, color }) => (
                <div key={label} style={{ background: "#fff", border: "1px solid #E5E5EA", borderRadius: 12, padding: "18px 20px", flex: 1, minWidth: 140 }}>
                  <div style={{ fontSize: 11, color: "#6E6E73", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
                  <div style={{ fontSize: 11, color: "#86868B", marginTop: 4 }}>{sub}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <Card title="近7天每日扫码量">
                {viral?.daily_scans.length ? (
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80 }}>
                    {viral.daily_scans.map(d => {
                      const max = Math.max(...viral.daily_scans.map(x => x.scans), 1);
                      return (
                        <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                          <div style={{ width: "100%", background: `rgba(0,113,227,${0.2 + (d.scans/max)*0.8})`, borderRadius: "3px 3px 0 0", height: `${Math.max((d.scans/max)*60, 4)}px` }} />
                          <span style={{ fontSize: 9, color: "#aeaeb2" }}>{d.date}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : <div style={{ fontSize: 13, color: "#aeaeb2" }}>暂无扫码数据</div>}
              </Card>
              <Card title="扫码来源平台（近30天）">
                {viral?.platform_dist.length ? (
                  <BarList items={viral.platform_dist} labelKey="platform" valueKey="count" color="#AF52DE" />
                ) : <div style={{ fontSize: 13, color: "#aeaeb2" }}>有人扫码后出现</div>}
                <div style={{ fontSize: 11, color: "#aeaeb2", marginTop: 8 }}>referer空 = 微信内直接扫码（主渠道）</div>
              </Card>
            </div>

            <Card title="Top 传播报告">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#F5F5F7" }}>
                    {["报告ID", "省份", "位次", "扫码次数", "生成时间"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#6E6E73", fontWeight: 600, borderBottom: "1px solid #E5E5EA" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(viral?.top_reports || []).map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #F5F5F7" }}>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#6E6E73" }}>{r.report_id}</td>
                      <td style={{ padding: "8px 12px" }}>{r.province || "—"}</td>
                      <td style={{ padding: "8px 12px" }}>{r.rank?.toLocaleString() || "—"}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 980, fontSize: 11, background: "#EBF3FF", color: "#0071E3", fontWeight: 600 }}>{r.scan_count}</span>
                      </td>
                      <td style={{ padding: "8px 12px", color: "#6E6E73", fontSize: 11 }}>{r.created_at}</td>
                    </tr>
                  ))}
                  {!viral?.top_reports.length && <tr><td colSpan={5} style={{ padding: "24px", textAlign: "center", color: "#aeaeb2" }}>暂无传播数据</td></tr>}
                </tbody>
              </table>
            </Card>
          </>
        )}

        {/* ── Algorithm Insights ── */}
        {activeTab === "insights" && (
          <>
            {!insights ? (
              <div style={{ color: "#6E6E73", textAlign: "center", padding: 40 }}>
                <div style={{ marginBottom: 12 }}>加载洞察数据中…</div>
                {error && (
                  <div style={{ fontSize: 13, color: "#FF3B30", marginBottom: 12 }}>{error}</div>
                )}
                <button onClick={() => apiFetch("/api/admin/insights").then(d => setInsights(d)).catch(e => setError(e.message))}
                  style={{ fontSize: 13, padding: "8px 20px", borderRadius: 8, border: "1px solid #E5E5EA", background: "#fff", cursor: "pointer" }}>
                  重试
                </button>
              </div>
            ) : (
              <>
                {/* 概览指标 */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
                  {[
                    { label: "总查询次数", value: insights.overview?.total_queries ?? 0, color: "#0071E3" },
                    { label: "学校点击", value: insights.overview?.total_clicks ?? 0, color: "#30C759" },
                    { label: "加入志愿", value: insights.overview?.total_adds ?? 0, color: "#FF9F0A" },
                    { label: "LLM理由缓存", value: insights.overview?.llm_cache_count ?? 0, color: "#BF5AF2" },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
                      <div style={{ fontSize: 11, color: "#6E6E73", marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "#aeaeb2", marginBottom: 20, padding: "8px 12px", background: "#F9F9F9", borderRadius: 8 }}>
                  ℹ️ {insights.overview?.data_quality_note}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                  {/* 真实选择 Top */}
                  <Card title="用户真实加入志愿表 TOP10（最强决策信号）">
                    {insights.top_added_schools?.length > 0 ? (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #E5E5EA" }}>
                            <th style={{ textAlign: "left", padding: "6px 8px", color: "#6E6E73" }}>学校</th>
                            <th style={{ textAlign: "right", padding: "6px 8px", color: "#6E6E73" }}>加入次数</th>
                          </tr>
                        </thead>
                        <tbody>
                          {insights.top_added_schools.map((item: any, i: number) => (
                            <tr key={i} style={{ borderBottom: "1px solid #F2F2F7" }}>
                              <td style={{ padding: "8px 8px", fontWeight: 500 }}>{item.school}</td>
                              <td style={{ padding: "8px 8px", textAlign: "right", color: "#FF9F0A", fontWeight: 600 }}>{item.add_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ color: "#aeaeb2", fontSize: 12, padding: 16 }}>暂无数据（用户加入志愿表后将显示）</div>
                    )}
                    <div style={{ fontSize: 11, color: "#aeaeb2", marginTop: 8 }}>↑ 这些学校是用户真实决策的结果，是算法准确性的最佳验证</div>
                  </Card>

                  {/* 犹豫学校 */}
                  <Card title="多次点击但未加志愿表（用户犹豫信号）">
                    {insights.hesitation_schools?.length > 0 ? (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #E5E5EA" }}>
                            <th style={{ textAlign: "left", padding: "6px 8px", color: "#6E6E73" }}>学校</th>
                            <th style={{ textAlign: "right", padding: "6px 8px", color: "#6E6E73" }}>点击</th>
                          </tr>
                        </thead>
                        <tbody>
                          {insights.hesitation_schools.map((item: any, i: number) => (
                            <tr key={i} style={{ borderBottom: "1px solid #F2F2F7" }}>
                              <td style={{ padding: "8px 8px", fontWeight: 500 }}>{item.school}</td>
                              <td style={{ padding: "8px 8px", textAlign: "right", color: "#FF3B30", fontWeight: 600 }}>{item.clicks}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ color: "#aeaeb2", fontSize: 12, padding: 16 }}>暂无数据</div>
                    )}
                    <div style={{ fontSize: 11, color: "#aeaeb2", marginTop: 8 }}>↑ 这些学校用户感兴趣但犹豫，可能需要更好的差异化展示</div>
                  </Card>
                </div>

                {/* Agent校准数据密度 */}
                <Card title="群体智能 Agent 校准数据密度（各省份+位次段）">
                  {insights.calibration_readiness?.length > 0 ? (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #E5E5EA" }}>
                          <th style={{ textAlign: "left", padding: "6px 8px", color: "#6E6E73" }}>省份</th>
                          <th style={{ textAlign: "left", padding: "6px 8px", color: "#6E6E73" }}>位次段</th>
                          <th style={{ textAlign: "right", padding: "6px 8px", color: "#6E6E73" }}>样本数</th>
                          <th style={{ textAlign: "center", padding: "6px 8px", color: "#6E6E73" }}>状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {insights.calibration_readiness.map((item: any, i: number) => (
                          <tr key={i} style={{ borderBottom: "1px solid #F2F2F7" }}>
                            <td style={{ padding: "8px 8px", fontWeight: 500 }}>{item.province}</td>
                            <td style={{ padding: "8px 8px", color: "#6E6E73" }}>{item.rank_bucket}</td>
                            <td style={{ padding: "8px 8px", textAlign: "right", fontWeight: 600 }}>{item.sample_count}</td>
                            <td style={{ padding: "8px 8px", textAlign: "center" }}>
                              <span style={{
                                padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600,
                                background: item.calibration_ready ? "#D1FAE5" : "#FEF3C7",
                                color: item.calibration_ready ? "#065F46" : "#92400E"
                              }}>{item.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ color: "#aeaeb2", fontSize: 12, padding: 16 }}>暂无足够数据。随用户增长，各省份段将自动触发Agent校准（≥8条样本）。</div>
                  )}
                  <div style={{ fontSize: 11, color: "#aeaeb2", marginTop: 8 }}>
                    🐟 群体智能Agent当前使用真实就业/口碑/学科数据初始化人格，达到校准阈值后将进一步从用户行为中学习。
                  </div>
                </Card>
              </>
            )}
          </>
        )}

        {/* ── Orders ── */}
        {activeTab === "orders" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>订单列表</div>
                <input
                  placeholder="搜索订单号 / 省份"
                  value={orderSearch}
                  onChange={e => { setOrderSearch(e.target.value); setOrderPage(1); }}
                  style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #E5E5EA", fontSize: 13, width: 180, outline: "none" }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 12, color: "#6E6E73" }}>共 {orderTotal} 条</div>
                <button onClick={() => exportCsv("/api/admin/export/orders", `orders_${new Date().toISOString().slice(0,10)}.csv`)}
                  style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #E5E5EA", background: "#fff", fontSize: 12, cursor: "pointer", color: "#0071E3" }}>
                  ⬇ 导出CSV
                </button>
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #E5E5EA", borderRadius: 12, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#F5F5F7" }}>
                    {["订单号", "金额", "状态", "支付方式", "省份", "位次", "创建时间", "支付时间", "操作"].map(h => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6E6E73", borderBottom: "1px solid #E5E5EA", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.order_no} style={{ borderBottom: "1px solid #F5F5F7" }}>
                      <td style={{ padding: "10px 16px", fontFamily: "monospace", fontSize: 11, color: "#6e6e73" }}>{o.order_no.slice(0, 16)}…</td>
                      <td style={{ padding: "10px 16px", color: "#34C759", fontWeight: 600 }}>¥{o.amount}</td>
                      <td style={{ padding: "10px 16px" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 980, fontSize: 11,
                          background: o.status === "paid" ? "#EDFBF2" : o.status === "refunded" ? "#FFF0EF" : "#F5F5F7",
                          color: o.status === "paid" ? "#34C759" : o.status === "refunded" ? "#FF3B30" : "#6E6E73"
                        }}>{o.status}</span>
                      </td>
                      <td style={{ padding: "10px 16px", color: "#6E6E73" }}>{o.pay_method || "—"}</td>
                      <td style={{ padding: "10px 16px" }}>{o.province || "—"}</td>
                      <td style={{ padding: "10px 16px" }}>{o.rank_input?.toLocaleString() || "—"}</td>
                      <td style={{ padding: "10px 16px", color: "#6E6E73", fontSize: 11, whiteSpace: "nowrap" }}>{o.created_at}</td>
                      <td style={{ padding: "10px 16px", color: "#6E6E73", fontSize: 11, whiteSpace: "nowrap" }}>{o.pay_time || "—"}</td>
                      <td style={{ padding: "10px 16px" }}>
                        {o.status === "paid" && (
                          <button onClick={() => handleRefund(o.order_no)}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid #FF3B30", background: "transparent", color: "#FF3B30", cursor: "pointer" }}>
                            退款
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!orders.length && (
                    <tr><td colSpan={9} style={{ padding: "48px 16px", textAlign: "center", color: "#6E6E73" }}>暂无订单数据</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* 分页：显示当前页附近5页 + 首尾页 */}
            {(() => {
              const totalPages = Math.ceil(orderTotal / 20);
              if (totalPages <= 1) return null;
              const pages: (number | "…")[] = [];
              if (orderPage > 3) { pages.push(1); if (orderPage > 4) pages.push("…"); }
              for (let p = Math.max(1, orderPage - 2); p <= Math.min(totalPages, orderPage + 2); p++) pages.push(p);
              if (orderPage < totalPages - 2) { if (orderPage < totalPages - 3) pages.push("…"); pages.push(totalPages); }
              return (
                <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 16, alignItems: "center" }}>
                  <button onClick={() => setOrderPage(p => Math.max(1, p - 1))} disabled={orderPage === 1}
                    style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #E5E5EA", background: "#fff", cursor: orderPage === 1 ? "default" : "pointer", color: orderPage === 1 ? "#ccc" : "#1D1D1F", fontSize: 13 }}>‹</button>
                  {pages.map((p, i) => p === "…" ? (
                    <span key={`e${i}`} style={{ fontSize: 13, color: "#ccc", padding: "0 4px" }}>…</span>
                  ) : (
                    <button key={p} onClick={() => setOrderPage(p as number)} style={{
                      padding: "6px 12px", borderRadius: 6, border: "1px solid #E5E5EA",
                      background: orderPage === p ? "#0071E3" : "#fff",
                      color: orderPage === p ? "#fff" : "#1D1D1F", cursor: "pointer", fontSize: 13
                    }}>{p}</button>
                  ))}
                  <button onClick={() => setOrderPage(p => Math.min(Math.ceil(orderTotal / 20), p + 1))} disabled={orderPage === Math.ceil(orderTotal / 20)}
                    style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #E5E5EA", background: "#fff", cursor: orderPage === Math.ceil(orderTotal / 20) ? "default" : "pointer", color: orderPage === Math.ceil(orderTotal / 20) ? "#ccc" : "#1D1D1F", fontSize: 13 }}>›</button>
                </div>
              );
            })()}
          </>
        )}

        {/* ── Users ── */}
        {activeTab === "users" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>用户列表</div>
                <input
                  placeholder="搜索手机号 / 省份"
                  value={userSearch}
                  onChange={e => { setUserSearch(e.target.value); setUserPage(1); }}
                  style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #E5E5EA", fontSize: 13, width: 180, outline: "none" }}
                />
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#6E6E73", cursor: "pointer" }}>
                  <input type="checkbox" checked={userPaidOnly} onChange={e => { setUserPaidOnly(e.target.checked); setUserPage(1); }} />
                  只看付费
                </label>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 12, color: "#6E6E73" }}>共 {userTotal} 名</div>
                <button onClick={() => exportCsv(`/api/admin/export/users?paid_only=${userPaidOnly}`, `users_${new Date().toISOString().slice(0,10)}.csv`)}
                  style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #E5E5EA", background: "#fff", fontSize: 12, cursor: "pointer", color: "#0071E3" }}>
                  ⬇ 导出CSV
                </button>
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #E5E5EA", borderRadius: 12, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#F5F5F7" }}>
                    {["ID", "手机号", "省份", "微信", "付费状态", "套餐", "到期/剩余", "查询次数", "付费订单", "注册时间", "操作"].map(h => (
                      <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#6E6E73", borderBottom: "1px solid #E5E5EA", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} style={{ borderBottom: "1px solid #F5F5F7" }}>
                      <td style={{ padding: "10px 14px", color: "#aeaeb2", fontSize: 11 }}>{u.id}</td>
                      <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12 }}>{u.phone || "—"}</td>
                      <td style={{ padding: "10px 14px" }}>{u.province || "—"}</td>
                      <td style={{ padding: "10px 14px" }}>
                        <span style={{ fontSize: 11, color: u.wechat === "已绑定" ? "#34C759" : "#aeaeb2" }}>{u.wechat}</span>
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 980, fontSize: 11,
                          background: u.is_paid ? "#EBF3FF" : "#F5F5F7",
                          color: u.is_paid ? "#0071E3" : "#6E6E73"
                        }}>{u.is_paid ? "已付费" : "未付费"}</span>
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: 11, color: "#6e6e73" }}>
                        {u.subscription_type === "monthly_sub" ? "月度" : u.subscription_type === "quarterly_sub" ? "季度" : u.subscription_type === "single_report" ? "单次" : "—"}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: 11 }}>
                        {u.days_remaining != null && u.days_remaining >= 0 ? (
                          <span style={{ padding: "2px 6px", borderRadius: 980,
                            background: u.days_remaining > 7 ? "#EDFBF2" : u.days_remaining > 0 ? "#FFF8E7" : "#FFF0EF",
                            color: u.days_remaining > 7 ? "#34C759" : u.days_remaining > 0 ? "#FF9500" : "#FF3B30"
                          }}>剩{u.days_remaining}天</span>
                        ) : "—"}
                      </td>
                      <td style={{ padding: "10px 14px", color: "#6e6e73" }}>{u.query_count}</td>
                      <td style={{ padding: "10px 14px" }}>{u.paid_orders}</td>
                      <td style={{ padding: "10px 14px", color: "#6E6E73", fontSize: 11, whiteSpace: "nowrap" }}>{u.created_at}</td>
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          {!u.is_paid ? (
                            <button onClick={() => handleGrantPaid(u.id, u.phone)}
                              style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid #0071E3", background: "transparent", color: "#0071E3", cursor: "pointer" }}>
                              开通
                            </button>
                          ) : (
                            <button onClick={() => handleRevokePaid(u.id, u.phone)}
                              style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid #FF9500", background: "transparent", color: "#FF9500", cursor: "pointer" }}>
                              撤销
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!users.length && (
                    <tr><td colSpan={11} style={{ padding: "48px 16px", textAlign: "center", color: "#6E6E73" }}>暂无用户数据</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {(() => {
              const totalPages = Math.ceil(userTotal / 20);
              if (totalPages <= 1) return null;
              const pages: (number | "…")[] = [];
              if (userPage > 3) { pages.push(1); if (userPage > 4) pages.push("…"); }
              for (let p = Math.max(1, userPage - 2); p <= Math.min(totalPages, userPage + 2); p++) pages.push(p);
              if (userPage < totalPages - 2) { if (userPage < totalPages - 3) pages.push("…"); pages.push(totalPages); }
              return (
                <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 16, alignItems: "center" }}>
                  <button onClick={() => setUserPage(p => Math.max(1, p - 1))} disabled={userPage === 1}
                    style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #E5E5EA", background: "#fff", cursor: userPage === 1 ? "default" : "pointer", color: userPage === 1 ? "#ccc" : "#1D1D1F", fontSize: 13 }}>‹</button>
                  {pages.map((p, i) => p === "…" ? (
                    <span key={`e${i}`} style={{ fontSize: 13, color: "#ccc", padding: "0 4px" }}>…</span>
                  ) : (
                    <button key={p} onClick={() => setUserPage(p as number)} style={{
                      padding: "6px 12px", borderRadius: 6, border: "1px solid #E5E5EA",
                      background: userPage === p ? "#0071E3" : "#fff",
                      color: userPage === p ? "#fff" : "#1D1D1F", cursor: "pointer", fontSize: 13
                    }}>{p}</button>
                  ))}
                  <button onClick={() => setUserPage(p => Math.min(Math.ceil(userTotal / 20), p + 1))} disabled={userPage === Math.ceil(userTotal / 20)}
                    style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #E5E5EA", background: "#fff", cursor: userPage === Math.ceil(userTotal / 20) ? "default" : "pointer", color: userPage === Math.ceil(userTotal / 20) ? "#ccc" : "#1D1D1F", fontSize: 13 }}>›</button>
                </div>
              );
            })()}
          </>
        )}
        {/* ── Feedback ── */}
        {activeTab === "feedback" && (
          <>
            <div style={{ background: "#fff", border: "1px solid #E5E5EA", borderRadius: 12, padding: "20px 24px" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#6E6E73", marginBottom: 16, textTransform: "uppercase", letterSpacing: 0.5 }}>用户反馈（共 {feedbackTotal} 条）</div>
              {feedbacks.length > 0 ? (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#F5F5F7" }}>
                      {["ID", "内容", "联系方式", "IP", "时间"].map(h => (
                        <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#6E6E73", fontWeight: 600, borderBottom: "1px solid #E5E5EA" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {feedbacks.map((f, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #F5F5F7" }}>
                        <td style={{ padding: "8px 12px", color: "#aeaeb2", fontSize: 11 }}>{f.id}</td>
                        <td style={{ padding: "8px 12px", maxWidth: 400, lineHeight: 1.5 }}>{f.content}</td>
                        <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12 }}>{f.contact || "—"}</td>
                        <td style={{ padding: "8px 12px", color: "#6E6E73", fontSize: 11 }}>{f.ip || "—"}</td>
                        <td style={{ padding: "8px 12px", color: "#6E6E73", fontSize: 11 }}>{f.created_at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ fontSize: 13, color: "#aeaeb2", padding: "16px 0" }}>暂无反馈</div>
              )}
              {feedbackTotal > 20 && (
                <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 16 }}>
                  <button disabled={feedbackPage <= 1} onClick={() => setFeedbackPage(p => p - 1)} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #E5E5EA", background: "#fff", cursor: "pointer" }}>上一页</button>
                  <span style={{ fontSize: 13, color: "#6E6E73", lineHeight: "28px" }}>第 {feedbackPage} 页 / 共 {Math.ceil(feedbackTotal / 20)} 页</span>
                  <button disabled={feedbackPage >= Math.ceil(feedbackTotal / 20)} onClick={() => setFeedbackPage(p => p + 1)} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #E5E5EA", background: "#fff", cursor: "pointer" }}>下一页</button>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Referral & Subscription ── */}
        {activeTab === "referral" && (
          <>
            {/* Expiring Soon Alert */}
            {expiringSoon.length > 0 && (
              <div style={{ background: "#FFF8E7", border: "1px solid #FF9500", borderRadius: 12, padding: "16px 20px", marginBottom: 20 }}>
                <div style={{ fontWeight: 600, color: "#FF9500", fontSize: 13, marginBottom: 10 }}>
                  ⚠️ 即将到期用户（7天内）— {expiringSoon.length} 人
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {expiringSoon.map(u => (
                    <span key={u.id} style={{ fontSize: 12, padding: "4px 10px", background: "#fff", borderRadius: 8, border: "1px solid #FFD580", color: "#1d1d1f" }}>
                      {u.phone || `用户${u.id}`} · {u.subscription_type === "monthly_sub" ? "月度" : "季度"} · 剩{u.days_remaining}天
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Revenue Breakdown */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div style={{ background: "#fff", border: "1px solid #E5E5EA", borderRadius: 12, padding: "20px 24px" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#6E6E73", marginBottom: 16, textTransform: "uppercase", letterSpacing: 0.5 }}>收入结构拆分</div>
                {revenueBreakdown.length > 0 ? (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#F5F5F7" }}>
                        {["产品", "笔数", "金额（元）", "占比"].map(h => (
                          <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#6E6E73", fontWeight: 600, borderBottom: "1px solid #E5E5EA" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const totalAmt = revenueBreakdown.reduce((s, r) => s + r.amount, 0);
                        return revenueBreakdown.map((r, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #F5F5F7" }}>
                            <td style={{ padding: "8px 12px", fontWeight: 500 }}>
                              {r.product_type === "single_report" ? "单次报告" : r.product_type === "monthly_sub" ? "月度会员" : r.product_type === "quarterly_sub" ? "季度会员" : r.product_type}
                            </td>
                            <td style={{ padding: "8px 12px", color: "#6E6E73" }}>{r.count}</td>
                            <td style={{ padding: "8px 12px", color: "#34C759", fontWeight: 600 }}>¥{(r.amount / 100).toFixed(2)}</td>
                            <td style={{ padding: "8px 12px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ flex: 1, height: 8, background: "#F5F5F7", borderRadius: 4, overflow: "hidden" }}>
                                  <div style={{ width: `${totalAmt > 0 ? (r.amount / totalAmt) * 100 : 0}%`, height: "100%", background: i === 0 ? "#0071E3" : i === 1 ? "#34C759" : "#FF9F0A", borderRadius: 4 }} />
                                </div>
                                <span style={{ fontSize: 11, color: "#6E6E73", width: 36 }}>{totalAmt > 0 ? `${((r.amount / totalAmt) * 100).toFixed(0)}%` : "—"}</span>
                              </div>
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                ) : <div style={{ fontSize: 13, color: "#aeaeb2" }}>暂无数据</div>}
              </div>

              {/* Referral Stats */}
              <div style={{ background: "#fff", border: "1px solid #E5E5EA", borderRadius: 12, padding: "20px 24px" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#6E6E73", marginBottom: 16, textTransform: "uppercase", letterSpacing: 0.5 }}>推荐分销 TOP 榜</div>
                {referralStats.length > 0 ? (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#F5F5F7" }}>
                        {["邀请人", "邀请码", "邀请数", "付费转化", "转化率"].map(h => (
                          <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#6E6E73", fontWeight: 600, borderBottom: "1px solid #E5E5EA" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {referralStats.map((r, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #F5F5F7" }}>
                          <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 11 }}>{r.phone || "—"}</td>
                          <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 11, color: "#6E6E73" }}>{r.referral_code}</td>
                          <td style={{ padding: "8px 10px" }}>{r.referral_count}</td>
                          <td style={{ padding: "8px 10px", color: "#0071E3", fontWeight: 600 }}>{r.paid_referrals}</td>
                          <td style={{ padding: "8px 10px" }}>
                            <span style={{ padding: "2px 8px", borderRadius: 980, fontSize: 11,
                              background: r.conv_rate > 30 ? "#EDFBF2" : r.conv_rate > 10 ? "#FFF8E7" : "#F5F5F7",
                              color: r.conv_rate > 30 ? "#34C759" : r.conv_rate > 10 ? "#FF9500" : "#6E6E73"
                            }}>{r.conv_rate}%</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ fontSize: 13, color: "#aeaeb2" }}>暂无推荐数据（用户通过邀请链接注册后显示）</div>
                )}
                <div style={{ fontSize: 11, color: "#aeaeb2", marginTop: 8 }}>每成功邀请一名付费用户，邀请人额外获得7天会员</div>
              </div>
            </div>

            {/* Expiring Soon Table */}
            <div style={{ background: "#fff", border: "1px solid #E5E5EA", borderRadius: 12, padding: "20px 24px" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#6E6E73", marginBottom: 16, textTransform: "uppercase", letterSpacing: 0.5 }}>即将到期用户（7天内）</div>
              {expiringSoon.length > 0 ? (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#F5F5F7" }}>
                      {["用户ID", "手机号", "套餐", "到期时间", "剩余天数"].map(h => (
                        <th key={h} style={{ padding: "8px 14px", textAlign: "left", color: "#6E6E73", fontWeight: 600, borderBottom: "1px solid #E5E5EA" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {expiringSoon.map((u, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #F5F5F7" }}>
                        <td style={{ padding: "8px 14px", color: "#aeaeb2", fontSize: 11 }}>{u.id}</td>
                        <td style={{ padding: "8px 14px", fontFamily: "monospace", fontSize: 12 }}>{u.phone || "—"}</td>
                        <td style={{ padding: "8px 14px", fontSize: 12 }}>
                          {u.subscription_type === "monthly_sub" ? "月度会员" : u.subscription_type === "quarterly_sub" ? "季度会员" : u.subscription_type}
                        </td>
                        <td style={{ padding: "8px 14px", color: "#6E6E73", fontSize: 11 }}>{u.subscription_end}</td>
                        <td style={{ padding: "8px 14px" }}>
                          <span style={{ padding: "2px 8px", borderRadius: 980, fontSize: 11,
                            background: u.days_remaining > 3 ? "#FFF8E7" : "#FFF0EF",
                            color: u.days_remaining > 3 ? "#FF9500" : "#FF3B30",
                            fontWeight: 600,
                          }}>剩{u.days_remaining}天</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ fontSize: 13, color: "#aeaeb2", padding: "16px 0" }}>近7天内暂无即将到期的订阅用户</div>
              )}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
