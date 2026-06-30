"""城市线级映射 — 从 admission_2026 构建缓存，供城市筛选和后台订单展示使用。"""
from collections import Counter, defaultdict
from sqlalchemy import text as _text
from sqlalchemy.orm import Session

_CITY_TIERS = ["一线", "新一线", "二线", "三线", "四线", "五线"]
_MUNICIPALITIES = ("北京", "上海", "天津", "重庆")

_tier_cities_cache: dict | None = None


def _norm_city_tier(city_level: str) -> str:
    """城市层级归一：取首段、去「城市」后缀 → 一线/新一线/二线/三线/四线/五线，其余归「其他」。"""
    s = (city_level or "").split("/")[0].strip().replace("城市", "")
    return s if s in _CITY_TIERS else "其他"


def get_tier_cities_map(db: Session) -> dict:
    """返回 {线级: [城市名列表]}，首次调用时从 admission_2026 构建并缓存。"""
    global _tier_cities_cache
    if _tier_cities_cache is not None:
        return _tier_cities_cache
    rows = db.execute(_text(
        "SELECT DISTINCT "
        "CASE WHEN school_province IN ('北京','上海','天津','重庆') THEN school_province ELSE city END AS disp_city, "
        "city_level FROM admission_2026 WHERE COALESCE(city,'') != ''"
    )).fetchall()
    votes: dict = defaultdict(Counter)
    for disp_city, lv in rows:
        if disp_city:
            votes[disp_city][_norm_city_tier(lv)] += 1
    tier_cities: dict = defaultdict(list)
    for city, c in votes.items():
        tier_cities[c.most_common(1)[0][0]].append(city)
    out = {}
    for t in _CITY_TIERS + ["其他"]:
        cities = sorted(tier_cities.get(t, []))
        if cities:
            out[t] = cities
    _tier_cities_cache = out
    return out


def reduce_city_filter(city_str: str, tier_map: dict) -> str:
    """将城市筛选字符串做线级归一：若包含某线级全部城市，则替换为线级名称（如一线城市）。"""
    if not city_str:
        return ""
    cities = set(city_str.split(","))
    reduced = []
    remaining = set(cities)
    tier_order = ["一线", "新一线", "二线", "三线", "四线", "五线"]
    for tier in tier_order:
        tier_cities = set(tier_map.get(tier, []))
        if tier_cities and tier_cities <= remaining:
            remaining -= tier_cities
            reduced.append(tier)
    if not reduced:
        return city_str
    if not remaining:
        return "".join(reduced) + "城市"
    return "".join(reduced) + "城市+" + ",".join(sorted(remaining))
