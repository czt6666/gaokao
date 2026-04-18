"""
省份录取数据爬虫
数据来源：录取数据接口（公开接口，带延迟）

用法：
  python3 scrapers/province_scraper.py --province 广东 --years 2022,2023,2024
  python3 scrapers/province_scraper.py --list-provinces

支持省份：所有新高考/旧高考省份
数据写入：admission_records 表（自动去重）
"""

import time, re, sys, os, argparse, json
import requests
from typing import List, Dict, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from database import SessionLocal, AdmissionRecord, School, init_db

# ── 省份配置 ────────────────────────────────────────────────────
PROVINCE_CONFIG = {
    "广东": {"id": "44", "gaokao_type": "new", "category": "物理类,历史类"},
    "浙江": {"id": "33", "gaokao_type": "new", "category": "综合"},
    "江苏": {"id": "32", "gaokao_type": "new", "category": "物理类,历史类"},
    "山东": {"id": "37", "gaokao_type": "new", "category": "综合"},
    "湖北": {"id": "42", "gaokao_type": "new", "category": "物理类,历史类"},
    "湖南": {"id": "43", "gaokao_type": "new", "category": "物理类,历史类"},
    "四川": {"id": "51", "gaokao_type": "old", "category": "理科,文科"},
    "陕西": {"id": "61", "gaokao_type": "old", "category": "理科,文科"},
    "河南": {"id": "41", "gaokao_type": "old", "category": "理科,文科"},
    "安徽": {"id": "34", "gaokao_type": "new", "category": "物理类,历史类"},
    "福建": {"id": "35", "gaokao_type": "new", "category": "物理类,历史类"},
    "辽宁": {"id": "21", "gaokao_type": "new", "category": "物理类,历史类"},
    "北京": {"id": "11", "gaokao_type": "new", "category": "综合"},
    "上海": {"id": "31", "gaokao_type": "new", "category": "综合"},
    "重庆": {"id": "50", "gaokao_type": "new", "category": "物理类,历史类"},
}

# ── 录取数据接口 ────────────────────────────────────────────────
ZSKG_BASE = "https://api.zjzwy.com/api/admission"

# 备选：官方数据源 headers
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/121.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://www.gaokao.cn/",
}

# 每次请求的延迟（秒）- 遵守服务器限速
REQUEST_DELAY = 2.0


def log(msg): print(f"  [爬虫] {msg}")


def fetch_with_retry(url: str, params: dict = None, max_retries: int = 3) -> Optional[dict]:
    """带重试的 HTTP 请求"""
    for attempt in range(max_retries):
        try:
            time.sleep(REQUEST_DELAY)
            resp = requests.get(url, params=params, headers=HEADERS, timeout=15)
            if resp.status_code == 200:
                return resp.json()
            elif resp.status_code == 429:
                log(f"触发限速，等待 {REQUEST_DELAY * 3}s...")
                time.sleep(REQUEST_DELAY * 3)
            else:
                log(f"HTTP {resp.status_code}，重试 {attempt+1}/{max_retries}")
        except requests.RequestException as e:
            log(f"请求异常: {e}，重试 {attempt+1}/{max_retries}")
            time.sleep(REQUEST_DELAY * 2)
    return None


# ── 录取数据解析 ─────────────────────────────────────────────
def parse_zskg_school(data: dict, province: str, year: int) -> List[Dict]:
    """
    解析学校录取数据
    格式示例:
    {
      "school_name": "清华大学",
      "school_code": "10003",
      "majors": [
        {"major_name": "计算机科学与技术", "min_score": 690, "min_rank": 150, "plan_count": 5},
        ...
      ]
    }
    """
    records = []
    school_name = data.get("school_name", "").strip()
    school_code = str(data.get("school_code", "")).strip()

    for major in data.get("majors", []):
        major_name = major.get("major_name", "").strip()
        if not major_name:
            continue

        min_score = int(float(major.get("min_score", 0) or 0))
        min_rank  = int(float(major.get("min_rank", 0) or 0))
        plan_count = int(float(major.get("plan_count", 0) or 0))

        if min_rank <= 0 and min_score <= 0:
            continue

        records.append({
            "school_name": school_name,
            "school_code": school_code,
            "major_name": major_name,
            "province": province,
            "year": year,
            "min_score": min_score,
            "min_rank": min_rank,
            "admit_count": plan_count,
            "batch": major.get("batch", "本科批"),
            "subject_req": major.get("subject_req", ""),
            "major_group": major.get("major_group", ""),
        })
    return records


def upsert_records(db, records: List[Dict], province: str, year: int) -> int:
    """写入录取记录（跳过已存在的）"""
    inserted = 0
    for rec in records:
        # 检查是否已存在
        exists = db.query(AdmissionRecord).filter(
            AdmissionRecord.school_name == rec["school_name"],
            AdmissionRecord.major_name  == rec["major_name"],
            AdmissionRecord.province    == province,
            AdmissionRecord.year        == year,
        ).first()
        if exists:
            continue

        # 查学校附加信息
        school_info = db.query(School).filter(School.name == rec["school_name"]).first()

        ar = AdmissionRecord(
            school_code   = rec["school_code"],
            school_name   = rec["school_name"],
            major_name    = rec["major_name"],
            major_group   = rec.get("major_group", ""),
            province      = province,
            year          = year,
            batch         = rec.get("batch", "本科批"),
            subject_req   = rec.get("subject_req", ""),
            min_score     = rec.get("min_score", 0),
            min_rank      = rec.get("min_rank", 0),
            admit_count   = rec.get("admit_count", 0),
            school_province = school_info.province if school_info else "",
            school_nature   = school_info.nature   if school_info else "",
            is_985          = school_info.is_985    if school_info else "否",
            is_211          = school_info.is_211    if school_info else "否",
        )
        db.add(ar)
        inserted += 1

    db.commit()
    return inserted


# ── 主爬虫函数 ────────────────────────────────────────────────
def scrape_province_admission(
    province: str,
    years: List[int],
    max_schools: int = 500
) -> int:
    """
    爬取指定省份的录取数据

    注意：如接口不可用，会自动降级到 CSV 导入模式（见 import_from_csv）。
    """
    if province not in PROVINCE_CONFIG:
        print(f"❌ 未配置省份: {province}")
        print(f"   已支持: {', '.join(PROVINCE_CONFIG.keys())}")
        return 0

    prov_conf = PROVINCE_CONFIG[province]
    province_id = prov_conf["id"]

    init_db()
    db = SessionLocal()
    total_inserted = 0

    try:
        for year in years:
            log(f"开始爬取 {province} {year}年 录取数据...")
            inserted_year = 0

            # 录取数据接口（实际接口需根据数据源调整）
            # 这里提供框架，实际 URL 需要通过浏览器抓包获得
            base_url = f"https://static-data.gaokao.cn/www/2.0/schoolspecialindex/{year}/{province_id}/1/10/0/1.json"

            data = fetch_with_retry(base_url)
            if not data:
                log(f"⚠️  接口无响应，跳过 {province} {year}年")
                log(f"   建议手动下载 CSV 后使用 import_from_csv() 导入")
                continue

            # 解析分页数据
            total_pages = data.get("data", {}).get("numFound", 0) // 10 + 1
            log(f"  共 {total_pages} 页数据")

            for page in range(1, min(total_pages + 1, max_schools // 10 + 1)):
                url = f"https://static-data.gaokao.cn/www/2.0/schoolspecialindex/{year}/{province_id}/1/10/0/{page}.json"
                page_data = fetch_with_retry(url)
                if not page_data:
                    break

                schools = page_data.get("data", {}).get("item", [])
                for school in schools:
                    records = parse_zskg_school(school, province, year)
                    n = upsert_records(db, records, province, year)
                    inserted_year += n

                if page % 10 == 0:
                    log(f"  已处理 {page}/{total_pages} 页，已插入 {inserted_year} 条")

            log(f"✅ {province} {year}年：插入 {inserted_year} 条")
            total_inserted += inserted_year

    finally:
        db.close()

    return total_inserted


def import_from_csv(csv_path: str, province: str, year: int) -> int:
    """
    从手动导出的 CSV 文件导入录取数据（备用方案）

    CSV 格式（必须包含列）：
    学校名称, 专业名称, 最低分, 最低位次, 录取人数, 批次, 选科要求
    """
    import csv

    if not os.path.exists(csv_path):
        print(f"❌ 文件不存在: {csv_path}")
        return 0

    init_db()
    db = SessionLocal()
    records = []

    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            records.append({
                "school_name": row.get("学校名称", "").strip(),
                "school_code": row.get("院校代码", "").strip(),
                "major_name":  row.get("专业名称", "").strip(),
                "min_score":   int(float(row.get("最低分", 0) or 0)),
                "min_rank":    int(float(row.get("最低位次", 0) or 0)),
                "admit_count": int(float(row.get("录取人数", 0) or 0)),
                "batch":       row.get("批次", "本科批").strip(),
                "subject_req": row.get("选科要求", "").strip(),
                "major_group": row.get("专业组", "").strip(),
            })

    inserted = upsert_records(db, records, province, year)
    db.close()
    log(f"CSV 导入完成：{inserted}/{len(records)} 条写入成功")
    return inserted


# ── 精确学校录取分数抓取（备用接口）────────────────────────────
def scrape_via_zskg_search(school_name: str, province: str, year: int) -> List[Dict]:
    """
    搜索特定学校的录取数据
    （适合补充特定学校数据）
    """
    search_url = "https://api.zjzwy.com/api/search/school"
    params = {
        "keyword": school_name,
        "province_id": PROVINCE_CONFIG.get(province, {}).get("id", ""),
        "year": year,
    }
    data = fetch_with_retry(search_url, params)
    if not data:
        return []
    return parse_zskg_school(data.get("data", {}), province, year)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="高考录取数据爬虫")
    parser.add_argument("--province", type=str, help="省份名称，如：广东")
    parser.add_argument("--years", type=str, default="2022,2023,2024", help="年份，逗号分隔")
    parser.add_argument("--max-schools", type=int, default=500, help="最多爬取学校数量")
    parser.add_argument("--list-provinces", action="store_true", help="列出已配置的省份")
    parser.add_argument("--csv", type=str, help="从 CSV 文件导入（备用方案）")
    args = parser.parse_args()

    if args.list_provinces:
        print("已配置省份：")
        for prov, conf in PROVINCE_CONFIG.items():
            print(f"  {prov} (ID:{conf['id']}) - {conf['gaokao_type']}高考 - {conf['category']}")
        sys.exit(0)

    if args.csv and args.province:
        year = int(args.years.split(",")[0])
        import_from_csv(args.csv, args.province, year)
    elif args.province:
        years = [int(y.strip()) for y in args.years.split(",")]
        total = scrape_province_admission(args.province, years, args.max_schools)
        print(f"\n总计插入: {total} 条录取记录")
    else:
        parser.print_help()
