/**
 * MiroFish API 客户端
 * 封装群体智能引擎的所有调用步骤
 *
 * API 响应格式统一为 { success: boolean, data: { ... }, error?: string }
 */

export const MIROFISH_BASE =
  process.env.NEXT_PUBLIC_MIROFISH_URL || "http://localhost:5001";

// ─── 类型定义 ────────────────────────────────────────────────────────

export interface AgentProfile {
  user_id?: number;
  username?: string;
  name?: string;
  bio?: string;
  persona?: string;
  profession?: string;
  age?: number;
  gender?: string;
  mbti?: string;
  country?: string;
  interested_topics?: string[];
}

export interface AgentAction {
  round_num: number;
  timestamp: string;
  platform: string;
  agent_id: number;
  agent_name: string;
  action_type: string;
  action_args: Record<string, any>;
  result?: string;
  success: boolean;
  _uniqueId?: string;
}

export interface RunStatus {
  status: string;              // mapped from runner_status
  current_round: number;       // mapped from reddit_current_round
  total_rounds: number;
  active_agents: number;
  reddit_running?: boolean;
  reddit_completed?: boolean;
  reddit_current_round?: number;
  reddit_actions_count?: number;
  twitter_running?: boolean;
  twitter_completed?: boolean;
  twitter_current_round?: number;
  twitter_actions_count?: number;
  message?: string;
}

export interface ReportSection {
  section_index: number;
  content: string;
}

export interface AgentLog {
  action: string;
  stage: string;
  timestamp: string;
  elapsed_seconds: number;
  section_title?: string;
  section_index?: number;
  details?: Record<string, any>;
}

// ─── 工具函数 ────────────────────────────────────────────────────────

/** 从 { success, data, error } 格式的响应中提取 data，失败时抛出 */
function unwrap<T = Record<string, any>>(resp: any, fallbackMsg: string): T {
  if (!resp.success) throw new Error(resp.error || resp.message || fallbackMsg);
  return (resp.data ?? resp) as T;
}

export async function poll<T>(
  fn: () => Promise<T>,
  isDone: (r: T) => boolean,
  onTick?: (r: T) => void,
  intervalMs = 2000,
  timeoutMs = 1200000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    onTick?.(result);
    if (isDone(result)) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("操作超时，请稍后重试");
}

// ─── 步骤函数 ────────────────────────────────────────────────────────

/** 长期受益预测步骤1：根据学校/专业/位次生成场景并创建 Project */
export async function buildCareerScene(
  school: string,
  major: string,
  rank: number,
  province: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  onProgress?.("Generating career prediction scenario...");
  const res = await fetch(`${MIROFISH_BASE}/api/career/build_scene`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ school, major, rank, province }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Career scene build failed (${res.status})`);
  }
  const resp = await res.json();
  const data = unwrap<{ project_id: string }>(resp, "Career scene build failed");
  onProgress?.("Scenario & ontology ready");
  return data.project_id;
}

/** 步骤1：上传场景文档，生成本体 */
export async function uploadAndGenerateOntology(
  scenarioText: string,
  simulationRequirement: string,
  projectName: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  onProgress?.("Uploading scenario data...");
  const blob = new Blob([scenarioText], { type: "text/plain" });
  const file = new File([blob], "gaokao_scenario.txt", { type: "text/plain" });
  const formData = new FormData();
  formData.append("files", file);
  formData.append("simulation_requirement", simulationRequirement);
  formData.append("project_name", projectName);

  const res = await fetch(`${MIROFISH_BASE}/api/graph/ontology/generate`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Upload failed (${res.status})`);
  }
  const resp = await res.json();
  const data = unwrap<{ project_id: string }>(resp, "Ontology generation failed");
  onProgress?.("Ontology generated successfully");
  return data.project_id;
}

/** 步骤2：构建知识图谱（Zep quota 超限时自动降级为 no-graph 模式） */
export async function buildKnowledgeGraph(
  projectId: string,
  onProgress?: (msg: string, pct: number) => void
): Promise<string> {
  onProgress?.("Initializing graph construction...", 0);

  const res = await fetch(`${MIROFISH_BASE}/api/graph/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || "Graph build request failed");
  }
  const resp = await res.json();
  const buildData = unwrap<{ task_id: string }>(resp, "Graph build failed");
  const taskId = buildData.task_id;

  // Poll task status
  let taskFailed = false;
  await poll(
    async () => {
      const r = await fetch(`${MIROFISH_BASE}/api/graph/task/${taskId}`);
      const raw = await r.json();
      return raw.data ?? raw;
    },
    (r) => r.status === "completed" || r.status === "failed",
    (r) => {
      if (r.status === "failed") taskFailed = true;
      onProgress?.(r.message || "Building graph...", r.progress || 50);
    }
  );

  if (taskFailed) {
    // Zep quota exceeded or other graph error — fall back to no-graph mode.
    // Return empty string so profile generator skips Zep search (graph_id falsy check).
    onProgress?.("Graph skipped — running in no-memory mode", 100);
    return "";
  }

  // Retrieve the actual graph_id from the project
  const projRes = await fetch(`${MIROFISH_BASE}/api/graph/project/${projectId}`);
  const projResp = await projRes.json();
  const projData = projResp.data ?? projResp;
  const graphId = projData.graph_id || projData.project?.graph_id;
  if (!graphId) {
    onProgress?.("Graph ID unavailable — no-memory mode", 100);
    return "";
  }

  onProgress?.("Knowledge graph constructed", 100);
  return graphId as string;
}

/** 步骤3：创建+准备模拟 */
export async function createAndPrepareSimulation(
  projectId: string,
  graphId: string,
  onProgress?: (msg: string, pct: number, profiles?: AgentProfile[]) => void
): Promise<string> {
  onProgress?.("Creating simulation instance...", 0);

  const createRes = await fetch(`${MIROFISH_BASE}/api/simulation/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      graph_id: graphId,
      enable_reddit: true,
      enable_twitter: false,
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(err.error || err.message || "Simulation create failed");
  }
  const createResp = await createRes.json();
  const simData = unwrap<{ simulation_id: string }>(createResp, "Simulation create failed");
  const simulationId = simData.simulation_id;

  onProgress?.("Generating agent personas...", 10);

  const prepRes = await fetch(`${MIROFISH_BASE}/api/simulation/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ simulation_id: simulationId, use_llm_for_profiles: true }),
  });
  if (!prepRes.ok) {
    const err = await prepRes.json().catch(() => ({}));
    throw new Error(err.error || err.message || "Simulation prepare failed");
  }
  const prepResp = await prepRes.json();
  const prepData = prepResp.data ?? prepResp;

  if (prepData.status === "ready" || prepData.already_prepared) {
    onProgress?.("Agent personas ready", 100);
    return simulationId;
  }

  const taskId = prepData.task_id as string;
  await poll(
    async () => {
      const r = await fetch(`${MIROFISH_BASE}/api/simulation/prepare/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId }),
      });
      const raw = await r.json();
      return raw.data ?? raw;
    },
    (r) => r.status === "completed" || r.status === "failed",
    async (r) => {
      // Fetch real-time profiles in parallel
      let profiles: AgentProfile[] = [];
      try {
        const pr = await fetch(
          `${MIROFISH_BASE}/api/simulation/${simulationId}/profiles/realtime?platform=reddit`
        );
        if (pr.ok) {
          const pd = await pr.json();
          const pdData = pd.data ?? pd;
          profiles = pdData.profiles || (Array.isArray(pdData) ? pdData : []);
        }
      } catch {}
      const detail = r.progress_detail;
      const msg = detail?.current_item && detail?.total_items
        ? `Generating persona ${detail.current_item}/${detail.total_items}...`
        : r.message || "Preparing agents...";
      onProgress?.(msg, r.progress || 0, profiles);
    },
    2500
  );

  onProgress?.("All personas generated", 100);
  return simulationId;
}

/** 步骤4：运行模拟 */
export async function runSimulation(
  simulationId: string,
  maxRounds = 20,
  onStatus?: (status: RunStatus, actions: AgentAction[]) => void
): Promise<void> {
  let lastActionCount = 0;
  const allActions: AgentAction[] = [];

  const startRes = await fetch(`${MIROFISH_BASE}/api/simulation/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      simulation_id: simulationId,
      max_rounds: maxRounds,
      platform: "reddit",
      enable_graph_memory_update: false,
    }),
  });
  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({}));
    throw new Error(err.error || err.message || "Simulation start failed");
  }

  await poll(
    async () => {
      const r = await fetch(`${MIROFISH_BASE}/api/simulation/${simulationId}/run-status`);
      const raw = await r.json();
      return raw.data ?? raw;
    },
    (raw) => {
      const st = raw.runner_status || raw.status || "";
      if (st === "completed" || st === "stopped" || st === "failed") return true;
      // Simulation enters IPC-wait mode after finishing all rounds — runner_status
      // stays "running" but reddit_current_round reaches total_rounds in SQLite.
      if (raw.reddit_completed === true) return true;
      const cur = raw.reddit_current_round ?? raw.current_round ?? 0;
      const total = raw.total_rounds ?? maxRounds;
      if (cur > 0 && total > 0 && cur >= total) return true;
      // Stale-detection: actions count has stabilised and we've done at least half
      return false;
    },
    async (raw) => {
      // Map raw API fields → RunStatus interface
      const status: RunStatus = {
        status: raw.runner_status || raw.status || "running",
        current_round: raw.reddit_current_round ?? raw.current_round ?? 0,
        total_rounds: raw.total_rounds ?? maxRounds,
        active_agents: raw.active_agents ?? 0,
        reddit_running: raw.reddit_running,
        reddit_completed: raw.reddit_completed,
        reddit_current_round: raw.reddit_current_round,
        reddit_actions_count: raw.reddit_actions_count ?? raw.total_actions_count,
        twitter_running: raw.twitter_running,
        twitter_completed: raw.twitter_completed,
        twitter_current_round: raw.twitter_current_round,
        twitter_actions_count: raw.twitter_actions_count,
        message: raw.message,
      };

      // Fetch incremental actions
      try {
        const ar = await fetch(
          `${MIROFISH_BASE}/api/simulation/${simulationId}/actions?offset=${lastActionCount}&limit=50`
        );
        if (ar.ok) {
          const ad = await ar.json();
          const adData = ad.data ?? ad;
          const newActions: AgentAction[] = adData.actions || (Array.isArray(adData) ? adData : []);
          if (newActions.length > 0) {
            newActions.forEach((a, i) => {
              a._uniqueId = `${a.agent_id}-${a.round_num}-${a.action_type}-${lastActionCount + i}`;
              allActions.push(a);
            });
            lastActionCount += newActions.length;
          }
        }
      } catch {}
      onStatus?.(status, [...allActions]);
    },
    3000,
    1200000
  );
}

/** 步骤5：生成报告 */
export async function generatePredictionReport(
  simulationId: string,
  onProgress?: (msg: string, pct: number) => void
): Promise<string> {
  onProgress?.("Initializing Report Agent...", 0);
  const genRes = await fetch(`${MIROFISH_BASE}/api/report/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ simulation_id: simulationId }),
  });
  if (!genRes.ok) {
    const err = await genRes.json().catch(() => ({}));
    throw new Error(err.error || err.message || "Report generate request failed");
  }
  const genResp = await genRes.json();
  const genData = genResp.data ?? genResp;
  const reportId = genData.report_id as string;
  const taskId = genData.task_id as string;

  if (genData.status === "completed") {
    onProgress?.("Report ready", 100);
    return reportId;
  }

  await poll(
    async () => {
      const r = await fetch(`${MIROFISH_BASE}/api/report/generate/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId }),
      });
      const raw = await r.json();
      return raw.data ?? raw;
    },
    (r) => r.status === "completed" || r.status === "failed",
    (r) => onProgress?.(r.message || "Generating report...", r.progress || 0),
    3000
  );

  onProgress?.("Report generation complete", 100);
  return reportId;
}

/** 获取报告章节 */
export async function getReportSections(
  reportId: string
): Promise<{ sections: ReportSection[]; isComplete: boolean }> {
  const res = await fetch(`${MIROFISH_BASE}/api/report/${reportId}/sections`);
  if (!res.ok) throw new Error("Failed to fetch report sections");
  const resp = await res.json();
  const data = resp.data ?? resp;
  return {
    sections: data.sections || [],
    isComplete: data.is_complete ?? false,
  };
}

/** 获取 Agent 日志（增量） */
export async function getAgentLog(
  reportId: string,
  fromLine = 0
): Promise<AgentLog[]> {
  const res = await fetch(
    `${MIROFISH_BASE}/api/report/${reportId}/agent-log?from_line=${fromLine}`
  );
  if (!res.ok) return [];
  const resp = await res.json();
  const data = resp.data ?? resp;
  return data.logs || (Array.isArray(data) ? data : []);
}
