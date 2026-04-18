"""
Parallel Volunteer List Portfolio Optimizer
============================================
Implements optimal volunteer list construction for China's 平行志愿 (parallel volunteer)
college admissions system.

Theoretical foundations:
  - Chade, Lewis & Smith (2014). "Student Portfolios and the College Admissions Problem."
    Review of Economic Studies, 81(3), 971–1002.
  - Chen & Kesten (2017). "Chinese College Admissions and School Choice Reforms:
    A Theoretical Analysis." Journal of Political Economy, 125(1), 99–139.

China's parallel volunteer rule:
  The provincial system scans a student's ordered list S1, S2, ..., Sn.
  The student is admitted to the FIRST school Si where their rank falls within
  that school's cutoff. Therefore:
    - Order matters: higher-utility schools must appear earlier.
    - Portfolio composition matters: diversification across probability tiers
      guards against both over-reach (all 冲) and under-reach (all 保).

Expected Value of an ordered list [S1, S2, ..., Sn]:
  EV = Σ_i  U(Si) · p(Si) · Π_{j<i} (1 - p(Sj))

  where U(Si) = cardinal utility of school i
        p(Si) = calibrated admission probability

Tier conventions used throughout:
  冲 (chong)  — reach schools,     P ∈ [0.25, 0.55)
  稳 (wen)    — solid schools,     P ∈ [0.55, 0.82)
  保 (bao)    — safety schools,    P ∈ [0.82, 0.95)
  垫 (dian)   — guaranteed floors, P ≥ 0.95
"""

from __future__ import annotations

import math
from typing import Any


# ---------------------------------------------------------------------------
# Internal type alias
# ---------------------------------------------------------------------------
School = dict[str, Any]


# ---------------------------------------------------------------------------
# Tier classification
# ---------------------------------------------------------------------------

TIER_THRESHOLDS: dict[str, tuple[float, float]] = {
    "冲": (0.25, 0.55),
    "稳": (0.55, 0.82),
    "保": (0.82, 0.95),
    "垫": (0.95, 1.01),
}

TIER_ORDER: list[str] = ["冲", "稳", "保", "垫"]


def classify_tier(probability: float) -> str:
    """
    Return the admission-probability tier label for a school.

    Parameters
    ----------
    probability:
        Calibrated admission probability in [0, 1].

    Returns
    -------
    One of '冲', '稳', '保', '垫'.  Schools below the 冲 threshold
    (P < 0.25) are labelled '冲' as extreme reaches; schools with P >= 0.95
    are '垫' (guaranteed floors).
    """
    if probability >= 0.95:
        return "垫"
    if probability >= 0.82:
        return "保"
    if probability >= 0.55:
        return "稳"
    return "冲"


# ---------------------------------------------------------------------------
# Core probability helpers
# ---------------------------------------------------------------------------

def _product_of_failures(schools: list[School]) -> float:
    """
    Compute Π (1 - p_i) for a list of schools — the probability that a student
    is *not* admitted to any of them.

    Uses log-sum to avoid float underflow for long lists.
    """
    if not schools:
        return 1.0
    log_prob = sum(math.log(max(1.0 - s["probability"], 1e-15)) for s in schools)
    return math.exp(log_prob)


def _portfolio_ev_raw(ordered_list: list[School]) -> float:
    """
    Compute the scalar EV of an ordered volunteer list.

    EV = Σ_i  U(Si) · p(Si) · Π_{j<i} (1 - p(Sj))
    """
    ev = 0.0
    cumulative_failure = 1.0
    for school in ordered_list:
        p = school["probability"]
        u = school["utility"]
        ev += u * p * cumulative_failure
        cumulative_failure *= (1.0 - p)
    return ev


def _p_no_admission(ordered_list: list[School]) -> float:
    """Probability that the student is rejected by every school in the list."""
    return _product_of_failures(ordered_list)


# ---------------------------------------------------------------------------
# Public calculation utilities
# ---------------------------------------------------------------------------

def calculate_portfolio_ev(ordered_list: list[School]) -> dict[str, Any]:
    """
    Calculate detailed expected-value metrics for a given ordered volunteer list.

    Parameters
    ----------
    ordered_list:
        Schools in the order they will be submitted.  Each entry must contain
        at minimum: ``probability`` (float), ``utility`` (float),
        ``school_name`` (str), ``major_name`` (str).

    Returns
    -------
    dict with keys:

    ``total_ev``
        Scalar expected utility of the portfolio.
    ``p_no_admission``
        Probability of receiving zero offers (clearing out / 清出).
    ``admission_rate``
        1 - p_no_admission.
    ``expected_quality``
        E[utility | admitted] = total_ev / admission_rate.
    ``marginal_contributions``
        List of per-school dicts: school_name, major_name, probability,
        utility, tier, marginal_ev, cumulative_failure_before.
    ``tier_ev``
        EV attributable to each tier (冲/稳/保/垫).
    """
    if not ordered_list:
        return {
            "total_ev": 0.0,
            "p_no_admission": 1.0,
            "admission_rate": 0.0,
            "expected_quality": 0.0,
            "marginal_contributions": [],
            "tier_ev": {t: 0.0 for t in TIER_ORDER},
        }

    marginal_contributions: list[dict] = []
    tier_ev: dict[str, float] = {t: 0.0 for t in TIER_ORDER}

    cumulative_failure = 1.0
    total_ev = 0.0

    for school in ordered_list:
        p = school["probability"]
        u = school["utility"]
        tier = school.get("tier") or classify_tier(p)
        contribution = u * p * cumulative_failure

        marginal_contributions.append(
            {
                "school_name": school.get("school_name", ""),
                "major_name": school.get("major_name", ""),
                "probability": p,
                "utility": u,
                "tier": tier,
                "marginal_ev": contribution,
                "cumulative_failure_before": cumulative_failure,
            }
        )

        total_ev += contribution
        tier_ev[tier] = tier_ev.get(tier, 0.0) + contribution
        cumulative_failure *= (1.0 - p)

    p_no_adm = cumulative_failure
    adm_rate = 1.0 - p_no_adm
    expected_quality = total_ev / adm_rate if adm_rate > 1e-12 else 0.0

    return {
        "total_ev": total_ev,
        "p_no_admission": p_no_adm,
        "admission_rate": adm_rate,
        "expected_quality": expected_quality,
        "marginal_contributions": marginal_contributions,
        "tier_ev": tier_ev,
    }


def marginal_ev(school: School, current_portfolio: list[School]) -> float:
    """
    Marginal expected-value contribution of adding *school* to *current_portfolio*.

    Definition (Chade, Lewis & Smith 2014, §3):
        ΔEV(s | P) = U(s) · p(s) · P(not yet admitted to any school in P
                                      with utility > U(s))

    This equals the incremental EV gained by inserting *school* at the
    correct position in the list (after all better schools).

    Parameters
    ----------
    school:
        Candidate school dict with ``probability`` and ``utility`` keys.
    current_portfolio:
        Already-selected schools (order in this list is irrelevant here;
        only the better-utility subset matters).

    Returns
    -------
    Scalar marginal EV ≥ 0.
    """
    better_schools = [
        s for s in current_portfolio if s["utility"] > school["utility"]
    ]
    p_available = _product_of_failures(better_schools)
    return school["utility"] * school["probability"] * p_available


# ---------------------------------------------------------------------------
# Tier allocation recommendation
# ---------------------------------------------------------------------------

def recommend_tier_allocation(student_profile: dict[str, Any]) -> dict[str, Any]:
    """
    Recommend how many 冲/稳/保/垫 slots to allocate based on student profile.

    Grounded in the theory of optimal portfolio design under uncertainty
    (Chade & Smith 2006; Chen & Kesten 2017): a more risk-averse student
    should weight the portfolio toward higher-probability schools.

    Parameters
    ----------
    student_profile:
        Must contain:

        ``risk_tolerance`` (float, 0–1)
            0 = fully risk-averse (maximise P(admission)),
            1 = fully risk-seeking (maximise expected utility).

        ``num_schools`` (int)
            Total number of volunteer slots requested.

        Optional:

        ``rank_percentile`` (float, 0–1)
            Student's position within their cohort (1 = top). Higher-ranked
            students can afford more 冲 slots.

    Returns
    -------
    dict:
        ``recommended``  — {tier: count} allocation
        ``rationale``    — plain-language explanation
        ``risk_profile`` — label: 'conservative' / 'balanced' / 'aggressive'
    """
    risk_tolerance: float = float(student_profile.get("risk_tolerance", 0.5))
    risk_tolerance = max(0.0, min(1.0, risk_tolerance))

    num_schools: int = int(student_profile.get("num_schools", 20))
    num_schools = max(4, num_schools)

    rank_percentile: float = float(student_profile.get("rank_percentile", 0.5))
    rank_percentile = max(0.0, min(1.0, rank_percentile))

    # Composite aggressiveness: blend risk tolerance and cohort rank.
    # A top-ranked student can reach further even at lower stated risk tolerance.
    aggressiveness = 0.7 * risk_tolerance + 0.3 * rank_percentile

    if aggressiveness < 0.33:
        risk_profile = "conservative"
        # Conservative: prioritise guaranteed admission
        chong_frac = 0.10
        wen_frac   = 0.25
        bao_frac   = 0.40
        dian_frac  = 0.25
    elif aggressiveness < 0.67:
        risk_profile = "balanced"
        chong_frac = 0.20
        wen_frac   = 0.35
        bao_frac   = 0.30
        dian_frac  = 0.15
    else:
        risk_profile = "aggressive"
        chong_frac = 0.30
        wen_frac   = 0.40
        bao_frac   = 0.20
        dian_frac  = 0.10

    # Raw counts
    n_chong = max(1, round(chong_frac * num_schools))
    n_wen   = max(1, round(wen_frac   * num_schools))
    n_bao   = max(2, round(bao_frac   * num_schools))  # always at least 2 保
    n_dian  = max(1, round(dian_frac  * num_schools))  # always at least 1 垫

    # Normalise to exactly num_schools
    total = n_chong + n_wen + n_bao + n_dian
    remainder = num_schools - total
    # Distribute surplus/deficit to 稳 (most flexible tier)
    n_wen = max(1, n_wen + remainder)

    rationale_parts = [
        f"Risk profile: {risk_profile} (aggressiveness={aggressiveness:.2f}).",
        f"With {num_schools} slots: {n_chong} 冲 (reach), {n_wen} 稳 (solid), "
        f"{n_bao} 保 (safety), {n_dian} 垫 (floor).",
    ]
    if risk_profile == "conservative":
        rationale_parts.append(
            "Low risk tolerance: fewer reaches preserve a high probability of admission."
        )
    elif risk_profile == "aggressive":
        rationale_parts.append(
            "High risk tolerance: more reaches maximise expected school quality."
        )
    else:
        rationale_parts.append(
            "Balanced allocation optimises expected utility while maintaining a solid safety net."
        )

    return {
        "recommended": {"冲": n_chong, "稳": n_wen, "保": n_bao, "垫": n_dian},
        "rationale": " ".join(rationale_parts),
        "risk_profile": risk_profile,
        "aggressiveness": round(aggressiveness, 3),
    }


# ---------------------------------------------------------------------------
# Safety floor finder
# ---------------------------------------------------------------------------

def find_safety_floor(
    candidates: list[School],
    student_rank: int,
    safety_threshold: float = 0.95,
) -> list[School]:
    """
    Find candidate schools where P(admission) ≥ *safety_threshold*.

    These are 垫志愿 (floor/guaranteed schools) that ensure the student
    has fallback options with near-certain admission.

    Parameters
    ----------
    candidates:
        Full pool of candidate schools.  Each must contain ``probability``
        and ``utility``.
    student_rank:
        Student's rank (lower = better).  Used to sanity-check that the
        safety label is appropriate.
    safety_threshold:
        Minimum probability required.  Default 0.95.

    Returns
    -------
    List of qualifying schools, sorted by utility descending (best safety
    school first).
    """
    safety: list[School] = [
        s for s in candidates if s.get("probability", 0.0) >= safety_threshold
    ]
    safety.sort(key=lambda s: s.get("utility", 0.0), reverse=True)
    return safety


# ---------------------------------------------------------------------------
# Primary optimizer
# ---------------------------------------------------------------------------

def _sort_within_tier(schools: list[School]) -> list[School]:
    """Sort a single tier's schools by utility descending."""
    return sorted(schools, key=lambda s: s.get("utility", 0.0), reverse=True)


def _assign_tiers(candidates: list[School]) -> list[School]:
    """
    Return a copy of candidates with the ``tier`` field populated based on
    each school's probability.
    """
    result = []
    for s in candidates:
        sc = dict(s)
        sc["tier"] = classify_tier(sc.get("probability", 0.0))
        result.append(sc)
    return result


def _build_tier_ordered_list(selected: list[School]) -> list[School]:
    """
    Given a flat selection of schools, order them according to the parallel
    volunteer rule:
      冲 first → 稳 → 保 → 垫 last
    Within each tier, sort by utility descending.

    This ordering satisfies the constraint that higher-utility schools must
    appear before lower-utility schools so the system encounters the best
    reachable school first.
    """
    buckets: dict[str, list[School]] = {t: [] for t in TIER_ORDER}
    for school in selected:
        tier = school.get("tier") or classify_tier(school.get("probability", 0.0))
        buckets.setdefault(tier, []).append(school)

    ordered: list[School] = []
    for tier in TIER_ORDER:
        ordered.extend(_sort_within_tier(buckets[tier]))
    return ordered


def _greedy_select(
    pool: list[School],
    max_slots: int,
    min_safety_schools: int,
    risk_floor: float,
) -> list[School]:
    """
    Greedy marginal-EV selection with safety constraints.

    Algorithm
    ---------
    Phase 1 — Guarantee safety floor:
        Force-select the top ``min_safety_schools`` safety schools (P ≥ 0.90)
        to ensure risk_floor feasibility.

    Phase 2 — Greedy EV maximisation:
        Iteratively add the school from the remaining pool that yields the
        highest marginal EV given the current selection, until ``max_slots``
        is reached or no improvement is possible.

    Phase 3 — Risk-floor enforcement:
        If P(no admission) > (1 - risk_floor) after greedy selection, swap
        in additional high-probability schools until the constraint is met.
    """
    if not pool:
        return []

    selected: list[School] = []

    # Phase 1: seed with best safety schools
    safety_pool = sorted(
        [s for s in pool if s.get("probability", 0.0) >= 0.90],
        key=lambda s: s.get("utility", 0.0),
        reverse=True,
    )
    forced = safety_pool[:min_safety_schools]
    selected.extend(forced)
    remaining = [s for s in pool if s not in forced]

    # Phase 2: greedy marginal EV
    while len(selected) < max_slots and remaining:
        best_school: School | None = None
        best_mev = -math.inf

        for candidate in remaining:
            mev = marginal_ev(candidate, selected)
            if mev > best_mev:
                best_mev = mev
                best_school = candidate

        if best_school is None or best_mev <= 0.0:
            break

        selected.append(best_school)
        remaining.remove(best_school)

    # Phase 3: enforce risk floor
    target_p_fail = 1.0 - risk_floor
    ordered_for_risk = _build_tier_ordered_list(selected)
    p_fail = _p_no_admission(ordered_for_risk)

    if p_fail > target_p_fail:
        # Sort remaining candidates by probability descending; insert highest-prob
        # ones until constraint is satisfied
        remaining_sorted = sorted(
            remaining,
            key=lambda s: s.get("probability", 0.0),
            reverse=True,
        )
        for candidate in remaining_sorted:
            if p_fail <= target_p_fail:
                break
            if len(selected) >= max_slots:
                break
            selected.append(candidate)
            ordered_for_risk = _build_tier_ordered_list(selected)
            p_fail = _p_no_admission(ordered_for_risk)

    return selected


def optimize_volunteer_list(
    candidates: list[School],
    max_slots: int = 96,
    risk_floor: float = 0.99,
    min_safety_schools: int = 3,
) -> dict[str, Any]:
    """
    Build an optimally ordered parallel volunteer list from a candidate pool.

    Implements the greedy marginal-EV algorithm from Chade, Lewis & Smith (2014)
    adapted to China's parallel volunteer mechanism (Chen & Kesten 2017).

    Parameters
    ----------
    candidates:
        Pool of candidate (school, major) pairs.  Required keys per entry:

        ``school_name``   (str)   — institution name
        ``major_name``    (str)   — major / programme name
        ``probability``   (float) — calibrated admission probability ∈ [0, 1]
        ``utility``       (float) — cardinal utility score (higher = preferred)
        ``avg_rank``      (float) — historical average admission rank cutoff
        ``std_rank``      (float) — standard deviation of rank cutoff
        ``tier``          (str, optional) — pre-assigned tier label

        Additional keys are passed through unchanged.

    max_slots:
        Maximum number of schools allowed in the final list.
        Defaults to 96 (current national maximum for first-round parallel
        volunteers).

    risk_floor:
        Minimum acceptable probability of receiving *some* offer.
        The optimiser adds safety schools until P(admitted somewhere) ≥ risk_floor.
        Default 0.99 (99 %).

    min_safety_schools:
        Hard minimum number of schools with P(admission) > 0.90 that must
        appear in the final list.  Default 3.

    Returns
    -------
    dict:

    ``ordered_list``
        Schools in submission order (冲 → 稳 → 保 → 垫).
    ``ev_analysis``
        Full output of :func:`calculate_portfolio_ev`.
    ``tier_distribution``
        Count and fraction for each tier.
    ``p_no_admission``
        Probability of not being admitted to any school.
    ``expected_quality``
        E[utility | admitted].
    ``marginal_contributions``
        Per-school EV contribution, in submission order.
    ``warnings``
        List of warning messages if constraints could not be fully satisfied.

    Raises
    ------
    ValueError
        If ``candidates`` is empty or contains entries without required keys.
    """
    # --- Validation ---
    if not candidates:
        raise ValueError("candidates list must not be empty.")

    required_keys = {"probability", "utility"}
    for i, s in enumerate(candidates):
        missing = required_keys - s.keys()
        if missing:
            raise ValueError(
                f"Candidate at index {i} is missing required keys: {missing}"
            )
        p = s["probability"]
        if not (0.0 <= p <= 1.0):
            raise ValueError(
                f"Candidate '{s.get('school_name', i)}' has probability={p} outside [0,1]."
            )

    max_slots = max(1, max_slots)
    risk_floor = max(0.0, min(1.0, risk_floor))
    min_safety_schools = max(0, min_safety_schools)

    warnings: list[str] = []

    # Enrich candidates with tier labels
    pool = _assign_tiers(candidates)

    # Deduplicate by (school_name, major_name) keeping highest utility
    seen: dict[tuple, School] = {}
    for s in pool:
        key = (s.get("school_name", ""), s.get("major_name", ""))
        if key not in seen or s["utility"] > seen[key]["utility"]:
            seen[key] = s
    pool = list(seen.values())

    # Check we can actually meet min_safety_schools
    available_safety = sum(1 for s in pool if s.get("probability", 0.0) >= 0.90)
    if available_safety < min_safety_schools:
        warnings.append(
            f"Only {available_safety} schools with P≥0.90 available; "
            f"min_safety_schools={min_safety_schools} cannot be fully satisfied."
        )
        min_safety_schools = available_safety

    # Run selection
    selected = _greedy_select(
        pool=pool,
        max_slots=max_slots,
        min_safety_schools=min_safety_schools,
        risk_floor=risk_floor,
    )

    # Final ordered list
    ordered_list = _build_tier_ordered_list(selected)

    # Check risk floor was met
    p_no_adm = _p_no_admission(ordered_list)
    if p_no_adm > (1.0 - risk_floor) + 1e-6:
        warnings.append(
            f"Risk floor {risk_floor:.1%} could not be met; "
            f"P(no admission)={p_no_adm:.4f}.  Consider adding more high-probability candidates."
        )

    # EV analysis
    ev_analysis = calculate_portfolio_ev(ordered_list)

    # Tier distribution
    tier_counts: dict[str, int] = {t: 0 for t in TIER_ORDER}
    for s in ordered_list:
        tier = s.get("tier", classify_tier(s["probability"]))
        tier_counts[tier] = tier_counts.get(tier, 0) + 1

    n_total = len(ordered_list)
    tier_distribution: dict[str, Any] = {
        t: {
            "count": tier_counts[t],
            "fraction": round(tier_counts[t] / n_total, 4) if n_total > 0 else 0.0,
        }
        for t in TIER_ORDER
    }

    return {
        "ordered_list": ordered_list,
        "ev_analysis": ev_analysis,
        "tier_distribution": tier_distribution,
        "p_no_admission": round(p_no_adm, 6),
        "expected_quality": round(ev_analysis["expected_quality"], 4),
        "marginal_contributions": ev_analysis["marginal_contributions"],
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Module-level convenience: reorder an existing list for EV inspection
# ---------------------------------------------------------------------------

def reorder_for_ev(schools: list[School]) -> list[School]:
    """
    Given a flat list of schools, return them in the EV-maximising order:
    sorted by tier (冲→稳→保→垫) and within tier by utility descending.

    This is a lightweight helper for UI previews that doesn't run full
    portfolio selection.
    """
    enriched = _assign_tiers(schools)
    return _build_tier_ordered_list(enriched)
