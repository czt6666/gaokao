"use client";
import { useState, useEffect, useMemo } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5198";

type CityGroup = { tier: string; cities: string[] };

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
}

/** 城市筛选弹窗：全国城市按一二三线分组，可整线全选或单选 */
export default function CityFilter({ selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<CityGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTier, setActiveTier] = useState<string>("");

  const sel = useMemo(() => new Set(selected), [selected]);

  // 仅在首次打开时加载城市目录
  useEffect(() => {
    if (!open || groups.length > 0) return;
    setLoading(true);
    fetch(`${API}/api/cities`)
      .then((r) => (r.ok ? r.json() : { groups: [] }))
      .then((d) => {
        setGroups(d.groups || []);
        if (d.groups?.length) setActiveTier(d.groups[0].tier);
      })
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, [open, groups.length]);

  // 弹窗打开时锁定 body 滚动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const active = groups.find((g) => g.tier === activeTier) || null;

  function tierState(g: CityGroup): "all" | "some" | "none" {
    const n = g.cities.filter((c) => sel.has(c)).length;
    return n === 0 ? "none" : n >= g.cities.length ? "all" : "some";
  }
  function selCountIn(g: CityGroup): number {
    return g.cities.filter((c) => sel.has(c)).length;
  }
  function toggleTier(g: CityGroup) {
    const next = new Set(selected);
    if (tierState(g) === "all") g.cities.forEach((c) => next.delete(c));
    else g.cities.forEach((c) => next.add(c));
    onChange([...next]);
  }
  function toggleCity(c: string) {
    const next = new Set(selected);
    next.has(c) ? next.delete(c) : next.add(c);
    onChange([...next]);
  }

  const totalSelected = selected.length;
  const triggerLabel = totalSelected > 0
    ? (totalSelected <= 3 ? selected.join("、") : `${selected.slice(0, 3).join("、")} 等 ${totalSelected} 个城市`)
    : "选择城市（按一二三线）";

  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-tertiary)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".5px" }}>
        城市筛选
      </label>
      <button
        onClick={() => setOpen(true)}
        style={{
          width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 10,
          border: `1.5px solid ${totalSelected > 0 ? "var(--color-accent)" : "var(--color-separator)"}`,
          background: "var(--color-bg)", cursor: "pointer", fontSize: 14,
          color: totalSelected > 0 ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{triggerLabel}</span>
        <span style={{ flexShrink: 0, fontSize: 12, color: "var(--color-accent)" }}>▾</span>
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--color-bg)", borderRadius: 16,
              width: "min(720px, 96vw)", height: "min(600px, 88vh)",
              display: "flex", flexDirection: "column", overflow: "hidden",
              boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
            }}
          >
            {/* 头部 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--color-separator)", flexShrink: 0, gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>选择城市</span>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {totalSelected > 0 && (
                  <button onClick={() => onChange([])} style={{ background: "none", border: "none", fontSize: 13, color: "var(--color-accent)", cursor: "pointer", whiteSpace: "nowrap" }}>
                    清空（{totalSelected}）
                  </button>
                )}
                <button onClick={() => setOpen(false)} aria-label="关闭" style={{ background: "none", border: "none", fontSize: 22, lineHeight: 1, color: "var(--color-text-tertiary)", cursor: "pointer" }}>×</button>
              </div>
            </div>

            {/* 主体：左线级 + 右城市 */}
            {loading ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-tertiary)", fontSize: 14 }}>加载城市列表…</div>
            ) : groups.length === 0 ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-tertiary)", fontSize: 14 }}>暂无城市数据</div>
            ) : (
              <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
                {/* 左：线级 */}
                <div style={{ width: "34%", maxWidth: 200, minWidth: 120, borderRight: "1px solid var(--color-separator)", overflowY: "auto", background: "var(--color-bg-secondary)" }}>
                  {groups.map((g) => {
                    const st = tierState(g);
                    const cnt = selCountIn(g);
                    const isActive = g.tier === activeTier;
                    return (
                      <div
                        key={g.tier}
                        onClick={() => setActiveTier(g.tier)}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "13px 10px 13px 12px", cursor: "pointer",
                          background: isActive ? "var(--color-bg)" : "transparent",
                          borderLeft: `3px solid ${isActive ? "var(--color-accent)" : "transparent"}`,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={st === "all"}
                          ref={(el) => { if (el) el.indeterminate = st === "some"; }}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleTier(g)}
                          style={{ width: 18, height: 18, accentColor: "var(--color-accent)", flexShrink: 0 }}
                        />
                        <span style={{ fontSize: 14, fontWeight: isActive ? 700 : 500, color: "var(--color-text-primary)", flex: 1, lineHeight: 1.3 }}>
                          {g.tier}
                        </span>
                        {cnt > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "var(--color-accent)", borderRadius: 9, padding: "1px 6px", minWidth: 18, textAlign: "center", flexShrink: 0 }}>
                            {cnt}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* 右：当前线级城市 */}
                <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", minWidth: 0 }}>
                  {active && (
                    <>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px 12px", cursor: "pointer", borderBottom: "1px solid var(--color-separator)", marginBottom: 12 }}>
                        <input
                          type="checkbox"
                          checked={tierState(active) === "all"}
                          ref={(el) => { if (el) el.indeterminate = tierState(active) === "some"; }}
                          onChange={() => toggleTier(active)}
                          style={{ width: 18, height: 18, accentColor: "var(--color-accent)", flexShrink: 0 }}
                        />
                        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)", lineHeight: 1.3 }}>
                          全选「{active.tier}」（{active.cities.length}）
                        </span>
                      </label>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        {active.cities.map((c) => {
                          const checked = sel.has(c);
                          return (
                            <button
                              key={c}
                              onClick={() => toggleCity(c)}
                              style={{
                                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                                padding: "10px 8px", borderRadius: 10, cursor: "pointer",
                                fontSize: 13, lineHeight: 1.3, textAlign: "center", minWidth: 0,
                                border: checked ? "1.5px solid var(--color-accent)" : "1px solid var(--color-separator)",
                                background: checked ? "rgba(201,146,42,0.10)" : "var(--color-bg)",
                                color: checked ? "var(--color-accent)" : "var(--color-text-secondary)",
                                fontWeight: checked ? 700 : 500,
                                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transition: "all .12s",
                              }}
                            >
                              {checked && <span style={{ flexShrink: 0 }}>✓</span>}
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c}</span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* 底部确定 */}
            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--color-separator)", flexShrink: 0 }}>
              <button
                onClick={() => setOpen(false)}
                style={{ width: "100%", padding: "10px", borderRadius: 10, background: "var(--color-navy)", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
              >
                确定{totalSelected > 0 ? `（已选 ${totalSelected} 个城市）` : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
