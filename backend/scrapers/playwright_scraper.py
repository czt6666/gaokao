"""
基于 Playwright 的高考录取数据爬虫
目标：录取数据平台
特点：能处理 JS 渲染、自动等待、随机延迟

用法：
  python3 scrapers/playwright_scraper.py --province 广东 --years 2022,2023,2024
  python3 scrapers/playwright_scraper.py --test  (测试模式，爬取前5所学校)
  python3 scrapers/playwright_scraper.py --province 广东 --years 2024 --test
"""

import asyncio, sys, os, time, json, random, argparse, re
from typing import List, Dict, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from database import SessionLocal, AdmissionRecord, School, init_db

# ── 省份 ID 映射 ──────────────────────────────────────────────
PROVINCE_IDS = {
    "北京": 11, "天津": 12, "河北": 13, "山西": 14, "内蒙古": 15,
    "辽宁": 21, "吉林": 22, "黑龙江": 23,
    "上海": 31, "江苏": 32, "浙江": 33, "安徽": 34, "福建": 35, "江西": 36, "山东": 37,
    "河南": 41, "湖北": 42, "湖南": 43, "广东": 44, "广西": 45, "海南": 46,
    "重庆": 50, "四川": 51, "贵州": 52, "云南": 53,
    "陕西": 61, "甘肃": 62, "青海": 63, "宁夏": 64, "新疆": 65,
}

# 批次 ID
BATCH_IDS = {
    "本科提前批": 1, "国家专项": 2, "地方专项": 3, "高职专科": 5,
    "本科批": 14, "本科一批": 15, "本科二批": 16, "物理类": 14, "历史类": 14,
}

def log(msg): print(f"  [Playwright] {msg}")


async def js_click_province(page, province: str) -> bool:
    """
    使用 JavaScript evaluate 点击省份选项卡，绕过导航栏拦截指针事件的问题。
    返回 True 表示点击成功。
    """
    result = await page.evaluate(f"""
        () => {{
            const target = '{province}';

            // 策略1: 标准 CSS Modules 类名（已探明）
            const byModule = document.querySelectorAll(
                '[class*="province-switch"] [class*="item"], ' +
                '[class*="provinceSwitch"] [class*="item"], ' +
                '[class*="province_switch"] [class*="item"]'
            );
            for (const el of byModule) {{
                if (el.textContent.trim() === target) {{
                    el.click();
                    return 'module:' + el.className;
                }}
            }}

            // 策略2: data 属性
            const byData = document.querySelectorAll(
                '[data-province], [data-province-name], [data-name]'
            );
            for (const el of byData) {{
                const name = el.dataset.province || el.dataset.provinceName || el.dataset.name || '';
                if (name === target || el.textContent.trim() === target) {{
                    el.click();
                    return 'data:' + el.className;
                }}
            }}

            // 策略3: 找所有文本精确匹配省份名的可点击元素
            const allClickable = document.querySelectorAll('li, span, div, a, button');
            for (const el of allClickable) {{
                if (el.children.length === 0 && el.textContent.trim() === target) {{
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {{
                        el.click();
                        return 'text:' + el.tagName + ':' + el.className;
                    }}
                }}
            }}

            return null;
        }}
    """)
    if result:
        log(f"  省份点击成功 ({result})")
        return True
    return False


async def js_click_year(page, year: int) -> bool:
    """使用 JavaScript evaluate 点击年份选项卡"""
    result = await page.evaluate(f"""
        () => {{
            const target = '{year}';

            // 策略1: 年份相关 class（CSS Modules，先宽泛再精确）
            const byClass = document.querySelectorAll(
                '[class*="year"] [class*="item"], ' +
                '[class*="Year"] [class*="item"], ' +
                '[class*="tab"] [class*="item"], ' +
                '[class*="year-switch"] li, ' +
                '[class*="yearSwitch"] li, ' +
                '[class*="year_switch"] li, ' +
                '[class*="year-tab"] li, ' +
                '[class*="yearTab"] li'
            );
            for (const el of byClass) {{
                if (el.textContent.trim().includes(target)) {{
                    el.click();
                    return 'class:' + el.className;
                }}
            }}

            // 策略2: 找包含年份数字的可点击元素（更宽泛）
            const allClickable = document.querySelectorAll('li, span, div, a, button');
            for (const el of allClickable) {{
                const txt = el.textContent.trim();
                if ((txt === target || txt === target + '年') && el.children.length <= 1) {{
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {{
                        el.click();
                        return 'text:' + el.tagName + ':' + el.className.slice(0, 30);
                    }}
                }}
            }}

            // 策略3: 调试 — 返回所有含年份文字的元素 class（帮助诊断）
            const debug = [];
            document.querySelectorAll('li, span, button').forEach(el => {{
                if (el.textContent.trim().match(/^202[0-9]/) && el.children.length <= 1) {{
                    debug.push(el.className.slice(0, 40) + ':' + el.textContent.trim());
                }}
            }});
            if (debug.length) return 'DEBUG:' + debug.slice(0,3).join('|');

            return null;
        }}
    """)
    if result:
        log(f"  年份点击成功 ({result})")
        return True
    return False


async def extract_score_table(page) -> List[List[str]]:
    """
    从页面提取录取分数表格数据。
    返回二维数组：[[专业名, 最低分, 最低位次, ...], ...]
    """
    return await page.evaluate("""
        () => {
            const results = [];

            // 尝试多种选择器
            const rowSelectors = [
                'tbody tr',
                '[class*="score-item"]',
                '[class*="scoreItem"]',
                '[class*="major-item"]',
                '[class*="majorItem"]',
                '[class*="list-item"]',
                '[class*="listItem"]',
                '[class*="ScoreItem"]',
                '[class*="score_item"]',
                '[class*="major_item"]',
                '[class*="row_item"]',
                '[class*="rowItem"]',
            ];

            let rows = [];
            for (const sel of rowSelectors) {
                const found = document.querySelectorAll(sel);
                if (found.length > 1) {
                    rows = found;
                    break;
                }
            }

            for (const row of rows) {
                // 找单元格
                const cellSelectors = [
                    'td',
                    '[class*="cell"]',
                    '[class*="Cell"]',
                    '[class*="col"]',
                    '[class*="Col"]',
                    'span',
                ];
                let cells = [];
                for (const sel of cellSelectors) {
                    const found = row.querySelectorAll(sel);
                    if (found.length >= 3) {
                        cells = found;
                        break;
                    }
                }

                if (cells.length < 3) continue;

                const texts = Array.from(cells).map(c => c.textContent.trim());
                if (!texts.some(t => /\d/.test(t))) continue;  // 必须含数字

                results.push(texts);
            }

            return results;
        }
    """)


async def resolve_school_id(page, school_name: str) -> Optional[int]:
    """通过学校名搜索 gaokao.cn 获取 school_id"""
    try:
        url = f"https://www.gaokao.cn/school/index?name={school_name}"
        await page.goto(url, wait_until="domcontentloaded", timeout=20000)
        await page.wait_for_timeout(1500)
        school_id = await page.evaluate("""
            () => {
                const links = document.querySelectorAll('a[href*="/school/"]');
                for (const l of links) {
                    const m = l.getAttribute('href')?.match(/\\/school\\/(\\d+)/);
                    if (m && parseInt(m[1]) > 0) return parseInt(m[1]);
                }
                return null;
            }
        """)
        return school_id
    except Exception:
        return None


async def scrape_school_admission(
    page,
    school_id: int,
    school_name: str,
    province: str,
    province_id: int,
    year: int,
) -> List[Dict]:
    """爬取单个学校在某省的录取数据"""
    # 若无 school_id，尝试通过搜索页解析
    if not school_id:
        school_id = await resolve_school_id(page, school_name)
        if not school_id:
            log(f"  {school_name}: 无法解析 school_id，跳过")
            return []

    url = f"https://www.gaokao.cn/school/{school_id}/provincescore"
    records = []

    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(random.randint(2000, 3000))

        # ── 步骤1：点击目标省份选项卡（点击后等待导航/更新）─────────
        province_ok = await js_click_province(page, province)
        if not province_ok:
            log(f"  {school_name}: 未找到省份选项卡 [{province}]，跳过")
            return []

        # 等待页面稳定（省份点击可能触发导航或 AJAX 更新）
        try:
            await page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            await page.wait_for_timeout(2000)

        # ── 步骤2：点击目标年份选项卡 ─────────────────────────────
        year_ok = await js_click_year(page, year)
        if not year_ok:
            log(f"  {school_name}: 未找到年份选项卡 [{year}]，尝试使用默认年份")

        # 等待年份切换后数据加载
        try:
            await page.wait_for_load_state("networkidle", timeout=6000)
        except Exception:
            await page.wait_for_timeout(1500)

        # ── 步骤3：提取数据 ───────────────────────────────────────
        rows_data = await extract_score_table(page)

        if not rows_data:
            log(f"  {school_name}: 无数据行")
            return []

        for texts in rows_data:
            if not texts:
                continue
            major_name = texts[0]
            min_score = 0
            min_rank = 0

            for text in texts[1:]:
                text = text.strip().replace(",", "").replace("，", "")
                if re.match(r"^\d+$", text):
                    val = int(text)
                    if 100 <= val <= 750:
                        min_score = val
                    elif val > 750:
                        min_rank = val

            # 过滤表头行和无效行
            if major_name in ["专业名称", "专业", "院校专业", ""] :
                continue
            if min_score == 0 and min_rank == 0:
                continue

            records.append({
                "school_name": school_name,
                "school_id": school_id,
                "major_name": major_name,
                "province": province,
                "year": year,
                "min_score": min_score,
                "min_rank": min_rank,
                "admit_count": 0,
                "batch": "本科批",
                "subject_req": "",
            })

    except Exception as e:
        log(f"  爬取 {school_name} 出错: {e}")

    return records


async def get_school_list_from_cdn() -> List[Dict]:
    """
    获取全国学校 ID 列表
    """
    import aiohttp, ssl
    url = "https://static-data.gaokao.cn/www/2.0/school/school_code.json"
    schools = []
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE
    try:
        connector = aiohttp.TCPConnector(ssl=ssl_ctx)
        async with aiohttp.ClientSession(connector=connector) as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status == 200:
                    data = await resp.json(content_type=None)
                    # 格式: {"code":"0000","data":{"112002700":{"school_id":"30","name":"北京工业大学"},...}}
                    items = data.get("data", data) if isinstance(data, dict) else data
                    if isinstance(items, dict):
                        for _, v in items.items():
                            if isinstance(v, dict):
                                sid = v.get("school_id") or v.get("id")
                                name = v.get("name") or v.get("school_name", "")
                                if sid and name:
                                    schools.append({"id": int(sid), "name": name})
                    elif isinstance(items, list):
                        for item in items:
                            if isinstance(item, dict):
                                sid = item.get("school_id") or item.get("id")
                                name = item.get("name") or item.get("school_name", "")
                                if sid and name:
                                    schools.append({"id": int(sid), "name": name})
                    log(f"  CDN 学校列表: {len(schools)} 所")
    except Exception as e:
        log(f"  CDN 获取失败: {e}")
    return schools


async def get_school_list_from_db() -> List[Dict]:
    """从本地数据库获取学校列表，再通过 CDN 匹配 gaokao ID"""
    db = SessionLocal()
    try:
        schools_db = db.query(School).filter(School.tier.in_(["985", "211", "双一流"])).all()
        return [{"id": 0, "name": s.name} for s in schools_db]
    finally:
        db.close()


async def get_school_list_from_page(page, province_id: int, year: int) -> List[Dict]:
    """获取某省招生学校列表（备用）"""
    url = f"https://www.gaokao.cn/school/index?province_id={province_id}&year={year}&page=1"
    schools = []

    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)

        # 等待学校列表加载
        try:
            await page.wait_for_selector(
                "[class*='school-item'], [class*='schoolItem'], .school-list li",
                timeout=10000
            )
        except:
            log("  学校列表加载超时")
            return []

        # 从 DOM 提取学校 ID 和名称
        schools_raw = await page.evaluate("""
            () => {
                const results = [];
                const links = document.querySelectorAll('a[href*="/school/"]');
                for (const link of links) {
                    const href = link.getAttribute('href') || '';
                    const m = href.match(/\\/school\\/(\\d+)/);
                    if (m) {
                        const name = link.textContent.trim();
                        if (name && name.length > 1) {
                            results.push({id: parseInt(m[1]), name: name});
                        }
                    }
                }
                return results;
            }
        """)

        seen = set()
        for s in schools_raw:
            if s["id"] not in seen and s["id"] > 0:
                seen.add(s["id"])
                schools.append(s)

        log(f"  页面获取学校: {len(schools)} 所")

    except Exception as e:
        log(f"  获取学校列表出错: {e}")

    return schools


def save_records_to_db(records: List[Dict], province: str) -> int:
    """保存录取记录到数据库"""
    if not records:
        return 0

    db = SessionLocal()
    inserted = 0
    try:
        for rec in records:
            if not rec.get("school_name") or not rec.get("major_name"):
                continue
            if rec.get("min_rank", 0) <= 0 and rec.get("min_score", 0) <= 0:
                continue

            exists = db.query(AdmissionRecord).filter(
                AdmissionRecord.school_name == rec["school_name"],
                AdmissionRecord.major_name == rec["major_name"],
                AdmissionRecord.province == province,
                AdmissionRecord.year == rec["year"],
            ).first()
            if exists:
                continue

            school_info = db.query(School).filter(School.name == rec["school_name"]).first()
            ar = AdmissionRecord(
                school_name=rec["school_name"],
                school_code=str(rec.get("school_id", "")),
                major_name=rec["major_name"],
                province=province,
                year=rec["year"],
                min_score=rec.get("min_score", 0),
                min_rank=rec.get("min_rank", 0),
                admit_count=rec.get("admit_count", 0),
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
        log(f"  DB 写入出错: {e}")
        db.rollback()
    finally:
        db.close()

    return inserted


async def run_scraper(province: str, years: List[int], test_mode: bool = False, storage_state: Optional[str] = None):
    """主爬虫入口"""
    from playwright.async_api import async_playwright

    if province not in PROVINCE_IDS:
        print(f"❌ 未知省份: {province}")
        return

    province_id = PROVINCE_IDS[province]
    init_db()

    print(f"\n{'='*50}")
    print(f"  开始爬取: {province} ({years})")
    print(f"  模式: {'测试（前5所）' if test_mode else '完整'}")
    if storage_state:
        print(f"  会话: {storage_state}")
    print(f"{'='*50}\n")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled"]
        )
        ctx_kwargs = dict(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900},
            locale="zh-CN",
        )
        if storage_state and os.path.exists(storage_state):
            ctx_kwargs["storage_state"] = storage_state
        context = await browser.new_context(**ctx_kwargs)

        # 隐藏自动化痕迹
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            window.chrome = {runtime: {}};
        """)

        page = await context.new_page()
        total_records = 0

        # ── 获取学校列表（优先 CDN，无网络则用 DB）───────────────
        log("获取学校列表（CDN）...")
        schools = await get_school_list_from_cdn()

        if not schools:
            log("CDN 获取失败，尝试页面获取...")
            schools = await get_school_list_from_page(page, province_id, years[0])

        if not schools:
            log("页面获取失败，使用本地 DB 学校名（无 ID，将尝试搜索匹配）...")
            schools = await get_school_list_from_db()

        if test_mode:
            schools = schools[:5]

        log(f"共 {len(schools)} 所学校待处理")

        for year in years:
            log(f"\n── 年份: {year} ──")
            year_records = 0

            for i, school in enumerate(schools):
                log(f"[{i+1}/{len(schools)}] {school['name']} (ID:{school['id']})")

                records = await scrape_school_admission(
                    page, school["id"], school["name"],
                    province, province_id, year
                )

                if records:
                    n = save_records_to_db(records, province)
                    log(f"  → 插入 {n}/{len(records)} 条")
                    year_records += n
                    total_records += n

                # 随机延迟，避免触发限速
                await page.wait_for_timeout(random.randint(2000, 4000))

            log(f"  年份 {year} 完成，插入 {year_records} 条")

        await browser.close()

    print(f"\n✅ 爬取完成！共插入 {total_records} 条录取记录")
    return total_records


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="录取数据 Playwright 爬虫")
    parser.add_argument("--province", type=str, default="广东", help="省份，如：广东")
    parser.add_argument("--years", type=str, default="2022,2023,2024", help="年份（逗号分隔）")
    parser.add_argument("--test", action="store_true", help="测试模式（只爬前5所学校）")
    parser.add_argument("--storage-state", type=str, default="", help="浏览器 storage_state JSON 文件路径（VIP 会话）")
    args = parser.parse_args()

    years = [int(y.strip()) for y in args.years.split(",")]
    asyncio.run(run_scraper(args.province, years, args.test, args.storage_state or None))
