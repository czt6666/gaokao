"""
学生口碑爬虫（Playwright版）— 百度搜索
=============================================
替代 httpx 版搜狗微信爬虫（被 antispider 封锁后的备选方案）

策略：Playwright 真实浏览器 → 百度搜索 "{学校} 值得报考 学生评价 怎么样"
      → 从搜索结果摘要中情感分析提取口碑数据

运行：
  python3 scrapers/review_playwright_scraper.py --limit 500
  python3 scrapers/review_playwright_scraper.py --school 武汉大学 --verbose
"""
from __future__ import annotations

import sys, os, re, time, json, random, argparse, logging, datetime
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import urllib.parse
from collections import Counter
from playwright.sync_api import sync_playwright
from database import SessionLocal, School, SchoolReview

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("review_pw")

DELAY_MIN = 3.0
DELAY_MAX = 5.0

# ── 情感词典 ────────────────────────────────────────────────────────

POSITIVE_WORDS = [
    "老师负责", "老师认真", "老师好", "教学认真", "学风好", "学风浓",
    "学术氛围好", "科研强", "课程好", "教学质量高",
    "就业好", "就业不错", "就业率高", "行业资源好", "含金量高",
    "找工作容易", "校招多", "大厂", "名企", "薪资高", "起薪高",
    "食堂好吃", "食堂便宜", "食堂实惠", "宿舍好", "环境好", "校园美",
    "设施好", "图书馆好", "活动丰富", "社团好",
    "推荐报考", "值得来", "来了不后悔", "没有后悔", "选择正确",
    "超出预期", "比想象好", "性价比高", "很满意", "喜欢这里",
    "氛围好", "同学优秀", "很开心", "很充实", "收获很多",
    "值得", "推荐", "不错", "挺好", "很好", "满意",
]

NEGATIVE_WORDS = [
    "老师差", "老师不负责", "水课多", "课程水", "学风差", "氛围差",
    "放羊", "划水", "摸鱼", "不认真",
    "就业差", "就业难", "找不到工作", "毕业即失业", "薪资低",
    "含金量低", "就业率造假", "虚假宣传",
    "管理混乱", "管理差", "规定奇葩", "限制多", "不自由",
    "像高中", "封闭式", "军事化管理",
    "食堂差", "食堂贵", "难吃", "宿舍差", "宿舍老旧", "没有空调",
    "设施差", "校园偏", "偏远",
    "后悔来了", "不推荐", "不值得", "踩坑", "避雷", "劝退",
    "失望", "差劲", "烂", "不好", "很差", "太差",
    "内卷严重", "压力大", "性价比低",
]

HIGH_WEIGHT_POS = {"推荐报考", "含金量高", "就业好", "来了不后悔", "超出预期", "值得"}
HIGH_WEIGHT_NEG = {"后悔来了", "劝退", "避雷", "踩坑", "就业难", "虚假宣传", "不推荐"}


def _score_text(text: str) -> tuple:
    pos, neg = 0, 0
    hit_pos, hit_neg = [], []
    for w in POSITIVE_WORDS:
        if w in text:
            weight = 2 if w in HIGH_WEIGHT_POS else 1
            pos += weight
            hit_pos.append(w)
    for w in NEGATIVE_WORDS:
        if w in text:
            weight = 2 if w in HIGH_WEIGHT_NEG else 1
            neg += weight
            hit_neg.append(w)
    return pos, neg, hit_pos, hit_neg


def scrape_baidu_reviews(page, school_name: str, query_suffix: str, verbose: bool = False) -> tuple:
    """单次百度搜索，返回 (pos, neg, hit_pos, hit_neg, quotes, count)"""
    query = f"{school_name} {query_suffix}"
    url = f"https://www.baidu.com/s?wd={urllib.parse.quote(query)}"

    try:
        page.goto(url, wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(2000)

        text = page.inner_text("body") or ""
        if verbose:
            log.info(f"  [百度] 页面 {len(text)} 字符")

        total_pos, total_neg = 0, 0
        all_hp, all_hn, quotes = [], [], []
        count = 0

        for para in text.split("\n"):
            para = para.strip()
            if len(para) < 15:
                continue
            if school_name[:4] not in para and not any(
                w in para for w in ["就业", "推荐", "吐槽", "感受", "评价", "值得", "后悔", "怎么样"]
            ):
                continue
            count += 1
            p, n, hp, hn = _score_text(para)
            total_pos += p
            total_neg += n
            all_hp.extend(hp)
            all_hn.extend(hn)
            if (p > 0 or n > 0) and len(quotes) < 4:
                quotes.append(para[:80])

        return total_pos, total_neg, all_hp, all_hn, quotes, count

    except Exception as e:
        if verbose:
            log.warning(f"  [百度] 异常: {e}")
        return 0, 0, [], [], [], 0


def scrape_school_reviews(page, school_name: str, verbose: bool = False) -> dict | None:
    """对单所学校采集口碑数据（两个查询）"""
    queries = [
        "值得报考 学生评价 推荐 吐槽 怎么样",
        "就读体验 学习氛围 优缺点 食堂宿舍",
    ]

    total_pos, total_neg = 0, 0
    all_hp, all_hn, all_quotes = [], [], []
    total_count = 0

    for q in queries:
        p, n, hp, hn, quotes, cnt = scrape_baidu_reviews(page, school_name, q, verbose)
        total_pos += p
        total_neg += n
        all_hp.extend(hp)
        all_hn.extend(hn)
        all_quotes.extend(quotes)
        total_count += cnt
        if verbose:
            log.info(f"  [{q[:12]}...] 段落{cnt}, +{p}/-{n}")
        time.sleep(random.uniform(1.5, 2.5))

    if total_count < 2 or (total_pos + total_neg) == 0:
        return None

    sentiment_score = total_pos / (total_pos + total_neg)
    seen, uniq_quotes = set(), []
    for q in all_quotes:
        if q not in seen:
            seen.add(q)
            uniq_quotes.append(q)

    return {
        "source": "百度搜索(Playwright)",
        "positive_count": total_pos,
        "negative_count": total_neg,
        "review_count": total_count,
        "sentiment_score": round(sentiment_score, 3),
        "top_positive": json.dumps(
            list(Counter(all_hp).most_common(5)), ensure_ascii=False
        ),
        "top_negative": json.dumps(
            list(Counter(all_hn).most_common(5)), ensure_ascii=False
        ),
        "sample_quotes": json.dumps(uniq_quotes[:5], ensure_ascii=False),
    }


def write_review(db, school_name: str, data: dict) -> bool:
    existing = db.query(SchoolReview).filter(SchoolReview.school_name == school_name).first()
    if existing:
        for k, v in data.items():
            setattr(existing, k, v)
        existing.updated_at = datetime.datetime.utcnow()
    else:
        db.add(SchoolReview(school_name=school_name, **data))
    db.commit()
    return True


def compute_sentiment_delta(db):
    """计算每所学校相对于同层次学校的口碑偏差"""
    schools_map = {s.name: (s.tier or "普通") for s in db.query(School).all()}
    reviews = db.query(SchoolReview).all()
    if not reviews:
        return

    tier_scores: dict[str, list] = {}
    for rv in reviews:
        t = schools_map.get(rv.school_name, "普通")
        tier_scores.setdefault(t, []).append(rv.sentiment_score)

    tier_avg = {t: sum(v) / len(v) for t, v in tier_scores.items() if v}
    log.info(f"层次口碑均值: { {k: round(v,3) for k,v in tier_avg.items()} }")

    for rv in reviews:
        t = schools_map.get(rv.school_name, "普通")
        avg = tier_avg.get(t, 0.5)
        rv.sentiment_delta = round(rv.sentiment_score - avg, 3)
    db.commit()
    log.info(f"sentiment_delta 更新完成，共 {len(reviews)} 所")


def run(limit: int = 500, school_filter: str = None, verbose: bool = False):
    db = SessionLocal()

    if school_filter:
        schools = [school_filter]
    else:
        from sqlalchemy import text
        rows = db.execute(text("""
            SELECT name FROM schools
            WHERE name NOT IN (SELECT school_name FROM school_reviews)
            ORDER BY
              CASE WHEN is_985='是' THEN 0 WHEN is_211='是' THEN 1
                   WHEN tier='双一流' THEN 2 ELSE 3 END, name
            LIMIT :lim
        """), {"lim": limit}).fetchall()
        schools = [r[0] for r in rows]

    log.info(f"待采集：{len(schools)} 所学校")
    ok = skip = err = 0

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
            try:
                data = scrape_school_reviews(page, name, verbose)
                if data:
                    write_review(db, name, data)
                    s = data["sentiment_score"]
                    label = "👍" if s > 0.65 else ("⚠️" if s < 0.40 else "😐")
                    log.info(f"  ✅ score={s:.2f} {label} pos={data['positive_count']} neg={data['negative_count']}")
                    ok += 1
                else:
                    log.info(f"  ⚠️ 无有效数据")
                    skip += 1
            except KeyboardInterrupt:
                break
            except Exception as e:
                log.error(f"  ❌ {e}")
                err += 1

            delay = random.uniform(DELAY_MIN, DELAY_MAX)
            time.sleep(delay)

            if (i + 1) % 20 == 0:
                log.info(f"进度: {i+1}/{len(schools)}, ✅{ok} ⏭{skip} ❌{err}")

        browser.close()

    log.info("计算 sentiment_delta...")
    compute_sentiment_delta(db)
    db.close()
    log.info(f"完成: ✅{ok} ⏭{skip} ❌{err}")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="学生口碑爬虫（Playwright版）")
    p.add_argument("--limit", type=int, default=500)
    p.add_argument("--school", type=str, default=None)
    p.add_argument("--verbose", action="store_true")
    args = p.parse_args()

    run(limit=args.limit, school_filter=args.school, verbose=args.verbose)
