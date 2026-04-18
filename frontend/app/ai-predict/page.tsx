"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  MIROFISH_BASE,
  uploadAndGenerateOntology,
  buildKnowledgeGraph,
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

// ─── 场景文档模板 ─────────────────────────────────────────────────────

function buildScenarioText(province: string, rank: number, subject: string) {
  const label = subject.includes("历史") ? "历史类" : "物理类";
  return `# 2026 Gaokao Volunteer Filing Competition Analysis — ${province} ${label} Rank ${rank}

## Simulation Target
Province: ${province} | Subject: ${label} | Rank: ${rank}
Analyze the 2026 gaokao volunteer filing competition dynamics through multi-agent simulation.

## Agent Population Structure

### High-Aspiration Students (Rank ${Math.max(1000, rank - 15000)} ~ ${rank - 5000})
- Target: Top 985/211 universities
- Behavior: Data-driven, willing to gamble on off-year patterns
- Effect: Raise admission lines for competitive schools

### Core Competition Group (Rank ${rank - 5000} ~ ${rank + 5000})
- Target: Mainstream 211 universities, niche 985 majors
- Behavior: Follow peer choices, reference historical data
- Effect: Directly determine admission line movements

### Conservative Students (Rank ${rank + 5000} ~ ${rank + 15000})
- Target: Stable tier-1 universities
- Behavior: Risk-averse, prefer well-known school names over actual quality
- Effect: Pile into popular schools, miss hidden opportunities

### Arbitrage Seekers (Scattered across all ranks)
- Target: Undervalued high-quality universities
- Behavior: Exploit big-year/small-year patterns and city discount effects
- Effect: Main volatility factor for cold/niche universities

## Key Variables (2026)
- AI/CS major demand continues surging (admission rank rising yearly)
- City discount: Harbin, Lanzhou, Urumqi schools 150-400 ranks lower than equivalent quality
- Big-year/small-year cycles: some schools show 2-3 year alternating patterns
- Enrollment plan changes: some Double First-Class schools expanding specific majors
`;
}

function buildSimReq(province: string, rank: number, subject: string) {
  const label = subject.includes("历史") ? "历史类" : "物理类";
  return `Simulate the 2026 gaokao volunteer filing competition in ${province} for ${label} students at rank ${rank}. Through multi-agent group dynamics, predict: (1) which universities will be big-year (harder to enter) or small-year (easier to enter) in 2026; (2) which universities are still in undervalued "cold window" periods worth targeting; (3) how conservative vs. risk-seeking student groups interact to shape the final admission landscape. Output: big-year/small-year warning table, cold opportunity analysis, strategic recommendations.`;
}

// ─── Markdown 渲染（极简，MiroFish 风格） ────────────────────────────

function renderSimpleMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h4 style="font-size:13px;font-weight:700;margin:16px 0 6px;color:#000">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="font-size:15px;font-weight:700;margin:20px 0 8px;color:#000;border-bottom:1px solid #E5E5E5;padding-bottom:6px">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 style="font-size:18px;font-weight:700;margin:0 0 16px;color:#000">$1</h2>')
    .replace(/^\* (.+)$/gm, '<div style="display:flex;gap:8px;margin:4px 0;padding-left:4px"><span style="color:#FF4500;flex-shrink:0;margin-top:2px">▸</span><span>$1</span></div>')
    .replace(/^- (.+)$/gm, '<div style="display:flex;gap:8px;margin:4px 0;padding-left:4px"><span style="color:#FF4500;flex-shrink:0;margin-top:2px">▸</span><span>$1</span></div>')
    .replace(/^\d+\. (.+)$/gm, '<div style="margin:4px 0 4px 12px">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #E5E5E5;margin:12px 0"/>')
    .replace(/\n\n/g, '<br/>')
    .replace(/^(?!<[h2-4|d]|<br)(.+)$/gm, '<p style="margin:4px 0;line-height:1.7">$1</p>');
}

// ─── Action badge colors ──────────────────────────────────────────────

const ACTION_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  CREATE_POST:    { bg: "#0057FF", color: "#fff", label: "POST" },
  CREATE_COMMENT: { bg: "#FF4500", color: "#fff", label: "COMMENT" },
  LIKE_POST:      { bg: "#E00", color: "#fff", label: "LIKE" },
  REPOST:         { bg: "#008844", color: "#fff", label: "REPOST" },
  QUOTE_POST:     { bg: "#6600CC", color: "#fff", label: "QUOTE" },
  FOLLOW:         { bg: "#888", color: "#fff", label: "FOLLOW" },
  UPVOTE_POST:    { bg: "#FF6600", color: "#fff", label: "UPVOTE" },
  DOWNVOTE_POST:  { bg: "#333", color: "#fff", label: "DOWNVOTE" },
  SEARCH_POSTS:   { bg: "#00AACC", color: "#fff", label: "SEARCH" },
  DO_NOTHING:     { bg: "#CCC", color: "#666", label: "IDLE" },
};

function getActionStyle(type: string) {
  return ACTION_STYLES[type] || { bg: "#999", color: "#fff", label: type.replace(/_/g, " ") };
}

// ─── SVG icons ────────────────────────────────────────────────────────

const IconGlobe = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);
const IconChat = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
  </svg>
);
const IconCheck = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IconArrow = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
  </svg>
);

// ─── 主页面内容 ───────────────────────────────────────────────────────

type Stage = "landing" | "step1" | "step2" | "step3" | "step4" | "step5" | "done" | "error";

const STEP_LABELS = [
  "Ontology Parse",
  "Graph Build",
  "Agent Personas",
  "Simulation Run",
  "Report Generate",
];

function AIPredictContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const province = searchParams.get("province") || "广东";
  const rank = parseInt(searchParams.get("rank") || "30000", 10);
  const subject = searchParams.get("subject") || "物理";
  const label = subject.includes("历史") ? "历史类" : "物理类";

  // ── Stage & Progress ──
  const [stage, setStage] = useState<Stage>("landing");
  const [statusMsg, setStatusMsg] = useState("");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  // ── IDs ──
  const [projectId, setProjectId] = useState("");
  const [graphId, setGraphId] = useState("");
  const [simulationId, setSimulationId] = useState("");
  const [reportId, setReportId] = useState("");

  // ── Agent personas ──
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [expectedTotal, setExpectedTotal] = useState(0);

  // ── Simulation state ──
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [actions, setActions] = useState<AgentAction[]>([]);
  const actionsEndRef = useRef<HTMLDivElement>(null);

  // ── Report state ──
  const [reportSections, setReportSections] = useState<ReportSection[]>([]);
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());
  const [logLine, setLogLine] = useState(0);
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

  // Auto-scroll actions
  useEffect(() => {
    actionsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [actions.length]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentLogs.length]);

  // Report: poll sections + logs
  useEffect(() => {
    if (stage !== "step5" && stage !== "done") return;
    if (!reportId) return;
    const interval = setInterval(async () => {
      try {
        const { sections, isComplete } = await getReportSections(reportId);
        setReportSections(sections);
        // poll logs
        const newLogs = await getAgentLog(reportId, logLine);
        if (newLogs.length > 0) {
          setAgentLogs((prev) => [...prev, ...newLogs]);
          setLogLine((l) => l + newLogs.length);
        }
        if (isComplete && stage === "step5") setStage("done");
      } catch {}
    }, 2500);
    return () => clearInterval(interval);
  }, [stage, reportId, logLine]);

  // ── Main Flow ──
  async function startPrediction() {
    const maxRounds = 20;
    const scenarioText = buildScenarioText(province, rank, subject);
    const simReq = buildSimReq(province, rank, subject);
    const projectName = `高报AI-${province}-${label}-${rank}-${Date.now()}`;

    try {
      // Step 1
      setStage("step1"); setProgress(0); setStatusMsg("Uploading scenario data...");
      const pid = await uploadAndGenerateOntology(scenarioText, simReq, projectName, (msg) => {
        setStatusMsg(msg); setProgress(60);
      });
      setProjectId(pid); setProgress(100);

      // Step 2
      setStage("step2"); setProgress(0); setStatusMsg("Initializing graph construction...");
      const gid = await buildKnowledgeGraph(pid, (msg, pct) => {
        setStatusMsg(msg); setProgress(pct);
      });
      setGraphId(gid);

      // Step 3
      setStage("step3"); setProgress(0); setStatusMsg("Creating simulation instance...");
      const sid = await createAndPrepareSimulation(pid, gid, (msg, pct, profs) => {
        setStatusMsg(msg); setProgress(pct);
        if (profs && profs.length > 0) setProfiles(profs);
      });
      setSimulationId(sid);

      // Step 4
      setStage("step4"); setProgress(0);
      await runSimulation(sid, maxRounds, (status, newActions) => {
        setRunStatus(status);
        setActions(newActions);
        setProgress(Math.round(((status.current_round || 0) / maxRounds) * 100));
      });

      // Step 5
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

  // ════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#FAFAFA", fontFamily: "ui-monospace,'Menlo','Monaco','Cascadia Code',monospace", overflow: "hidden" }}>

      {/* ── Header ───────────────────────────────────────── */}
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
          <span style={{ color: "#fff", fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>高报 AI</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {STEP_LABELS.map((label, i) => {
            const done = currentStepIdx > i;
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
                  {active && <span style={{ fontSize: 9, color: "#000", letterSpacing: 0.5 }}>{label}</span>}
                  {done && <IconCheck />}
                </div>
                {i < STEP_LABELS.length - 1 && (
                  <div style={{ width: 12, height: 1, background: done ? "#FF4500" : "#333" }} />
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, color: "#555", letterSpacing: 1 }}>
            {province} · {label} · #{rank.toLocaleString()}
          </span>
          <div style={{ width: 1, height: 16, background: "#333" }} />
          {stage === "landing" && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#555" }} />
              <span style={{ fontSize: 9, color: "#555", letterSpacing: 1 }}>IDLE</span>
            </div>
          )}
          {(stage !== "landing" && stage !== "done" && stage !== "error") && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF4500", animation: "pulse 1.5s infinite" }} />
              <span style={{ fontSize: 9, color: "#FF4500", letterSpacing: 1 }}>RUNNING · {formatTime(elapsedSec)}</span>
            </div>
          )}
          {stage === "done" && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00C853" }} />
              <span style={{ fontSize: 9, color: "#00C853", letterSpacing: 1 }}>COMPLETED</span>
            </div>
          )}
          {stage === "error" && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF0000" }} />
              <span style={{ fontSize: 9, color: "#FF0000", letterSpacing: 1 }}>ERROR</span>
            </div>
          )}
        </div>
      </header>

      {/* ── Body ─────────────────────────────────────────── */}
      <main style={{ flex: 1, overflow: "hidden", display: "flex" }}>

        {/* ══ LANDING ══════════════════════════════════════ */}
        {stage === "landing" && (
          <div style={{ width: "100%", overflowY: "auto", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
            <div style={{ maxWidth: 560, width: "100%", padding: "60px 24px" }}>
              {/* Hero */}
              <div style={{ marginBottom: 48 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 3, color: "#999", marginBottom: 16 }}>HIGH-SCORE REPORT · AI PREDICTION ENGINE</div>
                <h1 style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.2, color: "#000", marginBottom: 16, fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
                  Group Intelligence<br />
                  <span style={{ color: "#FF4500" }}>Predicts Anything.</span>
                </h1>
                <p style={{ fontSize: 14, color: "#666", lineHeight: 1.8 }}>
                  Simulating thousands of student agents making real filing decisions — big-year/small-year warnings, cold school windows, competitive dynamics.
                </p>
              </div>

              {/* Input card */}
              <div style={{ background: "#F5F5F5", borderRadius: 6, padding: 24, marginBottom: 24 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#999", marginBottom: 16 }}>SIMULATION TARGET</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
                  {[
                    { label: "PROVINCE", value: province },
                    { label: "RANK", value: `#${rank.toLocaleString()}` },
                    { label: "SUBJECT", value: label },
                  ].map(({ label: l, value }) => (
                    <div key={l}>
                      <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, marginBottom: 4 }}>{l}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#000" }}>{value}</div>
                    </div>
                  ))}
                </div>

                <div style={{ borderTop: "1px solid #E5E5E5", paddingTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  {[
                    { label: "AGENTS", value: "~30" },
                    { label: "MAX ROUNDS", value: "20" },
                    { label: "EST. TIME", value: "10-20 min" },
                  ].map(({ label: l, value }) => (
                    <div key={l}>
                      <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, marginBottom: 2 }}>{l}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#000" }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* What it predicts */}
              <div style={{ border: "1px solid #E5E5E5", borderRadius: 6, marginBottom: 32 }}>
                {[
                  { tag: "BIG/SMALL YEAR", desc: "Which schools will have unusually high or low admission lines in 2026" },
                  { tag: "COLD WINDOW", desc: "Undervalued high-quality schools still in the arbitrage window" },
                  { tag: "GROUP DYNAMICS", desc: "How conservative vs. risk-seeking students reshape the competitive landscape" },
                ].map(({ tag, desc }, i) => (
                  <div key={tag} style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "14px 20px", borderBottom: i < 2 ? "1px solid #E5E5E5" : "none" }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: "#FF4500", whiteSpace: "nowrap", marginTop: 2 }}>{tag}</span>
                    <span style={{ fontSize: 12, color: "#666", lineHeight: 1.6 }}>{desc}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={startPrediction}
                style={{ width: "100%", padding: "14px 0", background: "#000", color: "#fff", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 700, letterSpacing: 2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "inherit", transition: "background .2s" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#FF4500")}
                onMouseLeave={e => (e.currentTarget.style.background = "#000")}
              >
                START SIMULATION <IconArrow />
              </button>
            </div>
          </div>
        )}

        {/* ══ STEP 1: Ontology Parse ══════════════════════ */}
        {stage === "step1" && (
          <div style={{ width: "100%", overflowY: "auto", padding: "32px 24px" }}>
            <StepCard num="01" title="Ontology Generation" status="active" note="POST /api/graph/ontology/generate">
              <InfoRows rows={[
                { label: "SCENARIO", value: `${province} · ${label} · Rank ${rank}` },
                { label: "STATUS", value: statusMsg },
              ]} />
              <ProgressBar pct={progress} />
            </StepCard>
          </div>
        )}

        {/* ══ STEP 2: Graph Build ═════════════════════════ */}
        {stage === "step2" && (
          <div style={{ width: "100%", overflowY: "auto", padding: "32px 24px" }}>
            <StepCard num="01" title="Ontology Generation" status="completed">
              <InfoRows rows={[{ label: "PROJECT ID", value: projectId }]} />
            </StepCard>
            <StepCard num="02" title="Knowledge Graph Build" status="active" note="POST /api/graph/build">
              <InfoRows rows={[{ label: "STATUS", value: statusMsg }]} />
              <ProgressBar pct={progress} />
            </StepCard>
          </div>
        )}

        {/* ══ STEP 3: Agent Personas ══════════════════════ */}
        {stage === "step3" && (
          <div style={{ width: "100%", display: "flex", overflow: "hidden" }}>
            {/* Left: Steps */}
            <div style={{ width: 340, flexShrink: 0, borderRight: "1px solid #E5E5E5", overflowY: "auto", padding: "24px 20px" }}>
              <StepCard num="01" title="Ontology Generation" status="completed">
                <InfoRows rows={[{ label: "PROJECT ID", value: projectId }]} />
              </StepCard>
              <StepCard num="02" title="Knowledge Graph Build" status="completed">
                <InfoRows rows={[{ label: "GRAPH ID", value: graphId }]} />
              </StepCard>
              <StepCard num="03" title="Generate Agent Personas" status="active" note="POST /api/simulation/prepare">
                <StatsGrid items={[
                  { label: "CURRENT", value: String(profiles.length) },
                  { label: "EXPECTED", value: expectedTotal ? String(expectedTotal) : "—" },
                  { label: "TOPICS", value: String(profiles.reduce((s, p) => s + (p.interested_topics?.length || 0), 0)) },
                ]} />
                <ProgressBar pct={progress} />
                <div style={{ marginTop: 6, fontSize: 10, color: "#999" }}>{statusMsg}</div>
              </StepCard>
            </div>

            {/* Right: Profiles */}
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#999", marginBottom: 16 }}>
                GENERATED AGENT PERSONAS — {profiles.length} AGENTS
              </div>
              {profiles.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#999", fontSize: 12 }}>
                  <Spinner size={14} />
                  <span>Waiting for first persona...</span>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                  {profiles.map((p, i) => <ProfileCard key={i} profile={p} idx={i} />)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ STEP 4: Simulation Run ══════════════════════ */}
        {stage === "step4" && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Platform Status Bar */}
            <div style={{ background: "#fff", borderBottom: "1px solid #E5E5E5", padding: "12px 20px", display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
              <PlatformCard
                icon={<IconChat />}
                name="考生社区"
                round={runStatus?.current_round || 0}
                total={20}
                actions={actions.length}
                running={!!runStatus && runStatus.status === "running"}
                completed={runStatus?.status === "completed"}
              />
              <div style={{ flex: 1, fontSize: 11, color: "#666" }}>
                <span style={{ fontWeight: 700, color: "#000" }}>TOTAL EVENTS: </span>
                <span style={{ fontFamily: "monospace" }}>{actions.length}</span>
              </div>
              <div style={{ fontSize: 9, color: "#999", letterSpacing: 1 }}>
                ROUND {runStatus?.current_round || 0}/{20} · {formatTime(elapsedSec)}
              </div>
            </div>

            {/* Timeline Feed */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 20px" }} ref={null}>
              <div style={{ position: "relative", paddingLeft: 28 }}>
                {/* Axis */}
                <div style={{ position: "absolute", left: 8, top: 0, bottom: 0, width: 1, background: "#E5E5E5" }} />

                {actions.length === 0 ? (
                  <div style={{ padding: "40px 0", display: "flex", alignItems: "center", gap: 10, color: "#999", fontSize: 12 }}>
                    <Spinner size={14} />
                    <span>Waiting for agent actions...</span>
                  </div>
                ) : (
                  actions.map((action, i) => (
                    <ActionCard key={action._uniqueId || i} action={action} />
                  ))
                )}
                <div ref={actionsEndRef} />
              </div>
            </div>

            {/* System Log */}
            <div style={{ height: 52, background: "#000", borderTop: "1px solid #222", display: "flex", alignItems: "center", gap: 16, padding: "0 20px", flexShrink: 0 }}>
              <span style={{ fontSize: 9, color: "#FF4500", fontWeight: 700, letterSpacing: 2 }}>SIM MONITOR</span>
              <span style={{ fontSize: 9, color: "#555", fontFamily: "monospace" }}>{simulationId || "—"}</span>
              <span style={{ fontSize: 9, color: "#555", marginLeft: "auto" }}>{statusMsg}</span>
            </div>
          </div>
        )}

        {/* ══ STEP 5 / DONE: Report ═══════════════════════ */}
        {(stage === "step5" || stage === "done") && (
          <div style={{ width: "100%", display: "flex", overflow: "hidden" }}>

            {/* Left: Report content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "32px 32px 40px" }}>
              {/* Report header */}
              <div style={{ marginBottom: 32 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: "#FF4500", background: "rgba(255,69,0,.08)", padding: "3px 8px", borderRadius: 3 }}>PREDICTION REPORT</span>
                  <span style={{ fontSize: 9, color: "#999", fontFamily: "monospace" }}>ID: {reportId || "PENDING"}</span>
                </div>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: "#000", margin: "0 0 8px", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
                  {province} · {label} · #{rank.toLocaleString()}
                </h1>
                <p style={{ fontSize: 12, color: "#666" }}>
                  Group intelligence simulation · 20 rounds · ~30 agents · Powered by MiroFish + DeepSeek
                </p>
                <div style={{ height: 1, background: "#E5E5E5", marginTop: 20 }} />
              </div>

              {/* Sections */}
              {reportSections.length === 0 && stage === "step5" && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#999", fontSize: 12, padding: "20px 0" }}>
                  <Spinner size={14} />
                  <span>Waiting for Report Agent...</span>
                </div>
              )}
              {reportSections.map((sec, idx) => (
                <ReportSectionBlock
                  key={idx}
                  idx={idx}
                  section={sec}
                  collapsed={collapsedSections.has(idx)}
                  onToggle={() => setCollapsedSections((s) => {
                    const n = new Set(s);
                    n.has(idx) ? n.delete(idx) : n.add(idx);
                    return n;
                  })}
                />
              ))}

              {/* Done actions */}
              {stage === "done" && (
                <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
                  <Link
                    href={`/results?province=${encodeURIComponent(province)}&rank=${rank}&subject=${encodeURIComponent(subject)}`}
                    style={{ padding: "10px 20px", background: "#000", color: "#fff", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: 1, textDecoration: "none", display: "flex", alignItems: "center", gap: 8 }}
                  >
                    VIEW VOLUNTEER REPORT <IconArrow />
                  </Link>
                  <button
                    onClick={() => { setStage("landing"); setReportSections([]); setActions([]); setProfiles([]); setAgentLogs([]); }}
                    style={{ padding: "10px 20px", background: "transparent", color: "#666", border: "1px solid #E5E5E5", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    RUN AGAIN
                  </button>
                </div>
              )}
            </div>

            {/* Right: Workflow Timeline */}
            <div style={{ width: 300, flexShrink: 0, borderLeft: "1px solid #E5E5E5", overflowY: "auto", padding: "20px 16px" }}>
              {/* Metrics */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                {[
                  { label: "SECTIONS", value: `${reportSections.length}` },
                  { label: "ELAPSED", value: formatTime(elapsedSec) },
                  { label: "TOOL CALLS", value: String(agentLogs.filter(l => l.action === "tool_call").length) },
                  { label: "STATUS", value: stage === "done" ? "DONE" : "GEN...", color: stage === "done" ? "#00C853" : "#FF4500" },
                ].map(({ label: l, value, color }) => (
                  <div key={l} style={{ background: "#F5F5F5", borderRadius: 4, padding: "10px 12px" }}>
                    <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, marginBottom: 4 }}>{l}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: color || "#000", fontFamily: "monospace" }}>{value}</div>
                  </div>
                ))}
              </div>

              <div style={{ height: 1, background: "#E5E5E5", marginBottom: 16 }} />

              {/* Agent log timeline */}
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: "#999", marginBottom: 12 }}>AGENT LOG</div>
              <div style={{ position: "relative" }}>
                <div style={{ position: "absolute", left: 7, top: 0, bottom: 0, width: 1, background: "#E5E5E5" }} />
                {agentLogs.map((log, i) => (
                  <LogItem key={i} log={log} />
                ))}
                {agentLogs.length === 0 && (
                  <div style={{ paddingLeft: 20, fontSize: 11, color: "#999", display: "flex", alignItems: "center", gap: 8 }}>
                    <Spinner size={12} /> Waiting...
                  </div>
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* ══ ERROR ════════════════════════════════════════ */}
        {stage === "error" && (
          <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ maxWidth: 400, padding: "0 24px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#FF0000", letterSpacing: 3, marginBottom: 12 }}>SIMULATION ERROR</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#000", marginBottom: 12 }}>{errorMsg}</div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <button
                  onClick={() => { setStage("landing"); setErrorMsg(""); }}
                  style={{ padding: "10px 20px", background: "#000", color: "#fff", border: "none", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" }}
                >
                  RESTART
                </button>
                <button
                  onClick={() => router.back()}
                  style={{ padding: "10px 20px", background: "transparent", color: "#666", border: "1px solid #E5E5E5", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" }}
                >
                  GO BACK
                </button>
              </div>
            </div>
          </div>
        )}

      </main>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeInUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function StepCard({ num, title, status, note, children }: {
  num: string; title: string; status: "active" | "completed" | "pending";
  note?: string; children?: React.ReactNode;
}) {
  const isCompleted = status === "completed";
  const isActive = status === "active";
  return (
    <div style={{
      border: `1px solid ${isActive ? "#000" : isCompleted ? "#E5E5E5" : "#E5E5E5"}`,
      borderRadius: 6, marginBottom: 12, overflow: "hidden",
      boxShadow: isActive ? "0 4px 12px rgba(0,0,0,.08)" : "none",
      animation: isActive ? "fadeInUp .3s ease" : "none",
    }}>
      <div style={{ background: isCompleted ? "#F5F5F5" : isActive ? "#fff" : "#fff", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: children ? "1px solid #E5E5E5" : "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: isCompleted ? "#999" : "#000" }}>{num}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: isCompleted ? "#999" : "#000" }}>{title}</span>
          {note && <span style={{ fontSize: 9, color: "#999", letterSpacing: 1 }}>{note}</span>}
        </div>
        <div>
          {isCompleted && <span style={{ fontSize: 9, color: "#00C853", background: "rgba(0,200,83,.1)", padding: "2px 8px", borderRadius: 3, fontWeight: 700, letterSpacing: 1 }}>COMPLETED</span>}
          {isActive && <span style={{ fontSize: 9, color: "#FF4500", background: "rgba(255,69,0,.1)", padding: "2px 8px", borderRadius: 3, fontWeight: 700, letterSpacing: 1 }}>PROCESSING</span>}
          {status === "pending" && <span style={{ fontSize: 9, color: "#999", background: "#F5F5F5", padding: "2px 8px", borderRadius: 3, fontWeight: 700, letterSpacing: 1 }}>PENDING</span>}
        </div>
      </div>
      {children && <div style={{ padding: "12px 16px" }}>{children}</div>}
    </div>
  );
}

function InfoRows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map(({ label, value }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 9, color: "#999", letterSpacing: 2, minWidth: 80 }}>{label}</span>
          <span style={{ fontSize: 10, color: "#000", fontFamily: "monospace", wordBreak: "break-all" }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function StatsGrid({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 8, marginBottom: 10 }}>
      {items.map(({ label, value }) => (
        <div key={label} style={{ background: "#F5F5F5", borderRadius: 4, padding: "8px 10px" }}>
          <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#000", fontFamily: "monospace" }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div style={{ height: 3, background: "#E5E5E5", borderRadius: 2, marginTop: 10, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: "#FF4500", borderRadius: 2, transition: "width .5s ease" }} />
    </div>
  );
}

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size, border: `2px solid #E5E5E5`, borderTopColor: "#000", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
  );
}

function ProfileCard({ profile, idx }: { profile: AgentProfile; idx: number }) {
  const initials = (profile.username || profile.name || `A${idx}`).slice(0, 2).toUpperCase();
  return (
    <div style={{ border: "1px solid #E5E5E5", borderRadius: 6, padding: 14, cursor: "pointer", transition: "border-color .2s, box-shadow .2s", animation: "fadeInUp .3s ease" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "#000"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,.06)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "#E5E5E5"; e.currentTarget.style.boxShadow = "none"; }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#000", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>{initials}</span>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#000" }}>{profile.username || `Agent ${idx}`}</div>
          <div style={{ fontSize: 10, color: "#999" }}>@{profile.name || `agent_${idx}`}</div>
        </div>
      </div>
      {profile.profession && (
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: "#FF4500", marginBottom: 6 }}>{profile.profession}</div>
      )}
      {profile.bio && (
        <p style={{ fontSize: 11, color: "#666", lineHeight: 1.5, margin: "0 0 8px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {profile.bio}
        </p>
      )}
      {profile.interested_topics && profile.interested_topics.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {profile.interested_topics.slice(0, 3).map((t) => (
            <span key={t} style={{ fontSize: 9, color: "#666", background: "#F5F5F5", padding: "2px 7px", borderRadius: 3 }}>{t}</span>
          ))}
          {profile.interested_topics.length > 3 && (
            <span style={{ fontSize: 9, color: "#999", padding: "2px 4px" }}>+{profile.interested_topics.length - 3}</span>
          )}
        </div>
      )}
    </div>
  );
}

function PlatformCard({ icon, name, round, total, actions, running, completed }: {
  icon: React.ReactNode; name: string; round: number; total: number;
  actions: number; running: boolean; completed: boolean;
}) {
  return (
    <div style={{ border: `1px solid ${running ? "#000" : completed ? "#00C853" : "#E5E5E5"}`, borderRadius: 6, padding: "8px 14px", minWidth: 200, background: running ? "#fff" : "#FAFAFA" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ color: running ? "#000" : "#999" }}>{icon}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: running ? "#000" : "#999", letterSpacing: 1 }}>{name}</span>
        {completed && <span style={{ color: "#00C853" }}><IconCheck /></span>}
        {running && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF4500", animation: "pulse 1.5s infinite", marginLeft: "auto" }} />}
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        {[
          { label: "ROUND", value: `${round}/${total}` },
          { label: "ACTS", value: String(actions) },
        ].map(({ label, value }) => (
          <div key={label}>
            <div style={{ fontSize: 8, color: "#999", letterSpacing: 2 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#000", fontFamily: "monospace" }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionCard({ action }: { action: AgentAction }) {
  const style = getActionStyle(action.action_type);
  const initials = (action.agent_name || "A").slice(0, 2).toUpperCase();
  return (
    <div style={{ marginBottom: 12, animation: "fadeInUp .2s ease" }}>
      {/* Dot */}
      <div style={{ position: "absolute", left: 4, top: 14, width: 8, height: 8, borderRadius: "50%", background: "#000", border: "2px solid #fff", boxShadow: "0 0 0 1px #E5E5E5" }} />
      <div style={{ border: "1px solid #E5E5E5", borderRadius: 6, background: "#fff", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #F5F5F5" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#000", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ color: "#fff", fontSize: 9, fontWeight: 700 }}>{initials}</span>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#000" }}>{action.agent_name}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconChat />
            </span>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: style.color, background: style.bg, padding: "2px 7px", borderRadius: 3 }}>
              {style.label}
            </span>
          </div>
        </div>
        {/* Body */}
        <div style={{ padding: "10px 14px" }}>
          {action.action_type === "CREATE_POST" && action.action_args?.content && (
            <p style={{ fontSize: 12, color: "#000", lineHeight: 1.6, margin: 0 }}>{action.action_args.content}</p>
          )}
          {action.action_type === "CREATE_COMMENT" && action.action_args?.content && (
            <p style={{ fontSize: 12, color: "#000", lineHeight: 1.6, margin: 0 }}>{action.action_args.content}</p>
          )}
          {action.action_type === "LIKE_POST" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#666" }}>
              <span style={{ color: "#E00" }}>♥</span>
              Liked @{action.action_args?.post_author_name || "User"}'s post
              {action.action_args?.post_content && (
                <span style={{ color: "#999" }}>"{action.action_args.post_content.slice(0, 60)}..."</span>
              )}
            </div>
          )}
          {action.action_type === "REPOST" && (
            <div style={{ fontSize: 11, color: "#666" }}>
              ↩ Reposted from @{action.action_args?.original_author_name || "User"}
              {action.action_args?.original_content && (
                <p style={{ margin: "6px 0 0", fontSize: 11, color: "#999", borderLeft: "2px solid #E5E5E5", paddingLeft: 8 }}>
                  {action.action_args.original_content.slice(0, 120)}
                </p>
              )}
            </div>
          )}
          {action.action_type === "QUOTE_POST" && (
            <div>
              {action.action_args?.quote_content && <p style={{ fontSize: 12, margin: "0 0 8px" }}>{action.action_args.quote_content}</p>}
              {action.action_args?.original_content && (
                <div style={{ border: "1px solid #E5E5E5", borderRadius: 4, padding: "8px 10px", fontSize: 11, color: "#666" }}>
                  @{action.action_args.original_author_name}: {action.action_args.original_content.slice(0, 100)}
                </div>
              )}
            </div>
          )}
          {action.action_type === "FOLLOW" && (
            <div style={{ fontSize: 11, color: "#666" }}>+ Followed @{action.action_args?.target_user || "User"}</div>
          )}
          {action.action_type === "SEARCH_POSTS" && (
            <div style={{ fontSize: 11, color: "#666" }}>🔍 Searched: "{action.action_args?.query}"</div>
          )}
          {action.action_type === "DO_NOTHING" && (
            <div style={{ fontSize: 11, color: "#CCC" }}>— Action skipped</div>
          )}
        </div>
        {/* Footer */}
        <div style={{ padding: "6px 14px", background: "#FAFAFA", borderTop: "1px solid #F5F5F5" }}>
          <span style={{ fontSize: 9, color: "#999", fontFamily: "monospace" }}>
            R{action.round_num} · {action.timestamp ? new Date(action.timestamp).toLocaleTimeString("zh-CN", { hour12: false }) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

function ReportSectionBlock({ idx, section, collapsed, onToggle }: {
  idx: number; section: ReportSection; collapsed: boolean; onToggle: () => void;
}) {
  return (
    <div style={{ border: "1px solid #E5E5E5", borderRadius: 6, marginBottom: 12, overflow: "hidden", animation: "fadeInUp .3s ease" }}>
      <div
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", cursor: "pointer", borderBottom: collapsed ? "none" : "1px solid #E5E5E5", background: "#fff" }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: "#999", minWidth: 24 }}>
          {String(idx + 1).padStart(2, "0")}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#000", flex: 1 }}>
          {section.content.split("\n")[0].replace(/^#+\s*/, "") || `Section ${idx + 1}`}
        </span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#999" strokeWidth="2" style={{ transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform .2s" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      {!collapsed && (
        <div style={{ padding: "20px 24px", background: "#fff" }}>
          <div
            style={{ fontSize: 13, lineHeight: 1.8, color: "#333" }}
            dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(section.content) }}
          />
        </div>
      )}
    </div>
  );
}

function LogItem({ log }: { log: AgentLog }) {
  const labelMap: Record<string, { text: string; color: string }> = {
    report_start:       { text: "Report Start", color: "#000" },
    planning_start:     { text: "Planning...", color: "#FF4500" },
    planning_complete:  { text: "Plan Ready", color: "#00C853" },
    section_start:      { text: "Section Start", color: "#0057FF" },
    section_content:    { text: "Content Ready", color: "#0057FF" },
    section_complete:   { text: "Section Done", color: "#00C853" },
    tool_call:          { text: "Tool Call", color: "#6600CC" },
    tool_result:        { text: "Tool Result", color: "#888" },
    llm_response:       { text: "LLM Response", color: "#888" },
    report_complete:    { text: "Complete ✓", color: "#00C853" },
  };
  const meta = labelMap[log.action] || { text: log.action, color: "#999" };
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 10, paddingLeft: 20, animation: "fadeInUp .2s ease", position: "relative" }}>
      <div style={{ position: "absolute", left: 4, top: 5, width: 7, height: 7, borderRadius: "50%", background: meta.color, border: "2px solid #fff", flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 9, fontWeight: 700, color: meta.color, letterSpacing: 1 }}>{meta.text}</div>
        {log.section_title && <div style={{ fontSize: 9, color: "#666", marginTop: 2 }}>{log.section_title}</div>}
        {log.details?.tool_name && <div style={{ fontSize: 9, color: "#999", marginTop: 2, fontFamily: "monospace" }}>{log.details.tool_name}</div>}
        <div style={{ fontSize: 8, color: "#CCC", marginTop: 2, fontFamily: "monospace" }}>+{log.elapsed_seconds?.toFixed(1)}s</div>
      </div>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────

export default function AIPredictPage() {
  return (
    <Suspense fallback={
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
        <div style={{ width: 20, height: 20, border: "2px solid #E5E5E5", borderTopColor: "#000", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      </div>
    }>
      <AIPredictContent />
    </Suspense>
  );
}
