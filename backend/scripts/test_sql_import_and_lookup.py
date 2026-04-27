"""
测试 SQL 导入流程 + 各省分数转位次接口
步骤：
  1. 复制备份为测试库
  2. 清空测试库 year=2025 数据
  3. 用导出的 SQL INSERT 重新写入（模拟线上部署）
  4. 抽查各省分数→位次，验证转化正确
"""
import sys, os, sqlite3, re
sys.stdout.reconfigure(encoding="utf-8")

BACKUP = os.path.join(os.path.dirname(__file__), "..", "gaokao.db.backup.20260427_142910")
TEST_DB = os.path.join(os.path.dirname(__file__), "..", "gaokao_test.db")
SQL_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "rank_tables_2025_export.sql")

# ── 1. 创建测试库 ─────────────────────────────────────────────────
if os.path.exists(TEST_DB):
    os.remove(TEST_DB)

# 用 Python 复制（不用 cp）
with open(BACKUP, "rb") as f:
    data = f.read()
with open(TEST_DB, "wb") as f:
    f.write(data)
print(f"测试库创建: {TEST_DB}")

# ── 2. 导入 SQL ────────────────────────────────────────────────────
conn = sqlite3.connect(TEST_DB)
cur = conn.cursor()

# 先清掉旧 2025 数据
cur.execute("DELETE FROM rank_tables WHERE year=2025")
print(f"清空旧 2025 数据: {cur.rowcount} 条")

# 读取 SQL 文件并逐条执行
with open(SQL_FILE, "r", encoding="utf-8") as f:
    sql_text = f.read()

# 解析 INSERT 语句
inserts = re.findall(r"INSERT INTO rank_tables .*? VALUES \((.*?)\);", sql_text)
print(f"SQL 文件中共有 {len(inserts)} 条 INSERT")

rows = []
for ins in inserts:
    # 简单解析 tuple
    try:
        row = eval(f"({ins})")
        rows.append(row)
    except Exception:
        continue

# 批量插入
cur.executemany(
    "INSERT INTO rank_tables (province, year, category, batch, score, count_this, count_cum, rank_min, rank_max) VALUES (?,?,?,?,?,?,?,?,?)",
    rows
)
conn.commit()
print(f"导入完成: {cur.rowcount} 条")

# ── 3. 验证分数转位次 ──────────────────────────────────────────────
# 模拟 /api/rank-table 接口逻辑
def rank_lookup(province: str, year: int, score: int, db_path: str) -> dict:
    conn2 = sqlite3.connect(db_path)
    cur2 = conn2.cursor()
    cur2.execute(
        "SELECT score, count_cum, count_this, rank_min, rank_max FROM rank_tables WHERE province=? AND year=? AND category='综合' AND score=?",
        (province, year, score)
    )
    row = cur2.fetchone()
    if row:
        conn2.close()
        return {"score": row[0], "rank": row[1], "count_this": row[2], "rank_min": row[3], "rank_max": row[4]}
    # fallback: 取 ≤ 该分数的最近一档
    cur2.execute(
        "SELECT score, count_cum FROM rank_tables WHERE province=? AND year=? AND category='综合' AND score<=? ORDER BY score DESC LIMIT 1",
        (province, year, score)
    )
    row = cur2.fetchone()
    conn2.close()
    if row:
        return {"score": score, "rank": row[1], "closest_score": row[0], "note": "fallback"}
    return {"error": "not found"}


def rank_lookup_with_category(province: str, year: int, score: int, category: str, db_path: str) -> dict:
    conn2 = sqlite3.connect(db_path)
    cur2 = conn2.cursor()
    cur2.execute(
        "SELECT score, count_cum, count_this, rank_min, rank_max FROM rank_tables WHERE province=? AND year=? AND category=? AND score=?",
        (province, year, category, score)
    )
    row = cur2.fetchone()
    if row:
        conn2.close()
        return {"score": row[0], "rank": row[1], "count_this": row[2], "rank_min": row[3], "rank_max": row[4]}
    # fallback
    cur2.execute(
        "SELECT score, count_cum FROM rank_tables WHERE province=? AND year=? AND category=? AND score<=? ORDER BY score DESC LIMIT 1",
        (province, year, category, score)
    )
    row = cur2.fetchone()
    conn2.close()
    if row:
        return {"score": score, "rank": row[1], "closest_score": row[0], "note": "fallback"}
    return {"error": "not found"}


print("\n" + "=" * 70)
print("【分数→位次 转化测试】")
print("=" * 70)

test_cases = [
    # (省份, category, 分数, 期望位次)
    ("北京", "综合", 600, 11883),
    ("北京", "综合", 650, 3203),
    ("北京", "综合", 430, 53994),
    ("天津", "综合", 476, 47173),
    ("上海", "综合", 500, None),
    ("重庆", "物理类", 500, None),
    ("重庆", "历史类", 500, None),
    ("河北", "物理类", 500, None),
    ("河北", "历史类", 500, None),
    ("河南", "物理类", 600, 45887),
    ("河南", "历史类", 600, None),
    ("山东", "综合", 441, 333469),
    ("江苏", "物理类", 600, 34888),
    ("江苏", "历史类", 600, 5796),
    ("浙江", "综合", 600, None),
    ("安徽", "物理类", 600, None),
    ("安徽", "历史类", 600, None),
    ("福建", "物理类", 600, None),
    ("江西", "物理类", 600, None),
    ("湖北", "物理类", 600, None),
    ("湖南", "物理类", 600, None),
    ("广东", "物理类", 600, None),
    ("广西", "物理类", 600, None),
    ("海南", "综合", 600, None),
    ("四川", "物理类", 600, None),
    ("贵州", "物理类", 600, None),
    ("云南", "物理类", 600, None),
    ("陕西", "物理类", 600, None),
    ("甘肃", "物理类", 600, None),
    ("青海", "物理类", 600, None),
    ("宁夏", "物理类", 600, None),
    ("内蒙古", "物理类", 600, None),
    ("黑龙江", "物理类", 600, None),
    ("辽宁", "物理类", 600, None),
    ("吉林", "物理类", 600, None),
    ("新疆", "理科", 500, None),
    ("新疆", "文科", 500, None),
]

passed = 0
failed = 0
for prov, cat, score, expected in test_cases:
    if cat == "综合":
        result = rank_lookup(prov, 2025, score, TEST_DB)
    else:
        result = rank_lookup_with_category(prov, 2025, score, cat, TEST_DB)

    if "error" in result:
        print(f"  ❌ {prov}/{cat}/{score}: {result['error']}")
        failed += 1
        continue

    rank = result["rank"]
    if expected is not None:
        if abs(rank - expected) > max(50, expected * 0.01):
            print(f"  ❌ {prov}/{cat}/{score}: rank={rank}, expected={expected}, diff={rank-expected}")
            failed += 1
        else:
            print(f"  ✅ {prov}/{cat}/{score}: rank={rank} (expected={expected})")
            passed += 1
    else:
        print(f"  ✅ {prov}/{cat}/{score}: rank={rank}")
        passed += 1

print(f"\n测试完成: 通过 {passed}, 失败 {failed}")
conn.close()

# 清理测试库
os.remove(TEST_DB)
print(f"已清理测试库: {TEST_DB}")
