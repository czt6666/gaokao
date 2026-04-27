"use client";
import { useEffect, useState, useRef, Suspense, Fragment } from "react";
import React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import PayModal from "@/components/PayModal";
import AuthNav from "@/components/AuthNav";
import { track } from "@/lib/track";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type ReasonSection = {
  title: string;
  content: string;
};

type SchoolResult = {
  locked?: boolean;
  school_name: string;
  major_name: string;
  city: string;
  province_school: string;
  tier: string;
  is_985: string;
  is_211: string;
  rank_2025?: number;
  flagship_majors?: string;
  is_top_pick?: boolean;
  top_pick_headline?: string;
  top_pick_rank?: number;  // 1=本档首选, 2-3=智能精选
  feature_tags?: string[];  // 快扫标签：城市/学科/薪资/趋势
  available_majors?: string[];
  swarm_score?: number;
  swarm_discovery?: boolean;
  city_level?: string;
  tags: string[];
  probability: number | null;
  prob_low?: number | null;
  prob_high?: number | null;
  probability_tier?: string;
  suggested_action: string | null;
  avg_min_rank_3yr: number;
  avg_min_score_3yr?: number;
  rank_diff: number;
  confidence: string;
  quality_score?: number;
  big_small_year: {
    status: string | null;
    prediction: string | null;
    heat_trend: string;
    reason: string | null;
    trend_analysis?: { trend_label: string; next_year_estimate?: number; confidence: string };
  };
  is_hidden_gem: boolean;
  gem_score: number;
  is_trust_anchor?: boolean;
  top_gem: {
    gem_type?: string;
    gem_type_label: string;
    gem_description?: string;
    advantage?: string;
    risk?: string;
  } | null;
  all_gems?: Array<{ gem_type: string; gem_type_label: string }> | null;
  employment?: {
    avg_salary: number;
    top_city?: string;
    top_industry?: string;
    satisfaction?: number;
    career_direction?: string;
    school_employment_rate?: number;
    school_postgrad_rate?: number;
    school_employer_tier?: string;
    data_reliability?: string;
    reliability_note?: string;
  } | null;
  strong_subjects?: string[];
  recent_data?: Array<{ year: number; min_rank: number; min_score: number; is_school_baseline?: boolean }>;
  rank_cv?: number;
  volatility_warning?: string;
  reason?: string;
  reason_sections?: ReasonSection[];
};

type RecommendResult = {
  candidate_rank: number;
  province: string;
  total_matched: number;
  is_paid: boolean;
  surge: SchoolResult[];
  stable: SchoolResult[];
  safe: SchoolResult[];
  hidden_gems: SchoolResult[];
};

const FORM_KEY = "gaokao_form_v3";
const COMPARE_KEY = "gaokao_compare";
const ORDER_KEY = "gaokao_order";
const HISTORY_KEY = "gaokao_query_history";

function addToForm(item: SchoolResult, showToast?: (msg: string) => void) {
  try {
    const saved = JSON.parse(localStorage.getItem(FORM_KEY) || "[]");
    const exists = saved.find((i: any) => i.school === item.school_name && i.major === item.major_name);
    if (exists) { showToast?.("已在志愿表中"); return; }
    const prob = item.probability ?? 0;
    const newItem = {
      id: `${Date.now()}`,
      rank: saved.length + 1,
      school: item.school_name,
      major: item.major_name,
      probability: prob,
      action: item.suggested_action,
      category: prob >= 75 ? "保" : prob >= 45 ? "稳" : "冲",
    };
    localStorage.setItem(FORM_KEY, JSON.stringify([...saved, newItem]));
    track("add_to_form", { eventData: { school: item.school_name, major: item.major_name } });
    showToast?.(`✅ 已加入志愿表（共 ${saved.length + 1} 条）`);
  } catch {}
}

function addToCompare(schoolName: string, showToast?: (msg: string) => void) {
  try {
    const saved: string[] = JSON.parse(localStorage.getItem(COMPARE_KEY) || "[]");
    if (saved.includes(schoolName)) { showToast?.("已在对比列表中"); return; }
    if (saved.length >= 3) { showToast?.("最多对比3所学校"); return; }
    localStorage.setItem(COMPARE_KEY, JSON.stringify([...saved, schoolName]));
    track("compare_add", { eventData: { school: schoolName } });
    showToast?.(`📊 已加入对比（${saved.length + 1}/3）`);
  } catch {}
}

function SchoolCard({ item, province, rank, score, subject, isPaid, onUnlock }: { item: SchoolResult; province: string; rank: string; score?: string; subject: string; isPaid?: boolean; onUnlock?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastRef = useRef<NodeJS.Timeout | null>(null);
  const showToast = (msg: string) => {
    if (toastRef.current) clearTimeout(toastRef.current);
    setToast(msg);
    toastRef.current = setTimeout(() => setToast(null), 2500);
  };
  useEffect(() => () => { if (toastRef.current) clearTimeout(toastRef.current); }, []);
  const prob = item.probability ?? 0;
  const scoreDiff = (score && item.avg_min_score_3yr) ? (Number(score) - item.avg_min_score_3yr) : null;
  const isGem = item.is_hidden_gem && item.top_gem;
  const isSwarm = item.swarm_discovery && !isGem;

  const probLabel = prob >= 80 ? "保底" : prob >= 55 ? "稳妥" : "冲刺";
  const probLabelColor = prob >= 80 ? "#059669" : prob >= 55 ? "#1A2744" : "#D97706";

  return (
    <div
      className={`warm-card${isGem ? " warm-card-gem" : isSwarm ? " warm-card-swarm" : ""}`}
      style={{ marginBottom: 12, position: "relative" }}
    >
      <div className="result-card-inner" style={{ justifyContent: "space-between" }}>
        <div style={{ flex: 1 }}>
          {/* Badges — 最多3个，无emoji */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            {item.is_top_pick && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: "#fff",
                background: item.top_pick_rank === 1 ? "var(--color-navy)" : "#6366F1",
                borderRadius: 4,
                padding: "2px 7px", letterSpacing: "0.05em",
              }}>{item.top_pick_rank === 1 ? "★ 本档首选" : "智能精选"}</span>
            )}
            {item.tier && (
              <span className={
                item.tier === "985" ? "badge badge-985" :
                item.tier === "211" ? "badge badge-211" :
                item.tier === "双一流" ? "badge badge-syl" : "badge badge-plain"
              }>{item.tier}</span>
            )}
            {item.rank_2025 && item.rank_2025 > 0 && (
              <span className="badge badge-plain">软科 #{item.rank_2025}</span>
            )}
            {isGem && (
              <span className="badge badge-gem">◆ {item.top_gem?.gem_type_label || "冷门价值"}</span>
            )}
            {isSwarm && (
              <span className="badge badge-swarm">◈ 群体强推</span>
            )}
          </div>

          {/* 智能精选理由行 */}
          {item.is_top_pick && item.top_pick_headline && (
            <div style={{
              fontSize: 11, color: "var(--color-navy)",
              background: "#EEF2FF", borderRadius: 6,
              padding: "5px 10px", marginBottom: 10, fontWeight: 500,
              borderLeft: "3px solid var(--color-navy)",
            }}>
              {item.top_pick_headline}
            </div>
          )}

          {/* School name — 衬线字体 */}
          <Link
            href={`/school/${encodeURIComponent(item.school_name)}?province=${encodeURIComponent(province)}&rank=${rank}&subject=${encodeURIComponent(subject)}`}
            className="school-name-serif"
            style={{ fontSize: 17, display: "block", marginBottom: 4 }}
            onClick={() => track("school_click", { province, rankInput: Number(rank), eventData: { school: item.school_name, tier: item.tier } })}
          >
            {item.school_name}
          </Link>

          {/* Major + city */}
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 6 }}>
            {item.major_name === "[院校最低分]" ? "院校整体录取" : item.major_name}
            {item.city && <span style={{ marginLeft: 6 }}>· {item.city}</span>}
          </div>

          {/* Feature tags — 快扫标签，让每张卡一眼可区分 */}
          {item.feature_tags && item.feature_tags.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
              {item.feature_tags.map((ft, fi) => (
                <span key={fi} style={{
                  fontSize: 10, color: "#6B7280", background: "#F3F4F6",
                  borderRadius: 3, padding: "1px 6px", whiteSpace: "nowrap",
                }}>{ft}</span>
              ))}
            </div>
          )}

          {/* 概率渐变条 */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>录取概率</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: probLabelColor }}>{probLabel}</span>
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>置信度 {item.confidence}</span>
              </div>
            </div>
            <div className="prob-bar-track">
              <div className="prob-bar-fill" style={{ width: `${Math.min(100, prob)}%` }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                {item.big_small_year?.heat_trend || ""}
              </span>
              <div>
                <span style={{ fontSize: 22, fontWeight: 700, color: "var(--color-navy)", fontVariantNumeric: "tabular-nums" }}>
                  {prob.toFixed(0)}
                </span>
                <span style={{ fontSize: 13, color: "var(--color-text-tertiary)", marginLeft: 2 }}>%</span>
                {item.prob_low != null && item.prob_high != null && (
                  <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginLeft: 4 }}>
                    ({item.prob_low}~{item.prob_high}%)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 波动警告 */}
          {item.volatility_warning && (
            <div style={{ fontSize: 11, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "4px 8px", marginBottom: 8 }}>
              {item.volatility_warning}
            </div>
          )}

          {/* Big/small year hint */}
          {item.big_small_year?.status && (
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 8 }}>
              大小年：{item.big_small_year.status}
            </div>
          )}

          {/* 操作行：始终可见 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
            <span style={{ fontSize: 12, color: probLabelColor, fontWeight: 600, flex: 1 }}>
              {item.suggested_action}
            </span>
          </div>

        </div>

        {/* Right: 分数信息 + 操作按钮 */}
        <div className="result-card-right" style={{ flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "flex-end", marginBottom: 8 }}>
            {/* 去年最低分 */}
            {item.avg_min_score_3yr ? (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 2 }}>去年最低分</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-accent)", fontVariantNumeric: "tabular-nums" }}>
                  {item.avg_min_score_3yr}<span style={{ fontSize: 11, fontWeight: 400, color: "var(--color-text-tertiary)", marginLeft: 2 }}>分</span>
                </div>
                {scoreDiff !== null && (
                  <div style={{ fontSize: 11, marginTop: 1, fontWeight: 600, color: scoreDiff > 0 ? "#059669" : "#DC2626" }}>
                    {scoreDiff > 0 ? "+" : ""}{scoreDiff} 分
                  </div>
                )}
              </div>
            ) : null}
            {/* 分隔线 */}
            {item.avg_min_score_3yr ? (
              <div style={{ width: 1, background: "var(--color-border)", alignSelf: "stretch", margin: "2px 0" }} />
            ) : null}
            {/* 均位次 */}
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 2 }}>近年均位次</div>
              <div className="rank-val" style={{ fontSize: 17, fontWeight: 700, color: "var(--color-navy)", fontVariantNumeric: "tabular-nums" }}>
                {item.avg_min_rank_3yr?.toLocaleString()}
              </div>
              {(() => {
                const diff = (item.avg_min_rank_3yr ?? 0) - Number(rank);
                return (
                  <div style={{ fontSize: 11, marginTop: 1, fontWeight: 600, color: diff > 0 ? "#059669" : "#DC2626" }}>
                    {diff > 0 ? `领先 ${diff.toLocaleString()} 位` : `落后 ${Math.abs(diff).toLocaleString()} 位`}
                  </div>
                );
              })()}
            </div>
          </div>
          <div className="rank-actions" style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <button onClick={() => addToForm(item, (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); })} className="card-action-primary">
              加入志愿
            </button>
            <button onClick={() => addToCompare(item.school_name, showToast)} className="card-action-secondary">
              对比分析
            </button>
          </div>
        </div>
      </div>

      {/* 就业数据 — 放到卡片底部 */}
      {item.employment && item.employment.avg_salary > 0 && (
        isPaid ? (
          <div className="employment-bar" style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8, padding: "10px 0", marginTop: 8,
            borderTop: "1px solid var(--color-separator)"
          }}>
            <div className="data-cell">
              <span className="data-cell-label">月薪{item.employment.data_reliability === "数据存疑" ? <span title={item.employment.reliability_note || ""} style={{ color: "#DC2626", fontSize: 9, marginLeft: 2 }}>⚠</span> : item.employment.data_reliability === "多源验证" ? <span style={{ color: "#059669", fontSize: 9, marginLeft: 2 }}>✓</span> : null}</span>
              <span className="data-cell-value">¥{(Math.min(item.employment.avg_salary, 18000) / 1000).toFixed(1)}k</span>
            </div>
            {item.employment.school_employment_rate != null && item.employment.school_employment_rate > 0 && (
              <div className="data-cell">
                <span className="data-cell-label">就业率</span>
                <span className="data-cell-value">{(item.employment.school_employment_rate * 100).toFixed(1)}%</span>
              </div>
            )}
            {item.employment.school_postgrad_rate != null && item.employment.school_postgrad_rate > 0 && (
              <div className="data-cell">
                <span className="data-cell-label">深造率</span>
                <span className="data-cell-value">{(item.employment.school_postgrad_rate * 100).toFixed(1)}%</span>
              </div>
            )}
          </div>
        ) : (
          <div
            className="employment-bar"
            onClick={() => onUnlock && onUnlock()}
            style={{
              display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
              gap: 8, padding: "10px 0", marginTop: 8,
              borderTop: "1px solid var(--color-separator)",
              cursor: "pointer", position: "relative",
            }}
          >
            {[["月薪", "¥X.Xk"], ["就业率", "XX%"], ["深造率", "XX%"]].map(([label, val]) => (
              <div key={label} className="data-cell" style={{ filter: "blur(4px)", userSelect: "none" }}>
                <span className="data-cell-label">{label}</span>
                <span className="data-cell-value">{val}</span>
              </div>
            ))}
            <div style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, color: "var(--color-accent)", fontWeight: 600, letterSpacing: "0.02em",
            }}>
              🔒 解锁查看就业数据
            </div>
          </div>
        )
      )}

      {/* Expandable analysis */}
      {(item.reason || item.is_hidden_gem || item.big_small_year?.reason) && (
        <button
          onClick={() => isPaid ? setExpanded(!expanded) : (onUnlock && onUnlock())}
          style={{ marginTop: 12, fontSize: 12, color: isPaid ? "var(--color-accent)" : "var(--color-text-tertiary)", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 500, letterSpacing: "0.02em" }}
        >
          {isPaid
            ? (expanded ? "收起分析 ↑" : "查看推荐理由 ↓")
            : "🔒 解锁查看推荐理由（冷门分析·风险·填报策略）"}
        </button>
      )}

      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--color-separator)" }}>
          {/* ── 7-module structured sections (new format) ── */}
          {item.reason_sections && item.reason_sections.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {item.reason_sections.map((sec, idx) => {
                const isGemSec  = sec.title.includes("💎");
                const isRisk    = sec.title.includes("⚠️");
                const isProb    = sec.title.includes("📊");
                const isAction  = sec.title.includes("✅");
                const isReview  = sec.title.includes("🗣");
                const bg        = isGemSec ? "#FFFBEB" : isRisk ? "#FEF2F2" : isAction ? "#F0FDF4" : isReview ? "#F5F3FF" : "var(--color-bg-secondary)";
                const titleColor = isGemSec ? "#92400E" : isRisk ? "#991B1B" : isAction ? "#166534" : isProb ? "var(--color-navy)" : isReview ? "#4C1D95" : "var(--color-text-primary)";

                // Free users see first 2 modules fully; rest are teaser-locked
                const isLocked = !isPaid && idx >= 2;

                if (isLocked) {
                  // Teaser: show title only, blur the content, add unlock prompt
                  const teaserMap: Record<string, string> = {
                    "💎": "了解为何这所学校被市场低估",
                    "💼": "查看该校真实毕业生薪资与就业去向",
                    "⚡": "2026年招生变动对录取的影响",
                    "⚠️": "填报前必读的主要风险提示",
                    "✅": "志愿表中最佳填报位置建议",
                    "🗣": "真实学生口碑与在校体验",
                  };
                  const icon = sec.title.match(/[\u{1F000}-\u{1FFFF}]|[\u2600-\u26FF]|[⚡⚠️✅]/u)?.[0] || "";
                  const teaserText = teaserMap[icon] || "查看完整分析内容";
                  return (
                    <div
                      key={idx}
                      onClick={() => onUnlock && onUnlock()}
                      style={{
                        background: "var(--color-bg-secondary)", borderRadius: 8,
                        padding: "10px 12px", cursor: "pointer",
                        border: "1px dashed var(--color-border-light)",
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        opacity: 0.72,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: 2 }}>
                          ■ {sec.title.replace(/[\u{1F000}-\u{1FFFF}]|[\u2600-\u26FF]|[⚡⚠️✅💎🗣📊📅]/gu, "").trim()}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{teaserText}</div>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--color-accent)", whiteSpace: "nowrap", marginLeft: 8, fontWeight: 600 }}>
                        解锁查看 →
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={idx} style={{ background: bg, borderRadius: 8, padding: "10px 12px", border: `1px solid ${bg === "#FFFBEB" ? "#FDE68A" : bg === "#FEF2F2" ? "#FECACA" : bg === "#F0FDF4" ? "#BBF7D0" : "var(--color-border-light)"}` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: titleColor, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {sec.title.replace(/[\u{1F000}-\u{1FFFF}]|[\u2600-\u26FF]|[⚡⚠️✅💎🗣📊📅]/gu, "").trim()}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.75, whiteSpace: "pre-line" }}>
                      {sec.content}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── Fallback: plain text reason + legacy blocks ── */
            <>
              {item.reason && (
                <div style={{ background: "var(--color-bg-secondary)", borderRadius: 8, padding: "10px 12px", marginBottom: 8, border: "1px solid var(--color-border-light)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-navy)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>推荐理由</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7, whiteSpace: "pre-line" }}>{item.reason}</div>
                </div>
              )}
              {item.big_small_year?.reason && (
                <div style={{ background: "#FFFBEB", borderRadius: 8, padding: "10px 12px", marginBottom: 8, border: "1px solid #FDE68A" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#92400E", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    大小年预测（{item.big_small_year?.trend_analysis?.confidence || "中"}置信度）
                  </div>
                  <div style={{ fontSize: 12, color: "#78350F" }}>{item.big_small_year.status}：{item.big_small_year.prediction}</div>
                  <div style={{ fontSize: 11, color: "#92400E", marginTop: 2 }}>{item.big_small_year.reason}</div>
                  {item.big_small_year.trend_analysis?.next_year_estimate && (
                    <div style={{ fontSize: 12, color: "var(--color-accent)", marginTop: 4, fontWeight: 600 }}>
                      预测2026年位次约 {item.big_small_year.trend_analysis.next_year_estimate.toLocaleString()}
                    </div>
                  )}
                </div>
              )}
              {item.top_gem?.gem_description && (
                <div className="gem-block" style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#92400E", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    冷门价值 · {item.top_gem.gem_type_label}
                  </div>
                  <div style={{ marginBottom: 4 }}>{item.top_gem.gem_description}</div>
                  {item.top_gem.advantage && <div style={{ color: "#059669", fontSize: 11 }}>优势：{item.top_gem.advantage}</div>}
                  {item.top_gem.risk && <div style={{ color: "#DC2626", fontSize: 11, marginTop: 2 }}>风险：{item.top_gem.risk}</div>}
                </div>
              )}
            </>
          )}

          {/* A-class subjects always shown */}
          {item.strong_subjects && item.strong_subjects.length > 0 && (
            <div style={{ background: "var(--color-bg-secondary)", borderRadius: 8, padding: "10px 12px", marginTop: 8, border: "1px solid var(--color-border-light)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-navy)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>A类优势学科</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {item.strong_subjects.map((s) => (
                  <span key={s} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "#F5F2EC", color: "#4A3728", border: "1px solid #E8E0D0" }}>{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {toast && (
        <div style={{
          position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
          background: "rgba(29,29,31,0.9)", color: "#fff", padding: "6px 14px",
          borderRadius: 99, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap",
          zIndex: 10, pointerEvents: "none",
        }}>{toast}</div>
      )}
    </div>
  );
}

function LockedSchoolCard({ item, onUnlock }: { item: SchoolResult; onUnlock: () => void }) {
  const tierColor = item.tier === "冲" ? "#DC2626" : item.tier === "稳" ? "#1A2744" : "#059669";
  const tierBg   = item.tier === "冲" ? "#FEF2F2" : item.tier === "稳" ? "#EFF6FF" : "#F0FDF4";
  return (
    <div style={{
      position: "relative", borderRadius: 14, marginBottom: 12,
      border: "1px solid var(--color-border-light)",
      background: "var(--color-bg-secondary)",
      overflow: "hidden",
    }}>
      {/* Visible header row */}
      <div style={{ padding: "14px 16px 12px", display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
              {item.school_name}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 4,
              background: tierBg, color: tierColor,
            }}>{item.tier}</span>
            {item.is_985 === "985" && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(201,146,42,0.1)", color: "var(--color-accent)", fontWeight: 600 }}>985</span>
            )}
            {item.is_211 === "211" && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(26,39,68,0.08)", color: "var(--color-navy)", fontWeight: 600 }}>211</span>
            )}
            {item.is_hidden_gem && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(201,146,42,0.15)", color: "var(--color-accent)", fontWeight: 600 }}>◆ 冷门宝藏</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 3 }}>
            {item.city}
          </div>
          {/* P6: 锁定卡预览标签 — 透出1条价值信息 */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
            {item.employment?.school_employment_rate && item.employment.school_employment_rate > 90 && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "#ECFDF5", color: "#065F46", fontWeight: 500 }}>
                就业率 {item.employment.school_employment_rate.toFixed(0)}%
              </span>
            )}
            {item.city_level && ["一线","新一线"].includes(item.city_level) && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "#EFF6FF", color: "#1E40AF", fontWeight: 500 }}>
                {item.city_level}城市
              </span>
            )}
            {item.top_gem?.gem_type_label && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "#FFFBEB", color: "#92400E", fontWeight: 500 }}>
                {item.top_gem.gem_type_label}
              </span>
            )}
            {item.flagship_majors && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "#F5F3FF", color: "#5B21B6", fontWeight: 500 }}>
                王牌专业
              </span>
            )}
          </div>
        </div>
        <div style={{
          fontSize: 11, padding: "3px 10px", borderRadius: 99,
          background: "rgba(0,0,0,0.04)", color: "var(--color-text-tertiary)",
          border: "1px solid var(--color-border-light)", whiteSpace: "nowrap",
        }}>🔒 已锁定</div>
      </div>

      {/* Blurred content body */}
      <div style={{ position: "relative", padding: "0 16px 16px" }}>
        <div style={{
          filter: "blur(5px)", userSelect: "none", pointerEvents: "none",
          fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.8,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>专业：██████████</div>
          <div>录取概率：██% · 安全线分析：████████</div>
          <div>近3年最低位次：██,███ / ██,███ / ██,███</div>
          <div>大小年预测：████ · 就业薪资：████元</div>
        </div>
        {/* Unlock overlay */}
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 8,
        }}>
          <button
            onClick={onUnlock}
            style={{
              padding: "9px 24px", borderRadius: 99,
              background: "var(--color-navy)", color: "#fff",
              border: "none", fontSize: 13, fontWeight: 700,
              cursor: "pointer", boxShadow: "0 2px 12px rgba(26,39,68,0.25)",
            }}
          >
            ¥1.99 解锁完整分析
          </button>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
            含录取概率 · 安全线 · 历年趋势 · 口碑
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rank = searchParams.get("rank") || "";
  const province = searchParams.get("province") || "广东";
  const subject = searchParams.get("subject") || "";
  const examMode = searchParams.get("exam_mode") || "";
  const fromMock = searchParams.get("from_mock") === "1";
  const mockScore = searchParams.get("mock_score") || "";
  /** 与卡片「去年最低分」对比用：显式 ?score= 或模考链路的 mock_score */
  const score = searchParams.get("score") || (fromMock ? mockScore : "");
  // 约束条件（从首页带过来）
  const cMajor = searchParams.get("c_major") || "";
  const cCity = searchParams.get("c_city") || "";
  const cNature = searchParams.get("c_nature") || "";
  const cTier = searchParams.get("c_tier") || "";

  const [data, setData] = useState<RecommendResult | null>(null);
  const [activeTab, setActiveTab] = useState<"gems" | "surge" | "stable" | "safe">("stable");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [filterTier, setFilterTier] = useState("");
  const [exporting, setExporting] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [lockedExpanded, setLockedExpanded] = useState(false);

  // 登录前把查询条件持久化，供登录后恢复（避免依赖 URL redirect）
  useEffect(() => {
    try {
      localStorage.setItem("gaokao_query_restore", JSON.stringify({ province, rank, subject, examMode }));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [province, rank, subject, examMode]);

  // Per-query order_no: keyed by province+rank+subject so one payment can't unlock other queries
  const queryOrderKey = `gaokao_order_${province}_${rank}_${subject}`;
  const [orderNo, setOrderNo] = useState<string>(() => {
    try {
      // 1. URL param (from dashboard "我的订单" click / H5 pay redirect / cross-device share)
      const fromUrl = typeof window !== "undefined"
        ? new URL(window.location.href).searchParams.get("order_no") || ""
        : "";
      if (fromUrl) {
        try {
          localStorage.setItem(`gaokao_order_${province}_${rank}_${subject}`, fromUrl);
          localStorage.setItem(ORDER_KEY, fromUrl);
        } catch {}
        return fromUrl;
      }
      // 2. Try per-query key (new model)
      const perQuery = localStorage.getItem(`gaokao_order_${province}_${rank}_${subject}`);
      if (perQuery) return perQuery;
      // 3. Fall back to legacy global key (backward compat for users who already paid)
      return localStorage.getItem(ORDER_KEY) || "";
    } catch { return ""; }
  });

  async function handleExportPDF() {
    if (!rank || !province) return;
    if (!data?.is_paid) { setShowPayModal(true); return; }
    const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
    if (!token) {
      // 已付费但未登录（通过order_no识别），引导登录以绑定账户
      const go = confirm("导出报告需要登录账户，以确保报告可跨设备访问。立即前往登录？");
      if (go) {
        const current = typeof window !== "undefined" ? window.location.href : `/results?rank=${rank}&province=${encodeURIComponent(province)}&subject=${encodeURIComponent(subject)}`;
        window.location.href = `/login?redirect=${encodeURIComponent(current)}`;
      }
      return;
    }
    track("export_click", { province, rankInput: Number(rank), eventData: { subject } });
    setExporting(true);
    try {
      const orderParam = orderNo ? `&order_no=${encodeURIComponent(orderNo)}` : "";
      const examParam = examMode ? `&exam_mode=${encodeURIComponent(examMode)}` : "";
      const url = `${API}/api/report/generate?province=${encodeURIComponent(province)}&rank=${rank}&subject=${encodeURIComponent(subject)}${orderParam}${examParam}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "服务暂不可用" }));
        throw new Error(err.detail || "生成失败");
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `水卢报告_${province}_${rank}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      alert(`报告生成失败：${e.message}`);
    } finally {
      setExporting(false);
    }
  }

  async function handleSendEmail() {
    if (!data?.is_paid) { setShowPayModal(true); setShowEmailInput(false); return; }
    if (!emailInput || !emailInput.includes("@")) {
      alert("请输入有效的邮箱地址");
      return;
    }
    track("email_click", { province, rankInput: Number(rank) });
    setEmailSending(true);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
      const examParam = examMode ? `&exam_mode=${encodeURIComponent(examMode)}` : "";
      const url = `${API}/api/report/email?province=${encodeURIComponent(province)}&rank=${rank}&subject=${encodeURIComponent(subject)}&to_email=${encodeURIComponent(emailInput)}${examParam}`;
      const res = await fetch(url, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await res.json().catch(() => ({ detail: "发送失败" }));
      if (!res.ok) throw new Error(d.detail || "发送失败");
      alert(`✅ ${d.message}`);
      setShowEmailInput(false);
      setEmailInput("");
    } catch (e: any) {
      alert(`邮件发送失败：${e.message}`);
    } finally {
      setEmailSending(false);
    }
  }

  useEffect(() => {
    if (!showMobileMenu) return;
    function handleOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".nav-mobile-menu")) setShowMobileMenu(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showMobileMenu]);

  // ── 微信浏览器 OAuth2 静默授权（snsapi_base，无弹窗）──
  // 1) 进页面时若是微信内 + 没 openid + URL 没 code → 跳授权
  // 2) 微信回跳后 URL 带 ?code=...&state=wxpay → 换 openid 存 sessionStorage 后清理 URL
  // 3) H5 支付跳回时 URL 带 ?paid=<order_no> → 自动查单
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isWeChat = /MicroMessenger/i.test(navigator.userAgent);
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const paidOrderNo = url.searchParams.get("paid");
    const SERVICE_APPID = process.env.NEXT_PUBLIC_WECHAT_SERVICE_APP_ID || "";

    // —— H5 跳回兜底：不论环境，URL 带 paid=<order_no> 就查一次单 ——
    if (paidOrderNo) {
      (async () => {
        try {
          const res = await fetch(`${API}/api/payment/status/${paidOrderNo}`);
          if (res.ok) {
            const d = await res.json();
            if (d.status === "paid") {
              try {
                localStorage.setItem(queryOrderKey, paidOrderNo);
                localStorage.setItem(ORDER_KEY, paidOrderNo);
              } catch {}
              setOrderNo(paidOrderNo);
            }
          }
        } catch {}
        // 清理 paid 参数避免刷新重复查
        url.searchParams.delete("paid");
        window.history.replaceState({}, "", url.toString());
      })();
    }

    // —— 微信回跳：用 code 换 openid ——
    if (code && state === "wxpay") {
      (async () => {
        try {
          const res = await fetch(`${API}/api/payment/wechat/code_to_openid`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          });
          if (res.ok) {
            const d = await res.json();
            if (d.openid) {
              try { sessionStorage.setItem("wx_openid", d.openid); } catch {}
            }
          }
        } catch {}
        // 不论成败，清理 code/state 避免重复换（微信 code 仅一次性有效）
        url.searchParams.delete("code");
        url.searchParams.delete("state");
        window.history.replaceState({}, "", url.toString());
      })();
      return;
    }

    // —— 进页面静默跳 OAuth2（仅微信内 + 无 openid + 没正在回跳）——
    let hasOpenid = false;
    try { hasOpenid = !!sessionStorage.getItem("wx_openid"); } catch {}
    if (isWeChat && !hasOpenid && SERVICE_APPID && !code) {
      const redirect = encodeURIComponent(window.location.href);
      const oauthUrl =
        `https://open.weixin.qq.com/connect/oauth2/authorize` +
        `?appid=${SERVICE_APPID}&redirect_uri=${redirect}` +
        `&response_type=code&scope=snsapi_base&state=wxpay#wechat_redirect`;
      window.location.href = oauthUrl;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!rank) return;
    track("page_view", { page: "/results", province, rankInput: Number(rank) });
    setFetchError(null);
    setLoading(true);

    let stale = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const orderParam = orderNo ? `&order_no=${encodeURIComponent(orderNo)}` : "";
    const constraintParam = (() => {
      const parts: string[] = [];
      if (cMajor) parts.push(`c_major=${encodeURIComponent(cMajor)}`);
      if (cCity) parts.push(`c_city=${encodeURIComponent(cCity)}`);
      if (cNature) parts.push(`c_nature=${encodeURIComponent(cNature)}`);
      if (cTier) parts.push(`c_tier=${encodeURIComponent(cTier)}`);
      return parts.length ? `&${parts.join("&")}` : "";
    })();
    const authToken = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
    fetch(
      `${API}/api/recommend?rank=${rank}&province=${province}&subject=${encodeURIComponent(subject)}${examMode ? `&exam_mode=${encodeURIComponent(examMode)}` : ""}${orderParam}${constraintParam}`,
      {
        signal: controller.signal,
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      }
    )
      .then((r) => {
        if (stale) return null;
        if (!r.ok) throw new Error(`服务器错误 ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (stale || d == null) return;
        setData(d);
        setFetchError(null);
        setLoading(false);
        // Save to query history (max 5 entries)
        try {
          const entry = { province, rank, subject, exam_mode: examMode, time: Date.now(), total: d.total_matched };
          const hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
          const filtered = hist.filter((h: any) => !(h.province === province && h.rank === rank && h.subject === subject && h.exam_mode === examMode));
          localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...filtered].slice(0, 5)));
        } catch {}
      })
      .catch((e: any) => {
        if (stale) return;
        const msg =
          e?.name === "AbortError"
            ? "分析超时（30秒），服务器可能繁忙，请稍后重试"
            : "加载失败，请检查网络连接后重试";
        setFetchError(msg);
        setLoading(false);
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      stale = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [rank, province, subject, orderNo, cMajor, cCity, cNature, cTier]);

  if (loading) {
    return <LoadingScreen />;
  }

  if (fetchError) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--color-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", maxWidth: 320, padding: "0 20px" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 8 }}>分析失败</div>
          <div style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.6, marginBottom: 24 }}>{fetchError}</div>
          <button className="btn-primary" onClick={() => router.push("/")}>返回重新查询</button>
        </div>
      </div>
    );
  }

  const totalSchools = (data?.surge.length || 0) + (data?.stable.length || 0) + (data?.safe.length || 0);
  const gemCount = data?.hidden_gems.length || 0;
  const lockedCount = [
    ...(data?.surge || []), ...(data?.stable || []), ...(data?.safe || []), ...(data?.hidden_gems || [])
  ].filter(i => i.locked).length;

  const tabs = [
    { key: "gems", label: "冷门宝藏", icon: "◆", count: gemCount },
    { key: "surge", label: "冲击", icon: "↑", count: data?.surge.length || 0 },
    { key: "stable", label: "稳妥", icon: "＝", count: data?.stable.length || 0 },
    { key: "safe", label: "保底", icon: "■", count: data?.safe.length || 0 },
  ];

  const baseList = activeTab === "gems" ? (data?.hidden_gems || [])
    : activeTab === "surge" ? (data?.surge || [])
    : activeTab === "stable" ? (data?.stable || [])
    : (data?.safe || []);

  const currentList = filterTier ? baseList.filter((item) => item.tier === filterTier) : baseList;

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)" }}>
      {/* Nav */}
      <nav className="apple-nav" style={{ position: "relative" }}>
        <div style={{ maxWidth: 980, margin: "0 auto", padding: "8px 20px", minHeight: 52, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <button onClick={() => router.push("/")} className="btn-ghost" style={{ fontSize: 14, paddingLeft: 0, paddingRight: 0, flexShrink: 0 }}>
            ← 重新查询
          </button>

          {/* 中间：查询信息 */}
          <div style={{ textAlign: "center", flex: 1, padding: "0 12px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>
              {fromMock
                ? `模考 ${mockScore}分 · 估算 ${Number(rank).toLocaleString()}`
                : `位次 ${Number(rank).toLocaleString()} · ${province}`}
            </div>
            {fromMock && (
              <div style={{ fontSize: 11, color: "#ff9500" }}>此为估算位次，出分后请用真实位次重查</div>
            )}
          </div>

          {/* 桌面端右侧操作 */}
          <div className="nav-link-mobile-hide" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {data?.is_paid ? (
              <button
                onClick={handleExportPDF}
                disabled={exporting || !data || data.total_matched === 0}
                title={`PDF报告包含：全部${totalSchools}所学校逐一分析 · 历年录取位次 · 就业薪资 · 填报策略`}
                style={{
                  fontSize: 12, padding: "6px 14px", borderRadius: 980,
                  border: "1px solid var(--color-accent)",
                  background: "rgba(201,146,42,0.08)", color: "var(--color-accent)",
                  cursor: "pointer", opacity: exporting ? 0.6 : 1, fontWeight: 500,
                }}
              >
                {exporting ? "生成中…" : "↓ 下载报告"}
              </button>
            ) : (
              <button
                onClick={() => setShowPayModal(true)}
                disabled={!data || data.total_matched === 0}
                style={{
                  fontSize: 12, padding: "6px 14px", borderRadius: 980,
                  background: "var(--color-navy)", color: "#fff",
                  border: "none", cursor: "pointer", fontWeight: 600,
                }}
              >
                ¥1.99 解锁完整报告
              </button>
            )}
            <button
              onClick={() => setShowEmailInput(!showEmailInput)}
              disabled={!data || data.total_matched === 0}
              style={{
                fontSize: 12, padding: "6px 12px", borderRadius: 980,
                border: "1px solid var(--color-separator)",
                background: "transparent", color: "var(--color-text-secondary)",
                cursor: "pointer",
              }}
            >
              发邮件
            </button>
            <Link href="/form" style={{ fontSize: 13, padding: "6px 14px", borderRadius: 980, background: "var(--color-accent)", color: "#fff", textDecoration: "none", fontWeight: 500 }}>
              我的志愿表
            </Link>
            <AuthNav />
          </div>

          {/* 移动端：更多 按钮 */}
          <div className="nav-mobile-only nav-mobile-menu" style={{ flexShrink: 0 }}>
            <button
              onClick={() => setShowMobileMenu((v) => !v)}
              style={{
                fontSize: 13, padding: "6px 14px", borderRadius: 980,
                border: "1px solid var(--color-separator)",
                background: showMobileMenu ? "var(--color-bg-secondary)" : "transparent",
                color: "var(--color-text-secondary)", cursor: "pointer",
              }}
            >
              ⋮
            </button>
            {showMobileMenu && (
              <div
                style={{
                  position: "absolute", top: "100%", right: 0, left: 0,
                  background: "var(--color-bg-secondary)",
                  borderBottom: "1px solid var(--color-separator)",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
                  padding: "12px 20px", display: "flex", flexDirection: "column", gap: 10,
                  zIndex: 200,
                }}
                onClick={() => setShowMobileMenu(false)}
              >
                {data?.is_paid ? (
                  <button
                    onClick={handleExportPDF}
                    disabled={exporting || !data || data.total_matched === 0}
                    style={{
                      fontSize: 14, padding: "10px 16px", borderRadius: 10,
                      border: "1px solid var(--color-accent)",
                      background: "rgba(201,146,42,0.08)", color: "var(--color-accent)",
                      cursor: "pointer", opacity: exporting ? 0.6 : 1, fontWeight: 500, textAlign: "left",
                    }}
                  >
                    {exporting ? "生成中…" : "↓ 下载PDF报告"}
                  </button>
                ) : (
                  <button
                    onClick={() => { setShowMobileMenu(false); setShowPayModal(true); }}
                    disabled={!data || data.total_matched === 0}
                    style={{
                      fontSize: 14, padding: "10px 16px", borderRadius: 10,
                      background: "var(--color-navy)", color: "#fff",
                      border: "none", cursor: "pointer", fontWeight: 600, textAlign: "left",
                    }}
                  >
                    ¥1.99 解锁完整报告
                  </button>
                )}
                <Link
                  href="/form"
                  style={{
                    fontSize: 14, padding: "10px 16px", borderRadius: 10,
                    background: "var(--color-accent)", color: "#fff",
                    textDecoration: "none", fontWeight: 500, display: "block",
                  }}
                >
                  我的志愿表
                </Link>
                <button
                  onClick={() => { setShowMobileMenu(false); setShowEmailInput(!showEmailInput); }}
                  disabled={!data || data.total_matched === 0}
                  style={{
                    fontSize: 14, padding: "10px 16px", borderRadius: 10,
                    border: "1px solid var(--color-separator)",
                    background: "transparent", color: "var(--color-text-secondary)",
                    cursor: "pointer", textAlign: "left",
                  }}
                >
                  发送邮件报告
                </button>
                <div style={{ paddingTop: 4, borderTop: "1px solid var(--color-separator)" }}>
                  <button
                    onClick={() => router.push("/dashboard")}
                    style={{
                      width: "100%", fontSize: 14, padding: "10px 16px", borderRadius: 10,
                      background: "transparent", border: "none",
                      color: "var(--color-text-secondary)", cursor: "pointer", textAlign: "left",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                    }}
                  >
                    <span>我的</span>
                    <span style={{ color: "var(--color-text-tertiary)" }}>→</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* 已应用约束提示 */}
      {(cMajor || cCity || cNature || cTier) && (
        <div style={{ background: "#EEF2FF", borderBottom: "1px solid #C7D2FE", padding: "10px 20px" }}>
          <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, color: "#1E3A8A" }}>
            <span style={{ fontWeight: 600 }}>已应用偏好约束：</span>
            {cMajor && <span style={{ background: "#fff", padding: "2px 8px", borderRadius: 6, fontSize: 12 }}>专业含「{cMajor}」</span>}
            {cCity && <span style={{ background: "#fff", padding: "2px 8px", borderRadius: 6, fontSize: 12 }}>城市：{cCity}</span>}
            {cNature && <span style={{ background: "#fff", padding: "2px 8px", borderRadius: 6, fontSize: 12 }}>性质：{cNature}</span>}
            {cTier && <span style={{ background: "#fff", padding: "2px 8px", borderRadius: 6, fontSize: 12 }}>档次：{cTier}</span>}
            <button
              onClick={() => router.push(`/results?rank=${rank}&province=${encodeURIComponent(province)}&subject=${encodeURIComponent(subject)}`)}
              style={{ marginLeft: "auto", background: "none", border: "none", color: "#1E40AF", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
            >
              清除约束
            </button>
          </div>
        </div>
      )}

      {/* Email input panel */}
      {showEmailInput && (
        <div style={{ background: "var(--color-bg-secondary)", borderBottom: "1px solid var(--color-separator)", padding: "12px 20px" }}>
          <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="email"
              placeholder="输入邮箱地址，接收PDF报告"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendEmail()}
              style={{
                flex: 1, fontSize: 13, padding: "8px 14px", borderRadius: 8,
                border: "1px solid var(--color-separator)", background: "var(--color-bg)",
                color: "var(--color-text-primary)", outline: "none",
              }}
            />
            <button
              onClick={handleSendEmail}
              disabled={emailSending}
              style={{
                fontSize: 13, padding: "8px 18px", borderRadius: 8,
                background: "var(--color-accent)", color: "#fff", border: "none",
                cursor: "pointer", opacity: emailSending ? 0.6 : 1, fontWeight: 500,
              }}
            >
              {emailSending ? "发送中…" : "发送"}
            </button>
            <button
              onClick={() => setShowEmailInput(false)}
              style={{ fontSize: 12, background: "none", border: "none", color: "var(--color-text-tertiary)", cursor: "pointer" }}
            >
              取消
            </button>
          </div>
          <div style={{ maxWidth: 680, margin: "6px auto 0", fontSize: 11, color: "var(--color-text-tertiary)" }}>
            报告将以PDF附件形式发送，通常1分钟内到达
          </div>
        </div>
      )}

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 20px 80px" }}>

        {/* Summary Banner */}
        {(data?.total_matched ?? 0) > 0 && (
          <div style={{
            margin: "16px 0 0",
            padding: "14px 18px",
            background: "linear-gradient(135deg, rgba(26,39,68,0.04) 0%, rgba(201,146,42,0.06) 100%)",
            borderRadius: 12,
            border: "1px solid var(--color-border-light)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-navy)", fontFamily: "var(--font-serif)" }}>
                  为你精选 {totalSchools} 所学校
                </span>
                {gemCount > 0 && (
                  <span style={{ marginLeft: 8, fontSize: 13, color: "var(--color-accent)", fontWeight: 600 }}>
                    · 含 {gemCount} 所冷门宝藏
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", textAlign: "right", flexShrink: 0 }}>
                冲 {data?.surge.length} · 稳 {data?.stable.length} · 保 {data?.safe.length}
              </div>
            </div>
            {!data?.is_paid && lockedCount > 0 && (
              <div style={{ marginTop: 10, fontSize: 13, color: "#7F1D1D", lineHeight: 1.6 }}>
                还有 <strong>{lockedCount} 所</strong>被锁定——包括完整概率分析、历年趋势、在读生口碑，解锁后全部可见。
              </div>
            )}
          </div>
        )}

        {/* AI 预测入口 —— 已隐藏（2026-04-26）
          原因：ai-predict 页面依赖外部 MiroFish 服务，当前未部署，用户反馈入口混乱。
          Result 页已具备本地群体智能（swarm_predictor.py，<30ms），功能重叠。
          如需恢复，取消注释下方代码并确保 NEXT_PUBLIC_MIROFISH_URL 已配置。
        */}
        {/*
        {(data?.total_matched ?? 0) > 0 && (
          <Link ... > ... </Link>
        )}
        */}

        {/* 长期受益预测入口 —— 已隐藏（2026-04-26）
          原因：career-predict 页面依赖外部 MiroFish 服务，当前未部署。
          如需恢复，取消注释下方代码并确保 NEXT_PUBLIC_MIROFISH_URL 已配置。
        */}
        {/*
        {(data?.total_matched ?? 0) > 0 && (
          <Link ... > ... </Link>
        )}
        */}

        {/* Contextual rank note */}
        {(data?.total_matched ?? 0) > 0 && (() => {
          const r = Number(rank);
          const n = totalSchools;
          let label = "";
          let note = "";
          if (r <= 3000) {
            label = "顶尖位次段";
            note = `你的位次位于全省前 3,000 名，全国仅有极少数顶级院校能精准匹配。共筛选出 ${n} 所，数量少但含金量高，建议认真研读每一所的专业细节。`;
          } else if (r <= 15000) {
            label = "高分位次段";
            note = `你的位次属于高分段，推荐院校以 985 / 211 重点高校为主，共匹配 ${n} 所。建议重点关注专业排名与冷门宝藏院校中的强势学科。`;
          } else if (r > 80000) {
            label = "普通位次段";
            note = `你的位次对应大量双一流 / 211 院校，共匹配 ${n} 所。建议优先关注专业就业前景与城市机会，而非单纯追求院校综合排名。`;
          } else if (n < 60) {
            label = "中等位次段";
            note = `当前位次匹配到 ${n} 所院校。重点关注其中标注「冷门宝藏」的院校——相同分数，往往能进入更强的学科平台。`;
          }
          if (!note) return null;
          return (
            <div style={{
              margin: "8px 0 0", padding: "10px 14px",
              background: "rgba(14,165,233,0.05)",
              borderLeft: "3px solid #0EA5E9",
              borderRadius: "0 8px 8px 0",
              fontSize: 12, color: "#0C4A6E", lineHeight: 1.7,
            }}>
              <strong style={{ fontWeight: 600 }}>{label}：</strong>{note}
            </div>
          );
        })()}

        {/* Tab bar */}
        <div className="tab-bar" style={{ margin: "12px 0 0", display: "flex", flexWrap: "wrap", gap: 8 }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key as any); setLockedExpanded(false); }}
              className={`tab-item${activeTab === t.key ? " active" : ""}`}
              style={{ display: "flex", alignItems: "center", gap: 5 }}
            >
              <span style={{ fontSize: 11, opacity: 0.7 }}>{t.icon}</span>
              <span>{t.label}</span>
              <span style={{
                marginLeft: 3, fontSize: 11, fontWeight: 700,
                color: activeTab === t.key ? "#fff" : "var(--color-text-tertiary)",
                background: activeTab === t.key ? "var(--color-accent)" : "var(--color-bg-tertiary)",
                borderRadius: 4, padding: "1px 6px", minWidth: 18, textAlign: "center",
              }}>{t.count}</span>
            </button>
          ))}
        </div>

        {/* Tier filter */}
        <div style={{ display: "flex", gap: 6, margin: "16px 0", flexWrap: "wrap", alignItems: "center" }}>
          {["", "985", "211", "双一流", "普通"].map((t) => (
            <button
              key={t}
              onClick={() => setFilterTier(t)}
              style={{
                fontSize: 12, padding: "4px 12px", borderRadius: 99,
                border: `1px solid ${filterTier === t ? "var(--color-accent)" : "var(--color-border-light)"}`,
                background: filterTier === t ? "rgba(201,146,42,0.08)" : "transparent",
                color: filterTier === t ? "var(--color-accent)" : "var(--color-text-secondary)",
                cursor: "pointer", transition: "all 0.15s",
              }}
            >
              {t || "全部层次"}
            </button>
          ))}
          <Link
            href={`/search?tab=major&province=${encodeURIComponent(province)}&rank=${encodeURIComponent(rank)}&subject=${encodeURIComponent(subject)}`}
            style={{
              fontSize: 12, padding: "4px 12px", borderRadius: 99, marginLeft: "auto",
              border: "1px solid var(--color-separator)", textDecoration: "none",
              background: "transparent", color: "var(--color-text-secondary)",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            ≡ 按专业找
          </Link>
        </div>

        {/* P4: 新高考省份数据不足警告 */}
        {data && data.total_matched > 0 && ["广东","湖南","湖北","重庆","福建","江苏","河北","辽宁"].includes(province) && (
          <div style={{
            background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8,
            padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#92400E", lineHeight: 1.7,
          }}>
            <strong>提示：</strong>{province}于2021年实施新高考改革，现有参考数据仅4年（2021–2025）。样本量较少，冲/稳/保分类可能存在偏差，建议结合目标院校招生简章综合判断。
          </div>
        )}

        {/* No data */}
        {data && data.total_matched === 0 && (
          <div style={{ textAlign: "center", padding: "64px 0" }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: "var(--color-border-light)", marginBottom: 16 }}>—</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 8 }}>
              {province}数据建设中
            </div>
            <div style={{ fontSize: 14, color: "var(--color-text-secondary)", maxWidth: 280, margin: "0 auto 24px", lineHeight: 1.6 }}>
              当前已覆盖北京、广东、河南、山东、江苏、浙江录取数据（2017–2025）。建议先切换以上省份体验完整功能。
            </div>
            <button onClick={() => router.push("/")} className="btn-primary">返回首页</button>
          </div>
        )}

        {/* Result count + list */}
        {(data?.total_matched ?? 0) > 0 && (
          <>
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 10, marginTop: 14 }}>
              {activeTab === "gems"
                ? `共 ${currentList.length} 所冷门宝藏（从 ${totalSchools} 所中筛出）`
                : `共 ${currentList.length} 所`}
            </div>

            {/* Tab description — 暖色版，无emoji */}
            {activeTab === "gems" && currentList.length > 0 && (
              <div style={{
                background: "#FFFBEB", borderRadius: 10, padding: "12px 16px",
                marginBottom: 10, fontSize: 13, color: "#78350F", lineHeight: 1.6,
                borderLeft: "3px solid var(--color-accent)",
                border: "1px solid #FDE68A", borderLeftWidth: 3,
              }}>
                ◆ <strong>被市场系统性低估</strong>的院校专业——相同分数，这里能进入更强的学科或平台。算法从 {totalSchools} 所候选中筛出。
              </div>
            )}
            {activeTab === "surge" && currentList.length > 0 && (
              <div style={{
                background: "#FEF2F2", borderRadius: 10, padding: "12px 16px",
                marginBottom: 10, fontSize: 13, color: "#7F1D1D", lineHeight: 1.6,
                border: "1px solid #FECACA", borderLeftWidth: 3, borderLeftColor: "#DC2626",
              }}>
                ↑ <strong>冲击目标</strong>——录取概率 25–54%，值得一搏。建议占志愿表前1/4位置。
              </div>
            )}
            {activeTab === "stable" && currentList.length > 0 && (
              <div style={{
                background: "#EFF6FF", borderRadius: 10, padding: "12px 16px",
                marginBottom: 10, fontSize: 13, color: "#1E3A5F", lineHeight: 1.6,
                border: "1px solid #BFDBFE", borderLeftWidth: 3, borderLeftColor: "#1A2744",
              }}>
                ＝ <strong>稳妥主力</strong>——录取概率 55–81%，志愿表的中坚力量。
              </div>
            )}
            {activeTab === "safe" && currentList.length > 0 && (
              <div style={{
                background: "#F0FDF4", borderRadius: 10, padding: "12px 16px",
                marginBottom: 10, fontSize: 13, color: "#14532D", lineHeight: 1.6,
                border: "1px solid #BBF7D0", borderLeftWidth: 3, borderLeftColor: "#059669",
              }}>
                ■ <strong>保底托底</strong>——录取概率 ≥82%，确保不落榜的安全网。
              </div>
            )}

            {currentList.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-tertiary)", fontSize: 14 }}>
                {activeTab === "gems" ? "该位次区间暂无冷门推荐" : "暂无匹配数据"}
              </div>
            ) : (() => {
              const FREE_LOCKED_PREVIEW = 3; // max locked cards shown before collapse
              const freeItems = currentList.filter(item => !item.locked);
              const lockedItems = currentList.filter(item => item.locked);
              const visibleLocked = (!data?.is_paid && !lockedExpanded)
                ? lockedItems.slice(0, FREE_LOCKED_PREVIEW)
                : lockedItems;
              const hiddenLockedCount = lockedItems.length - visibleLocked.length;
              const doUnlock = () => { track("unlock_click", { province, rankInput: Number(rank) }); setShowPayModal(true); };
              return (
                <div>
                  {freeItems.map((item, i) => (
                    <SchoolCard key={`free-${item.school_name}-${item.major_name}-${i}`} item={item} province={province} rank={rank} score={score} subject={subject} isPaid={data?.is_paid ?? false} onUnlock={doUnlock} />
                  ))}
                  {visibleLocked.map((item, i) => (
                    <LockedSchoolCard key={`locked-${item.school_name}-${item.major_name}-${i}`} item={item} onUnlock={doUnlock} />
                  ))}
                  {hiddenLockedCount > 0 && (
                    <div style={{
                      margin: "8px 0 16px", borderRadius: 12,
                      border: "1px dashed var(--color-border-light)",
                      padding: "14px 16px",
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                    }}>
                      <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                        还有 <strong style={{ color: "var(--color-navy)" }}>{hiddenLockedCount} 所</strong>锁定，解锁后全部可见
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        <button
                          onClick={() => setLockedExpanded(true)}
                          style={{
                            fontSize: 12, padding: "6px 12px", borderRadius: 8,
                            border: "1px solid var(--color-border-light)",
                            background: "transparent", color: "var(--color-text-secondary)",
                            cursor: "pointer",
                          }}
                        >
                          展开预览
                        </button>
                        <button
                          onClick={doUnlock}
                          style={{
                            fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 8,
                            background: "var(--color-navy)", color: "#fff",
                            border: "none", cursor: "pointer",
                          }}
                        >
                          ¥1.99 解锁
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}

        {/* PDF export value card */}
        {(data?.total_matched ?? 0) > 0 && (
          <div style={{
            margin: "28px 0 8px",
            padding: "20px 20px",
            background: "linear-gradient(135deg, rgba(26,39,68,0.03) 0%, rgba(201,146,42,0.05) 100%)",
            borderRadius: 14,
            border: "1px solid var(--color-border-light)",
          }}>
            {!data?.is_paid && lockedCount > 0 ? (
              <>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-navy)", marginBottom: 6 }}>
                  你已经看到了前 5 所
                </div>
                <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 14, lineHeight: 1.6 }}>
                  解锁剩余 <strong>{lockedCount} 所</strong> + 每所学校真实安全录取线 + 近3年分数线趋势 + 在读生口碑
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16, textAlign: "center" }}>
                  {[
                    ["复读费", "¥30,000+"],
                    ["四年学费差距", "¥40,000+"],
                    ["完整报告", "¥1.99"],
                  ].map(([label, val]) => (
                    <div key={label} style={{
                      padding: "10px 6px", borderRadius: 10,
                      background: label === "完整报告" ? "rgba(201,146,42,0.08)" : "rgba(0,0,0,0.03)",
                      border: label === "完整报告" ? "1px solid rgba(201,146,42,0.3)" : "1px solid var(--color-border-light)",
                    }}>
                      <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: label === "完整报告" ? "var(--color-accent)" : "var(--color-text-primary)" }}>{val}</div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setShowPayModal(true)}
                  style={{
                    width: "100%", padding: "12px 0", borderRadius: 10,
                    background: "var(--color-navy)", color: "#fff",
                    border: "none", fontSize: 14, fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  ¥1.99 解锁完整报告（含全部 {totalSchools} 所）
                </button>
                <div style={{ textAlign: "center", marginTop: 8, fontSize: 11, color: "var(--color-text-tertiary)" }}>
                  无风险 · 如果没用，截图找我们退款
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-navy)", marginBottom: 12 }}>
                  完整分析报告包含更多内容
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", marginBottom: 16 }}>
                  {[
                    ["全部院校逐一分析", `${totalSchools} 所学校完整推荐理由`],
                    ["历年位次对比表", "2017–2025 年录取数据，识别大小年"],
                    ["毕业薪资 & 就业率", "各校平均薪资、深造率、雇主层级"],
                    ["AI 填报策略", "冲/稳/保 配置建议 + 冷门宝藏说明"],
                  ].map(([title, desc]) => (
                    <div key={title} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span style={{ color: "var(--color-accent)", fontSize: 13, marginTop: 1, flexShrink: 0 }}>✓</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>{title}</div>
                        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", lineHeight: 1.4 }}>{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleExportPDF}
                  disabled={exporting || !data}
                  style={{
                    width: "100%", padding: "11px 0", borderRadius: 10,
                    background: "var(--color-navy)", color: "#fff",
                    border: "none", fontSize: 13, fontWeight: 600,
                    cursor: exporting ? "default" : "pointer", opacity: exporting ? 0.7 : 1,
                  }}
                >
                  {exporting ? "生成中，请稍候…" : `下载完整 PDF 报告（含全部 ${totalSchools} 所）`}
                </button>
              </>
            )}
          </div>
        )}

        <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", textAlign: "center", marginTop: 16 }}>
          以上数据基于2017–2025年公开录取数据，预测含不确定性。请以官方招生简章为准做最终决策。
        </p>

        {/* Free-tier share nudge */}
        {!data?.is_paid && (data?.total_matched ?? 0) > 0 && (
          <div style={{
            margin: "12px 0 0", padding: "12px 14px", borderRadius: 10,
            background: "rgba(52,199,89,0.06)", border: "1px solid rgba(52,199,89,0.2)",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
          }}>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              觉得有用？分享给同学，他们也能查自己的冷门机会
            </div>
            <button
              onClick={() => {
                const text = `我用「水卢冷门高报引擎」查了${province}位次${rank}的冷门院校，推荐结果很准！你也来查一下 👉 www.theyuanxi.cn`;
                try { navigator.clipboard.writeText(text); } catch {}
                setToast("✓ 已复制分享文案，粘贴到微信发送即可");
                setTimeout(() => setToast(null), 3000);
              }}
              style={{
                padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: "#07C160", color: "#fff", border: "none", cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              复制分享文案
            </button>
          </div>
        )}
      </div>

      {/* Pay Modal */}
      {showPayModal && (
        <PayModal
          onClose={() => setShowPayModal(false)}
          onSuccess={(no) => {
            // Store with per-query key so this order_no only unlocks this specific query
            try { localStorage.setItem(queryOrderKey, no); } catch {}
            setOrderNo(no);
            setShowPayModal(false);
            setToast("✅ 解锁成功！正在加载完整报告…");
            setTimeout(() => setToast(null), 4000);
            setLoading(true);
          }}
          queryParams={{ province, rank: rank ? Number(rank) : undefined, subject }}
          totalSchools={totalSchools}
          isPaid={data?.is_paid ?? false}
        />
      )}

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)",
          background: "rgba(29,29,31,0.92)", color: "#fff",
          padding: "10px 20px", borderRadius: 99, fontSize: 13, fontWeight: 500,
          zIndex: 9999, pointerEvents: "none",
          boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
          whiteSpace: "nowrap",
        }}>
          {toast}
        </div>
      )}

      {/* 数据来源标注 + 2026新政提示 */}
      {data && (
        <div style={{ padding: "16px 16px 80px" }}>
          <div style={{
            background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8,
            padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#92400E", lineHeight: 1.7,
          }}>
            <strong>⚠️ 2026年新政提示：</strong>教育部要求大类招生缩减至30%以下，更多院校将按具体专业招生；同时撤销1428个冷门专业，新增29个急需专业（AI、集成电路等）。本系统数据基于2023–2025年历史录取，请结合目标院校2026年招生简章核实专业及计划变化。
          </div>
          <div style={{ textAlign: "center", fontSize: 11, color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
            数据来源：2023–2025年教育部公开录取数据
            <br />结果仅供志愿填报参考，请以各院校当年招生简章为准
          </div>
        </div>
      )}

      {/* Sticky unlock banner for unpaid users */}
      {data && !data.is_paid && data.total_matched > 0 && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 90,
          background: "linear-gradient(135deg, var(--color-navy) 0%, #2d4a8a 100%)",
          padding: "12px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          boxShadow: "0 -4px 24px rgba(0,0,0,0.18)",
        }}>
          <div style={{ color: "#fff", minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
              你已看到前 5 所 · 还有 {lockedCount} 所被锁定
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginTop: 2 }}>
              解锁完整安全线分析 + 历年趋势 + 在读生口碑 · ¥1.99
            </div>
          </div>
          <button
            onClick={() => setShowPayModal(true)}
            style={{
              flexShrink: 0, fontSize: 13, fontWeight: 700,
              padding: "10px 20px", borderRadius: 980,
              background: "var(--color-accent)", color: "#fff",
              border: "none", cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            ¥1.99 立即解锁
          </button>
        </div>
      )}
    </div>
  );
}

// ── 营销轮播 Loading 页 ─────────────────────────────────────────
const LOADING_SLIDES = [
  { icon: "🔬", title: "正在运行概率模型", body: "基于近3年逐分录取数据，用 Sigmoid 函数计算你的真实录取概率，而非简单位次对比。" },
  { icon: "💎", title: "扫描冷门黑马", body: "系统正在识别「学科强·排名低」的套利机会——相同分数，在冷门院校能进入更强的专业。" },
  { icon: "📈", title: "分析产业信号", body: "结合核能、低空经济、AI等7大新兴产业的招聘趋势，标记未来4年毕业时需求最旺的专业方向。" },
  { icon: "🏙️", title: "计算城市折价", body: "哈尔滨、兰州等城市的高校因地理因素被系统性低估，同等专业实力录取分数低200–500分。" },
  { icon: "✅", title: "即将完成", body: "正在生成冲·稳·保梯度配置，以及每所学校的个性化填报建议。" },
];

function LoadingScreen() {
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % LOADING_SLIDES.length), 2200);
    return () => clearInterval(t);
  }, []);
  const slide = LOADING_SLIDES[idx];
  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 24px" }}>
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div style={{ fontSize: 48, marginBottom: 16, lineHeight: 1 }}>{slide.icon}</div>
        <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-text)", marginBottom: 10 }}>{slide.title}</div>
        <div style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 28, minHeight: 60 }}>{slide.body}</div>
        {/* progress dots */}
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 20 }}>
          {LOADING_SLIDES.map((_, i) => (
            <div key={i} style={{ width: i === idx ? 20 : 6, height: 6, borderRadius: 3, background: i === idx ? "var(--color-accent)" : "var(--color-separator)", transition: "width 0.3s" }} />
          ))}
        </div>
        <div className="spinner" style={{ width: 24, height: 24, margin: "0 auto" }} />
      </div>
    </div>
  );
}

export default function Results() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", background: "var(--color-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    }>
      <ResultsContent />
    </Suspense>
  );
}
