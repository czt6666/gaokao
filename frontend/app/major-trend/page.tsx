"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import AuthNav from "@/components/AuthNav";

const API = process.env.NEXT_PUBLIC_API_URL || "";

// ─── DATA ────────────────────────────────────────────────────

const YEARLY = [
  { year: "2019", canceled: 367,  note: "危机初现",  confirmed: true },
  { year: "2020", canceled: 518,  note: "",          confirmed: true },
  { year: "2021", canceled: 804,  note: "",          confirmed: true },
  { year: "2022", canceled: 925,  note: "加速",      confirmed: true },
  { year: "2023", canceled: 1670, note: "年度最高",  confirmed: true },
  { year: "2024", canceled: 1428, note: "+停招2220", confirmed: true },
  { year: "2025", canceled: 0,    note: "待公布",    confirmed: false },
];

const GRADUATES = [
  { year: "2021", total: 909  },
  { year: "2022", total: 1076 },
  { year: "2023", total: 1158 },
  { year: "2024", total: 1179 },
  { year: "2025", total: 1222, peak: true     },
  { year: "2026", total: 1270, forecast: true },
];

const BIRTH_POP = [
  { year: "2016", pop: 1786 },
  { year: "2017", pop: 1723 },
  { year: "2018", pop: 1523 },
  { year: "2019", pop: 1465 },
  { year: "2020", pop: 1202 },
  { year: "2021", pop: 1062 },
  { year: "2022", pop: 956  },
  { year: "2023", pop: 902  },
  { year: "2024", pop: 954,  rebound: true },
  { year: "2025", pop: 792,  record: true  },
];

const CAUSES = [
  {
    num: "01", title: "产业结构剧变", subtitle: "旧引擎失速",
    paras: [
      "房地产从2021年起进入下行周期，土建行业岗位需求锐减超50%。2025年山东大学一次性停招包括土木工程在内的27个专业，是这一趋势的缩影。",
      "大宗制造业产能过剩，传统工科人才供需彻底倒挂；而高校的专业供给体系还停留在2015年代的产业逻辑里。",
    ],
    pills: [
      { label: "山东大学2025年停招", value: "27个本科专业" },
      { label: "土木就业跌幅", value: "46个职业类别第一" },
    ],
  },
  {
    num: "02", title: "AI替代加速", subtitle: "最快的颠覆",
    paras: [
      "生成式AI首先冲击的不是蓝领，而是低壁垒脑力劳动——翻译、基础设计、人事管理、数据录入。这些恰好是众多文科、艺术类专业的核心就业出口。",
      "2025年数据显示：摄影师岗位需求下降28%，撰稿人/文案下降28%，记者下降22%；电话客服AI替代率达85%。2026届大厂校招中，AI相关岗位需求较传统岗暴涨约10倍。",
    ],
    pills: [
      { label: "翻译从业比例10年变化", value: "1.1% → 0.4%（降64%）" },
      { label: "2025年摄影师岗位降幅", value: "−28%" },
      { label: "2026届AI相关岗位", value: "约10倍增长（大厂校招）" },
    ],
  },
  {
    num: "03", title: "出生人口断崖", subtitle: "生源危机已提前到来",
    paras: [
      "2025年全国出生人口792万，创1949年建国以来历史最低，人口自然增长率跌至−2.41‰，较2016年峰值（1786万）已腰斩逾半。即便2024年有龙年效应短暂反弹至954万，也无法逆转长期下行趋势。",
      "当适龄人口在2035年后进入快速下滑区间，高校将面临系统性生源竞争。这一进程已提前到来：2025年全国高考报名人数1335万，7年连续增长后首次下降。",
    ],
    pills: [
      { label: "2022年出生人口", value: "956万" },
      { label: "2023年出生人口", value: "902万" },
      { label: "2024年出生人口", value: "954万（龙年反弹）" },
      { label: "2025年出生人口", value: "792万（1949年以来最低）" },
      { label: "2025年高考报名", value: "1,335万（7年来首降）" },
    ],
  },
  {
    num: "04", title: "政策导向切轨", subtitle: "从学科逻辑到产业逻辑",
    paras: [
      "教育部以「就业率连续2-3年低于60%」作为撤销红线，并推行高校与千亿、万亿级产业集群的对接机制。2026年目标是完成全国高校20%学科专业调整。",
      "短期内这纠正了专业泡沫，但将高等教育彻底工具化也带来长期结构性风险。",
    ],
    pills: [
      { label: "2025年目录更新", value: "845种专业，净增29种" },
      { label: "2026年调整目标", value: "全国高校20%学科专业" },
    ],
  },
  {
    num: "05", title: "就业市场寒冬", subtitle: "压力向上传导",
    paras: [
      "2025年8月，16-24岁青年失业率（不含在校生）达18.9%，创新统计口径以来历史最高，全年12月降至16.5%。2026届毕业生规模增至1270万，而大厂以外的整体校招岗位持续收紧。",
      "结构性分化极为悬殊：2025届文科就业率58.3%，工科92.7%，差距扩大至34个百分点。学生已在用脚投票——湖南大学土木工程2022年转出98人、转入0人。",
    ],
    pills: [
      { label: "2025年8月青年失业率", value: "18.9%（有统计以来最高）" },
      { label: "2025年12月青年失业率", value: "16.5%" },
      { label: "2025届文科就业率", value: "58.3%（工科92.7%）" },
      { label: "2024届本科落实率", value: "86.7%（麦可思·最终口径）" },
      { label: "应届起薪差距", value: "文科4,980元 vs 工科6,820元" },
    ],
  },
];

const NATURE_TABS = [
  {
    type: "真死亡", label: "DEAD", color: "#DC2626", bg: "#FEF2F2",
    desc: "需求侧彻底消失，无法靠技能升级填补缺口",
    cases: [
      { name: "纯人工中低端翻译", detail: "2025年AI翻译商业落地，从业比例10年降64%；蒙特雷国际研究学院已关停部分项目" },
      { name: "传统采矿工程方向", detail: "产能过剩政策性退出，相关就业岗位不再存在" },
      { name: "基础广告创意执行", detail: "AI作图、AI文案已达商业可用水平，低端创意岗几乎消失" },
      { name: "手工数据录入/处理", detail: "RPA+AI完全替代，不是岗位减少，是岗位消失" },
    ],
    verdict: "不会反弹，应立即回避",
  },
  {
    type: "假死亡", label: "DORMANT", color: "#D97706", bg: "#FFFBEB",
    desc: "周期性萎缩，外部条件改变后存在反弹路径",
    cases: [
      { name: "土木工程", detail: "基建周期低谷，新基建/城市更新启动后有望反弹；但不会回到2015年规模" },
      { name: "护理学", detail: "就业率连续垫底，但老龄化长期需求巨大；症结是薪资低待遇差，不是市场无需" },
      { name: "小语种（朝鲜语/阿拉伯语等）", detail: "地缘政治变化可驱动需求，总量有限但对口率高于英语" },
      { name: "生物技术", detail: "商业化滞后于研发，政策窗口打开后迅速反弹；2026年已列为新增扶持方向" },
    ],
    verdict: "谨慎选择，关注政策窗口",
  },
  {
    type: "正在变种", label: "MUTATING", color: "#059669", bg: "#F0FDF4",
    desc: "旧形态消亡，新形态已生长，核心能力被保留但载体变了",
    cases: [
      { name: "翻译 → AI协同翻译/本地化策略师", detail: "从人工逐句翻译转向AI工具调度+跨文化策略+质量把关" },
      { name: "土木 → 智能建造/低空技术与工程", detail: "2025年北航等6所双一流率先设立低空技术与工程，山大已整体转型" },
      { name: "美术/设计 → AI设计协作/数字内容创作", detail: "从手工+PS转向AI生成+创意指导+审美决策" },
      { name: "市场营销 → 数字营销/直播电商运营", detail: "从传统广告投放转向数据驱动+私域运营+内容电商" },
    ],
    verdict: "转型路径明确，主动迁移有价值",
  },
  {
    type: "品牌重塑", label: "REBRANDING", color: "#7C3AED", bg: "#F5F3FF",
    desc: "换了名字，内容没有实质变化——对考生最危险的陷阱",
    cases: [
      { name: "土木工程 → 建筑工程技术", detail: "改名避坑，核心课程、师资、就业方向几乎不变，毕业照样难就业" },
      { name: "信息管理 → 大数据管理方向", detail: "加了大数据前缀，但缺乏统计学、Python、SQL等硬核课程" },
      { name: "传统市场营销 → 数字营销管理", detail: "换了数字两字，真正的数字营销需要数据分析+平台运营能力" },
      { name: "广告学 → 整合营销传播", detail: "包装升级，就业市场认可度与原专业无显著差异" },
    ],
    verdict: "看课程设置，不看专业名称",
  },
];

const MACRO = [
  {
    title: "人文知识体系断层", risk: "高", timeline: "10—20年后显现",
    body: "哲学、历史、艺术等人文学科是社会道德反思、历史记忆和文化审美的承载体。2025届中国文科就业率仅58.3%，系统性压力将使这一知识体系的传承者愈发稀少。哈佛人文学科录取占比已从15.5%跌至12.5%（2025年），而中国的收缩速度远超于此：文科类专业在2024年撤销总量中占比近三成。",
  },
  {
    title: "技术创新动力削弱", risk: "中", timeline: "15年后成为约束",
    body: "创新本质是跨领域的认知碰撞。纯工具化教育培养的工程师缺乏人文素养，AI伦理无人深思，产品设计缺乏美学判断。德国制造业持续领跑全球，背后正是保留了系统基础学科的底层逻辑。",
  },
  {
    title: "高等教育异化为职培", risk: "高", timeline: "正在发生",
    body: "以「就业率」和「月薪」作为专业存废唯一标准，使大学从知识殿堂变成技能工厂。2026年目标调整全国高校20%学科专业——若追赶速度快于周期，将永远在错位中追赶：今天热门的专业，5年后可能又过时。",
  },
  {
    title: "社会弹性降低", risk: "中", timeline: "下一次技术洗牌时爆发",
    body: "专业窄化意味着劳动力再配置成本极高。当下一次技术革命来临，过度专精的技能体系将使大规模转型就业更加困难。宽口径通识教育恰恰是应对不确定性的护城河——这正是当前体系最欠缺的。",
  },
];

const MICRO = [
  {
    group: "2026届高三考生",
    tips: [
      "核心原则：选学校 > 选专业 > 选城市——平台效应在不确定时代的价值高于专业本身",
      "品牌重塑陷阱：看课程设置表而非专业名称，重点看是否有硬核必修课",
      "新专业风险：优先选有学科底蕴的学校开设的新专业，而非三本的AI专业",
      "大类招生是保险机制：给自己预留转专业空间，不要锁死在入学时的判断",
    ],
  },
  {
    group: "在读大学生",
    tips: [
      "被撤销不等于你的学位失效：教育部规定学生有权完成学业，法律保障到位",
      "警惕绝版生标签：用人单位更看重项目经历和技术能力，而非专业名称",
      "主动学习交叉技能：本专业知识 + AI工具 + 数据分析能力是当前最有竞争力的组合",
      "实习积累优先级高于GPA：在劳动力市场持续供大于求的环境下，实战经验才是护城河",
    ],
  },
  {
    group: "应届及近届毕业生",
    tips: [
      "2025年8月青年失业率18.9%史上最高：先上车再调整，第一份工作不必完全对口，先建立职业锚点",
      "关注专业变种路径：旧专业知识 + 新工具 = 新竞争力，翻译 + AI提示工程就是典型案例",
      "AI工具是通用加分项：不论何种专业背景，系统化学习AI工具使用效率能拉开代际差距",
      "二三线城市机会被严重低估：竞争强度仅为一线的1/3，而薪资差距远小于竞争差距",
    ],
  },
];

const DECLINE = [
  { name: "土木工程",           cat: "工程", risk: 93, note: "山东大学2025年停招27专业；湖南大学转出98人转入0人" },
  { name: "法学",               cat: "法学", risk: 91, note: "连续5年就业红牌（2021—2025）；市场严重饱和" },
  { name: "摄影",               cat: "艺术", risk: 90, note: "中传、川大已撤销；AI生成图像商业化落地" },
  { name: "绘画/美术学",        cat: "艺术", risk: 89, note: "连续5年就业红牌；AI绘画工具大规模应用" },
  { name: "翻译",               cat: "外语", risk: 88, note: "中传2025年已撤销；从业比例10年降64%" },
  { name: "视觉传达设计",       cat: "艺术", risk: 86, note: "2025届就业红牌；AI设计工具普及" },
  { name: "建筑学",             cat: "工程", risk: 85, note: "清华合并为大类；地产下行压缩高端岗位" },
  { name: "公共事业管理",       cat: "管理", risk: 83, note: "近5年115所高校撤销；多省就业率低于60%" },
  { name: "信息管理与信息系统", cat: "管理", risk: 82, note: "连续4年撤销排名第一；近5年160所高校撤销" },
  { name: "英语（大众外语）",   cat: "外语", risk: 74, note: "北大印地语2025年未招满；AI翻译全面替代" },
];

const RISE = [
  { name: "人工智能",           badge: "2025年新增89所", hot: true,  note: "连续5年新增最多，已布点超500所" },
  { name: "低空技术与工程",     badge: "2025年全新专业",  hot: true,  note: "北航等6所双一流首批，低空经济国家战略驱动" },
  { name: "电气工程及其自动化", badge: "2025届绿牌冠军",  hot: false, note: "需求持续旺盛，月均起薪超6900元" },
  { name: "微电子科学与工程",   badge: "国家芯片战略",    hot: false, note: "集成电路自主化核心，政策超常规支持" },
  { name: "机器人工程",         badge: "2025届绿牌",      hot: false, note: "制造业智能化升级核心，岗位缺口扩大" },
  { name: "新能源科学与工程",   badge: "2025届绿牌",      hot: false, note: "双碳政策驱动，薪资增速全行业前三" },
  { name: "碳中和科学与工程",   badge: "2025年新增",      hot: false, note: "国家双碳战略专门布局，2026年继续扩大" },
  { name: "智能制造工程",       badge: "+200布点/5年",    hot: false, note: "制造业升级主力方向，产学合作岗位充足" },
];

// ─── SPARKLINE ───────────────────────────────────────────────

function MiniSparkline({ data }: { data: { year: number; admit: number }[] }) {
  if (data.length < 2) return null;
  const W = 220, H = 50, P = 6;
  const vals = data.map(d => d.admit);
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0), rng = max - min || 1;
  const pts = data.map((d, i) => {
    const x = P + (i / (data.length - 1)) * (W - P * 2);
    const y = H - P - ((d.admit - min) / rng) * (H - P * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = vals[vals.length - 1], prev = vals[vals.length - 2];
  const color = last < prev * 0.9 ? "#DC2626" : "#059669";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 50 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {data.map((d, i) => {
        const x = P + (i / (data.length - 1)) * (W - P * 2);
        const y = H - P - ((d.admit - min) / rng) * (H - P * 2);
        return <circle key={i} cx={x} cy={y} r={2.5} fill={color} />;
      })}
    </svg>
  );
}

// ─── SEARCH ──────────────────────────────────────────────────

function MajorSearch() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [sugs, setSugs] = useState<string[]>([]);
  const [showSugs, setShowSugs] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.length < 2) { setSugs([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/api/major/search?q=${encodeURIComponent(q)}`);
        setSugs((await r.json()).suggestions || []);
      } catch {}
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowSugs(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  async function go(name: string) {
    if (!name.trim()) return;
    setLoading(true); setRes(null); setShowSugs(false);
    try { setRes(await (await fetch(`${API}/api/major/trend?name=${encodeURIComponent(name)}`)).json()); }
    catch { setRes({ error: true }); }
    finally { setLoading(false); }
  }

  const badge = (t: string) => {
    if (t === "declining") return { text: "↓ 招生萎缩", c: "#DC2626", bg: "#FEF2F2" };
    if (t === "rising")    return { text: "↑ 持续扩张", c: "#059669", bg: "#F0FDF4" };
    if (t === "stable")    return { text: "→ 基本平稳", c: "#D97706", bg: "#FFFBEB" };
    return { text: "数据不足", c: "#6B7280", bg: "#F9FAFB" };
  };

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 10 }}>
        <input className="apple-input" style={{ flex: 1 }}
          placeholder="输入专业名，如：土木工程、人工智能、法学..."
          value={q}
          onChange={e => { setQ(e.target.value); setShowSugs(true); }}
          onKeyDown={e => e.key === "Enter" && go(q)}
          onFocus={() => setShowSugs(true)}
        />
        <button className="btn-primary" onClick={() => go(q)} disabled={loading} style={{ minWidth: 88 }}>
          {loading ? <span className="spinner" style={{ width: 16, height: 16, display: "inline-block" }} /> : "查趋势 →"}
        </button>
      </div>
      {showSugs && sugs.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 96, background: "#fff", border: "1px solid rgba(26,39,68,0.1)", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.08)", zIndex: 50, overflow: "hidden" }}>
          {sugs.map((s, i) => (
            <div key={i}
              style={{ padding: "11px 16px", fontSize: 14, cursor: "pointer", color: "var(--color-text-primary)", borderBottom: i < sugs.length - 1 ? "1px solid rgba(26,39,68,0.05)" : "none" }}
              onMouseDown={() => { setQ(s); go(s); }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(26,39,68,0.03)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >{s}</div>
          ))}
        </div>
      )}
      {res && !res.error && (
        <div style={{ marginTop: 16, padding: "24px", background: "#F9F9F7", borderRadius: 12, border: "1px solid rgba(26,39,68,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "var(--color-navy)", letterSpacing: "-0.01em" }}>{res.major_name}</div>
              {res.category && <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 2 }}>{res.category}</div>}
            </div>
            {res.trend !== "unknown" && (() => {
              const b = badge(res.trend);
              return <span style={{ fontSize: 12, fontWeight: 700, color: b.c, background: b.bg, padding: "4px 12px", borderRadius: 6, border: `1px solid ${b.c}30` }}>{b.text}</span>;
            })()}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            {res.employment_rate > 0 && (
              <div style={{ padding: "16px", background: "#fff", borderRadius: 10, border: "1px solid rgba(26,39,68,0.06)" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: 6 }}>就业率</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: res.employment_rate < 0.6 ? "#DC2626" : "#059669", fontVariantNumeric: "tabular-nums" }}>{(res.employment_rate * 100).toFixed(1)}%</div>
              </div>
            )}
            {res.avg_salary > 0 && (
              <div style={{ padding: "16px", background: "#fff", borderRadius: 10, border: "1px solid rgba(26,39,68,0.06)" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: 6 }}>平均年薪</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: "var(--color-accent)", fontVariantNumeric: "tabular-nums" }}>¥{(res.avg_salary / 10000).toFixed(1)}万</div>
              </div>
            )}
          </div>
          {res.yearly?.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: 8 }}>历年全国录取人数趋势</div>
              <MiniSparkline data={res.yearly} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                {res.yearly.map((y: any) => (
                  <div key={y.year} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{y.year}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)" }}>{(y.admit / 1000).toFixed(0)}k</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {res?.error && <div style={{ marginTop: 16, fontSize: 13, color: "var(--color-text-tertiary)" }}>查询失败，请稍后重试</div>}
    </div>
  );
}

// ─── SECTION HEADING ─────────────────────────────────────────

function SecHead({ num, title, sub }: { num: string; title: string; sub: string }) {
  return (
    <div style={{ paddingTop: 64, paddingBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent)" }}>{num}</span>
        <div style={{ height: 1, flex: 1, background: "rgba(26,39,68,0.1)" }} />
      </div>
      <h2 style={{ fontSize: "clamp(22px, 3vw, 30px)", fontWeight: 900, color: "var(--color-navy)", letterSpacing: "-0.025em", margin: "0 0 6px" }}>{title}</h2>
      <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0, letterSpacing: "0.01em" }}>{sub}</p>
    </div>
  );
}

// ─── MAIN PAGE ───────────────────────────────────────────────

export default function MajorTrendPage() {
  const [activeNature, setActiveNature] = useState(0);
  const MAX_C = Math.max(...YEARLY.map(y => y.canceled), 1);
  const MAX_G = Math.max(...GRADUATES.map(g => g.total));
  const MAX_B = 1786;

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF8", fontFamily: "var(--font)" }}>

      {/* ── HEADER ── */}
      <header style={{
        background: "rgba(250,250,248,0.88)", backdropFilter: "blur(16px) saturate(180%)",
        WebkitBackdropFilter: "blur(16px) saturate(180%)",
        borderBottom: "1px solid rgba(26,39,68,0.08)",
        padding: "0 24px", height: 56,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Link href="/" style={{ fontWeight: 800, fontSize: 15, color: "var(--color-navy)", textDecoration: "none", letterSpacing: "-0.02em" }}>水卢高报</Link>
          <div style={{ width: 1, height: 16, background: "rgba(26,39,68,0.15)" }} />
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)", fontWeight: 500 }}>专业风向标</span>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(26,39,68,0.35)", background: "rgba(26,39,68,0.06)", padding: "3px 8px", borderRadius: 4, textTransform: "uppercase" }}>数据至 2026.04</span>
        </div>
        <AuthNav />
      </header>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "0 20px 120px" }}>

        {/* ══ HERO ══ */}
        <section style={{
          position: "relative", overflow: "hidden",
          background: "var(--color-navy)", borderRadius: 20,
          padding: "60px 52px 56px", margin: "24px 0 0", color: "#fff",
        }}>
          {/* ambient glows */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse 65% 55% at 88% 8%, rgba(201,146,42,0.2) 0%, transparent 60%)" }} />
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse 40% 40% at 12% 85%, rgba(124,58,237,0.12) 0%, transparent 60%)" }} />

          <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 44, alignItems: "flex-start" }}>

            {/* left: headline + sub */}
            <div>
              <div style={{ display: "inline-block", fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", padding: "5px 12px", borderRadius: 4, marginBottom: 28 }}>
                教育部官方数据 · 2026年4月
              </div>
              <h1 style={{ fontSize: "clamp(42px, 6vw, 66px)", fontWeight: 900, lineHeight: 1.0, letterSpacing: "-0.04em", margin: "0 0 22px" }}>
                大学专业<br />死亡潮
              </h1>
              <p style={{ fontSize: 15, lineHeight: 1.8, color: "rgba(255,255,255,0.52)", margin: 0, maxWidth: 360 }}>
                5年退场4,000+个专业布点。2025年出生人口792万创建国以来最低，2026届1,270万毕业生，青年失业率18.9%历史新高。经济转型、AI革命、人口断崖三重冲击叠加。
              </p>
            </div>

            {/* right: bento stats */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {/* top wide: cancellations */}
              <div style={{ gridColumn: "span 2", background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.18)", borderRadius: 12, padding: "18px 20px", display: "flex", gap: 24, alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 38, fontWeight: 900, color: "#FCA5A5", letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>1,428</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.58)", marginTop: 5 }}>专业点被撤销</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", marginTop: 2 }}>2024年度 · 教育部2025年4月22日</div>
                </div>
                <div style={{ width: 1, height: 44, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 38, fontWeight: 900, color: "#FCA5A5", letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>2,220</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.58)", marginTop: 5 }}>专业点停招</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", marginTop: 2 }}>2024年度 · 同批次公布</div>
                </div>
              </div>
              {/* birth */}
              <div style={{ background: "rgba(217,119,6,0.11)", border: "1px solid rgba(217,119,6,0.2)", borderRadius: 12, padding: "16px 16px" }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: "#FDE68A", letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>792万</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.58)", marginTop: 5 }}>2025年出生人口</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", marginTop: 2 }}>1949年以来最低</div>
              </div>
              {/* unemployment */}
              <div style={{ background: "rgba(124,58,237,0.13)", border: "1px solid rgba(124,58,237,0.22)", borderRadius: 12, padding: "16px 16px" }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: "#C4B5FD", letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>18.9%</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.58)", marginTop: 5 }}>青年失业率峰值</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", marginTop: 2 }}>2025年8月 · 历史最高</div>
              </div>
              {/* bottom wide: graduates */}
              <div style={{ gridColumn: "span 2", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "15px 20px", display: "flex", gap: 24, alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: "rgba(255,255,255,0.88)", letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>1,270万</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>2026届毕业生（预计）</div>
                </div>
                <div style={{ width: 1, height: 30, background: "rgba(255,255,255,0.07)", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: "rgba(255,255,255,0.88)", letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>4,000+</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>5年专业布点退场</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ══ CHARTS ══ */}
        <section style={{ marginTop: 14 }}>
          {/* birth pop */}
          <div style={{ background: "#fff", border: "1px solid rgba(26,39,68,0.07)", borderRadius: 16, padding: "26px 30px 22px", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(26,39,68,0.35)", marginBottom: 3 }}>全国出生人口趋势</div>
                <div style={{ fontSize: 12, color: "rgba(26,39,68,0.4)" }}>万人 · 2016—2025 · 国家统计局</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 26, fontWeight: 900, color: "#DC2626", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>792万</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#DC2626", marginTop: 3 }}>2025年 · 1949年以来最低</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 90 }}>
              {BIRTH_POP.map((b, i) => {
                const h = Math.max((b.pop / MAX_B) * 80, 4);
                const isOld = i < 6;
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    {b.record ? (
                      <div style={{ fontSize: 7, fontWeight: 800, color: "#DC2626", whiteSpace: "nowrap" }}>历史最低↓</div>
                    ) : b.rebound ? (
                      <div style={{ fontSize: 7, color: "#D97706", fontWeight: 700, whiteSpace: "nowrap" }}>龙年↑</div>
                    ) : (
                      <div style={{ height: 14 }} />
                    )}
                    <div style={{
                      width: "100%", height: h, borderRadius: "3px 3px 0 0",
                      background: b.record ? "#DC2626" : b.rebound ? "#D97706" : isOld ? "rgba(26,39,68,0.2)" : "var(--color-navy)",
                    }} />
                    <div style={{ fontSize: 7.5, fontWeight: isOld ? 400 : 700, fontVariantNumeric: "tabular-nums", color: b.record ? "#DC2626" : b.rebound ? "#D97706" : isOld ? "rgba(26,39,68,0.3)" : "var(--color-navy)" }}>{b.pop}</div>
                    <div style={{ fontSize: 7, color: "rgba(26,39,68,0.35)" }}>{b.year}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* dual: cancellations + graduates */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ background: "#fff", border: "1px solid rgba(26,39,68,0.07)", borderRadius: 16, padding: "22px 24px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(26,39,68,0.35)", marginBottom: 3 }}>年度撤销专业点数</div>
              <div style={{ fontSize: 11, color: "rgba(26,39,68,0.35)", marginBottom: 18 }}>2019—2025</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 7, height: 86 }}>
                {YEARLY.map((y, i) => {
                  const pct = y.confirmed ? y.canceled / MAX_C : 0;
                  const isPeak = i === 4;
                  return (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      {y.note && y.confirmed
                        ? <div style={{ fontSize: 7, color: isPeak ? "#DC2626" : "rgba(26,39,68,0.4)", fontWeight: 700, whiteSpace: "nowrap", textAlign: "center" }}>{isPeak ? y.note : ""}</div>
                        : <div style={{ height: 12 }} />}
                      <div style={{
                        width: "100%", borderRadius: "3px 3px 0 0",
                        background: y.confirmed ? (isPeak ? "#DC2626" : i === 5 ? "#F97316" : "var(--color-navy)") : "transparent",
                        border: y.confirmed ? "none" : "1.5px dashed rgba(26,39,68,0.18)",
                        height: y.confirmed ? `${pct * 68}px` : "20px",
                        minHeight: 4,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {!y.confirmed && <span style={{ fontSize: 7, color: "rgba(26,39,68,0.3)" }}>待公布</span>}
                      </div>
                      <div style={{ fontSize: 9, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: y.confirmed ? (isPeak ? "#DC2626" : "rgba(26,39,68,0.55)") : "rgba(26,39,68,0.3)" }}>
                        {y.confirmed ? y.canceled : "—"}
                      </div>
                      <div style={{ fontSize: 7.5, color: "rgba(26,39,68,0.35)" }}>{y.year}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ background: "#fff", border: "1px solid rgba(26,39,68,0.07)", borderRadius: 16, padding: "22px 24px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(26,39,68,0.35)", marginBottom: 3 }}>历届毕业生规模</div>
              <div style={{ fontSize: 11, color: "rgba(26,39,68,0.35)", marginBottom: 18 }}>万人 · 2021—2026</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 7, height: 86 }}>
                {GRADUATES.map((g, i) => {
                  const pct = g.total / MAX_G;
                  return (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <div style={{ height: 12 }} />
                      <div style={{
                        width: "100%", borderRadius: "3px 3px 0 0",
                        height: `${pct * 76}px`, minHeight: 4,
                        background: g.forecast ? "transparent" : g.peak ? "#D97706" : "var(--color-navy)",
                        border: g.forecast ? "2px dashed #D97706" : "none",
                      }} />
                      <div style={{ fontSize: 9, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: (g.peak || g.forecast) ? "#D97706" : "rgba(26,39,68,0.55)" }}>{g.total}</div>
                      <div style={{ fontSize: 7.5, color: "rgba(26,39,68,0.35)" }}>{g.year}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 10, color: "rgba(26,39,68,0.35)" }}>
                <span>■ 已确认</span>
                <span style={{ color: "#D97706" }}>■ 峰值 / 预计</span>
              </div>
            </div>
          </div>
        </section>

        {/* ══ §01 WHY ══ */}
        <SecHead num="01" title="为什么会发生？" sub="五重力量同步叠加，不是偶然，是系统性重构" />
        <div>
          {CAUSES.map((c, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "48px 1fr", gap: 20, padding: "26px 0", borderBottom: i < CAUSES.length - 1 ? "1px solid rgba(26,39,68,0.07)" : "none" }}>
              <div style={{ paddingTop: 2 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", color: "var(--color-accent)" }}>{c.num}</div>
                <div style={{ width: 18, height: 2, background: "var(--color-accent)", opacity: 0.4, borderRadius: 1, marginTop: 7 }} />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
                  <h3 style={{ fontSize: 17, fontWeight: 800, color: "var(--color-navy)", margin: 0, letterSpacing: "-0.01em" }}>{c.title}</h3>
                  <span style={{ fontSize: 12, color: "rgba(26,39,68,0.4)" }}>{c.subtitle}</span>
                </div>
                {c.paras.map((p, j) => (
                  <p key={j} style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.8, margin: "0 0 8px" }}>{p}</p>
                ))}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {c.pills.map((d, j) => (
                    <div key={j} style={{ display: "inline-flex", alignItems: "baseline", gap: 6, padding: "4px 10px", borderRadius: 5, background: "rgba(26,39,68,0.04)", border: "1px solid rgba(26,39,68,0.08)" }}>
                      <span style={{ fontSize: 11, color: "rgba(26,39,68,0.4)" }}>{d.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-navy)", fontVariantNumeric: "tabular-nums" }}>{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ══ §02 NATURE ══ */}
        <SecHead num="02" title="真死亡？假死亡？还是变种？" sub="这是最关键的判断——直接决定你的应对策略" />
        <div style={{ background: "#fff", border: "1px solid rgba(26,39,68,0.07)", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderBottom: "1px solid rgba(26,39,68,0.07)" }}>
            {NATURE_TABS.map((n, i) => (
              <button key={i} onClick={() => setActiveNature(i)} style={{
                padding: "15px 8px 13px", cursor: "pointer", border: "none",
                fontFamily: "var(--font)",
                background: activeNature === i ? n.bg : "transparent",
                borderBottom: `2px solid ${activeNature === i ? n.color : "transparent"}`,
                transition: "all 0.15s",
              }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: activeNature === i ? n.color : "rgba(26,39,68,0.28)", marginBottom: 5 }}>{n.label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: activeNature === i ? "var(--color-navy)" : "var(--color-text-secondary)" }}>{n.type}</div>
              </button>
            ))}
          </div>
          {(() => {
            const n = NATURE_TABS[activeNature];
            return (
              <div style={{ padding: "26px 28px" }}>
                <div style={{ padding: "11px 15px", background: n.bg, borderLeft: `3px solid ${n.color}`, borderRadius: "0 8px 8px 0", fontSize: 14, color: "var(--color-text-secondary)", marginBottom: 18, lineHeight: 1.65 }}>{n.desc}</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {n.cases.map((c, j) => (
                    <div key={j} style={{ display: "grid", gridTemplateColumns: "10px 1fr", gap: 14, padding: "13px 15px", background: "#FAFAF8", borderRadius: 10 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: n.color, marginTop: 6, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-navy)", marginBottom: 4 }}>{c.name}</div>
                        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{c.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16, padding: "11px 15px", background: "rgba(26,39,68,0.04)", borderRadius: 8, fontSize: 13, color: "var(--color-text-secondary)", display: "flex", gap: 8 }}>
                  <span style={{ fontWeight: 800, color: n.color, flexShrink: 0 }}>结论 →</span>{n.verdict}
                </div>
              </div>
            );
          })()}
        </div>

        {/* ══ §03a WHAT IT MEANS ══ */}
        <SecHead num="03a" title="它预示着什么？" sub="这一轮洗牌完成后，高等教育的底层逻辑将永久改变" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { tag: "A", t: "专业壁垒正在瓦解", b: "AI使\"学了4年才能做\"的技能变成\"用工具3个月上手\"。传统学科的职业保护正失效，个人能力的透明度在上升，学历的信号价值在相对下降。" },
            { tag: "B", t: "T型人才溢价扩大", b: "一个深度方向+跨领域整合能力的组合正在稀缺定价。纯单专业迅速贬值，技术+人文、工程+商业的复合背景愈发受欢迎。" },
            { tag: "C", t: "知识半衰期压缩至5年", b: "专业知识从20年过时周期压缩至5年以内。大学4年学到的专业技能，毕业时可能已有更新版本。持续学习能力将取代一次性学历认证。" },
            { tag: "D", t: "学校品牌溢价持续上升", b: "在哪里学比学什么更重要的趋势正在强化。顶尖高校的师资、平台资源和校友网络，将成为比专业名称更有价值的资产。" },
          ].map((item, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid rgba(26,39,68,0.07)", borderRadius: 14, padding: "22px 22px" }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--color-navy)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, marginBottom: 14 }}>{item.tag}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--color-navy)", marginBottom: 8, letterSpacing: "-0.01em" }}>{item.t}</div>
              <p style={{ fontSize: 13.5, color: "var(--color-text-secondary)", lineHeight: 1.72, margin: 0 }}>{item.b}</p>
            </div>
          ))}
        </div>

        {/* ══ §03b MACRO ══ */}
        <SecHead num="03b" title="宏观影响：对社会意味着什么？" sub="短期是结构优化，长期存在隐忧；两者都不能只看一面" />
        <div style={{ display: "grid", gap: 8 }}>
          {MACRO.map((m, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid rgba(26,39,68,0.07)", borderRadius: 14, padding: "20px 24px", display: "grid", gridTemplateColumns: "1fr auto", gap: 20, alignItems: "flex-start" }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: "var(--color-navy)", margin: "0 0 10px", letterSpacing: "-0.01em" }}>{m.title}</h3>
                <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.75, margin: 0 }}>{m.body}</p>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: m.risk === "高" ? "#DC2626" : "#D97706", background: m.risk === "高" ? "#FEF2F2" : "#FFFBEB", padding: "3px 10px", borderRadius: 4, display: "inline-block", marginBottom: 5 }}>风险 {m.risk}</div>
                <div style={{ fontSize: 10, color: "rgba(26,39,68,0.4)", whiteSpace: "nowrap" }}>{m.timeline}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, background: "var(--color-navy)", borderRadius: 14, padding: "26px 30px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.25)", marginBottom: 10 }}>对照组</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 8 }}>德国：坚守基础学科</div>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.65, margin: 0 }}>即使不赚钱的学科也保留基础布局，持续吸引全球顶尖学生。制造业创新领先全球，背后是跨学科底层积累。</p>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.25)", marginBottom: 10 }}>历史参照</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 8 }}>日本1991年：给高校自主权</div>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.65, margin: 0 }}>放宽大纲管制、让高校自主设课，而非用产业KPI直接约束。结果高等教育质量反而提升，新专业大量涌现。</p>
          </div>
        </div>

        {/* ══ §03c MICRO ══ */}
        <SecHead num="03c" title="微观影响：对个人意味着什么？" sub="不同处境，不同策略——找到属于你的那一行" />
        <div style={{ display: "grid", gap: 10 }}>
          {MICRO.map((m, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid rgba(26,39,68,0.07)", borderRadius: 14, padding: "22px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", background: "var(--color-navy)", color: "#fff", padding: "3px 9px", borderRadius: 4 }}>{String(i + 1).padStart(2, "0")}</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: "var(--color-navy)", letterSpacing: "-0.01em" }}>{m.group}</span>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {m.tips.map((t, j) => (
                  <div key={j} style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 10, padding: "10px 13px", background: "#FAFAF8", borderRadius: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--color-accent)", paddingTop: 2, fontVariantNumeric: "tabular-nums" }}>{j + 1}</span>
                    <span style={{ fontSize: 14, color: "var(--color-text-primary)", lineHeight: 1.6 }}>{t}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ══ §04 RANKINGS ══ */}
        <SecHead num="04" title="哪些专业在衰退，哪些在崛起？" sub="基于招生数据、就业红绿牌、政策信号的综合判断（截至2026年4月）" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* decline */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div style={{ width: 14, height: 2, background: "#DC2626", borderRadius: 1 }} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#DC2626" }}>高风险专业 · Top 10</span>
            </div>
            <div style={{ background: "#fff", border: "1px solid rgba(26,39,68,0.07)", borderRadius: 14, overflow: "hidden" }}>
              {DECLINE.map((d, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "26px 1fr auto", gap: 10, alignItems: "center", padding: "11px 14px", borderBottom: i < DECLINE.length - 1 ? "1px solid rgba(26,39,68,0.05)" : "none" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(26,39,68,0.22)", fontVariantNumeric: "tabular-nums" }}>{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-navy)" }}>{d.name}</div>
                    <div style={{ fontSize: 10, color: "rgba(26,39,68,0.4)", marginTop: 2, lineHeight: 1.4 }}>{d.note}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 800, color: d.risk >= 90 ? "#DC2626" : "#F97316", background: d.risk >= 90 ? "#FEF2F2" : "#FFF7ED", padding: "3px 8px", borderRadius: 4, flexShrink: 0 }}>{d.risk}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* rise */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div style={{ width: 14, height: 2, background: "#059669", borderRadius: 1 }} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#059669" }}>快速崛起专业</span>
            </div>
            <div style={{ background: "#fff", border: "1px solid rgba(26,39,68,0.07)", borderRadius: 14, overflow: "hidden" }}>
              {RISE.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 14px", borderBottom: i < RISE.length - 1 ? "1px solid rgba(26,39,68,0.05)" : "none", background: r.hot ? "rgba(5,150,105,0.03)" : "transparent" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-navy)" }}>{r.name}</span>
                      {r.hot && <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.06em", background: "#059669", color: "#fff", padding: "2px 5px", borderRadius: 3 }}>HOT</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(26,39,68,0.4)", lineHeight: 1.4 }}>{r.note}</div>
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 700, color: "#059669", background: "rgba(5,150,105,0.1)", padding: "2px 7px", borderRadius: 4, flexShrink: 0, marginTop: 2, whiteSpace: "nowrap" }}>{r.badge}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, padding: "12px 14px", background: "#FFFBEB", border: "1px solid rgba(217,119,6,0.14)", borderRadius: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#92400E", marginBottom: 4 }}>⚠ 核心警告</div>
              <div style={{ fontSize: 12, color: "#78350F", lineHeight: 1.6 }}>新专业≠安全。优先选<strong>有学科积淀的学校</strong>开设的新专业，而非追逐名称热度。</div>
            </div>
          </div>
        </div>

        {/* ══ §05 SEARCH ══ */}
        <SecHead num="05" title="专业安全自检" sub="基于229万条历年录取数据，查你关心的专业招生趋势" />
        <div style={{ background: "#fff", border: "1px solid rgba(26,39,68,0.07)", borderRadius: 16, padding: "28px 30px" }}>
          <MajorSearch />
        </div>

        {/* ══ CTA ══ */}
        <section style={{ marginTop: 56 }}>
          <div style={{ position: "relative", overflow: "hidden", background: "var(--color-navy)", borderRadius: 20, padding: "52px 44px 48px", textAlign: "center" }}>
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse 60% 55% at 50% 0%, rgba(201,146,42,0.22) 0%, transparent 65%)" }} />
            <div style={{ position: "relative" }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)", marginBottom: 18 }}>下一步</div>
              <h2 style={{ fontSize: "clamp(22px, 3vw, 30px)", fontWeight: 900, color: "#fff", margin: "0 0 12px", letterSpacing: "-0.025em" }}>专业趋势只是第一步</h2>
              <p style={{ fontSize: 15, color: "rgba(255,255,255,0.48)", margin: "0 0 32px", lineHeight: 1.75 }}>
                结合你的高考位次，精准匹配录取概率高、<br />专业前景好、性价比高的院校
              </p>
              <Link href="/" style={{ display: "inline-block", background: "var(--color-accent)", color: "#fff", padding: "14px 40px", borderRadius: 99, fontWeight: 700, fontSize: 15, textDecoration: "none", letterSpacing: "-0.01em" }}>
                输入位次，开始志愿规划 →
              </Link>
              <div style={{ marginTop: 20, fontSize: 10, color: "rgba(255,255,255,0.2)", letterSpacing: "0.05em" }}>
                3,217所高校 · 229万条录取数据 · ¥1.99完整报告
              </div>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
