"use client";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const TIERS = ["", "985", "211", "双一流", "普通"];
const PROVINCES = [
  "", "北京", "上海", "广东", "浙江", "江苏", "山东", "河南", "湖北",
  "湖南", "四川", "陕西", "辽宁", "吉林", "黑龙江", "安徽", "福建",
  "江西", "山西", "河北", "贵州", "云南", "重庆", "天津", "内蒙古",
  "广西", "新疆", "甘肃", "宁夏", "青海", "海南", "西藏",
];
const SUBJECTS = ["", "物理", "历史", "物理+化学", "物理+生物", "历史+政治", "历史+地理", "历史+生物"];

const PROB_COLORS: Record<string, string> = {
  "高": "#34d399", "中": "#60a5fa", "低": "#f59e0b",
};

interface School {
  name: string;
  province: string;
  city: string;
  tier: string;
  is_985: string;
  is_211: string;
  postgrad_rate: string;
  nature: string;
  rank_2025: number;
  flagship_majors: string;
  city_level: string;
  intro: string;
}

interface MajorResult {
  school_name: string;
  major_name: string;
  subject_req: string;
  probability: number;
  avg_min_rank_3yr: number;
  rank_diff: number;
  confidence: string;
  tier: string;
  is_985: string;
  is_211: string;
  rank_2025: number;
  city: string;
  province_school: string;
  subject_eval_grade: string;
  recent_data: Array<{ year: number; min_rank: number; min_score: number }>;
}

type TabType = "school" | "major";

function SearchPageInner() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<TabType>((searchParams.get("tab") as TabType) || "school");

  // ── School search state ──
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("");
  const [province, setProvince] = useState("");
  const [schools, setSchools] = useState<School[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // ── Major search state ──
  const [majorQ, setMajorQ] = useState("");
  const [majorProvince, setMajorProvince] = useState(searchParams.get("province") || "北京");
  const [majorRank, setMajorRank] = useState(searchParams.get("rank") || "");
  const [majorSubject, setMajorSubject] = useState(searchParams.get("subject") || "");
  const [majorResults, setMajorResults] = useState<MajorResult[]>([]);
  const [majorTotal, setMajorTotal] = useState(0);
  const [majorLoading, setMajorLoading] = useState(false);
  const [majorError, setMajorError] = useState("");

  // ── School search logic ──
  const search = useCallback(async (query: string, t: string, p: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "40" });
      if (query) params.set("q", query);
      if (t) params.set("tier", t);
      if (p) params.set("province_school", p);
      const res = await fetch(`${API}/api/search/schools?${params}`);
      const data = await res.json();
      setSchools(data.schools || []);
      setTotal(data.total || 0);
    } catch {
      setSchools([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q, tier, province), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, tier, province, search]);

  useEffect(() => { search("", "", ""); }, [search]);

  // ── Major search logic ──
  const searchByMajor = useCallback(async () => {
    if (!majorQ.trim()) { setMajorError("请输入专业关键词"); return; }
    if (!majorRank || isNaN(Number(majorRank))) { setMajorError("请输入有效的位次"); return; }
    setMajorError("");
    setMajorLoading(true);
    try {
      const params = new URLSearchParams({
        major: majorQ.trim(),
        province: majorProvince,
        rank: majorRank,
      });
      if (majorSubject) params.set("subject", majorSubject);
      const res = await fetch(`${API}/api/search/by-major?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMajorResults(data.schools || []);
      setMajorTotal(data.total || 0);
    } catch (e) {
      setMajorError("搜索失败，请稍后重试");
      setMajorResults([]);
    } finally {
      setMajorLoading(false);
    }
  }, [majorQ, majorProvince, majorRank, majorSubject]);

  const probColor = (prob: number) =>
    prob >= 80 ? "#34d399" : prob >= 55 ? "#60a5fa" : prob >= 35 ? "#f59e0b" : "#f87171";
  const probLabel = (prob: number) =>
    prob >= 80 ? "保" : prob >= 55 ? "稳" : prob >= 35 ? "冲" : "冲";

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)" }}>
      <nav className="apple-nav">
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 20px", height: 52, display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/" style={{ fontSize: 14, color: "var(--color-text-secondary)", textDecoration: "none" }}>← 返回</Link>
          <span style={{ color: "var(--color-separator)" }}>|</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>高校 & 专业搜索</span>
        </div>
      </nav>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 80px" }}>
        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 0, marginBottom: 28, background: "var(--color-bg-secondary)", borderRadius: 12, padding: 4 }}>
          {([["school", "🏛️ 按学校搜索"], ["major", "📚 按专业找学校"]] as [TabType, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, padding: "10px 0", borderRadius: 10, border: "none", cursor: "pointer",
                fontSize: 14, fontWeight: 600, transition: "all 0.15s",
                background: tab === t ? "var(--color-bg)" : "transparent",
                color: tab === t ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                boxShadow: tab === t ? "0 1px 4px rgba(0,0,0,0.15)" : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── TAB: School search ── */}
        {tab === "school" && (
          <>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 4 }}>搜索全国高校</h2>
              <p style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>覆盖 3,217 所高校，含软科排名、王牌专业、就业数据</p>
            </div>

            <div style={{ background: "var(--color-bg-secondary)", borderRadius: 14, padding: "16px", marginBottom: 20 }}>
              <div style={{ position: "relative", marginBottom: 12 }}>
                <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)", fontSize: 14 }}>🔍</span>
                <input
                  className="apple-input"
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="输入学校名称…"
                  style={{ paddingLeft: 40 }}
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <select className="apple-select" value={tier} onChange={(e) => setTier(e.target.value)} style={{ flex: 1 }}>
                  {TIERS.map((t) => <option key={t} value={t}>{t || "不限层次"}</option>)}
                </select>
                <select className="apple-select" value={province} onChange={(e) => setProvince(e.target.value)} style={{ flex: 1 }}>
                  {PROVINCES.map((p) => <option key={p} value={p}>{p || "不限省份"}</option>)}
                </select>
              </div>
            </div>

            <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", marginBottom: 12 }}>
              {loading ? "搜索中…" : `共 ${total.toLocaleString()} 所`}
              {q && <span> · 关键词 "{q}"</span>}
            </div>

            {loading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "64px 0", color: "var(--color-text-tertiary)", gap: 10 }}>
                <div className="spinner" style={{ width: 20, height: 20 }} />
                <span style={{ fontSize: 14 }}>加载中…</span>
              </div>
            ) : schools.length === 0 ? (
              <div style={{ textAlign: "center", padding: "64px 0", color: "var(--color-text-tertiary)", fontSize: 14 }}>
                未找到匹配的学校
              </div>
            ) : (
              <div>
                {schools.map((s) => (
                  <Link
                    key={s.name}
                    href={`/school/${encodeURIComponent(s.name)}?province=${encodeURIComponent(s.province || '北京')}`}
                    style={{ display: "block", textDecoration: "none", padding: "14px 0", borderBottom: "1px solid var(--color-separator)" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>{s.name}</span>
                          <span className={s.tier === "985" ? "badge-985" : s.tier === "211" ? "badge-211" : s.tier === "双一流" ? "badge-syl" : "badge-plain"}>{s.tier}</span>
                          {s.rank_2025 > 0 && <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>软科 #{s.rank_2025}</span>}
                        </div>
                        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: s.flagship_majors ? 4 : 0 }}>
                          {s.province} · {s.city} · {s.nature}
                          {s.postgrad_rate && s.postgrad_rate !== "nan" && <span style={{ marginLeft: 8 }}>保研率 {s.postgrad_rate}</span>}
                        </div>
                        {s.flagship_majors && (
                          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.flagship_majors.replace(/（本）|（专）/g, "").slice(0, 60)}
                          </div>
                        )}
                      </div>
                      <span style={{ color: "var(--color-text-tertiary)", fontSize: 16, marginLeft: 8, flexShrink: 0 }}>›</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── TAB: Major-first search ── */}
        {tab === "major" && (
          <>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 4 }}>按专业兴趣找学校</h2>
              <p style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>输入感兴趣的专业，系统按录取概率 × 院校质量 × 学科评估综合排序</p>
            </div>

            {/* Input form */}
            <div style={{ background: "var(--color-bg-secondary)", borderRadius: 14, padding: "16px", marginBottom: 20 }}>
              <div style={{ position: "relative", marginBottom: 12 }}>
                <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)", fontSize: 14 }}>📚</span>
                <input
                  className="apple-input"
                  type="text"
                  value={majorQ}
                  onChange={(e) => setMajorQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchByMajor()}
                  placeholder="专业关键词，例如：法学、新闻、会计、计算机…"
                  style={{ paddingLeft: 40 }}
                />
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <select className="apple-select" value={majorProvince} onChange={(e) => setMajorProvince(e.target.value)} style={{ flex: 1 }}>
                  {PROVINCES.filter(p => p).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <input
                  className="apple-input"
                  type="number"
                  value={majorRank}
                  onChange={(e) => setMajorRank(e.target.value)}
                  placeholder="我的位次，例如 15000"
                  style={{ flex: 1 }}
                />
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <select className="apple-select" value={majorSubject} onChange={(e) => setMajorSubject(e.target.value)} style={{ flex: 1 }}>
                  {SUBJECTS.map((s) => <option key={s} value={s}>{s || "选科（可不填）"}</option>)}
                </select>
              </div>
              {majorError && (
                <div style={{ color: "#f87171", fontSize: 13, marginBottom: 10 }}>{majorError}</div>
              )}
              <button
                onClick={searchByMajor}
                disabled={majorLoading}
                style={{
                  width: "100%", padding: "12px 0", borderRadius: 10, border: "none",
                  background: majorLoading ? "var(--color-bg-tertiary)" : "var(--color-accent)",
                  color: "white", fontSize: 15, fontWeight: 600, cursor: majorLoading ? "not-allowed" : "pointer",
                  transition: "all 0.15s",
                }}
              >
                {majorLoading ? "搜索中…" : "🔍 查找可报学校"}
              </button>
            </div>

            {/* Hint chips */}
            {majorResults.length === 0 && !majorLoading && (
              <div style={{ marginBottom: 20 }}>
                <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 8 }}>热门专业快速选择：</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {["法学", "经济学", "会计学", "新闻学", "中文", "英语", "历史学", "金融", "教育学", "管理"].map((kw) => (
                    <button
                      key={kw}
                      onClick={() => { setMajorQ(kw); }}
                      style={{
                        padding: "6px 14px", borderRadius: 20, border: "1px solid var(--color-separator)",
                        background: "var(--color-bg-secondary)", color: "var(--color-text-secondary)",
                        fontSize: 13, cursor: "pointer",
                      }}
                    >
                      {kw}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Results */}
            {majorLoading && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "64px 0", color: "var(--color-text-tertiary)", gap: 10 }}>
                <div className="spinner" style={{ width: 20, height: 20 }} />
                <span style={{ fontSize: 14 }}>分析匹配中…</span>
              </div>
            )}

            {!majorLoading && majorResults.length > 0 && (
              <>
                <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", marginBottom: 16 }}>
                  共找到 <strong style={{ color: "var(--color-text-primary)" }}>{majorTotal.toLocaleString()}</strong> 个专业录取记录，
                  展示前 <strong style={{ color: "var(--color-text-primary)" }}>{majorResults.length}</strong> 条最优结果
                  {majorSubject && <span>（已按 {majorSubject} 过滤选科）</span>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {majorResults.map((r, i) => (
                    <div
                      key={`${r.school_name}-${r.major_name}-${i}`}
                      style={{
                        background: "var(--color-bg-secondary)", borderRadius: 14,
                        padding: "14px 16px", border: "1px solid var(--color-separator)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {/* School name row */}
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
                            <Link
                              href={`/school/${encodeURIComponent(r.school_name)}?province=${encodeURIComponent(majorProvince)}`}
                              style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", textDecoration: "none" }}
                            >
                              {r.school_name}
                            </Link>
                            <span className={r.tier === "985" ? "badge-985" : r.tier === "211" ? "badge-211" : r.tier === "双一流" ? "badge-syl" : "badge-plain"} style={{ fontSize: 11 }}>
                              {r.tier}
                            </span>
                            {r.rank_2025 > 0 && (
                              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>软科#{r.rank_2025}</span>
                            )}
                          </div>
                          {/* Major name */}
                          <div style={{ fontSize: 13, color: "var(--color-accent)", fontWeight: 500, marginBottom: 3 }}>
                            {r.major_name}
                          </div>
                          {/* Location & subject req */}
                          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
                            {r.province_school} · {r.city}
                            {r.subject_req && r.subject_req !== "不限" && r.subject_req !== "nan" && (
                              <span style={{ marginLeft: 8, color: "#f59e0b" }}>选科: {r.subject_req}</span>
                            )}
                            {r.subject_eval_grade && r.subject_eval_grade !== "nan" && (
                              <span style={{ marginLeft: 8, color: "#a78bfa" }}>学评{r.subject_eval_grade}</span>
                            )}
                          </div>
                          {/* Recent ranks */}
                          {r.recent_data && r.recent_data.length > 0 && (
                            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 4, display: "flex", gap: 12 }}>
                              {r.recent_data.slice(0, 3).map((d, di) => (
                                <span key={di}>{d.year}年: {d.min_rank.toLocaleString()}位</span>
                              ))}
                            </div>
                          )}
                        </div>
                        {/* Probability badge */}
                        <div style={{ textAlign: "center", flexShrink: 0, minWidth: 64 }}>
                          <div style={{
                            fontSize: 18, fontWeight: 700,
                            color: probColor(r.probability),
                          }}>
                            {probLabel(r.probability)}
                          </div>
                          <div style={{ fontSize: 13, color: probColor(r.probability), fontWeight: 600 }}>
                            {r.probability.toFixed(0)}%
                          </div>
                          <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                            3yr均{r.avg_min_rank_3yr.toLocaleString()}
                          </div>
                        </div>
                      </div>
                      {/* Probability bar */}
                      <div style={{ marginTop: 10, background: "var(--color-bg-tertiary)", borderRadius: 4, height: 4, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(r.probability, 100)}%`, height: "100%", background: probColor(r.probability), borderRadius: 4, transition: "width 0.4s" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "var(--color-bg)" }} />}>
      <SearchPageInner />
    </Suspense>
  );
}
