"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface FormItem {
  id: string;
  rank: number;
  school: string;
  major: string;
  probability: number;
  action: string;
  category: "极冲" | "冲" | "稳" | "保";
}

const STORAGE_KEY = "gaokao_form_v3";

function getCategory(prob: number): "极冲" | "冲" | "稳" | "保" {
  if (prob >= 82) return "保";
  if (prob >= 55) return "稳";
  if (prob >= 25) return "冲";
  return "极冲";
}

const CATEGORY_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  "极冲": { bg: "rgba(220,38,38,0.08)",  color: "#DC2626", border: "rgba(220,38,38,0.25)" },
  "冲":   { bg: "rgba(201,146,42,0.10)", color: "#C9922A", border: "rgba(201,146,42,0.30)" },
  "稳":   { bg: "rgba(26,39,68,0.08)",   color: "#1A2744", border: "rgba(26,39,68,0.20)" },
  "保":   { bg: "rgba(5,150,105,0.08)",  color: "#059669", border: "rgba(5,150,105,0.25)" },
};

export default function FormPage() {
  const router = useRouter();
  const [items, setItems] = useState<FormItem[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setItems(parsed);
      }
    } catch {}
  }, []);

  const save = (next: FormItem[]) => {
    setItems(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const remove = (id: string) => save(items.filter((i) => i.id !== id));

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = [...items];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    save(next.map((it, i) => ({ ...it, rank: i + 1 })));
  };

  const moveDown = (idx: number) => {
    if (idx === items.length - 1) return;
    const next = [...items];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    save(next.map((it, i) => ({ ...it, rank: i + 1 })));
  };

  const handleDragStart = (idx: number) => setDragging(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOver(idx);
  };
  const handleDrop = (idx: number) => {
    if (dragging === null || dragging === idx) return;
    const next = [...items];
    const [moved] = next.splice(dragging, 1);
    next.splice(idx, 0, moved);
    save(next.map((it, i) => ({ ...it, rank: i + 1 })));
    setDragging(null);
    setDragOver(null);
  };



  const extremeSurge = items.filter((i) => i.category === "极冲").length;
  const surge  = items.filter((i) => i.category === "冲").length;
  const stable = items.filter((i) => i.category === "稳").length;
  const safe   = items.filter((i) => i.category === "保").length;

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text-primary)" }}>
      {/* 顶部导航 */}
      <nav className="apple-nav">
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 20px", height: 48, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button onClick={() => router.back()} className="btn-ghost" style={{ fontSize: 14, color: "var(--color-text-secondary)", paddingLeft: 0, paddingRight: 0 }}>← 返回</button>
            <span style={{ color: "var(--color-separator)" }}>|</span>
            <h1 style={{ fontSize: 14, fontWeight: 600 }}>我的志愿表</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {items.length > 0 && (
              <>
                <button
                  onClick={() => setConfirmClear(true)}
                  style={{ fontSize: 12, padding: "5px 12px", borderRadius: 8, border: "1px solid var(--color-danger)", color: "var(--color-danger)", background: "transparent", cursor: "pointer" }}
                >
                  清空
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* 清空确认弹层（替代 confirm()） */}
      {confirmClear && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 999,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "var(--color-bg)", borderRadius: 16, padding: "28px 24px",
            maxWidth: 320, width: "90%", textAlign: "center", boxShadow: "var(--shadow-lg)",
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🗑️</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>确认清空志愿表？</div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 24 }}>
              共 {items.length} 条志愿将被删除，此操作不可撤销。
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setConfirmClear(false)}
                style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--color-separator)", background: "transparent", fontSize: 14, cursor: "pointer" }}
              >
                取消
              </button>
              <button
                onClick={() => { save([]); setConfirmClear(false); }}
                style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: "var(--color-danger)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除单条确认弹层 */}
      {confirmRemoveId && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 999,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "var(--color-bg)", borderRadius: 16, padding: "28px 24px",
            maxWidth: 320, width: "90%", textAlign: "center", boxShadow: "var(--shadow-lg)",
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🗑️</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>确认删除这条志愿？</div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 24 }}>
              {(() => {
                const it = items.find((i) => i.id === confirmRemoveId);
                return it ? `${it.school} · ${it.major}` : "";
              })()}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setConfirmRemoveId(null)}
                style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--color-separator)", background: "transparent", fontSize: 14, cursor: "pointer" }}
              >
                取消
              </button>
              <button
                onClick={() => { if (confirmRemoveId) remove(confirmRemoveId); setConfirmRemoveId(null); }}
                style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: "var(--color-danger)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px" }}>
        {/* 统计 */}
        {items.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 24 }}>
            {[
              { label: "总数", val: items.length, color: "var(--color-text-primary)" },
              { label: "极冲", val: extremeSurge, color: "#DC2626" },
              { label: "冲",   val: surge,        color: "var(--color-accent)" },
              { label: "稳",   val: stable,       color: "var(--color-navy)" },
              { label: "保",   val: safe,         color: "var(--color-success)" },
            ].map((stat) => (
              <div key={stat.label} style={{
                background: "var(--color-bg-secondary)", border: "1px solid var(--color-separator)",
                borderRadius: 12, padding: "12px 8px", textAlign: "center",
              }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: stat.color }}>{stat.val}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: "var(--color-text-tertiary)" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 8 }}>志愿表还是空的</div>
            <div style={{ fontSize: 14, marginBottom: 28 }}>在推荐结果页面点击「+ 加入志愿表」来添加</div>
            <Link
              href="/"
              style={{
                display: "inline-block", padding: "10px 24px",
                background: "var(--color-navy)", color: "#fff",
                borderRadius: 980, textDecoration: "none", fontSize: 14, fontWeight: 500,
              }}
            >
              去查询推荐
            </Link>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 12, paddingLeft: 4 }}>
              💡 拖拽调整顺序 · 最多可填 96 个志愿（当前 {items.length}/96）
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((item, idx) => {
                const cs = CATEGORY_STYLE[item.category] || CATEGORY_STYLE["冲"];
                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={() => handleDrop(idx)}
                    onDragEnd={() => { setDragging(null); setDragOver(null); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      background: dragOver === idx ? "rgba(201,146,42,0.05)" : "var(--color-bg-secondary)",
                      border: `1px solid ${dragOver === idx ? "rgba(201,146,42,0.4)" : "var(--color-separator)"}`,
                      borderRadius: 12, padding: "12px 14px",
                      cursor: "grab", opacity: dragging === idx ? 0.4 : 1,
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                  >
                    {/* 序号 */}
                    <div style={{ width: 28, textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--color-text-tertiary)", flexShrink: 0 }}>
                      {idx + 1}
                    </div>

                    {/* 类型标签 */}
                    <div style={{
                      padding: "2px 8px", borderRadius: 6,
                      fontSize: 11, fontWeight: 600,
                      background: cs.bg, color: cs.color, border: `1px solid ${cs.border}`,
                      flexShrink: 0,
                    }}>
                      {item.category}
                    </div>

                    {/* 内容 */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.school}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.major}
                      </div>
                    </div>

                    {/* 概率 */}
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: cs.color }}>{item.probability.toFixed(0)}%</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>录取率</div>
                    </div>

                    {/* 排序按钮 */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                      <button
                        onClick={() => moveUp(idx)} disabled={idx === 0}
                        style={{ fontSize: 16, color: idx === 0 ? "var(--color-text-tertiary)" : "var(--color-text-secondary)", background: "none", border: "none", cursor: idx === 0 ? "default" : "pointer", padding: "6px 8px", opacity: idx === 0 ? 0.3 : 1, borderRadius: 6 }}
                        title="上移"
                      >▲</button>
                      <button
                        onClick={() => moveDown(idx)} disabled={idx === items.length - 1}
                        style={{ fontSize: 16, color: idx === items.length - 1 ? "var(--color-text-tertiary)" : "var(--color-text-secondary)", background: "none", border: "none", cursor: idx === items.length - 1 ? "default" : "pointer", padding: "6px 8px", opacity: idx === items.length - 1 ? 0.3 : 1, borderRadius: 6 }}
                        title="下移"
                      >▼</button>
                    </div>

                    {/* 删除 */}
                    <button
                      onClick={() => setConfirmRemoveId(item.id)}
                      style={{ fontSize: 20, color: "var(--color-text-tertiary)", background: "none", border: "none", cursor: "pointer", flexShrink: 0, lineHeight: 1, padding: "4px 8px", borderRadius: 6 }}
                      title="删除"
                    >×</button>
                  </div>
                );
              })}
            </div>

            {/* 底部建议 */}
            <div style={{ marginTop: 24, padding: "14px 16px", background: "var(--color-bg-secondary)", borderRadius: 12, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.8 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--color-text-primary)" }}>📌 填报建议</div>
              <div>· 高考平行志愿最多 96 个，建议按"冲—稳—保"梯度排列</div>
              <div>· 同一学校的不同专业可多填，录取概率会自动累加</div>
              <div>· 以官方招生简章为最终依据，本表仅供参考</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
