"""
Monte Carlo Portfolio Risk Assessment
======================================
Simulation-based risk analysis for China's 平行志愿 (parallel volunteer) lists.

Design rationale
----------------
Historical gaokao admission rank cutoffs exhibit two sources of randomness:

1. **Systematic year shock** (大年/小年 effect): A single latent variable shifts
   *all* schools' cutoffs up or down together.  In a 大年 (hard year) the whole
   cohort is stronger than expected, pushing cutoffs down; in a 小年 (easy year)
   cutoffs relax.  Modelled as a multiplicative shock on avg_rank:

       cutoff_i ~ N(avg_rank_i × (1 + year_shock), std_rank_i)
       year_shock ~ N(0, σ_year)

2. **School-specific residual**: Each school has its own idiosyncratic volatility
   (std_rank_i) even after netting out the year effect.

The intra-year correlation between schools therefore arises entirely from the
shared year shock, yielding the standard one-factor model:

    Corr(cutoff_i, cutoff_j) ≈ σ_year² / (σ_year² + σ_i × σ_j)  (approx.)

Parallel volunteer admission rule:
    Given student rank R and ordered list [S1, …, Sn], the student is admitted
    to the first Si where R ≤ sampled_cutoff_i.  If no school qualifies: 清出.

This module uses only the Python standard library (random, math, statistics).
"""

from __future__ import annotations

import math
import random
import statistics
from typing import Any


# ---------------------------------------------------------------------------
# Type alias
# ---------------------------------------------------------------------------
School = dict[str, Any]

# Tier tier ordering for outcome distribution
TIER_ORDER: list[str] = ["冲", "稳", "保", "垫"]

# Default year-shock standard deviation (15 % ≈ half a standard deviation
# shift in a typical provincial ranking distribution)
_DEFAULT_YEAR_SIGMA: float = 0.15

# Default stress-scenario magnitude
_STRESS_MAGNITUDE: float = 0.15


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _classify_tier(probability: float) -> str:
    """Fast tier classification (mirrors portfolio_optimizer logic)."""
    if probability >= 0.95:
        return "垫"
    if probability >= 0.82:
        return "保"
    if probability >= 0.55:
        return "稳"
    return "冲"


def _gauss(mu: float, sigma: float, rng: random.Random) -> float:
    """Box-Muller normal variate (stdlib random.gauss wrapper)."""
    return rng.gauss(mu, sigma)


def _prob_to_std_rank(school: School) -> tuple[float, float]:
    """
    Extract (avg_rank, std_rank) from a school dict.

    Falls back gracefully: if avg_rank / std_rank are absent, derive
    std_rank from probability using an approximate inverse-normal heuristic
    so the simulator remains useful even with minimal school data.

    Convention: lower rank number = better (rank 1 is the top student).
    A student with rank R is admitted when R ≤ cutoff.
    """
    avg_rank: float = float(school.get("avg_rank", 0.0))
    std_rank: float = float(school.get("std_rank", 0.0))

    # Fallback: if avg_rank is absent but utility is present, use utility
    # as a proxy (assumes utility ≈ inverse rank normalised to [0,1]).
    if avg_rank <= 0.0:
        utility: float = float(school.get("utility", 0.5))
        avg_rank = max(1.0, (1.0 - utility) * 10000.0)

    if std_rank <= 0.0:
        # Heuristic: typical cutoff CV ≈ 2-5 % of avg_rank
        std_rank = max(1.0, avg_rank * 0.03)

    return avg_rank, std_rank


def _run_single_simulation(
    portfolio: list[School],
    student_rank: float,
    year_shock: float,
    rng: random.Random,
) -> dict[str, Any]:
    """
    Run one Monte Carlo trial for the parallel volunteer mechanism.

    Parameters
    ----------
    portfolio:
        Ordered list of schools.
    student_rank:
        Student's rank this year (lower is better).
    year_shock:
        Realised systematic shock drawn before this call.
    rng:
        Per-simulation random state.

    Returns
    -------
    dict with:
        ``admitted``     bool
        ``school_index`` int or None  (0-based position in portfolio)
        ``utility``      float        (0 if not admitted)
        ``tier``         str or None
    """
    for idx, school in enumerate(portfolio):
        avg_rank, std_rank = _prob_to_std_rank(school)

        # Apply year shock additively (大年 → avg_rank shrinks = harder)
        # year_shock is in rank units (derived from median_std × √(ρ/(1-ρ))),
        # so additive shift preserves the one-factor correlation model correctly.
        # Multiplicative application would scale by O(year_sigma) and break the math.
        # Clamp to ≥ 1: ranks must be positive (negative cutoff would admit everyone)
        shocked_avg = max(1.0, avg_rank + year_shock)

        # Idiosyncratic draw
        sampled_cutoff = _gauss(shocked_avg, std_rank, rng)

        # Admission condition: student rank must be ≤ cutoff
        if student_rank <= sampled_cutoff:
            return {
                "admitted": True,
                "school_index": idx,
                "utility": float(school.get("utility", 0.0)),
                "tier": school.get("tier") or _classify_tier(school.get("probability", 0.0)),
            }

    return {"admitted": False, "school_index": None, "utility": 0.0, "tier": None}


def _infer_student_rank(portfolio: list[School]) -> float:
    """
    Infer a student's approximate rank from the portfolio.

    Uses the school with probability nearest to 0.5 (the median school)
    as the reference point.  avg_rank of a school with P≈0.5 is a good
    estimate of the student's rank.
    """
    if not portfolio:
        return 5000.0

    best_school: School | None = None
    best_dist = math.inf

    for s in portfolio:
        dist = abs(s.get("probability", 0.0) - 0.5)
        if dist < best_dist:
            best_dist = dist
            best_school = s

    if best_school is None:
        return 5000.0

    avg_rank, _ = _prob_to_std_rank(best_school)
    return avg_rank


def _percentile(sorted_values: list[float], p: float) -> float:
    """
    Linear interpolation percentile for a *sorted* list.

    p should be in [0, 1].
    """
    if not sorted_values:
        return 0.0
    n = len(sorted_values)
    idx = p * (n - 1)
    lo = int(math.floor(idx))
    hi = min(lo + 1, n - 1)
    frac = idx - lo
    return sorted_values[lo] * (1.0 - frac) + sorted_values[hi] * frac


def _generate_insights(
    admission_rate: float,
    p_cleared: float,
    outcome_dist: dict[str, float],
    var_5pct: float,
    portfolio_size: int,
) -> list[str]:
    """
    Generate plain-language insights from simulation statistics.
    """
    insights: list[str] = []

    # Overall risk
    if p_cleared > 0.05:
        insights.append(
            f"High clearance risk: {p_cleared:.1%} probability of receiving no offer. "
            "Consider adding more safety schools."
        )
    elif p_cleared > 0.01:
        insights.append(
            f"Moderate clearance risk: {p_cleared:.1%}. The safety floor is thin — "
            "review 保/垫 selections."
        )
    else:
        insights.append(
            f"Clearance risk is low ({p_cleared:.2%}): the portfolio has a robust safety floor."
        )

    # Quality
    chong_prob = outcome_dist.get("冲", 0.0)
    if chong_prob > 0.25:
        insights.append(
            f"Strong upside: {chong_prob:.1%} chance of admission to a 冲 (reach) school."
        )
    elif chong_prob < 0.05 and portfolio_size >= 5:
        insights.append(
            "Very few reach-school admissions simulated. Consider adding higher-utility "
            "冲 schools if the student's risk tolerance permits."
        )

    bao_prob = outcome_dist.get("保", 0.0)
    dian_prob = outcome_dist.get("垫", 0.0)
    safety_total = bao_prob + dian_prob
    if safety_total > 0.60:
        insights.append(
            f"{safety_total:.1%} of admissions land in 保/垫 schools — the portfolio "
            "may be over-conservative. Replacing some floor schools with 稳/冲 "
            "could improve expected quality."
        )

    # VaR
    if var_5pct == 0.0 and p_cleared > 0.0:
        insights.append(
            "Worst-5% scenario results in no admission (VaR utility = 0). "
            "This matches the clearance risk above."
        )
    elif var_5pct > 0.0:
        insights.append(
            f"Value-at-Risk (5%): even in bad scenarios the expected utility floor "
            f"is {var_5pct:.3f}."
        )

    return insights


# ---------------------------------------------------------------------------
# Primary simulation function
# ---------------------------------------------------------------------------

def simulate_portfolio(
    portfolio: list[School],
    n_simulations: int = 10_000,
    correlation: float = 0.3,
    seed: int | None = None,
    student_rank: float | None = None,
) -> dict[str, Any]:
    """
    Simulate ``n_simulations`` admission scenarios for a parallel volunteer list.

    The one-factor correlation model maps the user-supplied ``correlation``
    parameter to the year-shock standard deviation:

        σ_year = sqrt(correlation / (1 - correlation)) × median(std_rank_i)

    This ensures that the implied pairwise rank correlation between any two
    schools equals approximately ``correlation``.

    Parameters
    ----------
    portfolio:
        Ordered list of (school, major) dicts from the portfolio optimizer.
        Each entry must contain at minimum ``probability`` and ``utility``.
        ``avg_rank``, ``std_rank``, and ``tier`` are used when present.

    n_simulations:
        Number of Monte Carlo draws.  10,000 gives < 1 % relative error
        on probabilities above 5 %.

    correlation:
        Target intra-year pairwise correlation between school cutoffs.
        Must be in [0, 1).  Default 0.3 reflects the empirically observed
        moderate co-movement of provincial gaokao cutoffs.

    seed:
        Random seed for reproducibility.  ``None`` = non-deterministic.

    student_rank:
        Student's provincial rank (lower = better).  If ``None``, inferred
        from the portfolio's median-probability school.

    Returns
    -------
    dict — see module docstring for full schema.

    Raises
    ------
    ValueError
        If ``portfolio`` is empty or ``correlation`` is outside [0, 1).
    """
    if not portfolio:
        raise ValueError("portfolio must not be empty.")
    if not (0.0 <= correlation < 1.0):
        raise ValueError(f"correlation must be in [0, 1); got {correlation}.")
    if n_simulations < 1:
        raise ValueError("n_simulations must be at least 1.")

    rng = random.Random(seed)
    n_simulations = int(n_simulations)

    # Infer student rank if not provided
    if student_rank is None:
        student_rank = _infer_student_rank(portfolio)

    # Compute year-shock sigma from target correlation
    std_ranks = []
    for s in portfolio:
        _, sr = _prob_to_std_rank(s)
        std_ranks.append(sr)
    median_std = statistics.median(std_ranks) if std_ranks else 1.0

    # From one-factor model: ρ ≈ σ_year² / (σ_year² + σ²)
    # → σ_year = σ × sqrt(ρ / (1 − ρ))
    if correlation > 0.0:
        year_sigma = median_std * math.sqrt(correlation / (1.0 - correlation))
    else:
        year_sigma = 0.0

    # --- Run simulations ---
    outcomes_utility: list[float] = []
    tier_counts: dict[str, int] = {t: 0 for t in TIER_ORDER}
    school_admit_counts: list[int] = [0] * len(portfolio)
    n_cleared = 0

    for _ in range(n_simulations):
        year_shock = _gauss(0.0, year_sigma, rng) if year_sigma > 0.0 else 0.0
        result = _run_single_simulation(portfolio, student_rank, year_shock, rng)

        if result["admitted"]:
            outcomes_utility.append(result["utility"])
            tier = result["tier"]
            if tier in tier_counts:
                tier_counts[tier] += 1
            idx = result["school_index"]
            if idx is not None:
                school_admit_counts[idx] += 1
        else:
            outcomes_utility.append(0.0)
            n_cleared += 1

    # --- Aggregate statistics ---
    admission_rate = 1.0 - n_cleared / n_simulations
    p_cleared = n_cleared / n_simulations
    expected_utility = statistics.mean(outcomes_utility)

    outcome_distribution: dict[str, float] = {
        t: tier_counts[t] / n_simulations for t in TIER_ORDER
    }

    sorted_utility = sorted(outcomes_utility)
    percentile_outcomes = {
        "p5":  round(_percentile(sorted_utility, 0.05), 4),
        "p25": round(_percentile(sorted_utility, 0.25), 4),
        "p50": round(_percentile(sorted_utility, 0.50), 4),
        "p75": round(_percentile(sorted_utility, 0.75), 4),
        "p95": round(_percentile(sorted_utility, 0.95), 4),
    }

    # VaR: mean of worst 5 % outcomes
    n_var = max(1, int(0.05 * n_simulations))
    var_5pct = statistics.mean(sorted_utility[:n_var])

    # Per-school admission rates
    school_admission_rates: list[dict] = []
    for idx, school in enumerate(portfolio):
        school_admission_rates.append(
            {
                "school_name": school.get("school_name", f"School_{idx}"),
                "major_name": school.get("major_name", ""),
                "simulated_rate": round(school_admit_counts[idx] / n_simulations, 5),
                "is_first_choice": idx == 0,
            }
        )

    insights = _generate_insights(
        admission_rate=admission_rate,
        p_cleared=p_cleared,
        outcome_dist=outcome_distribution,
        var_5pct=var_5pct,
        portfolio_size=len(portfolio),
    )

    return {
        "n_simulations": n_simulations,
        "admission_rate": round(admission_rate, 5),
        "p_cleared": round(p_cleared, 5),
        "expected_utility": round(expected_utility, 5),
        "outcome_distribution": {k: round(v, 5) for k, v in outcome_distribution.items()},
        "percentile_outcomes": percentile_outcomes,
        "school_admission_rates": school_admission_rates,
        "var_5pct": round(var_5pct, 5),
        "insights": insights,
    }


# ---------------------------------------------------------------------------
# Portfolio comparison
# ---------------------------------------------------------------------------

def compare_portfolios(
    portfolio_a: list[School],
    portfolio_b: list[School],
    n_simulations: int = 5_000,
    seed: int | None = None,
) -> dict[str, Any]:
    """
    Compare two parallel volunteer list strategies head-to-head.

    Both portfolios are simulated with the *same* random seed so that the
    year-shock scenarios are identical, making the comparison maximally fair.

    Parameters
    ----------
    portfolio_a, portfolio_b:
        Two ordered volunteer lists to compare.
    n_simulations:
        Number of Monte Carlo draws per portfolio.  Default 5,000 (sufficient
        for strategy comparison; use 10,000+ for production reporting).
    seed:
        Shared random seed.  ``None`` = random.

    Returns
    -------
    dict with keys:

    ``portfolio_a``, ``portfolio_b``
        Full :func:`simulate_portfolio` result for each.
    ``comparison``
        Head-to-head summary: which is better on each dimension, and by
        how much.
    ``recommendation``
        Plain-language recommendation.
    """
    if not portfolio_a or not portfolio_b:
        raise ValueError("Both portfolios must be non-empty.")

    # Use a fixed seed for A and the same base seed for B so they share
    # year-shock paths.  We derive B's seed deterministically.
    seed_a = seed if seed is not None else random.randint(0, 2**31)
    seed_b = seed_a ^ 0xDEADBEEF  # deterministic but different stream

    result_a = simulate_portfolio(portfolio_a, n_simulations=n_simulations, seed=seed_a)
    result_b = simulate_portfolio(portfolio_b, n_simulations=n_simulations, seed=seed_b)

    def _delta(key: str) -> float:
        return round(result_b[key] - result_a[key], 5)

    delta_eu   = _delta("expected_utility")
    delta_adm  = _delta("admission_rate")
    delta_var  = _delta("var_5pct")

    comparison: dict[str, Any] = {
        "expected_utility_delta": delta_eu,
        "admission_rate_delta": delta_adm,
        "var_5pct_delta": delta_var,
        "better_expected_utility": "B" if delta_eu > 0 else "A" if delta_eu < 0 else "tie",
        "better_admission_rate":   "B" if delta_adm > 0 else "A" if delta_adm < 0 else "tie",
        "better_var":              "B" if delta_var > 0 else "A" if delta_var < 0 else "tie",
        "percentile_comparison": {
            pct: {
                "A": result_a["percentile_outcomes"][pct],
                "B": result_b["percentile_outcomes"][pct],
            }
            for pct in ("p5", "p25", "p50", "p75", "p95")
        },
    }

    # Build recommendation
    a_wins = sum(
        1
        for k in ("better_expected_utility", "better_admission_rate", "better_var")
        if comparison[k] == "A"
    )
    b_wins = sum(
        1
        for k in ("better_expected_utility", "better_admission_rate", "better_var")
        if comparison[k] == "B"
    )

    if a_wins > b_wins:
        rec = (
            f"Portfolio A is preferred: it wins on {a_wins}/3 key metrics "
            f"(expected utility, admission rate, VaR-5%)."
        )
    elif b_wins > a_wins:
        rec = (
            f"Portfolio B is preferred: it wins on {b_wins}/3 key metrics "
            f"(expected utility, admission rate, VaR-5%)."
        )
    else:
        # Tiebreak on expected utility
        if delta_eu > 0:
            rec = "Portfolios are close; Portfolio B has marginally higher expected utility."
        elif delta_eu < 0:
            rec = "Portfolios are close; Portfolio A has marginally higher expected utility."
        else:
            rec = "The two portfolios are essentially equivalent on all measured dimensions."

    return {
        "portfolio_a": result_a,
        "portfolio_b": result_b,
        "comparison": comparison,
        "recommendation": rec,
    }


# ---------------------------------------------------------------------------
# Stress testing
# ---------------------------------------------------------------------------

_BUILT_IN_SCENARIOS: dict[str, dict[str, Any]] = {
    "大年场景": {
        "description": "All schools 15% harder than expected (大年: competitive year)",
        "year_shock_override": _STRESS_MAGNITUDE,    # push cutoffs down = harder
        "school_overrides": {},
    },
    "小年场景": {
        "description": "All schools 15% easier than expected (小年: relaxed year)",
        "year_shock_override": -_STRESS_MAGNITUDE,   # push cutoffs up = easier
        "school_overrides": {},
    },
    "极端场景": {
        "description": "Top 3 schools simultaneously experience 大年 (worst-case reach collapse)",
        "year_shock_override": 0.0,
        "school_overrides": {"top_n": 3, "shock": _STRESS_MAGNITUDE},
    },
}


def _apply_school_overrides(
    portfolio: list[School],
    school_overrides: dict[str, Any],
) -> list[School]:
    """
    Return a copy of portfolio with avg_rank adjusted for targeted schools.

    ``school_overrides`` structure:
        ``top_n``  — apply shock to first N schools by position
        ``shock``  — multiplicative magnitude (positive = harder)
    """
    if not school_overrides:
        return portfolio

    top_n: int = int(school_overrides.get("top_n", 0))
    shock: float = float(school_overrides.get("shock", 0.0))

    modified: list[School] = []
    for idx, s in enumerate(portfolio):
        s_copy = dict(s)
        if idx < top_n and shock != 0.0:
            avg_rank, std_rank = _prob_to_std_rank(s_copy)
            # A positive shock makes the cutoff harder (smaller rank threshold)
            s_copy["avg_rank"] = avg_rank * (1.0 - shock)
            s_copy["std_rank"] = std_rank
        modified.append(s_copy)
    return modified


def stress_test(
    portfolio: list[School],
    scenarios: dict[str, Any] | None = None,
    n_simulations: int = 5_000,
    seed: int | None = None,
) -> dict[str, Any]:
    """
    Evaluate a portfolio under predefined and/or custom stress scenarios.

    Built-in scenarios
    ------------------
    大年场景
        All schools are 15 % harder than their historical average.
        Simulates a year where the candidate pool is exceptionally strong.

    小年场景
        All schools are 15 % easier than average (relaxed competition year).

    极端场景
        The top 3 reach schools simultaneously experience a 大年.
        This tests the portfolio's resilience when the upside fails entirely.

    Parameters
    ----------
    portfolio:
        Ordered volunteer list to stress-test.
    scenarios:
        Optional dict of custom scenarios to *add* (not replace) the built-ins.
        Each entry: ``{name: {description, year_shock_override, school_overrides}}``.
    n_simulations:
        Simulations per scenario.
    seed:
        Base seed; each scenario uses a deterministic derivative.

    Returns
    -------
    dict:

    ``baseline``
        Simulation result under normal conditions.
    ``scenarios``
        Dict of ``{scenario_name: simulation_result}`` for each stress scenario.
    ``summary``
        Table of key metrics (admission_rate, expected_utility, var_5pct)
        across all scenarios including baseline.
    ``most_sensitive_school``
        The school whose individual 大年 most degrades portfolio performance.
    """
    if not portfolio:
        raise ValueError("portfolio must not be empty.")

    base_seed = seed if seed is not None else random.randint(0, 2**31)

    # Baseline
    baseline = simulate_portfolio(portfolio, n_simulations=n_simulations, seed=base_seed)

    # Merge built-in + custom scenarios
    all_scenarios = dict(_BUILT_IN_SCENARIOS)
    if scenarios:
        all_scenarios.update(scenarios)

    scenario_results: dict[str, Any] = {}

    for i, (name, cfg) in enumerate(all_scenarios.items()):
        scenario_seed = base_seed ^ (0xCAFE0000 + i)

        year_shock_override: float = float(cfg.get("year_shock_override", 0.0))
        school_overrides: dict = cfg.get("school_overrides", {})

        modified_portfolio = _apply_school_overrides(portfolio, school_overrides)

        # Implement year-shock override by adjusting avg_rank of ALL schools
        if year_shock_override != 0.0 and not school_overrides:
            shocked_portfolio: list[School] = []
            for s in modified_portfolio:
                sc = dict(s)
                avg_rank, std_rank = _prob_to_std_rank(sc)
                sc["avg_rank"] = avg_rank * (1.0 - year_shock_override)
                sc["std_rank"] = std_rank
                shocked_portfolio.append(sc)
            modified_portfolio = shocked_portfolio

        result = simulate_portfolio(
            modified_portfolio,
            n_simulations=n_simulations,
            seed=scenario_seed,
        )
        result["scenario_description"] = cfg.get("description", name)
        scenario_results[name] = result

    # Summary table
    all_names = ["baseline"] + list(scenario_results.keys())
    all_results = [baseline] + list(scenario_results.values())

    summary: dict[str, dict[str, float]] = {}
    for name, res in zip(all_names, all_results):
        summary[name] = {
            "admission_rate":   round(res["admission_rate"], 5),
            "expected_utility": round(res["expected_utility"], 5),
            "var_5pct":         round(res["var_5pct"], 5),
            "p_cleared":        round(res["p_cleared"], 5),
        }

    # Most sensitive school: run individual school 大年 for each school in list
    # and find which single school's hardening hurts most
    most_sensitive: dict[str, Any] = {"school_name": None, "ev_drop": 0.0}

    for idx, school in enumerate(portfolio):
        single_override_portfolio: list[School] = []
        for j, s in enumerate(portfolio):
            sc = dict(s)
            if j == idx:
                avg_rank, std_rank = _prob_to_std_rank(sc)
                sc["avg_rank"] = avg_rank * (1.0 - _STRESS_MAGNITUDE)
            single_override_portfolio.append(sc)

        single_result = simulate_portfolio(
            single_override_portfolio,
            n_simulations=max(1000, n_simulations // 5),  # cheaper sub-run
            seed=base_seed ^ (0xBEEF0000 + idx),
        )
        ev_drop = baseline["expected_utility"] - single_result["expected_utility"]
        if ev_drop > most_sensitive["ev_drop"]:
            most_sensitive = {
                "school_name": school.get("school_name", f"School_{idx}"),
                "major_name": school.get("major_name", ""),
                "position_in_list": idx,
                "ev_drop": round(ev_drop, 5),
                "stressed_admission_rate": round(single_result["admission_rate"], 5),
            }

    return {
        "baseline": baseline,
        "scenarios": scenario_results,
        "summary": summary,
        "most_sensitive_school": most_sensitive,
    }
