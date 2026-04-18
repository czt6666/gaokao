"""
2024年 一分一段表 批量导入脚本
支持：
  - 山东（XLS，多选科列）
  - 广东（PDF，物理类/历史类双文件）
  - 陕西（PDF，物理/历史混合）
  - 黑龙江（PDF，物理/历史混合）
  - 甘肃（PDF，双列并排）
  - 青海（PDF）
  - 江西（PDF，物理/历史双文件）

用法：python3 scripts/import_rank_tables_2024.py [--province 广东]
"""
import sys, os, re, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from database import SessionLocal, RankTable, init_db

DATA_DIR = "/Users/Admin/Desktop/高考程序素材/00、志愿填报必备资料/7、全国各省市批次线/2024年一分一段表"


def upsert_rows(db, rows: list, province: str, year: int) -> int:
    """去重写入，返回新增数量"""
    inserted = 0
    for r in rows:
        exists = db.query(RankTable).filter(
            RankTable.province == province,
            RankTable.year == year,
            RankTable.score == r["score"],
            RankTable.category == r["category"],
        ).first()
        if exists:
            continue
        db.add(RankTable(
            province=province, year=year,
            category=r["category"],
            batch=r.get("batch", "本科批"),
            score=r["score"],
            count_this=r.get("count_this", 0),
            count_cum=r["count_cum"],
            rank_min=r["count_cum"] - r.get("count_this", 0) + 1,
            rank_max=r["count_cum"],
        ))
        inserted += 1
    db.commit()
    return inserted


def parse_score(s) -> int | None:
    """解析分数字段，处理'700以上'等格式"""
    if s is None: return None
    s = str(s).strip()
    s = re.sub(r"(以上|及以上|（含以上）|含以上).*", "", s)
    s = re.sub(r"[^\d]", "", s.split("-")[0].split("~")[0])
    try: return int(s) if s else None
    except: return None


# ── 山东 XLS ──────────────────────────────────────────────────
def import_shandong(db) -> int:
    import xlrd
    path = os.path.join(DATA_DIR, "2024山东一分一段表.xls")
    if not os.path.exists(path):
        print(f"  ⚠ 文件不存在: {path}"); return 0

    wb = xlrd.open_workbook(path)
    ws = wb.sheet_by_index(0)

    # 列映射：col_start → category
    CAT_COLS = {
        1: "综合",    # 全体
        3: "物理",    # 选考物理
        5: "化学",    # 选考化学
        7: "生物",    # 选考生物
        9: "政治",    # 思政
        11: "历史",   # 历史
        13: "地理",   # 地理
    }
    rows = []
    for i in range(3, ws.nrows):  # 跳过3行表头
        row = ws.row_values(i)
        score = parse_score(row[0])
        if not score: continue
        for col, cat in CAT_COLS.items():
            try:
                count_this = int(float(row[col])) if row[col] != "" else 0
                count_cum  = int(float(row[col+1])) if row[col+1] != "" else 0
            except: continue
            if count_cum <= 0: continue
            rows.append({"score": score, "category": cat, "count_this": count_this, "count_cum": count_cum})

    n = upsert_rows(db, rows, "山东", 2024)
    print(f"  山东2024：{n}/{len(rows)} 条写入")
    return n


# ── 广东 PDF ──────────────────────────────────────────────────
def import_guangdong(db) -> int:
    try: import pdfplumber
    except ImportError: print("  ⚠ pdfplumber未安装：pip install pdfplumber"); return 0

    total = 0
    for cat, fname in [("物理类", "2024广东物理类一分一段.pdf"), ("历史类", "2024广东历史类一分一段.pdf")]:
        path = os.path.join(DATA_DIR, fname)
        if not os.path.exists(path): print(f"  ⚠ 文件不存在: {fname}"); continue
        rows = []
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables()
                for table in tables:
                    for row in table:
                        if not row: continue
                        score = parse_score(row[0])
                        if not score: continue
                        # 格式：文化总分 / 本科本段 / 本科累计 / 专科本段 / 专科累计
                        try:
                            bk_this = int(re.sub(r"[^\d]", "", str(row[1])) or 0) if len(row) > 1 else 0
                            bk_cum  = int(re.sub(r"[^\d]", "", str(row[2])) or 0) if len(row) > 2 else 0
                        except: continue
                        if bk_cum <= 0: continue
                        rows.append({"score": score, "category": cat, "batch": "本科批",
                                     "count_this": bk_this, "count_cum": bk_cum})
        n = upsert_rows(db, rows, "广东", 2024)
        print(f"  广东2024 {cat}：{n}/{len(rows)} 条写入")
        total += n
    return total


# ── 江西 PDF ──────────────────────────────────────────────────
def import_jiangxi(db) -> int:
    try: import pdfplumber
    except ImportError: return 0
    total = 0
    for cat, fname in [("物理类", "2024江西物理类一分一段表.pdf"), ("历史类", "2024江西历史类一分一段表.pdf")]:
        path = os.path.join(DATA_DIR, fname)
        if not os.path.exists(path): print(f"  ⚠ 文件不存在: {fname}"); continue
        rows = []
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                for table in (page.extract_tables() or []):
                    for row in table:
                        score = parse_score(row[0] if row else None)
                        if not score: continue
                        try:
                            cnt  = int(re.sub(r"[^\d]","",str(row[1])) or 0)
                            cum  = int(re.sub(r"[^\d]","",str(row[2])) or 0)
                        except: continue
                        if cum <= 0: continue
                        rows.append({"score": score, "category": cat, "count_this": cnt, "count_cum": cum})
        n = upsert_rows(db, rows, "江西", 2024)
        print(f"  江西2024 {cat}：{n}/{len(rows)} 条写入")
        total += n
    return total


# ── 陕西 PDF ──────────────────────────────────────────────────
def import_shaanxi(db) -> int:
    try: import pdfplumber
    except ImportError: return 0
    path = os.path.join(DATA_DIR, "2024陕西一分一段表.pdf")
    if not os.path.exists(path): print("  ⚠ 陕西文件不存在"); return 0
    rows = []
    current_cat = "物理类"
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if "文史" in text or "历史" in text: current_cat = "历史类"
            elif "理工" in text or "物理" in text: current_cat = "物理类"
            for table in (page.extract_tables() or []):
                for row in table:
                    score = parse_score(row[0] if row else None)
                    if not score: continue
                    try:
                        cnt = int(re.sub(r"[^\d]","",str(row[1])) or 0)
                        cum = int(re.sub(r"[^\d]","",str(row[2])) or 0)
                    except: continue
                    if cum <= 0: continue
                    rows.append({"score": score, "category": current_cat, "count_this": cnt, "count_cum": cum})
    n = upsert_rows(db, rows, "陕西", 2024)
    print(f"  陕西2024：{n}/{len(rows)} 条写入")
    return n


# ── 黑龙江 PDF ────────────────────────────────────────────────
def import_heilongjiang(db) -> int:
    try: import pdfplumber
    except ImportError: return 0
    path = os.path.join(DATA_DIR, "2024黑龙江一分一段表.pdf")
    if not os.path.exists(path): print("  ⚠ 黑龙江文件不存在"); return 0
    rows = []
    current_cat = "物理类"
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if "历史类" in text: current_cat = "历史类"
            elif "物理类" in text: current_cat = "物理类"
            for table in (page.extract_tables() or []):
                for row in table:
                    score = parse_score(row[0] if row else None)
                    if not score: continue
                    try:
                        cnt = int(re.sub(r"[^\d]","",str(row[1])) or 0)
                        cum = int(re.sub(r"[^\d]","",str(row[2])) or 0)
                    except: continue
                    if cum <= 0: continue
                    rows.append({"score": score, "category": current_cat, "count_this": cnt, "count_cum": cum})
    n = upsert_rows(db, rows, "黑龙江", 2024)
    print(f"  黑龙江2024：{n}/{len(rows)} 条写入")
    return n


# ── 甘肃 PDF ──────────────────────────────────────────────────
def import_gansu(db) -> int:
    try: import pdfplumber
    except ImportError: return 0
    path = os.path.join(DATA_DIR, "2024甘肃一分一段表.pdf")
    if not os.path.exists(path): print("  ⚠ 甘肃文件不存在"); return 0
    rows = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in (page.extract_tables() or []):
                for row in table:
                    if not row or len(row) < 6: continue
                    # 格式：序号/分数/累计（物理） | 序号/分数/累计（历史）
                    for offset, cat in [(1, "物理类"), (4, "历史类")]:
                        score = parse_score(row[offset] if len(row) > offset else None)
                        if not score: continue
                        try:
                            cum = int(re.sub(r"[^\d]","",str(row[offset+1])) or 0)
                        except: continue
                        if cum <= 0: continue
                        rows.append({"score": score, "category": cat, "count_this": 0, "count_cum": cum})
    n = upsert_rows(db, rows, "甘肃", 2024)
    print(f"  甘肃2024：{n}/{len(rows)} 条写入")
    return n


# ── 青海 PDF ──────────────────────────────────────────────────
def import_qinghai(db) -> int:
    try: import pdfplumber
    except ImportError: return 0
    path = os.path.join(DATA_DIR, "2024青海一分一段表.pdf")
    if not os.path.exists(path): print("  ⚠ 青海文件不存在"); return 0
    rows = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in (page.extract_tables() or []):
                for row in table:
                    if not row or len(row) < 5: continue
                    # 格式：科类名称 / 投档分类型 / 总分 / 人数 / 累计数
                    raw_cat = str(row[0] or "").strip()
                    cat = "物理类" if "物理" in raw_cat or "理工" in raw_cat else \
                          "历史类" if "历史" in raw_cat or "文史" in raw_cat else raw_cat
                    score = parse_score(row[2])
                    if not score: continue
                    try:
                        cnt = int(re.sub(r"[^\d]","",str(row[3])) or 0)
                        cum = int(re.sub(r"[^\d]","",str(row[4])) or 0)
                    except: continue
                    if cum <= 0: continue
                    rows.append({"score": score, "category": cat, "count_this": cnt, "count_cum": cum})
    n = upsert_rows(db, rows, "青海", 2024)
    print(f"  青海2024：{n}/{len(rows)} 条写入")
    return n


# ── 主函数 ────────────────────────────────────────────────────
IMPORTERS = {
    "山东": import_shandong,
    "广东": import_guangdong,
    "江西": import_jiangxi,
    "陕西": import_shaanxi,
    "黑龙江": import_heilongjiang,
    "甘肃": import_gansu,
    "青海": import_qinghai,
}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--province", default="all", help="省份名称，或 all")
    args = parser.parse_args()

    init_db()
    db = SessionLocal()
    total = 0

    targets = list(IMPORTERS.keys()) if args.province == "all" else [args.province]
    print(f"导入省份：{targets}")

    for prov in targets:
        if prov not in IMPORTERS:
            print(f"⚠ 不支持：{prov}")
            continue
        print(f"\n▶ {prov}...")
        try:
            n = IMPORTERS[prov](db)
            total += n
        except Exception as e:
            print(f"  ❌ 导入失败: {e}")

    db.close()
    print(f"\n✅ 总计写入：{total} 条")
