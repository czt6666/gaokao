"""
2026 一分一段 —— 合并 staging 为大 JSON + 导入本地库（步骤 3/4）

读取 data/rank_2026_staging/ 下全部 (省,科类) JSON（HTML 流程与图片/PDF 流程共用此目录），
统一行 schema 为 {score, count_this, count_cum}，对每张表重新跑累计自洽校验，
只把「干净表」合并进大 JSON 并 upsert 进本地 gaokao.db（year=2026）。
脏表只报告、不入库（CLAUDE Rule 12 失败要响）。

线上不动：本脚本只写本地库；上线由 migrate 脚本另行处理。

用法：
  python scripts/merge_import_rank_2026.py            # 合并大 JSON + 导入本地库
  python scripts/merge_import_rank_2026.py --no-import # 只合并出大 JSON + 校验，不写库
  python scripts/merge_import_rank_2026.py --reset     # 导入前先删本地库 year=2026 旧数据
"""
import sys, os, json, argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, os.path.dirname(__file__))
sys.stdout.reconfigure(encoding="utf-8")

from database import SessionLocal, init_db
from import_rank_tables_2025 import upsert_rows

YEAR = 2026
STAGING_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "rank_2026_staging")
MERGED_OUT = os.path.join(os.path.dirname(__file__), "..", "data", "rank_2026_merged.json")


def _norm_row(r: dict) -> dict | None:
    """兼容两种历史 schema，统一成 {score, count_this, count_cum}。"""
    score = r.get("score")
    cum = r.get("count_cum", r.get("cumulative"))
    cnt = r.get("count_this", r.get("count"))
    if score is None or cum is None:
        return None
    return {"score": int(score), "count_this": int(cnt or 0), "count_cum": int(cum)}


# 首行「X分及以上」聚合桶：count_cum 略大于 count_this 属正常（最高分段人数）。
# 但若首行累计很大（>此阈值），说明这表不是从顶部开始、而是缺了上半段的残表 → 硬错。
_TOP_BUCKET_MAX = 1500
# 正常一分一段最低覆盖到本科线（各省约 100~260）。最低分仍高于此说明只发了高分段，
# 是「短表/不全」：累计自洽但覆盖不够，入库会按 per-province MAX(year) 盖掉完整的旧年数据，
# 反而更糟 → 不入库，仅留在大 JSON + 报告里。
_FLOOR_OK = 350


def _validate(rows: list[dict]) -> list[str]:
    """累计自洽硬校验（权威）。分数缺号不算错（0 人省略）；
    首行小幅 cum>cnt 是「X分及以上」聚合桶，正常；首行 cum 过大才算残表硬错。"""
    if not rows:
        return ["无数据行"]
    hard = []
    if rows[0]["count_cum"] != rows[0]["count_this"] and rows[0]["count_cum"] > _TOP_BUCKET_MAX:
        hard.append(f"首行累计({rows[0]['count_cum']})过大≠人数({rows[0]['count_this']})，疑缺上半段")
    for i in range(1, len(rows)):
        if rows[i]["score"] >= rows[i - 1]["score"]:
            hard.append(f"分数非降序 {rows[i-1]['score']}→{rows[i]['score']}")
        exp = rows[i - 1]["count_cum"] + rows[i]["count_this"]
        if exp != rows[i]["count_cum"]:
            hard.append(f"分数{rows[i]['score']}: 累计应={exp} 实={rows[i]['count_cum']}")
    return hard


def main(do_import: bool, reset: bool):
    files = sorted(f for f in os.listdir(STAGING_DIR) if f.endswith(".json")
                   and not f.startswith("_") and f != "rank_2026_merged.json")
    clean, dirty = [], []
    for fn in files:
        d = json.load(open(os.path.join(STAGING_DIR, fn), encoding="utf-8"))
        rows = [x for x in (_norm_row(r) for r in d.get("rows", [])) if x]
        # 同分重复行（HTML 源常见「100」与「100分及以下」并存）去重：按原表序（降序）保留
        # 首次出现的那行——它与上一分数的累计自洽；后出现的多为「X分及以下」聚合行，丢弃。
        rows.sort(key=lambda r: r["score"], reverse=True)
        dedup: dict[int, dict] = {}
        for r in rows:
            dedup.setdefault(r["score"], r)
        rows = sorted(dedup.values(), key=lambda r: r["score"], reverse=True)
        hard = _validate(rows)
        floor = rows[-1]["score"] if rows else 999
        span = (rows[0]["score"] - rows[-1]["score"]) if rows else 0
        # 短表：最低分仍偏高(>350) 且 覆盖跨度窄(<200)。上海(660 制)/北京等虽 floor 略高，
        # 但跨度大、已到本科线，不算短；山西/湖北物理只发了高分段，floor 高且跨度窄 → 短。
        is_short = floor > _FLOOR_OK and span < 200
        rec = {"province": d.get("province"), "category": d.get("category"),
               "year": YEAR, "source": d.get("source", "html"),
               "row_count": len(rows), "score_range": [rows[0]["score"], rows[-1]["score"]] if rows else [],
               "rows": rows, "file": fn, "short": is_short}
        (clean if not hard else dirty).append((rec, hard))

    importable = [rec for rec, _ in clean if not rec["short"]]
    short = [rec for rec, _ in clean if rec["short"]]

    # 大 JSON：含全部累计自洽的表（标注 short），脏表不入
    merged = [rec for rec, _ in clean]
    with open(MERGED_OUT, "w", encoding="utf-8") as f:
        json.dump({"year": YEAR, "table_count": len(merged),
                   "row_total": sum(r["row_count"] for r in merged),
                   "tables": merged}, f, ensure_ascii=False)
    print(f"大 JSON: {os.path.relpath(MERGED_OUT)}  （{len(merged)} 表 / "
          f"{sum(r['row_count'] for r in merged):,} 行）")

    print(f"\n可入库（完整 + 自洽）{len(importable)}：")
    for rec in sorted(importable, key=lambda r: (r['province'] or '', r['category'] or '')):
        sr = rec["score_range"]
        print(f"  ✅ {rec['province']}/{rec['category']:4s} {rec['row_count']:>4}行 "
              f"{sr[0]}~{sr[1]}  ({rec['source']})")
    if short:
        print(f"\n短表/不全 {len(short)}（自洽但只覆盖高分段，不入库以免盖掉旧年完整数据）：")
        for rec in sorted(short, key=lambda r: r['province'] or ''):
            sr = rec["score_range"]
            print(f"  ◐ {rec['province']}/{rec['category']} {rec['row_count']}行 {sr[0]}~{sr[1]}  ({rec['source']})")
    if dirty:
        print(f"\n脏表 {len(dirty)}（OCR/源数据有错，不入库，待核对）：")
        for rec, hard in sorted(dirty, key=lambda x: x[0]['province'] or ''):
            print(f"  ⚠ {rec['province']}/{rec['category']} {rec['row_count']}行  {hard[0]}（共{len(hard)}处）")

    if not do_import:
        print("\n--no-import：未写库。"); return

    init_db()
    db = SessionLocal()
    if reset:
        from sqlalchemy import text
        n = db.execute(text("DELETE FROM rank_tables WHERE year=:y"), {"y": YEAR}).rowcount
        db.commit()
        print(f"\n已清除本地库 year={YEAR} 旧数据 {n} 行")
    print(f"\n导入本地库（year={YEAR}，仅完整自洽表）：")
    total = 0
    for rec in importable:
        n = upsert_rows(db, rec["rows"], rec["province"], YEAR, rec["category"])
        total += n
    db.close()
    print(f"  共 {len(importable)} 表，写入 {total:,} 行")
    print("\nSQL review 示例：")
    print("  sqlite3 gaokao.db \"SELECT province,category,COUNT(*),MIN(score),MAX(score) "
          "FROM rank_tables WHERE year=2026 GROUP BY province,category ORDER BY province\"")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--no-import", dest="do_import", action="store_false")
    p.add_argument("--reset", action="store_true", help="导入前删本地库 year=2026 旧数据")
    args = p.parse_args()
    main(args.do_import, args.reset)
