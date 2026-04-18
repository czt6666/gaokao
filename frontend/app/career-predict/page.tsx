"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  MIROFISH_BASE,
  buildCareerScene,
  createAndPrepareSimulation,
  runSimulation,
  generatePredictionReport,
  getReportSections,
  getAgentLog,
  AgentProfile,
  AgentAction,
  RunStatus,
  AgentLog,
  ReportSection,
} from "@/lib/mirofish";

// ─── Markdown 渲染（极简） ────────────────────────────────────────────

function renderSimpleMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h4 style="font-size:13px;font-weight:700;margin:16px 0 6px;color:#000">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="font-size:15px;font-weight:700;margin:20px 0 8px;color:#000;border-bottom:1px solid #E5E5E5;padding-bottom:6px">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 style="font-size:18px;font-weight:700;margin:0 0 16px;color:#000">$1</h2>')
    .replace(/^> (.+)$/gm, '<blockquote style="border-left:3px solid #FF4500;padding:8px 12px;margin:8px 0;background:#FFF5F0;color:#333;font-style:italic">$1</blockquote>')
    .replace(/^\* (.+)$/gm, '<div style="display:flex;gap:8px;margin:4px 0;padding-left:4px"><span style="color:#FF4500;flex-shrink:0;margin-top:2px">▸</span><span>$1</span></div>')
    .replace(/^- (.+)$/gm, '<div style="display:flex;gap:8px;margin:4px 0;padding-left:4px"><span style="color:#FF4500;flex-shrink:0;margin-top:2px">▸</span><span>$1</span></div>')
    .replace(/^\d+\. (.+)$/gm, '<div style="margin:4px 0 4px 12px">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #E5E5E5;margin:12px 0"/>')
    .replace(/\n\n/g, '<br/>')
    .replace(/^(?!<[h2-4b|d]|<br)(.+)$/gm, '<p style="margin:4px 0;line-height:1.7">$1</p>');
}

// ─── Action badge ─────────────────────────────────────────────────────

const ACTION_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  CREATE_POST:    { bg: "#0057FF", color: "#fff", label: "POST" },
  CREATE_COMMENT: { bg: "#FF4500", color: "#fff", label: "COMMENT" },
  LIKE_POST:      { bg: "#E00", color: "#fff", label: "LIKE" },
  REPOST:         { bg: "#008844", color: "#fff", label: "REPOST" },
  UPVOTE_POST:    { bg: "#FF6600", color: "#fff", label: "UPVOTE" },
  DOWNVOTE_POST:  { bg: "#333", color: "#fff", label: "DOWNVOTE" },
  DO_NOTHING:     { bg: "#CCC", color: "#666", label: "IDLE" },
};
function getActionStyle(type: string) {
  return ACTION_STYLES[type] || { bg: "#999", color: "#fff", label: type.replace(/_/g, " ") };
}

// ─── Icons ────────────────────────────────────────────────────────────

const IconCheck = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

// ─── Main Content ─────────────────────────────────────────────────────

type Stage = "landing" | "step1" | "step2" | "step3" | "step4" | "step5" | "done" | "error";

const STEP_LABELS = [
  "Scene Build",
  "Graph Build",
  "Agent Personas",
  "Simulation Run",
  "Report Generate",
];

function CareerPredictContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const rank     = parseInt(searchParams.get("rank") || "30000", 10);
  const province = searchParams.get("province") || "广东";

  // School + major can come from URL or user selection on landing
  const [school, setSchool] = useState(searchParams.get("school") || "");
  const [major,  setMajor]  = useState(searchParams.get("major")  || "");

  // ── Stage & Progress ──
  const [stage, setStage]       = useState<Stage>("landing");
  const [statusMsg, setStatusMsg] = useState("");
  const [progress, setProgress]  = useState(0);
  const [errorMsg, setErrorMsg]  = useState("");

  // ── IDs ──
  const [projectId, setProjectId]       = useState("");
  const [graphId, setGraphId]           = useState("");
  const [simulationId, setSimulationId] = useState("");
  const [reportId, setReportId]         = useState("");

  // ── Agents ──
  const [profiles, setProfiles]         = useState<AgentProfile[]>([]);

  // ── Simulation ──
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [actions, setActions]     = useState<AgentAction[]>([]);
  const actionsEndRef = useRef<HTMLDivElement>(null);

  // ── Report ──
  const [reportSections, setReportSections] = useState<ReportSection[]>([]);
  const [agentLogs, setAgentLogs]           = useState<AgentLog[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());
  const [logLine, setLogLine]               = useState(0);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // ── Elapsed time ──
  const startTimeRef = useRef<number>(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (stage === "landing" || stage === "done" || stage === "error") return;
    startTimeRef.current = Date.now();
    const t = setInterval(() => setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [stage]);

  useEffect(() => { actionsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [actions.length]);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [agentLogs.length]);

  // ── Report polling ──
  useEffect(() => {
    if (stage !== "step5" && stage !== "done") return;
    if (!reportId) return;
    const iv = setInterval(async () => {
      try {
        const { sections, isComplete } = await getReportSections(reportId);
        setReportSections(sections);
        const newLogs = await getAgentLog(reportId, logLine);
        if (newLogs.length > 0) {
          setAgentLogs(prev => [...prev, ...newLogs]);
          setLogLine(l => l + newLogs.length);
        }
        if (isComplete && stage === "step5") setStage("done");
      } catch {}
    }, 2500);
    return () => clearInterval(iv);
  }, [stage, reportId, logLine]);

  // ── Main flow ──
  async function startPrediction() {
    const maxRounds = 20;
    try {
      // Step 1: build career scene (auto-generates scenario + ontology)
      setStage("step1"); setProgress(0); setStatusMsg("Generating career prediction scenario...");
      const pid = await buildCareerScene(school, major, rank, province, (msg) => {
        setStatusMsg(msg); setProgress(60);
      });
      setProjectId(pid); setProgress(100);

      // Step 2: 跳过 Zep 图谱构建（career predict 走 ontology synthesis 路径，无需 Zep）
      setStage("step2"); setProgress(100); setStatusMsg("Graph skipped — ontology synthesis mode");
      const gid = "";
      setGraphId(gid);

      // Step 3: create + prepare simulation
      setStage("step3"); setProgress(0); setStatusMsg("Creating simulation instance...");
      const sid = await createAndPrepareSimulation(pid, gid, (msg, pct, profs) => {
        setStatusMsg(msg); setProgress(pct);
        if (profs && profs.length > 0) setProfiles(profs);
      });
      setSimulationId(sid);

      // Step 4: run simulation
      setStage("step4"); setProgress(0);
      await runSimulation(sid, maxRounds, (status, newActions) => {
        setRunStatus(status);
        setActions(newActions);
        setProgress(Math.round(((status.current_round || 0) / maxRounds) * 100));
      });

      // Step 5: generate report
      setStage("step5"); setProgress(0);
      const rid = await generatePredictionReport(sid, (msg, pct) => {
        setStatusMsg(msg); setProgress(pct);
      });
      setReportId(rid);

    } catch (err: any) {
      setErrorMsg(err.message || "Unknown error");
      setStage("error");
    }
  }

  const currentStepIdx = ["step1","step2","step3","step4","step5"].indexOf(stage);
  const formatTime = (s: number) => `${Math.floor(s/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`;

  // ════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#FAFAFA", fontFamily: "-apple-system,'SF Pro Text','PingFang SC','Helvetica Neue',sans-serif", overflow: "hidden" }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <header style={{ height: 52, background: "#000", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", flexShrink: 0, borderBottom: "1px solid #222" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            onClick={() => router.back()}
            style={{ color: "#fff", fontSize: 11, fontWeight: 700, letterSpacing: 2, cursor: "pointer", opacity: 0.5, transition: "opacity .2s" }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "0.5")}
          >
            ← BACK
          </span>
          <div style={{ width: 1, height: 16, background: "#333" }} />
          <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, letterSpacing: 2 }}>高报 AI · 长期受益预测</span>
        </div>

        {/* Step dots */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {STEP_LABELS.map((lbl, i) => {
            const done   = currentStepIdx > i;
            const active = currentStepIdx === i;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "3px 8px", borderRadius: 3,
                  background: done ? "#FF4500" : active ? "#fff" : "transparent",
                  border: done ? "none" : active ? "none" : "1px solid #333",
                  transition: "all .3s",
                }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: done ? "#fff" : active ? "#000" : "#555", letterSpacing: 1 }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {active && <span style={{ fontSize: 9, color: "#000", letterSpacing: 0.5 }}>{lbl}</span>}
                  {done && <IconCheck />}
                </div>
                {i < STEP_LABELS.length - 1 && (
                  <div style={{ width: 12, height: 1, background: done ? "#FF4500" : "#333" }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Status indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, color: "#555", letterSpacing: 1 }}>
            {province} · {school.slice(0, 8)} · #{rank.toLocaleString()}
          </span>
          <div style={{ width: 1, height: 16, background: "#333" }} />
          {stage === "landing" && <span style={{ fontSize: 9, color: "#555", letterSpacing: 1 }}>IDLE</span>}
          {(stage !== "landing" && stage !== "done" && stage !== "error") && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF4500", animation: "pulse 1.5s infinite" }} />
              <span style={{ fontSize: 9, color: "#FF4500", letterSpacing: 1 }}>RUNNING · {formatTime(elapsedSec)}</span>
            </div>
          )}
          {stage === "done" && <span style={{ fontSize: 9, color: "#00C853", letterSpacing: 1 }}>✓ COMPLETED</span>}
          {stage === "error" && <span style={{ fontSize: 9, color: "#FF0000", letterSpacing: 1 }}>ERROR</span>}
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────── */}
      <main style={{ flex: 1, overflow: "hidden", display: "flex" }}>

        {/* ══ LANDING ══════════════════════════════════════════ */}
        {stage === "landing" && (
          <div style={{ width: "100%", overflowY: "auto", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
            <div style={{ maxWidth: 560, width: "100%", padding: "60px 24px" }}>

              {/* Hero */}
              <div style={{ marginBottom: 48 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 3, color: "#999", marginBottom: 16 }}>
                  高报 · AI 长期受益预测引擎
                </div>
                <h1 style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.2, color: "#000", marginBottom: 16, fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
                  这所学校，<br />
                  <span style={{ color: "#FF4500" }}>10年后值多少？</span>
                </h1>
                <p style={{ fontSize: 14, color: "#666", lineHeight: 1.8 }}>
                  群体智能引擎模拟26届毕业生、雇主、行业分析师的真实博弈，
                  预测这个选择在2031年、2036年的实际职业价值。
                </p>
              </div>

              {/* Target card */}
              <div style={{ background: "#F5F5F5", borderRadius: 6, padding: 24, marginBottom: 24 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#999", marginBottom: 16 }}>预测对象</div>

                {/* School input with datalist */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: "#999", letterSpacing: 1, marginBottom: 6 }}>目标学校</div>
                  <input
                    type="text"
                    list="school-datalist"
                    value={school}
                    onChange={e => setSchool(e.target.value)}
                    placeholder="输入或选择学校（如：哈尔滨工业大学（深圳））"
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 6, border: `1px solid ${school ? "#000" : "#DDD"}`, fontSize: 13, color: "#000", fontFamily: "inherit", outline: "none", boxSizing: "border-box" as const, transition: "border .2s" }}
                  />
                  <datalist id="school-datalist">
                    {["哈尔滨工业大学（深圳）","兰州大学","西北工业大学","电子科技大学","深圳大学","中国矿业大学","海南大学","华南理工大学"].map(s => <option key={s} value={s} />)}
                  </datalist>
                </div>

                {/* Major input with datalist */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: "#999", letterSpacing: 1, marginBottom: 6 }}>目标专业</div>
                  <input
                    type="text"
                    list="major-datalist"
                    value={major}
                    onChange={e => setMajor(e.target.value)}
                    placeholder="输入或选择专业（如：计算机科学）"
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 6, border: `1px solid ${major ? "#000" : "#DDD"}`, fontSize: 13, color: "#000", fontFamily: "inherit", outline: "none", boxSizing: "border-box" as const, transition: "border .2s" }}
                  />
                  <datalist id="major-datalist">
                    {["计算机科学","软件工程","电子信息","机械工程","材料科学","金融学","土木工程","生物工程"].map(m => <option key={m} value={m} />)}
                  </datalist>
                </div>

                {/* Province / rank */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, marginBottom: 4 }}>省份</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#000" }}>{province}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, marginBottom: 4 }}>位次</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#000" }}>#{rank.toLocaleString()}</div>
                  </div>
                </div>

                <div style={{ borderTop: "1px solid #E5E5E5", paddingTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  {[
                    { label: "智能体", value: "~30人" },
                    { label: "模拟轮次", value: "20轮" },
                    { label: "预计时长", value: "10-20分钟" },
                  ].map(({ label: l, value }) => (
                    <div key={l}>
                      <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, marginBottom: 2 }}>{l}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#000" }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* What we predict */}
              <div style={{ border: "1px solid #E5E5E5", borderRadius: 6, marginBottom: 32 }}>
                {[
                  { tag: "品牌折扣分析", desc: "深圳本地科技企业 vs 全国传统企业，学校品牌对薪资和机会的量化影响" },
                  { tag: "5年对比预测", desc: "同等位次分别选该校 vs 对比院校，2031年薪资/机会/生活质量，谁赢了？" },
                  { tag: "价值洼地判断", desc: "是真正被低估的好选择，还是有结构性弱点的折扣？给出有条件的明确结论" },
                ].map(({ tag, desc }, i) => (
                  <div key={tag} style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "14px 20px", borderBottom: i < 2 ? "1px solid #E5E5E5" : "none" }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: "#FF4500", whiteSpace: "nowrap", marginTop: 2 }}>{tag}</span>
                    <span style={{ fontSize: 12, color: "#666", lineHeight: 1.6 }}>{desc}</span>
                  </div>
                ))}
              </div>

              {/* Note about time */}
              <div style={{ fontSize: 11, color: "#AAA", marginBottom: 24, padding: "0 4px", lineHeight: 1.7 }}>
                ⚠️ 本功能使用 LLM 群体推演，约需 10~20 分钟。结果基于模拟世界的涌现性结论，
                非统计预测，不构成择校建议。
              </div>

              {(!school.trim() || !major.trim()) && (
                <div style={{ fontSize: 12, color: "#FF4500", marginBottom: 12, padding: "0 4px" }}>
                  ⚠️ 请先填写学校和专业名称
                </div>
              )}
              <button
                onClick={startPrediction}
                disabled={!school.trim() || !major.trim()}
                style={{
                  width: "100%", padding: "14px 0",
                  background: (!school.trim() || !major.trim()) ? "#CCC" : "#000",
                  color: "#fff", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 600,
                  letterSpacing: 1, cursor: (!school.trim() || !major.trim()) ? "not-allowed" : "pointer",
                  fontFamily: "inherit", transition: "background .2s",
                }}
                onMouseEnter={e => { if (school.trim() && major.trim()) e.currentTarget.style.background = "#FF4500"; }}
                onMouseLeave={e => { if (school.trim() && major.trim()) e.currentTarget.style.background = "#000"; }}
              >
                开始长期受益预测 →
              </button>
            </div>
          </div>
        )}

        {/* ══ PROCESSING (step1 – step5) ════════════════════════ */}
        {(stage === "step1" || stage === "step2" || stage === "step3" || stage === "step4" || stage === "step5") && (
          <div style={{ width: "100%", display: "flex", overflow: "hidden" }}>

            {/* Left panel — status + agents */}
            <div style={{ width: 300, borderRight: "1px solid #E5E5E5", display: "flex", flexDirection: "column", flexShrink: 0, background: "#fff" }}>
              {/* Progress */}
              <div style={{ padding: "24px 20px 20px", borderBottom: "1px solid #F0F0F0" }}>
                <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, marginBottom: 8 }}>
                  STEP {currentStepIdx + 1}/5 · {STEP_LABELS[currentStepIdx]}
                </div>
                <div style={{ fontSize: 12, color: "#000", marginBottom: 12, lineHeight: 1.5 }}>{statusMsg}</div>
                <div style={{ background: "#F0F0F0", borderRadius: 2, height: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", background: "#FF4500", width: `${progress}%`, transition: "width .5s ease", borderRadius: 2 }} />
                </div>
                <div style={{ fontSize: 9, color: "#999", marginTop: 4, textAlign: "right" }}>{progress}%</div>
              </div>

              {/* Step 4: run status */}
              {stage === "step4" && runStatus && (
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #F0F0F0" }}>
                  <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, marginBottom: 8 }}>SIM STATUS</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      { label: "ROUND", value: `${runStatus.current_round}/${runStatus.total_rounds}` },
                      { label: "STATUS", value: runStatus.status?.toUpperCase() || "—" },
                    ].map(({ label: l, value }) => (
                      <div key={l}>
                        <div style={{ fontSize: 8, color: "#999", letterSpacing: 2 }}>{l}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#000" }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Agent personas */}
              {profiles.length > 0 && (
                <div style={{ flex: 1, overflowY: "auto", padding: "16px 0" }}>
                  <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, padding: "0 20px", marginBottom: 8 }}>
                    AGENTS ({profiles.length})
                  </div>
                  {profiles.map((p, i) => (
                    <div key={i} style={{ padding: "8px 20px", borderBottom: "1px solid #F5F5F5" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#000" }}>
                        {p.name || p.username || `Agent ${i + 1}`}
                      </div>
                      {p.persona && (
                        <div style={{ fontSize: 10, color: "#666", marginTop: 2, lineHeight: 1.5 }}>
                          {p.persona.slice(0, 60)}{p.persona.length > 60 ? "…" : ""}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {profiles.length === 0 && (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#CCC", letterSpacing: 2 }}>GENERATING</div>
                    <div style={{ fontSize: 10, color: "#CCC", letterSpacing: 2 }}>AGENTS…</div>
                  </div>
                </div>
              )}
            </div>

            {/* Right panel — actions feed / report */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

              {/* Step 4: actions */}
              {stage === "step4" && (
                <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
                  <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, marginBottom: 12 }}>
                    AGENT ACTIVITY FEED
                  </div>
                  {actions.length === 0 && (
                    <div style={{ fontSize: 11, color: "#CCC", padding: "40px 0", textAlign: "center" }}>
                      Waiting for agents to act…
                    </div>
                  )}
                  {actions.map((a) => {
                    const style = getActionStyle(a.action_type);
                    return (
                      <div key={a._uniqueId} style={{ display: "flex", gap: 12, marginBottom: 8, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 6px", borderRadius: 2, background: style.bg, color: style.color, whiteSpace: "nowrap", flexShrink: 0, marginTop: 2 }}>
                          {style.label}
                        </span>
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#000" }}>{a.agent_name}</span>
                          {a.action_args?.title && (
                            <span style={{ fontSize: 10, color: "#666", marginLeft: 8 }}>
                              {String(a.action_args.title).slice(0, 60)}
                            </span>
                          )}
                          {a.action_args?.content && !a.action_args?.title && (
                            <span style={{ fontSize: 10, color: "#666", marginLeft: 8 }}>
                              {String(a.action_args.content).slice(0, 80)}
                            </span>
                          )}
                          <div style={{ fontSize: 9, color: "#CCC", marginTop: 2 }}>
                            R{a.round_num} · {a.timestamp?.slice(11, 16)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={actionsEndRef} />
                </div>
              )}

              {/* Steps 1-3 + 5: status display */}
              {(stage === "step1" || stage === "step2" || stage === "step3" || stage === "step5") && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

                  {/* Report sections streaming in */}
                  {stage === "step5" && reportSections.length > 0 && (
                    <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
                      <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, marginBottom: 16 }}>REPORT — GENERATING…</div>
                      {reportSections.map((sec) => (
                        <div key={sec.section_index} style={{ marginBottom: 24, background: "#fff", border: "1px solid #E5E5E5", borderRadius: 6, padding: "20px" }}>
                          <div dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(sec.content) }} />
                        </div>
                      ))}
                    </div>
                  )}

                  {(stage === "step5" && reportSections.length === 0) || stage !== "step5" ? (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
                      <div style={{ width: 40, height: 40, border: "2px solid #F0F0F0", borderTop: "2px solid #FF4500", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                      <div style={{ fontSize: 11, color: "#999" }}>{statusMsg || "Processing…"}</div>
                    </div>
                  ) : null}

                  {/* Agent log */}
                  {agentLogs.length > 0 && (
                    <div style={{ height: 160, borderTop: "1px solid #E5E5E5", overflowY: "auto", padding: "12px 20px" }}>
                      <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, marginBottom: 8 }}>REPORT AGENT LOG</div>
                      {agentLogs.map((log, i) => (
                        <div key={i} style={{ fontSize: 10, color: "#666", marginBottom: 4, lineHeight: 1.5 }}>
                          <span style={{ color: "#999" }}>[{log.elapsed_seconds?.toFixed(1)}s]</span>{" "}
                          <span style={{ color: "#FF4500" }}>{log.action}</span>{" "}
                          {log.section_title && <span>— {log.section_title}</span>}
                        </div>
                      ))}
                      <div ref={logsEndRef} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ DONE ═════════════════════════════════════════════ */}
        {stage === "done" && (
          <div style={{ width: "100%", display: "flex", overflow: "hidden" }}>

            {/* Left: agent list */}
            <div style={{ width: 280, borderRight: "1px solid #E5E5E5", overflowY: "auto", background: "#fff", flexShrink: 0 }}>
              <div style={{ padding: "20px", borderBottom: "1px solid #F0F0F0" }}>
                <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, marginBottom: 4 }}>AGENTS ({profiles.length})</div>
                <div style={{ fontSize: 9, color: "#00C853", letterSpacing: 1 }}>SIMULATION COMPLETE</div>
              </div>
              {profiles.map((p, i) => (
                <div key={i} style={{ padding: "10px 20px", borderBottom: "1px solid #F5F5F5" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#000" }}>
                    {p.name || p.username || `Agent ${i + 1}`}
                  </div>
                  {p.profession && <div style={{ fontSize: 9, color: "#999", marginTop: 1 }}>{p.profession}</div>}
                </div>
              ))}
            </div>

            {/* Right: report */}
            <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px", background: "#FAFAFA" }}>
              {/* Report header */}
              <div style={{ marginBottom: 32 }}>
                <div style={{ fontSize: 9, color: "#999", letterSpacing: 3, marginBottom: 8 }}>
                  AI 群体智能 · 长期受益预测报告
                </div>
                <h1 style={{ fontSize: 24, fontWeight: 700, color: "#000", marginBottom: 8, fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
                  {school} · {major}
                </h1>
                <div style={{ fontSize: 13, color: "#666" }}>
                  {province} 物理类 位次 #{rank.toLocaleString()} · 模拟时间点：2031年
                </div>
              </div>

              {/* Section nav */}
              {reportSections.length > 1 && (
                <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
                  {reportSections.map((sec) => {
                    const firstLine = sec.content.split("\n")[0].replace(/^#+\s*/, "").slice(0, 20);
                    return (
                      <button
                        key={sec.section_index}
                        onClick={() => document.getElementById(`sec-${sec.section_index}`)?.scrollIntoView({ behavior: "smooth" })}
                        style={{ fontSize: 10, padding: "4px 10px", borderRadius: 3, border: "1px solid #E5E5E5", background: "#fff", cursor: "pointer", color: "#666" }}
                      >
                        §{sec.section_index + 1} {firstLine}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Sections */}
              {reportSections.map((sec) => {
                const isCollapsed = collapsedSections.has(sec.section_index);
                const firstLine = sec.content.split("\n")[0].replace(/^#+\s*/, "");
                return (
                  <div
                    key={sec.section_index}
                    id={`sec-${sec.section_index}`}
                    style={{ marginBottom: 24, background: "#fff", border: "1px solid #E5E5E5", borderRadius: 6, overflow: "hidden" }}
                  >
                    <div
                      onClick={() => setCollapsedSections(prev => {
                        const next = new Set(prev);
                        if (next.has(sec.section_index)) next.delete(sec.section_index);
                        else next.add(sec.section_index);
                        return next;
                      })}
                      style={{ padding: "12px 20px", borderBottom: isCollapsed ? "none" : "1px solid #F0F0F0", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#FAFAFA" }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#000" }}>
                        §{sec.section_index + 1} {firstLine.slice(0, 50)}
                      </span>
                      <span style={{ fontSize: 10, color: "#999" }}>{isCollapsed ? "▸" : "▾"}</span>
                    </div>
                    {!isCollapsed && (
                      <div style={{ padding: "20px 24px", lineHeight: 1.8, fontSize: 13, color: "#333" }}>
                        <div dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(sec.content) }} />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Footer */}
              <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
                <Link
                  href={`/results?province=${encodeURIComponent(province)}&rank=${rank}`}
                  style={{ padding: "10px 20px", background: "#000", color: "#fff", borderRadius: 4, fontSize: 12, fontWeight: 700, textDecoration: "none", letterSpacing: 1 }}
                >
                  ← 返回志愿报告
                </Link>
                <button
                  onClick={() => window.print()}
                  style={{ padding: "10px 20px", background: "#F5F5F5", color: "#000", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: "pointer", letterSpacing: 1 }}
                >
                  打印报告
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══ ERROR ════════════════════════════════════════════ */}
        {stage === "error" && (
          <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
            <div style={{ maxWidth: 480, padding: "60px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#FF0000", letterSpacing: 3, marginBottom: 16 }}>SIMULATION ERROR</div>
              <div style={{ fontSize: 14, color: "#333", marginBottom: 32, lineHeight: 1.7 }}>{errorMsg}</div>
              <button
                onClick={() => { setStage("landing"); setErrorMsg(""); setProgress(0); setStatusMsg(""); }}
                style={{ padding: "10px 24px", background: "#000", color: "#fff", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
              >
                重试
              </button>
            </div>
          </div>
        )}

      </main>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes spin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
}

export default function CareerPredictPage() {
  return (
    <Suspense fallback={
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "monospace" }}>
        <div>Loading…</div>
      </div>
    }>
      <CareerPredictContent />
    </Suspense>
  );
}
