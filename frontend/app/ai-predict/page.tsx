"use client";

import { useEffect, useState, useRef, Suspense } from "react";
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

// ─── 场景文档模板（中文）────────────────────────────────────────────────────

function buildScenarioText(province: string, rank: number, subject: string) {
  const label = subject.includes("历史") ? "历史类" : "物理类";
  return `# 2026年高考志愿填报博弈分析 — ${province} ${label} 位次 ${rank}

## 模拟目标
省份：${province} | 科类：${label} | 位次：${rank}
通过多智能体群体动力学，分析2026年高考志愿填报竞争态势。

## 考生群体结构

### 高分 aspirational 考生（位次 ${Math.max(1000, rank - 15000)} ~ ${rank - 5000}）
- 目标：顶尖985/211高校
- 行为特征：数据驱动，愿意博弈小年规律
- 影响：推高热门校录取线

### 核心竞争群（位次 ${rank - 5000} ~ ${rank + 5000}）
- 目标：主流211高校、冷门985专业
- 行为特征：跟随同龄选择，参考历年数据
- 影响：直接决定录取线波动

### 保守型考生（位次 ${rank + 5000} ~ ${rank + 15000}）
- 目标：稳妥一本院校
- 行为特征：风险厌恶，偏好知名校名而非实际质量
- 影响：扎堆热门校，错失冷门机会

### 套利型考生（分散在各段位）
- 目标：被低估的高质量院校
- 行为特征：利用大年/小年周期和城市折价效应
- 影响：冷门高价值院校的主要波动来源

## 2026年关键变量
- AI/CS类专业需求持续飙升（录取位次逐年上涨）
- 城市折价：哈尔滨、兰州、乌鲁木齐等校同等质量下位次低150~400名
- 大年/小年周期：部分院校呈现2~3年交替波动
- 扩招信号：部分双一流院校在特定专业上扩招
`;
}

function buildSimReq(province: string, rank: number, subject: string) {
  const label = subject.includes("历史") ? "历史类" : "物理类";
  return `模拟2026年${province}${label}位次${rank}考生的高考志愿填报竞争。通过多智能体群体动力学，预测：(1) 哪些院校2026年将出现大年（更难进）或小年（更容易进）；(2) 哪些院校仍处于被低估的"冷门窗口期"，值得报考；(3) 保守型与风险偏好型考生群体如何互动，塑造最终录取格局。输出：大年/小年预警表、冷门机会分析、策略建议。`;
}

// ─── Markdown 渲染（极简）───────────────────────────────────────────

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
  CREATE_POST:    { bg: "#0057FF", color: "#fff", label: "发帖" },
  CREATE_COMMENT: { bg: "#FF4500", color: "#fff", label: "评论" },
  LIKE_POST:      { bg: "#E00", color: "#fff", label: "点赞" },
  REPOST:         { bg: "#008844", color: "#fff", label: "转发" },
  QUOTE_POST:     { bg: "#6600CC", color: "#fff", label: "引用" },
  FOLLOW:         { bg: "#888", color: "#fff", label: "关注" },
  UPVOTE_POST:    { bg: "#FF6600", color: "#fff", label: "赞同" },
  DOWNVOTE_POST:  { bg: "#333", color: "#fff", label: "反对" },
  SEARCH_POSTS:   { bg: "#00AACC", color: "#fff", label: "搜索" },
  DO_NOTHING:     { bg: "#CCC", color: "#666", label: "观望" },
};
function getActionStyle(type: string) {
  return ACTION_STYLES[type] || { bg: "#999", color: "#fff", label: type.replace(/_/g, " ") };
}

// ─── SVG icons ────────────────────────────────────────────────────────

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
  "场景解析",
  "图谱构建",
  "智能体生成",
  "模拟运行",
  "报告生成",
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

  // ── Service availability ──
  const [serviceAvailable, setServiceAvailable] = useState<boolean | null>(null);

  // ── IDs ──
  const [projectId, setProjectId] = useState("");
  const [graphId, setGraphId] = useState("");
  const [simulationId, setSimulationId] = useState("");
  const [reportId, setReportId] = useState("");

  // ── Agent personas ──
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);

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

  // Service health check
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        // Try root path; any response (even 404) means network is reachable.
        await fetch(`${MIROFISH_BASE}/`, { signal: ctrl.signal, mode: "no-cors" });
        clearTimeout(t);
        if (!cancelled) setServiceAvailable(true);
      } catch {
        if (!cancelled) setServiceAvailable(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Report: poll sections + logs
  useEffect(() => {
    if (stage !== "step5" && stage !== "done") return;
    if (!reportId) return;
    const interval = setInterval(async () => {
      try {
        const { sections, isComplete } = await getReportSections(reportId);
        setReportSections(sections);
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
      setStage("step1"); setProgress(0); setStatusMsg("正在上传场景数据...");
      const pid = await uploadAndGenerateOntology(scenarioText, simReq, projectName, (msg) => {
        setStatusMsg(msg); setProgress(60);
      });
      setProjectId(pid); setProgress(100);

      // Step 2
      setStage("step2"); setProgress(0); setStatusMsg("正在初始化图谱构建...");
      const gid = await buildKnowledgeGraph(pid, (msg, pct) => {
        setStatusMsg(msg); setProgress(pct);
      });
      setGraphId(gid);

      // Step 3
      setStage("step3"); setProgress(0); setStatusMsg("正在创建模拟实例...");
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
      const msg = err?.message || "";
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("abort")) {
        setErrorMsg("无法连接到 AI 预测服务，请确认服务已启动或联系管理员配置 MIROFISH_URL。");
      } else {
        setErrorMsg(msg || "未知错误，请稍后重试");
      }
      setStage("error");
    }
  }

  const currentStepIdx = ["step1","step2","step3","step4","step5"].indexOf(stage);
  const formatTime = (s: number) => `${Math.floor(s/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`;

  // ════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#FAFAFA", fontFamily: "-apple-system,'SF Pro Text','PingFang SC','Helvetica Neue',sans-serif", overflow: "hidden" }}>

      {/* ── Header ───────────────────────────────────────── */}
      <header style={{ height: 52, background: "#000", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", flexShrink: 0, borderBottom: "1px solid #222" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            onClick={() => router.back()}
            style={{ color: "#fff", fontSize: 12, fontWeight: 700, letterSpacing: 1, cursor: "pointer", opacity: 0.5, transition: "opacity .2s" }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "0.5")}
          >
            ← 返回
          </span>
          <div style={{ width: 1, height: 16, background: "#333" }} />
          <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>高报 AI · 群体智能预测</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {STEP_LABELS.map((lbl, i) => {
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

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, color: "#555", letterSpacing: 1 }}>
            {province} · {label} · #{rank.toLocaleString()}
          </span>
          <div style={{ width: 1, height: 16, background: "#333" }} />
          {stage === "landing" && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#555" }} />
              <span style={{ fontSize: 9, color: "#555", letterSpacing: 1 }}>待机</span>
            </div>
          )}
          {(stage !== "landing" && stage !== "done" && stage !== "error") && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF4500", animation: "pulse 1.5s infinite" }} />
              <span style={{ fontSize: 9, color: "#FF4500", letterSpacing: 1 }}>运行中 · {formatTime(elapsedSec)}</span>
            </div>
          )}
          {stage === "done" && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00C853" }} />
              <span style={{ fontSize: 9, color: "#00C853", letterSpacing: 1 }}>已完成</span>
            </div>
          )}
          {stage === "error" && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF0000" }} />
              <span style={{ fontSize: 9, color: "#FF0000", letterSpacing: 1 }}>出错</span>
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
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 3, color: "#999", marginBottom: 16 }}>高报 · AI 群体智能预测引擎</div>
                <h1 style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.2, color: "#000", marginBottom: 16, fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
                  群体智能<br />
                  <span style={{ color: "#FF4500" }}>预测填报博弈。</span>
                </h1>
                <p style={{ fontSize: 14, color: "#666", lineHeight: 1.8 }}>
                  模拟全省考生真实填报决策，预警大年/小年波动，发现冷门窗口期。
                </p>
              </div>

              {/* Input card */}
              <div style={{ background: "#F5F5F5", borderRadius: 6, padding: 24, marginBottom: 24 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#999", marginBottom: 16 }}>模拟对象</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
                  {[
                    { label: "省份", value: province },
                    { label: "位次", value: `#${rank.toLocaleString()}` },
                    { label: "科类", value: label },
                  ].map(({ label: l, value }) => (
                    <div key={l}>
                      <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, marginBottom: 4 }}>{l}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#000" }}>{value}</div>
                    </div>
                  ))}
                </div>

                <div style={{ borderTop: "1px solid #E5E5E5", paddingTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  {[
                    { label: "智能体", value: "~30个" },
                    { label: "模拟轮次", value: "20轮" },
                    { label: "预计时长", value: "10~20分钟" },
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
                  { tag: "大年/小年预警", desc: "哪些学校2026年录取线会异常偏高或偏低" },
                  { tag: "冷门窗口", desc: "哪些高质量学校仍处于被低估的套利窗口期" },
                  { tag: "群体博弈", desc: "保守型与风险偏好考生如何重塑竞争格局" },
                ].map(({ tag, desc }, i) => (
                  <div key={tag} style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "14px 20px", borderBottom: i < 2 ? "1px solid #E5E5E5" : "none" }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: "#FF4500", whiteSpace: "nowrap", marginTop: 2 }}>{tag}</span>
                    <span style={{ fontSize: 12, color: "#666", lineHeight: 1.6 }}>{desc}</span>
                  </div>
                ))}
              </div>

              {/* Service unavailable warning */}
              {serviceAvailable === false && (
                <div style={{ background: "#FFF5F0", border: "1px solid #FF4500", borderRadius: 6, padding: "14px 16px", marginBottom: 20, display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ fontSize: 14, color: "#FF4500", flexShrink: 0 }}>⚠️</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#CC2200", marginBottom: 4 }}>AI 预测服务当前不可用</div>
                    <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6 }}>
                      无法连接到预测引擎（{MIROFISH_BASE}）。请确认服务已启动，或联系管理员检查 MIROFISH_URL 配置。
                    </div>
                  </div>
                </div>
              )}

              {/* Service checking */}
              {serviceAvailable === null && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, fontSize: 12, color: "#999" }}>
                  <Spinner size={14} />
                  <span>正在检测服务状态…</span>
                </div>
              )}

              <button
                onClick={startPrediction}
                disabled={serviceAvailable === false || serviceAvailable === null}
                style={{
                  width: "100%", padding: "14px 0",
                  background: serviceAvailable === true ? "#000" : "#CCC",
                  color: "#fff", border: "none", borderRadius: 4, fontSize: 14, fontWeight: 700,
                  letterSpacing: 1, cursor: serviceAvailable === true ? "pointer" : "not-allowed",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  fontFamily: "inherit", transition: "background .2s",
                }}
                onMouseEnter={e => { if (serviceAvailable === true) e.currentTarget.style.background = "#FF4500"; }}
                onMouseLeave={e => { if (serviceAvailable === true) e.currentTarget.style.background = "#000"; }}
              >
                开始模拟 <IconArrow />
              </button>
            </div>
          </div>
        )}

        {/* ══ STEP 1: Ontology Parse ══════════════════════ */}
        {stage === "step1" && (
          <div style={{ width: "100%", overflowY: "auto", padding: "32px 24px" }}>
            <StepCard num="01" title="场景解析" status="active" note="POST /api/graph/ontology/generate">
              <InfoRows rows={[
                { label: "场景", value: `${province} · ${label} · 位次 ${rank}` },
                { label: "状态", value: statusMsg },
              ]} />
              <ProgressBar pct={progress} />
            </StepCard>
          </div>
        )}

        {/* ══ STEP 2: Graph Build ═════════════════════════ */}
        {stage === "step2" && (
          <div style={{ width: "100%", overflowY: "auto", padding: "32px 24px" }}>
            <StepCard num="01" title="场景解析" status="completed">
              <InfoRows rows={[{ label: "项目 ID", value: projectId }]} />
            </StepCard>
            <StepCard num="02" title="图谱构建" status="active" note="POST /api/graph/build">
              <InfoRows rows={[{ label: "状态", value: statusMsg }]} />
              <ProgressBar pct={progress} />
            </StepCard>
          </div>
        )}

        {/* ══ STEP 3: Agent Personas ══════════════════════ */}
        {stage === "step3" && (
          <div style={{ width: "100%", display: "flex", overflow: "hidden" }}>
            {/* Left: Steps */}
            <div style={{ width: 340, flexShrink: 0, borderRight: "1px solid #E5E5E5", overflowY: "auto", padding: "24px 20px" }}>
              <StepCard num="01" title="场景解析" status="completed">
                <InfoRows rows={[{ label: "项目 ID", value: projectId }]} />
              </StepCard>
              <StepCard num="02" title="图谱构建" status="completed">
                <InfoRows rows={[{ label: "图谱 ID", value: graphId || "无图谱模式" }]} />
              </StepCard>
              <StepCard num="03" title="智能体生成" status="active" note="POST /api/simulation/prepare">
                <StatsGrid items={[
                  { label: "当前", value: String(profiles.length) },
                  { label: "话题数", value: String(profiles.reduce((s, p) => s + (p.interested_topics?.length || 0), 0)) },
                ]} />
                <ProgressBar pct={progress} />
                <div style={{ marginTop: 6, fontSize: 10, color: "#999" }}>{statusMsg}</div>
              </StepCard>
            </div>

            {/* Right: Profiles */}
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#999", marginBottom: 16 }}>
                已生成智能体 — {profiles.length} 个
              </div>
              {profiles.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#999", fontSize: 12 }}>
                  <Spinner size={14} />
                  <span>等待第一个智能体…</span>
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
                name="考生社区"
                round={runStatus?.current_round || 0}
                total={20}
                actions={actions.length}
                running={!!runStatus && runStatus.status === "running"}
                completed={runStatus?.status === "completed"}
              />
              <div style={{ flex: 1, fontSize: 11, color: "#666" }}>
                <span style={{ fontWeight: 700, color: "#000" }}>总事件数：</span>
                <span style={{ fontFamily: "monospace" }}>{actions.length}</span>
              </div>
              <div style={{ fontSize: 9, color: "#999", letterSpacing: 1 }}>
                第 {runStatus?.current_round || 0}/{20} 轮 · {formatTime(elapsedSec)}
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
                    <span>等待智能体行动…</span>
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
              <span style={{ fontSize: 9, color: "#FF4500", fontWeight: 700, letterSpacing: 2 }}>模拟监控</span>
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
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: "#FF4500", background: "rgba(255,69,0,.08)", padding: "3px 8px", borderRadius: 3 }}>预测报告</span>
                  <span style={{ fontSize: 9, color: "#999", fontFamily: "monospace" }}>ID: {reportId || "等待中"}</span>
                </div>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: "#000", margin: "0 0 8px", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
                  {province} · {label} · #{rank.toLocaleString()}
                </h1>
                <p style={{ fontSize: 12, color: "#666" }}>
                  群体智能模拟 · 20 轮 · ~30 个智能体 · MiroFish + DeepSeek
                </p>
                <div style={{ height: 1, background: "#E5E5E5", marginTop: 20 }} />
              </div>

              {/* Sections */}
              {reportSections.length === 0 && stage === "step5" && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#999", fontSize: 12, padding: "20px 0" }}>
                  <Spinner size={14} />
                  <span>等待报告生成…</span>
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
                    style={{ padding: "10px 20px", background: "#000", color: "#fff", borderRadius: 4, fontSize: 12, fontWeight: 700, letterSpacing: 1, textDecoration: "none", display: "flex", alignItems: "center", gap: 8 }}
                  >
                    返回志愿报告 <IconArrow />
                  </Link>
                  <button
                    onClick={() => { setStage("landing"); setReportSections([]); setActions([]); setProfiles([]); setAgentLogs([]); }}
                    style={{ padding: "10px 20px", background: "transparent", color: "#666", border: "1px solid #E5E5E5", borderRadius: 4, fontSize: 12, fontWeight: 700, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    重新运行
                  </button>
                </div>
              )}
            </div>

            {/* Right: Workflow Timeline */}
            <div style={{ width: 300, flexShrink: 0, borderLeft: "1px solid #E5E5E5", overflowY: "auto", padding: "20px 16px" }}>
              {/* Metrics */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                {[
                  { label: "章节数", value: `${reportSections.length}` },
                  { label: "耗时", value: formatTime(elapsedSec) },
                  { label: "工具调用", value: String(agentLogs.filter(l => l.action === "tool_call").length) },
                  { label: "状态", value: stage === "done" ? "完成" : "生成中...", color: stage === "done" ? "#00C853" : "#FF4500" },
                ].map(({ label: l, value, color }) => (
                  <div key={l} style={{ background: "#F5F5F5", borderRadius: 4, padding: "10px 12px" }}>
                    <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, marginBottom: 4 }}>{l}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: color || "#000", fontFamily: "monospace" }}>{value}</div>
                  </div>
                ))}
              </div>

              <div style={{ height: 1, background: "#E5E5E5", marginBottom: 16 }} />

              {/* Agent log timeline */}
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: "#999", marginBottom: 12 }}>智能体日志</div>
              <div style={{ position: "relative" }}>
                <div style={{ position: "absolute", left: 7, top: 0, bottom: 0, width: 1, background: "#E5E5E5" }} />
                {agentLogs.map((log, i) => (
                  <LogItem key={i} log={log} />
                ))}
                {agentLogs.length === 0 && (
                  <div style={{ paddingLeft: 20, fontSize: 11, color: "#999", display: "flex", alignItems: "center", gap: 8 }}>
                    <Spinner size={12} /> 等待中…
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
              <div style={{ fontSize: 9, color: "#FF0000", letterSpacing: 3, marginBottom: 12 }}>模拟出错</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#000", marginBottom: 12 }}>{errorMsg}</div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <button
                  onClick={() => { setStage("landing"); setErrorMsg(""); }}
                  style={{ padding: "10px 20px", background: "#000", color: "#fff", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 700, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" }}
                >
                  重新启动
                </button>
                <button
                  onClick={() => router.back()}
                  style={{ padding: "10px 20px", background: "transparent", color: "#666", border: "1px solid #E5E5E5", borderRadius: 4, fontSize: 12, fontWeight: 700, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" }}
                >
                  返回
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
          {isCompleted && <span style={{ fontSize: 9, color: "#00C853", background: "rgba(0,200,83,.1)", padding: "2px 8px", borderRadius: 3, fontWeight: 700, letterSpacing: 1 }}>已完成</span>}
          {isActive && <span style={{ fontSize: 9, color: "#FF4500", background: "rgba(255,69,0,.1)", padding: "2px 8px", borderRadius: 3, fontWeight: 700, letterSpacing: 1 }}>处理中</span>}
          {status === "pending" && <span style={{ fontSize: 9, color: "#999", background: "#F5F5F5", padding: "2px 8px", borderRadius: 3, fontWeight: 700, letterSpacing: 1 }}>等待中</span>}
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
          <div style={{ fontSize: 11, fontWeight: 700, color: "#000" }}>{profile.username || `智能体 ${idx}`}</div>
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

function PlatformCard({ name, round, total, actions, running, completed }: {
  name: string; round: number; total: number;
  actions: number; running: boolean; completed: boolean;
}) {
  return (
    <div style={{ border: `1px solid ${running ? "#000" : completed ? "#00C853" : "#E5E5E5"}`, borderRadius: 6, padding: "8px 14px", minWidth: 200, background: running ? "#fff" : "#FAFAFA" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: running ? "#000" : "#999", letterSpacing: 1 }}>{name}</span>
        {completed && <span style={{ color: "#00C853" }}><IconCheck /></span>}
        {running && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF4500", animation: "pulse 1.5s infinite", marginLeft: "auto" }} />}
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        {[
          { label: "轮次", value: `${round}/${total}` },
          { label: "动作", value: String(actions) },
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
              点赞了 @{action.action_args?.post_author_name || "用户"} 的帖子
              {action.action_args?.post_content && (
                <span style={{ color: "#999" }}>"{action.action_args.post_content.slice(0, 60)}..."</span>
              )}
            </div>
          )}
          {action.action_type === "REPOST" && (
            <div style={{ fontSize: 11, color: "#666" }}>
              ↩ 转发了 @{action.action_args?.original_author_name || "用户"} 的内容
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
            <div style={{ fontSize: 11, color: "#666" }}>+ 关注了 @{action.action_args?.target_user || "用户"}</div>
          )}
          {action.action_type === "SEARCH_POSTS" && (
            <div style={{ fontSize: 11, color: "#666" }}>🔍 搜索: "{action.action_args?.query}"</div>
          )}
          {action.action_type === "DO_NOTHING" && (
            <div style={{ fontSize: 11, color: "#CCC" }}>— 本轮未行动</div>
          )}
        </div>
        {/* Footer */}
        <div style={{ padding: "6px 14px", background: "#FAFAFA", borderTop: "1px solid #F5F5F5" }}>
          <span style={{ fontSize: 9, color: "#999", fontFamily: "monospace" }}>
            第{action.round_num}轮 · {action.timestamp ? new Date(action.timestamp).toLocaleTimeString("zh-CN", { hour12: false }) : "—"}
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
          {section.content.split("\n")[0].replace(/^#+\s*/, "") || `章节 ${idx + 1}`}
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
    report_start:       { text: "报告开始", color: "#000" },
    planning_start:     { text: "规划中...", color: "#FF4500" },
    planning_complete:  { text: "规划完成", color: "#00C853" },
    section_start:      { text: "章节开始", color: "#0057FF" },
    section_content:    { text: "内容就绪", color: "#0057FF" },
    section_complete:   { text: "章节完成", color: "#00C853" },
    tool_call:          { text: "工具调用", color: "#6600CC" },
    tool_result:        { text: "工具结果", color: "#888" },
    llm_response:       { text: "模型响应", color: "#888" },
    report_complete:    { text: "全部完成 ✓", color: "#00C853" },
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
