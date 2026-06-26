"""把 rank_2026_merged.json 写入指定 gaokao.db 的 rank_tables（本地/线上通用）。

只用标准库 sqlite3，无三方依赖，可直接在服务器上跑。
默认演练（只统计不写）；--apply 才事务内「删 year 旧数据 + 插新」。
short=true 的短表（只覆盖高分段）默认跳过，避免按 per-province MAX(year) 盖掉旧年完整数据。

用法：
  python apply_rank_json.py --json rank_2026_merged.json --db gaokao.db            # 演练
  python apply_rank_json.py --json rank_2026_merged.json --db gaokao.db --apply     # 写入
  python apply_rank_json.py ... --include-short                                     # 连短表一起写
"""
import argparse, json, sqlite3, sys

sys.stdout.reconfigure(encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True)
    ap.add_argument("--db", required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--include-short", action="store_true", help="连短表/不全的表一起写")
    args = ap.parse_args()

    data = json.load(open(args.json, encoding="utf-8"))
    year = data["year"]
    tables = [t for t in data["tables"] if args.include_short or not t.get("short")]
    skipped = [t for t in data["tables"] if not (args.include_short or not t.get("short"))]
    total_rows = sum(len(t["rows"]) for t in tables)

    print(f"JSON: {args.json}  year={year}")
    print(f"将写入 {len(tables)} 表 / {total_rows:,} 行；跳过短表 {len(skipped)} "
          f"（{'、'.join(t['province']+'/'+t['category'] for t in skipped) or '无'}）")

    con = sqlite3.connect(args.db)
    cur = con.cursor()
    old = cur.execute("SELECT COUNT(*) FROM rank_tables WHERE year=?", (year,)).fetchone()[0]
    print(f"线上库 year={year} 现有 {old:,} 行 → 将被替换")

    if not args.apply:
        print("\n[演练] 未写库。确认无误后加 --apply。")
        con.close(); return

    try:
        cur.execute("BEGIN")
        cur.execute("DELETE FROM rank_tables WHERE year=?", (year,))
        ins = 0
        for t in tables:
            prov, cat = t["province"], t["category"]
            batch = "本科批"
            payload = []
            for r in t["rows"]:
                cum, cnt = int(r["count_cum"]), int(r.get("count_this", 0))
                payload.append((prov, year, cat, batch, int(r["score"]),
                                cnt, cum, cum - cnt + 1, cum))
            cur.executemany(
                "INSERT INTO rank_tables(province,year,category,batch,score,"
                "count_this,count_cum,rank_min,rank_max) VALUES (?,?,?,?,?,?,?,?,?)", payload)
            ins += len(payload)
        con.commit()
        new = cur.execute("SELECT COUNT(*) FROM rank_tables WHERE year=?", (year,)).fetchone()[0]
        provs = cur.execute("SELECT COUNT(DISTINCT province) FROM rank_tables WHERE year=?", (year,)).fetchone()[0]
        print(f"\n✅ 已写入 {ins:,} 行；year={year} 现有 {new:,} 行 / {provs} 省")
    except Exception as e:
        con.rollback()
        print(f"\n❌ 写入失败，已回滚: {e}"); sys.exit(1)
    finally:
        con.close()


if __name__ == "__main__":
    main()
