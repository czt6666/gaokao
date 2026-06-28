"""报告作用域：单次报告按完整查询/筛选参数锁定。"""
from __future__ import annotations

import hashlib
import json
from typing import Optional


DEFAULT_EXCLUDE_MARK = "__DEFAULT_SPECIAL__"
NO_EXCLUDE_MARK = "__NO_EXCLUDE__"


def _clean(s) -> str:
    return str(s or "").strip()


def _csv(s: str) -> list[str]:
    return sorted({x.strip() for x in _clean(s).split(",") if x.strip()})


def _keywords(s: str) -> list[str]:
    return sorted({x.strip() for x in _clean(s).split() if x.strip()})


def _pipe(s: str) -> list[str]:
    return sorted({x.strip() for x in _clean(s).split("|") if x.strip()})


def normalize_exclude_restrictions(v: Optional[str]) -> str | list[str]:
    if v is None:
        return DEFAULT_EXCLUDE_MARK
    if v == "":
        return NO_EXCLUDE_MARK
    return _csv(v)


def build_report_scope_key(
    *,
    province: str,
    rank: int | str | None,
    subject: str,
    score: int | str | None = None,
    c_major: str = "",
    c_city: str = "",
    c_nature: str = "",
    c_tier: str = "",
    discipline_filter: str = "",
    batch_filter: str = "",
    exclude_restrictions: Optional[str] = None,
) -> str:
    payload = {
        "province": _clean(province),
        "rank": str(rank or ""),
        "subject": _clean(subject),
        "score": str(score or ""),
        "c_major": _keywords(c_major),
        "c_city": _csv(c_city),
        "c_nature": _csv(c_nature),
        "c_tier": _csv(c_tier),
        "discipline_filter": _pipe(discipline_filter),
        "batch_filter": _csv(batch_filter),
        "exclude_restrictions": normalize_exclude_restrictions(exclude_restrictions),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _same_text(a, b) -> bool:
    return _clean(a) == _clean(b)


def _same_int_or_empty(a, b) -> bool:
    if a in (None, "", 0) and b in (None, "", 0):
        return True
    try:
        return int(a) == int(b)
    except Exception:
        return False


def legacy_order_matches(
    order,
    *,
    province: str,
    rank: int,
    subject: str,
    score: int | str | None = None,
    c_major: str = "",
    c_city: str = "",
    c_nature: str = "",
    c_tier: str = "",
    discipline_filter: str = "",
    batch_filter: str = "",
    exclude_restrictions: Optional[str] = None,
) -> bool:
    """旧订单无 scope_key：按旧字段兼容，但不允许新增筛选条件白嫖。"""
    province_match = getattr(order, "province", "") in ("", province)
    rank_input = getattr(order, "rank_input", None)
    rank_match = rank_input is None or abs(int(rank_input) - int(rank)) <= 50
    subject_match = getattr(order, "subject", "") in ("", subject)
    if not (province_match and rank_match and subject_match):
        return False

    if not _same_text(getattr(order, "c_major", ""), c_major):
        return False
    if not _same_text(getattr(order, "c_city", ""), c_city):
        return False
    if not _same_text(getattr(order, "c_nature", ""), c_nature):
        return False
    if not _same_text(getattr(order, "c_tier", ""), c_tier):
        return False
    if not _same_int_or_empty(getattr(order, "mock_score", None), score):
        return False

    # 旧订单没有这些字段；只允许当前请求也处于默认/空状态。
    if _clean(discipline_filter) or _clean(batch_filter) or exclude_restrictions is not None:
        return False
    return True


def order_matches_report(order, current_scope_key: str, **kwargs) -> bool:
    scope = _clean(getattr(order, "report_scope_key", ""))
    if scope:
        return scope == current_scope_key
    return legacy_order_matches(order, **kwargs)
