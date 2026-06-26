"""河南 2026 一分段表 OCR（扫描版 PDF，一次性特例）

河南发的是扫描版 PDF（图片，无文本层），且是「一分段表」——只有 分数 + 累计人数
（标题写"考生人数"，注释说明是"总分及以上累计人数"），没有本段人数。

风险：累计-only 源，本段人数只能由累计差反推，导致「累计自洽」校验恒成立、抓不到
OCR 错。故这里用**双遍交叉校验**：每页 OCR 两遍，只保留两遍在 (分数,累计) 上完全
一致的行；不一致的行丢弃并报告。再要求累计随分数下降单调递增。可信度低于有本段人数
的省，入库前在报告里标注。

用法：python scripts/ocr_henan_2026.py
"""
import sys, os, io, base64, time, re

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, os.path.dirname(__file__))
sys.stdout.reconfigure(encoding="utf-8")

import requests, httpx, fitz
from PIL import Image
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from process_rank_media_2026 import save_staging

_KEY = os.getenv("YUNWU_API_KEY")
_BASE = "https://yunwu.ai/v1/chat/completions"
_MODEL = "qwen-vl-max"
UA = "Mozilla/5.0"

PDFS = {
    "历史类": "https://www.haeea.cn/attach/file/20260625/20260625071405_4807_c3d528c2.pdf",
    "物理类": "https://www.haeea.cn/attach/file/20260625/20260625071418_1682_7aeeac0f.pdf",
}
PAGE_URL = "https://gaokao.eol.cn/he_nan/dongtai/202606/t20260625_2748885.shtml"

PROMPT = (
    "这是一张「一分段表」截图，只有两类列：分数、累计人数（每个分数后面跟它的累计人数）。"
    "表分成多个竖列组，请先把最左列组从上到下读完，再读右边的列组。"
    "逐行输出，每行严格格式：分数,累计人数。分数形如「706」直接取数字；"
    "忽略页面水印文字。数字必须精确照抄，不要推算/补全。只输出数据行。"
)


def _encode(im):
    buf = io.BytesIO(); im.convert("RGB").save(buf, format="JPEG", quality=92)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _ocr_pairs(dataurl, retries=3):
    payload = {"model": _MODEL, "temperature": 0, "max_tokens": 4000,
               "messages": [{"role": "user", "content": [
                   {"type": "text", "text": PROMPT},
                   {"type": "image_url", "image_url": {"url": dataurl}}]}]}
    last = None
    for _ in range(retries):
        try:
            r = httpx.post(_BASE, headers={"Authorization": f"Bearer {_KEY}"},
                           json=payload, timeout=180)
            if r.status_code != 200:
                last = r.status_code; time.sleep(3); continue
            out = {}
            for line in r.json()["choices"][0]["message"]["content"].splitlines():
                mt = re.match(r"^\s*(\d+)\s*[,，]\s*(\d+)\s*$", line.strip())
                if mt:
                    out[int(mt.group(1))] = int(mt.group(2))
            return out
        except Exception as e:
            last = repr(e); time.sleep(3)
    raise RuntimeError(f"OCR 失败: {last}")


def process(cat, url):
    print(f"\n==== 河南 {cat} ====")
    open("/tmp/hn.pdf", "wb").write(requests.get(url, headers={"User-Agent": UA}, timeout=60).content)
    doc = fitz.open("/tmp/hn.pdf")
    agreed: dict[int, int] = {}
    conflicts = 0
    for pno in range(doc.page_count):
        pix = doc[pno].get_pixmap(dpi=170)
        im = Image.open(io.BytesIO(pix.tobytes("png")))
        d1 = _ocr_pairs(_encode(im))
        d2 = _ocr_pairs(_encode(im))
        ok = 0
        for s in d1.keys() & d2.keys():
            if d1[s] == d2[s]:
                agreed[s] = d1[s]; ok += 1
            else:
                conflicts += 1
        print(f"  page{pno+1}: 两遍 {len(d1)}/{len(d2)} 行, 一致 {ok}")
    # 单调性 + 反推本段
    scores = sorted(agreed, reverse=True)
    rows, prev_cum, mono_bad = [], 0, []
    for s in scores:
        cum = agreed[s]
        if cum < prev_cum:
            mono_bad.append(f"分数{s}: 累计{cum}<上一个{prev_cum}（非单调）")
        rows.append((s, cum - prev_cum, cum))
        prev_cum = cum
    srng = f"{rows[0][0]}~{rows[-1][0]}" if rows else "-"
    print(f"  双遍一致 {len(rows)} 行 {srng}；两遍冲突 {conflicts}；单调违例 {len(mono_bad)}")
    for it in mono_bad[:5]:
        print("     -", it)
    if rows and not mono_bad:
        p = save_staging("河南", cat, rows, [PAGE_URL], "一分段(双遍交叉/累计反推)")
        print("  ✅ saved", os.path.relpath(p), "（注：累计-only，可信度略低，建议抽查）")
    else:
        print("  ⚠ 有冲突/非单调，未保存，待复核")


def main():
    for cat, url in PDFS.items():
        process(cat, url)


if __name__ == "__main__":
    if not _KEY:
        print("缺 YUNWU_API_KEY"); sys.exit(1)
    main()
