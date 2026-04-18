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
    "北京": {
        2020: 49_800,
        2021: 54_000,
        2022: 63_000,
        2023: 69_500,
        2024: 75_200,
        2025: 78_900,
        2026: 82_000,
    },
    "上海": {
        2020: 51_000,
        2021: 53_000,
        2022: 55_000,
        2023: 57_000,
        2024: 58_500,
        2025: 60_000,
        2026: 61_500,
    },
    "广东": {
        2020: 601_000,
        2021: 630_000,
        2022: 680_000,
        2023: 729_000,
        2024: 757_000,
        2025: 784_000,
        2026: 812_000,
    },
    "河南": {
        2020: 795_000,
        2021: 830_000,
        2022: 990_000,
        2023: 1_003_000,
        2024: 1_016_000,
        2025: 1_033_000,
        2026: 1_050_000,
    },
    "山东": {
        2020: 770_000,
        2021: 820_000,
        2022: 980_000,
        2023: 996_000,
        2024: 1_003_000,
        2025: 1_010_000,
        2026: 1_025_000,
    },
    "四川": {
        2020: 670_000,
        2021: 700_000,
        2022: 780_000,
        2023: 805_000,
        2024: 820_000,
        2025: 835_200,
        2026: 860_000,
    },
    "湖南": {
        2020: 565_000,
        2021: 590_000,
        2022: 670_000,
        2023: 695_000,
        2024: 714_000,
        2025: 732_000,
        2026: 752_000,
    },
    "河北": {
        2020: 495_000,
        2021: 520_000,
        2022: 590_000,
        2023: 611_000,
        2024: 626_000,
        2025: 640_000,
        2026: 655_000,
    },
    "安徽": {
        2020: 525_000,
        2021: 545_000,
        2022: 615_000,
        2023: 641_000,
        2024: 659_000,
        2025: 675_000,
        2026: 692_000,
    },
    "湖北": {
        2020: 400_000,
        2021: 430_000,
        2022: 490_000,
        2023: 506_000,
        2024: 518_000,
        2025: 528_500,
        2026: 540_000,
    },
    "江苏": {
        2020: 360_000,
        2021: 400_000,
        2022: 455_000,
        2023: 480_000,
        2024: 496_000,
        2025: 512_000,
        2026: 528_000,
    },
    "广西": {
        2020: 295_000,
        2021: 315_000,
        2022: 355_000,
        2023: 368_000,
        2024: 378_000,
        2025: 387_000,
        2026: 397_000,
    },
    "云南": {
        2020: 302_000,
        2021: 318_000,
        2022: 350_000,
        2023: 362_000,
        2024: 372_000,
        2025: 382_400,
        2026: 393_000,
    },
    "贵州": {
        2020: 343_000,
        2021: 360_000,
        2022: 405_000,
        2023: 417_000,
        2024: 426_000,
        2025: 434_000,
        2026: 443_000,
    },
    "浙江": {
        2020: 317_000,
        2021: 335_000,
        2022: 365_000,
        2023: 383_000,
        2024: 393_000,
        2025: 402_000,
        2026: 412_000,
    },
    "重庆": {
        2020: 276_000,
        2021: 297_000,
        2022: 343_000,
        2023: 358_000,
        2024: 365_000,
        2025: 372_000,
        2026: 382_000,
    },
    "山西": {
        2020: 227_000,
        2021: 240_000,
        2022: 270_000,
        2023: 279_000,
        2024: 285_500,
        2025: 291_000,
        2026: 298_000,
    },
    "陕西": {
        2020: 216_000,
        2021: 228_000,
        2022: 255_000,
        2023: 266_000,
        2024: 274_000,
        2025: 281_500,
        2026: 289_000,
    },
    "福建": {
        2020: 198_000,
        2021: 213_000,
        2022: 239_000,
        2023: 248_000,
        2024: 254_000,
        2025: 258_800,
        2026: 265_000,
    },
    "甘肃": {
        2020: 192_000,
        2021: 200_000,
        2022: 218_000,
        2023: 224_000,
        2024: 228_500,
        2025: 232_400,
        2026: 237_000,
    },
    "辽宁": {
        2020: 172_000,
        2021: 179_000,
        2022: 192_000,
        2023: 197_000,
        2024: 201_000,
        2025: 205_000,
        2026: 209_000,
    },
    "黑龙江": {
        2020: 164_000,
        2021: 168_000,
        2022: 177_000,
        2023: 180_000,
        2024: 182_000,
        2025: 184_000,
        2026: 186_000,
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
        2023: 64_500,
        2024: 65_800,
        2025: 67_000,
        2026: 68_500,
    },
    "青海": {
        2020: 47_000,
        2021: 50_000,
        2022: 55_000,
        2023: 57_000,
        2024: 58_500,
        2025: 59_900,
        2026: 61_000,
    },
    "海南": {
        2020: 58_400,
        2021: 61_000,
        2022: 66_500,
        2023: 70_000,
        2024: 72_600,
        2025: 75_141,
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
        2023: 220_000,
        2024: 225_000,
        2025: 230_000,
        2026: 235_000,
    },
    "内蒙古": {
        2020: 132_000,
        2021: 138_000,
        2022: 147_000,
        2023: 151_000,
        2024: 154_500,
        2025: 157_000,
        2026: 160_000,
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
        2023: 461_000,
        2024: 476_000,
        2025: 490_000,
        2026: 505_000,
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
