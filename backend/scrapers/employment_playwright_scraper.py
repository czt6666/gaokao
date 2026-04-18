"""
就业薪资爬虫（Playwright版）— 搜狗微信 + 百度搜索
=================================================
解决 httpx 版本遇到的问题：
  - 搜狗微信 antispider（用真实浏览器绕过）
  - 职友集 302 redirect（改用百度搜索作为备选）

策略：Playwright 真实浏览器 → 搜狗微信搜索 "{学校} 毕业生 薪资 就业"
      → 从搜索结果摘要中 NLP 提取薪资数据
      → 间隔 6-10 秒避免触发 antispider

运行：
  python3 scrapers/employment_playwright_scraper.py --limit 200
  python3 scrapers/employment_playwright_scraper.py --school 清华大学 --verbose
"""
from __future__ import annotations

import sys, os, re, time, json, random, argparse, logging
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from playwright.sync_api import sync_playwright
from database import SessionLocal, School, SchoolEmployment

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("emp_pw")

DELAY_MIN = 3.0
DELAY_MAX = 5.0

# ── 薪资提取正则 ────────────────────────────────────────────────
SALARY_PATTERNS = [
    (r"(?:平均|签约|起步)?月薪[^0-9\n]{0,10}?(\d+(?:\.\d+)?)\s*[万k千K]", "monthly_wan"),
    (r"(?:平均|签约|起步)?月薪[^0-9\n]{0,10}?(\d{4,6})\s*[元块]?", "monthly_yuan"),
    (r"(?:平均|月均)?薪资[^0-9\n]{0,10}?(\d{4,6})\s*[元块]?", "monthly_yuan"),
    (r"薪酬[^0-9\n]{0,6}?(\d{4,6})\s*[元块]?", "monthly_yuan"),
    (r"月[薪入收][:：]?\s*(\d+(?:\.\d+)?)\s*[万k千K]", "monthly_wan"),
    (r"月[薪入收][:：]?\s*(\d{4,6})\s*[元块]?", "monthly_yuan"),
    (r"年[薪包收入][:：]?\s*(\d+(?:\.\d+)?)\s*[万wW]", "annual_wan"),
    (r"(?:税前|税后)?年薪\s*(\d+(?:\.\d+)?)\s*[万wW]", "annual_wan"),
    (r"(?:到手|实发|税后)\s*(\d{4,5})\s*[元块]?", "monthly_yuan"),
    (r"\b(\d{1,3})[kK]\b", "monthly_k"),
]


def extract_salaries(text: str) -> list[int]:
    """从文本提取月薪列表"""
    text = text.replace(",", "").replace("，", "").replace(" ", "")
    results = []
    for pattern, stype in SALARY_PATTERNS:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            raw = float(m.group(1))
            if stype == "monthly_wan":
                monthly = int(raw * 10000) if raw < 100 else int(raw * 1000)
            elif stype == "monthly_yuan":
                monthly = int(raw)
            elif stype == "annual_wan":
                monthly = int(raw * 10000 / 12)
            elif stype == "monthly_k":
                monthly = int(raw * 1000)
            else:
                continue
            if 2000 <= monthly <= 80000:
                results.append(monthly)
    return results


def salary_stats(arr: list[int]) -> dict | None:
    if len(arr) < 2:
        return None
    arr = sorted(arr)
    n = len(arr)
    q1, q3 = arr[n // 4], arr[3 * n // 4]
    iqr = q3 - q1
    if iqr > 0:
        arr = [x for x in arr if q1 - 1.5 * iqr <= x <= q3 + 1.5 * iqr]
    if not arr:
        return None
    return {"avg": int(sum(arr) / len(arr)), "median": arr[len(arr) // 2], "count": len(arr)}


def scrape_sogou_pw(page, school_name: str, verbose: bool = False) -> dict | None:
    """用 Playwright 真实浏览器搜索搜狗微信"""
    import urllib.parse
    query = f"{school_name} 毕业生 薪资 就业 月薪"
    url = f"https://weixin.sogou.com/weixin?type=2&query={urllib.parse.quote(query)}&ie=utf8"

    try:
        page.goto(url, wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(2000)

        # 检查是否触发 antispider — 直接跳过，用百度兜底
        if "antispider" in page.url:
            return None

        text = page.inner_text("body") or ""
        if verbose:
            log.info(f"  [搜狗] 页面 {len(text)} 字符")

        # 按段落分析
        all_salaries = []
        relevant = 0
        paragraphs = text.split("\n")
        for para in paragraphs:
            para = para.strip()
            if len(para) < 15:
                continue
            if school_name in para or any(w in para for w in ["毕业", "就业", "薪资", "月薪", "年薪", "收入"]):
                relevant += 1
                sals = extract_salaries(para)
                all_salaries.extend(sals)

        if verbose:
            log.info(f"  [搜狗] 相关段落: {relevant}, 薪资提取: {len(all_salaries)}")

        stats = salary_stats(all_salaries)
        if stats:
            return {
                "avg_salary": stats["avg"],
                "sample_count": stats["count"],
                "source": "搜狗微信(Playwright)",
                "confidence": "medium",
            }
        return None

    except Exception as e:
        if verbose:
            log.warning(f"  [搜狗] 异常: {e}")
        return None


def scrape_baidu_pw(page, school_name: str, verbose: bool = False) -> dict | None:
    """百度搜索作为备选"""
    import urllib.parse
    query = f"{school_name} 毕业生 平均薪资 就业报告"
    url = f"https://www.baidu.com/s?wd={urllib.parse.quote(query)}"

    try:
        page.goto(url, wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(2000)

        text = page.inner_text("body") or ""
        if verbose:
            log.info(f"  [百度] 页面 {len(text)} 字符")

        all_salaries = []
        relevant = 0
        for para in text.split("\n"):
            para = para.strip()
            if len(para) < 15:
                continue
            if school_name[:4] in para or any(w in para for w in ["毕业", "就业", "薪资", "月薪", "年薪"]):
                relevant += 1
                sals = extract_salaries(para)
                all_salaries.extend(sals)

        if verbose:
            log.info(f"  [百度] 相关段落: {relevant}, 薪资提取: {len(all_salaries)}")

        stats = salary_stats(all_salaries)
        if stats:
            return {
                "avg_salary": stats["avg"],
                "sample_count": stats["count"],
                "source": "百度搜索(Playwright)",
                "confidence": "medium",
            }
        return None

    except Exception as e:
        if verbose:
            log.warning(f"  [百度] 异常: {e}")
        return None


def upsert_employment(db, school_name: str, data: dict, year: int = 2024) -> bool:
    """写入DB，只覆盖估算模型数据"""
    existing = db.query(SchoolEmployment).filter(
        SchoolEmployment.school_name == school_name,
        SchoolEmployment.year == year,
    ).first()

    # 不覆盖官方报告数据
    if existing and "官方" in (existing.data_source or ""):
        return False

    avg_salary = data.get("avg_salary", 0)
    if not (2000 <= avg_salary <= 60000):
        return False

    source_label = f"{data['source']}(置信:{data['confidence']})"

    if existing:
        # 覆盖估算或已有爬虫数据（非官方即可覆盖）
        existing.avg_salary = avg_salary
        existing.data_source = source_label
        db.commit()
        return True
    else:
        record = SchoolEmployment(
            school_name=school_name,
            year=year,
            avg_salary=avg_salary,
            employment_rate=0.0,
            data_source=source_label,
        )
        db.add(record)
        db.commit()
        return True


def run(limit: int = 200, school_filter: str = None, verbose: bool = False, dry_run: bool = False):
    db = SessionLocal()

    if school_filter:
        schools = [school_filter]
    else:
        from sqlalchemy import text
        rows = db.execute(text("""
            SELECT DISTINCT s.name
            FROM schools s
            LEFT JOIN school_employment se ON se.school_name = s.name AND se.data_source NOT LIKE '%估算%'
            WHERE se.id IS NULL
            ORDER BY
              CASE WHEN s.is_985='是' THEN 0 WHEN s.is_211='是' THEN 1
                   WHEN s.tier='双一流' THEN 2 ELSE 3 END, s.name
            LIMIT :lim
        """), {"lim": limit}).fetchall()
        schools = [r[0] for r in rows]

    log.info(f"待爬取：{len(schools)} 所学校（仅爬取无真实就业数据的学校）")

    success = fail = skip = 0

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
        )
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            locale="zh-CN",
            viewport={"width": 1280, "height": 800},
        )
        ctx.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            window.chrome = {runtime: {}};
        """)
        page = ctx.new_page()

        for i, name in enumerate(schools):
            log.info(f"[{i+1}/{len(schools)}] {name}")

            # 先试搜狗微信
            data = scrape_sogou_pw(page, name, verbose)

            # 搜狗失败则试百度
            if not data:
                time.sleep(random.uniform(2, 4))
                data = scrape_baidu_pw(page, name, verbose)

            if data:
                if dry_run:
                    log.info(f"  [DRY] 月薪={data['avg_salary']}, 来源={data['source']}")
                    success += 1
                else:
                    written = upsert_employment(db, name, data)
                    if written:
                        success += 1
                        log.info(f"  ✅ 月薪={data['avg_salary']}, 来源={data['source']}")
                    else:
                        skip += 1
            else:
                fail += 1
                if verbose:
                    log.info(f"  ⚠️ 无数据")

            # 关键：长间隔避免 antispider
            delay = random.uniform(DELAY_MIN, DELAY_MAX)
            time.sleep(delay)

            if (i + 1) % 20 == 0:
                log.info(f"进度: {i+1}/{len(schools)}, ✅{success} ❌{fail} ⏭{skip}")

        browser.close()
    db.close()
    log.info(f"\n{'='*50}")
    log.info(f"完成: ✅{success} 写入 | ❌{fail} 失败 | ⏭{skip} 跳过")
    log.info(f"{'='*50}")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="就业薪资爬虫（Playwright版）")
    p.add_argument("--limit", type=int, default=200, help="最多爬取学校数")
    p.add_argument("--school", type=str, default=None, help="单校测试")
    p.add_argument("--verbose", action="store_true", help="详细输出")
    p.add_argument("--dry-run", action="store_true", help="不写DB")
    args = p.parse_args()

    run(limit=args.limit, school_filter=args.school, verbose=args.verbose, dry_run=args.dry_run)
