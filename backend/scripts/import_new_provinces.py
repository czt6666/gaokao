"""
增量省份导入器 — 针对新增/更新的省份 xlsx，替换该省旧数据后导入。

用法（在 backend 目录）:
  # Dry-run
  .venv/bin/python scripts/import_new_provinces.py \\
    --files "/Users/czt/workspace/webfrontend/高考程序素材/2026/2/河南-2026-专家版数据物理历史一体.xlsx" \\
            "/Users/czt/workspace/webfrontend/高考程序素材/2026/2/新疆-2026-专家版数据111.xlsx" \\
    --db gaokao.db

  # 正式导入
  .venv/bin/python scripts/import_new_provinces.py --files <file1> <file2> --db gaokao.db --apply

与 explode_importer.py 的区别：
  - 按省份增量导入，不删其他省数据
  - DELETE WHERE province IN (...) → 再 INSERT 新数据
  - 自动校验新旧行数变化
  - 导出精简库供线上同步
"""

import argparse
import hashlib
import os
import sqlite3
import sys
import time

import openpyxl

# 复用 explode_importer 的核心逻辑
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from importers.field_registry import PLAN_FIELDS
from importers.column_mapper import ColumnMap
from importers.explode_importer import (
    _s, _i, _cell,
    ensure_schema,
    ADMISSION_EXISTING_COLS, ADMISSION_NEW_COLS, A26_EXTRA_COLS,
)
from importers.static_maps import (
    get_batch_type, get_subject_must, get_subject_any_of,
    get_major_restrictions, get_is_985_211, get_derived_category,
)

DEFAULT_DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "gaokao.db")


def import_file(path: str, conn: sqlite3.Connection, apply: bool):
    """处理单个 xlsx：detect → explode → 返回待写入行列表。"""
    cm = ColumnMap.detect(path)
    prov = cm.province
    if cm.warnings:
        for w in cm.warnings:
            print(f"  ⚠ [{prov}] {w}")

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    fc = cm.field_cols
    hist_blocks = cm.history_blocks()
    src = os.path.basename(path)

    a26_rows = []
    adm_rows = []
    seen_uid = set()
    seen_hist = set()

    for row in ws.iter_rows(min_row=cm.data_start_row, values_only=True):
        sch = _s(_cell(row, fc.get("school_name")))
        if not sch:
            continue

        # ── 基础字段提取 ──
        school_code = _s(_cell(row, fc.get("school_code")))
        school_name = sch
        major_name = _s(_cell(row, fc.get("major_name")))
        major_full = _s(_cell(row, fc.get("major_full")))
        major_code = _s(_cell(row, fc.get("major_code")))
        major_remark = _s(_cell(row, fc.get("major_remark")))
        province = _s(_cell(row, fc.get("province"))) or prov
        batch = _s(_cell(row, fc.get("batch")))
        category = _s(_cell(row, fc.get("category")))
        subject_req = _s(_cell(row, fc.get("subject_req")))
        major_level = _s(_cell(row, fc.get("major_level")))
        plan_count = _i(_cell(row, fc.get("plan_count")))
        duration = _s(_cell(row, fc.get("duration")))
        tuition = _s(_cell(row, fc.get("tuition")))
        discipline = _s(_cell(row, fc.get("discipline")))
        major_class_s = _s(_cell(row, fc.get("major_class")))
        est_rank_26 = _i(_cell(row, fc.get("est_rank_26")))
        is_new = _s(_cell(row, fc.get("is_new")))

        school_province = _s(_cell(row, fc.get("school_province")))
        city = _s(_cell(row, fc.get("city")))
        city_level = _s(_cell(row, fc.get("city_level")))
        school_tags = _s(_cell(row, fc.get("school_tags")))
        school_level = _s(_cell(row, fc.get("school_level")))
        nature = _s(_cell(row, fc.get("nature")))
        group_name = _s(_cell(row, fc.get("group_name")))
        group_code = _s(_cell(row, fc.get("group_code")))
        group_full_code = _s(_cell(row, fc.get("group_full_code")))
        plan_category = _s(_cell(row, fc.get("plan_category")))
        ruanke_grade = _s(_cell(row, fc.get("ruanke_grade")))
        ruanke_rank = _s(_cell(row, fc.get("ruanke_rank")))
        discipline_eval = _s(_cell(row, fc.get("discipline_eval")))
        major_level_tag = _s(_cell(row, fc.get("major_level_tag")))

        # ── 静态映射 ──
        batch_type = get_batch_type(batch)
        is_985, is_211 = get_is_985_211(school_tags)
        derived_category = get_derived_category(category)
        subject_must = get_subject_must(subject_req)

        # 3+1+2 省份不限选科 → must 补首选科目
        if (not subject_must) and category in ("物理", "历史", "物理类", "历史类", "理科", "文科"):
            first_map = {"物理": "物理", "物理类": "物理", "理科": "物理",
                         "历史": "历史", "历史类": "历史", "文科": "历史"}
            subject_must = first_map.get(category, "")

        subject_any_of = get_subject_any_of(subject_req)
        restrictions_tags = get_major_restrictions(plan_category, major_full, major_remark)
        major_restrictions = ",".join(restrictions_tags) if restrictions_tags else ""

        # ── admission_2026 行 ──
        uid_basis = "|".join([province, school_code, group_full_code, major_code])
        row_uid = hashlib.md5(uid_basis.encode()).hexdigest()

        if row_uid not in seen_uid:
            seen_uid.add(row_uid)
            a26_rec = {}
            for f in PLAN_FIELDS:
                v = _cell(row, fc.get(f.key))
                a26_rec[f.key] = _i(v) if f.type == "int" else _s(v)
            a26_rec["province"] = a26_rec.get("province") or province
            a26_rec["source_file"] = src
            a26_rec["row_uid"] = row_uid
            a26_rows.append(a26_rec)

        # ── Explode 历年数据 → admission_records ──
        shared = {
            "school_code": school_code,
            "school_name": school_name,
            "major_name": major_name,
            "major_full": major_full,
            "major_code": major_code,
            "major_group": group_name,
            "major_remark": major_remark,
            "province": province,
            "batch": batch,
            "subject_req": subject_req,
            "batch_type": batch_type,
            "subject_must": subject_must,
            "subject_any_of": subject_any_of,
            "major_restrictions": major_restrictions,
            "derived_category": derived_category,
            "school_province": school_province,
            "school_nature": nature,
            "is_985": is_985,
            "is_211": is_211,
            "school_tags": school_tags,
            "school_level": school_level,
            "city": city,
            "city_level": city_level,
            "major_level": major_level,
            "discipline": discipline,
            "major_class": major_class_s,
            "group_name": group_name,
            "group_code": group_code,
            "group_full_code": group_full_code,
            "plan_category": plan_category,
            "duration": duration,
            "tuition": tuition,
            "ruanke_grade": ruanke_grade,
            "ruanke_rank": ruanke_rank,
            "discipline_eval": discipline_eval,
            "major_level_tag": major_level_tag,
            "source_file": src,
        }

        for idx, year, cols in hist_blocks:
            min_score = _i(_cell(row, cols.get("min_score")))
            if min_score is None:
                continue
            yr = cm.row_year(idx, row)
            admit_count = _i(_cell(row, cols.get("admit_count")))
            min_rank = _i(_cell(row, cols.get("min_rank"))) or 0

            hist_key = (province, school_name, major_name, yr, min_score)
            if hist_key in seen_hist:
                continue
            seen_hist.add(hist_key)
            adm_rows.append({
                **shared,
                "year": yr,
                "min_score": min_score,
                "min_rank": min_rank,
                "admit_count": admit_count or 0,
                "plan_count": None,
                "est_rank_26": None,
            })

    wb.close()
    return {"province": prov, "a26": a26_rows, "adm": adm_rows, "src": src}


def write_province(conn: sqlite3.Connection, province: str,
                    a26_rows: list, adm_rows: list):
    """先删后写——替换该省在两表中的数据。"""
    cur = conn.cursor()
    cur.execute("DELETE FROM admission_2026 WHERE province = ?", (province,))
    cur.execute("DELETE FROM admission_records WHERE province = ?", (province,))

    # admission_2026
    if a26_rows:
        a26_cols = [f.key for f in PLAN_FIELDS] + [c[0] for c in A26_EXTRA_COLS]
        existing_cols = {r[1] for r in cur.execute("PRAGMA table_info(admission_2026)")}
        write_cols = [c for c in a26_cols if c in existing_cols]
        ph = ",".join("?" for _ in write_cols)
        cur.executemany(
            f"INSERT INTO admission_2026 ({','.join(write_cols)}) VALUES ({ph})",
            [tuple(r.get(c) for c in write_cols) for r in a26_rows])

    # admission_records
    if adm_rows:
        all_cols = ADMISSION_EXISTING_COLS + [c[0] for c in ADMISSION_NEW_COLS
                                               if c[0] not in ADMISSION_EXISTING_COLS]
        existing_cols = {r[1] for r in cur.execute("PRAGMA table_info(admission_records)")}
        write_cols = [c for c in all_cols if c in existing_cols]
        ph = ",".join("?" for _ in write_cols)
        cur.executemany(
            f"INSERT INTO admission_records ({','.join(write_cols)}) VALUES ({ph})",
            [tuple(r.get(c) for c in write_cols) for r in adm_rows])

    conn.commit()


def export_slim_db(conn: sqlite3.Connection, output_path: str, provinces: list[str]):
    """导出仅含目标省份数据的精简库，供线上同步。"""
    # 创建精简库
    slim = sqlite3.connect(output_path)
    slim.execute("PRAGMA journal_mode=OFF")
    slim.execute("PRAGMA synchronous=OFF")

    # 复制两表结构
    for tbl in ("admission_records", "admission_2026"):
        # schema
        cur = conn.execute(f"SELECT sql FROM sqlite_master WHERE type='table' AND name='{tbl}'")
        create_sql = cur.fetchone()[0]
        slim.execute(create_sql)

        # data for target provinces
        all_cols = [r[1] for r in conn.execute(f"PRAGMA table_info({tbl})")]
        ph = ",".join("?" for _ in all_cols)
        for p in provinces:
            rows = conn.execute(
                f"SELECT {','.join(all_cols)} FROM {tbl} WHERE province = ?", (p,)).fetchall()
            if rows:
                slim.executemany(
                    f"INSERT INTO {tbl} ({','.join(all_cols)}) VALUES ({ph})", rows)

    slim.commit()
    slim.close()
    print(f"  精简库已导出: {output_path}")


def main():
    ap = argparse.ArgumentParser(description="增量省份导入器")
    ap.add_argument("--files", nargs="+", required=True, help="要导入的 xlsx 文件列表")
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--apply", action="store_true", help="真正写库（默认 dry-run）")
    ap.add_argument("--export", help="导出精简库路径（--apply 时生效）")
    args = ap.parse_args()

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"== {mode} | DB: {args.db} | 文件 {len(args.files)} 个 ==")
    print()

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")

    if args.apply:
        ensure_schema(conn)
        print("  Schema 就绪\n")

    # ── 1. 解析每个文件 ──
    all_results = {}
    t0 = time.time()
    for path in args.files:
        print(f"  解析: {os.path.basename(path)} ...")
        result = import_file(path, conn, args.apply)
        prov = result["province"]
        all_results[path] = result
        print(f"    → {prov} | plan={len(result['a26']):,} | explode={len(result['adm']):,}")

    elapsed = time.time() - t0
    print(f"\n  解析耗时: {elapsed:.0f}s")

    # ── 2. 统计旧数据 ──
    provinces = list(set(r["province"] for r in all_results.values()))
    print(f"\n  涉及省份: {provinces}")
    old_counts = {}
    for p in provinces:
        old_a26 = conn.execute(
            "SELECT COUNT(*) FROM admission_2026 WHERE province = ?", (p,)).fetchone()[0]
        old_adm = conn.execute(
            "SELECT COUNT(*) FROM admission_records WHERE province = ?", (p,)).fetchone()[0]
        old_counts[p] = {"a26": old_a26, "adm": old_adm}
        print(f"  旧数据 [{p}]: plan={old_a26:,} | explode={old_adm:,}")

    new_counts = {}
    for r in all_results.values():
        p = r["province"]
        new_counts[p] = {"a26": len(r["a26"]), "adm": len(r["adm"])}

    print()
    print("  变更摘要:")
    for p in provinces:
        old = old_counts[p]
        new = new_counts[p]
        d_a26 = new["a26"] - old["a26"]
        d_adm = new["adm"] - old["adm"]
        sign_a26 = f"+{d_a26:,}" if d_a26 >= 0 else f"{d_a26:,}"
        sign_adm = f"+{d_adm:,}" if d_adm >= 0 else f"{d_adm:,}"
        print(f"    [{p}] plan: {old['a26']:,} → {new['a26']:,} ({sign_a26})")
        print(f"    [{p}] explode: {old['adm']:,} → {new['adm']:,} ({sign_adm})")

    if not args.apply:
        print("\n(dry-run 结束，加 --apply 正式执行)")
        conn.close()
        return

    # ── 3. 写入 ──
    print("\n  写入数据...")
    for r in all_results.values():
        p = r["province"]
        print(f"    [{p}] 清空旧数据...")
        write_province(conn, p, r["a26"], r["adm"])
        print(f"    [{p}] 写入完成: plan={len(r['a26']):,} | explode={len(r['adm']):,}")

    # ── 4. 验证 ──
    print("\n  验证写入结果...")
    for p in provinces:
        cur_a26 = conn.execute(
            "SELECT COUNT(*) FROM admission_2026 WHERE province = ?", (p,)).fetchone()[0]
        cur_adm = conn.execute(
            "SELECT COUNT(*) FROM admission_records WHERE province = ?", (p,)).fetchone()[0]
        expected_a26 = new_counts[p]["a26"]
        expected_adm = new_counts[p]["adm"]
        ok_a26 = "✓" if cur_a26 == expected_a26 else "✗ MISMATCH"
        ok_adm = "✓" if cur_adm == expected_adm else "✗ MISMATCH"
        print(f"    [{p}] plan: {cur_a26:,} (预期 {expected_a26:,}) {ok_a26}")
        print(f"    [{p}] explode: {cur_adm:,} (预期 {expected_adm:,}) {ok_adm}")

    # ── 5. 索引整理 ──
    print("\n  重建索引...")
    cur = conn.cursor()
    cur.execute("CREATE INDEX IF NOT EXISTS ix_ar_prov_year ON admission_records(province, year)")
    cur.execute("CREATE INDEX IF NOT EXISTS ix_ar_school ON admission_records(school_name)")
    cur.execute("CREATE INDEX IF NOT EXISTS ix_ar_major ON admission_records(major_name)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_a26_uid ON admission_2026(row_uid)")
    cur.execute("CREATE INDEX IF NOT EXISTS ix_a26_prov ON admission_2026(province)")
    cur.execute("CREATE INDEX IF NOT EXISTS ix_a26_school ON admission_2026(school_name)")
    conn.commit()
    print("  索引就绪")

    # ── 6. 导出精简库 ──
    if args.export:
        print(f"\n  导出精简库: {args.export}")
        export_slim_db(conn, args.export, provinces)

    print("\n✓ 导入完成")
    conn.close()


if __name__ == "__main__":
    main()
