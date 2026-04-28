"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refCopied, setRefCopied] = useState(false);
  const [paidOrders, setPaidOrders] = useState<PaidOrder[]>([]);

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
  }, [router]);

  function logout() {
    try { localStorage.removeItem("auth_token"); } catch {}
    try { localStorage.removeItem("gaokao_order"); } catch {}
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

  // single_report / report_export = 永久无到期；season_2026 / monthly_sub / quarterly_sub = 有到期日
  const isSingle = !user.subscription_type
    || user.subscription_type === "single_report"
    || user.subscription_type === "report_export";
  // isExpired 以服务端 lazy check 的 is_paid 为准，避免 days_remaining 四舍五入误判
  const isExpired = !isSingle && !user.is_paid;
  const isExpiringSoon = !isSingle && user.is_paid
    && user.days_remaining !== null && user.days_remaining !== undefined && user.days_remaining <= 7;

  const endDateStr = user.subscription_end_at
    ? new Date(user.subscription_end_at + "Z").toLocaleDateString("zh-CN", { month: "long", day: "numeric" })
    : null;

  const referralCount = user.referral_count ?? 0;
  const rewardDays = referralCount * 3;

  // Build re-query URL from stored params
  const savedProvince = typeof window !== "undefined" ? (localStorage.getItem("gaokao_province") || "") : "";
  const savedRank = typeof window !== "undefined" ? (localStorage.getItem("gaokao_rank") || "") : "";
  const savedSubject = typeof window !== "undefined" ? (localStorage.getItem("gaokao_subject") || "") : "";
  const reQueryUrl = savedProvince && savedRank
    ? `/results?province=${encodeURIComponent(savedProvince)}&rank=${savedRank}&subject=${encodeURIComponent(savedSubject)}`
    : "/";

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

        {/* ── 核心CTA：重新查询 ── */}
        <div style={{
          background: user.is_paid && !isExpired
            ? "linear-gradient(135deg, rgba(201,146,42,0.08) 0%, rgba(201,146,42,0.04) 100%)"
            : "rgba(255,149,0,0.04)",
          border: `1px solid ${user.is_paid && !isExpired ? "rgba(201,146,42,0.25)" : "rgba(255,149,0,0.2)"}`,
          borderRadius: 16, padding: "20px",
          marginBottom: 16,
        }}>
          {user.is_paid && !isExpired ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
                获取最新冷门推荐
              </div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 14 }}>
                录取数据每年更新。越接近志愿截止日，竞争格局越清晰——<strong style={{ color: "var(--color-text-primary)" }}>建议在截止前3天重查一次</strong>，往往能发现位次相同但更好进的学校。
              </div>
              <button
                onClick={() => router.push(reQueryUrl)}
                style={{
                  width: "100%", padding: "13px", borderRadius: 10, fontSize: 15,
                  background: "var(--color-accent)", color: "#fff",
                  border: "none", cursor: "pointer", fontWeight: 700,
                }}
              >
                立即重新查询 →
              </button>
              {savedProvince && savedRank && (
                <div style={{ textAlign: "center", fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 8 }}>
                  上次查询：{savedProvince} · 位次 {parseInt(savedRank).toLocaleString()}
                </div>
              )}
            </>
          ) : isExpired ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#ff3b30", marginBottom: 6 }}>会员已到期</div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 12 }}>续费后可继续获取冷门推荐数据</div>
              <button
                onClick={() => router.push("/?unlock=1")}
                style={{
                  width: "100%", padding: "12px", borderRadius: 10, fontSize: 14,
                  background: "#ff3b30", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600,
                }}
              >
                续费解锁 →
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>先解锁，再重查</div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 12 }}>
                解锁后可查看完整冷门分析 · 就业薪资 · 填报策略，并在2026年7月31日前无限次重查
              </div>
              <button
                onClick={() => router.push("/?unlock=1")}
                style={{
                  width: "100%", padding: "12px", borderRadius: 10, fontSize: 14,
                  background: "var(--color-accent)", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600,
                }}
              >
                解锁完整报告 ¥1.99 →
              </button>
            </>
          )}
        </div>

        {/* ── 推荐返佣 ── 暂时隐藏 ── */}
        {/* {user?.referral_code && (
          <div style={{
            background: "var(--color-bg-secondary)", border: "1px solid var(--color-separator)",
            borderRadius: 16, padding: "18px 20px", marginBottom: 16,
          }}>
            ...
          </div>
        )} */}

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
    </main>
  );
}
