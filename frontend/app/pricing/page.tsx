"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const PLANS = [
  {
    key: "trial",
    price: "9.9",
    unit: "元",
    name: "试看报告",
    badge: "体验",
    badgeColor: "#0EA5E9",
    desc: "适合想先了解报告质量的用户",
    features: [
      { text: "每类院校解锁前 3 所", included: true },
      { text: "冲 / 稳 / 保 / 冷门宝藏 各 3 所", included: true },
      { text: "完整录取概率分析", included: true },
      { text: "就业薪资与趋势", included: true },
      { text: "全部 96 所院校分析", included: false },
      { text: "无限次重新查询", included: false },
      { text: "PDF 报告下载", included: false },
    ],
    cta: "¥9.9 试看",
    ctaBg: "#0EA5E9",
    productType: "trial_report",
  },
  {
    key: "single",
    price: "39",
    unit: "元",
    name: "单次完整报告",
    badge: "推荐",
    badgeColor: "var(--color-accent)",
    desc: "本次查询的全部院校完整分析",
    features: [
      { text: "全部院校逐一深度分析", included: true },
      { text: "冲 / 稳 / 保 / 冷门宝藏 完整展示", included: true },
      { text: "录取概率 + 安全线 + 风险提醒", included: true },
      { text: "近 3 年分数线趋势图", included: true },
      { text: "在读生真实口碑", included: true },
      { text: "本次查询永久解锁", included: true },
      { text: "无限次重新查询", included: false },
      { text: "PDF 报告下载", included: true },
    ],
    cta: "¥39 解锁单次",
    ctaBg: "var(--color-accent)",
    productType: "single_report",
    highlight: true,
  },
  {
    key: "season",
    price: "99",
    unit: "元",
    name: "2026 填报季会员",
    badge: "超值",
    badgeColor: "var(--color-navy)",
    desc: "即日起至 2026年9月1日 · 无限次查询",
    features: [
      { text: "包含「单次完整报告」全部内容", included: true },
      { text: "期内无限次重新查询", included: true },
      { text: "位次微调随时重查", included: true },
      { text: "冲 / 稳 / 保 动态调整建议", included: true },
      { text: "志愿表收藏与管理", included: true },
      { text: "院校对比工具", included: true },
      { text: "PDF 报告随时下载", included: true },
      { text: "有效期至 2026年9月1日", included: true },
    ],
    cta: "¥99 开通季会员",
    ctaBg: "var(--color-navy)",
    productType: "season_2026",
  },
];

export default function PricingPage() {
  const router = useRouter();
  const [annual, setAnnual] = useState(false);

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text-primary)" }}>
      {/* Nav */}
      <nav className="apple-nav">
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 20px", height: 48, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={() => router.back()} className="btn-ghost" style={{ fontSize: 14, color: "var(--color-text-secondary)", paddingLeft: 0, paddingRight: 0 }}>← 返回</button>
          <span style={{ fontSize: 14, fontWeight: 600 }}>选择方案</span>
          <span style={{ width: 40 }} />
        </div>
      </nav>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 20px 48px" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 8, lineHeight: 1.2 }}>
            解锁你的冷门志愿报告
          </div>
          <div style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
            三种方案，满足不同阶段需求。所有方案均基于 2017–2025 真实录取数据。
          </div>
        </div>

        {/* Comparison Table — Desktop */}
        <div className="pricing-table-desktop" style={{ display: "none" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "12px 8px", borderBottom: "1px solid var(--color-separator)", fontWeight: 500, color: "var(--color-text-tertiary)" }}>功能对比</th>
                {PLANS.map((p) => (
                  <th key={p.key} style={{ textAlign: "center", padding: "12px 8px", borderBottom: "1px solid var(--color-separator)", minWidth: 140 }}>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{p.name}</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: p.highlight ? "var(--color-accent)" : "var(--color-text-primary)" }}>¥{p.price}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PLANS[2].features.map((_, idx) => (
                <tr key={idx}>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--color-separator)", color: "var(--color-text-secondary)" }}>{PLANS[2].features[idx]?.text || ""}</td>
                  {PLANS.map((p) => {
                    const f = p.features[idx];
                    if (!f) return <td key={p.key} style={{ textAlign: "center", padding: "10px 8px", borderBottom: "1px solid var(--color-separator)" }}>—</td>;
                    return (
                      <td key={p.key} style={{ textAlign: "center", padding: "10px 8px", borderBottom: "1px solid var(--color-separator)", fontWeight: f.included ? 600 : 400, color: f.included ? "#059669" : "var(--color-text-tertiary)" }}>
                        {f.included ? "✓" : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Cards — Mobile */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {PLANS.map((p) => (
            <div
              key={p.key}
              style={{
                borderRadius: 16,
                border: p.highlight ? "2px solid var(--color-accent)" : "1px solid var(--color-separator)",
                background: p.highlight ? "rgba(201,146,42,0.03)" : "var(--color-bg)",
                overflow: "hidden",
              }}
            >
              {/* Card Header */}
              <div style={{ padding: "20px 20px 14px", borderBottom: "1px solid var(--color-separator)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: "#fff",
                    background: p.badgeColor, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.05em",
                  }}>{p.badge}</span>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{p.name}</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
                  <span style={{ fontSize: 32, fontWeight: 800, color: p.highlight ? "var(--color-accent)" : "var(--color-text-primary)", lineHeight: 1 }}>¥{p.price}</span>
                  <span style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>{p.unit}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{p.desc}</div>
              </div>

              {/* Features */}
              <div style={{ padding: "14px 20px" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>包含内容</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {p.features.map((f, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        fontSize: 12, flexShrink: 0, width: 16, textAlign: "center",
                        color: f.included ? "#059669" : "var(--color-text-tertiary)",
                        fontWeight: f.included ? 700 : 400,
                      }}>{f.included ? "✓" : "—"}</span>
                      <span style={{
                        fontSize: 13,
                        color: f.included ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                        fontWeight: f.included ? 500 : 400,
                      }}>{f.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* CTA - 纯展示，不跳转 */}
              <div style={{ padding: "0 20px 20px" }}>
                <div
                  style={{
                    width: "100%", padding: "13px", borderRadius: 10, fontSize: 15,
                    background: p.ctaBg, color: "#fff",
                    border: "none", fontWeight: 700, textAlign: "center",
                  }}
                >
                  {p.cta}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Trust footer */}
        <div style={{ marginTop: 32, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", lineHeight: 1.8 }}>
            <p>🔒 支付安全由微信支付保障</p>
            <p>📄 虚拟数字商品，支付成功后立即交付，不支持退款</p>
            <p>💬 遇到问题？联系客服微信：theyuanxi</p>
          </div>
        </div>
      </div>
    </div>
  );
}
