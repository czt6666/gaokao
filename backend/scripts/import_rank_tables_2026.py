"""
2026年 全国一分一段表 抓取+入库脚本
数据源：中国教育在线 gaokao.eol.cn 「26年各地一分一段表」汇总页 + 首页

与 2025 版的区别：
  - 不再硬编码每省 URL，而是从 eol.cn 汇总页自动发现 (省, 科类) -> URL。
    原因：2026 数据陆续发布（部分省份要到 7 月初才出），硬编码当天必然不全；
    自动发现可每天重跑、增量补齐新发布省份。
  - 复用 2025 版已验证的解析/入库逻辑（parse_eol_tables / upsert_rows）。
  - 2026 汇总页已按 物理类/历史类 拆成独立链接，无需再猜「汇总页拆表」。

工作流（数据未集齐前不直接入库）：
  - 默认：抓取 + 解析，把每省结果暂存到 git 不跟踪的 staging 目录
    （backend/data/rank_2026_staging/，data/ 已在 .gitignore）。
    不写库——避免 app 按 MAX(year) 选到「不完整的 2026 表」导致位次换算错误。
  - 每天重跑补齐新发布省份；staging 里按 (省,科类) 去重覆盖。
  - 等 30 省集齐后，用 --import-db 从 staging 一次性统一入库。

用法：
  python scripts/import_rank_tables_2026.py            # 抓取 + 解析 → 暂存到 staging（不入库）
  python scripts/import_rank_tables_2026.py --list     # 只发现并打印 URL，不抓取
  python scripts/import_rank_tables_2026.py --province 山东   # 只处理某省
  python scripts/import_rank_tables_2026.py --force    # 忽略 HTML 缓存重抓
  python scripts/import_rank_tables_2026.py --status   # 查看 staging 已暂存哪些省
  python scripts/import_rank_tables_2026.py --import-db # 数据集齐后：staging → 统一入库
"""
import sys, os, re, time, argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, os.path.dirname(__file__))
sys.stdout.reconfigure(encoding="utf-8")

import json
import requests
from database import SessionLocal, init_db
# 复用 2025 版的纯解析与入库逻辑（year 是入参，可直接传 2026）
from import_rank_tables_2025 import parse_eol_tables, upsert_rows

YEAR = 2026
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "rank_2026_cache")
# 中间资料暂存目录：git 不跟踪（backend/data/ 已在 .gitignore）。
# 数据集齐前只暂存到这里，不入库；集齐后用 --import-db 统一导入。
STAGING_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "rank_2026_staging")
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(STAGING_DIR, exist_ok=True)

# 发现入口：汇总页 + 首页（互为补充，部分省份只在其一出现，如海南走 /news/ 路径）
DISCOVER_PAGES = [
    "https://www.eol.cn/e_html/gk/gkfsd/index.shtml",
    "https://gaokao.eol.cn/",
]

# 全国 31 省（含直辖市/自治区），用于从锚文本里识别省份
PROVINCES = [
    "北京", "天津", "上海", "重庆", "河北", "河南", "山西", "山东", "江苏", "浙江",
    "安徽", "福建", "江西", "湖北", "湖南", "广东", "广西", "海南", "四川", "贵州",
    "云南", "陕西", "甘肃", "青海", "宁夏", "内蒙古", "黑龙江", "辽宁", "吉林",
    "新疆", "西藏",
]


def _category_from_text(text: str) -> str:
    """从锚文本判断科类：物理类 / 历史类 / 综合（不分文理或新高考综合）。"""
    if "物理" in text:
        return "物理类"
    if "历史" in text:
        return "历史类"
    if "理科" in text:
        return "理科"
    if "文科" in text:
        return "文科"
    return "综合"


def _province_from_text(text: str) -> str | None:
    """从锚文本识别省份名（按名匹配，避免依赖 URL slug，兼容海南 /news/ 路径）。"""
    for p in PROVINCES:
        if p in text:
            return p
    return None


def discover() -> dict:
    """扫描发现页，返回 {(省, 科类): url}。只收 2026 的一分一段链接。"""
    sources: dict = {}
    for page in DISCOVER_PAGES:
        try:
            r = requests.get(page, headers={"User-Agent": UA}, timeout=20)
            r.encoding = r.apparent_encoding
        except Exception as e:
            print(f"  ⚠ 发现页抓取失败 {page}: {e}")
            continue
        for m in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*>([^<]*一分一段[^<]*)</a>', r.text):
            href, txt = m.group(1).strip(), m.group(2).strip()
            href = re.sub(r"^\./", "https://gaokao.eol.cn/", href)
            # 仅 2026 链接（日期目录 2026xx）
            if "2026" not in href:
                continue
            prov = _province_from_text(txt)
            if not prov:
                continue
            cat = _category_from_text(txt)
            sources.setdefault((prov, cat), href)  # 先到先得，多页去重
    return sources


def fetch(url: str, force: bool = False) -> str:
    """带本地缓存的 HTTP GET（2026 独立缓存目录）。"""
    cache_key = re.sub(r"[^\w]", "_", url)[-120:] + ".html"
    cache_path = os.path.join(CACHE_DIR, cache_key)
    if not force and os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            return f.read()
    r = requests.get(url, headers={"User-Agent": UA}, timeout=30)
    r.encoding = r.apparent_encoding
    with open(cache_path, "w", encoding="utf-8") as f:
        f.write(r.text)
    return r.text


# ── staging 暂存（git 不跟踪）────────────────────────────────────
def _staging_path(province: str, category: str) -> str:
    safe = re.sub(r"[^\w]", "_", f"{province}_{category}")
    return os.path.join(STAGING_DIR, f"{safe}.json")


def save_staging(province: str, category: str, url: str, rows: list) -> str:
    """把某 (省,科类) 的解析结果写入 staging（覆盖式，重跑即更新）。"""
    path = _staging_path(province, category)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({
            "province": province, "category": category, "year": YEAR,
            "url": url, "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "row_count": len(rows), "rows": rows,
        }, f, ensure_ascii=False, indent=2)
    return path


def load_staging() -> list[dict]:
    """读取 staging 下全部已暂存的 (省,科类) 数据。"""
    out = []
    for fn in sorted(os.listdir(STAGING_DIR)):
        if not fn.endswith(".json"):
            continue
        with open(os.path.join(STAGING_DIR, fn), "r", encoding="utf-8") as f:
            out.append(json.load(f))
    return out


def show_status():
    """打印 staging 已暂存哪些省/科类，以及还差哪些省。"""
    staged = load_staging()
    print(f"staging 目录：{os.path.relpath(STAGING_DIR)}")
    print(f"已暂存 {len(staged)} 条 / {len({d['province'] for d in staged})} 省：")
    for d in staged:
        print(f"  {d['province']:6s} {d['category']:6s} {d['row_count']:>4d} 行  ({d['fetched_at']})  {d['url']}")
    have = {d["province"] for d in staged}
    missing = [p for p in PROVINCES if p not in have]
    print(f"\n还缺：{'、'.join(missing) if missing else '（无，已集齐）'}")


# ── 默认流程：抓取 + 解析 → 暂存（不入库）──────────────────────
def run_scrape(province_filter: str | None, force: bool):
    sources = discover()
    sources = dict(sorted(sources.items(), key=lambda kv: (PROVINCES.index(kv[0][0]), kv[0][1])))
    print(f"发现 {len({p for (p, _) in sources})} 省 / {len(sources)} 条 2026 一分一段链接")

    summary = []
    for (province, category), url in sources.items():
        if province_filter and province != province_filter:
            continue
        print(f"\n▶ {province:6s} / {category:6s}  {url}")
        try:
            html = fetch(url, force=force)
            tables = parse_eol_tables(html)
        except Exception as e:
            print(f"  ❌ 抓取失败: {e}")
            summary.append((province, category, 0, "fetch-error"))
            continue
        if not tables:
            print("  ⚠ 无可识别表格（多为图片/PDF附件，如北京）")
            summary.append((province, category, 0, "no-table"))
            continue
        rows = tables[0]
        if len(tables) > 1:
            print(f"  ⚠ 该链接解析出 {len(tables)} 张表，仅取第 1 张（科类={category}），请人工核对")
        path = save_staging(province, category, url, rows)
        print(f"  ✅ 解析 {len(rows)} 行 → 暂存 {os.path.relpath(path)}")
        summary.append((province, category, len(rows), "staged"))
        time.sleep(0.5)

    print("\n" + "=" * 60)
    print(f"{'省份':8s}{'科类':8s}{'行数':>8s}  状态")
    print("-" * 60)
    for prov, cat, n, status in summary:
        print(f"{prov:8s}{cat:8s}{n:>8d}  {status}")
    ok_provs = {p for (p, c, n, s) in summary if s == "staged"}
    missing = [p for p in PROVINCES if p not in {pp for (pp, _) in sources}]
    print(f"\n本次暂存 {len([s for s in summary if s[3]=='staged'])} 项 / 累计 {len({d['province'] for d in load_staging()})} 省在 staging")
    print(f"尚未发布/未发现：{'、'.join(missing)}")
    print("数据集齐后执行：python scripts/import_rank_tables_2026.py --import-db")


# ── 统一入库：staging → DB（数据集齐后再跑）─────────────────────
def run_import_db():
    staged = load_staging()
    if not staged:
        print("staging 为空，先跑默认抓取暂存。")
        return
    have = {d["province"] for d in staged}
    missing = [p for p in PROVINCES if p not in have]
    if missing:
        print(f"⚠ 注意：staging 仍缺 {len(missing)} 省（{'、'.join(missing)}）。")
        print("  app 按 MAX(year) 选表，入库不完整的 2026 会影响这些省外的换算。")
        ans = input("  仍要现在统一入库吗？(yes/N) ").strip().lower()
        if ans not in ("y", "yes"):
            print("已取消。"); return

    init_db()
    db = SessionLocal()
    total = 0
    print(f"{'省份':8s}{'科类':8s}{'写入':>8s}")
    print("-" * 40)
    for d in staged:
        n = upsert_rows(db, d["rows"], d["province"], YEAR, d["category"])
        total += n
        print(f"{d['province']:8s}{d['category']:8s}{n:>8d}")
    db.close()
    print(f"\n共 {len(staged)} 项 / {len(have)} 省，统一入库 {total} 行（year={YEAR}）")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--province", default=None)
    p.add_argument("--force", action="store_true", help="忽略 HTML 缓存重抓")
    p.add_argument("--list", dest="list_only", action="store_true", help="只发现并打印 URL，不抓取")
    p.add_argument("--status", action="store_true", help="查看 staging 已暂存情况")
    p.add_argument("--import-db", dest="import_db", action="store_true", help="数据集齐后：staging → 统一入库")
    args = p.parse_args()

    if args.list_only:
        srcs = discover()
        srcs = dict(sorted(srcs.items(), key=lambda kv: (PROVINCES.index(kv[0][0]), kv[0][1])))
        print(f"发现 {len({p for (p, _) in srcs})} 省 / {len(srcs)} 条 2026 一分一段链接")
        for (prov, cat), url in srcs.items():
            if args.province and prov != args.province:
                continue
            print(f"  {prov:6s} {cat:6s} {url}")
        miss = [pp for pp in PROVINCES if pp not in {x for (x, _) in srcs}]
        print(f"\n尚未发现（可能未发布/为图片）：{'、'.join(miss)}")
    elif args.status:
        show_status()
    elif args.import_db:
        run_import_db()
    else:
        run_scrape(args.province, args.force)
