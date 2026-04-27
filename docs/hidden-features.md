# 已隐藏功能记录

本文档记录产品中已隐藏/下线的功能，说明隐藏原因、恢复方式及替代方案。

---

## `/shuchu` — 输出工作台（SHUCHU）

**隐藏时间**：2026-04-26

**涉及文件**：
- `frontend/app/shuchu/page.tsx`（页面代码保留，入口已隐藏）

### 功能说明

- 上传 PDF 或图片，编译知识库，快速创作输出。
- 本质是内嵌 SHUCHU 前端应用（通过 iframe 加载 `/shuchu/index.html`）。
- 页面包含返回按钮和新窗口打开按钮。

### 恢复方式

如需恢复该功能：

1. 在 `frontend/app/page.tsx` 导航栏恢复：
   ```tsx
   <Link href="/shuchu" className="btn-ghost nav-link-mobile-hide" style={{ padding: "6px 12px", fontSize: 13 }}>输出工作台</Link>
   ```
2. 或在首页工具入口区恢复对应卡片。

---

## `/crisis-pr` — MIROFISH 危机公关预测

**隐藏时间**：2026-04-26

**涉及文件**：
- `frontend/app/crisis-pr/page.tsx`（758 行，页面代码保留，入口已隐藏）
- `frontend/lib/mirofish.ts`（API 客户端）

### 功能说明

- 模拟媒体与舆情反应，提前预判危机走向。
- 用户输入公司名称、行业、危机类型、触发事件、核心问题、传播渠道、受众、目标后，系统运行 5 步模拟管线：
  1. 情景上传（Scenario Upload）
  2. 知识图谱构建（Graph Build）
  3. 利益相关者智能体（Stakeholder Agents）
  4. 舆情运行（Public Opinion Run，24 轮）
  5. 报告生成（Report Generate）
- 实时展示智能体行为、利益相关者画像，并以流式 Markdown 输出报告。

### 恢复方式

如需恢复该功能：

1. 在 `frontend/app/page.tsx` 导航栏恢复：
   ```tsx
   <Link href="/crisis-pr" className="btn-ghost nav-link-mobile-hide" style={{ padding: "6px 12px", fontSize: 13 }}>MIROFISH危机预测</Link>
   ```
2. 或在首页工具入口区恢复对应卡片。

---

## `/ai-predict` — AI 群体智能预测页面

**隐藏时间**：2026-04-26

**涉及文件**：
- `frontend/app/ai-predict/page.tsx`（页面代码保留，入口已隐藏）
- `frontend/app/results/page.tsx`（入口卡片已注释）

### 隐藏原因

1. **服务未部署**
   该页面依赖外部 **MiroFish** 多智能体引擎，需要独立服务器部署 + LLM API 调用成本。当前生产环境未配置 `NEXT_PUBLIC_MIROFISH_URL`，默认指向 `localhost:5001`，用户点击后请求不通。

2. **功能重叠**
   Result 页已具备本地群体智能（`backend/algorithms/swarm_predictor.py`）：
   - 300 个虚拟考生 Agent
   - Numpy 向量化计算，单次 <30ms
   - 零额外 API 成本
   - 输出 `swarm_score` 和 `swarm_discovery`（"◈ 群体强推"标签）

   本地实现已覆盖核心价值，外部 MiroFish 版并无增量优势。

3. **用户体验差**
   - 运行时间长：10~20 分钟
   - 流程复杂：5 个步骤（场景解析 → 图谱构建 → 智能体生成 → 模拟运行 → 报告生成）
   - 界面风格为 MiroFish Demo 风格（监控面板、Agent 日志、英文术语混合），普通用户无法理解

### 恢复方式

如需恢复该功能：

1. 部署 MiroFish 服务，在 `frontend/.env.production` 中配置：
   ```bash
   NEXT_PUBLIC_MIROFISH_URL=https://your-mirofish-server.com
   ```
2. 取消 `frontend/app/results/page.tsx` 中 AI 预测入口的注释块
3. 大幅简化前端界面（当前界面不适合普通用户，建议改为：输入参数 → 等待进度条 → 出文字报告）

### 替代方案

如需"大年/小年预警 + 冷门窗口期"的文字报告，建议：
- 在后端新建 API，调用 DeepSeek（已有 `DEEPSEEK_API_KEY`）
- 传入省份、位次、历史数据，让 LLM 直接生成分析报告
- 前端只需一个简洁的报告展示页，无需复杂的模拟监控界面

---

## `/career-predict` — 长期受益预测（职业前景预测）

**隐藏时间**：2026-04-26

**涉及文件**：
- `frontend/app/career-predict/page.tsx`（页面代码保留，入口已隐藏）
- `frontend/app/results/page.tsx`（入口卡片已注释）
- `frontend/lib/mirofish.ts`（API 客户端）

### 功能说明

预测"选了这所学校和专业，10 年后值多少"。用户输入目标学校、专业、省份、位次，系统运行 5 步模拟管线：

1. **场景构建** — 根据学校/专业/位次生成职业预测场景
2. **知识图谱** — 构建该领域本体知识（当前版本已跳过 Zep 图谱，走 ontology synthesis 模式）
3. **角色生成** — 生成约 30 个智能体（毕业生、雇主、行业分析师等）
4. **模拟推演** — 运行 20 轮博弈，模拟真实职业市场互动
5. **报告生成** — 输出职业前景预测报告

**预测维度**：
- 品牌折扣分析（本地企业 vs 全国企业对学校品牌的认可度差异）
- 5 年/10 年对比预测（同等位次选该校 vs 对比校，2031/2036 年薪资/机会/生活质量）
- 价值洼地判断（是真正被低估，还是有结构性弱点）

### 隐藏原因

1. **服务未部署**
   该页面依赖外部 **MiroFish** 多智能体引擎（需独立服务器 + LLM API 调用）。当前生产环境未配置 `NEXT_PUBLIC_MIROFISH_URL`，默认指向 `localhost:5001`，请求不通。

2. **运行成本过高**
   - 单次预测需 10~20 分钟
   - 依赖 LLM 调用，有显著 API 成本
   - 与 result 页已有的就业数据展示功能重叠

3. **体验问题**
   - 等待时间过长，不适合网页场景
   - 模拟监控界面对普通用户过于复杂

### 恢复方式

如需恢复该功能：

1. 部署 MiroFish 服务，在 `frontend/.env.production` 中配置：
   ```bash
   NEXT_PUBLIC_MIROFISH_URL=https://your-mirofish-server.com
   ```
2. 取消 `frontend/app/results/page.tsx` 中长期受益预测入口的注释块
3. 建议大幅简化前端界面（当前为 MiroFish Demo 风格，不适合普通用户）

### 替代方案

如需"职业前景分析"，建议：
- 在后端新建 API，调用 DeepSeek（已有 `DEEPSEEK_API_KEY`）
- 传入学校、专业、历史就业数据，让 LLM 直接生成职业前景文字报告
- 前端只需一个简洁的报告展示页，无需复杂的模拟监控界面

---

## AI 志愿助手（悬浮聊天窗口）

**隐藏时间**：2026-04-27

**涉及文件**：
- `frontend/components/AgentChat.tsx`（代码全部保留，入口已通过 `false &&` 条件屏蔽）

### 功能说明

- 右下角悬浮 AI 聊天按钮，点击后展开对话面板。
- 支持联网搜索，实时回答家长关于志愿填报、录取分数、专业选择等问题。
- 流式输出、Markdown 渲染、搜索状态提示。

### 隐藏原因

1. **当前产品阶段聚焦核心填报流程**
   首页 → 模拟填报 → 结果页的闭环是用户核心路径。AI 助手虽然有价值，但在当前阶段分散注意力，且可能引导用户跳出主流程。

2. **替代方案已就位**
   同一位置已替换为"问题反馈"按钮，用户遇到问题可直接提交反馈，比 AI 聊天更能收集真实痛点。

### 恢复方式

如需恢复 AI 助手：

1. 打开 `frontend/components/AgentChat.tsx`
2. 将两处 `{false && !open && (...)}` 与 `{false && (...)}` 中的 `false` 恢复为原来的条件：
   - 第一处改为 `{!open && (...)}`（光晕动画）
   - 第二处改为 `{...}` 或直接移除 `false &&`（悬浮按钮本身）
3. 问题反馈按钮可以保留或移除，两者位置冲突，需要错开（例如反馈改到左下角，或 AI 助手改到右下角上方）。