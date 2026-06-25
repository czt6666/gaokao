"use client";
import { useState, useEffect, useMemo } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5198";

/** 一条选择：major_class 为 null 表示整门类（大类）全选 */
export type DisciplineSelection = { discipline: string; major_class: string | null };

type CatalogEntry = { discipline: string; level: string; major_classes: string[] };

interface Props {
  province: string;
  selected: DisciplineSelection[];
  onChange: (next: DisciplineSelection[]) => void;
  batchTypes: string[];
  onBatchChange: (next: string[]) => void;
  batchOptions: { value: string; label: string }[];
}

/** selected 列表 → Map<discipline, Set<major_class>>，整门类全选用 "*" 标记 */
function toMap(selected: DisciplineSelection[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const s of selected) {
    if (!m.has(s.discipline)) m.set(s.discipline, new Set());
    m.get(s.discipline)!.add(s.major_class === null ? "*" : s.major_class);
  }
  return m;
}

export default function DisciplineFilter({ province, selected, onChange, batchTypes, onBatchChange, batchOptions }: Props) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeLevel, setActiveLevel] = useState<"本科" | "专科">("本科");
  const [activeDisc, setActiveDisc] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 480);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const levelOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of catalog) m.set(e.discipline, e.level);
    return (d: string) => m.get(d) || "本科";
  }, [catalog]);

  // 仅在弹窗首次打开时加载目录
  useEffect(() => {
    if (!open || !province || catalog.length > 0) return;
    setLoading(true);
    fetch(`${API}/api/major/catalog?province=${encodeURIComponent(province)}`)
      .then((r) => (r.ok ? r.json() : { catalog: [] }))
      .then((d) => setCatalog(d.catalog || []))
      .catch(() => setCatalog([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, province]);

  // 省份变化时清空已加载目录（下次打开重新拉）
  useEffect(() => {
    setCatalog([]);
    setActiveDisc(null);
  }, [province]);

  // 弹窗打开时锁定 body 滚动，关闭后恢复
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // 弹窗打开 / 目录就绪时：tab 默认定位到「已有选择」所属层级
  useEffect(() => {
    if (!open || catalog.length === 0) return;
    const firstSel = selected[0];
    const lvl = firstSel ? (levelOf(firstSel.discipline) as "本科" | "专科") : "本科";
    setActiveLevel(lvl);
    const firstOfLevel = catalog.find((e) => e.level === lvl);
    setActiveDisc(firstOfLevel ? firstOfLevel.discipline : (catalog[0]?.discipline ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, catalog]);

  const sel = useMemo(() => toMap(selected), [selected]);
  const levelDisciplines = catalog.filter((e) => e.level === activeLevel);
  const activeEntry = catalog.find((e) => e.discipline === activeDisc) || null;

  /** 把 Map 落回数组并回调（不在此处做层级过滤） */
  function emit(m: Map<string, Set<string>>) {
    const out: DisciplineSelection[] = [];
    for (const [d, set] of m) {
      if (set.has("*")) out.push({ discipline: d, major_class: null });
      else for (const mc of set) out.push({ discipline: d, major_class: mc });
    }
    onChange(out);
  }

  /** 本科/专科互斥：取当前 selected，但丢掉非当前层级的选择，再做增删 */
  function mapForLevel(): Map<string, Set<string>> {
    const m = toMap(selected);
    for (const d of [...m.keys()]) {
      if (levelOf(d) !== activeLevel) m.delete(d);
    }
    return m;
  }

  function discState(entry: CatalogEntry): "all" | "some" | "none" {
    const set = sel.get(entry.discipline);
    if (!set || set.size === 0) return "none";
    if (set.has("*") || set.size >= entry.major_classes.length) return "all";
    return "some";
  }

  function selectedCountIn(entry: CatalogEntry): number {
    const set = sel.get(entry.discipline);
    if (!set) return 0;
    if (set.has("*")) return entry.major_classes.length;
    return set.size;
  }

  function switchLevel(lvl: "本科" | "专科") {
    setActiveLevel(lvl);
    const first = catalog.find((e) => e.level === lvl);
    setActiveDisc(first ? first.discipline : null);
  }

  function toggleDiscipline(entry: CatalogEntry) {
    const m = mapForLevel();
    if (discState(entry) === "all") m.delete(entry.discipline);
    else m.set(entry.discipline, new Set(["*"]));
    emit(m);
  }

  function toggleMajorClass(entry: CatalogEntry, mc: string) {
    const m = mapForLevel();
    let set = m.get(entry.discipline);
    if (set && set.has("*")) {
      set = new Set(entry.major_classes); // 把「全选」展开为具体项再增删
      m.set(entry.discipline, set);
    }
    if (!set) { set = new Set(); m.set(entry.discipline, set); }
    if (set.has(mc)) set.delete(mc);
    else set.add(mc);
    if (set.size === 0) m.delete(entry.discipline);
    else if (set.size >= entry.major_classes.length) m.set(entry.discipline, new Set(["*"]));
    emit(m);
  }

  function isMcChecked(entry: CatalogEntry, mc: string): boolean {
    const set = sel.get(entry.discipline);
    return !!set && (set.has("*") || set.has(mc));
  }

  function toggleBatch(value: string) {
    if (batchTypes.includes(value)) onBatchChange(batchTypes.filter((v) => v !== value));
    else onBatchChange([...batchTypes, value]);
  }

  const totalSelected = selected.length;
  const batchSummary = batchTypes
    .map((v) => batchOptions.find((b) => b.value === v)?.label)
    .filter(Boolean)
    .join("、");

  // 触发按钮文案
  const triggerLabel = (() => {
    const parts: string[] = [];
    if (totalSelected > 0) {
      const names = selected.map((s) => (s.major_class ? s.major_class : `${s.discipline}(全部)`));
      parts.push(names.length <= 2 ? names.join("、") : `${names.slice(0, 2).join("、")} 等 ${names.length} 项`);
    }
    if (batchSummary) parts.push(`批次：${batchSummary}`);
    return parts.length ? parts.join("｜") : "选择专业门类 / 批次";
  })();

  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-tertiary)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".5px" }}>
        专业筛选（门类 / 专业类 / 批次）
      </label>
      <button
        onClick={() => setOpen(true)}
        style={{
          width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 10,
          border: `1.5px solid ${totalSelected > 0 || batchTypes.length > 0 ? "var(--color-accent)" : "var(--color-separator)"}`,
          background: "var(--color-bg)", cursor: "pointer", fontSize: 14,
          color: totalSelected > 0 || batchTypes.length > 0 ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
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
            {/* 头部：左上 本科/专科 tab + 关闭 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--color-separator)", flexShrink: 0, gap: 8 }}>
              <div style={{ display: "flex", gap: 4, background: "var(--color-bg-secondary)", borderRadius: 10, padding: 3 }}>
                {(["本科", "专科"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => switchLevel(lvl)}
                    style={{
                      padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none",
                      background: activeLevel === lvl ? "var(--color-navy)" : "transparent",
                      color: activeLevel === lvl ? "#fff" : "var(--color-text-secondary)", transition: "all .15s",
                    }}
                  >
                    {lvl === "本科" ? "本科门类" : "专科大类"}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {totalSelected > 0 && (
                  <button onClick={() => onChange([])} style={{ background: "none", border: "none", fontSize: 13, color: "var(--color-accent)", cursor: "pointer", whiteSpace: "nowrap" }}>
                    清空（{totalSelected}）
                  </button>
                )}
                <button onClick={() => setOpen(false)} aria-label="关闭" style={{ background: "none", border: "none", fontSize: 22, lineHeight: 1, color: "var(--color-text-tertiary)", cursor: "pointer" }}>×</button>
              </div>
            </div>

            {/* 主体：左大类 + 右小类（两列） */}
            {loading ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-tertiary)", fontSize: 14 }}>加载专业目录…</div>
            ) : catalog.length === 0 ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-tertiary)", fontSize: 14 }}>
                {province ? "该省暂无专业目录数据" : "请先选择省份"}
              </div>
            ) : (
              <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
                {/* 左：当前层级的大类列表（移动端更宽、文字换行不省略） */}
                <div style={{
                  width: isMobile ? "44%" : "38%", maxWidth: 240, minWidth: isMobile ? 140 : 150,
                  borderRight: "1px solid var(--color-separator)",
                  overflowY: "auto", background: "var(--color-bg-secondary)",
                }}>
                  {levelDisciplines.map((entry) => {
                    const st = discState(entry);
                    const cnt = selectedCountIn(entry);
                    const isActive = entry.discipline === activeDisc;
                    return (
                      <div
                        key={entry.discipline}
                        onClick={() => setActiveDisc(entry.discipline)}
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
                          onChange={() => toggleDiscipline(entry)}
                          style={{ width: 18, height: 18, accentColor: "var(--color-accent)", flexShrink: 0 }}
                        />
                        <span style={{ fontSize: 14, fontWeight: isActive ? 700 : 500, color: "var(--color-text-primary)", flex: 1, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.3 }}>
                          {entry.discipline}
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

                {/* 右：当前大类的小类（两列大按钮，文字换行不省略） */}
                <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", minWidth: 0 }}>
                  {activeEntry && (
                    <>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px 12px", cursor: "pointer", borderBottom: "1px solid var(--color-separator)", marginBottom: 12 }}>
                        <input
                          type="checkbox"
                          checked={discState(activeEntry) === "all"}
                          ref={(el) => { if (el) el.indeterminate = discState(activeEntry) === "some"; }}
                          onChange={() => toggleDiscipline(activeEntry)}
                          style={{ width: 18, height: 18, accentColor: "var(--color-accent)", flexShrink: 0 }}
                        />
                        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)", lineHeight: 1.3 }}>
                          全选「{activeEntry.discipline}」（{activeEntry.major_classes.length}）
                        </span>
                      </label>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {activeEntry.major_classes.map((mc) => {
                          const checked = isMcChecked(activeEntry, mc);
                          return (
                            <button
                              key={mc}
                              onClick={() => toggleMajorClass(activeEntry, mc)}
                              style={{
                                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                                padding: "11px 10px", borderRadius: 12, cursor: "pointer",
                                fontSize: 13, lineHeight: 1.3, textAlign: "center", minWidth: 0,
                                border: checked ? "1.5px solid var(--color-accent)" : "1px solid var(--color-separator)",
                                background: checked ? "rgba(201,146,42,0.10)" : "var(--color-bg)",
                                color: checked ? "var(--color-accent)" : "var(--color-text-secondary)",
                                fontWeight: checked ? 700 : 500,
                                whiteSpace: "normal", wordBreak: "break-word", transition: "all .12s",
                              }}
                            >
                              {checked && <span style={{ flexShrink: 0 }}>✓</span>}
                              <span>{mc}</span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* 批次（多选） */}
            <div style={{ padding: "10px 16px", borderTop: "1px solid var(--color-separator)", flexShrink: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".5px" }}>
                批次（可多选）
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {batchOptions.map((b) => {
                  const active = batchTypes.includes(b.value);
                  return (
                    <button
                      key={b.value}
                      onClick={() => toggleBatch(b.value)}
                      style={{
                        padding: "9px 20px", borderRadius: 980, fontSize: 14, fontWeight: active ? 700 : 500, cursor: "pointer",
                        border: active ? "1.5px solid var(--color-accent)" : "1px solid var(--color-separator)",
                        background: active ? "rgba(201,146,42,0.10)" : "var(--color-bg)",
                        color: active ? "var(--color-accent)" : "var(--color-text-secondary)", transition: "all .12s",
                      }}
                    >
                      {b.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 底部确定 */}
            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--color-separator)", flexShrink: 0 }}>
              <button
                onClick={() => setOpen(false)}
                style={{ width: "100%", padding: "10px", borderRadius: 10, background: "var(--color-navy)", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
              >
                确定{totalSelected > 0 ? `（已选 ${totalSelected} 个专业类）` : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 把选择编码为 URL 参数值：门类[:专业类] 用竖线分隔 */
export function encodeDisciplineFilter(selected: DisciplineSelection[]): string {
  return selected
    .map((s) => s.discipline + (s.major_class ? ":" + s.major_class : ""))
    .join("|");
}

/** 从 URL 参数值解析回选择数组 */
export function decodeDisciplineFilter(raw: string): DisciplineSelection[] {
  if (!raw) return [];
  return raw
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const idx = item.indexOf(":");
      if (idx === -1) return { discipline: item, major_class: null };
      return { discipline: item.slice(0, idx), major_class: item.slice(idx + 1) };
    });
}
