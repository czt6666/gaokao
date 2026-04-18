"""
高校就业数据采集器 v1
========================================
爬取各高校就业数据，写入 school_employment 表。

数据来源：教育部就业数据平台

用法：
  python scrapers/chsi_scraper.py --limit 100        # 爬前100所学校
  python scrapers/chsi_scraper.py --school 北京大学   # 爬单所学校
  python scrapers/chsi_scraper.py --all              # 全量（约3000所，需数小时）

依赖：
  pip install playwright httpx parsel  (playwright install chromium)

注意：每次请求间隔 2~4 秒，仅供内部使用。
"""
import sys, os, json, time, random, re, argparse, logging
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import httpx
from parsel import Selector
from database import SessionLocal, School, SchoolEmployment

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("chsi_scraper")

# ── 请求配置 ──────────────────────────────────────────────────
BASE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://gaokao.chsi.com.cn/",
}
DELAY_MIN = 2.0   # 最短请求间隔（秒）
DELAY_MAX = 4.0   # 最长请求间隔（秒）


def _sleep():
    """随机等待，避免过快请求"""
    time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))


def _extract_percent(text: str) -> float:
    """从 '95.6%' 提取 0.956"""
    m = re.search(r"(\d+\.?\d*)\s*%", text)
    return float(m.group(1)) / 100.0 if m else 0.0


def _extract_salary(text: str) -> int:
    """从 '月均薪资：6,800元' 或 '平均月薪5200元' 提取整数"""
    # 移除千分位逗号
    cleaned = text.replace(",", "").replace("，", "")
    # 查找数字（允许小数）
    m = re.search(r"(\d{3,6})\s*元", cleaned)
    return int(m.group(1)) if m else 0


# ── 搜索：学校名 → 学校详情页 ID ────────────────────────────
def search_school_id(school_name: str, client: httpx.Client) -> str | None:
    """通过学校名搜索学校就业数据ID"""
    url = "https://gaokao.chsi.com.cn/sch/search"
    params = {"searchType": "1", "searchValue": school_name, "start": "0"}
    try:
        resp = client.get(url, params=params, headers=BASE_HEADERS, timeout=15)
        sel = Selector(resp.text)
        # 解析搜索结果列表中第一条
        link = sel.css("a.search-result-school-name::attr(href)").get("")
        m = re.search(r"schId[-=](\d+)", link)
        return m.group(1) if m else None
    except Exception as e:
        log.warning(f"搜索学校ID失败 [{school_name}]: {e}")
        return None


# ── 就业数据页面解析 ─────────────────────────────────────────
def scrape_school_employment(school_id: str, school_name: str, client: httpx.Client) -> dict | None:
    """爬取就业数据页面，返回结构化数据"""
    url = f"https://gaokao.chsi.com.cn/sch/employment--schId-{school_id}.dhtml"
    try:
        resp = client.get(url, headers=BASE_HEADERS, timeout=15)
        if resp.status_code != 200:
            log.warning(f"HTTP {resp.status_code}: {url}")
            return None
        sel = Selector(resp.text)
    except Exception as e:
        log.warning(f"请求失败 [{school_name}]: {e}")
        return None

    result = {
        "school_name": school_name,
        "employment_rate": 0.0,
        "avg_salary": 0,
        "top_industries": "{}",
        "top_cities": "{}",
        "postgrad_rate": 0.0,
        "overseas_rate": 0.0,
        "top_employers": "[]",
        "postgrad_schools": "",
        "top_employer_tier": "",
        "data_source": "edu_platform",
        "report_url": url,
    }

    # 就业率
    for txt in sel.css("*::text").getall():
        if "就业率" in txt:
            pct = _extract_percent(txt)
            if pct > 0:
                result["employment_rate"] = pct
                break

    # 平均薪资
    for txt in sel.css("*::text").getall():
        if any(k in txt for k in ["月薪", "薪资", "薪酬"]):
            sal = _extract_salary(txt)
            if sal > 0:
                result["avg_salary"] = sal
                break

    # 就业行业分布（表格或列表）
    industries = {}
    for row in sel.css("table tr, .industry-item"):
        cells = row.css("td::text, .name::text, .label::text").getall()
        pcts = row.css("td::text, .percent::text, .value::text").getall()
        if len(cells) >= 1:
            name = cells[0].strip()
            pct_str = pcts[-1] if pcts else ""
            pct = _extract_percent(pct_str)
            if name and pct > 0 and len(name) < 20:
                industries[name] = round(pct, 3)
    if industries:
        result["top_industries"] = json.dumps(industries, ensure_ascii=False)

    # 就业城市分布
    cities = {}
    for txt_block in sel.css(".city-distribution, .employment-city")[:1].css("*::text").getall():
        # 简单正则：匹配"城市名 XX.X%"模式
        for m in re.finditer(r"([^\d\s%,，]+)\s+(\d+\.?\d*)\s*%", txt_block):
            city_name = m.group(1).strip()
            city_pct = float(m.group(2)) / 100.0
            if len(city_name) < 8 and city_pct > 0:
                cities[city_name] = round(city_pct, 3)
    if cities:
        result["top_cities"] = json.dumps(cities, ensure_ascii=False)

    # 深造率（考研+保研）
    for txt in sel.css("*::text").getall():
        if any(k in txt for k in ["深造率", "考研", "升学率"]):
            pct = _extract_percent(txt)
            if pct > 0:
                result["postgrad_rate"] = pct
                break

    # 出国率
    for txt in sel.css("*::text").getall():
        if any(k in txt for k in ["出国", "出境", "留学"]):
            pct = _extract_percent(txt)
            if 0 < pct < 0.5:  # 合理范围
                result["overseas_rate"] = pct
                break

    # 评级：顶级雇主判断
    page_text = " ".join(sel.css("*::text").getall())
    top_companies = ["华为", "腾讯", "阿里", "字节", "微软", "谷歌", "百度", "美团",
                     "中金", "高盛", "麦肯锡", "宝洁", "中国银行", "工商银行", "建设银行",
                     "中国电信", "国家电网", "中航", "中石油", "中石化"]
    top_hits = sum(1 for c in top_companies if c in page_text)
    result["top_employer_tier"] = "头部" if top_hits >= 5 else ("中等" if top_hits >= 2 else "一般")

    log.info(f"✓ {school_name}: 就业率={result['employment_rate']:.1%} "
             f"月薪={result['avg_salary']} 深造率={result['postgrad_rate']:.1%}")
    return result


# ── 写入数据库 ────────────────────────────────────────────────
def upsert_employment(data: dict, year: int, db):
    """插入或更新 school_employment 记录"""
    existing = db.query(SchoolEmployment).filter(
        SchoolEmployment.school_name == data["school_name"],
        SchoolEmployment.year == year,
    ).first()

    if existing:
        for k, v in data.items():
            setattr(existing, k, v)
        existing.year = year
    else:
        record = SchoolEmployment(year=year, **data)
        db.add(record)
    db.commit()


# ── 主流程 ────────────────────────────────────────────────────
def run(school_names: list[str], year: int = 2024):
    db = SessionLocal()
    client = httpx.Client(follow_redirects=True)
    success, fail = 0, 0

    for name in school_names:
        log.info(f"处理: {name}")
        _sleep()

        school_id = search_school_id(name, client)
        if not school_id:
            log.warning(f"未找到学校ID: {name}")
            fail += 1
            continue

        _sleep()
        data = scrape_school_employment(school_id, name, client)
        if not data:
            fail += 1
            continue

        upsert_employment(data, year, db)
        success += 1

    db.close()
    client.close()
    log.info(f"完成：成功 {success} 所 / 失败 {fail} 所")


def main():
    parser = argparse.ArgumentParser(description="高校就业数据采集器")
    parser.add_argument("--school", type=str, help="指定单个学校名")
    parser.add_argument("--limit", type=int, default=50, help="爬取前N所学校（按985/211/双一流/普通排序）")
    parser.add_argument("--all", action="store_true", help="全量爬取所有学校")
    parser.add_argument("--year", type=int, default=2024, help="报告年份，默认2024")
    parser.add_argument("--tier", type=str, default="", help="只爬指定层次：985/211/双一流/普通")
    args = parser.parse_args()

    db = SessionLocal()
    query = db.query(School.name, School.tier, School.is_985, School.is_211)

    if args.tier:
        if args.tier == "985":
            query = query.filter(School.is_985 == "是")
        elif args.tier == "211":
            query = query.filter(School.is_211 == "是")
        elif args.tier in ("双一流",):
            query = query.filter(School.tier == "双一流")
        else:
            query = query.filter(School.tier == args.tier)

    # 优先处理高层次学校
    schools = query.all()
    tier_order = {"985": 0, "211": 1, "双一流": 2, "普通": 3}
    schools_sorted = sorted(schools, key=lambda s: tier_order.get(s.tier, 4))

    db.close()

    if args.school:
        names = [args.school]
    elif args.all:
        names = [s.name for s in schools_sorted]
    else:
        names = [s.name for s in schools_sorted[:args.limit]]

    log.info(f"准备爬取 {len(names)} 所学校，年份={args.year}")
    run(names, year=args.year)


if __name__ == "__main__":
    main()
