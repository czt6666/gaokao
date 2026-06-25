"""
回填 subject_must 中的首选科目（物理/历史）。

数据源优先级：
  1. derived_category（一分一段匹配结果）→ 物理血统补"物理"，历史血统补"历史"
  2. derived_category 为空时 → 从 subject_req 原文推断（含物理则归物理，含历史则归历史）
  3. 两者都无信息 → 不动

用法：
  python scripts/backfill_subject_must_category.py            # 执行回填
  python scripts/backfill_subject_must_category.py --verify   # 只看不改
"""

import sys, os, argparse, sqlite3

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.stdout.reconfigure(encoding="utf-8")
DB = os.path.join(os.path.dirname(__file__), "..", "gaokao.db")

PHYSICS_LINEAGE = ("物理类", "物理", "理科")
HISTORY_LINEAGE = ("历史类", "历史", "文科")


def _infer_category_from_req(subject_req: str) -> str:
    """从 subject_req 原文推断科类。返回 '物理' / '历史' / ''。"""
    sr = (subject_req or "").strip()
    if not sr:
        return ""
    has_physics = any(k in sr for k in ("物理", "理科"))
    has_history = any(k in sr for k in ("历史", "文科"))
    if has_physics and not has_history:
        return "物理"
    if has_history and not has_physics:
        return "历史"
    return ""


def run(verify: bool):
    conn = sqlite3.connect(DB)
    cols = [r[1] for r in conn.execute("PRAGMA table_info(admission_records)")]
    if "derived_category" not in cols:
        print("❌ 缺少 derived_category 列，请先跑 backfill_derived_category.py")
        conn.close()
        return

    # ── 第 1 轮：有 derived_category 的 ──
    all_phyl = PHYSICS_LINEAGE + HISTORY_LINEAGE
    rows1 = conn.execute(f"""
        SELECT id, COALESCE(subject_must,'') as sm, derived_category, COALESCE(subject_req,'') as sr
        FROM admission_records
        WHERE derived_category IN ({",".join("'" + c + "'" for c in all_phyl)})
    """).fetchall()

    updates = []
    stats = {
        "set_物理": 0, "set_历史": 0,
        "prepend_物理": 0, "prepend_历史": 0,
        "skip_contradict": 0, "skip_already_ok": 0,
    }

    for rid, sm, cat, sr in rows1:
        if cat in PHYSICS_LINEAGE:
            if "物理" in sm:
                stats["skip_already_ok"] += 1
                continue
            if "历史" in sm:
                stats["skip_contradict"] += 1
                continue
            if sm == "":
                updates.append(("物理", rid))
                stats["set_物理"] += 1
            else:
                updates.append(("物理," + sm, rid))
                stats["prepend_物理"] += 1
        elif cat in HISTORY_LINEAGE:
            if "历史" in sm:
                stats["skip_already_ok"] += 1
                continue
            if "物理" in sm:
                stats["skip_contradict"] += 1
                continue
            if sm == "":
                updates.append(("历史", rid))
                stats["set_历史"] += 1
            else:
                updates.append(("历史," + sm, rid))
                stats["prepend_历史"] += 1

    print(f"第 1 轮（有 derived_category）：处理 {len(rows1):,} 行 → 待写入 {len(updates):,}")

    # ── 第 2 轮：derived_category 为空，从 subject_req 推断 ──
    stats2 = {"set_物理": 0, "set_历史": 0, "skip_ambiguous": 0}

    rows2 = conn.execute("""
        SELECT id, COALESCE(subject_must,'') as sm, COALESCE(subject_req,'') as sr
        FROM admission_records
        WHERE (derived_category = '' OR derived_category IS NULL)
          AND (subject_must = '' OR subject_must IS NULL)
    """).fetchall()

    for rid, sm, sr in rows2:
        inferred = _infer_category_from_req(sr)
        if inferred == "物理":
            updates.append(("物理", rid))
            stats2["set_物理"] += 1
        elif inferred == "历史":
            updates.append(("历史", rid))
            stats2["set_历史"] += 1
        else:
            stats2["skip_ambiguous"] += 1

    print(f"第 2 轮（空 derived_category，从 subject_req 推断）：处理 {len(rows2):,} 行 → 待写入 {stats2['set_物理'] + stats2['set_历史']:,}")

    # ── 汇总 ──
    all_stats = {**stats, **{f"R2_{k}": v for k, v in stats2.items()}}
    print("\n操作统计：")
    for k, v in sorted(all_stats.items(), key=lambda x: -x[1]):
        print(f"  {k:25s} {v:>9,}")

    if verify:
        print("\n--verify：未写库。")
        conn.close()
        return

    if not updates:
        print("\n无需更新。")
        conn.close()
        return

    conn.executemany("UPDATE admission_records SET subject_must=? WHERE id=?", updates)
    conn.commit()
    print(f"\n已写入 {len(updates):,} 行的 subject_must")
    conn.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true", help="只看不改")
    args = ap.parse_args()
    run(args.verify)
