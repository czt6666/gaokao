"""
各校《就业质量年度报告》爬虫
============================
爬取各高校官网公开的就业质量年度报告（PDF/网页），
提取结构化就业数据，写入 school_employment 表。

教育部要求：2014年起所有本科高校必须每年公开就业质量年度报告。
目前约 1200+ 所高校已公开，数据权威性最高。

用法：
  python scrapers/school_report_scraper.py --limit 100
  python scrapers/school_report_scraper.py --school 清华大学

依赖：
  pip install playwright pdfplumber httpx parsel
  playwright install chromium
"""
import sys, os, json, time, random, re, argparse, logging, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import httpx
from parsel import Selector
from database import SessionLocal, School, SchoolEmployment

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("report_scraper")

DELAY_MIN = 3.0
DELAY_MAX = 6.0

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9",
}

# 就业率关键词模式
RATE_PATTERNS = [
    r"(?:毕业生)?就业率[：:为]?\s*(\d+\.?\d*)\s*%",
    r"初次就业率[：:]?\s*(\d+\.?\d*)\s*%",
    r"总体就业率[：:]?\s*(\d+\.?\d*)\s*%",
    r"协议就业率[：:]?\s*(\d+\.?\d*)\s*%",
]

# 薪资关键词模式
SALARY_PATTERNS = [
    r"平均月薪[：:]?\s*(\d[\d,，]+)\s*元",
    r"月均薪资[：:]?\s*(\d[\d,，]+)\s*元",
    r"平均薪资[：:]?\s*(\d[\d,，]+)\s*元/月",
    r"平均工资[：:]?\s*(\d[\d,，]+)\s*元",
    r"月薪中位数[：:]?\s*(\d[\d,，]+)\s*元",
]

# 深造率模式
POSTGRAD_PATTERNS = [
    r"深造率[：:]?\s*(\d+\.?\d*)\s*%",
    r"(?:国内)?升学率[：:]?\s*(\d+\.?\d*)\s*%",
    r"考研录取率[：:]?\s*(\d+\.?\d*)\s*%",
    r"读研率[：:]?\s*(\d+\.?\d*)\s*%",
]

TOP_COMPANIES = [
    "华为", "腾讯", "阿里", "字节跳动", "百度", "美团", "京东", "滴滴",
    "网易", "小米", "联想", "中兴", "OPPO", "vivo",
    "中金", "高盛", "摩根", "麦肯锡", "波士顿", "贝恩",
    "谷歌", "微软", "苹果", "英特尔", "英伟达",
    "中国银行", "工商银行", "建设银行", "农业银行", "交通银行",
    "中信", "招商银行", "平安", "中国人寿",
    "国家电网", "中石油", "中石化", "中航", "中船",
    "华润", "中国电信", "中国移动", "中国联通",
]


def _sleep():
    time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))


def _extract_first(patterns: list, text: str) -> float:
    for p in patterns:
        m = re.search(p, text)
        if m:
            val_str = m.group(1).replace(",", "").replace("，", "")
            val = float(val_str)
            # 就业率/深造率：如果 > 1，是百分比形式
            return val / 100.0 if val > 1 else val
    return 0.0


def _extract_salary_first(text: str) -> int:
    for p in SALARY_PATTERNS:
        m = re.search(p, text)
        if m:
            val_str = m.group(1).replace(",", "").replace("，", "")
            val = int(float(val_str))
            if 3000 < val < 80000:  # 合理月薪范围
                return val
    return 0


def _count_top_companies(text: str) -> int:
    return sum(1 for c in TOP_COMPANIES if c in text)


def _employer_tier(count: int) -> str:
    return "头部" if count >= 5 else ("中等" if count >= 2 else "一般")


# ── PDF 解析 ────────────────────────────────────────────────
def parse_pdf_text(pdf_bytes: bytes) -> str:
    """用 pdfplumber 提取PDF全文"""
    try:
        import pdfplumber, io
        text_parts = []
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages[:30]:  # 最多前30页
                t = page.extract_text()
                if t:
                    text_parts.append(t)
        return "\n".join(text_parts)
    except ImportError:
        log.warning("pdfplumber 未安装，跳过PDF解析。pip install pdfplumber")
        return ""
    except Exception as e:
        log.warning(f"PDF解析失败: {e}")
        return ""


# ── 搜索就业报告页面 ────────────────────────────────────────
def find_employment_report_url(school_name: str, website: str, client: httpx.Client) -> str | None:
    """
    在学校官网搜索就业质量年度报告链接。
    策略：通过 Google/Bing 搜索 "site:官网 就业质量报告 2024"
    """
    if not website:
        return None

    # 清理域名（去掉 http/https 和路径）
    domain = re.sub(r"^https?://", "", website).split("/")[0]

    # 通过 Bing 搜索（不需要登录）
    search_url = "https://cn.bing.com/search"
    query = f'site:{domain} "就业质量" ("2024年" OR "2023年") 报告'

    try:
        resp = client.get(
            search_url,
            params={"q": query},
            headers={**HEADERS, "Accept": "text/html"},
            timeout=10,
        )
        sel = Selector(resp.text)
        # 提取搜索结果中的第一个 PDF 或就业页面链接
        for link in sel.css("a::attr(href)").getall():
            if domain in link and any(k in link.lower() for k in ["jiuye", "employ", "jyzl", "report"]):
                return link
            if domain in link and link.endswith(".pdf"):
                return link
    except Exception as e:
        log.debug(f"Bing搜索失败 [{school_name}]: {e}")

    return None


def fetch_and_parse(url: str, school_name: str, client: httpx.Client) -> dict | None:
    """下载并解析就业报告页面或PDF"""
    try:
        resp = client.get(url, headers=HEADERS, timeout=20)
        if resp.status_code != 200:
            return None
    except Exception as e:
        log.warning(f"下载失败 [{school_name}] {url}: {e}")
        return None

    content_type = resp.headers.get("content-type", "")

    if "pdf" in content_type or url.endswith(".pdf"):
        text = parse_pdf_text(resp.content)
    else:
        sel = Selector(resp.text)
        # 移除脚本/样式
        sel.css("script, style").drop()
        text = " ".join(sel.css("body *::text").getall())

    if not text or len(text) < 100:
        return None

    result = {
        "school_name": school_name,
        "employment_rate": _extract_first(RATE_PATTERNS, text),
        "avg_salary": _extract_salary_first(text),
        "postgrad_rate": _extract_first(POSTGRAD_PATTERNS, text),
        "overseas_rate": 0.0,
        "top_employers": "[]",
        "top_industries": "{}",
        "top_cities": "{}",
        "postgrad_schools": "",
        "top_employer_tier": _employer_tier(_count_top_companies(text)),
        "data_source": "官网报告",
        "report_url": url,
    }

    # 出国率
    overseas_patterns = [
        r"出国率[：:]?\s*(\d+\.?\d*)\s*%",
        r"出境率[：:]?\s*(\d+\.?\d*)\s*%",
        r"留学率[：:]?\s*(\d+\.?\d*)\s*%",
    ]
    result["overseas_rate"] = _extract_first(overseas_patterns, text)

    # 提取出现的顶级雇主名单
    employers_found = [c for c in TOP_COMPANIES if c in text]
    if employers_found:
        result["top_employers"] = json.dumps(
            [{"name": c} for c in employers_found[:20]],
            ensure_ascii=False
        )

    log.info(
        f"✓ {school_name}: 就业率={result['employment_rate']:.1%} "
        f"月薪={result['avg_salary']} 深造率={result['postgrad_rate']:.1%} "
        f"雇主={result['top_employer_tier']}"
    )
    return result


# ── 写入数据库 ────────────────────────────────────────────────
def upsert_employment(data: dict, year: int, db):
    existing = db.query(SchoolEmployment).filter(
        SchoolEmployment.school_name == data["school_name"],
        SchoolEmployment.year == year,
    ).first()
    if existing:
        for k, v in data.items():
            setattr(existing, k, v)
        existing.year = year
    else:
        db.add(SchoolEmployment(year=year, **data))
    db.commit()


# ── 主流程 ────────────────────────────────────────────────────
def run(school_names_websites: list[tuple], year: int = 2024):
    db = SessionLocal()
    client = httpx.Client(follow_redirects=True)
    success, fail = 0, 0

    for name, website in school_names_websites:
        log.info(f"处理: {name} ({website})")
        _sleep()

        url = find_employment_report_url(name, website, client)
        if not url:
            log.warning(f"未找到报告链接: {name}")
            fail += 1
            continue

        log.info(f"  → {url}")
        _sleep()

        data = fetch_and_parse(url, name, client)
        if not data:
            fail += 1
            continue

        upsert_employment(data, year, db)
        success += 1

    db.close()
    client.close()
    log.info(f"完成：成功 {success} 所 / 失败 {fail} 所")


def main():
    parser = argparse.ArgumentParser(description="各校就业质量年度报告爬虫")
    parser.add_argument("--school", type=str, help="指定单个学校名")
    parser.add_argument("--limit", type=int, default=50, help="爬取前N所学校")
    parser.add_argument("--year", type=int, default=2024, help="目标年份，默认2024")
    parser.add_argument("--tier", type=str, default="", help="层次过滤：985/211")
    args = parser.parse_args()

    db = SessionLocal()
    query = db.query(School.name, School.website, School.tier, School.is_985, School.is_211)

    if args.tier == "985":
        query = query.filter(School.is_985 == "是")
    elif args.tier == "211":
        query = query.filter(School.is_211 == "是")

    schools = query.filter(School.website != "").all()
    tier_order = {"985": 0, "211": 1, "双一流": 2, "普通": 3}
    schools_sorted = sorted(schools, key=lambda s: tier_order.get(s.tier or "普通", 4))
    db.close()

    if args.school:
        db2 = SessionLocal()
        s = db2.query(School).filter(School.name == args.school).first()
        db2.close()
        pairs = [(args.school, s.website if s else "")]
    else:
        pairs = [(s.name, s.website) for s in schools_sorted[:args.limit]]

    log.info(f"准备处理 {len(pairs)} 所学校，目标年份={args.year}")
    run(pairs, year=args.year)


if __name__ == "__main__":
    main()
