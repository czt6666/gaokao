"""
高校就业数据采集器 v2（Playwright版）
========================================
"""
from __future__ import annotations
"""
使用真实浏览器绕过JS Challenge（412），爬取各高校就业数据。
数据来源：教育部就业数据平台
公信力：最高（教育部直属）

用法：
  python scrapers/chsi_employment_scraper.py --limit 200
  python scrapers/chsi_employment_scraper.py --school 兰州大学
  python scrapers/chsi_employment_scraper.py --tier 985
  python scrapers/chsi_employment_scraper.py --all

依赖：
  pip install playwright
  playwright install chromium
"""
import sys, os, json, time, random, re, argparse, logging
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
from database import SessionLocal, School, SchoolEmployment

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("chsi_scraper")

DELAY_MIN = 2.5
DELAY_MAX = 4.5
_EMP_BASE = "https://gaokao.chsi.com.cn"


def _sleep():
    time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))


def _pct(text: str) -> float:
    m = re.search(r"(\d+\.?\d*)\s*%", text or "")
    return float(m.group(1)) / 100.0 if m else 0.0


def _salary(text: str) -> int:
    cleaned = (text or "").replace(",", "").replace("，", "")
    m = re.search(r"(\d{3,6})\s*元", cleaned)
    return int(m.group(1)) if m else 0


# ── 搜索学校ID ──────────────────────────────────────────────────
def search_school_id(page, school_name: str) -> str | None:
    """搜索学校就业数据ID"""
    try:
        url = f"{_EMP_BASE}/sch/search?searchType=1&searchValue={school_name}&start=0"
        page.goto(url, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(1500)

        # 尝试多种选择器
        for sel in [
            "a.search-result-school-name",
            ".school-list a",
            "a[href*='schId']",
            ".sch-name a",
        ]:
            link = page.query_selector(sel)
            if link:
                href = link.get_attribute("href") or ""
                m = re.search(r"schId[-=](\d+)", href)
                if m:
                    return m.group(1)

        # fallback：从页面文本找 schId
        content = page.content()
        m = re.search(r"schId[-=](\d+)", content)
        return m.group(1) if m else None
    except PWTimeout:
        log.warning(f"搜索超时: {school_name}")
        return None
    except Exception as e:
        log.warning(f"搜索失败 [{school_name}]: {e}")
        return None


# ── 解析就业页面 ─────────────────────────────────────────────────
def scrape_employment_page(page, school_id: str, school_name: str) -> dict | None:
    """爬取就业数据页，提取结构化数据"""
    url = f"{_EMP_BASE}/sch/employment--schId-{school_id}.dhtml"
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(1800)
    except PWTimeout:
        log.warning(f"就业页超时: {school_name}")
        return None
    except Exception as e:
        log.warning(f"就业页失败 [{school_name}]: {e}")
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

    try:
        content = page.content()
        all_text = page.inner_text("body") or ""
    except Exception:
        return None

    # ── 就业率 ──────────────────────────────────────────────────
    for pattern in [
        r"就业率[：:\s]*(\d+\.?\d*)\s*%",
        r"毕业生就业率[：:\s]*(\d+\.?\d*)\s*%",
        r"初次就业率[：:\s]*(\d+\.?\d*)\s*%",
        r"总体就业率[：:\s]*(\d+\.?\d*)\s*%",
    ]:
        m = re.search(pattern, all_text)
        if m:
            val = float(m.group(1)) / 100.0
            if 0.3 < val <= 1.0:
                result["employment_rate"] = round(val, 4)
                break

    # ── 薪资 ────────────────────────────────────────────────────
    for pattern in [
        r"平均月薪[：:\s]*(\d[\d,，]+)\s*元",
        r"月均薪资[：:\s]*(\d[\d,，]+)\s*元",
        r"平均薪资[：:\s]*(\d[\d,，]+)\s*元",
        r"月薪中位数[：:\s]*(\d[\d,，]+)\s*元",
        r"月均收入[：:\s]*(\d[\d,，]+)\s*元",
    ]:
        m = re.search(pattern, all_text)
        if m:
            sal = int(m.group(1).replace(",", "").replace("，", ""))
            if 2000 < sal < 50000:
                result["avg_salary"] = sal
                break

    # ── 深造率 ──────────────────────────────────────────────────
    for pattern in [
        r"深造率[：:\s]*(\d+\.?\d*)\s*%",
        r"升学率[：:\s]*(\d+\.?\d*)\s*%",
        r"国内深造率[：:\s]*(\d+\.?\d*)\s*%",
    ]:
        m = re.search(pattern, all_text)
        if m:
            val = float(m.group(1)) / 100.0
            if 0 < val < 0.8:
                result["postgrad_rate"] = round(val, 4)
                break

    # ── 出国率 ──────────────────────────────────────────────────
    for pattern in [r"出国[（(]境[)）]率[：:\s]*(\d+\.?\d*)\s*%", r"出境率[：:\s]*(\d+\.?\d*)\s*%"]:
        m = re.search(pattern, all_text)
        if m:
            val = float(m.group(1)) / 100.0
            if 0 < val < 0.5:
                result["overseas_rate"] = round(val, 4)
                break

    # ── 行业分布（表格行）───────────────────────────────────────
    industries = {}
    rows = page.query_selector_all("table tr")
    for row in rows[:30]:
        cells = row.query_selector_all("td")
        if len(cells) >= 2:
            name = (cells[0].inner_text() or "").strip()
            pct_text = (cells[-1].inner_text() or "").strip()
            pct = _pct(pct_text)
            if name and 0 < pct < 1 and 1 < len(name) < 15:
                industries[name] = round(pct, 3)
    if not industries:
        # 正则从文本提取 "行业名称 XX.X%"
        for m in re.finditer(r"([^\d\s%，,\n]{2,10})\s+(\d+\.?\d*)\s*%", all_text):
            ind_name, pct_str = m.group(1).strip(), float(m.group(2)) / 100.0
            if 0.01 < pct_str < 0.6 and ind_name not in industries:
                industries[ind_name] = round(pct_str, 3)
            if len(industries) >= 8:
                break
    if industries:
        result["top_industries"] = json.dumps(
            dict(sorted(industries.items(), key=lambda x: -x[1])[:8]),
            ensure_ascii=False
        )

    # ── 城市分布 ────────────────────────────────────────────────
    cities = {}
    for m in re.finditer(r"([^\d\s%，,\n（(]{2,6}(?:市|省|区)?)\s+(\d+\.?\d*)\s*%", all_text):
        cname = m.group(1).strip()
        cpct  = float(m.group(2)) / 100.0
        if 0.01 < cpct < 0.8 and cname not in cities and len(cname) <= 6:
            cities[cname] = round(cpct, 3)
        if len(cities) >= 6:
            break
    if cities:
        result["top_cities"] = json.dumps(
            dict(sorted(cities.items(), key=lambda x: -x[1])[:6]),
            ensure_ascii=False
        )

    # ── 顶级雇主判断 ─────────────────────────────────────────────
    TOP_COMPANIES = [
        "华为", "腾讯", "阿里", "字节", "微软", "谷歌", "百度", "美团",
        "中金", "高盛", "麦肯锡", "宝洁", "中国银行", "工商银行", "建设银行",
        "中国电信", "国家电网", "中航", "中石油", "中石化", "中核",
        "国防科工委", "航天科工", "中船集团",
    ]
    top_hits = sum(1 for c in TOP_COMPANIES if c in all_text)
    result["top_employer_tier"] = "头部" if top_hits >= 5 else ("中等" if top_hits >= 2 else "一般")

    # ── 保研去向摘要 ─────────────────────────────────────────────
    for m in re.finditer(r"(清华|北京大学|复旦|交通大学|浙大|中科大).{0,10}(\d+\.?\d*)\s*%", all_text):
        result["postgrad_schools"] = f"含{m.group(1)}等顶校"
        break

    log.info(
        f"✓ {school_name}: 就业率={result['employment_rate']:.1%} "
        f"月薪={result['avg_salary']:,} 深造率={result['postgrad_rate']:.1%} "
        f"行业={len(industries)}个"
    )
    return result


# ── 写入数据库 ────────────────────────────────────────────────────
def upsert_employment(data: dict, year: int, db):
    existing = db.query(SchoolEmployment).filter(
        SchoolEmployment.school_name == data["school_name"],
        SchoolEmployment.year == year,
        SchoolEmployment.data_source == "edu_platform",
    ).first()
    if existing:
        for k, v in data.items():
            if k != "school_name":
                setattr(existing, k, v)
    else:
        obj = SchoolEmployment(year=year, **data)
        db.add(obj)
    db.commit()


# ── 主流程 ────────────────────────────────────────────────────────
def run(school_names: list, year: int = 2024):
    db = SessionLocal()
    success, fail, skip = 0, 0, 0

    # 跳过已有就业数据的学校
    existing_set = set(
        r[0] for r in db.query(SchoolEmployment.school_name)
        .filter(SchoolEmployment.data_source == "edu_platform")
        .all()
    )
    todo = [n for n in school_names if n not in existing_set]
    log.info(f"待爬取：{len(todo)} 所（已跳过 {len(school_names)-len(todo)} 所已有数据）")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
        )
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            locale="zh-CN",
            viewport={"width": 1280, "height": 800},
        )
        # 注入 stealth JS（隐藏自动化特征）
        ctx.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            window.chrome = {runtime: {}};
        """)
        page = ctx.new_page()

        # 预热：先访问首页获取必要Cookie
        try:
            log.info("预热：初始化会话...")
            page.goto(f"{_EMP_BASE}/", wait_until="domcontentloaded", timeout=15000)
            page.wait_for_timeout(2000)
            log.info("预热完成")
        except Exception as e:
            log.warning(f"预热失败（继续）: {e}")

        for i, name in enumerate(todo):
            log.info(f"[{i+1}/{len(todo)}] {name}")

            school_id = search_school_id(page, name)
            if not school_id:
                log.warning(f"  未找到学校ID: {name}")
                fail += 1
                _sleep()
                continue

            _sleep()
            data = scrape_employment_page(page, school_id, name)
            if not data:
                fail += 1
                _sleep()
                continue

            # 至少有就业率或深造率才写入
            if data["employment_rate"] == 0 and data["postgrad_rate"] == 0 and data["avg_salary"] == 0:
                log.info(f"  {name}: 页面无有效就业数据，跳过")
                skip += 1
            else:
                upsert_employment(data, year, db)
                success += 1

            _sleep()

            # 每50所保存进度
            if (i + 1) % 50 == 0:
                log.info(f"进度：{i+1}/{len(todo)}，成功{success}/失败{fail}/跳过{skip}")

        browser.close()
    db.close()
    log.info(f"\n完成！成功 {success} / 失败 {fail} / 跳过 {skip}")


def main():
    parser = argparse.ArgumentParser(description="高校就业数据采集器（Playwright版）")
    parser.add_argument("--school", type=str, default="", help="单个学校名")
    parser.add_argument("--limit", type=int, default=100, help="爬取前N所学校")
    parser.add_argument("--tier", type=str, default="", help="层次过滤：985/211/双一流/普通")
    parser.add_argument("--all", action="store_true", help="全量爬取")
    parser.add_argument("--year", type=int, default=2024, help="报告年份")
    args = parser.parse_args()

    db = SessionLocal()
    q = db.query(School.name, School.tier, School.is_985, School.is_211)
    if args.tier == "985":
        q = q.filter(School.is_985 == "是")
    elif args.tier == "211":
        q = q.filter(School.is_211 == "是")
    elif args.tier in ("双一流",):
        q = q.filter(School.tier == "双一流")
    elif args.tier == "普通":
        q = q.filter(School.tier == "普通")

    schools = q.all()
    tier_order = {"985": 0, "211": 1, "双一流": 2, "普通": 3}
    schools_sorted = sorted(schools, key=lambda s: tier_order.get(s.tier or "", 4))
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
