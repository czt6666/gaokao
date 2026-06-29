"use client";
import { useState, useEffect, useRef } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5198";
const STORAGE_KEY = "admin_token";

// 后端返回 UTC 时间，统一转换为北京时间展示
function toBJ(utcStr: string): string {
  if (!utcStr || utcStr === "—") return "—";
  const d = new Date(utcStr.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return utcStr;
  return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

// ── Types ─────────────────────────────────────────────────────
interface TodayStats {
  today_queries: number; today_paid: number; today_revenue: number;
  today_new_users: number; today_export_clicks: number; today_conv_rate: number;
  today_new_visitors: number; today_new_visitor_queries: number; today_nv_query_rate: number;
  today_active_visitors: number; today_page_views: number; today_add_form: number; today_avg_price: number;
  total_users: number; total_paid: number; total_revenue: number; total_queries: number;
  users_mini: number; users_web: number;
}
interface ChartDay { date: string; queries: number; paid: number; revenue: number; new_users: number; }
interface Order {
  order_no: string; amount: number; status: string; pay_method: string;
  province: string; rank_input: number; created_at: string; pay_time: string; user_id: number;
  c_major: string; c_city: string; c_nature: string; c_tier: string; mock_score: number;
  product_type: string; transaction_id: string;
}
interface UserRow {
  id: number; phone: string; province: string; is_paid: number; wechat: string; user_source: string;
  paid_orders: number; query_count: number; created_at: string; last_active: string;
  subscription_type: string; subscription_end: string; days_remaining: number; referral_code: string;
}
interface UserQueryRecord { id: number; province: string; rank_input: number; event_data: string; page: string; created_at: string; ip: string; }
interface UserOrderRecord { order_no: string; amount: number; status: string; pay_method: string; product_type: string; province: string; subject: string; rank_input: number; created_at: string; pay_time: string; transaction_id: string; c_major: string; c_city_reduced: string; c_nature: string; c_tier: string; mock_score: number; gender_filter: string; discipline_filter: string; batch_filter: string; exclude_restrictions: string; }
interface UserEventRecord { id: number; event_type: string; event_data: string; page: string; created_at: string; ip: string; }
interface UsagePdfRow {
  id: number; user_id: number | null; user_label: string; province: string; rank_input: number | null;
  subject: string; exam_mode: string; c_major: string; c_city: string; c_nature: string; c_tier: string;
  discipline_filter: string; score: number | null; part: number | null; source: string; created_at: string;
}
interface UsageAiRow {
  id: number; user_id: number | null; user_label: string; question: string;
  province: string; subject: string; rank: string; score: string; created_at: string;
}
interface UsageStats {
  pdf: { total: number; today: number; week: number };
  ai: { total: number; today: number; week: number };
  pdf_provinces: { province: string; count: number }[];
  recent_pdf: UsagePdfRow[];
  recent_ai: UsageAiRow[];
}
interface UserDetail {
  user: UserRow;
  queries: UserQueryRecord[];
  orders: UserOrderRecord[];
  events: UserEventRecord[];
}
interface EventItem {
  id: number;
  user_id: number | null;
  phone: string;
  wechat_openid: string;
  wechat_mini_openid: string;
  user_source: string;
  event_type: string;
  province: string;
  rank_input: number | null;
  subject: string;
  exam_mode: string;
  c_major: string;
  c_city: string;
  c_nature: string;
  c_tier: string;
  event_data: string;
  page: string;
  ip: string;
  created_at: string;
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
function LineChart({ data, field, color, height = 80 }: { data: ChartDay[]; field: keyof ChartDay; color: string; height?: number }) {
  if (!data.length) return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "#aeaeb2", fontSize: 12 }}>暂无数据</div>;
  const vals = data.map(d => d[field] as number);
  const max = Math.max(...vals, 1);
  const W = 640;
  const isLarge = height > 100;
  const PAD = isLarge ? 28 : 16;
  const BOTTOM = isLarge ? 46 : 30;
  const H = isLarge ? height + BOTTOM : height * 2;
  const plotH = H - PAD - BOTTOM;
  const pts = data.map((d, i) => {
    const x = PAD + (i / Math.max(data.length - 1, 1)) * (W - PAD * 2);
    const y = H - BOTTOM - ((d[field] as number) / max) * plotH;
    return `${x},${y}`;
  }).join(" ");
  const step = Math.ceil(data.length / (isLarge ? 10 : 7));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height }}>
      {isLarge && [0.25, 0.5, 0.75].map(pct => {
        const gy = H - BOTTOM - plotH * pct;
        return (
          <g key={pct}>
            <line x1={PAD} y1={gy} x2={W - PAD} y2={gy} stroke="#E5E5EA" strokeWidth={1} strokeDasharray="4 4" />
            <text x={PAD - 6} y={gy + 4} textAnchor="end" fontSize={11} fill="#8E8E93">{Math.round(max * pct)}</text>
          </g>
        );
      })}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={isLarge ? 3 : 2} strokeLinejoin="round" />
      {data.map((d, i) => {
        const x = PAD + (i / Math.max(data.length - 1, 1)) * (W - PAD * 2);
        const y = H - BOTTOM - ((d[field] as number) / max) * plotH;
        return <circle key={i} cx={x} cy={y} r={isLarge ? 5 : 2.5} fill={color} />;
      })}
      {data.filter((_, i) => i % step === 0 || i === data.length - 1).map((d) => {
        const origIdx = data.indexOf(d);
        const x = PAD + (origIdx / Math.max(data.length - 1, 1)) * (W - PAD * 2);
        return (
          <text key={origIdx} x={x} y={H - (isLarge ? 8 : 4)} textAnchor="middle" fontSize={isLarge ? 13 : 8} fill="#6E6E73">
            {d.date}
          </text>
        );
      })}
      {isLarge && data.map((d, i) => {
        const x = PAD + (i / Math.max(data.length - 1, 1)) * (W - PAD * 2);
        const y = H - BOTTOM - ((d[field] as number) / max) * plotH;
        return (
          <text key={`v-${i}`} x={x} y={y - 14} textAnchor="middle" fontSize={13} fill={color} fontWeight={700}>
            {d[field] as number}
          </text>
        );
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

// ── Donut Chart ───────────────────────────────────────────────
function DonutChart({ items, size = 140 }: { items: { label: string; value: number; color: string }[]; size?: number }) {
  if (!items.length) return <div style={{ fontSize: 13, color: "#aeaeb2", padding: "16px 0" }}>暂无数据</div>;
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) return <div style={{ fontSize: 13, color: "#aeaeb2", padding: "16px 0" }}>暂无数据</div>;
  const r = size / 2 - 4;
  const cx = size / 2, cy = size / 2;
  let acc = 0;
  const arcs = items.map((item) => {
    const frac = item.value / total;
    const start = acc;
    acc += frac;
    const end = acc;
    const x1 = cx + r * Math.cos((start - 0.25) * 2 * Math.PI);
    const y1 = cy + r * Math.sin((start - 0.25) * 2 * Math.PI);
    const x2 = cx + r * Math.cos((end - 0.25) * 2 * Math.PI);
    const y2 = cy + r * Math.sin((end - 0.25) * 2 * Math.PI);
    const large = frac > 0.5 ? 1 : 0;
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    return { ...item, frac, d };
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs.map((a, i) => (
          <g key={i}>
            <path d={a.d} fill={a.color} stroke="#fff" strokeWidth={2} />
          </g>
        ))}
        <circle cx={cx} cy={cy} r={r * 0.55} fill="#fff" />
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize={12} fontWeight={700} fill="#1d1d1f">{total.toLocaleString()}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={8} fill="#6e6e73">合计</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {arcs.map((a, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: a.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "#1d1d1f" }}>{a.label}</span>
            <span style={{ fontSize: 11, color: "#6e6e73", marginLeft: "auto" }}>{a.value.toLocaleString()} ({(a.frac * 100).toFixed(0)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
export default function AdminPage() {
  const [tokenInput, setTokenInput] = useState("");
  const [authed, setAuthed] = useState(false);
  const [activeTab, setActiveTab] = useState<"dashboard" | "analysis" | "orders" | "users" | "events" | "viral" | "insights" | "referral" | "feedback" | "commission" | "usage">("dashboard");
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [insights, setInsights] = useState<any>(null);

  const [stats, setStats] = useState<TodayStats | null>(null);
  const [chart, setChart] = useState<ChartDay[]>([]);
  const [chartDays, setChartDays] = useState(30);
  const [chartZoom, setChartZoom] = useState<{ open: boolean; field: keyof ChartDay; title: string; color: string } | null>(null);
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

  // Commission state
  const [commissionTab, setCommissionTab] = useState<"records" | "withdrawals" | "stats">("records");
  const [commissionRecords, setCommissionRecords] = useState<any[]>([]);
  const [commissionTotal, setCommissionTotal] = useState(0);
  const [commissionPage, setCommissionPage] = useState(1);
  const [commissionStatus, setCommissionStatus] = useState("");
  const [withdrawalRecords, setWithdrawalRecords] = useState<any[]>([]);
  const [withdrawalTotal, setWithdrawalTotal] = useState(0);
  const [withdrawalPage, setWithdrawalPage] = useState(1);
  const [withdrawalStatus, setWithdrawalStatus] = useState("pending");
  const [commissionStatsData, setCommissionStatsData] = useState<any>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [grantMsg, setGrantMsg] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<{ msg: string; onConfirm: () => void } | null>(null);

  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<"queries" | "orders" | "events">("queries");

  const [orderDetail, setOrderDetail] = useState<Order | null>(null);

  // Events / query records state
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventTotal, setEventTotal] = useState(0);
  const [eventPage, setEventPage] = useState(1);
  const [eventFilters, setEventFilters] = useState({
    user_id: "",
    phone: "",
    wechat_openid: "",
    wechat_mini_openid: "",
    province: "",
    event_type: "",
    rank_min: "",
    rank_max: "",
    date_from: "",
    date_to: "",
    subject: "",
    exam_mode: "",
    c_major: "",
    c_city: "",
    c_nature: "",
    c_tier: "",
  });

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
      apiFetch("/api/admin/stats/revenue_breakdown"),
    ])
      .then(([s, c, rb]) => { setStats(s); setChart(c); setRevenueBreakdown(rb); })
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

  // Events / query records
  useEffect(() => {
    if (!authed || activeTab !== "events") return;
    const f = eventFilters;
    const qs = new URLSearchParams();
    qs.set("page", String(eventPage));
    qs.set("page_size", "20");
    if (f.user_id) qs.set("user_id", f.user_id);
    if (f.phone) qs.set("phone", f.phone);
    if (f.wechat_openid) qs.set("wechat_openid", f.wechat_openid);
    if (f.wechat_mini_openid) qs.set("wechat_mini_openid", f.wechat_mini_openid);
    if (f.province) qs.set("province", f.province);
    if (f.event_type) qs.set("event_type", f.event_type);
    if (f.rank_min) qs.set("rank_min", f.rank_min);
    if (f.rank_max) qs.set("rank_max", f.rank_max);
    if (f.date_from) qs.set("date_from", f.date_from);
    if (f.date_to) qs.set("date_to", f.date_to);
    if (f.subject) qs.set("subject", f.subject);
    if (f.exam_mode) qs.set("exam_mode", f.exam_mode);
    if (f.c_major) qs.set("c_major", f.c_major);
    if (f.c_city) qs.set("c_city", f.c_city);
    if (f.c_nature) qs.set("c_nature", f.c_nature);
    if (f.c_tier) qs.set("c_tier", f.c_tier);
    apiFetch(`/api/admin/events?${qs.toString()}`)
      .then(d => { setEvents(d.items); setEventTotal(d.total); })
      .catch(e => setError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, activeTab, eventPage, eventFilters]);

  // Viral tab
  useEffect(() => {
    if (!authed || activeTab !== "viral") return;
    apiFetch("/api/admin/stats/viral")
      .then(d => setViral(d))
      .catch(e => setError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, activeTab]);

  // Usage tab（使用埋点：PDF 下载 + AI 提问）
  useEffect(() => {
    if (!authed || activeTab !== "usage") return;
    apiFetch("/api/admin/stats/usage")
      .then(d => setUsage(d))
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

  // Commission tab
  useEffect(() => {
    if (!authed || activeTab !== "commission") return;
    if (commissionTab === "stats") {
      apiFetch("/api/admin/stats/commission")
        .then(d => setCommissionStatsData(d))
        .catch(e => setError(e.message));
      return;
    }
    if (commissionTab === "records") {
      const q = new URLSearchParams({ page: String(commissionPage), page_size: "20" });
      if (commissionStatus) q.set("status", commissionStatus);
      apiFetch(`/api/admin/commissions?${q.toString()}`)
        .then(d => { setCommissionRecords(d.items || []); setCommissionTotal(d.total || 0); })
        .catch(e => setError(e.message));
      return;
    }
    if (commissionTab === "withdrawals") {
      const q = new URLSearchParams({ page: String(withdrawalPage), page_size: "20" });
      if (withdrawalStatus) q.set("status", withdrawalStatus);
      apiFetch(`/api/admin/withdrawals?${q.toString()}`)
        .then(d => { setWithdrawalRecords(d.items || []); setWithdrawalTotal(d.total || 0); })
        .catch(e => setError(e.message));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, activeTab, commissionTab, commissionPage, commissionStatus, withdrawalPage, withdrawalStatus]);

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
      msg: `确认为「${phone || `用户${userId}`}」开通 2026 填报季会员？\n到期时间：2026-09-01`,
      onConfirm: async () => {
        try {
          await apiFetch(`/api/admin/users/${userId}/grant_paid`, { method: "POST" });
          setGrantMsg(`已为 ${phone || `用户${userId}`} 开通季会员`);
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

  const handleViewUserDetail = async (userId: number) => {
    setDetailLoading(true);
    setUserDetail(null);
    setDetailTab("queries");
    try {
      const data = await apiFetch(`/api/admin/users/${userId}/detail`);
      setUserDetail(data);
    } catch (e: any) {
      setError(`加载用户详情失败：${e.message}`);
    } finally {
      setDetailLoading(false);
    }
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

      {/* ── 趋势图放大弹窗 ── */}
      {chartZoom?.open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setChartZoom(null)}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "24px 28px", maxWidth: 900, width: "100%", maxHeight: "80vh", boxShadow: "0 8px 40px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 17, fontWeight: 700 }}>{chartZoom.title} — 近{chartDays}天趋势</div>
              <button onClick={() => setChartZoom(null)} style={{ background: "none", border: "none", fontSize: 24, color: "#8E8E93", cursor: "pointer" }}>×</button>
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              <LineChart data={chart} field={chartZoom.field} color={chartZoom.color} height={280} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "center" }}>
              {[7, 14, 30, 60, 90].map(d => (
                <button key={d} onClick={() => setChartDays(d)} style={{
                  padding: "6px 14px", borderRadius: 980, fontSize: 12, border: "1px solid #E5E5EA",
                  background: chartDays === d ? "#0071E3" : "#fff",
                  color: chartDays === d ? "#fff" : "#6E6E73", cursor: "pointer",
                }}>近{d}天</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── 用户详情弹窗 ── */}
      {userDetail && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setUserDetail(null)}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", maxWidth: 800, width: "90%", maxHeight: "85vh", boxShadow: "0 8px 40px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            {detailLoading ? (
              <div style={{ padding: 40, textAlign: "center", color: "#6E6E73" }}>加载中…</div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 700 }}>用户 #{userDetail.user.id}</div>
                    <div style={{ fontSize: 12, color: "#6E6E73", marginTop: 4 }}>
                      {userDetail.user.phone || "—"} · {userDetail.user.user_source} · {userDetail.user.province || "—"}
                    </div>
                  </div>
                  <button onClick={() => setUserDetail(null)} style={{ background: "none", border: "none", fontSize: 20, color: "#8E8E93", cursor: "pointer" }}>×</button>
                </div>

                {/* 标签切换 */}
                <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid #E5E5EA", paddingBottom: 8 }}>
                  {[
                    { key: "queries" as const, label: `查询记录 (${userDetail.queries.length})` },
                    { key: "orders" as const, label: `订单 (${userDetail.orders.length})` },
                    { key: "events" as const, label: `交互 (${userDetail.events.length})` },
                  ].map(t => (
                    <button key={t.key} onClick={() => setDetailTab(t.key)} style={{
                      padding: "4px 12px", borderRadius: 980, fontSize: 12, border: "none",
                      background: detailTab === t.key ? "#0071E3" : "#F5F5F7",
                      color: detailTab === t.key ? "#fff" : "#6E6E73", cursor: "pointer",
                    }}>{t.label}</button>
                  ))}
                </div>

                {/* 内容区 */}
                <div style={{ overflowY: "auto", flex: 1 }}>
                  {detailTab === "queries" && (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#F5F5F7" }}>
                          {["时间", "省份", "位次", "分数", "选科", "页面", "IP"].map(h => (
                            <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#6E6E73", fontWeight: 600, borderBottom: "1px solid #E5E5EA" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {userDetail.queries.map((q, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #F5F5F7" }}>
                            <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{toBJ(q.created_at)}</td>
                            <td style={{ padding: "8px 10px" }}>{q.province || "—"}</td>
                            <td style={{ padding: "8px 10px" }}>{q.rank_input?.toLocaleString() || "—"}</td>
                            <td style={{ padding: "8px 10px" }}>{(() => { try { return JSON.parse(q.event_data).mock_score || "—"; } catch { return "—"; } })()}</td>
                            <td style={{ padding: "8px 10px" }}>{(() => { try { return JSON.parse(q.event_data).subject || "—"; } catch { return "—"; } })()}</td>
                            <td style={{ padding: "8px 10px", color: "#6E6E73" }}>{q.page || "—"}</td>
                            <td style={{ padding: "8px 10px", color: "#aeaeb2", fontSize: 11 }}>{q.ip || "—"}</td>
                          </tr>
                        ))}
                        {!userDetail.queries.length && (
                          <tr><td colSpan={7} style={{ padding: "24px", textAlign: "center", color: "#aeaeb2" }}>暂无查询记录</td></tr>
                        )}
                      </tbody>
                    </table>
                  )}

                  {detailTab === "orders" && (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#F5F5F7" }}>
                          {["订单号", "金额", "状态", "产品", "省份", "位次", "创建时间", "支付时间"].map(h => (
                            <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#6E6E73", fontWeight: 600, borderBottom: "1px solid #E5E5EA" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {userDetail.orders.map((o, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #F5F5F7" }}>
                            <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 11, color: "#6e6e73" }}>{o.order_no}</td>
                            <td style={{ padding: "8px 10px", color: "#34C759", fontWeight: 600 }}>¥{o.amount}</td>
                            <td style={{ padding: "8px 10px" }}>
                              <span style={{ padding: "2px 6px", borderRadius: 980, fontSize: 11,
                                background: o.status === "paid" ? "#EDFBF2" : o.status === "refunded" ? "#FFF0EF" : "#F5F5F7",
                                color: o.status === "paid" ? "#34C759" : o.status === "refunded" ? "#FF3B30" : "#6E6E73"
                              }}>{o.status}</span>
                            </td>
                            <td style={{ padding: "8px 10px" }}>{o.product_type || "—"}</td>
                            <td style={{ padding: "8px 10px" }}>{o.province || "—"}</td>
                            <td style={{ padding: "8px 10px" }}>{o.rank_input?.toLocaleString() || "—"}</td>
                            <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: "#6E6E73" }}>{toBJ(o.created_at)}</td>
                            <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: "#6E6E73" }}>{toBJ(o.pay_time)}</td>
                          </tr>
                        ))}
                        {!userDetail.orders.length && (
                          <tr><td colSpan={8} style={{ padding: "24px", textAlign: "center", color: "#aeaeb2" }}>暂无订单</td></tr>
                        )}
                      </tbody>
                    </table>
                  )}

                  {detailTab === "events" && (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#F5F5F7" }}>
                          {["时间", "类型", "页面", "数据", "IP"].map(h => (
                            <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#6E6E73", fontWeight: 600, borderBottom: "1px solid #E5E5EA" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {userDetail.events.map((e, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #F5F5F7" }}>
                            <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{toBJ(e.created_at)}</td>
                            <td style={{ padding: "8px 10px" }}>
                              <span style={{ padding: "2px 6px", borderRadius: 4, background: "#F5F5F7", fontSize: 11 }}>{e.event_type}</span>
                            </td>
                            <td style={{ padding: "8px 10px", color: "#6E6E73" }}>{e.page || "—"}</td>
                            <td style={{ padding: "8px 10px", color: "#6e6e73", fontSize: 11, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.event_data || "—"}</td>
                            <td style={{ padding: "8px 10px", color: "#aeaeb2", fontSize: 11 }}>{e.ip || "—"}</td>
                          </tr>
                        ))}
                        {!userDetail.events.length && (
                          <tr><td colSpan={5} style={{ padding: "24px", textAlign: "center", color: "#aeaeb2" }}>暂无交互记录</td></tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── 订单详情弹窗 ── */}
      {orderDetail && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 9997, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setOrderDetail(null)}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", maxWidth: 520, width: "90%", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700 }}>订单详情</div>
                <div style={{ fontSize: 12, color: "#6E6E73", marginTop: 4, fontFamily: "monospace" }}>{orderDetail.order_no}</div>
              </div>
              <button onClick={() => setOrderDetail(null)} style={{ background: "none", border: "none", fontSize: 20, color: "#8E8E93", cursor: "pointer" }}>×</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", fontSize: 13, marginBottom: 20 }}>
              {[
                { label: "订单号", value: orderDetail.order_no },
                { label: "用户ID", value: orderDetail.user_id ?? "—" },
                { label: "金额", value: `¥${orderDetail.amount}` },
                { label: "状态", value: (
                  <span style={{ padding: "2px 8px", borderRadius: 980, fontSize: 11,
                    background: orderDetail.status === "paid" ? "#EDFBF2" : orderDetail.status === "refunded" ? "#FFF0EF" : "#F5F5F7",
                    color: orderDetail.status === "paid" ? "#34C759" : orderDetail.status === "refunded" ? "#FF3B30" : "#6E6E73"
                  }}>{orderDetail.status}</span>
                )},
                { label: "产品类型", value: orderDetail.product_type || "—" },
                { label: "支付方式", value: orderDetail.pay_method || "—" },
                { label: "省份", value: orderDetail.province || "—" },
                { label: "选科", value: orderDetail.subject || "—" },
                { label: "位次", value: orderDetail.rank_input?.toLocaleString() || "—" },
                { label: "分数", value: orderDetail.mock_score || "—" },
                { label: "微信支付流水", value: orderDetail.transaction_id || "—" },
                { label: "创建时间", value: toBJ(orderDetail.created_at) },
                { label: "支付时间", value: toBJ(orderDetail.pay_time) },
              ].map((item, i) => (
                <div key={i}>
                  <div style={{ fontSize: 11, color: "#6E6E73", marginBottom: 3 }}>{item.label}</div>
                  <div style={{ color: "#1D1D1F", fontWeight: 500 }}>{item.value}</div>
                </div>
              ))}
            </div>

            {(orderDetail.c_major || orderDetail.c_city_reduced || orderDetail.c_nature || orderDetail.c_tier || orderDetail.subject || orderDetail.gender_filter) && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: "#6E6E73", marginBottom: 6 }}>筛选条件</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {orderDetail.c_major && <span style={{ padding: "3px 10px", borderRadius: 6, background: "#E8F4FD", color: "#0071E3", fontSize: 12 }}>专业: {orderDetail.c_major}</span>}
                  {orderDetail.c_city_reduced && <span style={{ padding: "3px 10px", borderRadius: 6, background: "#EDFBF2", color: "#34C759", fontSize: 12 }}>城市: {orderDetail.c_city_reduced}</span>}
                  {orderDetail.c_nature && <span style={{ padding: "3px 10px", borderRadius: 6, background: "#FFF9E6", color: "#FF9500", fontSize: 12 }}>性质: {orderDetail.c_nature}</span>}
                  {orderDetail.c_tier && <span style={{ padding: "3px 10px", borderRadius: 6, background: "#F5F5F7", color: "#6E6E73", fontSize: 12 }}>档次: {orderDetail.c_tier}</span>}
                  {orderDetail.subject && <span style={{ padding: "3px 10px", borderRadius: 6, background: "#EBF3FF", color: "#0071E3", fontSize: 12 }}>选科: {orderDetail.subject}</span>}
                  {orderDetail.gender_filter && <span style={{ padding: "3px 10px", borderRadius: 6, background: "#F0E6FF", color: "#AF52DE", fontSize: 12 }}>{orderDetail.gender_filter}</span>}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              {orderDetail.user_id && (
                <button onClick={() => { setOrderDetail(null); handleViewUserDetail(orderDetail.user_id); }}
                  style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #0071E3", background: "#fff", color: "#0071E3", fontSize: 14, cursor: "pointer", fontWeight: 600 }}>
                  查看用户详情 →
                </button>
              )}
              {orderDetail.status === "paid" && (
                <button onClick={() => { setOrderDetail(null); handleRefund(orderDetail.order_no); }}
                  style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #FF3B30", background: "#fff", color: "#FF3B30", fontSize: 14, cursor: "pointer" }}>
                  退款
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Top nav ── */}
      <div style={{ background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)", borderBottom: "1px solid #E5E5EA", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1440, margin: "0 auto", padding: "0 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <a href="/" style={{ fontSize: 15, fontWeight: 700, color: "#000", textDecoration: "none" }}>水卢冷门高报引擎</a>
            <div style={{ width: 1, height: 16, background: "#E5E5EA" }} />
            <div style={{ display: "flex", gap: 2 }}>
              <Tab id="dashboard" label="概览" />
              <Tab id="analysis" label="用户分析" />
              <Tab id="insights" label="算法洞察" />
              <Tab id="orders" label="订单" />
              <Tab id="users" label="用户" />
              <Tab id="events" label="查询记录" />
              <Tab id="usage" label="使用埋点" />
              <Tab id="viral" label="传播追踪" />
              <Tab id="referral" label="分销订阅" />
              <Tab id="commission" label="佣金管理" />
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

      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "28px 24px" }}>
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
            <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <StatCard label="新访问" value={stats?.today_new_visitors ?? "—"} sub="首次访问的访客" color="#5856D6" />
              <StatCard label="新访问点击查询" value={stats?.today_new_visitor_queries ?? "—"} sub={stats ? `占新访问 ${stats.today_nv_query_rate}%` : "次"} color="#5856D6" />
              <StatCard label="新注册" value={stats?.today_new_users ?? "—"} sub="人" />
              <StatCard label="点击解锁" value={stats?.today_export_clicks ?? "—"} sub="次" />
              <StatCard label="付费" value={stats?.today_paid ?? "—"} sub="笔" color="#0071E3" />
              <StatCard label="转化率" value={stats ? `${stats.today_conv_rate}%` : "—"} sub="点击→付费" color={stats && stats.today_conv_rate > 5 ? "#34C759" : "#FF9500"} />
              <StatCard label="今日收入" value={stats ? `¥${stats.today_revenue}` : "—"} sub="元" color="#34C759" />
              <StatCard label="平均单价" value={stats ? `¥${stats.today_avg_price}` : "—"} sub="元/笔" color="#34C759" />
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
              <StatCard label="今日查询" value={stats?.today_queries ?? "—"} sub="次" />
              <StatCard label="访问量 PV" value={stats?.today_page_views ?? "—"} sub="页面浏览次数" />
              <StatCard label="活跃访客 UV" value={stats?.today_active_visitors ?? "—"} sub="今日来过的访客" />
              <StatCard label="老访客" value={stats ? Math.max(stats.today_active_visitors - stats.today_new_visitors, 0) : "—"} sub="非首次访问" />
              <StatCard label="加入志愿表" value={stats?.today_add_form ?? "—"} sub="次" />
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
              <div style={{ fontSize: 12, fontWeight: 600, color: "#6E6E73", textTransform: "uppercase", letterSpacing: 1 }}>趋势图（点击放大）</div>
              <div style={{ display: "flex", gap: 4 }}>
                {[7, 14, 30, 60, 90].map(d => (
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
                <div key={field} onClick={() => setChartZoom({ open: true, field, title, color })} style={{ cursor: "pointer" }}>
                  <Card title={title}>
                    <LineChart data={chart} field={field} color={color} />
                  </Card>
                </div>
              ))}
            </div>

            {/* Extra visualizations */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16, marginTop: 16 }}>
              <Card title="收入结构（近30天）">
                <DonutChart
                  items={revenueBreakdown.length > 0 ? [
                    { label: "单次报告", value: revenueBreakdown.find(r => r.product_type === "single_report")?.count || 0, color: "#0071E3" },
                    { label: "月度会员", value: revenueBreakdown.find(r => r.product_type === "monthly_sub")?.count || 0, color: "#34C759" },
                    { label: "季度会员", value: revenueBreakdown.find(r => r.product_type === "quarterly_sub")?.count || 0, color: "#FF9F0A" },
                  ].filter(i => i.value > 0) : []}
                />
              </Card>
              <Card title="用户来源占比">
                <DonutChart
                  items={stats && (stats.users_mini > 0 || stats.users_web > 0) ? [
                    { label: "小程序", value: stats.users_mini || 0, color: "#34C759" },
                    { label: "网页端", value: stats.users_web || 0, color: "#0071E3" },
                  ].filter(i => i.value > 0) : []}
                />
              </Card>
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
                      <td style={{ padding: "8px 12px", color: "#6E6E73", fontSize: 11 }}>{toBJ(r.created_at)}</td>
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
                    {["订单号", "用户ID", "金额", "状态", "支付方式", "省份", "位次", "分数", "筛选条件", "创建时间", "支付时间", "操作"].map(h => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6E6E73", borderBottom: "1px solid #E5E5EA", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.order_no} style={{ borderBottom: "1px solid #F5F5F7" }}>
                      <td style={{ padding: "10px 16px", fontFamily: "monospace", fontSize: 11, color: "#6e6e73" }}>{o.order_no}</td>
                      <td style={{ padding: "10px 16px", color: "#aeaeb2", fontSize: 11 }}>{o.user_id ?? "—"}</td>
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
                      <td style={{ padding: "10px 16px" }}>{o.mock_score || "—"}</td>
                      <td style={{ padding: "10px 16px", fontSize: 11 }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 200 }}>
                          {o.c_major && <span style={{ padding: "1px 6px", borderRadius: 4, background: "#E8F4FD", color: "#0071E3" }}>专业:{o.c_major}</span>}
                          {o.c_city_reduced && <span style={{ padding: "1px 6px", borderRadius: 4, background: "#EDFBF2", color: "#34C759" }}>城市:{o.c_city_reduced}</span>}
                          {o.c_nature && <span style={{ padding: "1px 6px", borderRadius: 4, background: "#FFF9E6", color: "#FF9500" }}>性质:{o.c_nature}</span>}
                          {o.c_tier && <span style={{ padding: "1px 6px", borderRadius: 4, background: "#F5F5F7", color: "#6E6E73" }}>档次:{o.c_tier}</span>}
                          {o.subject && <span style={{ padding: "1px 6px", borderRadius: 4, background: "#EBF3FF", color: "#0071E3" }}>选科:{o.subject}</span>}
                          {o.gender_filter && <span style={{ padding: "1px 6px", borderRadius: 4, background: "#F0E6FF", color: "#AF52DE" }}>{o.gender_filter}</span>}
                          {!o.c_major && !o.c_city_reduced && !o.c_nature && !o.c_tier && !o.subject && !o.gender_filter && <span style={{ color: "#aeaeb2" }}>—</span>}
                        </div>
                      </td>
                      <td style={{ padding: "10px 16px", color: "#6E6E73", fontSize: 11, whiteSpace: "nowrap" }}>{toBJ(o.created_at)}</td>
                      <td style={{ padding: "10px 16px", color: "#6E6E73", fontSize: 11, whiteSpace: "nowrap" }}>{toBJ(o.pay_time)}</td>
                      <td style={{ padding: "10px 16px" }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => setOrderDetail(o)}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid #5856D6", background: "transparent", color: "#5856D6", cursor: "pointer" }}>
                            详情
                          </button>
                          {o.status === "paid" && (
                            <button onClick={() => handleRefund(o.order_no)}
                              style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid #FF3B30", background: "transparent", color: "#FF3B30", cursor: "pointer" }}>
                              退款
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!orders.length && (
                    <tr><td colSpan={11} style={{ padding: "48px 16px", textAlign: "center", color: "#6E6E73" }}>暂无订单数据</td></tr>
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
                  placeholder="搜索手机号 / ID"
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
                    {["ID", "手机号", "来源", "付费状态", "套餐", "到期/剩余", "查询次数", "付费订单", "注册时间", "操作"].map(h => (
                      <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#6E6E73", borderBottom: "1px solid #E5E5EA", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} style={{ borderBottom: "1px solid #F5F5F7" }}>
                      <td style={{ padding: "10px 14px", color: "#aeaeb2", fontSize: 11 }}>{u.id}</td>
                      <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12 }}>{u.phone || "—"}</td>
                      <td style={{ padding: "10px 14px" }}>
                        <span style={{ fontSize: 11, color: "#6E6E73" }}>{u.user_source}</span>
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
                      <td style={{ padding: "10px 14px", color: "#6E6E73", fontSize: 11, whiteSpace: "nowrap" }}>{toBJ(u.created_at)}</td>
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => handleViewUserDetail(u.id)}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid #5856D6", background: "transparent", color: "#5856D6", cursor: "pointer" }}>
                            详情
                          </button>
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
                    <tr><td colSpan={10} style={{ padding: "48px 16px", textAlign: "center", color: "#6E6E73" }}>暂无用户数据</td></tr>
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
        {/* ── Events / Query Records ── */}
        {activeTab === "events" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>查询记录</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 12, color: "#6E6E73" }}>共 {eventTotal} 条</div>
                <button onClick={() => {
                  const f = eventFilters;
                  const qs = new URLSearchParams();
                  if (f.user_id) qs.set("user_id", f.user_id);
                  if (f.phone) qs.set("phone", f.phone);
                  if (f.province) qs.set("province", f.province);
                  if (f.event_type) qs.set("event_type", f.event_type);
                  if (f.rank_min) qs.set("rank_min", f.rank_min);
                  if (f.rank_max) qs.set("rank_max", f.rank_max);
                  if (f.date_from) qs.set("date_from", f.date_from);
                  if (f.date_to) qs.set("date_to", f.date_to);
                  if (f.subject) qs.set("subject", f.subject);
                  if (f.exam_mode) qs.set("exam_mode", f.exam_mode);
                  if (f.c_major) qs.set("c_major", f.c_major);
                  if (f.c_city) qs.set("c_city", f.c_city);
                  if (f.c_nature) qs.set("c_nature", f.c_nature);
                  if (f.c_tier) qs.set("c_tier", f.c_tier);
                  exportCsv(`/api/admin/export/events?${qs.toString()}`, `events_${new Date().toISOString().slice(0,10)}.csv`);
                }}
                  style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #E5E5EA", background: "#fff", fontSize: 12, cursor: "pointer", color: "#0071E3" }}>
                  ⬇ 导出CSV
                </button>
              </div>
            </div>

            {/* Filters */}
            <div style={{ background: "#fff", border: "1px solid #E5E5EA", borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px 12px" }}>
                <input placeholder="用户ID" value={eventFilters.user_id} onChange={e => { setEventFilters(f => ({ ...f, user_id: e.target.value })); setEventPage(1); }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12, outline: "none" }} />
                <input placeholder="手机号" value={eventFilters.phone} onChange={e => { setEventFilters(f => ({ ...f, phone: e.target.value })); setEventPage(1); }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12, outline: "none" }} />
                <input placeholder="微信网页openid" value={eventFilters.wechat_openid} onChange={e => { setEventFilters(f => ({ ...f, wechat_openid: e.target.value })); setEventPage(1); }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12, outline: "none" }} />
                <input placeholder="微信小程序openid" value={eventFilters.wechat_mini_openid} onChange={e => { setEventFilters(f => ({ ...f, wechat_mini_openid: e.target.value })); setEventPage(1); }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12, outline: "none" }} />
                <input placeholder="省份" value={eventFilters.province} onChange={e => { setEventFilters(f => ({ ...f, province: e.target.value })); setEventPage(1); }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12, outline: "none" }} />
                <select value={eventFilters.event_type} onChange={e => { setEventFilters(f => ({ ...f, event_type: e.target.value })); setEventPage(1); }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12, outline: "none", background: "#fff" }}>
                  <option value="">全部事件</option>
                  <option value="query_submit">查询提交</option>
                  <option value="page_view">页面访问</option>
                  <option value="school_click">学校点击</option>
                  <option value="export_click">导出点击</option>
                  <option value="add_to_form">加入志愿表</option>
                  <option value="compare_add">对比添加</option>
                  <option value="pay_click">支付点击</option>
                  <option value="pay_success">支付成功</option>
                  <option value="unlock_click">解锁点击</option>
                  <option value="pdf_download">PDF下载</option>
                  <option value="ai_chat">AI提问</option>
                </select>
                <input placeholder="位次 ≥" value={eventFilters.rank_min} onChange={e => { setEventFilters(f => ({ ...f, rank_min: e.target.value })); setEventPage(1); }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12, outline: "none" }} />
                <input placeholder="位次 ≤" value={eventFilters.rank_max} onChange={e => { setEventFilters(f => ({ ...f, rank_max: e.target.value })); setEventPage(1); }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12, outline: "none" }} />
                <input placeholder="开始日期 (YYYY-MM-DD)" value={eventFilters.date_from} onChange={e => { setEventFilters(f => ({ ...f, date_from: e.target.value })); setEventPage(1); }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12, outline: "none" }} />
                <input placeholder="结束日期 (YYYY-MM-DD)" value={eventFilters.date_to} onChange={e => { setEventFilters(f => ({ ...f, date_to: e.target.value })); setEventPage(1); }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12, outline: "none" }} />
                <input placeholder="选科" value={eventFilters.subject} onChange={e => { setEventFilters(f => ({ ...f, subject: e.target.value })); setEventPage(1); }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12, outline: "none" }} />
                <input placeholder="考试模式" value={eventFilters.exam_mode} onChange={e => { setEventFilters(f => ({ ...f, exam_mode: e.target.value })); setEventPage(1); }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12, outline: "none" }} />
                <input placeholder="筛选专业" value={eventFilters.c_major} onChange={e => { setEventFilters(f => ({ ...f, c_major: e.target.value })); setEventPage(1); }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12, outline: "none" }} />
                <input placeholder="筛选城市" value={eventFilters.c_city} onChange={e => { setEventFilters(f => ({ ...f, c_city: e.target.value })); setEventPage(1); }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12, outline: "none" }} />
                <input placeholder="筛选性质" value={eventFilters.c_nature} onChange={e => { setEventFilters(f => ({ ...f, c_nature: e.target.value })); setEventPage(1); }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12, outline: "none" }} />
                <input placeholder="筛选档次" value={eventFilters.c_tier} onChange={e => { setEventFilters(f => ({ ...f, c_tier: e.target.value })); setEventPage(1); }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12, outline: "none" }} />
              </div>
            </div>

            <div style={{ background: "#fff", border: "1px solid #E5E5EA", borderRadius: 12, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#F5F5F7" }}>
                    {["ID", "用户ID", "手机号", "来源", "事件", "省份", "位次", "分数", "选科", "考试模式", "约束条件", "时间", "IP"].map(h => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#6E6E73", borderBottom: "1px solid #E5E5EA", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => {
                    // 从 event_data 解析 mock_score（如有）
                    let mockScore: string | null = null;
                    try {
                      const d = JSON.parse(ev.event_data || "{}");
                      if (d.mock_score) mockScore = String(d.mock_score);
                    } catch {}
                    return (
                    <tr key={ev.id} style={{ borderBottom: "1px solid #F5F5F7" }}>
                      <td style={{ padding: "8px 10px", color: "#aeaeb2", fontSize: 11 }}>{ev.id}</td>
                      <td style={{ padding: "8px 10px", color: "#aeaeb2", fontSize: 11 }}>{ev.user_id ?? "—"}</td>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 11 }}>{ev.phone || "—"}</td>
                      <td style={{ padding: "8px 10px", fontSize: 11, color: "#6E6E73" }}>{ev.user_source}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <span style={{ padding: "2px 6px", borderRadius: 4, background: "#F5F5F7", fontSize: 11 }}>{ev.event_type}</span>
                      </td>
                      <td style={{ padding: "8px 10px" }}>{ev.province || "—"}</td>
                      <td style={{ padding: "8px 10px" }}>{ev.rank_input?.toLocaleString() || "—"}</td>
                      <td style={{ padding: "8px 10px" }}>{mockScore ? `${mockScore}分` : "—"}</td>
                      <td style={{ padding: "8px 10px" }}>{ev.subject || "—"}</td>
                      <td style={{ padding: "8px 10px", color: "#6E6E73" }}>{ev.exam_mode || "—"}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                          {ev.c_major && <span style={{ padding: "1px 4px", borderRadius: 3, background: "#E8F4FD", color: "#0071E3", fontSize: 10 }}>专:{ev.c_major}</span>}
                          {ev.c_city && <span style={{ padding: "1px 4px", borderRadius: 3, background: "#EDFBF2", color: "#34C759", fontSize: 10 }}>城:{ev.c_city}</span>}
                          {ev.c_nature && <span style={{ padding: "1px 4px", borderRadius: 3, background: "#FFF9E6", color: "#FF9500", fontSize: 10 }}>性:{ev.c_nature}</span>}
                          {ev.c_tier && <span style={{ padding: "1px 4px", borderRadius: 3, background: "#F5F5F7", color: "#6E6E73", fontSize: 10 }}>档:{ev.c_tier}</span>}
                          {!ev.c_major && !ev.c_city && !ev.c_nature && !ev.c_tier && <span style={{ color: "#aeaeb2" }}>—</span>}
                        </div>
                      </td>
                      <td style={{ padding: "8px 10px", color: "#6E6E73", fontSize: 11, whiteSpace: "nowrap" }}>{toBJ(ev.created_at)}</td>
                      <td style={{ padding: "8px 10px", color: "#aeaeb2", fontSize: 11 }}>{ev.ip || "—"}</td>
                    </tr>
                    );
                  })}
                  {!events.length && (
                    <tr><td colSpan={13} style={{ padding: "48px 16px", textAlign: "center", color: "#6E6E73" }}>暂无事件数据</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {(() => {
              const totalPages = Math.ceil(eventTotal / 20);
              if (totalPages <= 1) return null;
              const pages: (number | "…")[] = [];
              if (eventPage > 3) { pages.push(1); if (eventPage > 4) pages.push("…"); }
              for (let p = Math.max(1, eventPage - 2); p <= Math.min(totalPages, eventPage + 2); p++) pages.push(p);
              if (eventPage < totalPages - 2) { if (eventPage < totalPages - 3) pages.push("…"); pages.push(totalPages); }
              return (
                <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 16, alignItems: "center" }}>
                  <button onClick={() => setEventPage(p => Math.max(1, p - 1))} disabled={eventPage === 1}
                    style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #E5E5EA", background: "#fff", cursor: eventPage === 1 ? "default" : "pointer", color: eventPage === 1 ? "#ccc" : "#1D1D1F", fontSize: 13 }}>‹</button>
                  {pages.map((p, i) => p === "…" ? (
                    <span key={`e${i}`} style={{ fontSize: 13, color: "#ccc", padding: "0 4px" }}>…</span>
                  ) : (
                    <button key={p} onClick={() => setEventPage(p as number)} style={{
                      padding: "6px 12px", borderRadius: 6, border: "1px solid #E5E5EA",
                      background: eventPage === p ? "#0071E3" : "#fff",
                      color: eventPage === p ? "#fff" : "#1D1D1F", cursor: "pointer", fontSize: 13
                    }}>{p}</button>
                  ))}
                  <button onClick={() => setEventPage(p => Math.min(Math.ceil(eventTotal / 20), p + 1))} disabled={eventPage === Math.ceil(eventTotal / 20)}
                    style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #E5E5EA", background: "#fff", cursor: eventPage === Math.ceil(eventTotal / 20) ? "default" : "pointer", color: eventPage === Math.ceil(eventTotal / 20) ? "#ccc" : "#1D1D1F", fontSize: 13 }}>›</button>
                </div>
              );
            })()}
          </>
        )}

        {/* ── 使用埋点（PDF 下载 + AI 提问）── */}
        {activeTab === "usage" && (
          <>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              <StatCard label="PDF下载 今日" value={usage?.pdf.today ?? "—"} sub="次" color="#0071E3" />
              <StatCard label="PDF下载 近7日" value={usage?.pdf.week ?? "—"} sub="次" />
              <StatCard label="PDF下载 累计" value={usage?.pdf.total ?? "—"} sub="次" />
              <StatCard label="AI提问 今日" value={usage?.ai.today ?? "—"} sub="次" color="#34C759" />
              <StatCard label="AI提问 近7日" value={usage?.ai.week ?? "—"} sub="次" />
              <StatCard label="AI提问 累计" value={usage?.ai.total ?? "—"} sub="次" />
            </div>

            <Card title="PDF 下载 Top 省份" style={{ marginBottom: 16 }}>
              {usage && usage.pdf_provinces.length > 0 ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {usage.pdf_provinces.map(p => (
                    <span key={p.province} style={{ padding: "6px 12px", borderRadius: 980, background: "#F5F5F7", fontSize: 13 }}>
                      {p.province} <strong>{p.count}</strong>
                    </span>
                  ))}
                </div>
              ) : <div style={{ color: "#86868B", fontSize: 13 }}>暂无数据</div>}
            </Card>

            <Card title={`最近 PDF 下载（${usage?.recent_pdf.length ?? 0} 条）`} style={{ marginBottom: 16 }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#F5F5F7" }}>
                      {["用户", "省份", "位次", "分数", "选科", "模式", "专业筛选", "门类筛选", "城市", "性质", "档次", "分册", "来源", "时间"].map(h => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#6E6E73", fontWeight: 600, borderBottom: "1px solid #E5E5EA", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(usage?.recent_pdf ?? []).map(r => (
                      <tr key={r.id} style={{ borderBottom: "1px solid #F5F5F7" }}>
                        <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{r.user_label || "游客"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.province || "—"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.rank_input ?? "—"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.score ?? "—"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.subject || "—"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.exam_mode || "—"}</td>
                        <td style={{ padding: "8px 10px", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.c_major}>{r.c_major || "—"}</td>
                        <td style={{ padding: "8px 10px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.discipline_filter}>{r.discipline_filter || "—"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.c_city || "—"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.c_nature || "—"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.c_tier || "—"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.part === 1 ? "上册" : r.part === 2 ? "下册" : "全部"}</td>
                        <td style={{ padding: "8px 10px", color: "#86868B" }}>{r.source || "—"}</td>
                        <td style={{ padding: "8px 10px", color: "#6E6E73", fontSize: 11, whiteSpace: "nowrap" }}>{toBJ(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(!usage || usage.recent_pdf.length === 0) && <div style={{ color: "#86868B", fontSize: 13, padding: "12px 0" }}>暂无数据</div>}
              </div>
            </Card>

            <Card title={`最近 AI 提问（${usage?.recent_ai.length ?? 0} 条）`}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#F5F5F7" }}>
                      {["用户", "提问内容", "省份", "选科", "位次", "分数", "时间"].map(h => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#6E6E73", fontWeight: 600, borderBottom: "1px solid #E5E5EA", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(usage?.recent_ai ?? []).map(r => (
                      <tr key={r.id} style={{ borderBottom: "1px solid #F5F5F7" }}>
                        <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{r.user_label || "游客"}</td>
                        <td style={{ padding: "8px 10px", maxWidth: 460, lineHeight: 1.5 }}>{r.question || "—"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.province || "—"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.subject || "—"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.rank || "—"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.score || "—"}</td>
                        <td style={{ padding: "8px 10px", color: "#6E6E73", fontSize: 11, whiteSpace: "nowrap" }}>{toBJ(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(!usage || usage.recent_ai.length === 0) && <div style={{ color: "#86868B", fontSize: 13, padding: "12px 0" }}>暂无数据</div>}
              </div>
            </Card>
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
                      {["ID", "用户ID", "内容", "联系方式", "IP", "时间"].map(h => (
                        <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#6E6E73", fontWeight: 600, borderBottom: "1px solid #E5E5EA" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {feedbacks.map((f, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #F5F5F7" }}>
                        <td style={{ padding: "8px 12px", color: "#aeaeb2", fontSize: 11 }}>{f.id}</td>
                        <td style={{ padding: "8px 12px", color: "#aeaeb2", fontSize: 11 }}>{f.user_id ?? "—"}</td>
                        <td style={{ padding: "8px 12px", maxWidth: 400, lineHeight: 1.5 }}>{f.content}</td>
                        <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12 }}>{f.contact || "—"}</td>
                        <td style={{ padding: "8px 12px", color: "#6E6E73", fontSize: 11 }}>{f.ip || "—"}</td>
                        <td style={{ padding: "8px 12px", color: "#6E6E73", fontSize: 11 }}>{toBJ(f.created_at)}</td>
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
                <div style={{ fontSize: 11, color: "#aeaeb2", marginTop: 8 }}>每成功邀请一名付费用户，邀请人额外获得3天会员</div>
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

        {/* ── Commission ── */}
        {activeTab === "commission" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {(["records", "withdrawals", "stats"] as const).map(t => (
                <button key={t} onClick={() => setCommissionTab(t)} style={{
                  padding: "6px 16px", borderRadius: 980, fontSize: 13, fontWeight: 500,
                  background: commissionTab === t ? "#0071E3" : "#fff",
                  color: commissionTab === t ? "#fff" : "#6E6E73",
                  border: "1px solid #E5E5EA", cursor: "pointer",
                }}>
                  {t === "records" ? "佣金记录" : t === "withdrawals" ? "提现审核" : "佣金统计"}
                </button>
              ))}
            </div>

            {commissionTab === "stats" && commissionStatsData && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 16 }}>
                {[
                  { label: "总发放佣金", value: `¥${commissionStatsData.total_granted_yuan}`, color: "#34C759" },
                  { label: "总扣除佣金", value: `¥${commissionStatsData.total_deducted_yuan}`, color: "#FF3B30" },
                  { label: "总已提现", value: `¥${commissionStatsData.total_withdrawn_yuan}`, color: "#0071E3" },
                  { label: "冻结中", value: `¥${commissionStatsData.frozen_yuan}`, color: "#FF9500" },
                  { label: "可提现余额", value: `¥${commissionStatsData.available_yuan}`, color: "#34C759" },
                  { label: "待审核提现", value: `${commissionStatsData.pending_withdrawals} 笔`, color: "#FF3B30" },
                ].map(card => (
                  <div key={card.label} style={{ background: "#fff", border: "1px solid #E5E5EA", borderRadius: 12, padding: "20px 24px" }}>
                    <div style={{ fontSize: 12, color: "#6E6E73", marginBottom: 8 }}>{card.label}</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: card.color }}>{card.value}</div>
                  </div>
                ))}
              </div>
            )}

            {commissionTab === "records" && (
              <div style={{ background: "#fff", border: "1px solid #E5E5EA", borderRadius: 12, padding: "20px 24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#6E6E73", textTransform: "uppercase", letterSpacing: 0.5 }}>佣金记录（共 {commissionTotal} 条）</div>
                  <select value={commissionStatus} onChange={e => { setCommissionStatus(e.target.value); setCommissionPage(1); }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #E5E5EA", fontSize: 13 }}>
                    <option value="">全部状态</option>
                    <option value="frozen">冻结中</option>
                    <option value="available">已到账</option>
                    <option value="deducted">已扣除</option>
                  </select>
                </div>
                {commissionRecords.length > 0 ? (
                  <>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: "#F5F5F7" }}>
                          {["ID", "用户ID", "订单号", "金额", "状态", "来源", "冻结到期", "创建时间"].map(h => (
                            <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#6E6E73", fontWeight: 600, borderBottom: "1px solid #E5E5EA" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {commissionRecords.map((r, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #F5F5F7" }}>
                            <td style={{ padding: "8px 12px", color: "#aeaeb2", fontSize: 11 }}>{r.id}</td>
                            <td style={{ padding: "8px 12px", fontSize: 11 }}>{r.user_id}</td>
                            <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 11 }}>{r.order_no || "—"}</td>
                            <td style={{ padding: "8px 12px", color: "#34C759", fontWeight: 600 }}>¥{r.amount_yuan}</td>
                            <td style={{ padding: "8px 12px" }}>
                              <span style={{ padding: "2px 8px", borderRadius: 980, fontSize: 11,
                                background: r.status === "frozen" ? "#FFF8E7" : r.status === "available" ? "#EDFBF2" : "#FFF0EF",
                                color: r.status === "frozen" ? "#FF9500" : r.status === "available" ? "#34C759" : "#FF3B30"
                              }}>{r.status === "frozen" ? "冻结中" : r.status === "available" ? "已到账" : "已扣除"}</span>
                            </td>
                            <td style={{ padding: "8px 12px", fontSize: 11, color: "#6E6E73" }}>{r.source || "—"}</td>
                            <td style={{ padding: "8px 12px", fontSize: 11, color: "#6E6E73" }}>{r.freeze_until || "—"}</td>
                            <td style={{ padding: "8px 12px", fontSize: 11, color: "#6E6E73" }}>{r.created_at}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {commissionTotal > 20 && (
                      <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 16 }}>
                        <button disabled={commissionPage <= 1} onClick={() => setCommissionPage(p => p - 1)} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #E5E5EA", background: "#fff", cursor: "pointer" }}>上一页</button>
                        <span style={{ fontSize: 13, color: "#6E6E73", lineHeight: "28px" }}>第 {commissionPage} 页 / 共 {Math.ceil(commissionTotal / 20)} 页</span>
                        <button disabled={commissionPage >= Math.ceil(commissionTotal / 20)} onClick={() => setCommissionPage(p => p + 1)} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #E5E5EA", background: "#fff", cursor: "pointer" }}>下一页</button>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: "#aeaeb2", padding: "16px 0" }}>暂无佣金记录</div>
                )}
              </div>
            )}

            {commissionTab === "withdrawals" && (
              <div style={{ background: "#fff", border: "1px solid #E5E5EA", borderRadius: 12, padding: "20px 24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#6E6E73", textTransform: "uppercase", letterSpacing: 0.5 }}>提现申请（共 {withdrawalTotal} 条）</div>
                  <select value={withdrawalStatus} onChange={e => { setWithdrawalStatus(e.target.value); setWithdrawalPage(1); }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #E5E5EA", fontSize: 13 }}>
                    <option value="pending">待审核</option>
                    <option value="paid">已通过</option>
                    <option value="rejected">已拒绝</option>
                    <option value="">全部</option>
                  </select>
                </div>
                {withdrawalRecords.length > 0 ? (
                  <>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: "#F5F5F7" }}>
                          {["ID", "用户ID", "金额", "状态", "客服微信", "备注", "申请时间", "操作"].map(h => (
                            <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#6E6E73", fontWeight: 600, borderBottom: "1px solid #E5E5EA" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {withdrawalRecords.map((r, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #F5F5F7" }}>
                            <td style={{ padding: "8px 12px", color: "#aeaeb2", fontSize: 11 }}>{r.id}</td>
                            <td style={{ padding: "8px 12px", fontSize: 11 }}>{r.user_id}</td>
                            <td style={{ padding: "8px 12px", color: "#34C759", fontWeight: 600 }}>¥{r.amount_yuan}</td>
                            <td style={{ padding: "8px 12px" }}>
                              <span style={{ padding: "2px 8px", borderRadius: 980, fontSize: 11,
                                background: r.status === "pending" ? "#FFF8E7" : r.status === "paid" ? "#EDFBF2" : "#FFF0EF",
                                color: r.status === "pending" ? "#FF9500" : r.status === "paid" ? "#34C759" : "#FF3B30"
                              }}>{r.status === "pending" ? "待审核" : r.status === "paid" ? "已通过" : "已拒绝"}</span>
                            </td>
                            <td style={{ padding: "8px 12px", fontSize: 11, color: "#6E6E73" }}>{r.wechat_id || "—"}</td>
                            <td style={{ padding: "8px 12px", fontSize: 11, color: "#6E6E73" }}>{r.admin_note || "—"}</td>
                            <td style={{ padding: "8px 12px", fontSize: 11, color: "#6E6E73" }}>{r.created_at}</td>
                            <td style={{ padding: "8px 12px" }}>
                              {r.status === "pending" && (
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button onClick={() => {
                                    const wid = r.id;
                                    setConfirmDialog({
                                      msg: `确认通过提现申请 #${wid}？\n将通过微信转账给用户。`,
                                      onConfirm: () => {
                                        apiFetch(`/api/admin/withdrawals/${wid}/approve`, { method: "POST" })
                                          .then(() => { setGrantMsg(`提现 #${wid} 已通过`); setWithdrawalPage(p => p); })
                                          .catch(e => setError(e.message));
                                      },
                                    });
                                  }} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#34C759", color: "#fff", fontSize: 12, cursor: "pointer" }}>通过</button>
                                  <button onClick={() => {
                                    const wid = r.id;
                                    setConfirmDialog({
                                      msg: `确认拒绝提现申请 #${wid}？\n金额将退回用户余额。`,
                                      onConfirm: () => {
                                        apiFetch(`/api/admin/withdrawals/${wid}/reject`, { method: "POST" })
                                          .then(() => { setGrantMsg(`提现 #${wid} 已拒绝`); setWithdrawalPage(p => p); })
                                          .catch(e => setError(e.message));
                                      },
                                    });
                                  }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #E5E5EA", background: "#fff", color: "#FF3B30", fontSize: 12, cursor: "pointer" }}>拒绝</button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {withdrawalTotal > 20 && (
                      <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 16 }}>
                        <button disabled={withdrawalPage <= 1} onClick={() => setWithdrawalPage(p => p - 1)} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #E5E5EA", background: "#fff", cursor: "pointer" }}>上一页</button>
                        <span style={{ fontSize: 13, color: "#6E6E73", lineHeight: "28px" }}>第 {withdrawalPage} 页 / 共 {Math.ceil(withdrawalTotal / 20)} 页</span>
                        <button disabled={withdrawalPage >= Math.ceil(withdrawalTotal / 20)} onClick={() => setWithdrawalPage(p => p + 1)} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #E5E5EA", background: "#fff", cursor: "pointer" }}>下一页</button>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: "#aeaeb2", padding: "16px 0" }}>暂无提现申请</div>
                )}
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
