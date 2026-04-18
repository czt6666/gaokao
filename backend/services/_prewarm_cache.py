"""
推荐进程内缓存预热（后台线程）。

是否在进程启动时运行：由 ``main.on_startup`` 是否调用 ``start_prewarm_daemon()`` 决定，
本模块不做「是否启用」的环境变量判断。

可选环境变量：
- ``GAOKAO_PREWARM_DELAY_SEC`` — 启动后延迟秒数再开始（默认 5）
- ``GAOKAO_PREWARM_SLEEP_SEC`` — 每完成一次预热后的休眠秒数（默认 0.5）
- ``GAOKAO_PREWARM_FREE=1`` — 额外为 ``is_paid=False`` 跑一遍（仅前 3 个省的 spec，步长不低于 10000）

位次网格：按 ``rank_lo..rank_hi`` 与 ``step`` 生成。
与 ``recommend_core._REC_RANK_BUCKET=1000``：缓存键按千分桶合并，``step`` 小于 1000 时
易对同桶重复计算；建议 ``step >= 1000``，常用 2500/5000。
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Iterable

logger = logging.getLogger("gaokao")


def _delay_sec() -> float:
    return float(os.environ.get("GAOKAO_PREWARM_DELAY_SEC", "5"))


def _sleep_sec() -> float:
    return float(os.environ.get("GAOKAO_PREWARM_SLEEP_SEC", "0.5"))


def _rank_grid(lo: int, hi: int, step: int) -> list[int]:
    if step <= 0:
        step = 5000
    lo, hi, step = int(lo), int(hi), int(step)
    return list(range(lo, hi + 1, step))


# 省 × 选科 × [位次下限, 上限, 步长] — 步长越小预热越细、总耗时越长
WARM_SPECS: list[dict] = [
    {"province": "广东", "subjects": ["物理"], "rank_lo": 5000, "rank_hi": 100_000, "step": 5000},
    {"province": "广东", "subjects": ["历史"], "rank_lo": 5000, "rank_hi": 40_000, "step": 5000},
    {"province": "河南", "subjects": ["物理"], "rank_lo": 10_000, "rank_hi": 120_000, "step": 5000},
    {"province": "山东", "subjects": ["物理"], "rank_lo": 10_000, "rank_hi": 80_000, "step": 5000},
    {"province": "浙江", "subjects": ["综合"], "rank_lo": 10_000, "rank_hi": 80_000, "step": 5000},
    {"province": "北京", "subjects": ["物理"], "rank_lo": 3000, "rank_hi": 60_000, "step": 2500},
    {"province": "北京", "subjects": ["历史"], "rank_lo": 3000, "rank_hi": 25_000, "step": 2500},
    {"province": "湖北", "subjects": ["物理"], "rank_lo": 10_000, "rank_hi": 70_000, "step": 5000},
    {"province": "湖南", "subjects": ["物理"], "rank_lo": 10_000, "rank_hi": 70_000, "step": 5000},
    {"province": "四川", "subjects": ["物理"], "rank_lo": 10_000, "rank_hi": 80_000, "step": 5000},
    {"province": "江苏", "subjects": ["物理"], "rank_lo": 10_000, "rank_hi": 80_000, "step": 5000},
]


def iter_warm_tasks() -> Iterable[tuple[str, int, str, bool]]:
    """生成 (province, rank, subject, is_paid)。"""
    for spec in WARM_SPECS:
        prov = spec["province"]
        ranks = _rank_grid(spec["rank_lo"], spec["rank_hi"], spec["step"])
        for subj in spec["subjects"]:
            for r in ranks:
                yield prov, r, subj, True

    if os.environ.get("GAOKAO_PREWARM_FREE", "0").lower() in ("1", "true", "yes"):
        for spec in WARM_SPECS[:3]:
            prov = spec["province"]
            ranks = _rank_grid(spec["rank_lo"], spec["rank_hi"], max(spec["step"], 10_000))
            for subj in spec["subjects"]:
                for r in ranks:
                    yield prov, r, subj, False


def _prewarm_cache_loop() -> None:
    """后台线程：按网格预热 ``_run_recommend_core`` 写入的进程内缓存。"""
    time.sleep(_delay_sec())
    try:
        from database import SessionLocal

        from services.recommend_core import _rec_cache_get, _run_recommend_core

        db = SessionLocal()
        warmed = 0
        skipped = 0
        tasks = list(iter_warm_tasks())
        logger.info(f"[Prewarm] 开始：共 {len(tasks)} 个 (省,位次,选科,is_paid) 任务")
        for province, rank, subject, is_paid in tasks:
            try:
                if _rec_cache_get(province, rank, subject, is_paid) is None:
                    _run_recommend_core(
                        province=province,
                        rank=rank,
                        subject=subject,
                        mode="all",
                        db=db,
                        is_paid=is_paid,
                    )
                    warmed += 1
                else:
                    skipped += 1
                time.sleep(_sleep_sec())
            except Exception:
                pass
        db.close()
        logger.info(f"[Prewarm] 完成：新预热 {warmed}，已缓存跳过 {skipped}，计划任务 {len(tasks)}")
    except Exception as e:
        logger.warning(f"[Prewarm] 预热失败（不影响服务）: {e}")


def start_prewarm_daemon() -> None:
    """启动守护线程执行 ``_prewarm_cache_loop``（是否调用由 main 等上层决定）。"""
    threading.Thread(target=_prewarm_cache_loop, daemon=True).start()
    logger.info("[Prewarm] 已排队后台预热线程")
