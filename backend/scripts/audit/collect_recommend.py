"""推荐准确性审计 — 数据采集
对一组（省份×位次×选科）矩阵调用 /api/recommend，落盘成 JSON。
后续脚本基于这份原始数据做分析，不再二次请求。
"""
import json
import os
import sys
import time
import argparse
from pathlib import Path
import requests

OUT_DIR = Path(__file__).parent / "out"
OUT_DIR.mkdir(exist_ok=True)

# 矩阵：覆盖大/中/小考生省、各分段、各选科
# rank 选典型分段：尖子(50/500)、高分(3000/8000)、中段(20000/50000)、偏低(150000)
# 高分段必选物理/历史；中段加几个不同选科；偏低段聚焦报考量大的省。
CASES = [
    # (province, rank, subject, exam_mode, label)
    # ── 顶尖位次（清北线/前985区间）─────────────────────
    ("北京",  50,    "物理",          "3+3",   "北京-顶尖50"),
    ("北京",  500,   "物理",          "3+3",   "北京-高分500"),
    ("广东",  300,   "物理+化学+生物",  "3+1+2", "广东-顶尖300"),
    ("江苏",  500,   "物理+化学+生物",  "3+1+2", "江苏-高分500"),
    ("浙江",  1000,  "物理",          "3+3",   "浙江-高分1000"),
    # ── 高分中段（强211/双一流核心区间）─────────────────
    ("北京",  3000,  "物理",          "3+3",   "北京-中3000"),
    ("北京",  8000,  "物理",          "3+3",   "北京-中8000"),
    ("广东",  10000, "物理+化学+生物",  "3+1+2", "广东-中10000"),
    ("江苏",  15000, "物理+化学+生物",  "3+1+2", "江苏-中15000"),
    ("河南",  20000, "物理+化学+生物",  "3+1+2", "河南-中20000"),
    ("山东",  20000, "物理+化学+生物",  "3+1+2", "山东-中20000"),
    # ── 中下段（普通本科 - 二本区间）─────────────────────
    ("河南",  80000, "物理+化学+生物",  "3+1+2", "河南-下80000"),
    ("广东",  60000, "物理+化学+生物",  "3+1+2", "广东-下60000"),
    ("四川",  70000, "物理",          "old",   "四川-下70000"),
    # ── 历史方向 ─────────────────────────────────────
    ("北京",  3000,  "历史",          "3+3",   "北京-历3000"),
    ("江苏",  10000, "历史+政治+地理",  "3+1+2", "江苏-历10000"),
    ("河南",  30000, "历史+政治+地理",  "3+1+2", "河南-历30000"),
    # ── 选科组合差异（对照） ─────────────────────────────
    ("江苏",  20000, "物理+化学+生物",  "3+1+2", "江苏-理工20k"),
    ("江苏",  20000, "物理+化学+地理",  "3+1+2", "江苏-理化地20k"),
    ("江苏",  20000, "物理+生物+地理",  "3+1+2", "江苏-物生地20k"),
]


def call(base, province, rank, subject, exam_mode, retry=2):
    url = f"{base}/api/recommend"
    params = {"rank": rank, "province": province, "subject": subject, "exam_mode": exam_mode}
    for i in range(retry):
        try:
            r = requests.get(url, params=params, timeout=60)
            if r.status_code == 200:
                return r.json(), r.status_code
            return {"_error": r.text[:500]}, r.status_code
        except Exception as e:
            if i == retry - 1:
                return {"_error": str(e)}, -1
            time.sleep(3)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["local", "server"], default="local")
    parser.add_argument("--sleep", type=float, default=4.5,
                        help="每个请求间隔秒数（限流：15/min）")
    args = parser.parse_args()
    base = "http://localhost:8000" if args.target == "local" else "https://www.theyuanxi.cn"

    bundle = {
        "meta": {"target": base, "ts": time.strftime("%Y-%m-%d %H:%M:%S")},
        "cases": []
    }

    for prov, rank, subj, exam, label in CASES:
        print(f"  → {label} ({prov}/{rank}/{subj})", flush=True)
        data, status = call(base, prov, rank, subj, exam)
        bundle["cases"].append({
            "label": label, "province": prov, "rank": rank,
            "subject": subj, "exam_mode": exam,
            "status": status, "data": data
        })
        time.sleep(args.sleep)

    out = OUT_DIR / f"recommend_{args.target}_{int(time.time())}.json"
    out.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n[OK] {len(CASES)} cases → {out}")


if __name__ == "__main__":
    main()
