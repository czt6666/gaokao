"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "";
const STORAGE_KEY = "gaokao_compare";
const MAX_COMPARE = 3;

interface SchoolDetail {
  school: {
    name: string;
    province: string;
    city: string;
    tier: string;
    is_985: string;
    is_211: string;
    rank_2025: number;
    postgrad_rate: string;
    nature: string;
    flagship_majors: string;
    city_level: string;
    admin_dept: string;
    founded_year: number;
    male_ratio: string;
    female_ratio: string;
    website: string;
    intro: string;
    employment_quality: string;
    subject_evaluations: Array<{ subject: string; grade: string }>;
  };
  majors: Array<{
    major_name: string;
    records: Array<{ year: number; min_rank: number; min_score: number }>;
  }>;
}

interface CompareItem { name: string; data: SchoolDetail | null; loading: boolean }

const TIER_COLOR: Record<string, string> = {
  "985":    "#DC2626",
  "211":    "var(--color-accent)",
  "双一流": "var(--color-navy)",
  "普通":   "var(--color-text-tertiary)",
};

const GRADE_COLOR: Record<string, string> = {
  "A+": "#DC2626", "A": "var(--color-accent)", "A-": "#D97706",
  "B+": "var(--color-navy)", "B": "var(--color-text-secondary)",
};

function Row({ label, cells }: { label: string; cells: (React.ReactNode)[] }) {
  return (
    <tr style={{ borderTop: "1px solid var(--color-separator)" }}>
      <td style={{ padding: "12px 12px 12px 0", fontSize: 12, color: "var(--color-text-tertiary)", fontWeight: 500, width: 80, verticalAlign: "top", whiteSpace: "nowrap" }}>
        {label}
      </td>
      {cells.map((cell, i) => (
        <td key={i} style={{ padding: "12px", fontSize: 13, color: "var(--color-text-primary)", verticalAlign: "top" }}>
          {cell || <span style={{ color: "var(--color-text-tertiary)" }}>—</span>}
        </td>
      ))}
      {cells.length < MAX_COMPARE && Array(MAX_COMPARE - cells.length).fill(null).map((_, i) => (
        <td key={`empty-${i}`} style={{ padding: "12px", fontSize: 13, color: "var(--color-text-tertiary)", verticalAlign: "top" }}>—</td>
      ))}
    </tr>
  );
}

function MobileSchoolCard({ item, onRemove, candidateProvince }: {
  item: CompareItem;
  onRemove: () => void;
  candidateProvince: string;
}) {
  const s = item.data?.school;
  const majors = item.data?.majors;

  const field = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid rgba(26,39,68,0.06)" }}>
      <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", flexShrink: 0, marginRight: 12 }}>{label}</span>
      <span style={{ fontSize: 13, color: "var(--color-text-primary)", textAlign: "right", lineHeight: 1.5 }}>{value || "—"}</span>
    </div>
  );

  const allRecords = majors?.flatMap((m) => m.records).filter((r) => r.min_rank > 0) || [];
  const recentRecords = [...allRecords].sort((a, b) => b.year - a.year).slice(0, 5);

  const aclass = s?.subject_evaluations.filter((e) => ["A+", "A", "A-"].includes(e.grade)) || [];

  return (
    <div style={{
      background: "var(--color-bg-secondary)", border: "1px solid var(--color-separator)",
      borderRadius: 16, overflow: "hidden",
    }}>
      {/* 头部 */}
      <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--color-separator)", background: "var(--color-bg)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            {item.loading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-text-tertiary)" }}>
                <div style={{ width: 16, height: 16, border: "2px solid var(--color-accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                加载中…
              </div>
            ) : s ? (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: TIER_COLOR[s.tier] || "var(--color-text-tertiary)", marginBottom: 4, letterSpacing: "0.05em" }}>
                  {s.tier}
                </div>
                <Link href={`/school/${encodeURIComponent(item.name)}?province=${encodeURIComponent(candidateProvince)}`} style={{ fontSize: 17, fontWeight: 800, color: "var(--color-navy)", textDecoration: "none" }}>
                  {item.name}
                </Link>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4 }}>
                  {s.city} · {s.nature}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: "var(--color-danger)" }}>加载失败</div>
            )}
          </div>
          <button onClick={onRemove} style={{ background: "none", border: "none", fontSize: 20, color: "var(--color-text-tertiary)", cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
        </div>
      </div>

      {/* 详情 */}
      {s && (
        <div style={{ padding: "0 16px" }}>
          {field("软科排名", s.rank_2025 && s.rank_2025 > 0 ? `第 ${s.rank_2025} 名` : "未上榜")}
          {field("所在城市", `${s.city || "—"} ${s.city_level ? `（${s.city_level}）` : ""}`)}
          {field("主管部门", s.admin_dept)}
          {field("保研率", s.postgrad_rate)}
          {field("男女比例", `${s.male_ratio || "—"} / ${s.female_ratio || "—"}`)}
          {field("建校年份", s.founded_year ? `${s.founded_year}年` : null)}

          {/* A类学科 */}
          <div style={{ padding: "10px 0", borderBottom: "1px solid rgba(26,39,68,0.06)" }}>
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 8 }}>A类学科</div>
            {aclass.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {aclass.slice(0, 8).map((e) => (
                  <span key={e.subject} style={{
                    fontSize: 11, padding: "4px 8px", borderRadius: 6,
                    background: "var(--color-bg)", border: "1px solid var(--color-separator)",
                    color: GRADE_COLOR[e.grade] || "var(--color-text-secondary)", fontWeight: 600,
                  }}>
                    {e.grade} {e.subject}
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>暂无A类学科</span>
            )}
          </div>

          {field("王牌专业", s.flagship_majors ? s.flagship_majors.replace(/（本）|（专）/g, "").slice(0, 80) : null)}
          {field("就业流向", s.employment_quality ? s.employment_quality.slice(0, 80) : null)}

          {/* 录取位次 */}
          <div style={{ padding: "10px 0" }}>
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 8 }}>录取位次</div>
            {recentRecords.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {recentRecords.map((r, i) => (
                  <div key={`${r.year}-${r.min_rank}-${i}`} style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                    {r.year}年: <strong style={{ color: "var(--color-navy)" }}>{r.min_rank.toLocaleString()}</strong> 位
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>暂无数据</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ComparePage() {
  const router = useRouter();
  const [items, setItems] = useState<CompareItem[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ name: string; tier: string; province: string }>>([]);
  const [candidateProvince, setCandidateProvince] = useState("北京");

  useEffect(() => {
    try {
      const p = localStorage.getItem("gaokao_province");
      if (p) setCandidateProvince(p);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const names: string[] = JSON.parse(saved);
        const init = names.slice(0, MAX_COMPARE).map((n) => ({ name: n, data: null, loading: true }));
        setItems(init);
        init.forEach((it) => loadSchool(it.name));
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSchool = async (name: string, prov?: string) => {
    const province = prov || candidateProvince || "北京";
    try {
      const res = await fetch(`${API}/api/school/${encodeURIComponent(name)}?province=${encodeURIComponent(province)}`);
      const data = await res.json();
      setItems((prev) =>
        prev.map((it) => it.name === name ? { ...it, data, loading: false } : it)
      );
    } catch {
      setItems((prev) =>
        prev.map((it) => it.name === name ? { ...it, loading: false } : it)
      );
    }
  };

  const addSchool = async (name: string) => {
    if (items.length >= MAX_COMPARE) return;
    if (items.find((i) => i.name === name)) return;
    const newItem: CompareItem = { name, data: null, loading: true };
    const next = [...items, newItem];
    setItems(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.map((i) => i.name)));
    setSearchQ("");
    setSearchResults([]);
    await loadSchool(name);
  };

  const removeSchool = (name: string) => {
    const next = items.filter((i) => i.name !== name);
    setItems(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.map((i) => i.name)));
  };

  const doSearch = async (q: string) => {
    setSearchQ(q);
    if (!q.trim()) { setSearchResults([]); return; }
    try {
      const res = await fetch(`${API}/api/search/schools?q=${encodeURIComponent(q)}&limit=8`);
      const data = await res.json();
      setSearchResults(data.schools || []);
    } catch {
      setSearchResults([]);
    }
  };

  const schools = items.map((it) => it.data?.school);
  const loaded = items.filter((it) => !it.loading && it.data);

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text-primary)" }}>
      {/* 顶部导航 */}
      <nav className="apple-nav">
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "8px 20px", minHeight: 48, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button onClick={() => router.back()} className="btn-ghost" style={{ fontSize: 14, color: "var(--color-text-secondary)", paddingLeft: 0, paddingRight: 0 }}>← 返回</button>
          <span style={{ color: "var(--color-separator)" }}>|</span>
          <h1 style={{ fontSize: 14, fontWeight: 600 }}>学校对比</h1>
          <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>最多对比 {MAX_COMPARE} 所</span>
          <span style={{ fontSize: 12, color: "var(--color-accent)", marginLeft: "auto" }}>
            录取数据：{candidateProvince}考生视角
          </span>
        </div>
      </nav>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 20px" }}>
        {/* 搜索添加学校 */}
        {items.length < MAX_COMPARE && (
          <div style={{ position: "relative", marginBottom: 24 }}>
            <input
              type="text"
              value={searchQ}
              onChange={(e) => doSearch(e.target.value)}
              placeholder="搜索学校并加入对比…"
              style={{
                width: "100%", padding: "12px 16px",
                background: "var(--color-bg-secondary)",
                border: "1px solid var(--color-separator)",
                borderRadius: 12, fontSize: 14,
                color: "var(--color-text-primary)",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            {searchResults.length > 0 && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                background: "var(--color-bg)", border: "1px solid var(--color-separator)",
                borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-md)", zIndex: 20,
              }}>
                {searchResults.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => addSchool(s.name)}
                    style={{
                      width: "100%", textAlign: "left", padding: "10px 16px",
                      background: "none", border: "none", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      borderBottom: "1px solid var(--color-separator)",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-secondary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <span style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)" }}>{s.name}</span>
                    <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{s.province} · {s.tier}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: "var(--color-text-tertiary)" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚖️</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 8 }}>还没有添加对比学校</div>
            <div style={{ fontSize: 14 }}>在上方搜索框输入学校名称，或在推荐结果页点击「对比」</div>
          </div>
        ) : (
          <>
            {/* ── 桌面端：横向表格 ── */}
            <div className="hide-on-mobile" style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              {/* 学校头部卡片 */}
              <div style={{ display: "flex", gap: 12, marginBottom: 24, minWidth: 640 }}>
                <div style={{ width: 92, flexShrink: 0 }} />
                {items.map((item) => (
                  <div key={item.name} style={{
                    flex: 1, background: "var(--color-bg-secondary)", border: "1px solid var(--color-separator)",
                    borderRadius: 14, padding: 16, position: "relative", minWidth: 180,
                  }}>
                    <button
                      onClick={() => removeSchool(item.name)}
                      style={{
                        position: "absolute", top: 10, right: 10,
                        fontSize: 18, color: "var(--color-text-tertiary)", background: "none", border: "none",
                        cursor: "pointer", lineHeight: 1,
                      }}
                    >×</button>
                    {item.loading ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-text-tertiary)" }}>
                        <div style={{ width: 16, height: 16, border: "2px solid var(--color-accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                        加载中…
                      </div>
                    ) : item.data ? (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 600, color: TIER_COLOR[item.data.school.tier] || "var(--color-text-tertiary)", marginBottom: 4 }}>
                          {item.data.school.tier}
                        </div>
                        <Link
                          href={`/school/${encodeURIComponent(item.name)}?province=${encodeURIComponent(candidateProvince)}`}
                          style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", textDecoration: "none" }}
                        >
                          {item.name}
                        </Link>
                        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4 }}>
                          {item.data.school.city} · {item.data.school.nature}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 13, color: "var(--color-danger)" }}>加载失败</div>
                    )}
                  </div>
                ))}
                {/* 空槽 */}
                {Array(MAX_COMPARE - items.length).fill(null).map((_, i) => (
                  <div key={`slot-${i}`} style={{
                    flex: 1, border: "2px dashed var(--color-separator)", borderRadius: 14, padding: 16,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, color: "var(--color-text-tertiary)", minWidth: 180,
                  }}>
                    + 添加学校
                  </div>
                ))}
              </div>

              {/* 对比表格 */}
              {loaded.length > 0 && (
                <div style={{
                  background: "var(--color-bg-secondary)", border: "1px solid var(--color-separator)",
                  borderRadius: 14, padding: "0 16px", overflow: "hidden", minWidth: 640,
                }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      <Row label="软科排名" cells={schools.map((s) => s?.rank_2025 && s.rank_2025 > 0 ? `第 ${s.rank_2025} 名` : "未上榜")} />
                      <Row label="所在城市" cells={schools.map((s) => s ? `${s.city || "—"}（${s.city_level || ""}）` : "")} />
                      <Row label="主管部门" cells={schools.map((s) => s?.admin_dept || "")} />
                      <Row label="保研率"   cells={schools.map((s) => s?.postgrad_rate || "")} />
                      <Row label="男女比例" cells={schools.map((s) => s ? `${s.male_ratio || "—"} / ${s.female_ratio || "—"}` : "")} />
                      <Row label="建校年份" cells={schools.map((s) => s?.founded_year ? `${s.founded_year}年` : "")} />
                      <Row
                        label="A类学科"
                        cells={items.map((it) => {
                          if (!it.data) return null;
                          const aclass = it.data.school.subject_evaluations.filter((e) => ["A+", "A", "A-"].includes(e.grade));
                          return aclass.length > 0 ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {aclass.slice(0, 6).map((e) => (
                                <span key={e.subject} style={{
                                  fontSize: 11, padding: "2px 7px", borderRadius: 6,
                                  background: "var(--color-bg)", border: "1px solid var(--color-separator)",
                                  color: GRADE_COLOR[e.grade] || "var(--color-text-secondary)",
                                  fontWeight: 600,
                                }}>
                                  {e.grade} {e.subject}
                                </span>
                              ))}
                            </div>
                          ) : <span style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>暂无A类学科</span>;
                        })}
                      />
                      <Row
                        label="王牌专业"
                        cells={schools.map((s) => s?.flagship_majors ? (
                          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                            {s.flagship_majors.replace(/（本）|（专）/g, "").slice(0, 100)}
                          </span>
                        ) : null)}
                      />
                      <Row
                        label="就业流向"
                        cells={schools.map((s) => s?.employment_quality ? (
                          <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>{s.employment_quality.slice(0, 100)}</span>
                        ) : null)}
                      />
                      <Row
                        label="录取位次"
                        cells={items.map((it) => {
                          if (!it.data) return null;
                          const allRecords = it.data.majors
                            .flatMap((m) => m.records)
                            .filter((r) => r.min_rank > 0);
                          if (!allRecords.length) return <span style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>暂无数据</span>;
                          const recent = allRecords.sort((a, b) => b.year - a.year).slice(0, 5);
                          return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              {recent.map((r, i) => (
                                <div key={`${r.year}-${r.min_rank}-${i}`} style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                                  {r.year}年: <strong>{r.min_rank.toLocaleString()}</strong> 位
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      />
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── 移动端：垂直卡片 ── */}
            <div className="show-on-mobile" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {items.map((item) => (
                <MobileSchoolCard
                  key={item.name}
                  item={item}
                  onRemove={() => removeSchool(item.name)}
                  candidateProvince={candidateProvince}
                />
              ))}
              {items.length < MAX_COMPARE && (
                <div style={{
                  border: "2px dashed var(--color-separator)", borderRadius: 14, padding: 24,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, color: "var(--color-text-tertiary)", background: "var(--color-bg-secondary)",
                }}>
                  + 添加学校
                </div>
              )}
            </div>
          </>
        )}

        {/* 数据声明 */}
        <div style={{ marginTop: 24, fontSize: 11, color: "var(--color-text-tertiary)", textAlign: "center" }}>
          录取数据基于2017–2025年历史记录，仅供参考，请以官方招生简章为准
        </div>
      </div>
    </div>
  );
}
