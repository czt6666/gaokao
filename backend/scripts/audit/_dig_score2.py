"""山东大学@河南 — avg_score=509 是怎么来的？查所有 record 找 509 分对应行。"""
import sys
sys.path.insert(0, ".")
from database import SessionLocal, AdmissionRecord
from collections import defaultdict

db = SessionLocal()
rs = db.query(AdmissionRecord).filter(
    AdmissionRecord.school_name == "山东大学",
    AdmissionRecord.province == "河南",
).order_by(AdmissionRecord.year.desc(), AdmissionRecord.min_rank.asc()).all()

print(f"总 record 数: {len(rs)}")

# 看分数分布
scores = sorted({r.min_score for r in rs if r.min_score})
print(f"分数范围: {scores[:5]}...{scores[-5:]}")

# 看 2025 record (用户能看到的最新)
print("\n=== 2025 records ===")
y25 = [r for r in rs if r.year == 2025]
for r in y25[:30]:
    print(f"  rank={r.min_rank:>6} score={r.min_score:>5} batch={r.batch} major={(r.major_name or '')[:30]}")

# 看score=509 的所有record
print("\n=== score=509 ±5 的 record ===")
for r in rs:
    if 504 <= (r.min_score or 0) <= 514:
        print(f"  {r.year} rank={r.min_rank:>6} score={r.min_score} batch={r.batch} major={(r.major_name or '')[:30]}")

# 看是哪些 grouped (school, major) 出现 latest min_score 偏低的
print("\n=== group by major, latest year score ===")
g = defaultdict(list)
for r in rs:
    if r.min_score and r.min_rank:
        g[r.major_name].append((r.year, r.min_rank, r.min_score, r.batch))
for major, recs in sorted(g.items()):
    recs.sort(key=lambda x: -x[0])
    latest = recs[0]
    if latest[2] <= 540:
        print(f"  {major[:30]} latest: year={latest[0]} rank={latest[1]} score={latest[2]} batch={latest[3]}")
