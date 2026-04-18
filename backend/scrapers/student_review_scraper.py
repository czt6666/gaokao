"""
学生口碑爬虫 — 搜狗微信公众号情感分析
=============================================
"""
from __future__ import annotations
"""
数据来源：搜狗微信索引（weixin.sogou.com）
  - 索引了大量公众号文章，包含学生真实体验分享、毕业生回顾、对比评测
  - 无需登录，成功率高

策略：每所学校发送2个搜索查询
  Q1: "{school} 值得报考 学生真实评价 推荐 吐槽"  → 综合口碑
  Q2: "{school} 就读体验 学习氛围 食堂宿舍 优缺点" → 校园生活

情感分析：基于词典规则，无需大模型
  sentiment_score = pos / (pos + neg)，区间 [0,1]
  sentiment_delta = score - 同层次学校均值（纠偏参数）

运行：
  python3 scrapers/student_review_scraper.py --limit 300 --delay 2.0
  python3 scrapers/student_review_scraper.py --school 武汉大学 --verbose
  python3 scrapers/student_review_scraper.py --compute-delta
"""

import sys, os, re, time, json, random, argparse, logging, datetime
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx, urllib.parse
from collections import Counter
from database import SessionLocal, School, SchoolReview

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("review")

# ── 情感词典（基于大量贴吧/微信文章归纳）────────────────────────────────────

POSITIVE_WORDS = [
    # 教学
    "老师负责", "老师认真", "老师好", "教学认真", "学风好", "学风浓",
    "学术氛围好", "科研强", "课程好", "教学质量高",
    # 就业
    "就业好", "就业不错", "就业率高", "行业资源好", "含金量高",
    "找工作容易", "校招多", "大厂", "名企", "薪资高", "起薪高",
    # 校园
    "食堂好吃", "食堂便宜", "食堂实惠", "宿舍好", "环境好", "校园美",
    "设施好", "图书馆好", "活动丰富", "社团好",
    # 综合
    "推荐报考", "值得来", "来了不后悔", "没有后悔", "选择正确",
    "超出预期", "比想象好", "性价比高", "很满意", "喜欢这里",
    "氛围好", "同学优秀", "很开心", "很充实", "收获很多",
    "值得", "推荐", "不错", "挺好", "很好", "满意",
]

NEGATIVE_WORDS = [
    # 教学
    "老师差", "老师不负责", "水课多", "课程水", "学风差", "氛围差",
    "放羊", "划水", "摸鱼", "不认真",
    # 就业
    "就业差", "就业难", "找不到工作", "毕业即失业", "薪资低",
    "含金量低", "就业率造假", "虚假宣传",
    # 管理
    "管理混乱", "管理差", "规定奇葩", "限制多", "不自由",
    "像高中", "封闭式", "军事化管理",
    # 硬件
    "食堂差", "食堂贵", "难吃", "宿舍差", "宿舍老旧", "没有空调",
    "设施差", "校园偏", "偏远",
    # 综合
    "后悔来了", "不推荐", "不值得", "踩坑", "避雷", "劝退",
    "失望", "差劲", "烂", "不好", "很差", "太差",
    "内卷严重", "压力大", "性价比低",
]

HIGH_WEIGHT_POS = {"推荐报考", "含金量高", "就业好", "来了不后悔", "超出预期", "值得"}
HIGH_WEIGHT_NEG = {"后悔来了", "劝退", "避雷", "踩坑", "就业难", "虚假宣传", "不推荐"}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://weixin.sogou.com/",
}


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


def scrape_sogou(school_name: str, query_suffix: str, client: httpx.Client) -> tuple:
    """单次搜狗查询，返回 (pos, neg, hit_pos_words, hit_neg_words, quotes, count)"""
    query = f"{school_name} {query_suffix}"
    url = f"https://weixin.sogou.com/weixin?type=2&query={urllib.parse.quote(query)}&ie=utf8"

    try:
        r = client.get(url, headers=HEADERS, timeout=15, follow_redirects=True)
        if r.status_code != 200:
            return 0, 0, [], [], [], 0

        snippets = re.findall(r'<p[^>]*>(.*?)</p>', r.text, re.DOTALL)
        total_pos, total_neg = 0, 0
        all_hp, all_hn, quotes = [], [], []
        count = 0

        for s in snippets:
            clean = re.sub(r'<[^>]+>', ' ', s)
            clean = re.sub(r'&[a-z]+;', ' ', clean).strip()
            clean = re.sub(r'\s+', ' ', clean)
            # 只处理含学校名或明显口碑相关词的段落
            if len(clean) < 15:
                continue
            if school_name not in clean and not any(
                w in clean for w in ["就业", "推荐", "吐槽", "感受", "评价", "值得", "后悔"]
            ):
                continue
            count += 1
            p, n, hp, hn = _score_text(clean)
            total_pos += p
            total_neg += n
            all_hp.extend(hp)
            all_hn.extend(hn)
            if (p > 0 or n > 0) and len(quotes) < 4:
                quotes.append(clean[:80])

        return total_pos, total_neg, all_hp, all_hn, quotes, count

    except Exception as e:
        return 0, 0, [], [], [], 0


def scrape_school_reviews(school_name: str, client: httpx.Client, verbose: bool = False) -> dict | None:
    """对单所学校采集口碑数据（两个查询）"""

    queries = [
        "值得报考 学生评价 推荐 吐槽",
        "就读体验 学习氛围 优缺点 怎么样",
    ]

    total_pos, total_neg = 0, 0
    all_hp, all_hn, all_quotes = [], [], []
    total_count = 0

    for q in queries:
        p, n, hp, hn, quotes, cnt = scrape_sogou(school_name, q, client)
        total_pos += p
        total_neg += n
        all_hp.extend(hp)
        all_hn.extend(hn)
        all_quotes.extend(quotes)
        total_count += cnt
        if verbose:
            log.info(f"  [{q[:12]}...] 段落{cnt}, +{p}/-{n}")
        time.sleep(random.uniform(1.0, 1.8))

    if total_count < 2 or (total_pos + total_neg) == 0:
        return None

    sentiment_score = total_pos / (total_pos + total_neg)
    # 去重 quotes
    seen, uniq_quotes = set(), []
    for q in all_quotes:
        if q not in seen:
            seen.add(q)
            uniq_quotes.append(q)

    return {
        "source": "搜狗微信",
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
    """计算每所学校相对于同层次学校的口碑偏差（纠偏参数）"""
    schools_map = {s.name: (s.tier or "普通") for s in db.query(School).all()}
    reviews = db.query(SchoolReview).all()
    if not reviews:
        return

    # 同层次均值
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


def run(limit: int = 300, delay: float = 2.0, school_filter: str = None, verbose: bool = False):
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

    with httpx.Client(verify=False, timeout=20) as client:
        for i, name in enumerate(schools):
            log.info(f"[{i+1}/{len(schools)}] {name}")
            try:
                data = scrape_school_reviews(name, client, verbose)
                if data:
                    write_review(db, name, data)
                    s = data["sentiment_score"]
                    label = "👍" if s > 0.65 else ("⚠️" if s < 0.40 else "😐")
                    log.info(f"  ✅ score={s:.2f} {label} pos={data['positive_count']} neg={data['negative_count']}")
                    ok += 1
                else:
                    log.info(f"  ⚠️ 无有效数据")
                    skip += 1
                time.sleep(delay + random.uniform(0, 0.8))
            except KeyboardInterrupt:
                break
            except Exception as e:
                log.error(f"  ❌ {e}")
                err += 1

    log.info("计算 sentiment_delta...")
    compute_sentiment_delta(db)
    db.close()
    log.info(f"完成: ✅{ok} ⏭{skip} ❌{err}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=300)
    p.add_argument("--delay", type=float, default=2.0)
    p.add_argument("--school", type=str, default=None)
    p.add_argument("--verbose", action="store_true")
    p.add_argument("--compute-delta", action="store_true")
    args = p.parse_args()

    if args.compute_delta:
        db = SessionLocal()
        compute_sentiment_delta(db)
        db.close()
    else:
        run(limit=args.limit, delay=args.delay, school_filter=args.school, verbose=args.verbose)
