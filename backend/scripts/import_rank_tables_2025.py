"""
2025年 全国一分一段表 抓取+入库脚本
数据源：中国教育在线 gaokao.eol.cn 各省份分页

用法：
  python scripts/import_rank_tables_2025.py             # 抓全部
  python scripts/import_rank_tables_2025.py --province 河南
  python scripts/import_rank_tables_2025.py --dry-run   # 只抓不入库
"""
import sys, os, re, json, time, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.stdout.reconfigure(encoding="utf-8")

import requests
from bs4 import BeautifulSoup
from database import SessionLocal, RankTable, init_db

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "rank_2025_cache")
os.makedirs(CACHE_DIR, exist_ok=True)

# ── 数据源映射：(province, category) -> URL ────────────────────────
# category 取值规范：物理类 / 历史类 / 综合 / 理科 / 文科
SOURCES = {
    ("北京",   "综合"):   "https://gaokao.eol.cn/bei_jing/dongtai/202506/t20250625_2676934.shtml",
    ("天津",   "综合"):   "https://gaokao.eol.cn/tian_jin/dongtai/202506/t20250623_2676448.shtml",
    ("上海",   "综合"):   "https://gaokao.eol.cn/shang_hai/dongtai/202506/t20250623_2676341.shtml",
    ("重庆",   "综合"):   "https://gaokao.eol.cn/chong_qing/dongtai/202506/t20250624_2676752.shtml",
    ("河北",   "综合"):   "https://gaokao.eol.cn/he_bei/dongtai/202506/t20250624_2676842.shtml",
    ("河南",   "物理类"): "https://gaokao.eol.cn/he_nan/dongtai/202506/t20250625_2676859.shtml",
    ("河南",   "历史类"): "https://gaokao.eol.cn/he_nan/dongtai/202506/t20250625_2676858.shtml",
    ("山西",   "物理类"): "https://gaokao.eol.cn/shan_xi/dongtai/202506/t20250626_2677293.shtml",
    ("山西",   "历史类"): "https://gaokao.eol.cn/shan_xi/dongtai/202506/t20250626_2677335.shtml",
    ("山东",   "综合"):   "https://gaokao.eol.cn/shan_dong/dongtai/202506/t20250625_2677092.shtml",
    ("江苏",   "物理类"): "https://gaokao.eol.cn/jiang_su/dongtai/202506/t20250625_2676969.shtml",
    ("江苏",   "历史类"): "https://gaokao.eol.cn/jiang_su/dongtai/202506/t20250625_2676968.shtml",
    ("浙江",   "综合"):   "https://gaokao.eol.cn/zhe_jiang/dongtai/202506/t20250625_2677143.shtml",
    ("安徽",   "物理类"): "https://gaokao.eol.cn/an_hui/dongtai/202506/t20250625_2676962.shtml",
    ("安徽",   "历史类"): "https://gaokao.eol.cn/an_hui/dongtai/202506/t20250625_2676963.shtml",
    ("福建",   "物理类"): "https://gaokao.eol.cn/fu_jian/dongtai/202507/t20250702_2678456.shtml",
    ("福建",   "历史类"): "https://gaokao.eol.cn/fu_jian/dongtai/202507/t20250702_2678457.shtml",
    ("江西",   "汇总"):   "https://gaokao.eol.cn/jiang_xi/dongtai/202506/t20250626_2677291.shtml",  # 可能是图片/附件
    ("湖北",   "物理类"): "https://gaokao.eol.cn/hu_bei/dongtai/202506/t20250625_2677129.shtml",
    ("湖北",   "历史类"): "https://gaokao.eol.cn/hu_bei/dongtai/202506/t20250625_2677137.shtml",
    ("湖南",   "物理类"): "https://gaokao.eol.cn/hu_nan/dongtai/202506/t20250625_2676956.shtml",
    ("湖南",   "历史类"): "https://gaokao.eol.cn/hu_nan/dongtai/202506/t20250625_2676955.shtml",
    ("广东",   "汇总"):   "https://gaokao.eol.cn/guang_dong/dongtai/202506/t20250626_2677410.shtml",
    ("广西",   "物理类"): "https://gaokao.eol.cn/guang_xi/dongtai/202506/t20250625_2677014.shtml",
    ("广西",   "历史类"): "https://gaokao.eol.cn/guang_xi/dongtai/202506/t20250625_2677013.shtml",
    ("海南",   "综合"):   "https://gaokao.eol.cn/hai_nan/dongtai/202507/t20250702_2678468.shtml",
    ("四川",   "物理类"): "https://gaokao.eol.cn/si_chuan/dongtai/202507/t20250702_2678480.shtml",
    ("四川",   "历史类"): "https://gaokao.eol.cn/si_chuan/dongtai/202507/t20250702_2678481.shtml",
    ("贵州",   "汇总"):   "https://gaokao.eol.cn/news/202506/t20250625_2677151.shtml",
    ("云南",   "汇总"):   "https://gaokao.eol.cn/yun_nan/dongtai/202507/t20250701_2678266.shtml",
    ("陕西",   "物理类"): "https://gaokao.eol.cn/shan_xi_sheng/dongtai/202506/t20250625_2677115.shtml",
    ("陕西",   "历史类"): "https://gaokao.eol.cn/shan_xi_sheng/dongtai/202506/t20250625_2677119.shtml",
    ("甘肃",   "物理类"): "https://gaokao.eol.cn/gan_su/dongtai/202507/t20250702_2678474.shtml",
    ("甘肃",   "历史类"): "https://gaokao.eol.cn/gan_su/dongtai/202507/t20250702_2678473.shtml",
    ("青海",   "物理类"): "https://gaokao.eol.cn/qing_hai/dongtai/202506/t20250625_2677001.shtml",
    ("青海",   "历史类"): "https://gaokao.eol.cn/qing_hai/dongtai/202506/t20250625_2677002.shtml",
    ("宁夏",   "物理类"): "https://gaokao.eol.cn/news/202506/t20250625_2677005.shtml",
    ("宁夏",   "历史类"): "https://gaokao.eol.cn/ning_xia/dongtai/202506/t20250625_2677008.shtml",
    ("内蒙古", "物理类"): "https://gaokao.eol.cn/nei_meng/dongtai/202506/t20250625_2676869.shtml",
    ("内蒙古", "历史类"): "https://gaokao.eol.cn/nei_meng/dongtai/202506/t20250625_2676868.shtml",
    ("黑龙江", "物理类"): "https://gaokao.eol.cn/hei_long_jiang/dongtai/202506/t20250624_2676681.shtml",
    ("黑龙江", "历史类"): "https://gaokao.eol.cn/hei_long_jiang/dongtai/202506/t20250624_2676679.shtml",
    ("辽宁",   "汇总"):   "https://gaokao.eol.cn/liao_ning/dongtai/202506/t20250624_2676779.shtml",
    ("吉林",   "物理类"): "https://gaokao.eol.cn/ji_lin/dongtai/202506/t20250625_2677006.shtml",
    ("吉林",   "历史类"): "https://gaokao.eol.cn/ji_lin/dongtai/202506/t20250625_2677007.shtml",
}


# ── 抓取 + 解析 ───────────────────────────────────────────────────
def fetch(url: str, force: bool = False) -> str:
    """带本地缓存的 HTTP GET"""
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


def _try_parse_table(trs) -> list[dict] | None:
    """尝试把一组 tr 解析为一分一段数据，返回 rows 或 None"""
    rows: list[dict] = []
    prev_cum = -1
    bad = 0
    for tr in trs[1:]:
        tds = tr.find_all(["td","th"])
        if len(tds) < 3:
            continue
        score_txt = tds[0].get_text(strip=True)
        this_txt  = tds[1].get_text(strip=True).replace(",", "").replace(",", "")
        cum_txt   = tds[2].get_text(strip=True).replace(",", "").replace(",", "")
        m = re.search(r"\d+", score_txt)
        if not m:
            continue
        score = int(m.group())
        try:
            count_this = int(re.sub(r"[^\d]", "", this_txt) or 0)
            count_cum  = int(re.sub(r"[^\d]", "", cum_txt) or 0)
        except ValueError:
            continue
        if count_cum <= 0:
            continue
        rows.append({"score": score, "count_this": count_this, "count_cum": count_cum})
        if prev_cum >= 0 and count_cum < prev_cum:
            bad += 1
            if bad > 3 and len(rows) > 10:
                return None
        prev_cum = count_cum
    return rows if len(rows) >= 10 else None


def parse_eol_tables(html: str) -> list[list[dict]]:
    """
    解析 eol.cn 一分一段页所有候选 <table>，返回 [[rows], [rows], ...]，按表序号
    每个 row：{score, count_this, count_cum}
    策略：不再强依赖表头文字，对所有 ≥5 行的 table 直接尝试数据特征匹配。
    但优先接受表头含"分数/累计"的表；若表头乱码也 fallback 尝试。
    """
    soup = BeautifulSoup(html, "html.parser")
    out: list[list[dict]] = []
    for table in soup.find_all("table"):
        trs = table.find_all("tr")
        if len(trs) < 5:
            continue
        head_txt = " ".join(td.get_text(strip=True) for td in trs[0].find_all(["td", "th"]))
        is_match = ("分数" in head_txt or "成绩" in head_txt) and ("累计" in head_txt or "累积" in head_txt)
        # 直接尝试解析；若数据特征符合就接受
        rows = _try_parse_table(trs)
        if rows:
            # 如果表头明确匹配，无条件接受；否则要求数据更严格（≥30行，避免误识小表格）
            if is_match or len(rows) >= 30:
                out.append(rows)
    return out


def detect_category_for_table(html: str, table_idx: int, default: str) -> str | None:
    """
    多表共存时（如重庆/河北/广东汇总页），尝试根据表前文本推断 category。
    返回 物理类/历史类/综合 之一，或 None 表示未知。
    """
    # 这里粗略判断：取页面文本，看物理/历史哪个先于第二个表出现
    # 留作进一步细化；目前若 default 不为"汇总"则直接用 default
    if default != "汇总":
        return default
    return None


# ── 入库 ───────────────────────────────────────────────────────────
def upsert_rows(db, rows, province: str, year: int, category: str) -> int:
    """去重写入"""
    inserted = 0
    for r in rows:
        exists = db.query(RankTable).filter(
            RankTable.province == province,
            RankTable.year == year,
            RankTable.score == r["score"],
            RankTable.category == category,
        ).first()
        if exists:
            continue
        db.add(RankTable(
            province=province, year=year, category=category, batch="本科批",
            score=r["score"],
            count_this=r.get("count_this", 0),
            count_cum=r["count_cum"],
            rank_min=r["count_cum"] - r.get("count_this", 0) + 1,
            rank_max=r["count_cum"],
        ))
        inserted += 1
    db.commit()
    return inserted


def run(province_filter: str | None, dry_run: bool, force: bool):
    init_db()
    db = SessionLocal() if not dry_run else None

    summary = []
    for (province, category), url in SOURCES.items():
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
            print(f"  ⚠ 无可识别表格（可能是图片/PDF附件）")
            summary.append((province, category, 0, "no-table"))
            continue

        if category != "汇总" and len(tables) >= 1:
            # 单类页：取首个候选表
            rows = tables[0]
            n = upsert_rows(db, rows, province, 2025, category) if not dry_run else len(rows)
            print(f"  ✅ 解析 {len(rows)} 行，写入 {n} 行（cat={category}）")
            summary.append((province, category, n, "ok"))
        else:
            # 汇总页（如河北、辽宁、重庆、广东）：尝试拆分成两个 category
            # 简化策略：第1表→物理类，第2表→历史类（顺序不保证，需手工核对！）
            cats = ["物理类", "历史类", "综合"]
            for i, rows in enumerate(tables[:3]):
                cat = cats[i] if i < len(cats) else f"未知{i}"
                n = upsert_rows(db, rows, province, 2025, cat) if not dry_run else len(rows)
                print(f"  ✅ 表#{i}: {len(rows)} 行 → {cat}，写入 {n}")
                summary.append((province, cat, n, "ok"))

        time.sleep(0.5)  # 客气一点

    if db: db.close()

    # 汇总报告
    print("\n" + "=" * 60)
    print(f"{'省份':8s}{'科类':8s}{'写入':>8s}  状态")
    print("-" * 60)
    for prov, cat, n, status in summary:
        print(f"{prov:8s}{cat:8s}{n:>8d}  {status}")
    print(f"\n共 {len(summary)} 项，总写入 {sum(s[2] for s in summary)} 行")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--province", default=None)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--force", action="store_true", help="忽略缓存")
    args = p.parse_args()
    run(args.province, args.dry_run, args.force)
