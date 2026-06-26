"""
2026 一分一段表 —— 图片/PDF 省份的「附件」下载器（步骤 1/4）

背景：eol.cn 上部分省份的一分一段表不是 HTML 表格，而是附件：
  - 图片型（北京、安徽、湖北、福建、贵州、云南、天津、上海…）：
    整张表渲染成图片挂在正文（相对链接 ./W020260625xxxx.jpg|png）
  - PDF 型（青海）：正文里是指向考试院 PDF 的链接（.pdf）
import_rank_tables_2026.py 的 HTML 解析对这些页面拿不到表格（no-table）。

本脚本只做下载（确定性、可重跑）：
  1. 复用 import_rank_tables_2026.discover() 发现 (省,科类)->页面URL
  2. 跳过 HTML 能解析出表格的页面（走原流程）
  3. 把图片型省份的正文附件图片、PDF 型省份的目标 PDF 下载到
     data/rank_2026_images/<省>/，写 manifest.json

下一步用 process_rank_media_2026.py 把附件 -> staging JSON。

用法：
  python scripts/fetch_rank_media_2026.py            # 下载所有图片/PDF 省份
  python scripts/fetch_rank_media_2026.py --province 青海
  python scripts/fetch_rank_media_2026.py --force    # 忽略本地缓存重下
"""
import sys, os, re, json, time, argparse
from urllib.parse import urljoin

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, os.path.dirname(__file__))
sys.stdout.reconfigure(encoding="utf-8")

import requests
from import_rank_tables_2026 import discover, fetch, PROVINCES, UA
from import_rank_tables_2025 import parse_eol_tables

MEDIA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "rank_2026_images")
os.makedirs(MEDIA_DIR, exist_ok=True)

# 正文附件图片：相对链接 ./W0202606xxxx.jpg|png（eol 附件命名固定以 W + 长串数字开头）
_IMG_RE = re.compile(r'(?:href|src)="(\.?/?W\d{12,}\.(?:jpg|jpeg|png))"', re.I)
# 正文 PDF 链接（含锚文本，用于过滤「普通类」与特殊类）
_PDF_RE = re.compile(r'<a[^>]+href="([^"]+\.pdf)"[^>]*>(.*?)</a>', re.I | re.S)

# 只要「普通类」总表；排除艺考/体育/专项/民族等特殊类（它们不是常规位次换算用表）
_PDF_SKIP_KW = ("艺考", "体育", "专项", "民族", "预科", "藏文", "蒙文", "对口", "单招")


def _images_in(html: str) -> list[str]:
    seen, out = set(), []
    for m in _IMG_RE.finditer(html):
        fn = m.group(1).lstrip("./")
        if fn not in seen:
            seen.add(fn); out.append(fn)
    return out


def _pdfs_in(html: str) -> list[tuple[str, str]]:
    """返回正文里通过筛选的 PDF [(url, caption)]，只留「一分一段/排序成绩」且非特殊类。"""
    out = []
    for m in _PDF_RE.finditer(html):
        url = m.group(1).strip()
        cap = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        if not re.search(r"一分一段|排序成绩|分段|分档", cap):
            continue
        if any(kw in cap for kw in _PDF_SKIP_KW):
            continue
        out.append((url, cap))
    return out


def _province_dir(province: str) -> str:
    d = os.path.join(MEDIA_DIR, province)
    os.makedirs(d, exist_ok=True)
    return d


def _download(url: str, path: str, force: bool):
    if force or not os.path.exists(path) or os.path.getsize(path) == 0:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=90)
        r.raise_for_status()
        with open(path, "wb") as f:
            f.write(r.content)
        time.sleep(0.3)
    return os.path.getsize(path)


def run(province_filter: str | None, force: bool):
    sources = discover()
    by_prov: dict[str, list[tuple[str, str]]] = {}
    for (prov, cat), url in sources.items():
        by_prov.setdefault(prov, []).append((cat, url))

    manifest = {}
    print(f"发现 {len(by_prov)} 省，逐省检查是否为图片/PDF 型...")
    for prov in PROVINCES:
        if prov not in by_prov or (province_filter and prov != province_filter):
            continue
        blocks = []
        for cat, url in by_prov[prov]:
            try:
                html = fetch(url)
            except Exception as e:
                print(f"  ⚠ {prov}/{cat} 页面抓取失败: {e}"); continue
            if parse_eol_tables(html):
                continue  # HTML 能解析 → 走原流程
            imgs = _images_in(html)
            pdfs = _pdfs_in(html)
            if not imgs and not pdfs:
                continue
            pdir = _province_dir(prov)
            media = []
            if imgs:
                print(f"\n▶ {prov:6s} / {cat:6s}  图片 {len(imgs)} 张  {url}")
                for fn in imgs:
                    img_url = urljoin(url, fn)
                    path = os.path.join(pdir, fn)
                    n = _download(img_url, path, force)
                    media.append({"type": "image", "filename": fn, "url": img_url,
                                  "path": os.path.relpath(path), "bytes": n})
                    print(f"    ↓ img {fn}  ({n:,} B)")
            for purl, cap in pdfs:
                fn = purl.rsplit("/", 1)[-1]
                path = os.path.join(pdir, fn)
                n = _download(purl, path, force)
                media.append({"type": "pdf", "filename": fn, "url": purl,
                              "path": os.path.relpath(path), "bytes": n, "caption": cap})
                print(f"\n▶ {prov:6s} / {cat:6s}  PDF  {cap[:30]}\n    ↓ pdf {fn}  ({n:,} B)")
            if media:
                blocks.append({"category_hint": cat, "page_url": url, "media": media})
        if blocks:
            manifest[prov] = blocks

    mpath = os.path.join(MEDIA_DIR, "manifest.json")
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    n_img = sum(1 for b in manifest.values() for blk in b for m in blk["media"] if m["type"] == "image")
    n_pdf = sum(1 for b in manifest.values() for blk in b for m in blk["media"] if m["type"] == "pdf")
    print("\n" + "=" * 60)
    print(f"图片/PDF 省份 {len(manifest)} 个：图片 {n_img} 张 + PDF {n_pdf} 份")
    for prov, blks in manifest.items():
        ni = sum(1 for b in blks for m in b["media"] if m["type"] == "image")
        npd = sum(1 for b in blks for m in b["media"] if m["type"] == "pdf")
        tag = (f"{ni}图" if ni else "") + (f"{npd}PDF" if npd else "")
        print(f"  {prov:6s} {tag}")
    print(f"\nmanifest: {os.path.relpath(mpath)}")
    print("下一步：python scripts/process_rank_media_2026.py")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--province", default=None)
    p.add_argument("--force", action="store_true", help="忽略本地缓存重新下载")
    args = p.parse_args()
    run(args.province, args.force)
