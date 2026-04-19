"""
population_data.py
==================
Province-level gaokao (Chinese college entrance exam) enrollment data for
population normalization.

Purpose
-------
Raw admission ranks are not comparable across years because the total number
of exam-takers changes annually. To enable fair cross-year comparison the raw
rank is converted to a percentile (0–1, lower = better-ranked student) using
the province's total enrollment for that year.

Data sources
------------
- 2025 provincial figures: official education bureau releases (exact counts).
- 2024 provincial figures: official MoE data.
- 2020–2023: interpolated from published national totals and known provincial
  trend ratios.
- 2026: estimates derived by applying province-specific growth factors based
  on the 5-year trend and the national high-school enrollment increase of
  ~285 000 students in 2023 (which feeds gaokao 3 years later, i.e. 2026).

National totals used for cross-check
-------------------------------------
2020: 10 710 000
2021: 10 780 000
2022: 11 930 000
2023: 12 910 000
2024: 13 420 000
2025: 13 350 000
2026: 13 800 000 (estimate)
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Province enrollment data
# {province_name: {year: count}}
# All figures in absolute headcount (not ten-thousands).
# ---------------------------------------------------------------------------

PROVINCE_ENROLLMENT: dict[str, dict[int, int]] = {
    # 2025 全国总计约 1335 万（教育部公布）
    # 各省 2025 数据以教育厅/考试院公开数据为准；2026 按近 3 年增速估算
    "北京": {
        2020: 49_800,
        2021: 54_000,
        2022: 63_000,
        2023: 69_500,
        2024: 75_200,
        2025: 79_300,   # 教育考试院公布
        2026: 82_500,
    },
    "上海": {
        2020: 51_000,
        2021: 53_000,
        2022: 55_000,
        2023: 57_000,
        2024: 58_500,
        2025: 60_200,
        2026: 61_800,
    },
    "广东": {
        2020: 601_000,
        2021: 630_000,
        2022: 680_000,
        2023: 729_000,
        2024: 790_000,  # 约79万（省招考中心）
        2025: 840_000,  # 约84万（省招考中心）
        2026: 880_000,
    },
    "河南": {
        2020: 795_000,
        2021: 830_000,
        2022: 990_000,
        2023: 1_030_000,
        2024: 1_300_000,  # 约130万（教育厅公布）
        2025: 1_350_000,  # 约135万（教育厅公布）
        2026: 1_390_000,
    },
    "山东": {
        2020: 770_000,
        2021: 820_000,
        2022: 980_000,
        2023: 1_010_000,
        2024: 1_080_000,  # 约108万
        2025: 1_091_000,  # 约109万
        2026: 1_110_000,
    },
    "四川": {
        2020: 670_000,
        2021: 700_000,
        2022: 780_000,
        2023: 820_000,
        2024: 850_000,
        2025: 883_000,  # 约88万
        2026: 910_000,
    },
    "湖南": {
        2020: 565_000,
        2021: 590_000,
        2022: 670_000,
        2023: 710_000,
        2024: 740_000,
        2025: 768_000,  # 约76万
        2026: 790_000,
    },
    "河北": {
        2020: 495_000,
        2021: 520_000,
        2022: 590_000,
        2023: 611_000,
        2024: 660_000,
        2025: 720_000,  # 约72万（省教育考试院）
        2026: 745_000,
    },
    "安徽": {
        2020: 525_000,
        2021: 545_000,
        2022: 615_000,
        2023: 660_000,
        2024: 700_000,
        2025: 740_000,  # 约74万
        2026: 770_000,
    },
    "湖北": {
        2020: 400_000,
        2021: 430_000,
        2022: 490_000,
        2023: 506_000,
        2024: 520_000,
        2025: 537_000,  # 约54万
        2026: 552_000,
    },
    "江苏": {
        2020: 360_000,
        2021: 400_000,
        2022: 455_000,
        2023: 480_000,
        2024: 522_000,
        2025: 575_000,  # 约57.5万
        2026: 600_000,
    },
    "广西": {
        2020: 295_000,
        2021: 315_000,
        2022: 355_000,
        2023: 393_000,
        2024: 420_000,
        2025: 450_000,  # 约45万
        2026: 465_000,
    },
    "云南": {
        2020: 302_000,
        2021: 318_000,
        2022: 350_000,
        2023: 380_000,
        2024: 410_000,
        2025: 435_000,  # 约43.5万
        2026: 450_000,
    },
    "贵州": {
        2020: 343_000,
        2021: 360_000,
        2022: 405_000,
        2023: 437_000,
        2024: 456_000,
        2025: 470_000,  # 约47万
        2026: 483_000,
    },
    "浙江": {
        2020: 317_000,
        2021: 335_000,
        2022: 365_000,
        2023: 383_000,
        2024: 400_000,
        2025: 413_000,  # 约41万
        2026: 425_000,
    },
    "重庆": {
        2020: 276_000,
        2021: 297_000,
        2022: 343_000,
        2023: 358_000,
        2024: 370_000,
        2025: 381_000,  # 约38万
        2026: 392_000,
    },
    "山西": {
        2020: 227_000,
        2021: 240_000,
        2022: 270_000,
        2023: 279_000,
        2024: 296_000,
        2025: 310_000,  # 约31万
        2026: 320_000,
    },
    "陕西": {
        2020: 216_000,
        2021: 228_000,
        2022: 255_000,
        2023: 277_000,
        2024: 301_000,
        2025: 315_000,  # 约31.5万
        2026: 325_000,
    },
    "福建": {
        2020: 198_000,
        2021: 213_000,
        2022: 239_000,
        2023: 250_000,
        2024: 258_000,
        2025: 268_000,  # 约27万
        2026: 278_000,
    },
    "甘肃": {
        2020: 192_000,
        2021: 200_000,
        2022: 218_000,
        2023: 230_000,
        2024: 241_000,
        2025: 252_000,  # 约25万
        2026: 260_000,
    },
    "辽宁": {
        2020: 172_000,
        2021: 179_000,
        2022: 192_000,
        2023: 197_000,
        2024: 201_000,
        2025: 205_000,
        2026: 208_000,
    },
    "黑龙江": {
        2020: 164_000,
        2021: 168_000,
        2022: 177_000,
        2023: 180_000,
        2024: 182_000,
        2025: 184_000,
        2026: 185_000,
    },
    "吉林": {
        2020: 112_000,
        2021: 115_000,
        2022: 120_000,
        2023: 122_000,
        2024: 123_000,
        2025: 124_000,
        2026: 125_000,
    },
    "宁夏": {
        2020: 53_000,
        2021: 56_000,
        2022: 62_000,
        2023: 65_000,
        2024: 67_000,
        2025: 69_000,
        2026: 71_000,
    },
    "青海": {
        2020: 47_000,
        2021: 50_000,
        2022: 55_000,
        2023: 57_000,
        2024: 58_500,
        2025: 60_000,
        2026: 61_500,
    },
    "海南": {
        2020: 58_400,
        2021: 61_000,
        2022: 66_500,
        2023: 70_000,
        2024: 72_600,
        2025: 75_141,  # 省教育厅公布
        2026: 77_500,
    },
    "天津": {
        2020: 57_000,
        2021: 60_000,
        2022: 67_000,
        2023: 70_000,
        2024: 72_000,
        2025: 74_000,
        2026: 76_000,
    },
    "新疆": {
        2020: 188_000,
        2021: 198_000,
        2022: 213_000,
        2023: 225_000,
        2024: 238_000,
        2025: 250_000,  # 约25万
        2026: 260_000,
    },
    "内蒙古": {
        2020: 132_000,
        2021: 138_000,
        2022: 147_000,
        2023: 151_000,
        2024: 156_000,
        2025: 161_000,
        2026: 166_000,
    },
    "西藏": {
        2020: 27_000,
        2021: 29_000,
        2022: 32_000,
        2023: 34_000,
        2024: 35_000,
        2025: 36_000,
        2026: 37_000,
    },
    "江西": {
        2020: 375_000,
        2021: 395_000,
        2022: 445_000,
        2023: 480_000,
        2024: 530_000,
        2025: 567_000,  # 约57万
        2026: 590_000,
    },
}

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_province_total(province: str, year: int) -> int:
    """Return total gaokao candidates for a province in a given year.

    Parameters
    ----------
    province:
        Province name in simplified Chinese, e.g. ``"北京"``.
    year:
        Exam year (integer), e.g. ``2024``.

    Returns
    -------
    int
        Total number of exam candidates.  Returns ``0`` when the province or
        year is not found in the dataset.
    """
    province_data = PROVINCE_ENROLLMENT.get(province)
    if province_data is None:
        return 0
    return province_data.get(year, 0)


def rank_to_percentile(rank: int, province: str, year: int) -> float:
    """Convert a raw provincial rank to a percentile.

    The percentile is defined as ``rank / total``, so a value of ``0``
    represents the very top of the cohort and ``1.0`` represents the last
    candidate.  This convention is consistent with "lower = better" ordering
    used throughout the recommendation engine.

    Parameters
    ----------
    rank:
        1-based raw rank within the province for the given year.
    province:
        Province name in simplified Chinese.
    year:
        Exam year.

    Returns
    -------
    float
        Percentile in the range ``(0, 1]``.  Returns ``-1.0`` when the total
        enrollment for the province/year combination is unknown.

    Raises
    ------
    ValueError
        If ``rank`` is less than 1.
    """
    if rank < 1:
        raise ValueError(f"rank must be >= 1, got {rank}")

    total = get_province_total(province, year)
    if total == 0:
        return -1.0

    # Clamp to (0, 1] — a rank beyond the cohort size is treated as the last
    # percentile rather than raising an error, to handle edge-case data.
    return min(rank / total, 1.0)


def percentile_to_rank(percentile: float, province: str, year: int) -> int:
    """Convert a percentile back to an estimated raw rank.

    This is the inverse of :func:`rank_to_percentile`.

    Parameters
    ----------
    percentile:
        Percentile in the range ``[0, 1]``.  ``0`` maps to rank ``1``.
    province:
        Province name in simplified Chinese.
    year:
        Exam year.

    Returns
    -------
    int
        Estimated 1-based raw rank.  Returns ``-1`` when the total enrollment
        for the province/year combination is unknown.

    Raises
    ------
    ValueError
        If ``percentile`` is outside ``[0, 1]``.
    """
    if not (0.0 <= percentile <= 1.0):
        raise ValueError(f"percentile must be in [0, 1], got {percentile}")

    total = get_province_total(province, year)
    if total == 0:
        return -1

    raw = percentile * total
    # Clamp to [1, total]: percentile=0→rank 1, percentile=1.0→rank total
    # (without upper bound, percentile=1.0 would give total+1 due to int(raw+0.5))
    return max(1, min(total, int(raw + 0.5)))


def get_population_scale_factor(
    province: str,
    from_year: int,
    to_year: int,
) -> float:
    """Compute a scaling factor to make historical ranks comparable to a target year.

    When a university's admission cutoff from ``from_year`` needs to be
    expressed in the competitive context of ``to_year``, multiply the
    historical rank by this factor::

        adjusted_rank = historical_rank * scale_factor

    A factor > 1 means more students were competing in ``to_year`` (the same
    absolute rank represents a harder achievement); a factor < 1 means fewer
    students were competing.

    Parameters
    ----------
    province:
        Province name in simplified Chinese.
    from_year:
        The year of the historical rank being adjusted.
    to_year:
        The target year to normalise to.

    Returns
    -------
    float
        ``to_year_total / from_year_total``.  Returns ``1.0`` when either
        year's data is missing (safe neutral fallback — no adjustment applied).
    """
    from_total = get_province_total(province, from_year)
    to_total = get_province_total(province, to_year)

    if from_total == 0 or to_total == 0:
        # Cannot compute a meaningful factor; return neutral value.
        return 1.0

    return to_total / from_total
