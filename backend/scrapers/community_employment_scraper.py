"""
社区就业数据爬虫 — 多源真实数据聚合
===========================================
"""
from __future__ import annotations
"""
数据来源优先级：
  1. 职友集 (jobui.com)   — 求职者自报薪资，按学校聚合，反爬弱
  2. 知乎 (zhihu.com)     — 搜索"学校+就业+薪资"帖子，NLP提取薪资
  3. 应届生论坛 (yingjiesheng.com) — 毕业生真实讨论

数据质量原则：
  - 官方上报数据 → 打折使用（就业率虚报，薪资可能高估）
  - 求职者自报 → 可信度★★★★（无撒谎动机）
  - 论坛NLP提取 → 可信度★★★（抽样，非系统性）
  - 多源一致（差异<20%）→ 标记 confidence=high
  - 单源 → 标记 confidence=medium
  - 无数据 → fallback到层次估算模型，标记 confidence=low

运行方式：
  python3 scrapers/community_employment_scraper.py --limit 200 --delay 2.0
  python3 scrapers/community_employment_scraper.py --school 北京大学 --verbose
"""

import sys
import os
import re
import time
import json
import random
import argparse
import logging

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx
from sqlalchemy.orm import Session
from database import SessionLocal, School, SchoolEmployment

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── 请求配置 ──────────────────────────────────────────────────────────────────
BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
}

# ── 薪资提取正则（覆盖中文薪资表达习惯）─────────────────────────────────────
SALARY_PATTERNS = [
    # 月薪类: "月薪1.5万" "月薪15000" "月入12k" "底薪8000"
    (r"月[薪入收][:：]?\s*(\d+(?:\.\d+)?)\s*[万k千K]", "monthly_wan_k"),
    (r"月[薪入收][:：]?\s*(\d{4,6})\s*[元块]?", "monthly_yuan"),
    (r"底薪\s*(\d+(?:\.\d+)?)\s*[万k千K]", "monthly_wan_k"),
    (r"底薪\s*(\d{4,6})\s*[元块]?", "monthly_yuan"),
    # 平均薪资/月薪，允许"平均值为"等中间词
    (r"(?:平均|签约|起步)?月薪[^0-9\n]{0,10}?(\d+(?:\.\d+)?)\s*[万k千K]", "monthly_wan_k"),
    (r"(?:平均|签约|起步)?月薪[^0-9\n]{0,10}?(\d{4,6})\s*[元块]?", "monthly_yuan"),
    (r"(?:平均|月均)?薪资[^0-9\n]{0,10}?(\d{4,6})\s*[元块]?", "monthly_yuan"),
    (r"薪酬[^0-9\n]{0,6}?(\d{4,6})\s*[元块]?", "monthly_yuan"),
    # 年薪类: "年薪20万" "年包25w" "税前年薪18万"
    (r"年[薪包收入][:：]?\s*(\d+(?:\.\d+)?)\s*[万wW]", "annual_wan"),
    (r"(?:税前|税后)?年薪\s*(\d+(?:\.\d+)?)\s*[万wW]", "annual_wan"),
    # 总包: "总包30w" "offer 28w" "base 20w+5w"
    (r"总包\s*(\d+(?:\.\d+)?)\s*[万wW]", "annual_wan"),
    (r"\boffer\b.*?(\d+(?:\.\d+)?)\s*[万wW]", "annual_wan"),
    # K类: "15k" "18K月薪"
    (r"\b(\d{1,3})[kK]\b", "monthly_k"),
    # 到手: "到手8000" "实发7500"
    (r"(?:到手|实发|税后)\s*(\d{4,5})\s*[元块]?", "monthly_yuan"),
]

def extract_salary_from_text(text: str) -> list[dict]:
    """
    从自然语言文本中提取薪资数据，返回月薪（元）列表，附置信度
    """
    results = []
    text = text.replace(",", "").replace("，", "").replace(" ", "")

    for pattern, stype in SALARY_PATTERNS:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            raw = float(m.group(1))
            if stype == "monthly_wan_k":
                # "1.5万" or "15k"
                if raw < 100:        # 万
                    monthly = int(raw * 10000)
                else:                # k (1k=1000)
                    monthly = int(raw * 1000)
            elif stype == "monthly_yuan":
                monthly = int(raw)
            elif stype == "annual_wan":
                monthly = int(raw * 10000 / 12)
            elif stype == "monthly_k":
                monthly = int(raw * 1000)
            else:
                continue

            # 合理性过滤：月薪2000~100000
            if 2000 <= monthly <= 100000:
                results.append({
                    "monthly": monthly,
                    "raw_match": m.group(0),
                    "type": stype,
                })

    return results


def salary_stats(monthly_list: list[int]) -> dict | None:
    """从薪资列表计算统计值，过滤异常值"""
    if not monthly_list:
        return None
    arr = sorted(monthly_list)
    # IQR法去异常值
    n = len(arr)
    q1, q3 = arr[n // 4], arr[3 * n // 4]
    iqr = q3 - q1
    if iqr > 0:
        arr = [x for x in arr if q1 - 1.5 * iqr <= x <= q3 + 1.5 * iqr]
    if not arr:
        return None
    avg = int(sum(arr) / len(arr))
    median = arr[len(arr) // 2]
    return {"avg": avg, "median": median, "count": len(arr), "min": arr[0], "max": arr[-1]}


# ══════════════════════════════════════════════════════════════════════════════
# 数据源1：职友集 (jobui.com) — 按学校聚合的求职者自报薪资
# ══════════════════════════════════════════════════════════════════════════════

JOBUI_SCHOOL_URL = "https://www.jobui.com/school/{school}/salary/"
JOBUI_SEARCH_URL = "https://www.jobui.com/school/?kw={school}"

def scrape_jobui(school_name: str, client: httpx.Client, verbose: bool = False) -> dict | None:
    """
    职友集学校薪资页。返回 {"avg_salary": int, "sample_count": int, "source": "职友集"}
    或 None（页面无数据 / 学校未收录）
    """
    # 直接尝试学校名URL
    url = JOBUI_SCHOOL_URL.format(school=school_name)
    try:
        r = client.get(url, headers={**BASE_HEADERS, "Referer": "https://www.jobui.com/"}, timeout=12)
        if verbose:
            logger.info(f"[职友集] {school_name}: HTTP {r.status_code}, {len(r.text)} chars")

        if r.status_code != 200:
            return None

        text = r.text

        # 提取平均薪资 —— 职友集展示格式: "平均薪资 ¥12,345/月" 或 JSON嵌入
        salary_matches = re.findall(r'[¥￥]\s*(\d[\d,]+)\s*/月', text)
        if not salary_matches:
            salary_matches = re.findall(r'"avgSalary"\s*:\s*"?(\d+)"?', text)
        if not salary_matches:
            salary_matches = re.findall(r'平均薪资[^0-9]*?(\d[\d,]+)\s*元', text)

        if not salary_matches:
            return None

        raw = salary_matches[0].replace(",", "")
        avg_salary = int(raw)

        # 过滤不合理值
        if not (2000 <= avg_salary <= 80000):
            return None

        # 样本量（可选）
        sample_match = re.search(r'(\d+)\s*个薪资样本|样本量[：:]\s*(\d+)', text)
        sample_count = int(sample_match.group(1) or sample_match.group(2)) if sample_match else 0

        return {
            "avg_salary": avg_salary,
            "sample_count": sample_count,
            "source": "职友集",
            "url": url,
        }

    except Exception as e:
        if verbose:
            logger.warning(f"[职友集] {school_name} 异常: {e}")
        return None


# ══════════════════════════════════════════════════════════════════════════════
# 数据源2：搜狗微信索引 — 微信公众号就业报告/薪资讨论
# （搜狗索引了海量微信公众号，包含大量学校官方就业报告摘要和真实讨论）
# ══════════════════════════════════════════════════════════════════════════════

def scrape_sogou_weixin(school_name: str, client: httpx.Client, verbose: bool = False) -> dict | None:
    """
    搜狗微信搜索："{学校名} 就业 薪资"
    提取公众号文章摘要中的薪资数据（含官方就业报告摘要 + 真实讨论）
    为何可信：微信公众号文章通常来自学校官方或专业媒体，信息质量高
    """
    import urllib.parse
    query = f"{school_name} 毕业生 薪资 就业"
    encoded_q = urllib.parse.quote(query)
    url = f"https://weixin.sogou.com/weixin?type=2&query={encoded_q}&ie=utf8"

    try:
        r = client.get(url, headers={
            **BASE_HEADERS,
            "Referer": "https://weixin.sogou.com/",
        }, timeout=15, follow_redirects=True)

        if verbose:
            logger.info(f"[搜狗微信] {school_name}: HTTP {r.status_code}, {len(r.text)} chars")

        if r.status_code != 200:
            return None

        text = r.text

        # 提取搜索结果摘要（<p>标签内文字）
        snippets = re.findall(r'<p[^>]*>(.*?)</p>', text, re.DOTALL)

        all_salaries = []
        relevant_snippets = 0

        for snippet in snippets:
            clean = re.sub(r'<[^>]+>', ' ', snippet)
            clean = re.sub(r'&[a-z]+;', ' ', clean).strip()

            # 只处理含学校名或就业相关词的段落
            if (school_name in clean or "毕业" in clean or "就业" in clean or "薪资" in clean):
                if len(clean) > 15:
                    relevant_snippets += 1
                    extracted = extract_salary_from_text(clean)
                    all_salaries.extend([e["monthly"] for e in extracted])

        if verbose:
            logger.info(f"  [搜狗微信] 相关段落: {relevant_snippets}, 薪资提取: {len(all_salaries)}")

        stats = salary_stats(all_salaries)
        if not stats or stats["count"] < 2:
            return None

        return {
            "avg_salary": stats["avg"],
            "sample_count": stats["count"],
            "median_salary": stats["median"],
            "source": "搜狗微信",
            "url": url,
        }

    except Exception as e:
        if verbose:
            logger.warning(f"[搜狗微信] {school_name} 异常: {e}")
        return None


# ══════════════════════════════════════════════════════════════════════════════
# 数据源3：应届生论坛 (yingjiesheng.com) — 毕业生就业讨论
# ══════════════════════════════════════════════════════════════════════════════

YINGJIESHENG_URL = "https://search.yingjiesheng.com/?q={query}&type=bbs"

def scrape_yingjiesheng(school_name: str, client: httpx.Client, verbose: bool = False) -> dict | None:
    """
    应届生论坛搜索：提取毕业生真实就业薪资讨论
    """
    import urllib.parse
    query = f"{school_name} 薪资 offer 月薪"
    url = f"https://search.yingjiesheng.com/?q={urllib.parse.quote(query)}&type=bbs"

    try:
        r = client.get(url, headers={**BASE_HEADERS, "Referer": "https://bbs.yingjiesheng.com/"}, timeout=12)
        if verbose:
            logger.info(f"[应届生] {school_name}: HTTP {r.status_code}, {len(r.text)} chars")

        if r.status_code != 200:
            return None

        text = r.text
        # 提取搜索结果摘要
        snippets = re.findall(r'<(?:p|div)[^>]*class="[^"]*(?:summary|desc|content|snippet)[^"]*"[^>]*>(.*?)</(?:p|div)>', text, re.DOTALL | re.IGNORECASE)
        if not snippets:
            # fallback: 提取所有段落
            snippets = re.findall(r'<p>(.*?)</p>', text, re.DOTALL)

        all_salaries = []
        for snippet in snippets:
            clean = re.sub(r'<[^>]+>', ' ', snippet)
            if school_name in clean or len(clean) < 200:
                extracted = extract_salary_from_text(clean)
                all_salaries.extend([e["monthly"] for e in extracted])

        stats = salary_stats(all_salaries)
        if not stats or stats["count"] < 2:
            return None

        return {
            "avg_salary": stats["avg"],
            "sample_count": stats["count"],
            "source": "应届生论坛",
            "url": url,
        }

    except Exception as e:
        if verbose:
            logger.warning(f"[应届生] {school_name} 异常: {e}")
        return None


# ══════════════════════════════════════════════════════════════════════════════
# 数据质量评估：多源交叉验证
# ══════════════════════════════════════════════════════════════════════════════

def cross_validate(results: list[dict]) -> dict | None:
    """
    多源数据交叉验证：
    - 2+源一致（差异<25%）→ confidence=high，取加权均值
    - 单源 → confidence=medium
    - 0源 → None
    """
    if not results:
        return None

    salaries = [r["avg_salary"] for r in results]

    if len(results) == 1:
        return {
            **results[0],
            "confidence": "medium",
            "cross_validated": False,
        }

    # 检查最大差异
    mn, mx = min(salaries), max(salaries)
    divergence = (mx - mn) / mn if mn > 0 else 1.0

    if divergence <= 0.25:
        # 一致性高 → 加权均值（样本量大的权重高）
        total_weight = sum(r.get("sample_count", 1) or 1 for r in results)
        weighted_avg = int(sum(
            r["avg_salary"] * (r.get("sample_count", 1) or 1)
            for r in results
        ) / total_weight)
        sources = "+".join(r["source"] for r in results)
        return {
            "avg_salary": weighted_avg,
            "sample_count": sum(r.get("sample_count", 0) for r in results),
            "source": sources,
            "confidence": "high",
            "cross_validated": True,
            "divergence_pct": round(divergence * 100, 1),
        }
    else:
        # 差异>25%：取中位数，降低置信度
        median_salary = sorted(salaries)[len(salaries) // 2]
        sources = "+".join(r["source"] for r in results)
        logger.warning(f"  多源差异 {divergence*100:.0f}%: {[(r['source'], r['avg_salary']) for r in results]}")
        return {
            "avg_salary": median_salary,
            "sample_count": sum(r.get("sample_count", 0) for r in results),
            "source": sources,
            "confidence": "medium",
            "cross_validated": True,
            "divergence_pct": round(divergence * 100, 1),
            "note": f"多源差异较大({divergence*100:.0f}%)，取中位值",
        }


# ══════════════════════════════════════════════════════════════════════════════
# 主函数：爬取并写入DB
# ══════════════════════════════════════════════════════════════════════════════

def scrape_school(school_name: str, client: httpx.Client, verbose: bool = False) -> dict | None:
    """
    对单所学校进行多源爬取 + 交叉验证
    返回最终就业数据 dict 或 None
    """
    source_results = []

    # 源1：职友集（反爬最弱，优先）
    jobui_result = scrape_jobui(school_name, client, verbose)
    if jobui_result:
        source_results.append(jobui_result)
        if verbose:
            logger.info(f"  [✓职友集] 月薪 {jobui_result['avg_salary']}")

    time.sleep(random.uniform(0.5, 1.2))

    # 源2：搜狗微信（公众号就业报告摘要 + 真实讨论，覆盖面广）
    sogou_result = scrape_sogou_weixin(school_name, client, verbose)
    if sogou_result:
        source_results.append(sogou_result)
        if verbose:
            logger.info(f"  [✓搜狗微信] 月薪 {sogou_result['avg_salary']} (n={sogou_result['sample_count']})")

    time.sleep(random.uniform(0.5, 1.5))

    # 源3：应届生（论坛NLP，仅当前两源都没有结果时尝试）
    if len(source_results) < 2:
        yjs_result = scrape_yingjiesheng(school_name, client, verbose)
        if yjs_result:
            source_results.append(yjs_result)
            if verbose:
                logger.info(f"  [✓应届生] 月薪 {yjs_result['avg_salary']}")

    return cross_validate(source_results)


def write_to_db(db: Session, school_name: str, data: dict, year: int = 2024) -> bool:
    """
    将爬取结果写入 school_employment 表
    若已有高质量数据（官方报告）则跳过
    """
    existing = db.query(SchoolEmployment).filter(
        SchoolEmployment.school_name == school_name,
        SchoolEmployment.year == year,
    ).first()

    # 优先级：官方报告 > 多源高置信 > 单源medium > 估算模型
    SKIP_SOURCES = {"官方就业质量报告", "official_report"}
    if existing and any(s in (existing.data_source or "") for s in SKIP_SOURCES):
        logger.info(f"  跳过 {school_name}（已有官方报告数据）")
        return False

    # 数据合理性验证（防止NLP误提取）
    avg_salary = data.get("avg_salary", 0)
    if not (2000 <= avg_salary <= 60000):
        logger.warning(f"  {school_name} 薪资 {avg_salary} 超出合理范围，跳过")
        return False

    confidence = data.get("confidence", "medium")
    source = data.get("source", "社区数据")
    # 为数据来源添加置信度标注
    source_label = f"{source}(置信:{confidence})"
    if data.get("cross_validated"):
        source_label += f"[多源验证,差异{data.get('divergence_pct', 0)}%]"

    if existing:
        # 只在新数据质量更高时覆盖
        if existing.data_source and "估算" in existing.data_source:
            existing.avg_salary = avg_salary
            existing.data_source = source_label
            existing.report_url = data.get("url", "")
            db.commit()
            return True
        else:
            logger.info(f"  {school_name} 已有数据({existing.data_source})，跳过覆盖")
            return False
    else:
        record = SchoolEmployment(
            school_name=school_name,
            year=year,
            avg_salary=avg_salary,
            employment_rate=0.0,   # 社区数据难以获取就业率，留空
            data_source=source_label,
            report_url=data.get("url", ""),
        )
        db.add(record)
        db.commit()
        return True


def run(limit: int = 100, delay: float = 2.0, school_filter: str = None,
        verbose: bool = False, dry_run: bool = False):
    """主爬取流程"""
    db = SessionLocal()

    # 获取学校列表（优先处理有录取记录的学校）
    from sqlalchemy import text
    if school_filter:
        schools = [school_filter]
    else:
        result = db.execute(text("""
            SELECT DISTINCT s.name
            FROM schools s
            WHERE NOT EXISTS (
                SELECT 1 FROM school_employment se
                WHERE se.school_name = s.name
                AND se.data_source NOT LIKE '%估算%'
            )
            ORDER BY s.tier, s.name
            LIMIT :limit
        """), {"limit": limit})
        schools = [row[0] for row in result]

    logger.info(f"待爬取学校：{len(schools)} 所")

    success, skipped, failed = 0, 0, 0

    with httpx.Client(http2=False, verify=False, timeout=20) as client:
        for i, school_name in enumerate(schools):
            logger.info(f"[{i+1}/{len(schools)}] {school_name}")
            try:
                data = scrape_school(school_name, client, verbose)

                if data:
                    if dry_run:
                        logger.info(f"  [DRY-RUN] 结果: {data}")
                        success += 1
                    else:
                        written = write_to_db(db, school_name, data)
                        if written:
                            success += 1
                            logger.info(f"  ✅ 写入: 月薪={data['avg_salary']}, "
                                        f"来源={data['source']}, 置信={data.get('confidence')}")
                        else:
                            skipped += 1
                else:
                    logger.info(f"  ⚠️ 无数据（所有源均失败）")
                    failed += 1

                # 礼貌等待
                time.sleep(delay + random.uniform(0, 1.0))

            except KeyboardInterrupt:
                logger.info("用户中断")
                break
            except Exception as e:
                logger.error(f"  ❌ {school_name} 爬取异常: {e}")
                failed += 1

    db.close()
    logger.info(f"\n{'='*50}")
    logger.info(f"完成: ✅{success} 写入 | ⏭️{skipped} 跳过 | ❌{failed} 失败")
    logger.info(f"{'='*50}")


# ══════════════════════════════════════════════════════════════════════════════
# CLI 入口
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="社区就业数据爬虫（多源验证）")
    parser.add_argument("--limit", type=int, default=100, help="最多爬取学校数")
    parser.add_argument("--delay", type=float, default=2.0, help="请求间隔秒数（礼貌等待）")
    parser.add_argument("--school", type=str, default=None, help="只爬取指定学校")
    parser.add_argument("--verbose", action="store_true", help="详细输出")
    parser.add_argument("--dry-run", action="store_true", help="只打印不写DB")
    parser.add_argument("--test-extract", type=str, default=None,
                        help="测试薪资提取正则: --test-extract '月薪1.5万，年薪20w'")
    args = parser.parse_args()

    if args.test_extract:
        results = extract_salary_from_text(args.test_extract)
        print("提取结果:", results)
        stats = salary_stats([r["monthly"] for r in results])
        print("统计:", stats)
    else:
        run(
            limit=args.limit,
            delay=args.delay,
            school_filter=args.school,
            verbose=args.verbose,
            dry_run=args.dry_run,
        )
