"use client";
import { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Employment = {
  avg_salary: number;
  top_city: string;
  top_industry: string;
  satisfaction: number;
  career_direction: string;
  intro: string;
};

type MajorAnalysis = {
  major_name: string;
  subject_req: string;
  plan_count: number;
  tuition: number;
  duration: string;
  records: { year: number; min_rank: number; min_score: number; plan_count: number }[];
  big_small_year: {
    status: string;
    prediction: string;
    heat_trend: string;
    reason: string;
    year_changes: { year: number; change: number }[];
    trend_analysis?: {
      years_used: number;
      slope: number;
      next_year_estimate: number | null;
      confidence: string;
      trend_label: string;
    };
  };
  cognitive_gem: {
    real_direction: string;
    industry_prospect: string;
    misconception: string;
    discount_level: string;
  } | null;
  employment: Employment | null;
};

type SubjectEval = { subject: string; grade: string };

type SchoolInfo = {
  name: string;
  province: string;
  city: string;
  tier: string;
  tags: string[];
  postgrad_rate: string;
  is_985: string;
  is_211: string;
  is_shuangyiliu: string;
  nature: string;
  male_ratio: string;
  female_ratio: string;
  website: string;
  admission_website: string;
  intro: string;
  rank_2025: number;
  city_level: string;
  admin_dept: string;
  flagship_majors: string;
  employment_quality: string;
  founded_year: number;
  subject_evaluations: SubjectEval[];
};

type QualityDimensions = {
  rank_score: number;
  subject_grade: number;
  employment_salary: number;
  satisfaction: number;
  postgrad_rate: number;
  subject_count: number;
  tier_bonus: number;
};

type SchoolDetail = {
  school: SchoolInfo;
  majors: MajorAnalysis[];
  quality?: { quality_score: number; dimensions: QualityDimensions };
};

const GRADE_COLOR: Record<string, string> = {
  "A+": "#ff3b30",
  "A":  "#ff9500",
  "A-": "#ffcc00",
  "B+": "#0071e3",
};

const COMPARE_KEY = "gaokao_compare";
const FORM_KEY = "gaokao_form_v3";

function addToCompareLocal(name: string) {
  try {
    const saved: string[] = JSON.parse(localStorage.getItem(COMPARE_KEY) || "[]");
    if (saved.includes(name)) { alert("已在对比列表中"); return; }
    if (saved.length >= 3) { alert("最多对比3所学校"); return; }
    localStorage.setItem(COMPARE_KEY, JSON.stringify([...saved, name]));
    alert(`已加入对比（${saved.length + 1}/3）`);
  } catch {}
}

function MajorCard({ major }: { major: MajorAnalysis }) {
  const [open, setOpen] = useState(false);
  const sorted = [...major.records].sort((a, b) => b.year - a.year);

  return (
    <div style={{
      borderBottom: "1px solid var(--color-separator)",
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 0",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 3 }}>
            {major.major_name}
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", display: "flex", gap: 12 }}>
            {major.subject_req && <span>选科 {major.subject_req}</span>}
            {major.plan_count > 0 && <span>计划 {major.plan_count} 人</span>}
            {major.tuition > 0 && <span>学费 {major.tuition.toLocaleString()}元</span>}
            {sorted[0] && <span>最新位次 {sorted[0].min_rank.toLocaleString()}</span>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {major.big_small_year?.heat_trend && (
            <span style={{
              fontSize: 11,
              color: major.big_small_year.heat_trend.includes("↓") ? "#34c759" :
                     major.big_small_year.heat_trend.includes("↑") ? "#ff3b30" : "var(--color-text-tertiary)",
            }}>{major.big_small_year.heat_trend}</span>
          )}
          <span style={{ fontSize: 18, color: "var(--color-text-tertiary)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>›</span>
        </div>
      </button>

      {open && (
        <div style={{ paddingBottom: 16 }}>
          {/* Historical data table */}
          {sorted.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 8 }}>历年录取位次</div>
              <div style={{ display: "grid", gap: 1 }}>
                {sorted.map((r, ri) => (
                  <div key={`${r.year}-${ri}`} style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "6px 0",
                    borderBottom: ri < sorted.length - 1 ? "1px solid var(--color-separator)" : "none",
                    fontSize: 13,
                  }}>
                    <span style={{ color: "var(--color-text-tertiary)", width: 48 }}>{r.year}年</span>
                    <span style={{ color: (r as any).is_school_baseline ? "var(--color-text-tertiary)" : "var(--color-text-primary)", fontWeight: 500, fontStyle: (r as any).is_school_baseline ? "italic" : "normal" }}>{r.min_score}分</span>
                    <span style={{ color: "var(--color-text-secondary)" }}>第 {r.min_rank.toLocaleString()} 位</span>
                    <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>{(r as any).is_school_baseline ? "院校线" : `计划 ${r.plan_count} 人`}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trend prediction */}
          {major.big_small_year?.trend_analysis?.next_year_estimate && (
            <div style={{ background: "var(--color-bg-secondary)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-accent)", marginBottom: 3 }}>
                趋势预测（{major.big_small_year.trend_analysis.years_used}年数据 · {major.big_small_year.trend_analysis.confidence}置信度）
              </div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                {major.big_small_year.trend_analysis.trend_label} · 预估2025年位次
                <strong style={{ color: "var(--color-text-primary)", marginLeft: 4 }}>
                  {major.big_small_year.trend_analysis.next_year_estimate.toLocaleString()}
                </strong>
              </div>
            </div>
          )}

          {/* Big/small year */}
          {major.big_small_year?.reason && (
            <div style={{ background: "var(--color-bg-secondary)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 3 }}>
                {major.big_small_year.status}
              </div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{major.big_small_year.prediction}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{major.big_small_year.reason}</div>
            </div>
          )}

          {/* Employment */}
          {major.employment && (
            <div style={{ background: "var(--color-bg-secondary)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#34c759", marginBottom: 6 }}>就业情况</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", fontSize: 12 }}>
                {major.employment.avg_salary > 0 && (
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    月薪 <strong style={{ color: "var(--color-text-primary)" }}>{(major.employment.avg_salary / 1000).toFixed(1)}k</strong>
                  </span>
                )}
                {major.employment.satisfaction > 0 && (
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    满意度 <strong style={{ color: "var(--color-text-primary)" }}>{major.employment.satisfaction.toFixed(1)}/5</strong>
                  </span>
                )}
                {major.employment.top_industry && (
                  <span style={{ color: "var(--color-text-secondary)" }}>{major.employment.top_industry.split("、")[0]}</span>
                )}
                {major.employment.top_city && (
                  <span style={{ color: "var(--color-text-secondary)" }}>{major.employment.top_city.split("、")[0]}</span>
                )}
              </div>
              {major.employment.career_direction && (
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 6, lineHeight: 1.5 }}>
                  {major.employment.career_direction.replace(/\\n/g, "").slice(0, 120)}
                </div>
              )}
            </div>
          )}

          {/* Cognitive gem */}
          {major.cognitive_gem && (
            <div style={{ background: "var(--color-bg-secondary)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#ff9500", marginBottom: 3 }}>
                认知误区 · {major.cognitive_gem.industry_prospect}
              </div>
              <div style={{ fontSize: 12, color: "#34c759" }}>真实方向：{major.cognitive_gem.real_direction}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{major.cognitive_gem.misconception}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SchoolDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const schoolName = decodeURIComponent(params.name as string);
  const province = searchParams.get("province") || "北京";

  const [data, setData] = useState<SchoolDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [outlook, setOutlook] = useState<string>("");
  const [outlookLoading, setOutlookLoading] = useState(false);

  async function handleExport() {
    const rankStr = searchParams.get("rank") || "";
    if (!rankStr) {
      alert("请先在首页输入位次后再从结果页进入学校详情，这样才能生成个性化报告");
      return;
    }
    setExportLoading(true);
    try {
      const examMode = searchParams.get("exam_mode") || "";
      const examParam = examMode ? `&exam_mode=${encodeURIComponent(examMode)}` : "";
      const url = `${API}/api/report/generate?province=${encodeURIComponent(province)}&rank=${rankStr}&subject=${encodeURIComponent(searchParams.get("subject") || "物理")}${examParam}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "未知错误" }));
        throw new Error(err.detail || "生成失败");
      }
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `水卢报告_${province}_${rankStr}.pdf`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e: any) {
      alert(`报告生成失败：${e.message}`);
    } finally {
      setExportLoading(false);
    }
  }

  useEffect(() => {
    fetch(`${API}/api/school/${encodeURIComponent(schoolName)}?province=${province}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));

    // Lazy-load outlook (separate API, may take a few seconds on first call)
    setOutlookLoading(true);
    fetch(`${API}/api/school/${encodeURIComponent(schoolName)}/outlook`)
      .then((r) => r.json())
      .then((d) => { setOutlook(d.outlook || ""); setOutlookLoading(false); })
      .catch(() => setOutlookLoading(false));
  }, [schoolName, province]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--color-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    );
  }

  if (!data || (data as any).error) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--color-bg)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-tertiary)" }}>
        学校数据未找到
      </div>
    );
  }

  const { school, majors } = data;

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", paddingBottom: 80 }}>
      {/* Nav */}
      <nav className="apple-nav">
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 20px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={() => router.back()} className="btn-ghost" style={{ fontSize: 14 }}>← 返回</button>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>{school.name}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => addToCompareLocal(school.name)}
              className="btn-ghost"
              style={{ fontSize: 13 }}
            >
              对比
            </button>
            {school.admission_website && (
              <a
                href={school.admission_website}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost"
                style={{ fontSize: 13, textDecoration: "none" }}
              >
                招生简章
              </a>
            )}
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 20px" }}>
        {/* Hero */}
        <div style={{ padding: "32px 0 24px" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 6 }}>
            {school.name}
          </div>
          <div style={{ fontSize: 15, color: "var(--color-text-secondary)", marginBottom: 16 }}>
            {school.province} · {school.city}
            {school.rank_2025 > 0 && ` · 软科 #${school.rank_2025}`}
          </div>

          {/* Tier badge */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            <span className={
              school.tier === "985" ? "badge-985" :
              school.tier === "211" ? "badge-211" :
              school.tier === "双一流" ? "badge-syl" : "badge-plain"
            }>{school.tier}</span>
            {school.nature && (
              <span className="badge-plain">{school.nature}</span>
            )}
          </div>

          {/* Key stats row */}
          <div style={{ display: "flex", gap: 32, marginBottom: 0 }}>
            {school.postgrad_rate && school.postgrad_rate !== "nan" && (
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "var(--color-text-primary)" }}>{school.postgrad_rate}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>保研率</div>
              </div>
            )}
            {school.male_ratio && (
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "var(--color-text-primary)" }}>{school.male_ratio}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>男生比例</div>
              </div>
            )}
            {school.founded_year > 0 && (
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "var(--color-text-primary)" }}>{school.founded_year}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>建校年份</div>
              </div>
            )}
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "var(--color-separator)" }} />

        {/* Quality score */}
        {data.quality && data.quality.quality_score > 0 && (
          <div style={{ padding: "24px 0" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-text-primary)" }}>综合质量评分</div>
              <div style={{ fontSize: 32, fontWeight: 700, color: "var(--color-accent)" }}>
                {data.quality.quality_score.toFixed(0)}
                <span style={{ fontSize: 14, fontWeight: 400, color: "var(--color-text-tertiary)" }}>/100</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { key: "rank_score", label: "软科排名" },
                { key: "subject_grade", label: "顶级学科" },
                { key: "employment_salary", label: "就业薪资" },
                { key: "postgrad_rate", label: "保研率" },
                { key: "subject_count", label: "A类学科数" },
              ].map(({ key, label }) => {
                const val = data.quality!.dimensions[key as keyof QualityDimensions] || 0;
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ fontSize: 13, color: "var(--color-text-secondary)", width: 72, flexShrink: 0 }}>{label}</div>
                    <div style={{ flex: 1, background: "var(--color-separator)", borderRadius: 99, height: 4, overflow: "hidden" }}>
                      <div style={{ width: `${val}%`, height: "100%", background: "var(--color-accent)", borderRadius: 99, transition: "width 0.6s ease" }} />
                    </div>
                    <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", width: 28, textAlign: "right" }}>{val}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ height: 1, background: "var(--color-separator)" }} />

        {/* Subject evaluations */}
        {school.subject_evaluations.length > 0 && (
          <div style={{ padding: "24px 0" }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 12 }}>学科评估（A类）</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {school.subject_evaluations.map((ev) => (
                <span key={ev.subject} style={{
                  fontSize: 13,
                  padding: "4px 12px",
                  borderRadius: 99,
                  border: `1px solid ${GRADE_COLOR[ev.grade] || "var(--color-separator)"}`,
                  color: GRADE_COLOR[ev.grade] || "var(--color-text-secondary)",
                  background: "transparent",
                }}>
                  {ev.subject} <strong>{ev.grade}</strong>
                </span>
              ))}
            </div>
          </div>
        )}

        {school.subject_evaluations.length > 0 && <div style={{ height: 1, background: "var(--color-separator)" }} />}

        {/* Flagship majors */}
        {school.flagship_majors && (
          <>
            <div style={{ padding: "24px 0" }}>
              <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 8 }}>王牌专业</div>
              <div style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
                {school.flagship_majors.replace(/（本）|（专）/g, "").slice(0, 300)}
              </div>
            </div>
            <div style={{ height: 1, background: "var(--color-separator)" }} />
          </>
        )}

        {/* Intro */}
        {school.intro && (
          <>
            <div style={{ padding: "24px 0" }}>
              <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 8 }}>院校简介</div>
              <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.7, margin: 0 }}>
                {school.intro.slice(0, 400)}{school.intro.length > 400 ? "…" : ""}
              </p>
              {school.website && (
                <a
                  href={school.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-block", marginTop: 10, fontSize: 13, color: "var(--color-accent)", textDecoration: "none" }}
                >
                  访问官网 →
                </a>
              )}
            </div>
            <div style={{ height: 1, background: "var(--color-separator)" }} />
          </>
        )}

        {/* Future Outlook */}
        {(outlook || outlookLoading) && (
          <>
            <div style={{ padding: "24px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-text-primary)" }}>未来展望（5-10年）</div>
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", background: "var(--color-bg-secondary)", padding: "2px 8px", borderRadius: 99 }}>AI分析</span>
              </div>
              {outlookLoading && !outlook ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 0" }}>
                  <div className="spinner" style={{ width: 16, height: 16 }} />
                  <span style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>正在生成展望分析…</span>
                </div>
              ) : (
                <div style={{
                  background: "linear-gradient(135deg, #f8f6f0 0%, #faf9f5 100%)",
                  borderRadius: 12,
                  padding: "16px 18px",
                  border: "1px solid rgba(201, 146, 42, 0.15)",
                }}>
                  <div style={{
                    fontSize: 14,
                    color: "var(--color-text-secondary)",
                    lineHeight: 1.8,
                  }}>
                    {outlook.split("\n").map((line, i) => (
                      <p key={i} style={{ margin: "0 0 6px" }}>
                        {line.split(/\*\*(.*?)\*\*/).map((seg, j) =>
                          j % 2 === 1
                            ? <strong key={j} style={{ color: "var(--color-text-primary)" }}>{seg}</strong>
                            : <span key={j}>{seg}</span>
                        )}
                      </p>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 10, textAlign: "right" }}>
                    基于公开数据与政策趋势，仅供参考
                  </div>
                </div>
              )}
            </div>
            <div style={{ height: 1, background: "var(--color-separator)" }} />
          </>
        )}

        {/* Majors */}
        <div style={{ padding: "24px 0 0" }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4 }}>
            专业分析
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", marginBottom: 16 }}>
            {province}省 · {majors.length} 个专业
          </div>

          {majors.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--color-text-tertiary)", fontSize: 14 }}>
              暂无该省招生数据
            </div>
          ) : (
            <div>
              {majors.map((major) => (
                <MajorCard key={major.major_name} major={major} />
              ))}
            </div>
          )}
        </div>

        <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", textAlign: "center", marginTop: 32, paddingBottom: 16 }}>
          以上数据基于公开信息，请以各省教育考试院及高校招生简章为准。
        </p>
      </div>

      {/* Bottom action bar */}
      <div style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "var(--color-bg)",
        borderTop: "1px solid var(--color-separator)",
        padding: "12px 20px",
        display: "flex",
        gap: 12,
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        maxWidth: 680,
        margin: "0 auto",
      }}>
        <button
          onClick={() => {
            const formItem = { id: `${Date.now()}`, rank: 1, school: school.name, major: majors[0]?.major_name || "", probability: 50, action: "稳", category: "稳" };
            const saved = JSON.parse(localStorage.getItem(FORM_KEY) || "[]");
            localStorage.setItem(FORM_KEY, JSON.stringify([...saved, formItem]));
            alert("已加入志愿表");
          }}
          className="btn-secondary"
          style={{ flex: 1 }}
        >
          加入志愿表
        </button>
        <button
          onClick={handleExport}
          disabled={exportLoading}
          className="btn-primary"
          style={{ flex: 1, opacity: exportLoading ? 0.7 : 1 }}
        >
          {exportLoading ? "生成中…" : "导出PDF报告"}
        </button>
      </div>
    </div>
  );
}
