"""
回填 admission_records.derived_category（真实科类）

为什么需要：admission_records 只有 subject_req（且 '不限' 丢失了首选科目），
无法可靠区分 3+1+2 省份的 物理类/历史类。本脚本用每条记录的
(min_score, min_rank) 去对当年（缺则就近年）该省「物理/历史一分一段」做匹配，
谁的累计位次离 min_rank 最近，就判定为谁——把 '不限'/具体再选科目 还原成真实科类。

派生值规范：'物理类' / '历史类' / '综合' / '文科' / '理科' / ''（无法判定）。
匹配层用等价映射消化 历史↔文科、物理↔理科。

用法：
  python scripts/backfill_derived_category.py            # 回填全部
  python scripts/backfill_derived_category.py --province 广东
  python scripts/backfill_derived_category.py --verify   # 只看分布，不写
"""
import sys, os, argparse, sqlite3, bisect

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.stdout.reconfigure(encoding="utf-8")
DB = os.path.join(os.path.dirname(__file__), "..", "gaokao.db")

# 综合省份只有一套排名；其余按 物理/历史（或旧 文理）两套判定
SPLIT_CATS = ("物理类", "历史类", "物理", "历史", "理科", "文科")


def load_rank_index(conn):
    """{province: {year: {category: (sorted_scores_asc, [cum...])}}}"""
    idx = {}
    cur = conn.execute(
        "SELECT province, year, category, score, count_cum FROM rank_tables "
        "WHERE count_cum > 0 ORDER BY province, year, category, score"
    )
    tmp = {}
    for prov, year, cat, score, cum in cur:
        tmp.setdefault((prov, year, cat), []).append((score, cum))
    for (prov, year, cat), pairs in tmp.items():
        pairs.sort()
        scores = [p[0] for p in pairs]
        cums = [p[1] for p in pairs]
        idx.setdefault(prov, {}).setdefault(year, {})[cat] = (scores, cums)
    return idx


def cum_at(table, score):
    """该 category 表中 score 对应累计位次：取 score<= 的最高分那段（与 app 口径一致）。"""
    scores, cums = table
    i = bisect.bisect_right(scores, score) - 1
    if i < 0:
        return cums[0]  # 低于最低分段，用最低段兜底（保守）
    return cums[i]


def nearest_year(years_map, year):
    """该省没有当年一分一段时，取最接近年份（仅用于判定科类空间，非取精确位次）。"""
    if year in years_map:
        return year
    return min(years_map, key=lambda y: abs(y - year)) if years_map else None


def derive(idx, province, year, score, rank, subject_req):
    years_map = idx.get(province)
    if not years_map:
        return _from_subject_req(subject_req)  # 无任何一分一段（如西藏）
    yr = nearest_year(years_map, year)
    cats = years_map[yr]
    if set(cats) <= {"综合"}:
        return "综合"
    # 在该省的「分科类」表里找 min_rank 最接近的科类
    best, best_diff = "", None
    for cat in cats:
        if cat not in SPLIT_CATS or score is None or rank is None:
            continue
        diff = abs(rank - cum_at(cats[cat], score))
        if best_diff is None or diff < best_diff:
            best, best_diff = cat, diff
    if best:
        return best
    if "综合" in cats:
        return "综合"
    return _from_subject_req(subject_req)


def _from_subject_req(sr):
    sr = sr or ""
    if "历史" in sr:
        return "历史类"
    if "物理" in sr:
        return "物理类"
    if "文科" in sr or sr == "文":
        return "文科"
    if "理科" in sr or sr == "理":
        return "理科"
    return ""


def ensure_column(conn):
    cols = [r[1] for r in conn.execute("PRAGMA table_info(admission_records)")]
    if "derived_category" not in cols:
        conn.execute("ALTER TABLE admission_records ADD COLUMN derived_category VARCHAR DEFAULT ''")
        conn.commit()
        print("已新增列 derived_category")


def run(province_filter, verify):
    conn = sqlite3.connect(DB)
    ensure_column(conn)
    idx = load_rank_index(conn)
    print(f"已载入 {len(idx)} 省的一分一段索引")

    where = "WHERE province=?" if province_filter else ""
    params = (province_filter,) if province_filter else ()
    rows = conn.execute(
        f"SELECT id, province, year, min_score, min_rank, subject_req "
        f"FROM admission_records {where}", params
    ).fetchall()
    print(f"待处理 {len(rows):,} 行")

    updates, dist = [], {}
    for rid, prov, year, score, rank, sr in rows:
        cat = derive(idx, prov, year, score, rank, sr)
        updates.append((cat, rid))
        dist[cat] = dist.get(cat, 0) + 1

    print("派生科类分布：")
    for k, v in sorted(dist.items(), key=lambda x: -x[1]):
        print(f"  {k or '(空/无法判定)':12s} {v:>9,}")

    if verify:
        print("\n--verify：未写库。")
        conn.close()
        return

    conn.executemany("UPDATE admission_records SET derived_category=? WHERE id=?", updates)
    conn.commit()
    print(f"\n已写入 {len(updates):,} 行的 derived_category")
    conn.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--province", default=None)
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()
    run(args.province, args.verify)
