#!/usr/bin/env python3
"""【本地+线上各跑一次】回填 admission_records 的派生字段（幂等、确定性）。

只补"缺失"的派生列，不覆盖已有正确值：
  · batch_type            ← get_batch_type(batch)        仅当 NULL/''/'unknown'
  · subject_must/any_of   ← parse_subject_fields(subject_req)
                             仅当该行两列都空、且 subject_req 有实质要求
  · is_985 / is_211       ← schools 表按 school_name（精确+去括号归一化）查；
                             仅当 NULL/''；查不到默认 '否'

派生是纯确定性变换，本地、线上各跑一次即可，无需传这些列的数据。
写库走"临时映射表 + 单次全表 UPDATE"，每步只扫一趟（表无 school_name/batch 索引）。
默认 dry-run（只统计），--apply 才写。

用法：
  .venv/bin/python backfill_derived_fields.py --db gaokao.db            # 演练
  .venv/bin/python backfill_derived_fields.py --db gaokao.db --apply    # 写库
"""
import argparse
import os
import re
import sqlite3
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts"))
from batch_type_map import get_batch_type          # noqa: E402
from subject_rule_map import parse_subject_fields   # noqa: E402

MISS_BT = "batch_type IS NULL OR batch_type='' OR batch_type='unknown'"
MISS_985 = "is_985 IS NULL OR is_985=''"
EMPTY_SUBJ = ("(subject_must IS NULL OR subject_must='') "
              "AND (subject_any_of IS NULL OR subject_any_of='')")


def _norm_name(s):
    return re.sub(r"[（(].*?[)）]", "", s or "").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    if not os.path.exists(args.db):
        raise SystemExit(f"文件不存在: {args.db}")

    con = sqlite3.connect(args.db)
    cur = con.cursor()
    print(f"== {'APPLY 写库' if args.apply else 'DRY-RUN 不写'} | {args.db} ==")

    # ── 1. batch_type ───────────────────────────────────────────────
    batches = [b for (b,) in cur.execute(f"SELECT DISTINCT batch FROM admission_records WHERE {MISS_BT}")]
    n = cur.execute(f"SELECT COUNT(*) FROM admission_records WHERE {MISS_BT}").fetchone()[0]
    print(f"[batch_type] 待回填 {n} 行（{len(batches)} 种 batch）")
    if args.apply and n:
        cur.execute("CREATE TEMP TABLE _bt(k TEXT, v TEXT)")
        cur.executemany("INSERT INTO _bt VALUES(?,?)", [(b, get_batch_type(b or "")) for b in batches])
        cur.execute("CREATE INDEX _bt_i ON _bt(k)")
        cur.execute(f"UPDATE admission_records SET batch_type="
                    f"(SELECT v FROM _bt WHERE _bt.k IS admission_records.batch) WHERE {MISS_BT}")
        con.commit()
        cur.execute("DROP TABLE _bt")

    # ── 2. subject_must / subject_any_of（只补两列皆空且有要求的行）──
    reqs = [s for (s,) in cur.execute(
        f"SELECT DISTINCT COALESCE(subject_req,'') FROM admission_records WHERE {EMPTY_SUBJ}")]
    fix = [(s, *parse_subject_fields(s)) for s in reqs]
    fix = [(s, m, a) for (s, m, a) in fix if m or a]   # 解析出实质要求才回填
    if args.apply and fix:
        cur.execute("CREATE TEMP TABLE _sj(req TEXT, must TEXT, anyof TEXT)")
        cur.executemany("INSERT INTO _sj VALUES(?,?,?)", fix)
        cur.execute("CREATE INDEX _sj_i ON _sj(req)")
        cur.execute(
            f"UPDATE admission_records SET "
            f"subject_must=(SELECT must FROM _sj WHERE _sj.req IS admission_records.subject_req), "
            f"subject_any_of=(SELECT anyof FROM _sj WHERE _sj.req IS admission_records.subject_req) "
            f"WHERE ({EMPTY_SUBJ}) AND subject_req IN (SELECT req FROM _sj)")
        aff = cur.rowcount
        con.commit()
        cur.execute("DROP TABLE _sj")
        print(f"[subject]    已回填 {aff} 行（{len(fix)} 种 subject_req 有要求）")
    else:
        nsub = cur.execute(
            f"SELECT COUNT(*) FROM admission_records WHERE ({EMPTY_SUBJ}) AND subject_req IN "
            f"({','.join('?'*len(fix)) or 'NULL'})", [s for s, _, _ in fix]).fetchone()[0] if fix else 0
        print(f"[subject]    待回填 {nsub} 行（{len(fix)} 种 subject_req 有要求）")

    # ── 3. is_985 / is_211（按 school_name 查 schools）───────────────
    exact, norm = {}, {}
    for nm, a, b in con.execute("SELECT name, is_985, is_211 FROM schools"):
        exact[nm] = (a or "否", b or "否")
        norm.setdefault(_norm_name(nm), (a or "否", b or "否"))
    names = [r[0] for r in cur.execute(f"SELECT DISTINCT school_name FROM admission_records WHERE {MISS_985}")]
    n985 = cur.execute(f"SELECT COUNT(*) FROM admission_records WHERE {MISS_985}").fetchone()[0]
    matched = sum(1 for nm in names if nm in exact or _norm_name(nm) in norm)
    print(f"[is_985/211] 待回填 {n985} 行；{len(names)} 校匹配 {matched}，未匹配 {len(names)-matched}（默认 否）")
    if args.apply and n985:
        cur.execute("CREATE TEMP TABLE _n9(nm TEXT, a TEXT, b TEXT)")
        cur.executemany("INSERT INTO _n9 VALUES(?,?,?)",
                        [(nm, *(exact.get(nm) or norm.get(_norm_name(nm)) or ("否", "否"))) for nm in names])
        cur.execute("CREATE INDEX _n9_i ON _n9(nm)")
        cur.execute(
            f"UPDATE admission_records SET "
            f"is_985=(SELECT a FROM _n9 WHERE _n9.nm IS admission_records.school_name), "
            f"is_211=(SELECT b FROM _n9 WHERE _n9.nm IS admission_records.school_name) WHERE {MISS_985}")
        con.commit()
        cur.execute("DROP TABLE _n9")

    con.close()
    print("✓ 完成" if args.apply else "（dry-run 结束，未写库；加 --apply 执行）")


if __name__ == "__main__":
    main()
