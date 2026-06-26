"""宁夏 2026 一分段表 解析（HTML，一次性特例）

宁夏发的是「一分段表」：只有 (分数, 累计人数)，没有本段人数；且是 Excel 导出的
多列对照表（每行并排多组 分数/累计），import_rank_tables_2025 的通用解析认不出。

这里确定性解析：抽出全部 (分数, 累计人数) 对 → 按分数降序 → 用累计差反推本段人数
（count_this[s] = cum[s] - cum[上一个更高分]）。属确定性提取，可信度等同其他 HTML 省。

用法：python scripts/parse_ningxia_2026.py
"""
import sys, os, re

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, os.path.dirname(__file__))
sys.stdout.reconfigure(encoding="utf-8")

import requests
from bs4 import BeautifulSoup
from process_rank_media_2026 import validate, save_staging

UA = "Mozilla/5.0"
PAGES = {
    "物理类": "https://gaokao.eol.cn/ning_xia/dongtai/202606/t20260625_2749206.shtml",
    "历史类": "https://gaokao.eol.cn/ning_xia/dongtai/202606/t20260625_2749197.shtml",
}


def parse(url: str):
    r = requests.get(url, headers={"User-Agent": UA}, timeout=20)
    r.encoding = r.apparent_encoding
    soup = BeautifulSoup(r.text, "html.parser")
    pairs: dict[int, int] = {}
    for t in soup.find_all("table"):
        cells = [td.get_text(strip=True) for tr in t.find_all("tr") for td in tr.find_all(["td", "th"])]
        i = 0
        while i < len(cells) - 1:
            ms = re.match(r"^(\d+)\s*分$", cells[i])
            if ms and re.match(r"^\d+$", cells[i + 1]):
                pairs[int(ms.group(1))] = int(cells[i + 1])
                i += 2
            else:
                i += 1
    # 按分数降序，累计差反推本段
    scores = sorted(pairs, reverse=True)
    rows = []
    prev_cum = 0
    for s in scores:
        cum = pairs[s]
        rows.append((s, cum - prev_cum, cum))
        prev_cum = cum
    return rows


def main():
    for cat, url in PAGES.items():
        rows = parse(url)
        hard, soft = validate(rows)
        srng = f"{rows[0][0]}~{rows[-1][0]}" if rows else "-"
        print(f"宁夏/{cat}: {len(rows)}行 {srng}  硬错{len(hard)} 缺号{len(soft)}")
        for it in hard[:5]:
            print("   -", it)
        if not hard:
            p = save_staging("宁夏", cat, rows, [url], "一分段(累计反推)")
            print("  ✅ saved", os.path.relpath(p))


if __name__ == "__main__":
    main()
