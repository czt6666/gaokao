"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PayModal from "@/components/PayModal";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5198";

interface PaidOrder {
  order_no: string;
  province: string;
  rank_input: number;
  subject: string;
  amount: number;
  pay_time: string;
  results_url: string;
  c_major?: string;
  c_city?: string;
  c_nature?: string;
  c_tier?: string;
}

interface UserInfo {
  user_id: number;
  phone?: string;
  wechat_nickname?: string;
  wechat_avatar?: string;
  is_paid: boolean;
  province?: string;
  subscription_type?: string;
  subscription_label?: string;
  subscription_end_at?: string;
  days_remaining?: number | null;
  referral_code?: string;
  referral_count?: number;
  referral_reward_days?: number;
}

interface CommissionRecord {
  id: number;
  order_no: string;
  amount_yuan: number;
  status: string;
  freeze_until: string | null;
  created_at: string | null;
}

interface CommissionInfo {
  balance_fen: number;
  pending_fen: number;
  total_earned_fen: number;
  balance_yuan: number;
  pending_yuan: number;
  total_earned_yuan: number;
  records: CommissionRecord[];
}

interface WithdrawalItem {
  id: number;
  amount_yuan: number;
  status: string;
  admin_note: string;
  created_at: string | null;
  processed_at: string | null;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refCopied, setRefCopied] = useState(false);
  const [paidOrders, setPaidOrders] = useState<PaidOrder[]>([]);
  const [showPayModal, setShowPayModal] = useState(false);
  const [commission, setCommission] = useState<CommissionInfo | null>(null);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawMsg, setWithdrawMsg] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [showWithdrawSuccess, setShowWithdrawSuccess] = useState(false);
  const [withdrawSuccessAmountYuan, setWithdrawSuccessAmountYuan] = useState(0);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
    if (!token) {
      router.replace("/login?redirect=/dashboard");
      return;
    }
    fetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (r.status === 401) {
          localStorage.removeItem("auth_token");
          router.replace("/login?redirect=/dashboard");
          return null;
        }
        try { return await r.json(); } catch { return null; }
      })
      .then((d) => { if (d) setUser(d); setLoading(false); })
      .catch(() => setLoading(false));
    // Fetch paid orders
    fetch(`${API}/api/auth/paid-orders`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) return null;
        try { return await r.json(); } catch { return null; }
      })
      .then((d) => { if (d?.orders) setPaidOrders(d.orders); })
      .catch(() => {});
    // Fetch commission info
    fetch(`${API}/api/commission/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) return null;
        try { return await r.json(); } catch { return null; }
      })
      .then((d) => { if (d) setCommission(d); })
      .catch(() => {});
  }, [router]);

  function logout() {
    try { localStorage.removeItem("auth_token"); } catch {}
    router.push("/");
  }

  if (loading) {
    return (
      <main style={{ minHeight: "100vh", background: "var(--color-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </main>
    );
  }

  if (!user) return null;

  const displayName = user.wechat_nickname
    ? user.wechat_nickname
    : user.phone
    ? `${user.phone.slice(0, 3)}****${user.phone.slice(-4)}`
    : `用户${String(user.user_id).slice(-4)}`;

  // single_report / report_export / trial_report = 永久无到期；season_2026 / monthly_sub / quarterly_sub = 有到期日
  const isSingle = !user.subscription_type
    || user.subscription_type === "single_report"
    || user.subscription_type === "report_export"
    || user.subscription_type === "trial_report";
  // isExpired 以服务端 lazy check 的 is_paid 为准，避免 days_remaining 四舍五入误判
  const isExpired = !isSingle && !user.is_paid;
  const isExpiringSoon = !isSingle && user.is_paid
    && user.days_remaining !== null && user.days_remaining !== undefined && user.days_remaining <= 7;

  const endDateStr = user.subscription_end_at
    ? new Date(user.subscription_end_at + "Z").toLocaleDateString("zh-CN", { month: "long", day: "numeric" })
    : null;

  const referralCount = user.referral_count ?? 0;
  const rewardDays = (referralCount * 3) + (user.referral_reward_days ?? 0);

  // Build re-query URL from stored params
  return (
    <main style={{ minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text-primary)" }}>
      {/* Nav */}
      <nav className="apple-nav">
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "0 20px", height: 48, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={() => router.back()} className="btn-ghost" style={{ fontSize: 14, color: "var(--color-text-secondary)", paddingLeft: 0, paddingRight: 0 }}>← 返回</button>
          <span style={{ fontSize: 14, fontWeight: 600 }}>我的账户</span>
          <span style={{ width: 40 }} />
        </div>
      </nav>

      <div style={{ maxWidth: 520, margin: "0 auto", padding: "32px 20px 48px" }}>

        {/* ── 身份 + 状态 ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
          {user.wechat_avatar ? (
            <img src={user.wechat_avatar} alt="" style={{ width: 52, height: 52, borderRadius: "50%", flexShrink: 0 }} />
          ) : (
            <div style={{
              width: 52, height: 52, borderRadius: "50%", flexShrink: 0,
              background: "var(--color-bg-secondary)", border: "1.5px solid var(--color-separator)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
            }}>👤</div>
          )}
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{displayName}</div>
            {user.is_paid && !isExpired ? (
              <div style={{ fontSize: 12, color: "#34c759", marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>
                <span>✅ 报告已解锁</span>
                {!isSingle && endDateStr && (
                  <span style={{ color: "var(--color-text-tertiary)" }}>· 到期 {endDateStr}</span>
                )}
                {!isSingle && user.days_remaining !== null && user.days_remaining !== undefined && isExpiringSoon && (
                  <span style={{ background: "rgba(255,149,0,0.12)", color: "#b45309", padding: "1px 7px", borderRadius: 99, fontSize: 11, fontWeight: 600 }}>
                    剩余 {user.days_remaining} 天
                  </span>
                )}
              </div>
            ) : isExpired ? (
              <div style={{ fontSize: 12, color: "#ff3b30", marginTop: 3 }}>❌ 会员已到期</div>
            ) : (
              <div style={{ fontSize: 12, color: "#ff9500", marginTop: 3 }}>⚠️ 尚未解锁报告</div>
            )}
          </div>
        </div>

        {/* ── 填报季会员入口（未开通时展示） ── */}
        {user.subscription_type !== "season_2026" && !isExpired && (
          <div style={{
            background: "linear-gradient(135deg, rgba(0,56,179,0.06) 0%, rgba(0,56,179,0.02) 100%)",
            border: "1.5px solid rgba(0,56,179,0.18)",
            borderRadius: 16, padding: "18px 20px", marginBottom: 16,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-navy)" }}>2026 填报季会员</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "var(--color-navy)" }}>¥99</div>
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              即日起至 2026年9月1日 · 无限次查询 · 位次微调随时重查 · 志愿表收藏与对比
            </div>
            <button
              onClick={() => setShowPayModal(true)}
              style={{
                width: "100%", padding: "11px", borderRadius: 10, fontSize: 14,
                background: "var(--color-navy)", color: "#fff",
                border: "none", cursor: "pointer", fontWeight: 700,
              }}
            >
              {user.is_paid ? "升级季会员 →" : "开通季会员 →"}
            </button>
          </div>
        )}

        {/* ── 我的收益 ── */}
        {commission && (
          <div style={{
            background: "linear-gradient(135deg, rgba(52,199,89,0.08) 0%, rgba(52,199,89,0.02) 100%)",
            border: "1.5px solid rgba(52,199,89,0.2)",
            borderRadius: 16, padding: "18px 20px", marginBottom: 16,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <span>💰</span> 我的收益
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              <div style={{ flex: 1, background: "rgba(255,255,255,0.5)", borderRadius: 12, padding: "12px", textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#34c759" }}>¥{commission.balance_yuan}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>可提现</div>
              </div>
              <div style={{ flex: 1, background: "rgba(255,255,255,0.5)", borderRadius: 12, padding: "12px", textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--color-text-primary)" }}>¥{commission.pending_yuan}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>冻结中</div>
              </div>
              <div style={{ flex: 1, background: "rgba(255,255,255,0.5)", borderRadius: 12, padding: "12px", textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--color-text-primary)" }}>¥{commission.total_earned_yuan}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>累计收益</div>
              </div>
            </div>
            {commission.balance_fen >= 10000 ? (
              <button
                onClick={() => {
                  setShowWithdrawModal(true);
                  setWithdrawAmount("");
                  setWithdrawMsg("");
                  setShowWithdrawSuccess(false);
                }}
                style={{
                  width: "100%", padding: "11px", borderRadius: 10, fontSize: 14,
                  background: "#34c759", color: "#fff",
                  border: "none", cursor: "pointer", fontWeight: 700,
                }}
              >
                申请提现（满 ¥100）
              </button>
            ) : (
              <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", textAlign: "center" }}>
                满 ¥100 可申请提现，当前还差 ¥{(100 - commission.balance_yuan).toFixed(2)}
              </div>
            )}
            {commission.records.length > 0 && (
              <div style={{ marginTop: 12, borderTop: "1px solid rgba(52,199,89,0.1)", paddingTop: 10 }}>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 6 }}>最近收益</div>
                {commission.records.slice(0, 5).map((r) => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0" }}>
                    <span style={{ color: "var(--color-text-secondary)" }}>
                      订单 {r.order_no.slice(-6)} · {r.status === "frozen" ? "冻结中" : r.status === "available" ? "已到账" : r.status === "deducted" ? "已扣除" : r.status}
                    </span>
                    <span style={{ fontWeight: 600, color: r.status === "deducted" ? "#ff3b30" : "#34c759" }}>
                      {r.status === "deducted" ? "-" : "+"}¥{r.amount_yuan}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 推荐返佣 ── */}
        {user.referral_code && (
          <div style={{
            background: "var(--color-bg-secondary)", border: "1px solid var(--color-separator)",
            borderRadius: 16, padding: "18px 20px", marginBottom: 16,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>邀请好友</div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 14 }}>
              朋友通过你的链接付费后，<strong style={{ color: "var(--color-accent)" }}>你自动获得3天免费</strong>——在最关键的高考季，白送一次重查机会。
            </div>

            {/* Progress bar to next milestone */}
            {(() => {
              const MILESTONE = 4;
              const milestoneGot = (user.referral_reward_days ?? 0) >= 30;
              const pct = Math.min((referralCount / MILESTONE) * 100, 100);
              return (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 5 }}>
                    <span>已邀请 <strong style={{ color: "var(--color-text-primary)" }}>{referralCount}</strong> 人付费</span>
                    <span style={{ color: "var(--color-accent)", fontWeight: 600 }}>
                      {milestoneGot ? "✓ 已获得额外30天奖励" : `再邀 ${MILESTONE - referralCount} 人 → 额外+30天`}
                    </span>
                  </div>
                  <div style={{ height: 5, background: "var(--color-separator)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: "var(--color-accent)", borderRadius: 99, transition: "width 0.5s" }} />
                  </div>
                  {rewardDays > 0 && (
                    <div style={{ fontSize: 11, color: "#34C759", marginTop: 5, fontWeight: 500 }}>
                      ✓ 已累计获得 {rewardDays} 天奖励
                    </div>
                  )}
                </div>
              );
            })()}

            <button
              onClick={() => {
                const link = `https://www.theyuanxi.cn/?ref=${user.referral_code}`;
                const text = `高考志愿填报神器！输入位次自动算出每所学校录取概率，冷门宝藏院校一键找到，比找机构便宜太多了。用我的专属链接还有优惠 👉 ${link}`;
                try { navigator.clipboard.writeText(text); } catch {}
                setRefCopied(true);
                setTimeout(() => setRefCopied(false), 2500);
              }}
              style={{
                width: "100%", padding: "11px", borderRadius: 10, fontSize: 13,
                background: refCopied ? "#34C759" : "#07C160", color: "#fff",
                border: "none", cursor: "pointer", fontWeight: 600, transition: "background 0.2s",
              }}
            >
              {refCopied ? "✓ 已复制，发给朋友即可" : "复制专属邀请链接"}
            </button>
          </div>
        )}

        {/* ── 已购报告历史 ── */}
        {paidOrders.length > 0 && (
          <div style={{
            background: "var(--color-bg-secondary)", border: "1px solid var(--color-separator)",
            borderRadius: 16, padding: "18px 20px", marginBottom: 16,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>已购报告</div>
            {paidOrders.map((o) => {
              const hasConstraints = o.c_major || o.c_city || o.c_nature || o.c_tier;
              return (
                <div
                  key={o.order_no}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 0",
                    borderBottom: "1px solid var(--color-separator)",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
                      {o.province} · 位次 {o.rank_input.toLocaleString()}
                      {o.subject ? ` · ${o.subject}` : ""}
                    </div>
                    {hasConstraints && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                        {o.c_major && (
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "#EEF2FF", color: "#1E3A8A" }}>
                            专业含「{o.c_major}」
                          </span>
                        )}
                        {o.c_city && (
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "#F0FDF4", color: "#14532D" }}>
                            城市：{o.c_city}
                          </span>
                        )}
                        {o.c_nature && (
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "#FFFBEB", color: "#92400E" }}>
                            性质：{o.c_nature}
                          </span>
                        )}
                        {o.c_tier && (
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "#FEF2F2", color: "#7F1D1D" }}>
                            档次：{o.c_tier}
                          </span>
                        )}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                      {o.pay_time} · ¥{o.amount.toFixed(2)}
                    </div>
                  </div>
                  <a
                    href={o.results_url}
                    style={{
                      fontSize: 12, fontWeight: 600, color: "var(--color-navy)",
                      background: "rgba(0,56,179,0.07)", borderRadius: 8,
                      padding: "5px 12px", textDecoration: "none", flexShrink: 0, marginLeft: 10,
                    }}
                  >
                    查看报告
                  </a>
                </div>
              );
            })}
          </div>
        )}

        {/* ── 志愿表入口（保留，轻量化） ── */}
        <button
          onClick={() => router.push("/form")}
          style={{
            width: "100%", padding: "13px 16px", borderRadius: 12, marginBottom: 12,
            background: "var(--color-bg-secondary)", border: "1px solid var(--color-separator)",
            textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
          }}
        >
          <span style={{ fontSize: 20 }}>📋</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>我的志愿表</div>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>查看已收藏的院校推荐</div>
          </div>
          <span style={{ marginLeft: "auto", color: "var(--color-text-tertiary)", fontSize: 16 }}>›</span>
        </button>

        {/* ── 退出 ── */}
        <button
          onClick={logout}
          style={{
            width: "100%", padding: "12px", borderRadius: 12,
            border: "1px solid var(--color-separator)",
            background: "transparent", fontSize: 13,
            color: "var(--color-text-tertiary)", cursor: "pointer",
          }}
        >
          退出登录
        </button>

      </div>

      {showPayModal && (
        <PayModal
          onClose={() => setShowPayModal(false)}
          defaultProductType="season_2026"
        />
      )}

      {showWithdrawModal && commission && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }} onClick={() => { if (!withdrawLoading) setShowWithdrawModal(false); }}>
          <div style={{
            background: "#fff", borderRadius: 20, width: "100%", maxWidth: 400,
            padding: "24px", color: "#111",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>申请提现</div>
            <div style={{
              background: "#f6f6f6", borderRadius: 12, padding: "14px", marginBottom: 16,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: 13, color: "#666" }}>可提现余额</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: "#34c759" }}>¥{commission.balance_yuan}</span>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, color: "#666", display: "block", marginBottom: 6 }}>提现金额（最低 ¥100）</label>
              <input
                type="number"
                min={100}
                max={Math.floor(commission.balance_fen / 100)}
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder={`最多可提 ¥${Math.floor(commission.balance_fen / 100)}`}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 12, fontSize: 15,
                  border: "1px solid #ddd", outline: "none", boxSizing: "border-box",
                }}
              />
            </div>
            {withdrawMsg && (
              <div style={{ fontSize: 12, marginBottom: 12, color: withdrawMsg.includes("成功") ? "#34c759" : "#ff3b30" }}>
                {withdrawMsg}
              </div>
            )}
            <button
              onClick={async () => {
                const yuan = parseFloat(withdrawAmount);
                if (!yuan || yuan < 100) {
                  setWithdrawMsg("提现金额至少为 ¥100");
                  return;
                }
                const fen = Math.round(yuan * 100);
                if (fen > commission.balance_fen) {
                  setWithdrawMsg("提现金额不能超过可提现余额");
                  return;
                }
                setWithdrawLoading(true);
                setWithdrawMsg("");
                try {
                  const token = localStorage.getItem("auth_token");
                  const res = await fetch(`${API}/api/commission/withdraw?amount_fen=${fen}`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  const data = await res.json();
                  if (res.ok) {
                    setCommission((prev) => prev ? { ...prev, balance_fen: data.balance_fen, balance_yuan: parseFloat((data.balance_fen / 100).toFixed(2)) } : prev);
                    setShowWithdrawModal(false);
                    setWithdrawSuccessAmountYuan(yuan);
                    setShowWithdrawSuccess(true);
                  } else {
                    setWithdrawMsg(data.detail || "申请失败");
                  }
                } catch {
                  setWithdrawMsg("网络错误，请重试");
                } finally {
                  setWithdrawLoading(false);
                }
              }}
              disabled={withdrawLoading || commission.balance_fen < 10000}
              style={{
                width: "100%", padding: "13px", borderRadius: 12, fontSize: 15,
                background: withdrawLoading || commission.balance_fen < 10000 ? "#ccc" : "#34c759",
                color: "#fff", border: "none", cursor: withdrawLoading ? "not-allowed" : "pointer",
                fontWeight: 700,
              }}
            >
              {withdrawLoading ? "提交中..." : "确认申请提现"}
            </button>
            <button
              onClick={() => setShowWithdrawModal(false)}
              disabled={withdrawLoading}
              style={{
                width: "100%", padding: "11px", borderRadius: 12, fontSize: 14,
                background: "transparent", color: "#888", border: "none",
                cursor: withdrawLoading ? "not-allowed" : "pointer", marginTop: 8,
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {showWithdrawSuccess && user && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }} onClick={() => setShowWithdrawSuccess(false)}>
          <div style={{
            background: "#fff", borderRadius: 20, width: "100%", maxWidth: 400,
            padding: "28px 24px", color: "#111", textAlign: "center",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              width: 48, height: 48, borderRadius: "50%", background: "#34c759",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>提现申请已提交</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#34c759", marginBottom: 16 }}>
              ¥{withdrawSuccessAmountYuan.toFixed(2)}
            </div>
            <div style={{ fontSize: 14, color: "#555", marginBottom: 20, lineHeight: 1.6 }}>
              请截图此页面，添加客服微信
            </div>
            <div style={{
              background: "#f0f9f4", borderRadius: 12, padding: "14px 16px",
              marginBottom: 20, border: "1px solid #d1f0dc",
            }}>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>客服微信</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#111", letterSpacing: 1 }}>czt_1227</div>
            </div>
            <div style={{ fontSize: 12, color: "#999", lineHeight: 1.5 }}>
              用户ID: {user.user_id} · 邀请码: {user.referral_code || "-"}
            </div>
            <button
              onClick={() => setShowWithdrawSuccess(false)}
              style={{
                width: "100%", padding: "13px", borderRadius: 12, fontSize: 15,
                background: "#34c759", color: "#fff", border: "none",
                cursor: "pointer", fontWeight: 700, marginTop: 20,
              }}
            >
              我知道了
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
