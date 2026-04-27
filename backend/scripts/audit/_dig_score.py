"""挖掘 score-rank 严重不一致的根因。
样例：河南-中3000，山东大学 avg_rank=2674 但 API_score=509（反查2025应=654）

直接查数据库，看 AdmissionRecord 里的原始数据。
"""
import sys
sys.path.insert(0, ".")
from database import SessionLocal, AdmissionRecord

db = SessionLocal()

CASES = [
    ("山东大学", "河南"),
    ("中南财经政法大学", "河南"),
    ("北京医科大学", "北京"),
    ("四川农业大学", "北京"),
]
for name, prov in CASES:
    print(f"\n=== {name} @ {prov} ===")
    rs = db.query(AdmissionRecord).filter(
        AdmissionRecord.school_name == name,
        AdmissionRecord.province == prov,
    ).order_by(AdmissionRecord.year.desc()).limit(15).all()
    seen = set()
    for r in rs:
        key = (r.year, r.major_name[:20] if r.major_name else "")
        if key in seen:
            continue
        seen.add(key)
        print(f"  {r.year} | rank={r.min_rank:>6} | score={r.min_score:>5} | major={(r.major_name or '')[:30]} | batch={getattr(r,'batch','?')} | subject_req={getattr(r,'subject_requirement','?')}")
