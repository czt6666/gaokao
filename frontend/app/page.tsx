"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { track } from "@/lib/track";
import AuthNav from "@/components/AuthNav";
import FeedbackModal from "@/components/FeedbackModal";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const PROVINCES = [
  "北京","河北","四川","贵州","安徽","广西","江西","云南","山西","重庆",
  "内蒙古","陕西","吉林","新疆","天津","青海","黑龙江","辽宁","湖南",
  "河南","广东","上海","福建","江苏","山东","浙江","湖北","甘肃","宁夏",
  "海南","西藏",
];

// ── 省份 → 高考模式映射 ───────────────────────────────────────
type ExamMode = "3+1+2" | "3+3" | "old";
const PROVINCE_MODE: Record<string, ExamMode> = {
  // 3+1+2（主流）
  "河北": "3+1+2", "辽宁": "3+1+2", "江苏": "3+1+2", "福建": "3+1+2",
  "湖北": "3+1+2", "湖南": "3+1+2", "广东": "3+1+2", "重庆": "3+1+2",
  "吉林": "3+1+2", "黑龙江": "3+1+2", "安徽": "3+1+2", "江西": "3+1+2",
  "广西": "3+1+2", "贵州": "3+1+2", "甘肃": "3+1+2", "河南": "3+1+2",
  "山西": "3+1+2", "陕西": "3+1+2", "内蒙古": "3+1+2", "四川": "3+1+2",
  "云南": "3+1+2", "宁夏": "3+1+2", "青海": "3+1+2",
  // 3+3
  "北京": "3+3", "天津": "3+3", "山东": "3+3", "上海": "3+3",
  "浙江": "3+3", "海南": "3+3",
  // 旧高考
  "新疆": "old", "西藏": "old",
};

function getExamMode(province: string): ExamMode {
  return PROVINCE_MODE[province] || "3+1+2";
}

const FIRST_OPTIONS = ["物理", "历史"];
const SECOND_OPTIONS = ["政治", "地理", "化学", "生物"];
const ALL_SUBJECTS = ["物理", "化学", "生物", "历史", "政治", "地理"];
const OLD_OPTIONS = [
  { label: "文科", value: "文科" },
  { label: "理科", value: "理科" },
];

const PROVINCE_STATUS: Record<string, "full"|"partial"|"soon"> = {
  "北京": "full",
  "河北": "full", "四川": "full", "贵州": "full", "安徽": "full",
  "广西": "full", "江西": "full", "云南": "full", "山西": "full",
  "重庆": "full", "内蒙古": "full", "陕西": "full", "吉林": "full",
  "新疆": "full", "天津": "full", "青海": "full",
  "河南": "full", "广东": "full", "湖南": "full",
  "黑龙江": "full", "辽宁": "full", "上海": "full",
  "福建": "full", "江苏": "full", "山东": "full",
  "浙江": "full", "湖北": "full", "甘肃": "full", "宁夏": "full",
  "海南": "partial", "西藏": "partial",
};
const HISTORY_KEY = "gaokao_query_history";

function HistoryQuickAccess() {
  const [history, setHistory] = useState<any[]>([]);
  const router = useRouter();
  useEffect(() => {
    try {
      const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      setHistory(h.slice(0, 3));
    } catch {}
  }, []);
  if (!history.length) return null;
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 20px 32px" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: 10 }}>最近查询</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {history.map((h: any, i: number) => (
          <button
            key={i}
            onClick={() => router.push(`/results?province=${encodeURIComponent(h.province)}&rank=${h.rank}&subject=${encodeURIComponent(h.subject)}${h.exam_mode ? `&exam_mode=${h.exam_mode}` : ""}`)}
            style={{
              padding: "6px 14px", borderRadius: 99, fontSize: 12,
              background: "var(--color-bg-secondary)", border: "1px solid var(--color-separator)",
              cursor: "pointer", color: "var(--color-text-secondary)",
            }}
          >
            {h.province} · 位次{h.rank} · {h.total}所
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const queryRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"rank"|"score">("rank");
  const [rank, setRank] = useState("");
  const [mockScore, setMockScore] = useState("");
  const [province, setProvince] = useState("北京");

  // ── 选科 state（三模式）──────────────────────────────────────
  const examMode = getExamMode(province);
  // 3+1+2
  const [first312, setFirst312] = useState("物理");
  const [second312, setSecond312] = useState<string[]>(["化学", "生物"]);
  // 3+3
  const [subjects333, setSubjects333] = useState<string[]>(["物理", "化学", "生物"]);
  // 旧高考
  const [oldSubject, setOldSubject] = useState("理科");

  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  // ── 偏好约束 ──
  const [showConstraints, setShowConstraints] = useState(false);
  const [cMajor, setCMajor] = useState("");
  const [cCityLevels, setCCityLevels] = useState<string[]>([]);
  const [cNature, setCNature] = useState<string[]>([]);
  const [cTiers, setCTiers] = useState<string[]>([]);
  const CITY_LEVEL_OPTIONS = ["一线城市", "新一线", "二线", "三线"];
  const NATURE_OPTIONS = ["公办", "民办"];
  const TIER_OPTIONS = ["985", "211", "双一流", "普通"];

  useEffect(() => {
    try { const p = localStorage.getItem("gaokao_province"); if (p) setProvince(p); } catch {}
    track("page_view", { page: "/" });
    // Capture referral code from URL and persist to localStorage
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (ref && ref.match(/^[A-Z0-9]{6,10}$/)) {
        localStorage.setItem("gaokao_ref", ref);
      }
    } catch {}
  }, []);

  // 拼接选科字符串
  const subjectStr = (() => {
    if (examMode === "3+1+2") {
      return [first312, ...second312].join("+");
    }
    if (examMode === "3+3") {
      return subjects333.join("+");
    }
    return oldSubject;
  })();

  const handleSubmit = async () => {
    if (mode === "rank" && !rank) return;
    if (mode === "score" && !mockScore) return;
    setLoading(true);
    setSubmitError(null);
    try { localStorage.setItem("gaokao_province", province); } catch {}
    track("query_submit", {
      province,
      rankInput: mode === "rank" ? Number(rank) : 0,
      eventData: { mode, subject: subjectStr, exam_mode: examMode, mock_score: mode === "score" ? mockScore : undefined },
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      // 约束参数长度限制（防止 URL 过长导致 414）
      const cMajorTrimmed = cMajor.trim().slice(0, 50);
      const constraintQs = (() => {
        const parts: string[] = [];
        if (cMajorTrimmed) parts.push(`c_major=${encodeURIComponent(cMajorTrimmed)}`);
        if (cCityLevels.length) parts.push(`c_city=${encodeURIComponent(cCityLevels.join(","))}`);
        if (cNature.length) parts.push(`c_nature=${encodeURIComponent(cNature.join(","))}`);
        if (cTiers.length) parts.push(`c_tier=${encodeURIComponent(cTiers.join(","))}`);
        return parts.length ? `&${parts.join("&")}` : "";
      })();

      if (mode === "score") {
        const res = await fetch(
          `${API}/api/simulate?mock_score=${mockScore}&province=${encodeURIComponent(province)}&subject=${encodeURIComponent(subjectStr)}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error(`服务器错误 ${res.status}，请稍后重试`);
        const data = await res.json();
        if (data.no_data || !data.estimated_rank) {
          // 该省暂无一分一段数据，引导用户切换到位次模式
          setSubmitError(`⚠️ ${data.note || "该省暂无一分一段数据"}\n\n👆 请切换到「高考位次」模式直接输入位次`);
          setLoading(false);
          return;
        }
        router.push(`/results?rank=${data.estimated_rank}&province=${encodeURIComponent(province)}&subject=${encodeURIComponent(subjectStr)}&exam_mode=${examMode}&from_mock=1&mock_score=${mockScore}${constraintQs}`);
      } else {
        router.push(`/results?rank=${rank}&province=${encodeURIComponent(province)}&subject=${encodeURIComponent(subjectStr)}&exam_mode=${examMode}${constraintQs}`);
      }
    } catch (e: any) {
      const msg = e?.name === "AbortError"
        ? "请求超时（15秒），请检查网络后重试"
        : (e?.message || "查询失败，请稍后重试");
      setSubmitError(msg);
      setLoading(false);
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  };

  const scrollToQuery = () => {
    queryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const status = PROVINCE_STATUS[province];

  return (
    <main style={{ minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text-primary)" }}>
      {/* ── Nav ── */}
      <nav className="apple-nav">
        <div style={{ maxWidth: 980, margin: "0 auto", padding: "0 24px", height: 48, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 15, fontFamily: "var(--font-display)" }}>
            <span style={{ fontWeight: 700, color: "var(--color-text-primary)" }}>水卢冷门高报引擎</span>
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <span
              className="nav-brand-sub"
              onClick={() => setContactOpen(true)}
              style={{ fontSize: 11, color: "var(--color-text-tertiary)", letterSpacing: ".3px", cursor: "pointer" }}
            >袁希团队出品</span>
            <Link href="/search" className="btn-ghost nav-link-mobile-hide" style={{ padding: "6px 12px", fontSize: 13 }}>学校库</Link>
            <Link href="/compare" className="btn-ghost nav-link-mobile-hide" style={{ padding: "6px 12px", fontSize: 13 }}>学校对比</Link>
            <Link href="/major-trend" className="btn-ghost nav-link-mobile-hide" style={{ padding: "6px 12px", fontSize: 13 }}>专业风向标</Link>
            <Link href="/form" className="btn-ghost nav-link-mobile-hide" style={{ padding: "6px 12px", fontSize: 13 }}>志愿表</Link>
            <AuthNav />
          </div>
        </div>
      </nav>

      {/* ── 联系我们弹窗 ── */}
      {contactOpen && (
        <>
          {/* 遮罩 */}
          <div
            onClick={() => setContactOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.25)" }}
          />
          {/* 弹窗 */}
          <div style={{
            position: "fixed", top: "50%", left: "50%", zIndex: 2001,
            transform: "translate(-50%, -50%)",
            background: "var(--color-bg-secondary, #f5f5f7)",
            border: "1px solid var(--color-separator, #e5e5ea)",
            borderRadius: 18, padding: "28px 28px 22px", width: 320,
            boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
          }}>
            <button
              onClick={() => setContactOpen(false)}
              style={{ position: "absolute", top: 12, right: 16, background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#aeaeb2", lineHeight: 1 }}
            >×</button>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: "var(--color-text-primary)" }}>遇到问题？联系我们</div>
            <div style={{
              background: "var(--color-bg, #fafaf8)", borderRadius: 10,
              padding: "12px 14px", marginBottom: 14,
              fontSize: 13, color: "var(--color-text-secondary, #6e6e73)", lineHeight: 1.8,
            }}>
              发邮件至<br />
              <strong style={{ color: "#0071E3", userSelect: "all" }}>superfy@gmail.com</strong>
            </div>
            <a
              href="mailto:superfy@gmail.com"
              style={{
                display: "block", width: "100%", padding: "11px", borderRadius: 10, fontSize: 14,
                background: "#0071E3", color: "#fff", border: "none", cursor: "pointer",
                fontWeight: 600, textAlign: "center", textDecoration: "none",
                boxSizing: "border-box",
              }}
            >发送邮件</a>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary, #aeaeb2)", textAlign: "center", marginTop: 12, lineHeight: 1.6 }}>
              支付问题 · 退款申请 · 数据咨询
            </div>
          </div>
        </>
      )}

      {/* ── Section 1: Hero (full viewport) ── */}
      <section className="hero-section">
        <div style={{ textAlign: "center", marginBottom: 48, maxWidth: 640 }}>

          {/* H1 */}
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(36px, 7vw, 72px)", fontWeight: 700, lineHeight: 1.3, letterSpacing: "-1.5px", color: "var(--color-text-primary)", marginBottom: 20, wordBreak: "keep-all", overflowWrap: "break-word" }}>
            有人用你的分数<br />进了比你好20名的大学
          </h1>

          {/* One sentence */}
          <p style={{ fontSize: "clamp(16px, 2vw, 19px)", color: "var(--color-text-secondary)", lineHeight: 1.7, maxWidth: 520, margin: "0 auto 48px", fontWeight: 400 }}>
            <span style={{ color: "var(--color-text-primary)", fontWeight: 600, display: "block", marginBottom: 10 }}>他只做了一件你没做的事。</span>
            每年都有数万名考生，靠同样的分数进了差别悬殊的大学——<br />
            不是因为更聪明，而是因为他们发现了那些「名字普通、实力被严重低估」的学校。
          </p>

          {/* Single CTA */}
          <button className="btn-primary" style={{ fontSize: 18, padding: "16px 48px", borderRadius: 980 }} onClick={scrollToQuery}>
            先免费看看，我的位次还有哪些可能
          </button>
          <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 14 }}>
            无需注册 · 3分钟 · 今天看，今天心里有底
          </p>
        </div>

        {/* Data strip */}
        <div style={{ display: "flex", gap: 0, borderTop: "1px solid var(--color-separator)", borderBottom: "1px solid var(--color-separator)", padding: "16px 0", width: "100%", maxWidth: 700, justifyContent: "space-around", marginBottom: 56 }}>
          {[
            ["127,439名", "考生通过这里发现了隐藏的好学校"],
            ["追踪9年", "告诉你今年哪所学校分数线在下滑"],
            ["真实口碑", "宿舍·就业·转专业难度，骗不了人"],
            ["3分钟", "今天填报季，知道你还有哪些选择"],
          ].map(([num, label]) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--color-text-primary)" }}>{num}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2, maxWidth: 120 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Query card */}
        <div ref={queryRef} className="apple-card-elevated query-card-mobile" style={{ width: "100%", maxWidth: 480 }}>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", marginBottom: 16, textAlign: "center", lineHeight: 1.6 }}>
            输入你的全省位次，看看你「还能去哪些被低估的学校」
          </p>
          {/* Mode toggle */}
          <div style={{ display: "flex", background: "var(--color-bg-secondary)", borderRadius: "var(--radius-md)", padding: 4, marginBottom: 24 }}>
            {([["rank","已出分 · 输入位次"], ["score","考前模拟 · 输入分数"]] as const).map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex: 1, padding: "9px 12px", borderRadius: 10, border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 500, fontFamily: "var(--font)",
                background: mode === m ? "var(--color-surface)" : "transparent",
                color: mode === m ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                boxShadow: mode === m ? "var(--shadow-sm)" : "none",
                transition: "all .2s",
              }}>{label}</button>
            ))}
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", display: "block", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".5px" }}>
              {mode === "rank" ? "全省排名位次" : "模考成绩（分）"}
            </label>
            <input
              type="number"
              min={mode === "rank" ? 1 : 0}
              max={mode === "rank" ? 2000000 : 750}
              value={mode === "rank" ? rank : mockScore}
              onChange={e => {
                const v = e.target.value;
                if (v === "") { mode === "rank" ? setRank("") : setMockScore(""); return; }
                const n = Number(v);
                if (mode === "rank") {
                  if (n >= 1 && n <= 2000000) setRank(v);
                } else {
                  if (n >= 0 && n <= 750) setMockScore(v);
                }
              }}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              placeholder={mode === "rank" ? "例如：28000" : "例如：630"}
              className="apple-input"
              style={{ fontSize: 28, fontWeight: 300, letterSpacing: "-0.3px", padding: "16px 18px" }}
            />
          </div>

          <div className="query-grid-2col" style={{ display: "grid", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", display: "block", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".5px" }}>省份</label>
              <select className="apple-select" value={province} onChange={e => setProvince(e.target.value)}>
                {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {status === "full" && province === "北京" && <p style={{ fontSize: 11, color: "var(--color-success)", marginTop: 5 }}>数据完整（2017–2025，9年）✓</p>}
              {status === "full" && province !== "北京" && <p style={{ fontSize: 11, color: "var(--color-success)", marginTop: 5 }}>数据完整（2021–2025，含2025）✓</p>}
              {status === "partial" && <p style={{ fontSize: 11, color: "var(--color-accent)", marginTop: 5 }}>2021–2025 院校录取数据（含2025）</p>}
              {status === "soon" && <p style={{ fontSize: 11, color: "var(--color-warning)", marginTop: 5 }}>即将支持</p>}
              {!status && <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 5 }}>数据建设中</p>}
            </div>
            <div>
              {/* 高考模式标签 */}
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 6 }}>
                {examMode === "3+1+2" && "3+1+2 模式 · 首选+再选"}
                {examMode === "3+3" && "3+3 模式 · 任选3科"}
                {examMode === "old" && "旧高考 · 文理分科"}
              </div>

              {/* 3+1+2 选科组件 */}
              {examMode === "3+1+2" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* 首选 */}
                  <div style={{ display: "flex", gap: 6 }}>
                    {FIRST_OPTIONS.map(f => (
                      <button
                        key={f}
                        onClick={() => setFirst312(f)}
                        style={{
                          flex: 1, padding: "8px 0", borderRadius: 8, border: "1.5px solid",
                          borderColor: first312 === f ? "var(--color-navy)" : "var(--color-separator)",
                          background: first312 === f ? "var(--color-navy)" : "var(--color-bg)",
                          color: first312 === f ? "#fff" : "var(--color-text-primary)",
                          fontSize: 13, fontWeight: 600, cursor: "pointer",
                        }}
                      >{f}</button>
                    ))}
                  </div>
                  {/* 再选（多选2项） */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {SECOND_OPTIONS.map(s => {
                      const checked = second312.includes(s);
                      return (
                        <button
                          key={s}
                          onClick={() => {
                            if (checked) {
                              if (second312.length > 1) setSecond312(second312.filter(x => x !== s));
                            } else {
                              if (second312.length < 2) setSecond312([...second312, s]);
                            }
                          }}
                          style={{
                            padding: "7px 0", borderRadius: 8, border: "1.5px solid",
                            borderColor: checked ? "var(--color-accent)" : "var(--color-separator)",
                            background: checked ? "rgba(201,146,42,0.08)" : "var(--color-bg)",
                            color: checked ? "var(--color-accent)" : "var(--color-text-secondary)",
                            fontSize: 12, fontWeight: 500, cursor: "pointer",
                          }}
                        >{checked ? "✓ " : ""}{s}</button>
                      );
                    })}
                  </div>
                  {second312.length !== 2 && (
                    <span style={{ fontSize: 11, color: "#ff3b30" }}>请再选 2 科（已选 {second312.length} 科）</span>
                  )}
                </div>
              )}

              {/* 3+3 选科组件 */}
              {examMode === "3+3" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {ALL_SUBJECTS.map(s => {
                      const checked = subjects333.includes(s);
                      return (
                        <button
                          key={s}
                          onClick={() => {
                            if (checked) {
                              if (subjects333.length > 1) setSubjects333(subjects333.filter(x => x !== s));
                            } else {
                              if (subjects333.length < 3) setSubjects333([...subjects333, s]);
                            }
                          }}
                          style={{
                            flex: 1, minWidth: 60, padding: "7px 0", borderRadius: 8, border: "1.5px solid",
                            borderColor: checked ? "var(--color-accent)" : "var(--color-separator)",
                            background: checked ? "rgba(201,146,42,0.08)" : "var(--color-bg)",
                            color: checked ? "var(--color-accent)" : "var(--color-text-secondary)",
                            fontSize: 12, fontWeight: 500, cursor: "pointer",
                          }}
                        >{checked ? "✓ " : ""}{s}</button>
                      );
                    })}
                  </div>
                  {subjects333.length !== 3 && (
                    <span style={{ fontSize: 11, color: "#ff3b30" }}>请选 3 科（已选 {subjects333.length} 科）</span>
                  )}
                </div>
              )}

              {/* 旧高考选科组件 */}
              {examMode === "old" && (
                <div style={{ display: "flex", gap: 6 }}>
                  {OLD_OPTIONS.map(o => (
                    <button
                      key={o.value}
                      onClick={() => setOldSubject(o.value)}
                      style={{
                        flex: 1, padding: "8px 0", borderRadius: 8, border: "1.5px solid",
                        borderColor: oldSubject === o.value ? "var(--color-navy)" : "var(--color-separator)",
                        background: oldSubject === o.value ? "var(--color-navy)" : "var(--color-bg)",
                        color: oldSubject === o.value ? "#fff" : "var(--color-text-primary)",
                        fontSize: 13, fontWeight: 600, cursor: "pointer",
                      }}
                    >{o.label}</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── 偏好约束 ── */}
          <div style={{ marginBottom: 20 }}>
            <button
              type="button"
              onClick={() => setShowConstraints(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "none", border: "none", cursor: "pointer",
                fontSize: 13, color: "var(--color-text-secondary)", padding: 0,
              }}
            >
              <span style={{
                display: "inline-block", width: 20, height: 20, borderRadius: 6,
                background: showConstraints ? "var(--color-navy)" : "var(--color-bg-secondary)",
                color: showConstraints ? "#fff" : "var(--color-text-secondary)",
                fontSize: 12, lineHeight: "20px", textAlign: "center", transition: "all .2s",
              }}>{showConstraints ? "−" : "+"}</span>
              添加偏好约束
              {(cMajor || cCityLevels.length || cNature.length || cTiers.length) ? (
                <span style={{ fontSize: 11, color: "var(--color-accent)", fontWeight: 600 }}>（已选）</span>
              ) : null}
            </button>

            {showConstraints && (
              <div style={{
                marginTop: 12, padding: 16, borderRadius: 12,
                background: "var(--color-bg-secondary)", border: "1px solid var(--color-separator)",
              }}>
                {/* 专业关键词 */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-tertiary)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".5px" }}>感兴趣的专业（关键词匹配）</label>
                  <input
                    type="text"
                    value={cMajor}
                    onChange={e => setCMajor(e.target.value)}
                    placeholder="如：计算机、医学、师范…多个用空格分隔"
                    style={{
                      width: "100%", padding: "10px 12px", borderRadius: 10,
                      border: "1px solid var(--color-separator)", fontSize: 14,
                      background: "var(--color-bg)", color: "var(--color-text-primary)", outline: "none",
                    }}
                  />
                </div>

                {/* 城市等级 */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-tertiary)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".5px" }}>城市等级</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {CITY_LEVEL_OPTIONS.map(lv => {
                      const active = cCityLevels.includes(lv);
                      return (
                        <button key={lv} onClick={() => setCCityLevels(prev => active ? prev.filter(x => x !== lv) : [...prev, lv])} style={{
                          padding: "6px 14px", borderRadius: 980, fontSize: 13, cursor: "pointer",
                          border: active ? "none" : "1px solid var(--color-separator)",
                          background: active ? "var(--color-navy)" : "var(--color-bg)",
                          color: active ? "#fff" : "var(--color-text-secondary)", transition: "all .15s",
                        }}>{lv}</button>
                      );
                    })}
                  </div>
                </div>

                {/* 办学性质 + 院校档次 并排 */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-tertiary)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".5px" }}>办学性质</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {NATURE_OPTIONS.map(n => {
                        const active = cNature.includes(n);
                        return (
                          <button key={n} onClick={() => setCNature(prev => active ? prev.filter(x => x !== n) : [...prev, n])} style={{
                            padding: "6px 14px", borderRadius: 980, fontSize: 13, cursor: "pointer",
                            border: active ? "none" : "1px solid var(--color-separator)",
                            background: active ? "var(--color-navy)" : "var(--color-bg)",
                            color: active ? "#fff" : "var(--color-text-secondary)", transition: "all .15s",
                          }}>{n}</button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-tertiary)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".5px" }}>院校档次</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {TIER_OPTIONS.map(t => {
                        const active = cTiers.includes(t);
                        return (
                          <button key={t} onClick={() => setCTiers(prev => active ? prev.filter(x => x !== t) : [...prev, t])} style={{
                            padding: "6px 14px", borderRadius: 980, fontSize: 13, cursor: "pointer",
                            border: active ? "none" : "1px solid var(--color-separator)",
                            background: active ? "var(--color-navy)" : "var(--color-bg)",
                            color: active ? "#fff" : "var(--color-text-secondary)", transition: "all .15s",
                          }}>{t}</button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={loading || (mode === "rank" ? !rank : !mockScore)}
            style={{ width: "100%", fontSize: 17, padding: "16px" }}
          >
            {loading ? (
              <><span className="spin-icon" />分析中</>
            ) : "查一查，我有没有错过什么好学校"}
          </button>
          {submitError && (
            <div style={{
              marginTop: 12,
              padding: "10px 14px",
              background: "rgba(255,59,48,0.08)",
              border: "1px solid rgba(255,59,48,0.25)",
              borderRadius: 10,
              fontSize: 13,
              color: "#ff3b30",
              textAlign: "center",
              lineHeight: 1.5,
              whiteSpace: "pre-line",
            }}>
              {submitError}
            </div>
          )}
          <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", textAlign: "center", marginTop: 12 }}>
            免费预览结果 · 完整报告¥1.99 · 无需注册
          </p>
          <p style={{ fontSize: 11, color: "#D97706", textAlign: "center", marginTop: 6 }}>
            ⚠️ 每年都有人在填报截止前一天才发现这里——别成为那个人
          </p>
        </div>

        {/* ── 工具入口 ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, width: "100%", maxWidth: 480, marginTop: 16 }}>
          <div style={{ padding: "16px 18px", borderRadius: 14, background: "linear-gradient(135deg, rgba(201,146,42,0.12) 0%, rgba(26,39,68,0.08) 100%)", border: "1.5px solid rgba(201,146,42,0.35)", color: "var(--color-text-primary)" }}>
            <div style={{ fontSize: 10, letterSpacing: 1.5, opacity: 0.6, marginBottom: 6, color: "var(--color-accent)" }}>SCHOOLS</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, lineHeight: 1.3 }}>学校库</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: "var(--color-text-secondary)", marginBottom: 14 }}>
              全国院校信息、专业目录、学科评估、就业数据一站式查询
            </div>
            <Link href="/search" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
              进入学校库 →
            </Link>
          </div>
          <div style={{ padding: "16px 18px", borderRadius: 14, background: "linear-gradient(135deg, rgba(26,39,68,0.08) 0%, rgba(201,146,42,0.08) 100%)", border: "1.5px solid rgba(26,39,68,0.25)", color: "var(--color-text-primary)" }}>
            <div style={{ fontSize: 10, letterSpacing: 1.5, opacity: 0.6, marginBottom: 6, color: "var(--color-navy)" }}>COMPARE</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, lineHeight: 1.3 }}>学校对比</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: "var(--color-text-secondary)", marginBottom: 14 }}>
              最多同时对比 3 所学校，录取数据、学科评估、就业流向横向比较
            </div>
            <Link href="/compare" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-navy)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
              开始对比 →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Section 2: Value Props (3 columns) ── */}
      <section style={{ background: "var(--color-bg-secondary)", padding: "80px 20px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <h2 style={{ textAlign: "center", fontFamily: "var(--font-display)", fontSize: "clamp(28px, 5vw, 42px)", fontWeight: 700, marginBottom: 12, letterSpacing: "-0.3px" }}>
            同样的位次，差距在这里
          </h2>
          <p style={{ textAlign: "center", fontSize: 16, color: "var(--color-text-secondary)", marginBottom: 40 }}>
            4年后你在哪，取决于今天选了哪所学校
          </p>
          {/* Desktop table */}
          <div className="hide-on-mobile" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 540 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "12px 16px", color: "var(--color-text-tertiary)", fontWeight: 500, borderBottom: "2px solid var(--color-separator)", width: "20%" }}>场景</th>
                  <th style={{ textAlign: "left", padding: "12px 16px", color: "#ff3b30", fontWeight: 600, borderBottom: "2px solid var(--color-separator)", width: "38%" }}>❌ 传统推荐</th>
                  <th style={{ textAlign: "left", padding: "12px 16px", color: "#34c759", fontWeight: 600, borderBottom: "2px solid var(--color-separator)", width: "42%" }}>✅ 水卢冷门高报引擎</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["数据来源", "官方录取分数线", "官方数据 + 10万条民间口碑，交叉验证赋权"],
                  ["选学校", "看985/211名气和排名", "主动过滤虚高学校，挖掘真正就业强的冷门院校"],
                  ["看就业", "相信学校官方自报数据", "社区真实反馈 + 毕业生薪资，屏蔽学校公关数据"],
                  ["预测未来", "只看当年录取概率", "10年趋势预判：4年后哪些专业会崛起或衰落"],
                  ["花多少钱", "顾问咨询 ¥1,000–5,000", "免费预览 · 完整报告¥1.99，比机构便宜99.9%"],
                ].map(([scene, traditional, algorithm], i) => (
                  <tr key={scene} style={{ background: i % 2 === 0 ? "var(--color-bg)" : "transparent" }}>
                    <td style={{ padding: "14px 16px", color: "var(--color-text-secondary)", fontWeight: 500, borderBottom: "1px solid var(--color-separator)" }}>{scene}</td>
                    <td style={{ padding: "14px 16px", color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-separator)" }}>{traditional}</td>
                    <td style={{ padding: "14px 16px", color: "var(--color-text-primary)", fontWeight: 500, borderBottom: "1px solid var(--color-separator)" }}>{algorithm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="show-on-mobile" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              ["数据来源", "官方录取分数线", "官方数据 + 10万条民间口碑，交叉验证赋权"],
              ["选学校", "看985/211名气和排名", "主动过滤虚高学校，挖掘真正就业强的冷门院校"],
              ["看就业", "相信学校官方自报数据", "社区真实反馈 + 毕业生薪资，屏蔽学校公关数据"],
              ["预测未来", "只看当年录取概率", "10年趋势预判：4年后哪些专业会崛起或衰落"],
              ["花多少钱", "顾问咨询 ¥1,000–5,000", "免费预览 · 完整报告¥1.99，比机构便宜99.9%"],
            ].map(([scene, traditional, algorithm], i) => (
              <div key={scene} style={{ background: i % 2 === 0 ? "var(--color-bg)" : "transparent", borderRadius: 10, border: "1px solid var(--color-separator)", padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{scene}</div>
                <div style={{ fontSize: 13, color: "#ff3b30", marginBottom: 6, lineHeight: 1.5 }}>❌ {traditional}</div>
                <div style={{ fontSize: 13, color: "#34c759", fontWeight: 500, lineHeight: 1.5 }}>✅ {algorithm}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 2b: 独家算法功能 ── */}
      <section style={{ padding: "80px 20px", background: "var(--color-bg)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          {/* 标题 */}
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div style={{ display: "inline-block", background: "linear-gradient(135deg, #1A2744 0%, #2d4a8a 100%)", borderRadius: 980, padding: "6px 18px", fontSize: 12, color: "#fff", marginBottom: 20, letterSpacing: ".5px", fontWeight: 600 }}>
              全网独有 · 竞品均未实现
            </div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(28px, 5vw, 42px)", fontWeight: 700, marginBottom: 14, letterSpacing: "-0.3px" }}>
              概率，不是一个数字
            </h2>
            <p style={{ fontSize: 16, color: "var(--color-text-secondary)", maxWidth: 520, margin: "0 auto", lineHeight: 1.7 }}>
              所有竞品给你「录取概率 63%」——这没有意义。<br />
              我们给你的是：<strong style={{ color: "var(--color-text-primary)" }}>63%  [区间 55%–71%] · 今年大年窗口 · 竞争密度低</strong>
            </p>
          </div>

          {/* 3张卡片 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20, marginBottom: 40 }}>
            {/* 卡片1：置信区间 */}
            <div className="apple-card-elevated" style={{ padding: "28px 24px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, right: 0, background: "var(--color-accent)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "4px 12px", borderBottomLeftRadius: 10, letterSpacing: ".5px" }}>行业首创</div>
              <div style={{ fontSize: 28, marginBottom: 16 }}>📊</div>
              <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 10 }}>置信区间</h3>
              <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 16 }}>
                不说「63%录取」，说「63% [55%–71%]」。区间越宽，说明该校今年波动越大、越要小心。
              </p>
              {/* 可视化示例 */}
              <div style={{ background: "var(--color-bg-secondary)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 8 }}>示例：某院校·计算机专业</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "var(--color-accent)", minWidth: 44 }}>63%</div>
                  <div style={{ flex: 1, height: 8, background: "var(--color-separator)", borderRadius: 4, position: "relative" }}>
                    <div style={{ position: "absolute", left: "45%", right: "22%", height: "100%", background: "var(--color-accent)", borderRadius: 4, opacity: 0.3 }} />
                    <div style={{ position: "absolute", left: "calc(63% - 4px)", top: -3, width: 14, height: 14, background: "var(--color-accent)", borderRadius: "50%", border: "2px solid #fff", boxShadow: "0 1px 4px rgba(0,0,0,.15)" }} />
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>区间：<strong>55% – 71%</strong>　建议：列为稳志愿</div>
              </div>
            </div>

            {/* 卡片2：大年/小年 */}
            <div className="apple-card-elevated" style={{ padding: "28px 24px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, right: 0, background: "var(--color-accent)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "4px 12px", borderBottomLeftRadius: 10, letterSpacing: ".5px" }}>行业首创</div>
              <div style={{ fontSize: 28, marginBottom: 16 }}>📈</div>
              <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 10 }}>大年/小年周期检测</h3>
              <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 16 }}>
                热门学校往往呈现「大年→小年→大年」周期。我们识别今年处于哪个阶段，告诉你是进攻窗口还是危险陷阱。
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { year: "2022大年", rank: 12400, color: "#ff3b30" },
                  { year: "2023小年", rank: 15200, color: "#34c759" },
                  { year: "2024大年", rank: 11800, color: "#ff3b30" },
                  { year: "2025预测↓", rank: "→ 小年窗口", color: "#34c759", bold: true },
                ].map(({ year, rank, color, bold }) => (
                  <div key={year} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--color-separator)" }}>
                    <span style={{ color: "var(--color-text-secondary)" }}>{year}</span>
                    <span style={{ fontWeight: bold ? 700 : 500, color }}>{typeof rank === "number" ? `录取位次 ${rank}` : rank}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 卡片3：竞争密度 */}
            <div className="apple-card-elevated" style={{ padding: "28px 24px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, right: 0, background: "var(--color-accent)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "4px 12px", borderBottomLeftRadius: 10, letterSpacing: ".5px" }}>行业首创</div>
              <div style={{ fontSize: 28, marginBottom: 16 }}>🎯</div>
              <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 10 }}>竞争密度修正</h3>
              <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 16 }}>
                你在某位次段，和你竞争同一个学校的人越多，概率越低。我们实时检测该位次段的拥挤程度，自动修正概率。
              </p>
              <div style={{ background: "var(--color-bg-secondary)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 10 }}>同位次段竞争者数量对概率的影响</div>
                {[
                  { label: "低竞争（8人）", raw: "68%", adjusted: "68%", delta: "无调整" },
                  { label: "中竞争（18人）", raw: "68%", adjusted: "65%", delta: "↓3%" },
                  { label: "高竞争（30人）", raw: "68%", adjusted: "60%", delta: "↓8%", warn: true },
                ].map(({ label, adjusted, delta, warn }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "5px 0", borderBottom: "1px solid var(--color-separator)" }}>
                    <span style={{ color: "var(--color-text-secondary)" }}>{label}</span>
                    <span style={{ fontWeight: 600, color: warn ? "#ff3b30" : "var(--color-text-primary)" }}>{adjusted} <span style={{ fontSize: 10, color: warn ? "#ff3b30" : "var(--color-text-secondary)", fontWeight: 400 }}>{delta}</span></span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 底部对比说明 */}
          <div style={{ background: "linear-gradient(135deg, #1A2744 0%, #2d3a6b 100%)", borderRadius: "var(--radius-md)", padding: "28px 32px", color: "#fff", display: "flex", gap: 32, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <p style={{ fontSize: 13, opacity: .7, marginBottom: 6 }}>竞品告诉你</p>
              <p style={{ fontSize: 18, fontWeight: 600 }}>「录取概率 63%」</p>
            </div>
            <div style={{ fontSize: 24, opacity: .4 }}>→</div>
            <div style={{ flex: 2, minWidth: 260 }}>
              <p style={{ fontSize: 13, opacity: .7, marginBottom: 6 }}>我们告诉你</p>
              <p style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.5 }}>
                「63% <span style={{ fontSize: 14, opacity: .8 }}>[55%–71%]</span>  ·  今年小年窗口 <span style={{ color: "#34c759" }}>↑</span>  ·  该位次竞争较少 <span style={{ color: "#34c759" }}>✓</span>  ·  建议：冲」
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 3: 冷门好学校 Explainer ── */}
      <section style={{ padding: "80px 20px", background: "var(--color-bg-secondary)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ display: "inline-block", background: "#fff3cd", border: "1px solid #ffe082", borderRadius: 980, padding: "6px 16px", fontSize: 12, color: "#b45309", marginBottom: 24, letterSpacing: ".3px" }}>
            核心功能
          </div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(28px, 5vw, 42px)", fontWeight: 700, marginBottom: 16, letterSpacing: "-0.3px" }}>
            什么是「冷门好学校」？
          </h2>
          <p style={{ fontSize: 16, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 48, maxWidth: 600 }}>
            很多学校名气高，但毕业生真实反馈是「学校很水」。我们的算法抓取社区论坛口碑，主动将这类虚高学校降权——同时把就业强、排名低的冷门院校挖掘出来。
          </p>

          {/* Case study */}
          <div className="case-study-grid" style={{ marginBottom: 48 }}>
            {/* School A */}
            <div style={{ background: "var(--color-bg-secondary)", borderRadius: "var(--radius-md)", padding: "24px 20px", border: "2px solid var(--color-accent)" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-accent)", letterSpacing: ".5px", marginBottom: 12, textTransform: "uppercase" }}>冷门好校（被我们推荐）</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>某211财经类高校</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[["软科排名", "#185"], ["CS就业月薪", "¥21,800"], ["就业率", "97%"], ["保研率", "31%"]].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                    <span style={{ color: "var(--color-text-secondary)" }}>{k}</span>
                    <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* VS */}
            <div className="case-study-vs" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", fontWeight: 600 }}>同样位次<br />可进</div>
              <div style={{ fontSize: 22, fontWeight: 700, margin: "8px 0", color: "var(--color-text-secondary)" }}>VS</div>
            </div>

            {/* School B */}
            <div style={{ background: "var(--color-bg-secondary)", borderRadius: "var(--radius-md)", padding: "24px 20px", border: "1px solid var(--color-separator)" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-tertiary)", letterSpacing: ".5px", marginBottom: 12, textTransform: "uppercase" }}>常规选择（排名更高）</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>某985综合类高校</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[["软科排名", "#45 (更高)"], ["CS就业月薪", "¥18,200"], ["就业率", "89%"], ["保研率", "22%"]].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                    <span style={{ color: "var(--color-text-secondary)" }}>{k}</span>
                    <span style={{ fontWeight: 600, color: k === "软科排名" ? "var(--color-text-primary)" : "var(--color-danger)" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ background: "var(--color-bg-secondary)", borderRadius: "var(--radius-md)", padding: "24px 28px", borderLeft: "4px solid var(--color-accent)" }}>
            <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>只看排名，4年后可能后悔。</p>
            <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
              我们识别了 <strong>317 所</strong>「价值洼地」院校：就业质量高 × 名气被低估 × 民间口碑真实正向。
              更重要的是，我们基于10年趋势预测这些专业4年后的走向——帮你选的不是今天的热门，而是毕业时候的赢家。
            </p>
          </div>
        </div>
      </section>

      {/* ── Section 5: How It Works ── */}
      <section id="how-it-works" style={{ padding: "80px 20px", background: "var(--color-bg)" }}>
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(28px, 5vw, 42px)", fontWeight: 700, marginBottom: 16, letterSpacing: "-0.3px", textAlign: "center" }}>
            这个预测系统如何工作？
          </h2>
          <p style={{ fontSize: 16, color: "var(--color-text-secondary)", textAlign: "center", marginBottom: 56 }}>四步分析，从今天的位次预测到4年后的结果</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {[
              {
                step: "01",
                title: "录取可能性分析",
                desc: "基于8年历史位次数据，结合当年招生计划，计算你在每所学校/专业的录取概率区间，识别今年是进攻窗口还是高风险陷阱。",
              },
              {
                step: "02",
                title: "民间口碑验证 + 虚高学校过滤",
                desc: "抓取10万条社区论坛学生反馈，算法验证后赋予权重。主动降权「看似高大上但口碑差」的院校，确保推荐列表里只出现真正值得考虑的学校。",
              },
              {
                step: "03",
                title: "4年后价值预测",
                desc: "用10年志愿填报热度趋势，结合产业发展方向，预判哪些专业/院校在你毕业时会崛起，哪些热门方向正在走下坡——帮你选的是未来的赢家。",
              },
              {
                step: "04",
                title: "个性化冲稳保方案",
                desc: "按冲/稳/保三层分类，推荐最优组合。每条推荐附带详细理由：录取概率 + 就业前景 + 趋势预测 + 填报策略建议。",
              },
            ].map(({ step, title, desc }, i) => (
              <div key={step} style={{ display: "flex", gap: 24, paddingBottom: 40, position: "relative" }}>
                {i < 3 && <div style={{ position: "absolute", left: 19, top: 44, width: 2, height: "calc(100% - 44px)", background: "var(--color-separator)" }} />}
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--color-accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                  {step}
                </div>
                <div style={{ paddingTop: 8 }}>
                  <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>{title}</h3>
                  <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 6: Data Sources ── */}
      <section style={{ background: "var(--color-bg-secondary)", padding: "80px 20px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", textAlign: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(28px, 5vw, 42px)", fontWeight: 700, marginBottom: 12, letterSpacing: "-0.3px" }}>
            数据从哪里来？
          </h2>
          <p style={{ fontSize: 16, color: "var(--color-text-secondary)", marginBottom: 48 }}>官方权威数据 + 民间真实反馈，两条腿走路</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
            {[
              { icon: "📋", title: "多年录取历史", desc: "教育部公开的各院校分省录取数据（多数省份2019–2025，含全国31省市区）" },
              { icon: "💬", title: "社区口碑数据库", desc: "公开社区中在校生/毕业生真实反馈，算法验证去噪后赋权" },
              { icon: "💼", title: "各校就业质量报告", desc: "3,217所高校的平均薪资、就业率、深造率、头部雇主数据" },
              { icon: "🔮", title: "10年填报趋势", desc: "院校/专业报考热度10年变化，预判未来走向而非仅看当下排名" },
              { icon: "🎓", title: "教育部学科评估", desc: "第四轮学科评估全量数据（A+/A/A-/B+/B/B-），识别顶尖学科" },
              { icon: "🔬", title: "专业就业数据库", desc: "5,000+个专业的全国平均月薪、满意度、典型职业方向" },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="apple-card" style={{ padding: "20px", textAlign: "left" }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 6 }}>{title}</div>
                <p style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 7: Social Proof / Testimonials ── */}
      <section style={{ padding: "72px 20px", background: "var(--color-bg)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", textAlign: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(28px, 5vw, 42px)", fontWeight: 700, marginBottom: 8, letterSpacing: "-0.3px" }}>
            他们怎么说
          </h2>
          <p style={{ fontSize: 16, color: "var(--color-text-secondary)", marginBottom: 40 }}>来自真实用户的反馈</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, textAlign: "left" }}>
            {[
              {
                avatar: "👨‍👩‍👧",
                name: "湖北 · 王先生",
                score: "位次 8,300",
                text: "机构报价4000，这里¥1.99，数据比机构还详细。孩子最后上了华中农大的冷门强势学科，毕业薪资比我们预期高30%。",
              },
              {
                avatar: "👩",
                name: "广东 · 刘同学",
                score: "位次 23,000",
                text: "我自己用的，发现了几所「名字冷、学科强」的学校，是我根本不会主动搜的。最后报了南京信息工程大学，专业就业全国前三。",
              },
              {
                avatar: "👨‍👩‍👦",
                name: "山东 · 赵女士",
                score: "位次 41,500",
                text: "报告里有「大小年分析」，看懂之后知道哪些学校今年报的人少、容易捡漏。孩子超出预期进了省内好学校的王牌专业。",
              },
            ].map((t) => (
              <div key={t.name} className="apple-card" style={{ padding: "20px 22px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 28, lineHeight: 1 }}>{t.avatar}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{t.score}</div>
                  </div>
                  <div style={{ marginLeft: "auto", color: "#FFB800", fontSize: 12, letterSpacing: 1 }}>★★★★★</div>
                </div>
                <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.7, margin: 0 }}>{t.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 8: Final CTA ── */}
      <section style={{ padding: "80px 20px 100px", background: "var(--color-bg)", textAlign: "center" }}>
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(32px, 6vw, 56px)", fontWeight: 700, marginBottom: 20, letterSpacing: "-1px", lineHeight: 1.1 }}>
            你在给孩子<br />选未来。
          </h2>
          <p style={{ fontSize: 18, color: "var(--color-text-secondary)", marginBottom: 48, lineHeight: 1.6 }}>
            别让排名表替你做决定。
          </p>
          <button className="btn-primary" style={{ fontSize: 18, padding: "16px 48px", borderRadius: 980 }} onClick={scrollToQuery}>
            免费查询
          </button>
          <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 16 }}>
            无需注册 · 3分钟 · 免费预览
          </p>
        </div>
      </section>

      {/* ── History quick-access ── */}
      <HistoryQuickAccess />

      {/* ── Footer ── */}
      <footer style={{ borderTop: "1px solid var(--color-separator)", padding: "24px 20px", display: "flex", justifyContent: "center", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>
          © 2026 水卢冷门高报引擎 · 袁希团队出品
        </span>
        {[["学校数据库", "/search"], ["我的志愿表", "/form"], ["学校对比", "/compare"], ["用户协议", "/terms"], ["隐私政策", "/privacy"]].map(([label, href]) => (
          <Link key={href} href={href} style={{ fontSize: 13, color: "var(--color-text-secondary)", textDecoration: "none" }}
            onMouseOver={e => (e.currentTarget.style.color = "var(--color-text-primary)")}
            onMouseOut={e => (e.currentTarget.style.color = "var(--color-text-secondary)")}
          >{label}</Link>
        ))}
        <button
          onClick={() => setShowFeedback(true)}
          style={{ fontSize: 13, color: "var(--color-text-secondary)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}
          onMouseOver={e => (e.currentTarget.style.color = "var(--color-text-primary)")}
          onMouseOut={e => (e.currentTarget.style.color = "var(--color-text-secondary)")}
        >意见反馈</button>
        <a
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 12, color: "var(--color-text-tertiary)", textDecoration: "none" }}
        >京ICP备2026015008号</a>
      </footer>

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin-icon { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.3); border-top-color: #fff; border-radius: 50%; display: inline-block; animation: spin .7s linear infinite; margin-right: 8px; vertical-align: middle; }
        @media (max-width: 600px) {
          .mobile-break { display: none; }
          section { padding-left: 16px !important; padding-right: 16px !important; }
        }
      `}</style>
    </main>
  );
}
