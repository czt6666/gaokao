"""
2026 一分一段表 —— 图片/PDF -> staging JSON（步骤 2/4）

读 data/rank_2026_images/manifest.json，把每个附件转成一分一段行：
  - 图片：qwen-vl-max 视觉模型 OCR（经 yunwu.ai 中转，与 services/agent_service.py 同源）。
    模型同时读出图片标题里的「科类 / 是否含加分」，避免依赖正文文案。
  - PDF（青海）：pymupdf 直接抽文本（数字版 PDF，非扫描件），按固定字段循环解析。

把同一 (省, 科类, 含加分) 的多图/多页合并、按分数降序去重，跑两道校验：
  1. 分数连续性：相邻分数应 -1，缺号 = 漏行 → flag
  2. 累计自洽：累计[i] == 累计[i-1] + 人数[i]，且单调递增 → flag
校验干净的，按 import_rank_tables_2026 的 staging 格式写入
data/rank_2026_staging/<省>_<科类>.json（含加分优先），与 HTML 流程共用 --import-db。
有问题的写进 review 报告，等人工核对——不静默入库（CLAUDE Rule 12）。

用法：
  python scripts/process_rank_media_2026.py                 # 处理 manifest 全部
  python scripts/process_rank_media_2026.py --province 安徽
  python scripts/process_rank_media_2026.py --model qwen-vl-max
  python scripts/process_rank_media_2026.py --no-write       # 只校验+出报告，不写 staging
"""
import sys, os, re, io, json, base64, time, argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, os.path.dirname(__file__))
sys.stdout.reconfigure(encoding="utf-8")

import httpx
from PIL import Image
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

YEAR = 2026
MEDIA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "rank_2026_images")
STAGING_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "rank_2026_staging")
os.makedirs(STAGING_DIR, exist_ok=True)

_API_KEY = os.getenv("YUNWU_API_KEY")
_BASE = "https://yunwu.ai/v1/chat/completions"

# 3+3 省份：一分一段不分物理/历史，统一为「综合」。模型若误标物理类/历史类，按省强制并回综合。
THREE_PLUS_THREE = {"北京", "天津", "上海", "山东", "海南", "浙江"}

_OCR_PROMPT = (
    "这是高考「一分一段表」的图片。请严格按下面格式输出，不要任何解释：\n"
    "第一行输出元信息，格式：META|科类|含加分状态\n"
    "  科类 只能是 物理类/历史类/综合 三者之一："
    "标题含「物理」→物理类，含「历史」→历史类，不分文理/只写「分数分布」「成绩分档」→综合。\n"
    "  含加分状态 只能是 含加分/不含加分/未标注。\n"
    "之后逐行输出数据，每行严格格式：分数,人数,累计人数\n"
    "阅读顺序：表分多个竖栏时，先把最左栏从上到下读完，再读右边一栏；单栏则从上到下。\n"
    "分数若是「692分以上」「≥625」「671及以上」，只取数字（如 692/625/671）。\n"
    "数字必须精确照抄，不得推算、补全或跳行。只输出 META 行和数据行。"
)

_CAT_CANON = {"物理": "物理类", "历史": "历史类", "综合": "综合", "理科": "理科", "文科": "文科"}


def _canon_cat(s: str) -> str:
    for k, v in _CAT_CANON.items():
        if k in s:
            return v
    return "综合"


# ── 图片 OCR ──────────────────────────────────────────────────
_TILE_H = 3600        # 超过此高度的长条图竖向切片，逐片 OCR（如云南 900x8615）
_TILE_OVERLAP = 220   # 切片重叠像素，避免切断行；按分数去重在缝合处对齐


def _encode(im: Image.Image) -> str:
    """编码为 JPEG dataurl（比 PNG 小得多，避免大图压垮中转代理）。小图放大 2x。"""
    if max(im.size) < 2200:
        im = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
    buf = io.BytesIO(); im.convert("RGB").save(buf, format="JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _ocr_call(dataurl: str, model: str, retries: int = 3) -> dict:
    payload = {"model": model, "temperature": 0, "max_tokens": 4000,
               "messages": [{"role": "user", "content": [
                   {"type": "text", "text": _OCR_PROMPT},
                   {"type": "image_url", "image_url": {"url": dataurl}}]}]}
    last = None
    for _ in range(retries):
        try:
            r = httpx.post(_BASE, headers={"Authorization": f"Bearer {_API_KEY}"},
                           json=payload, timeout=180)
            if r.status_code != 200:
                last = f"[{r.status_code}] {r.text[:160]}"; time.sleep(3); continue
            return _parse_ocr(r.json()["choices"][0]["message"]["content"])
        except Exception as e:
            last = repr(e); time.sleep(3)
    raise RuntimeError(f"OCR 失败({retries}次): {last}")


def ocr_image(path: str, model: str) -> dict:
    """返回 {category, bonus, rows:[(score,cnt,cum)], raw_meta}。
    长条图竖切多片逐片 OCR，按分数去重缝合（保留先出现/高分片的值）。"""
    im = Image.open(path).convert("RGB")
    if im.height <= _TILE_H:
        return _ocr_call(_encode(im), model)
    category, bonus, raw_meta = "综合", "未标注", ""
    best: dict[int, tuple] = {}
    y = 0
    while y < im.height:
        tile = im.crop((0, y, im.width, min(y + _TILE_H, im.height)))
        res = _ocr_call(_encode(tile), model)
        if res["raw_meta"] and not raw_meta:
            category, bonus, raw_meta = res["category"], res["bonus"], res["raw_meta"]
        for sc, cnt, cum in res["rows"]:
            best.setdefault(sc, (sc, cnt, cum))  # 高分片先到，缝合处优先保留
        y += _TILE_H - _TILE_OVERLAP
    rows = [best[s] for s in sorted(best, reverse=True)]
    return {"category": category, "bonus": bonus, "raw_meta": raw_meta, "rows": rows}


def _internal_violations(rows: list) -> int:
    """单图内部一致性违例数：累计链应自洽、分数应严格降序。
    （不查首行累计==人数——分段/分页图首行可能是续档，累计非从 0 起。）"""
    if len(rows) < 2:
        return 0 if rows else 1
    bad = 0
    for i in range(1, len(rows)):
        if rows[i][0] >= rows[i - 1][0]:
            bad += 1
        if rows[i - 1][2] + rows[i][1] != rows[i][2]:
            bad += 1
    return bad


def ocr_image_cached(path: str, model: str, force: bool, retries: int = 4) -> dict:
    """OCR 结果缓存到 <图片>.ocr.json，避免重跑重复付费、并让结果可复现。
    OCR 非确定：用「单图累计链自洽」做裁判，重试取违例最少的一版（0 即停）。"""
    cache = path + f".{model}.ocr.json"
    if not force and os.path.exists(cache):
        d = json.load(open(cache, encoding="utf-8"))
        d["rows"] = [tuple(r) for r in d["rows"]]
        d["_cached"] = True
        return d
    best, best_v = None, 1 << 30
    for _ in range(retries):
        res = ocr_image(path, model)
        v = _internal_violations(res["rows"])
        if v < best_v:
            best, best_v = res, v
        if v == 0:
            break
    best["_violations"] = best_v
    with open(cache, "w", encoding="utf-8") as f:
        json.dump({**best, "rows": [list(r) for r in best["rows"]]}, f, ensure_ascii=False)
    best["_cached"] = False
    return best


def _parse_ocr(text: str) -> dict:
    category, bonus, raw_meta = "综合", "未标注", ""
    rows = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("META"):
            raw_meta = s
            parts = [p.strip() for p in s.split("|")]
            if len(parts) >= 2:
                category = _canon_cat(parts[1])
            if len(parts) >= 3:
                bonus = parts[2] or "未标注"
            continue
        m = re.match(r"^(\d+)\s*[,，]\s*(\d+)\s*[,，]\s*(\d+)$", s)
        if m:
            rows.append((int(m.group(1)), int(m.group(2)), int(m.group(3))))
    return {"category": category, "bonus": bonus, "raw_meta": raw_meta, "rows": rows}


# ── PDF 解析（青海：数字版 PDF，固定 5 字段循环）──────────────
_PDF_CAT = {"历史组": "历史类", "物理组": "物理类", "历史": "历史类", "物理": "物理类"}


def parse_pdf(path: str) -> list[dict]:
    """青海格式：每条记录 5 行 [科类组, 投档分类型, 总分, 人数, 累计数]。
    返回按科类聚合 [{category, bonus, rows}]。"""
    import fitz
    doc = fitz.open(path)
    toks = []
    for pg in doc:
        toks += [t.strip() for t in pg.get_text().splitlines() if t.strip()]
    by_cat: dict[str, list[tuple[int, int, int]]] = {}
    i = 0
    while i < len(toks):
        if toks[i] in _PDF_CAT:
            cat = _PDF_CAT[toks[i]]
            # 期望接下来：投档类型, 总分, 人数, 累计数
            if i + 4 < len(toks) + 1 and i + 4 <= len(toks):
                score_t, cnt_t, cum_t = toks[i + 2], toks[i + 3], toks[i + 4]
                ms = re.match(r"^[≥>＞]?\s*(\d+)", score_t)
                if ms and cnt_t.isdigit() and cum_t.isdigit():
                    by_cat.setdefault(cat, []).append((int(ms.group(1)), int(cnt_t), int(cum_t)))
                    i += 5; continue
        i += 1
    return [{"category": c, "bonus": "含加分", "rows": rs} for c, rs in by_cat.items()]


# ── 合并 + 校验 ──────────────────────────────────────────────
def merge_rows(chunks: list[list[tuple[int, int, int]]]) -> list[tuple[int, int, int]]:
    """多图/多页合并：按分数降序，分数去重（保留先出现的）。"""
    best: dict[int, tuple[int, int, int]] = {}
    for ch in chunks:
        for sc, cnt, cum in ch:
            if sc not in best:
                best[sc] = (sc, cnt, cum)
    return [best[s] for s in sorted(best, reverse=True)]


def validate(rows: list[tuple[int, int, int]]) -> tuple[list[str], list[str]]:
    """校验，返回 (hard_issues, soft_notes)。hard 非空 = 不落盘。

    累计自洽（累计[i]==累计[i-1]+人数[i] 且单调递增）是权威校验：OCR 真漏一行
    会让累计链断裂。分数缺号多为「该分数 0 人」的正常省略——只要累计仍自洽就不算错，
    降级为 soft 提示。"""
    hard, soft = [], []
    if not rows:
        return ["无数据行"], soft
    # 分数：降序且不重复（重复/升序 = 硬错）；单纯缺号 = soft
    for i in range(1, len(rows)):
        gap = rows[i - 1][0] - rows[i][0]
        if gap <= 0:
            hard.append(f"分数非降序/重复 {rows[i-1][0]}→{rows[i][0]}")
        elif gap > 1:
            soft.append(f"分数缺号 {rows[i-1][0]}→{rows[i][0]}（缺 {gap-1} 个分数, 多为 0 人）")
    # 累计自洽（硬校验）。首行小幅 cum>cnt 是「X分及以上」聚合桶，正常；
    # 仅当首行累计很大（>1500）才是缺上半段的残表 → 硬错。
    if rows[0][2] != rows[0][1] and rows[0][2] > 1500:
        hard.append(f"首行累计({rows[0][2]})过大≠人数({rows[0][1]})，疑缺上半段")
    for i in range(1, len(rows)):
        exp = rows[i - 1][2] + rows[i][1]
        if exp != rows[i][2]:
            hard.append(f"分数{rows[i][0]}: 累计应={exp} 实={rows[i][2]}（OCR 漏行/读错）")
    return hard, soft


def save_staging(province: str, category: str, rows, sources: list[str], bonus: str):
    safe = re.sub(r"[^\w]", "_", f"{province}_{category}")
    path = os.path.join(STAGING_DIR, f"{safe}.json")
    # 行键与 HTML 流程 (import_rank_tables_2025.parse_eol_tables / upsert_rows) 对齐：
    # {score, count_this, count_cum}，这样 import_rank_tables_2026 --import-db 可直接消费。
    json_rows = [{"score": s, "count_this": c, "count_cum": cum} for s, c, cum in rows]
    with open(path, "w", encoding="utf-8") as f:
        json.dump({
            "province": province, "category": category, "year": YEAR,
            "url": sources[0] if sources else "", "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "source": "media-ocr", "bonus": bonus, "sources": sources,
            "row_count": len(json_rows), "rows": json_rows,
        }, f, ensure_ascii=False, indent=2)
    return path


# ── 主流程 ───────────────────────────────────────────────────
def run(province_filter, model, write, force_ocr):
    mpath = os.path.join(MEDIA_DIR, "manifest.json")
    if not os.path.exists(mpath):
        print("manifest 不存在，先跑 fetch_rank_media_2026.py"); return
    manifest = json.load(open(mpath, encoding="utf-8"))

    # 收集：{(省, 科类, bonus): {rows_chunks, sources}}
    groups: dict = {}
    report = []
    for province, blocks in manifest.items():
        if province_filter and province != province_filter:
            continue
        print(f"\n{'='*20} {province} {'='*20}")
        for blk in blocks:
            for m in blk["media"]:
                path = os.path.join(os.path.dirname(__file__), "..", m["path"]) \
                    if not os.path.isabs(m["path"]) else m["path"]
                path = os.path.normpath(os.path.join(os.getcwd(), m["path"]))
                try:
                    if m["type"] == "pdf":
                        parsed = parse_pdf(path)
                        for p in parsed:
                            key = (province, p["category"], p["bonus"])
                            g = groups.setdefault(key, {"chunks": [], "sources": []})
                            g["chunks"].append(p["rows"]); g["sources"].append(m["url"])
                            print(f"  PDF {m['filename']}: {p['category']} {len(p['rows'])} 行")
                    else:
                        res = ocr_image_cached(path, model, force_ocr)
                        key = (province, res["category"], res["bonus"])
                        g = groups.setdefault(key, {"chunks": [], "sources": []})
                        g["chunks"].append(res["rows"]); g["sources"].append(m["url"])
                        tag = "cache" if res.get("_cached") else "OCR"
                        v = res.get("_violations")
                        vtag = f" 自洽✓" if v == 0 else (f" 内部违例{v}" if v else "")
                        print(f"  {tag} {m['filename']}: {res['category']}/{res['bonus']} "
                              f"{len(res['rows'])} 行{vtag}  [{res['raw_meta'][:30]}]")
                except Exception as e:
                    print(f"  ❌ {m['filename']}: {e}")
                    report.append((province, m["filename"], "处理失败", str(e)))

    # 同 (省,科类) 合并、校验、落盘。模型的 含加分/未标注 标签不可靠，
    # 故按 (省,科类) 聚合，3+3 省强制并到「综合」。两个重构候选取最优：
    #   A. 合并全部图块（适合一张表被切成多个分数段/多页的「分段拼接」）
    #   B. 单一最完整变体（适合含加分/不含加分两张重叠表，A 会串档失败时回退）
    by_pc: dict = {}
    for (prov, cat, bonus), g in groups.items():
        cat_final = "综合" if prov in THREE_PLUS_THREE else cat
        by_pc.setdefault((prov, cat_final), []).append((bonus, g))
    print(f"\n{'='*60}\n校验 + 落盘（A=分段拼接 / B=单变体回退）\n{'='*60}")
    staged_ok = 0
    for (prov, cat), variants in sorted(by_pc.items()):
        all_chunks = [c for _, g in variants for c in g["chunks"]]
        all_sources = sorted({s for _, g in variants for s in g["sources"]})
        rowsA = merge_rows(all_chunks)
        hardA, softA = validate(rowsA)
        # B: 各 bonus 变体单独重构，挑「无硬错优先、行数多优先」的
        cand = []
        for bonus, g in variants:
            r = merge_rows(g["chunks"]); h, s = validate(r)
            cand.append((len(h) == 0, len(r), bonus, r, h, s))
        cand.sort(key=lambda x: (x[0], x[1]), reverse=True)
        _, _, bbonus, rowsB, hardB, softB = cand[0]

        if not hardA and len(rowsA) >= len(rowsB):
            mode, rows, hard, soft, label = "A", rowsA, hardA, softA, "拼接"
        elif not hardB:
            mode, rows, hard, soft, label = "B", rowsB, hardB, softB, bbonus
        else:  # 都有硬错，报最接近的（硬错少者）
            if len(hardA) <= len(hardB):
                mode, rows, hard, soft, label = "A", rowsA, hardA, softA, "拼接"
            else:
                mode, rows, hard, soft, label = "B", rowsB, hardB, softB, bbonus
        srng = f"{rows[0][0]}~{rows[-1][0]}" if rows else "-"
        vnote = f" (变体:{'/'.join(b for b,_ in variants)})" if len(variants) > 1 else ""
        sfx = f"  缺号{len(soft)}处" if soft else ""
        if hard:
            print(f"  ⚠ {prov}/{cat} [{mode}:{label}] {len(rows)}行 {srng}  硬错{len(hard)}处{vnote}{sfx}")
            for it in hard[:5]:
                print(f"       - {it}")
            report.append((prov, cat, f"{len(rows)}行/{mode}:{label}", "; ".join(hard[:8])))
        else:
            msg = "(no-write)"
            if write:
                p = save_staging(prov, cat, rows, all_sources, label)
                msg = os.path.relpath(p)
            print(f"  ✅ {prov}/{cat} [{mode}:{label}] {len(rows)}行 {srng}  累计自洽{vnote}{sfx} → {msg}")
            staged_ok += 1

    # 报告
    rpath = os.path.join(MEDIA_DIR, "review_report.json")
    with open(rpath, "w", encoding="utf-8") as f:
        json.dump([{"province": p, "key": k, "info": i, "issue": d} for p, k, i, d in report],
                  f, ensure_ascii=False, indent=2)
    print(f"\n校验通过并落盘 {staged_ok} 个 (省,科类)；待人工核对 {len(report)} 项 → {os.path.relpath(rpath)}")
    print("review 后执行：python scripts/import_rank_tables_2026.py --status / --import-db")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--province", default=None)
    p.add_argument("--model", default="qwen-vl-max")
    p.add_argument("--no-write", dest="write", action="store_false", help="只校验+报告，不写 staging")
    p.add_argument("--force-ocr", dest="force_ocr", action="store_true", help="忽略 OCR 缓存重新识别")
    args = p.parse_args()
    if not _API_KEY:
        print("缺 YUNWU_API_KEY（backend/.env）"); sys.exit(1)
    run(args.province, args.model, args.write, args.force_ocr)
