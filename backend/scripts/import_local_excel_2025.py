"""
从本地 E:\高考程序素材\05、【琢玉攻略】高考数据 批量导入 2025 一分一段表
所有省份格式统一：年份/科类/批次/控制线/分数/本段人数/累计人数/排名区间/历史同位次
"""
import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.stdout.reconfigure(encoding="utf-8")

import pandas as pd
from database import SessionLocal, RankTable, init_db

BASE = "E:/高考程序素材/05、【琢玉攻略】高考数据"

# 省份编号映射（用于找目录）
PROVINCE_DIRS = [
    ("河南", "01、河南-2026志愿填报资料【永久更新】"),
    ("湖南", "02、湖南-2026志愿填报资料【永久更新】"),
    ("重庆", "03、重庆-2026志愿填报资料【永久更新】"),
    ("江苏", "04、江苏-2026志愿填报资料【永久更新】"),
    ("上海", "05、上海-2026志愿填报资料【永久更新】"),
    ("辽宁", "06、辽宁-2026志愿填报资料【永久更新】"),
    ("内蒙古", "07、内蒙古-2026志愿填报资料【永久更新】"),
    ("广东", "08、广东-2026志愿填报资料【永久更新】"),
    ("浙江", "09、浙江-2026志愿填报资料【永久更新】"),
    ("安徽", "10、安徽-2026志愿填报资料【永久更新】"),
    ("江西", "11、江西-2026志愿填报资料包【永久更新】"),
    ("福建", "12、福建-2026志愿填报资料【永久更新】"),
    ("河北", "13、河北-2026志愿填报资料【永久更新】"),
    ("山东", "14、山东-2026志愿填报资料【永久更新】"),
    ("天津", "15、天津-2026志愿填报资料【永久更新】"),
    ("湖北", "16、湖北-2026志愿填报资料【永久更新】"),
    ("吉林", "17、吉林-2026志愿填报资料【永久更新】"),
    ("北京", "18、北京-2026志愿填报资料【永久更新】"),
    ("广西", "19、广西-2026志愿填报资料【永久更新】"),
    ("贵州", "20、贵州-2026志愿填报资料【永久更新】"),
    ("云南", "21、云南-2026志愿填报资料【永久更新】"),
    ("海南", "22、海南-2026志愿填报资料【永久更新】"),
    ("四川", "23、四川-2026志愿填报资料【永久更新】"),
    ("黑龙江", "24、黑龙江-2026志愿填报资料【永久更新】"),
    ("陕西", "25、陕西-2026志愿填报资料【永久更新】"),
    ("山西", "26、山西-2026志愿填报资料【永久更新】"),
    ("甘肃", "27、甘肃-2026志愿填报资料【永久更新】"),
    ("青海", "28、青海-2026志愿填报资料【永久更新】"),
    ("新疆", "29、新疆-2026志愿填报资料【永久更新】"),
    ("宁夏", "30、宁夏-2026志愿填报资料【永久更新】"),
    ("西藏", "31、西藏-2026志愿填报资料【永久更新】"),
]


def find_excel(province: str, dir_name: str) -> str | None:
    """找该省份的 2025 一分一段表 xlsx"""
    prov_path = os.path.join(BASE, dir_name)
    if not os.path.exists(prov_path):
        return None
    # 找 "2、XX录取数据22-25【持续更新】" 或类似
    subdirs = [d for d in os.listdir(prov_path) if os.path.isdir(os.path.join(prov_path, d)) and "22-25" in d]
    if not subdirs:
        subdirs = [d for d in os.listdir(prov_path) if os.path.isdir(os.path.join(prov_path, d)) and ("数据" in d or "录取" in d)]
    for sub in subdirs:
        subpath = os.path.join(prov_path, sub)
        # 找 "一分一段" 子目录
        yfd_dirs = [d for d in os.listdir(subpath) if os.path.isdir(os.path.join(subpath, d)) and "一分一段" in d]
        for yfd in yfd_dirs:
            yfd_path = os.path.join(subpath, yfd)
            files = [f for f in os.listdir(yfd_path) if f.endswith(".xlsx") and "2025" in f]
            if files:
                return os.path.join(yfd_path, files[0])
    return None


def upsert_rows(db, rows, province: str, year: int):
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


def import_province(db, province: str, path: str):
    df = pd.read_excel(path, engine="openpyxl")
    # 标准化列名（去除空格）
    df.columns = [str(c).strip() for c in df.columns]
    # 找到关键列
    col_map = {}
    for c in df.columns:
        if "分数" in c and "分" in c:
            col_map["score"] = c
        elif "本段人数" in c or "同分人数" in c:
            col_map["count_this"] = c
        elif "累计人数" in c or "累计" in c:
            col_map["count_cum"] = c
        elif "科类" in c:
            col_map["category"] = c
        elif "批次" in c:
            col_map["batch"] = c

    if "score" not in col_map or "count_cum" not in col_map:
        print(f"  ⚠ 列识别失败: {df.columns.tolist()}")
        return 0

    rows = []
    for _, row in df.iterrows():
        try:
            score = int(float(row[col_map["score"]]))
            count_cum = int(float(row[col_map["count_cum"]]))
            count_this = int(float(row.get(col_map.get("count_this"), 0))) if "count_this" in col_map else 0
            category = str(row.get(col_map.get("category"), "综合")).strip()
            batch = str(row.get(col_map.get("batch"), "本科批")).strip()
        except Exception:
            continue
        if count_cum <= 0:
            continue
        rows.append({"score": score, "count_this": count_this, "count_cum": count_cum, "category": category, "batch": batch})

    n = upsert_rows(db, rows, province, 2025)
    cats = set(r["category"] for r in rows)
    print(f"  ✅ 解析 {len(rows)} 行，写入 {n} 行，科类: {cats}")
    return n


def main():
    init_db()
    db = SessionLocal()
    total = 0
    found = 0
    missing = []
    for prov, dirname in PROVINCE_DIRS:
        path = find_excel(prov, dirname)
        print(f"\n▶ {prov} …")
        if not path:
            print("  ⚠ 未找到文件")
            missing.append(prov)
            continue
        found += 1
        try:
            n = import_province(db, prov, path)
            total += n
        except Exception as e:
            print(f"  ❌ 导入失败: {e}")
            missing.append(prov)
    db.close()

    print(f"\n{'='*60}")
    print(f"找到文件: {found}/{len(PROVINCE_DIRS)} 个省份")
    print(f"总写入: {total} 条")
    if missing:
        print(f"缺失/失败: {', '.join(missing)}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
