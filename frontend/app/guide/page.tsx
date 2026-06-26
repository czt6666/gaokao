"use client";
import { useRouter } from "next/navigation";
import React from "react";

const NAVY = "var(--color-navy)";
const ACCENT = "var(--color-accent)";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginTop: 36, scrollMarginTop: 70 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: NAVY, borderLeft: `4px solid ${ACCENT}`, paddingLeft: 12, marginBottom: 14 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 14, lineHeight: 1.8, color: "var(--color-text-secondary)", margin: "8px 0" }}>{children}</p>;
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1e3a5f", margin: "20px 0 8px" }}>{children}</h3>;
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "10px 14px", margin: "10px 0", fontSize: 13, color: "#92400E", lineHeight: 1.7 }}>
      💡 {children}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div style={{ overflowX: "auto", margin: "12px 0" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} style={{ textAlign: "left", padding: "8px 10px", background: "var(--color-bg-secondary)", color: NAVY, fontWeight: 700, borderBottom: "2px solid var(--color-separator)", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} style={{ padding: "8px 10px", borderBottom: "1px solid var(--color-separator)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Shot({ src, caption }: { src: string; caption: string }) {
  return (
    <figure style={{ margin: "14px 0" }}>
      <img
        src={src}
        alt={caption}
        loading="lazy"
        style={{ width: "100%", borderRadius: 10, border: "1px solid var(--color-separator)", display: "block" }}
      />
      <figcaption style={{ fontSize: 12, color: "var(--color-text-tertiary)", textAlign: "center", marginTop: 6 }}>{caption}</figcaption>
    </figure>
  );
}

const FAQ: { q: string; a: string }[] = [
  { q: "2026 年位次 / 分数怎么换算？", a: "目前各省正陆续公布成绩，请直接用成绩单上的真实位次查询。系统根据各省一分一段表做分数与位次互转，若你只有分数，也能换算出对应位次。每年试题难度不同，分数波动大，位次更稳定。若换算结果与考试院公布不一致，以官方一分一段表为准。" },
  { q: "数据从哪来？准不准？", a: "整合 2017–2025 各省公开录取数据、2026 招生计划、学科评估、招聘与口碑数据。数据量大但不等于百分百准确：不同来源统计口径可能不同，部分省份更新有先后，预测基于历史规律，高考每年都有波动。仅供参考，填报前请对照官方招生简章核实。" },
  { q: "可以直接按推荐结果填报吗？", a: "不可以直接照搬。本系统根据历年录取数据做概率预测，不一定准确，仅作为选校参考。正式填报必须在各省考试院官方系统操作，且需自行核对选科要求、体检限制、招生章程等。" },
  { q: "艺术生 / 体育生能用吗？", a: "不能。本系统面向普通类（文化科）考生，不支持艺术类、体育类、高水平艺术团/运动队等特殊类型招生。" },
  { q: "在哪下单付费？", a: "在查询结果页付费，不在首页。步骤：完成查询 → 进入结果页 → 点「解锁完整报告」或锁定学校 → 登录 → 选方案 → 微信支付。" },
  { q: "推荐学校和我的位次差距很大，能用吗？", a: "可以当作冲 / 稳志愿参考，但差距越大风险越高。系统会标注录取概率，概率低的属于「冲」档。请自行核实该校往年录取位次和今年招生计划变化。" },
  { q: "支持微信和手机号绑定吗？", a: "暂不支持。目前仅支持手机号验证码登录，微信账号与手机号暂不能互绑或合并。请牢记登录手机号，换号后历史订单可能无法找回。" },
  { q: "PDF 报告导出很慢？", a: "PDF 需汇总全部学校分析，生成通常需数十秒到几分钟，请耐心等待，不要重复点击。若长时间无响应，刷新后在个人中心「已购报告」重试。" },
  { q: "提示「数据建设中」/ 查不到结果怎么办？", a: "先检查筛选条件是不是太严苛：① 批次别只勾了「专科」——查本科要选「本科批」，否则会把本科专业全部过滤掉，结果自然为空；② 专业门类、城市、层次、性质等限定越多，结果越少，可先放宽或清空再查。条件确认无误仍为空，多为该省数据正在入库完善中。" },
  { q: "部分省份查不到 / 数据少？", a: "各省出分时间不同，数据入库有先后。出分较晚的省份请耐心等待。海南、西藏等省份数据尚在完善，结果偏少属正常。" },
  { q: "只有模考成绩能用吗？", a: "现在已进入出分阶段，建议直接用成绩单上的真实位次查询。模考成绩或预估位次只适合出分前体验，出分后若仍用估算位次，推荐结果没有参考价值。" },
  { q: "结果和预期差很多？", a: "依次检查：① 省份是否选对 ② 选科是否选对 ③ 位次是否填对。三项任一错误都会导致结果偏差很大。" },
  { q: "能退款吗？", a: "不能。虚拟数字商品，支付成功即交付，不支持退款。" },
  { q: "佣金何时到账？怎么提现？", a: "好友通过你的邀请链接付费后，佣金冻结 15 天，之后转入可提现余额。满 ¥100 可在个人中心申请提现。" },
  { q: "遇到问题怎么联系？", a: "网站首页底部点「意见反馈」，或页面右下角绿色 💬 按钮，填写问题描述后提交。" },
];

export default function GuidePage() {
  const router = useRouter();
  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)" }}>
      <nav className="apple-nav" style={{ position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={() => router.back()} className="btn-ghost" style={{ fontSize: 14, paddingLeft: 0, paddingRight: 0 }}>← 返回</button>
          <span style={{ fontSize: 15, fontWeight: 600 }}>使用教程</span>
          <div style={{ width: 60 }} />
        </div>
      </nav>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px 80px" }}>
        {/* Cover */}
        <div style={{ borderRadius: 16, padding: "28px 22px", background: "linear-gradient(160deg, #0f172a 0%, #1e3a5f 60%, #c9922a 200%)", color: "#fff", marginBottom: 24 }}>
          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>完整版 · 使用说明</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 6px" }}>水卢冷门高报引擎</h1>
          <div style={{ fontSize: 14, opacity: 0.9 }}>输入位次，查录取概率，发现冷门好校</div>
          <div style={{ marginTop: 14, fontSize: 15, fontWeight: 700 }}>www.theyuanxi.cn</div>
        </div>

        {/* Disclaimer */}
        <div style={{ background: "#fef2f2", border: "2px solid #dc2626", borderRadius: 10, padding: "12px 16px", textAlign: "center", marginBottom: 8 }}>
          <strong style={{ display: "block", fontSize: 14, color: "#dc2626", marginBottom: 2 }}>推荐结果仅供参考，谨慎报考</strong>
          <span style={{ fontSize: 12, color: "#991b1b" }}>所有预测基于历史数据，最终请以各省考试院和高校招生简章为准。</span>
        </div>

        <Section id="intro" title="一、产品简介">
          <P>一句话：输入高考<strong>位次 + 省份 + 选科</strong>，系统给出能报的学校、录取概率，以及同分段里被低估的「冷门宝藏」。</P>
          <P>传统工具按分数线「排队」；水卢在同一分数段里帮你找<strong>就业更好、学科更强、但分数线还没涨</strong>的选项。</P>
          <P>打开 www.theyuanxi.cn 即可使用，支持 31 省、三种高考模式，微信内也能打开。</P>
        </Section>

        <Section id="start" title="二、3 步上手">
          <H3>第 1 步：填位次、选省份和选科</H3>
          <P>打开首页，选省份，填全省位次（出分前可用分数估算），选满选考科目，点「查询」。</P>
          <Shot src="/guide/01-home.png" caption="图 1：首页 — 填省份、位次、选科" />
          <Shot src="/guide/02-basic.png" caption="图 2：填写位次与选科（务必填位次，比分数更准）" />
          <Tip>务必填「位次」而非「分数」，位次比分数更准。位次在一分一段表或成绩单上可查。省份、选科任一项填错，结果都会偏差。</Tip>

          <H3>第 2 步（可选）：专业 / 偏好筛选</H3>
          <P>点「专业筛选」可按门类 / 专业类 / 批次限定方向，也可展开偏好约束限定城市、层次等。不填则推荐全部。</P>
          <Shot src="/guide/03-filter-major.png" caption="图 3：专业筛选（门类 / 专业类 / 批次）" />
          <Shot src="/guide/04-filter-pref.png" caption="图 4：偏好约束（城市 / 层次 / 性质）" />

          <H3>第 3 步：查看结果</H3>
          <P>等几秒跳转结果页，学校按<strong>冲 / 稳 / 保 / 冷门宝藏</strong>分类展示。</P>
          <Shot src="/guide/05-results-list.png" caption="图 5：结果列表" />
          <Shot src="/guide/06-results-card.png" caption="图 6：学校卡片详情" />
          <Tip>志愿表建议：冲放前面搏一下，稳放中间作主力，保放后面防滑档。</Tip>
        </Section>

        <Section id="results" title="三、看懂结果页">
          <Table
            head={["标签", "概率", "含义"]}
            rows={[
              ["冲", "25%～55%", "有难度，值得一搏"],
              ["稳", "55%～82%", "主力志愿区间"],
              ["保", "≥ 82%", "兜底防滑档"],
              ["冷门宝藏", "—", "同分段性价比最高的隐藏选项"],
            ]}
          />
          <P>卡片上的录取概率、去年最低分/位次、趋势箭头（↑变难 ↓变容易）可直接对比。点「查看推荐理由」可看完整分析。</P>
          <H3>免费 vs 付费</H3>
          <Table
            head={["内容", "未付费", "付费后"]}
            rows={[
              ["学校列表", "✅ 可见", "✅"],
              ["每类前 2 所完整数据", "✅", "✅"],
              ["其余学校详情", "打码 / 锁定", "全部解锁"],
              ["PDF 报告", "❌", "✅"],
            ]}
          />
        </Section>

        <Section id="gem" title="四、冷门原理">
          <P>热门城市 + 热门专业把分数线炒高；有些学校专业实力不差、名字朴素或位置偏，报的人少、分数偏低——这就是「捡漏」机会。</P>
          <P>系统从 7 个角度交叉验证：城市折扣、名字矫正、小年窗口、学科溢价、口碑滞后、产业趋势、委培定向。命中多种信号 → 标为「冷门宝藏」。</P>
          <Table
            head={["维度", "说明"]}
            rows={[
              ["认知差距", "薪资 / 实力强，但报考热度低"],
              ["薪资错配", "录取分不高，毕业薪资偏高"],
              ["产业动能", "所在行业未来 4～5 年上升"],
              ["供需稀缺", "全国招生少，毕业生供给稀缺"],
            ]}
          />
          <Tip>冷门 ≠ 差学校，而是「同样的分，能进更强的平台」。预测均有不确定性，请以官方招生简章为准。</Tip>
        </Section>

        <Section id="data" title="五、数据来源">
          <ul style={{ fontSize: 14, lineHeight: 1.9, color: "var(--color-text-secondary)", paddingLeft: 20 }}>
            <li><strong>2017–2025 全国录取数据</strong>：数百万条逐专业位次，覆盖 3,000+ 校、31 省</li>
            <li><strong>2026 招生计划</strong>：计划人数、学费、选科要求</li>
            <li>一分一段表、教育部学科评估、软科排名</li>
            <li><strong>A 股上市公司招聘数据</strong>：校准专业薪资与行业前景</li>
            <li><strong>10 万+ 在校生口碑</strong>：满意度、就业评价</li>
          </ul>
          <P>数据基于公开来源整合，预测仅供参考，最终以各省考试院和高校招生简章为准。</P>
        </Section>

        <Section id="price" title="六、定价方案">
          <Table
            head={["档位", "价格", "内容"]}
            rows={[
              ["试看报告", "¥9.9", "每类解锁前 3 所完整分析"],
              ["单次完整报告", "¥39", "本次查询全部学校 + PDF 下载"],
              ["2026 填报季会员", "¥99", "至 2026.9.1，无限次查询 + 全部功能"],
            ]}
          />
          <Tip>位次定了、只查一次 → ¥39；模考阶段要反复调志愿 → ¥99 季卡（查 3 次以上更划算）。虚拟商品，支付即交付，不支持退款。</Tip>
        </Section>

        <Section id="pay" title="七、付费流程">
          <P><strong>在结果页操作</strong>，不在首页或定价页直接付款：</P>
          <ol style={{ fontSize: 14, lineHeight: 1.9, color: "var(--color-text-secondary)", paddingLeft: 20 }}>
            <li>完成查询，进入结果页</li>
            <li>点击「解锁完整报告」或带 🔒 的锁定内容</li>
            <li>先登录（手机号验证码，首次自动注册）</li>
            <li>选择方案 → 微信支付</li>
          </ol>
          <Shot src="/guide/07-login.png" caption="图 7：登录页面（手机号验证码）" />
          <Shot src="/guide/08-plan.png" caption="图 8：选择付费方案" />
          <Shot src="/guide/09-pay.png" caption="图 9：微信支付" />
          <P>付完自动刷新解锁。若未解锁：等 10 秒 → 点「我已支付，刷新状态」→ 仍不行请在网站「意见反馈」说明订单情况。</P>
          <P>支付方式：电脑浏览器 → 微信扫码；微信内打开 → 直接唤起微信支付。</P>
        </Section>

        <Section id="referral" title="八、分销与提现">
          <H3>邀请奖励</H3>
          <P>登录 → 个人中心 →「复制专属邀请链接」→ 发给朋友。朋友通过链接付费后：你获得 3 天免费会员（可叠加）；累计邀请 4 人付费 → 额外 +30 天会员。</P>
          <H3>现金佣金</H3>
          <Table
            head={["规则", "说明"]}
            rows={[
              ["比例", "好友实付金额的 30%"],
              ["冻结", "15 天后转入可提现余额"],
              ["提现", "满 ¥100 在个人中心申请"],
            ]}
          />
          <P>链接格式：www.theyuanxi.cn/?ref=你的邀请码。例：邀 10 人各买 ¥39 → 佣金约 ¥117。</P>
          <Shot src="/guide/10-dashboard.png" caption="图 10：个人中心 — 会员状态、邀请链接、佣金提现" />
        </Section>

        <Section id="more" title="九、其他功能">
          <P><strong>志愿表</strong>：收藏学校、拖拽排序，自动标冲/稳/保。<strong>对比</strong>：最多 3 校并排。<strong>AI 助手</strong>：问学校/专业/城市选择。<strong>专业风向标</strong>：看专业近 5 年趋势。</P>
        </Section>

        <Section id="faq" title="十、常见问题 FAQ">
          {FAQ.map((f, i) => (
            <div key={i} style={{ borderBottom: "1px solid var(--color-separator)", padding: "12px 0" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Q：{f.q}</div>
              <div style={{ fontSize: 13, lineHeight: 1.8, color: "var(--color-text-secondary)" }}>{f.a}</div>
            </div>
          ))}
        </Section>

        <div style={{ textAlign: "center", marginTop: 40, fontSize: 12, color: "var(--color-text-tertiary)" }}>
          水卢冷门高报引擎 · www.theyuanxi.cn · 文档版本 2026.06
        </div>
      </div>
    </div>
  );
}
