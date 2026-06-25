"""专家版数据写库模块。

用 ColumnMap 的「列号↔字段」对应，把任意一省 xlsx：
  1. 写入新表 admission_2026（2026计划 + 院校信息 + 专业信息；未识别列进 extra_json）；
  2. 回填历年录取到现有 admission_records（去重键：省+校+专业+年+最低分，只补不覆盖）。

默认 dry-run（只统计、不写库）。--apply 才真正建表/写入。

用法（在 backend 目录）:
  .venv/bin/python -m importers.expert_import --dir "/Users/czt/workspace/webfrontend/高考程序素材/2026"
  .venv/bin/python -m importers.expert_import --dir "<目录>" --apply
  .venv/bin/python -m importers.expert_import --file "<某省.xlsx>" --apply
  .venv/bin/python -m importers.expert_import --dir "<目录>" --dict   # 仅生成数据字典 md
"""
import argparse
import glob
import hashlib
import json
import os
import sqlite3

import openpyxl

from .field_registry import PLAN_FIELDS
from .column_mapper import ColumnMap

DEFAULT_DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "gaokao.db")
PLAN_TABLE = "admission_2026"
# admission_2026 里除规范字段外额外的列
EXTRA_COLS = [("source_file", "TEXT", "来源文件名"),
              ("extra_json", "TEXT", "未识别列的原始值(JSON)"),
              ("row_uid", "TEXT", "行唯一标识(省+院校代码+专业组代码+专业代码)")]


# ── 解析助手 ──────────────────────────────────────────────────────────────
def _s(v):
    return "" if v is None else str(v).strip()


def _i(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    t = str(v).strip().replace(",", "")
    if t in ("", "-", "—", "待定", "/", "无", "N/A", "暂无"):
        return None
    try:
        return int(float(t))
    except ValueError:
        return None


def _cell(row, idx):
    return row[idx] if idx is not None and idx < len(row) else None


# ── DDL ─────────────────────────────────────────────────────────────────────
def plan_ddl():
    cols = ["id INTEGER PRIMARY KEY AUTOINCREMENT"]
    for f in PLAN_FIELDS:
        cols.append(f"{f.key} {'INTEGER' if f.type == 'int' else 'TEXT'}")
    for name, typ, _ in EXTRA_COLS:
        cols.append(f"{name} {typ}")
    return f"CREATE TABLE IF NOT EXISTS {PLAN_TABLE} (\n  " + ",\n  ".join(cols) + "\n)"


PLAN_INDEXES = [
    f"CREATE UNIQUE INDEX IF NOT EXISTS ux_a26_uid ON {PLAN_TABLE}(row_uid)",
    f"CREATE INDEX IF NOT EXISTS ix_a26_prov_year ON {PLAN_TABLE}(province, plan_year)",
    f"CREATE INDEX IF NOT EXISTS ix_a26_psm ON {PLAN_TABLE}(province, school_name, major_name)",
    f"CREATE INDEX IF NOT EXISTS ix_a26_school ON {PLAN_TABLE}(school_name)",
    f"CREATE INDEX IF NOT EXISTS ix_a26_major ON {PLAN_TABLE}(major_name)",
]


def write_data_dictionary(path):
    lines = ["# admission_2026 数据字典\n",
             "| 列名 | 类型 | 含义 |", "|---|---|---|"]
    for f in PLAN_FIELDS:
        lines.append(f"| {f.key} | {'INT' if f.type == 'int' else 'TEXT'} | {f.comment} |")
    for name, typ, comment in EXTRA_COLS:
        lines.append(f"| {name} | {typ} | {comment} |")
    lines += ["\n## 历年录取（回填至 admission_records）",
              "块1=2025、块2=2024、块3=2023（辽宁仅2块）；仅 admit_count/min_score/min_rank 入库，"
              "平均/最高分因现表无列而丢弃。"]
    with open(path, "w") as fp:
        fp.write("\n".join(lines))
    return path


# ── 单文件导入 ────────────────────────────────────────────────────────────
def import_file(path, conn, apply, existing_hist, stats):
    cm = ColumnMap.detect(path)
    prov = cm.province
    if cm.warnings:
        for w in cm.warnings:
            print(f"  ⚠ [{prov}] {w}")

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    fc = cm.field_cols
    hist_blocks = cm.history_blocks()

    plan_rows = []
    hist_rows = []
    seen_uid = set()
    seen_hist = set()
    src = os.path.basename(path)

    for row in ws.iter_rows(min_row=cm.data_start_row, values_only=True):
        sch = _s(_cell(row, fc.get("school_name")))
        if not sch:
            continue

        # —— admission_2026 行 ——
        rec = {}
        for f in PLAN_FIELDS:
            v = _cell(row, fc.get(f.key))
            rec[f.key] = _i(v) if f.type == "int" else _s(v)
        rec["province"] = rec.get("province") or prov
        rec["source_file"] = src
        extra = {h: _s(_cell(row, c)) for h, c in cm.extra_cols.items() if _s(_cell(row, c))}
        rec["extra_json"] = json.dumps(extra, ensure_ascii=False) if extra else ""
        uid_basis = "|".join([prov, _s(_cell(row, fc.get("school_code"))),
                              _s(_cell(row, fc.get("group_full_code"))),
                              _s(_cell(row, fc.get("major_code")))])
        rec["row_uid"] = hashlib.md5(uid_basis.encode()).hexdigest()
        if rec["row_uid"] not in seen_uid:
            seen_uid.add(rec["row_uid"])
            plan_rows.append(rec)

        # —— 历年回填候选 ——
        major = _s(_cell(row, fc.get("major_name")))
        for idx, year, cols in hist_blocks:
            min_score = _i(_cell(row, cols.get("min_score")))
            if min_score is None:
                continue
            yr = cm.row_year(idx, row)
            key = (prov, sch, major, yr, min_score)   # 去重键：数字身份
            if key in existing_hist or key in seen_hist:
                continue
            seen_hist.add(key)
            hist_rows.append({
                "school_code": _s(_cell(row, fc.get("school_code"))),
                "school_name": sch, "major_name": major,
                "major_group": _s(_cell(row, fc.get("group_name"))),
                "province": prov, "year": yr,
                "batch": _s(_cell(row, fc.get("batch"))),
                "subject_req": _s(_cell(row, fc.get("subject_req"))),
                "major_remark": _s(_cell(row, fc.get("major_remark"))),
                "min_score": min_score,
                "min_rank": _i(_cell(row, cols.get("min_rank"))) or 0,
                "admit_count": _i(_cell(row, cols.get("admit_count"))) or 0,
                "school_province": _s(_cell(row, fc.get("school_province"))),
                "school_nature": _s(_cell(row, fc.get("nature"))),
            })
    wb.close()

    print(f"  [{prov}] 计划行 {len(plan_rows)}  历年待补 {len(hist_rows)}")
    stats["plan"] += len(plan_rows)
    stats["hist"] += len(hist_rows)

    if apply:
        cur = conn.cursor()
        if plan_rows:
            cols = [f.key for f in PLAN_FIELDS] + [c[0] for c in EXTRA_COLS]
            ph = ",".join("?" for _ in cols)
            cur.executemany(
                f"INSERT OR REPLACE INTO {PLAN_TABLE} ({','.join(cols)}) VALUES ({ph})",
                [tuple(r.get(c) for c in cols) for r in plan_rows])
        if hist_rows:
            hcols = list(hist_rows[0].keys())
            ph = ",".join("?" for _ in hcols)
            cur.executemany(
                f"INSERT INTO admission_records ({','.join(hcols)}) VALUES ({ph})",
                [tuple(r[c] for c in hcols) for r in hist_rows])
        # 已写入的历年键并入集合，避免跨文件重复
        for r in hist_rows:
            existing_hist.add((r["province"], r["school_name"], r["major_name"],
                               r["year"], r["min_score"]))


# ── 主流程 ──────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="专家版数据通用导入")
    ap.add_argument("--dir", help="包含多省 xlsx 的目录")
    ap.add_argument("--file", help="单个 xlsx")
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--apply", action="store_true", help="真正写库（默认 dry-run）")
    ap.add_argument("--dict", action="store_true", help="只生成数据字典 md 后退出")
    args = ap.parse_args()

    if args.dict:
        out = os.path.join(os.path.dirname(args.db), "admission_2026_数据字典.md")
        print("数据字典 ->", write_data_dictionary(out))
        return

    files = []
    if args.file:
        files = [args.file]
    elif args.dir:
        files = sorted(glob.glob(os.path.join(args.dir, "*.xlsx")))
    if not files:
        raise SystemExit("需要 --dir 或 --file")

    mode = "APPLY（写库）" if args.apply else "DRY-RUN（不写库）"
    print(f"== {mode} | DB: {args.db} | 文件 {len(files)} 个 ==")

    conn = sqlite3.connect(args.db)
    cur = conn.cursor()
    if args.apply:
        cur.execute(plan_ddl())
        for ddl in PLAN_INDEXES:
            cur.execute(ddl)
        print(f"  建表 {PLAN_TABLE} + {len(PLAN_INDEXES)} 索引完成")

    # 现有历年键（全省一次性加载，用于 diff）
    print("加载现有 admission_records 去重键 …")
    existing_hist = set(cur.execute(
        "SELECT province, school_name, major_name, year, min_score FROM admission_records"))
    print(f"  已有键 {len(existing_hist)}")

    stats = {"plan": 0, "hist": 0}
    for f in files:
        import_file(f, conn, args.apply, existing_hist, stats)

    print(f"\n合计：计划行 {stats['plan']}  历年待补 {stats['hist']}")
    if args.apply:
        conn.commit()
        write_data_dictionary(os.path.join(os.path.dirname(args.db), "admission_2026_数据字典.md"))
        print("✓ 已提交；数据字典已生成")
    else:
        print("（dry-run 结束，未写库；加 --apply 执行）")
    conn.close()


if __name__ == "__main__":
    main()
