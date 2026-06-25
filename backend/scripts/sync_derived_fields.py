"""
增量同步 derived_category / subject_must 到线上 DB（数据层，不走应用层）。

工作流：
  ① 本地：python scripts/sync_derived_fields.py --export --db gaokao.db
      → 生成 sync_derived_YYYYMMDD_HHMMSS.sql.gz（只含 id + 两列值，~25 MB）

  ② 上传到服务器（scp / rsync / 任意方式）

  ③ 服务器：python scripts/sync_derived_fields.py --apply sync_derived_xxx.sql.gz --db /path/to/online.db
      → 自动加列（如缺失）+ 批量 UPDATE

特征：
  - 不删不改旧数据，只 UPDATE derived_category 和 subject_must
  - 增量列：线上有列就跳过 ALTER；线上少列就补
  - 每 3000 行一批提交，线上不停服也能跑
  - gzip 压缩传输，2.94M 行约 25 MB，比全库 (2.9G) 小 100 倍
"""

import argparse
import gzip
import os
import sqlite3
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BATCH_SIZE = 3000

SYNC_COLS = [
    ("derived_category", "VARCHAR DEFAULT ''"),
    ("subject_must",     "VARCHAR(100) DEFAULT ''"),
]


# ── 导出（本地运行）─────────────────────────────────────────────────────
def export_sync(source_db: str, output: str):
    if not os.path.exists(source_db):
        sys.exit(f"源数据库不存在: {source_db}")

    src = sqlite3.connect(source_db)
    # 确保列存在
    cur = src.execute("PRAGMA table_info(admission_records)")
    existing = {r[1] for r in cur.fetchall()}
    missing = [c for c, _ in SYNC_COLS if c not in existing]
    if missing:
        print(f"⚠ 本地缺列 {missing}，请先跑 backfill 脚本。")
        src.close()
        return

    total = src.execute("SELECT COUNT(*) FROM admission_records").fetchone()[0]
    print(f"导出 admission_records 增量列：{total:,} 行")

    out = gzip.open(output, "wt", encoding="utf-8", compresslevel=6)
    out.write("-- SYNC derived_category / subject_must\n")
    out.write(f"-- rows: {total}\n")
    out.write(f"-- exported: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    out.write("-- format: UPDATE admission_records SET dc=?,sm=? WHERE id=?\n\n")

    cur = src.execute("SELECT id, derived_category, subject_must FROM admission_records ORDER BY id")
    written = 0
    t0 = time.time()
    while True:
        rows = cur.fetchmany(BATCH_SIZE)
        if not rows:
            break
        for rid, dc, sm in rows:
            out.write(f"{rid}\t{dc or ''}\t{sm or ''}\n")
        written += len(rows)
        if written % 300000 == 0:
            print(f"  ... {written:,} / {total:,} ({written*100/total:.1f}%)")

    out.close()
    src.close()
    size_mb = os.path.getsize(output) / 1024 / 1024
    print(f"✅ 导出完成: {output}  ({size_mb:.1f} MB)")


# ── 导入（服务器运行）─────────────────────────────────────────────────────
def apply_sync(source_file: str, target_db: str):
    if not os.path.exists(source_file):
        sys.exit(f"同步文件不存在: {source_file}")
    if not os.path.exists(target_db):
        sys.exit(f"目标数据库不存在: {target_db}")

    tgt = sqlite3.connect(target_db)

    # 1) 自动加列
    cur = tgt.execute("PRAGMA table_info(admission_records)")
    existing = {r[1] for r in cur.fetchall()}
    for col_name, col_def in SYNC_COLS:
        if col_name not in existing:
            print(f"[ALTER] ADD COLUMN {col_name}")
            tgt.execute(f"ALTER TABLE admission_records ADD COLUMN {col_name} {col_def}")
    tgt.commit()

    # 2) 批量 UPDATE
    tgt.execute("PRAGMA journal_mode=WAL")
    tgt.execute("PRAGMA synchronous=NORMAL")

    # 从文件头读取源行数
    header_total = 0
    raw = gzip.open(source_file, "rt", encoding="utf-8")
    for line in raw:
        if line.startswith("-- rows: "):
            header_total = int(line.split(":")[1].strip())
            break
    raw.close()

    print(f"开始应用增量数据 (源行数: {header_total:,})...")
    lines = gzip.open(source_file, "rt", encoding="utf-8")
    batch_id, batch_dc, batch_sm = [], [], []
    total, skipped = 0, 0
    t0 = time.time()

    for line in lines:
        if line.startswith("--"):
            continue
        line = line.rstrip("\n\r")
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) != 3:
            skipped += 1
            continue
        rid, dc, sm = parts
        batch_id.append(int(rid))
        batch_dc.append(dc)
        batch_sm.append(sm)

        if len(batch_id) >= BATCH_SIZE:
            _update_batch(tgt, batch_id, batch_dc, batch_sm)
            total += len(batch_id)
            batch_id.clear(); batch_dc.clear(); batch_sm.clear()
            if total % 300000 == 0:
                print(f"  ... {total:,} / {header_total:,} ({time.time() - t0:.0f}s)")

    if batch_id:
        _update_batch(tgt, batch_id, batch_dc, batch_sm)
        total += len(batch_id)

    lines.close()
    tgt.close()

    if skipped:
        print(f"⚠ 跳过 {skipped} 行（格式异常）")
    if total != header_total and header_total > 0:
        print(f"⚠ 行数不一致: 源 {header_total:,} / 应用 {total:,}")
    else:
        print(f"✅ 应用完成: {total:,} 行 ({time.time() - t0:.0f}s)")


def _update_batch(conn: sqlite3.Connection, ids: list, dcs: list, sms: list):
    """单条 UPDATE ... WHERE id=? 在 SQLite 批量提交中最快。"""
    cur = conn.cursor()
    for rid, dc, sm in zip(ids, dcs, sms):
        cur.execute(
            "UPDATE admission_records SET derived_category=?, subject_must=? WHERE id=?",
            (dc, sm, rid))
    conn.commit()


# ── 验证 ─────────────────────────────────────────────────────────────────
def verify_sync(target_db: str):
    """线上跑完后验证两列数据完整性。"""
    if not os.path.exists(target_db):
        sys.exit(f"数据库不存在: {target_db}")
    conn = sqlite3.connect(target_db)
    cur = conn.execute("PRAGMA table_info(admission_records)")
    existing = {r[1] for r in cur.fetchall()}
    for c, _ in SYNC_COLS:
        if c not in existing:
            print(f"❌ 列缺失: {c}")
            conn.close()
            return

    total = conn.execute("SELECT COUNT(*) FROM admission_records").fetchone()[0]
    filled_dc = conn.execute(
        "SELECT COUNT(*) FROM admission_records WHERE derived_category IS NOT NULL AND derived_category != ''"
    ).fetchone()[0]
    filled_sm = conn.execute(
        "SELECT COUNT(*) FROM admission_records WHERE subject_must IS NOT NULL AND subject_must != ''"
    ).fetchone()[0]
    print(f"admission_records 总计: {total:,}")
    print(f"  derived_category 非空: {filled_dc:,} ({filled_dc*100/total:.1f}%)")
    print(f"  subject_must     非空: {filled_sm:,} ({filled_sm*100/total:.1f}%)")

    # 分科类统计
    for cat in ("物理类", "历史类", "综合", "理科", "文科"):
        cnt = conn.execute(
            "SELECT COUNT(*) FROM admission_records WHERE derived_category=?", (cat,)
        ).fetchone()[0]
        if cnt:
            print(f"    {cat:6s} {cnt:>10,}")
    empty = conn.execute(
        "SELECT COUNT(*) FROM admission_records WHERE derived_category IS NULL OR derived_category=''"
    ).fetchone()[0]
    print(f"    (空)  {empty:>10,}")
    conn.close()


# ── CLI ───────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(
        description="增量同步 derived_category / subject_must（本地导出→服务器应用）")
    ap.add_argument("--db", default=os.path.join(SCRIPT_DIR, "..", "gaokao.db"),
                    help="数据库路径（导出=源，应用/验证=目标）")
    ap.add_argument("--export", metavar="OUTPUT",
                    help="导出增量列为压缩文件（本地运行）")
    ap.add_argument("--apply", metavar="SOURCE",
                    help="应用增量文件到数据库（服务器运行）")
    ap.add_argument("--verify", action="store_true",
                    help="验证目标数据库增量列完整性")
    args = ap.parse_args()

    if args.export:
        export_sync(args.db, args.export)
    elif args.apply:
        apply_sync(args.apply, args.db)
    elif args.verify:
        verify_sync(args.db)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
