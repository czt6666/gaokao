"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  AgentAction,
  AgentLog,
  AgentProfile,
  ReportSection,
  RunStatus,
} from "@/lib/mirofish";

function renderSimpleMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h4 style="font-size:13px;font-weight:700;margin:16px 0 6px;color:#111">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="font-size:15px;font-weight:700;margin:20px 0 8px;color:#111;border-bottom:1px solid #E7D9D0;padding-bottom:6px">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 style="font-size:18px;font-weight:700;margin:0 0 16px;color:#111">$1</h2>')
    .replace(/^> (.+)$/gm, '<blockquote style="border-left:3px solid #C85A2E;padding:8px 12px;margin:8px 0;background:#FFF6F1;color:#5A4032;font-style:italic">$1</blockquote>')
    .replace(/^\* (.+)$/gm, '<div style="display:flex;gap:8px;margin:4px 0;padding-left:4px"><span style="color:#C85A2E;flex-shrink:0;margin-top:2px">▸</span><span>$1</span></div>')
    .replace(/^- (.+)$/gm, '<div style="display:flex;gap:8px;margin:4px 0;padding-left:4px"><span style="color:#C85A2E;flex-shrink:0;margin-top:2px">▸</span><span>$1</span></div>')
    .replace(/^\d+\. (.+)$/gm, '<div style="margin:4px 0 4px 12px">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #E7D9D0;margin:12px 0"/>')
    .replace(/\n\n/g, "<br/>")
    .replace(/^(?!<[h2-4b|d]|<br)(.+)$/gm, '<p style="margin:4px 0;line-height:1.7">$1</p>');
}

const ACTION_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  CREATE_POST: { bg: "#8C2F1B", color: "#fff", label: "POST" },
  CREATE_COMMENT: { bg: "#C85A2E", color: "#fff", label: "COMMENT" },
  LIKE_POST: { bg: "#B42318", color: "#fff", label: "BOOST" },
  REPOST: { bg: "#7A5C3E", color: "#fff", label: "REPOST" },
  UPVOTE_POST: { bg: "#9C6644", color: "#fff", label: "UPVOTE" },
  DOWNVOTE_POST: { bg: "#3B2F2F", color: "#fff", label: "PRESSURE" },
  DO_NOTHING: { bg: "#CFC5BF", color: "#5F534D", label: "IDLE" },
};

function getActionStyle(type: string) {
  return ACTION_STYLES[type] || { bg: "#8B7D77", color: "#fff", label: type.replace(/_/g, " ") };
}

const IconCheck = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

type Stage = "landing" | "step1" | "step2" | "step3" | "step4" | "step5" | "done" | "error";

const STEP_LABELS = [
  "Scenario Upload",
  "Graph Build",
  "Stakeholder Agents",
  "Public Opinion Run",
  "Report Generate",
];

function buildScenarioText(input: {
  companyName: string;
  industry: string;
  eventType: string;
  trigger: string;
  coreIssue: string;
  channels: string;
  audience: string;
  goal: string;
}) {
  return `# Company Crisis PR Scenario

Company: ${input.companyName}
Industry: ${input.industry}
Event Type: ${input.eventType}
Potential Trigger: ${input.trigger}
Core Issue: ${input.coreIssue}
Main Channels: ${input.channels}
Key Audiences: ${input.audience}
Decision Goal: ${input.goal}

## Context
The company is facing an emerging public opinion and reputation risk. The simulation should model how discussion may evolve across online communities, how different stakeholder groups react, which narratives gain traction, and what type of PR response can stabilize the situation.

## Required Outputs
- Crisis heat escalation path and timing
- Stakeholder sentiment shifts
- Narrative clusters likely to dominate
- Early warning signals before full blow-up
- Recommended PR response priorities within 24 hours, 72 hours, and 7 days
- Risk rating for brand damage, regulatory pressure, media pressure, and secondary backlash
`;
}

function CrisisPrContent() {
  const router = useRouter();

  const [companyName, setCompanyName] = useState("MIROFISH");
  const [industry, setIndustry] = useState("消费科技");
  const [eventType, setEventType] = useState("产品质量争议");
  const [trigger, setTrigger] = useState("社交平台出现多条投诉帖，质疑公司隐瞒问题");
  const [coreIssue, setCoreIssue] = useState("用户担心公司回应过慢，舆论可能从产品问题升级为品牌诚信问题");
  const [channels, setChannels] = useState("微博、抖音、小红书、知乎、媒体评论");
  const [audience, setAudience] = useState("现有用户、潜在用户、媒体、KOL、监管部门、员工");
  const [goal, setGoal] = useState("预测舆情升级路径，找出最有效的危机回应节奏与表述策略");

  const [stage, setStage] = useState<Stage>("landing");
  const [statusMsg, setStatusMsg] = useState("");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const [reportId, setReportId] = useState("");

  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [reportSections, setReportSections] = useState<ReportSection[]>([]);
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());
  const [logLine, setLogLine] = useState(0);

  const actionsEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (stage === "landing" || stage === "done" || stage === "error") return;
    startTimeRef.current = Date.now();
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [stage]);

  useEffect(() => {
    actionsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [actions.length]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentLogs.length]);

  useEffect(() => {
    if (stage !== "step5" && stage !== "done") return;
    if (!reportId) return;

    const timer = setInterval(async () => {
      try {
        const { sections, isComplete } = await getReportSections(reportId);
        setReportSections(sections);
        const newLogs = await getAgentLog(reportId, logLine);
        if (newLogs.length > 0) {
          setAgentLogs((prev) => [...prev, ...newLogs]);
          setLogLine((prev) => prev + newLogs.length);
        }
        if (isComplete && stage === "step5") setStage("done");
      } catch {}
    }, 2500);

    return () => clearInterval(timer);
  }, [stage, reportId, logLine]);

  async function startPrediction() {
    const maxRounds = 24;
    const scenarioText = buildScenarioText({
      companyName,
      industry,
      eventType,
      trigger,
      coreIssue,
      channels,
      audience,
      goal,
    });
    const simulationRequirement =
      "Simulate a company crisis public opinion evolution. Create stakeholder agents including users, observers, media, employees, KOLs, investors, and regulators. Focus on narrative spread, trust collapse, response timing, and response strategy tradeoffs.";

    try {
      setActions([]);
      setProfiles([]);
      setReportSections([]);
      setAgentLogs([]);
      setLogLine(0);
      setRunStatus(null);

      setStage("step1");
      setProgress(0);
      setStatusMsg("Uploading crisis scenario...");
      const pid = await uploadAndGenerateOntology(
        scenarioText,
        simulationRequirement,
        `${companyName} Crisis PR Forecast`,
        (msg) => {
          setStatusMsg(msg);
          setProgress(55);
        }
      );
      setProgress(100);

      setStage("step2");
      setProgress(0);
      const gid = await buildKnowledgeGraph(pid, (msg, pct) => {
        setStatusMsg(msg);
        setProgress(pct);
      });
      setStage("step3");
      setProgress(0);
      const sid = await createAndPrepareSimulation(pid, gid, (msg, pct, profs) => {
        setStatusMsg(msg);
        setProgress(pct);
        if (profs && profs.length > 0) setProfiles(profs);
      });
      setStage("step4");
      setProgress(0);
      await runSimulation(sid, maxRounds, (status, newActions) => {
        setRunStatus(status);
        setActions(newActions);
        setProgress(Math.round(((status.current_round || 0) / maxRounds) * 100));
      });

      setStage("step5");
      setProgress(0);
      const rid = await generatePredictionReport(sid, (msg, pct) => {
        setStatusMsg(msg);
        setProgress(pct);
      });
      setReportId(rid);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStage("error");
    }
  }

  const currentStepIdx = ["step1", "step2", "step3", "step4", "step5"].indexOf(stage);
  const formatTime = (s: number) =>
    `${Math.floor(s / 60)
      .toString()
      .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#F5EFE9",
        fontFamily: "Georgia, 'Times New Roman', 'PingFang SC', serif",
        color: "#211A17",
      }}
    >
      <header
        style={{
          minHeight: 56,
          background: "#211A17",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          gap: 12,
          flexWrap: "wrap",
          borderBottom: "1px solid #3A2D28",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            onClick={() => router.back()}
            style={{ color: "#F5EBDD", fontSize: 11, fontWeight: 700, letterSpacing: 2, cursor: "pointer", opacity: 0.72 }}
          >
            ← BACK
          </span>
          <div style={{ width: 1, height: 16, background: "#5A4A43" }} />
          <span style={{ color: "#F8F1E8", fontSize: 13, fontWeight: 700, letterSpacing: 2 }}>
            MIROFISH · 公司危机公关预测
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {STEP_LABELS.map((label, i) => {
            const done = currentStepIdx > i;
            const active = currentStepIdx === i;
            return (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "3px 8px",
                    borderRadius: 4,
                    background: done ? "#C85A2E" : active ? "#F5EBDD" : "transparent",
                    border: done || active ? "none" : "1px solid #5A4A43",
                  }}
                >
                  <span style={{ fontSize: 9, fontWeight: 700, color: done ? "#fff" : active ? "#211A17" : "#BCAEA7" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {active && <span style={{ fontSize: 9, color: "#211A17" }}>{label}</span>}
                  {done && <IconCheck />}
                </div>
                {i < STEP_LABELS.length - 1 && <div style={{ width: 12, height: 1, background: done ? "#C85A2E" : "#5A4A43" }} />}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#BCAEA7", letterSpacing: 1 }}>{companyName} · {eventType}</span>
          <div style={{ width: 1, height: 16, background: "#5A4A43" }} />
          {stage === "landing" && <span style={{ fontSize: 9, color: "#BCAEA7", letterSpacing: 1 }}>READY</span>}
          {(stage !== "landing" && stage !== "done" && stage !== "error") && (
            <span style={{ fontSize: 9, color: "#E49B6A", letterSpacing: 1 }}>RUNNING · {formatTime(elapsedSec)}</span>
          )}
          {stage === "done" && <span style={{ fontSize: 9, color: "#72C28A", letterSpacing: 1 }}>COMPLETED</span>}
          {stage === "error" && <span style={{ fontSize: 9, color: "#F97066", letterSpacing: 1 }}>ERROR</span>}
        </div>
      </header>

      <main style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {stage === "landing" && (
          <div style={{ width: "100%", overflowY: "auto", padding: "48px 20px 72px" }}>
            <div style={{ maxWidth: 1160, margin: "0 auto", display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(320px, 0.85fr)", gap: 28 }}>
              <section
                style={{
                  background: "linear-gradient(135deg, #211A17 0%, #4C3229 100%)",
                  color: "#F8F1E8",
                  borderRadius: 18,
                  padding: "40px 32px",
                  boxShadow: "0 24px 80px rgba(33,26,23,0.18)",
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 3, color: "#D9B8A2", marginBottom: 18 }}>
                  PUBLIC RISK FORECAST CONSOLE
                </div>
                <h1 style={{ fontSize: "clamp(34px, 5vw, 62px)", lineHeight: 1.02, margin: "0 0 18px", fontWeight: 700 }}>
                  把 MIROFISH
                  <br />
                  摆到前台，
                  <br />
                  先推演危机，
                  <br />
                  再决定发声。
                </h1>
                <p style={{ fontSize: 16, lineHeight: 1.8, color: "#EADDD3", maxWidth: 620, marginBottom: 28 }}>
                  不是事后写复盘，而是在舆情还没完全炸开前，用群体智能模拟用户、媒体、KOL、员工与监管视角，提前看见最可能失控的叙事路径。
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 28 }}>
                  {[
                    ["30+ 角色", "自动生成利益相关方画像"],
                    ["24 轮推演", "连续模拟舆情升级过程"],
                    ["72 小时策略", "给出回应节奏建议"],
                    ["报告流式输出", "边生成边看结论"],
                  ].map(([value, label]) => (
                    <div key={label} style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "14px 16px", background: "rgba(255,255,255,0.04)" }}>
                      <div style={{ fontSize: 21, fontWeight: 700 }}>{value}</div>
                      <div style={{ fontSize: 12, color: "#D9C8BC", marginTop: 4 }}>{label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 18, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <Link
                    href={MIROFISH_BASE}
                    target="_blank"
                    style={{
                      color: "#211A17",
                      background: "#F8F1E8",
                      textDecoration: "none",
                      padding: "10px 16px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: 1,
                    }}
                  >
                    打开 MIROFISH 服务
                  </Link>
                  <span style={{ fontSize: 12, color: "#D9C8BC", alignSelf: "center" }}>
                    当前后端地址：{MIROFISH_BASE}
                  </span>
                </div>
              </section>

              <section
                style={{
                  background: "#FFFDFC",
                  border: "1px solid #E7D9D0",
                  borderRadius: 18,
                  padding: "28px 24px",
                  boxShadow: "0 12px 40px rgba(92,58,43,0.08)",
                }}
              >
                <div style={{ fontSize: 11, color: "#8B6E61", letterSpacing: 2, marginBottom: 10 }}>预测输入</div>
                <div style={{ display: "grid", gap: 14 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#6D5A52" }}>公司名</span>
                    <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} style={inputStyle} />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "#6D5A52" }}>行业</span>
                      <input value={industry} onChange={(e) => setIndustry(e.target.value)} style={inputStyle} />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "#6D5A52" }}>危机类型</span>
                      <input value={eventType} onChange={(e) => setEventType(e.target.value)} style={inputStyle} />
                    </label>
                  </div>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#6D5A52" }}>潜在触发点</span>
                    <textarea value={trigger} onChange={(e) => setTrigger(e.target.value)} rows={3} style={textareaStyle} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#6D5A52" }}>核心问题</span>
                    <textarea value={coreIssue} onChange={(e) => setCoreIssue(e.target.value)} rows={4} style={textareaStyle} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#6D5A52" }}>重点渠道</span>
                    <input value={channels} onChange={(e) => setChannels(e.target.value)} style={inputStyle} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#6D5A52" }}>关键受众</span>
                    <input value={audience} onChange={(e) => setAudience(e.target.value)} style={inputStyle} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#6D5A52" }}>建模目标</span>
                    <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} style={textareaStyle} />
                  </label>
                </div>

                <div style={{ marginTop: 18, padding: 14, borderRadius: 12, background: "#F7EFE9", color: "#6A5449", fontSize: 12, lineHeight: 1.7 }}>
                  输出将重点覆盖：舆情爆点、叙事扩散链路、利害方反应、回应窗口、品牌伤害级别，以及 24h / 72h / 7d 的动作建议。
                </div>

                {(!companyName.trim() || !coreIssue.trim()) && (
                  <div style={{ fontSize: 12, color: "#B54708", marginTop: 14 }}>
                    请至少填写公司名和核心问题。
                  </div>
                )}

                <button
                  onClick={startPrediction}
                  disabled={!companyName.trim() || !coreIssue.trim()}
                  style={{
                    width: "100%",
                    marginTop: 18,
                    padding: "14px 18px",
                    borderRadius: 12,
                    border: "none",
                    background: !companyName.trim() || !coreIssue.trim() ? "#D7CDC7" : "#211A17",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: !companyName.trim() || !coreIssue.trim() ? "not-allowed" : "pointer",
                  }}
                >
                  开始危机公关预测
                </button>
              </section>
            </div>
          </div>
        )}

        {(stage === "step1" || stage === "step2" || stage === "step3" || stage === "step4" || stage === "step5") && (
          <div style={{ width: "100%", display: "flex", overflow: "hidden", flexWrap: "wrap" }}>
            <div style={{ width: 320, maxWidth: "100%", borderRight: "1px solid #E7D9D0", display: "flex", flexDirection: "column", background: "#FFFDFC" }}>
              <div style={{ padding: "24px 20px 20px", borderBottom: "1px solid #EFE4DC" }}>
                <div style={{ fontSize: 9, color: "#8B6E61", letterSpacing: 2, marginBottom: 8 }}>
                  STEP {currentStepIdx + 1}/5 · {STEP_LABELS[currentStepIdx]}
                </div>
                <div style={{ fontSize: 12, color: "#211A17", marginBottom: 12, lineHeight: 1.6 }}>{statusMsg}</div>
                <div style={{ background: "#EFE4DC", borderRadius: 3, height: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", background: "#C85A2E", width: `${progress}%`, transition: "width .4s ease" }} />
                </div>
                <div style={{ fontSize: 9, color: "#8B6E61", marginTop: 4, textAlign: "right" }}>{progress}%</div>
              </div>

              {stage === "step4" && runStatus && (
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #EFE4DC" }}>
                  <div style={{ fontSize: 9, color: "#8B6E61", letterSpacing: 2, marginBottom: 8 }}>RUN STATUS</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      { label: "ROUND", value: `${runStatus.current_round}/${runStatus.total_rounds}` },
                      { label: "STATUS", value: runStatus.status?.toUpperCase() || "—" },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <div style={{ fontSize: 8, color: "#8B6E61", letterSpacing: 2 }}>{label}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#211A17" }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {profiles.length > 0 ? (
                <div style={{ flex: 1, overflowY: "auto", padding: "16px 0" }}>
                  <div style={{ fontSize: 9, color: "#8B6E61", letterSpacing: 2, padding: "0 20px", marginBottom: 8 }}>
                    STAKEHOLDERS ({profiles.length})
                  </div>
                  {profiles.map((profile, index) => (
                    <div key={index} style={{ padding: "10px 20px", borderBottom: "1px solid #F4ECE7" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#211A17" }}>
                        {profile.name || profile.username || `Agent ${index + 1}`}
                      </div>
                      {profile.persona && (
                        <div style={{ fontSize: 10, color: "#6D5A52", marginTop: 3, lineHeight: 1.5 }}>
                          {profile.persona.slice(0, 72)}{profile.persona.length > 72 ? "…" : ""}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#BCAEA7", fontSize: 11 }}>
                  正在生成利益相关方画像…
                </div>
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {stage === "step4" && (
                <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
                  <div style={{ fontSize: 9, color: "#8B6E61", letterSpacing: 2, marginBottom: 12 }}>PUBLIC OPINION FEED</div>
                  {actions.length === 0 && (
                    <div style={{ fontSize: 12, color: "#BCAEA7", textAlign: "center", padding: "48px 0" }}>
                      等待智能体开始行动…
                    </div>
                  )}
                  {actions.map((action) => {
                    const style = getActionStyle(action.action_type);
                    return (
                      <div key={action._uniqueId} style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 8, fontWeight: 700, padding: "3px 7px", borderRadius: 3, background: style.bg, color: style.color, whiteSpace: "nowrap" }}>
                          {style.label}
                        </span>
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#211A17" }}>{action.agent_name}</span>
                          {action.action_args?.title && (
                            <span style={{ fontSize: 10, color: "#6D5A52", marginLeft: 8 }}>
                              {String(action.action_args.title).slice(0, 72)}
                            </span>
                          )}
                          {action.action_args?.content && !action.action_args?.title && (
                            <span style={{ fontSize: 10, color: "#6D5A52", marginLeft: 8 }}>
                              {String(action.action_args.content).slice(0, 90)}
                            </span>
                          )}
                          <div style={{ fontSize: 9, color: "#BCAEA7", marginTop: 2 }}>
                            R{action.round_num} · {action.timestamp?.slice(11, 16)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={actionsEndRef} />
                </div>
              )}

              {(stage === "step1" || stage === "step2" || stage === "step3" || stage === "step5") && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  {stage === "step5" && reportSections.length > 0 ? (
                    <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
                      <div style={{ fontSize: 9, color: "#8B6E61", letterSpacing: 2, marginBottom: 16 }}>REPORT STREAM</div>
                      {reportSections.map((section) => (
                        <div key={section.section_index} style={{ marginBottom: 24, background: "#FFFDFC", border: "1px solid #E7D9D0", borderRadius: 12, padding: 20 }}>
                          <div dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(section.content) }} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
                      <div style={{ width: 42, height: 42, border: "2px solid #EFE4DC", borderTop: "2px solid #C85A2E", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                      <div style={{ fontSize: 12, color: "#8B6E61" }}>{statusMsg || "Processing..."}</div>
                    </div>
                  )}

                  {agentLogs.length > 0 && (
                    <div style={{ height: 180, borderTop: "1px solid #E7D9D0", overflowY: "auto", padding: "12px 20px", background: "#FFFDFC" }}>
                      <div style={{ fontSize: 9, color: "#8B6E61", letterSpacing: 2, marginBottom: 8 }}>REPORT AGENT LOG</div>
                      {agentLogs.map((log, i) => (
                        <div key={i} style={{ fontSize: 10, color: "#6D5A52", marginBottom: 4, lineHeight: 1.5 }}>
                          <span style={{ color: "#BCAEA7" }}>[{log.elapsed_seconds?.toFixed(1)}s]</span>{" "}
                          <span style={{ color: "#C85A2E" }}>{log.action}</span>{" "}
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

        {stage === "done" && (
          <div style={{ width: "100%", display: "flex", overflow: "hidden", flexWrap: "wrap" }}>
            <div style={{ width: 300, maxWidth: "100%", borderRight: "1px solid #E7D9D0", overflowY: "auto", background: "#FFFDFC", flexShrink: 0 }}>
              <div style={{ padding: 20, borderBottom: "1px solid #EFE4DC" }}>
                <div style={{ fontSize: 9, color: "#8B6E61", letterSpacing: 2, marginBottom: 4 }}>STAKEHOLDERS ({profiles.length})</div>
                <div style={{ fontSize: 9, color: "#72C28A", letterSpacing: 1 }}>SIMULATION COMPLETE</div>
              </div>
              {profiles.map((profile, index) => (
                <div key={index} style={{ padding: "10px 20px", borderBottom: "1px solid #F4ECE7" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#211A17" }}>
                    {profile.name || profile.username || `Agent ${index + 1}`}
                  </div>
                  {profile.profession && <div style={{ fontSize: 9, color: "#8B6E61", marginTop: 1 }}>{profile.profession}</div>}
                </div>
              ))}
            </div>

            <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "32px 28px", background: "#F5EFE9" }}>
              <div style={{ marginBottom: 32 }}>
                <div style={{ fontSize: 9, color: "#8B6E61", letterSpacing: 3, marginBottom: 8 }}>MIROFISH · CRISIS PR FORECAST REPORT</div>
                <h1 style={{ fontSize: 30, fontWeight: 700, color: "#211A17", marginBottom: 8 }}>{companyName}</h1>
                <div style={{ fontSize: 14, color: "#6D5A52" }}>
                  {industry} · {eventType}
                </div>
              </div>

              {reportSections.length > 1 && (
                <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
                  {reportSections.map((section) => {
                    const firstLine = section.content.split("\n")[0].replace(/^#+\s*/, "").slice(0, 22);
                    return (
                      <button
                        key={section.section_index}
                        onClick={() => document.getElementById(`sec-${section.section_index}`)?.scrollIntoView({ behavior: "smooth" })}
                        style={{ fontSize: 10, padding: "5px 10px", borderRadius: 999, border: "1px solid #DFCFC5", background: "#FFFDFC", cursor: "pointer", color: "#6D5A52" }}
                      >
                        §{section.section_index + 1} {firstLine}
                      </button>
                    );
                  })}
                </div>
              )}

              {reportSections.map((section) => {
                const isCollapsed = collapsedSections.has(section.section_index);
                const firstLine = section.content.split("\n")[0].replace(/^#+\s*/, "");
                return (
                  <div key={section.section_index} id={`sec-${section.section_index}`} style={{ marginBottom: 24, background: "#FFFDFC", border: "1px solid #E7D9D0", borderRadius: 14, overflow: "hidden" }}>
                    <div
                      onClick={() =>
                        setCollapsedSections((prev) => {
                          const next = new Set(prev);
                          if (next.has(section.section_index)) next.delete(section.section_index);
                          else next.add(section.section_index);
                          return next;
                        })
                      }
                      style={{ padding: "12px 18px", borderBottom: isCollapsed ? "none" : "1px solid #F1E8E2", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#FBF7F4" }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#211A17" }}>
                        §{section.section_index + 1} {firstLine.slice(0, 56)}
                      </span>
                      <span style={{ fontSize: 10, color: "#8B6E61" }}>{isCollapsed ? "▸" : "▾"}</span>
                    </div>
                    {!isCollapsed && (
                      <div style={{ padding: "20px 22px", fontSize: 13, color: "#3B312D", lineHeight: 1.8 }}>
                        <div dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(section.content) }} />
                      </div>
                    )}
                  </div>
                );
              })}

              <div style={{ marginTop: 32, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button
                  onClick={() => router.back()}
                  style={{ padding: "11px 18px", background: "#211A17", color: "#fff", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer", letterSpacing: 1, border: "none" }}
                >
                  ← 返回
                </button>
                <button
                  onClick={() => window.print()}
                  style={{ padding: "11px 18px", background: "#FFFDFC", color: "#211A17", border: "1px solid #DFCFC5", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer", letterSpacing: 1 }}
                >
                  打印报告
                </button>
              </div>
            </div>
          </div>
        )}

        {stage === "error" && (
          <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#F5EFE9" }}>
            <div style={{ maxWidth: 520, padding: "60px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#B42318", letterSpacing: 3, marginBottom: 16 }}>SIMULATION ERROR</div>
              <div style={{ fontSize: 14, color: "#3B312D", marginBottom: 32, lineHeight: 1.8 }}>{errorMsg}</div>
              <button
                onClick={() => {
                  setStage("landing");
                  setErrorMsg("");
                  setProgress(0);
                  setStatusMsg("");
                }}
                style={{ padding: "12px 22px", background: "#211A17", color: "#fff", border: "none", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                返回重试
              </button>
            </div>
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        @media (max-width: 960px) {
          main > div > div {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 10,
  border: "1px solid #D9C9BE",
  fontSize: 14,
  color: "#211A17",
  background: "#fff",
  outline: "none",
  boxSizing: "border-box" as const,
};

const textareaStyle = {
  ...inputStyle,
  resize: "vertical" as const,
  lineHeight: 1.6,
  fontFamily: "inherit",
};

export default function CrisisPrPage() {
  return (
    <Suspense
      fallback={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
          <div>Loading...</div>
        </div>
      }
    >
      <CrisisPrContent />
    </Suspense>
  );
}
