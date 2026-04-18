"""
高效 CDN 数据爬虫 v2
利用静态 CDN 端点（无需 Playwright / 浏览器）
端点：数据CDN /school/{school_id}/provincescore/{province_id}.json
数据：2021-2025 年各省最低分/最低位次（物理/历史分科）

用法：
  python3 scrapers/cdn_scraper.py --province 广东 --test
  python3 scrapers/cdn_scraper.py --province 广东,河南,山东,江苏,浙江
"""

import asyncio, sys, os, argparse, ssl, json
from typing import List, Dict

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from database import SessionLocal, AdmissionRecord, School, init_db

PROVINCE_IDS = {
    "北京": 11, "天津": 12, "河北": 13, "山西": 14, "内蒙古": 15,
    "辽宁": 21, "吉林": 22, "黑龙江": 23,
    "上海": 31, "江苏": 32, "浙江": 33, "安徽": 34, "福建": 35,
    "江西": 36, "山东": 37,
    "河南": 41, "湖北": 42, "湖南": 43, "广东": 44, "广西": 45, "海南": 46,
    "重庆": 50, "四川": 51, "贵州": 52, "云南": 53,
    "陕西": 61, "甘肃": 62, "青海": 63, "宁夏": 64, "新疆": 65,
}

BASE_CDN = "https://static-data.gaokao.cn/www/2.0"

def log(msg): print(f"  [CDN] {msg}")


def make_ssl_context():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


async def fetch_json(session, url: str) -> dict:
    """SSL-tolerant async JSON fetch"""
    import aiohttp
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status == 200:
                return await resp.json(content_type=None)
    except Exception:
        pass
    return {}


async def get_school_list(session) -> List[Dict]:
    """获取全国学校 ID 列表"""
    data = await fetch_json(session, f"{BASE_CDN}/school/school_code.json?a=www.gaokao.cn")
    schools = []
    items = data.get("data", {})
    if isinstance(items, dict):
        for _, v in items.items():
            if isinstance(v, dict):
                sid = v.get("school_id") or v.get("id")
                name = v.get("name") or v.get("school_name", "")
                if sid and name:
                    schools.append({"id": int(sid), "name": name})
    log(f"共 {len(schools)} 所学校")
    return schools


async def fetch_school_province_scores(
    session, school_id: int, school_name: str, province_id: int, province: str
) -> List[Dict]:
    """
    拉取某校在某省所有年份的最低分/位次数据
    返回: [{year, min_score, min_rank, subject_type, batch_name}]
    """
    url = f"{BASE_CDN}/school/{school_id}/provincescore/{province_id}.json"
    data = await fetch_json(session, url)
    if not data or "data" not in data:
        return []

    year_data = data["data"]  # {"2024": {"2073": [{...}], "2074": [{...}]}, ...}
    if not isinstance(year_data, dict):
        return []

    records = []
    for year_str, type_dict in year_data.items():
        try:
            year = int(year_str)
        except ValueError:
            continue
        if not isinstance(type_dict, dict):
            continue

        for type_id, entries in type_dict.items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                min_score = int(entry.get("min", 0) or 0)
                min_rank = int(entry.get("min_section", 0) or 0)
                type_name = entry.get("type_name", "")   # 物理类 / 历史类 / 理科 / 文科
                batch_name = entry.get("batch_name", "本科批")

                if min_score <= 0 and min_rank <= 0:
                    continue

                # 用"院校最低分"作为专业名（省级汇总数据无专业细分）
                records.append({
                    "school_name": school_name,
                    "major_name": f"[{batch_name}]院校最低分",
                    "province": province,
                    "year": year,
                    "min_score": min_score,
                    "min_rank": min_rank,
                    "batch": batch_name,
                    "subject_req": type_name,
                })

    return records


def save_records(records: List[Dict], province: str, school_cache: Dict[str, School]) -> int:
    """批量写入数据库，跳过已存在的记录"""
    if not records:
        return 0

    db = SessionLocal()
    inserted = 0
    try:
        for rec in records:
            exists = db.query(AdmissionRecord).filter(
                AdmissionRecord.school_name == rec["school_name"],
                AdmissionRecord.major_name == rec["major_name"],
                AdmissionRecord.province == province,
                AdmissionRecord.year == rec["year"],
                AdmissionRecord.subject_req == rec["subject_req"],
            ).first()
            if exists:
                continue

            school_info = school_cache.get(rec["school_name"])
            ar = AdmissionRecord(
                school_name=rec["school_name"],
                school_code="",
                major_name=rec["major_name"],
                province=province,
                year=rec["year"],
                min_score=rec.get("min_score", 0),
                min_rank=rec.get("min_rank", 0),
                admit_count=0,
                batch=rec.get("batch", "本科批"),
                subject_req=rec.get("subject_req", ""),
                school_province=school_info.province if school_info else "",
                school_nature=school_info.nature if school_info else "",
                is_985=school_info.is_985 if school_info else "否",
                is_211=school_info.is_211 if school_info else "否",
            )
            db.add(ar)
            inserted += 1

        db.commit()
    except Exception as e:
        log(f"DB 写入失败: {e}")
        db.rollback()
    finally:
        db.close()

    return inserted


async def run(provinces: List[str], test_mode: bool = False):
    import aiohttp

    init_db()

    # 预加载学校信息缓存
    db = SessionLocal()
    schools_db = db.query(School).all()
    school_cache = {s.name: s for s in schools_db}
    db.close()

    ssl_ctx = make_ssl_context()
    connector = aiohttp.TCPConnector(ssl=ssl_ctx, limit=20)

    async with aiohttp.ClientSession(connector=connector) as session:
        # 获取学校 ID 列表
        schools = await get_school_list(session)
        if test_mode:
            # 测试时只取 985 学校（前30所）
            schools_985 = [s for s in schools if s["name"] in school_cache and school_cache[s["name"]].is_985 == "是"]
            schools = schools_985[:30]
            log(f"测试模式: {len(schools)} 所 985 学校")

        total_inserted = 0

        for province in provinces:
            if province not in PROVINCE_IDS:
                log(f"未知省份: {province}，跳过")
                continue

            province_id = PROVINCE_IDS[province]
            log(f"\n========== {province} (province_id={province_id}) ==========")

            prov_inserted = 0
            errors = 0

            for i, school in enumerate(schools):
                try:
                    records = await fetch_school_province_scores(
                        session, school["id"], school["name"], province_id, province
                    )
                    if records:
                        n = save_records(records, province, school_cache)
                        prov_inserted += n
                        if n > 0:
                            log(f"  [{i+1}/{len(schools)}] {school['name']}: +{n} 条")
                except Exception as e:
                    errors += 1

                # Micro-delay to be respectful to CDN
                await asyncio.sleep(0.1)

                # Progress every 100 schools
                if (i + 1) % 100 == 0:
                    log(f"  进度: {i+1}/{len(schools)}, 已插入 {prov_inserted} 条")

            log(f"  {province} 完成: 插入 {prov_inserted} 条, 错误 {errors} 所")
            total_inserted += prov_inserted

    print(f"\n✅ 完成！总插入 {total_inserted} 条录取记录")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--province", default="广东", help="省份（逗号分隔，如：广东,河南,山东）")
    parser.add_argument("--test", action="store_true", help="测试模式（仅 985 学校前30所）")
    args = parser.parse_args()

    provinces = [p.strip() for p in args.province.split(",")]
    asyncio.run(run(provinces, args.test))
