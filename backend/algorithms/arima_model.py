"""
arima_model.py
==============
AR(2) model for gaokao big-small year (大小年) detection and rank prediction.

Theory — AR(2) / ARIMA(2, 0, 0)
---------------------------------
An AR(2) process models the current observation as a linear combination of the
two immediately preceding observations plus a constant and white noise:

    rank_t = c + φ1 * rank_{t-1} + φ2 * rank_{t-2} + ε_t

Key coefficient interpretation:

    φ2 < -0.1   Strong oscillatory (big-small year) pattern.
                 A high-rank year (many spots) tends to be followed by a
                 low-rank year (fewer spots / higher competition) two years
                 later.

    -0.1 ≤ φ2 ≤ 0.1   Weak or negligible second-order auto-correlation.
                        No reliable big-small cycle present.

    φ2 > 0.1    Momentum / persistence — above-average years cluster together.

The coefficients are estimated via Ordinary Least Squares (OLS), implemented
from scratch using only the Python standard library so that the module works
without numpy, pandas, or statsmodels.

Long-term trend combination
----------------------------
The AR(2) prediction captures year-to-year oscillation but may drift from the
long-term trend when extrapolating.  To address this, the final prediction is
a weighted blend:

    prediction = α * ar2_forecast + (1 - α) * trend_forecast

where ``α`` = 0.7 (AR(2) dominates) and ``trend_forecast`` is obtained from a
simple linear regression of rank on year (also implemented from scratch).

Compatibility
-------------
:func:`detect_big_small_year_arima` returns a dictionary in the same format as
the existing ``detect_big_small_year()`` function so it can be used as a
drop-in replacement.
"""

from __future__ import annotations

import math
from typing import Any, Optional

# Weight given to AR(2) forecast vs. linear trend forecast.
_AR2_WEIGHT: float = 0.70
_TREND_WEIGHT: float = 1.0 - _AR2_WEIGHT

# Oscillation thresholds for φ2 interpretation.
_STRONG_OSCILLATION_THRESHOLD: float = -0.10
_MOMENTUM_THRESHOLD: float = 0.10

# Minimum number of data points required for AR(2) fitting.
_MIN_POINTS_AR2: int = 4


# ---------------------------------------------------------------------------
# Internal OLS utilities
# ---------------------------------------------------------------------------


def _mean(values: list[float]) -> float:
    """Return the arithmetic mean of *values*."""
    return sum(values) / len(values)


def _ols_univariate(x: list[float], y: list[float]) -> tuple[float, float]:
    """Simple OLS for ``y = a + b * x``.

    Returns
    -------
    tuple[float, float]
        ``(intercept, slope)``
    """
    n = len(x)
    mx = _mean(x)
    my = _mean(y)

    ss_xx = sum((xi - mx) ** 2 for xi in x)
    ss_xy = sum((xi - mx) * (yi - my) for xi, yi in zip(x, y))

    if ss_xx < 1e-12:
        return my, 0.0

    slope = ss_xy / ss_xx
    intercept = my - slope * mx
    return intercept, slope


def _ols_multivariate_2(
    x1: list[float],
    x2: list[float],
    y: list[float],
) -> tuple[float, float, float]:
    """OLS for ``y = b0 + b1*x1 + b2*x2`` using the normal equations.

    Returns
    -------
    tuple[float, float, float]
        ``(b0, b1, b2)`` — intercept and two slopes.
    """
    n = len(y)

    # Construct X matrix columns: [1, x1, x2]
    # Normal equations: (X'X) β = X'y
    # With 3 parameters the 3×3 system is solved analytically.

    sum_1 = float(n)
    sum_x1 = sum(x1)
    sum_x2 = sum(x2)
    sum_x1x1 = sum(a * a for a in x1)
    sum_x2x2 = sum(a * a for a in x2)
    sum_x1x2 = sum(a * b for a, b in zip(x1, x2))
    sum_y = sum(y)
    sum_x1y = sum(a * b for a, b in zip(x1, y))
    sum_x2y = sum(a * b for a, b in zip(x2, y))

    # A = X'X (3×3 symmetric matrix, row-major)
    a = [
        [sum_1,   sum_x1,   sum_x2],
        [sum_x1,  sum_x1x1, sum_x1x2],
        [sum_x2,  sum_x1x2, sum_x2x2],
    ]
    b_vec = [sum_y, sum_x1y, sum_x2y]

    # Gaussian elimination with partial pivoting.
    coeffs = _gauss_eliminate(a, b_vec)
    if coeffs is None:
        # Degenerate system — fall back to intercept-only.
        intercept = _mean(y)
        return intercept, 0.0, 0.0

    return coeffs[0], coeffs[1], coeffs[2]


def _gauss_eliminate(
    mat: list[list[float]],
    rhs: list[float],
) -> Optional[list[float]]:
    """Solve Ax = b via Gaussian elimination with partial pivoting.

    Parameters
    ----------
    mat:
        n×n coefficient matrix (modified in-place).
    rhs:
        Length-n right-hand side vector (modified in-place).

    Returns
    -------
    list[float] or None
        Solution vector, or ``None`` if the system is singular.
    """
    n = len(rhs)
    # Augment matrix.
    aug = [mat[i][:] + [rhs[i]] for i in range(n)]

    for col in range(n):
        # Partial pivot: find row with largest absolute value in this column.
        max_row = max(range(col, n), key=lambda r: abs(aug[r][col]))
        aug[col], aug[max_row] = aug[max_row], aug[col]

        pivot = aug[col][col]
        if abs(pivot) < 1e-12:
            return None  # Singular or near-singular.

        for row in range(col + 1, n):
            factor = aug[row][col] / pivot
            for j in range(col, n + 1):
                aug[row][j] -= factor * aug[col][j]

    # Back substitution.
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = aug[i][n]
        for j in range(i + 1, n):
            x[i] -= aug[i][j] * x[j]
        if abs(aug[i][i]) < 1e-12:
            return None
        x[i] /= aug[i][i]

    return x


def _std_dev(values: list[float]) -> float:
    """Population standard deviation."""
    if len(values) < 2:
        return 0.0
    m = _mean(values)
    variance = sum((v - m) ** 2 for v in values) / len(values)
    return math.sqrt(variance)


def _fill_gaps(years: list[int], ranks: list[float]) -> tuple[list[int], list[float]]:
    """Fill missing years in a time series with linear interpolation.

    Parameters
    ----------
    years:
        Sorted list of observed years (may have gaps).
    ranks:
        Corresponding rank values.

    Returns
    -------
    tuple[list[int], list[float]]
        Contiguous year range and interpolated rank values.
    """
    if not years:
        return [], []

    min_year = years[0]
    max_year = years[-1]
    full_years = list(range(min_year, max_year + 1))
    year_to_rank = dict(zip(years, ranks))

    filled_ranks: list[float] = []
    for y in full_years:
        if y in year_to_rank:
            filled_ranks.append(year_to_rank[y])
        else:
            # Linear interpolation between surrounding known values.
            prev_y = max((yr for yr in year_to_rank if yr < y), default=None)
            next_y = min((yr for yr in year_to_rank if yr > y), default=None)
            if prev_y is not None and next_y is not None:
                t = (y - prev_y) / (next_y - prev_y)
                interp = year_to_rank[prev_y] + t * (
                    year_to_rank[next_y] - year_to_rank[prev_y]
                )
                filled_ranks.append(interp)
            elif prev_y is not None:
                filled_ranks.append(year_to_rank[prev_y])
            else:
                filled_ranks.append(year_to_rank[next_y])  # type: ignore[arg-type]

    return full_years, filled_ranks


def _winsorize(values: list[float], k: float = 2.5) -> list[float]:
    """Clamp outliers to k standard deviations from the mean.

    Parameters
    ----------
    values:
        Input series.
    k:
        Number of standard deviations to allow.  Default 2.5.

    Returns
    -------
    list[float]
        Winsorized values.
    """
    if len(values) < 3:
        return list(values)
    m = _mean(values)
    sd = _std_dev(values)
    if sd < 1e-9:
        return list(values)
    lo = m - k * sd
    hi = m + k * sd
    return [max(lo, min(hi, v)) for v in values]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def fit_ar2(ranks: list[float]) -> Optional[dict[str, Any]]:
    """Fit an AR(2) model to a list of historical ranks via OLS.

    The model is::

        rank_t = c + φ1 * rank_{t-1} + φ2 * rank_{t-2} + ε_t

    Parameters
    ----------
    ranks:
        Chronologically ordered list of annual admission ranks.  Must contain
        at least :data:`_MIN_POINTS_AR2` (4) values.

    Returns
    -------
    dict or None
        Dictionary with keys:

        ``phi1``
            First-order autoregressive coefficient.
        ``phi2``
            Second-order autoregressive coefficient.
        ``constant``
            Intercept term *c*.
        ``has_oscillation``
            ``True`` if ``φ2 < -0.1`` (strong oscillatory pattern).
        ``oscillation_strength``
            Absolute value of ``φ2``; higher = stronger oscillation.
        ``fitted``
            List of in-sample fitted values (length = ``len(ranks) - 2``).
        ``residuals``
            List of residuals ``rank_t - fitted_t``.
        ``rmse``
            Root mean squared error of in-sample fit.

        Returns ``None`` if fewer than :data:`_MIN_POINTS_AR2` data points
        are provided.
    """
    if len(ranks) < _MIN_POINTS_AR2:
        return None

    # Winsorize to reduce leverage from extreme outliers before fitting.
    clean = _winsorize(list(ranks))

    # Build the lagged design matrix.
    y = clean[2:]
    x1 = clean[1:-1]   # rank_{t-1}
    x2 = clean[:-2]    # rank_{t-2}

    if len(y) < 2:
        return None

    constant, phi1, phi2 = _ols_multivariate_2(x1, x2, y)

    # Compute fitted values and residuals.
    fitted = [constant + phi1 * x1[i] + phi2 * x2[i] for i in range(len(y))]
    residuals = [y[i] - fitted[i] for i in range(len(y))]
    rmse = math.sqrt(_mean([r ** 2 for r in residuals]))

    has_oscillation = phi2 < _STRONG_OSCILLATION_THRESHOLD

    return {
        "phi1": phi1,
        "phi2": phi2,
        "constant": constant,
        "has_oscillation": has_oscillation,
        "oscillation_strength": abs(phi2),
        "fitted": fitted,
        "residuals": residuals,
        "rmse": rmse,
    }


def predict_next_rank(
    ranks: list[float],
    current_year: int,
) -> dict[str, Any]:
    """Predict the next year's admission rank using an AR(2) model.

    The prediction blends the AR(2) one-step-ahead forecast with a linear
    trend forecast::

        prediction = 0.70 * ar2_forecast + 0.30 * trend_forecast

    Falls back to a recency-weighted average when fewer than
    :data:`_MIN_POINTS_AR2` data points are available.

    Parameters
    ----------
    ranks:
        Chronologically ordered list of annual admission ranks ending at
        *current_year*.
    current_year:
        The year of the last observation in *ranks*.

    Returns
    -------
    dict
        Keys:

        ``predicted_rank``
            Estimated integer rank for next year.
        ``prediction_std``
            Standard deviation of prediction (proxy for uncertainty).
        ``is_big_year``
            ``True`` if next year is predicted to be a *big year* (high rank =
            easier admission); ``False`` otherwise.
        ``is_small_year``
            ``True`` if next year is predicted to be a *small year* (low rank =
            harder admission); ``False`` otherwise.
        ``oscillation_strength``
            Absolute value of φ2, or ``0.0`` if model not fitted.
        ``confidence``
            Qualitative confidence level: ``"high"``, ``"medium"``, or ``"low"``.
        ``model_used``
            ``"ar2"`` or ``"weighted_average"`` (fallback).
        ``reason``
            Human-readable explanation of the prediction.
    """
    next_year = current_year + 1

    # ------------------------------------------------------------------
    # Fallback: insufficient data
    # ------------------------------------------------------------------
    if len(ranks) < _MIN_POINTS_AR2:
        if len(ranks) == 0:
            return {
                "predicted_rank": 0,
                "prediction_std": 0.0,
                "is_big_year": False,
                "is_small_year": False,
                "oscillation_strength": 0.0,
                "confidence": "low",
                "model_used": "weighted_average",
                "reason": "No historical data available; no prediction possible.",
            }

        # Recency-weighted average: more recent years get higher weight.
        weights = [i + 1 for i in range(len(ranks))]
        total_w = sum(weights)
        weighted_avg = sum(r * w for r, w in zip(ranks, weights)) / total_w
        predicted = int(round(weighted_avg))
        std = _std_dev(ranks)

        return {
            "predicted_rank": predicted,
            "prediction_std": std,
            "is_big_year": False,
            "is_small_year": False,
            "oscillation_strength": 0.0,
            "confidence": "low",
            "model_used": "weighted_average",
            "reason": (
                f"Only {len(ranks)} data point(s) available; "
                "AR(2) requires at least 4.  Used recency-weighted average."
            ),
        }

    # ------------------------------------------------------------------
    # AR(2) forecast
    # ------------------------------------------------------------------
    model = fit_ar2(ranks)
    if model is None:
        # Should not happen given the length check above, but handle
        # defensively.
        return {
            "predicted_rank": int(round(_mean(list(ranks)))),
            "prediction_std": _std_dev(list(ranks)),
            "is_big_year": False,
            "is_small_year": False,
            "oscillation_strength": 0.0,
            "confidence": "low",
            "model_used": "weighted_average",
            "reason": "AR(2) fitting failed; fell back to mean.",
        }

    rank_tm1 = ranks[-1]   # most recent year
    rank_tm2 = ranks[-2]   # year before that

    ar2_forecast = (
        model["constant"]
        + model["phi1"] * rank_tm1
        + model["phi2"] * rank_tm2
    )

    # ------------------------------------------------------------------
    # Linear trend forecast
    # ------------------------------------------------------------------
    years = list(range(current_year - len(ranks) + 1, current_year + 1))
    intercept, slope = _ols_univariate(
        [float(y) for y in years],
        [float(r) for r in ranks],
    )
    trend_forecast = intercept + slope * float(next_year)

    # ------------------------------------------------------------------
    # Blend forecasts
    # ------------------------------------------------------------------
    blended = _AR2_WEIGHT * ar2_forecast + _TREND_WEIGHT * trend_forecast
    predicted_rank = max(1, int(round(blended)))

    # Prediction standard error ≈ model RMSE (lower bound; true SE would
    # account for forecast uncertainty, but RMSE is a reasonable proxy for
    # production use).
    prediction_std = model["rmse"]

    # ------------------------------------------------------------------
    # Big-small year classification
    # ------------------------------------------------------------------
    has_oscillation = model["has_oscillation"]
    mean_rank = _mean(list(ranks))
    std_rank = _std_dev(list(ranks))

    # A prediction more than 0.5 std above mean → big year (easier).
    # A prediction more than 0.5 std below mean → small year (harder).
    threshold = 0.5 * std_rank if std_rank > 0 else 1.0
    is_big_year = (predicted_rank > mean_rank + threshold) and has_oscillation
    is_small_year = (predicted_rank < mean_rank - threshold) and has_oscillation

    # ------------------------------------------------------------------
    # Confidence assessment
    # ------------------------------------------------------------------
    if len(ranks) >= 6 and model["rmse"] < 0.1 * mean_rank:
        confidence = "high"
    elif len(ranks) >= _MIN_POINTS_AR2 and model["rmse"] < 0.2 * mean_rank:
        confidence = "medium"
    else:
        confidence = "low"

    # ------------------------------------------------------------------
    # Human-readable reason
    # ------------------------------------------------------------------
    phi2 = model["phi2"]
    if phi2 < _STRONG_OSCILLATION_THRESHOLD:
        osc_desc = f"strong oscillatory pattern (φ2={phi2:.3f})"
    elif phi2 > _MOMENTUM_THRESHOLD:
        osc_desc = f"momentum pattern (φ2={phi2:.3f})"
    else:
        osc_desc = f"weak autocorrelation (φ2={phi2:.3f})"

    reason = (
        f"AR(2) model fitted on {len(ranks)} data points ({osc_desc}). "
        f"AR(2) forecast: {ar2_forecast:.0f}, trend forecast: {trend_forecast:.0f}, "
        f"blended ({int(_AR2_WEIGHT*100)}/{int(_TREND_WEIGHT*100)}): {blended:.0f}."
    )
    if is_big_year:
        reason += "  Predicted BIG year (高名次/更易录取)."
    elif is_small_year:
        reason += "  Predicted SMALL year (低名次/更难录取)."

    return {
        "predicted_rank": predicted_rank,
        "prediction_std": prediction_std,
        "is_big_year": is_big_year,
        "is_small_year": is_small_year,
        "oscillation_strength": model["oscillation_strength"],
        "confidence": confidence,
        "model_used": "ar2",
        "reason": reason,
    }


def detect_big_small_year_arima(records: list[dict]) -> dict[str, Any]:
    """Enhanced big-small year detection using AR(2).

    This function is a drop-in replacement for the existing
    ``detect_big_small_year()`` function.  It accepts the same *records*
    format and returns a compatible dictionary, with additional AR(2)-specific
    keys for consumers that can use the richer information.

    Parameters
    ----------
    records:
        List of dictionaries, each containing at least:

        ``year`` : int
            The exam year.
        ``min_rank`` : int or float
            The minimum (cutoff) admission rank for that year.

        Records need not be sorted; this function sorts by year internally.

    Returns
    -------
    dict
        Compatible with the existing ``detect_big_small_year()`` return value:

        ``is_big_year``
            ``True`` if next year is predicted to be a big year.
        ``is_small_year``
            ``True`` if next year is predicted to be a small year.
        ``predicted_rank``
            Predicted cutoff rank for next year.
        ``confidence``
            ``"high"``, ``"medium"``, or ``"low"``.
        ``reason``
            Human-readable explanation.
        ``oscillation_strength``
            Strength of the detected oscillation (AR(2) φ2 magnitude).
        ``model_used``
            ``"ar2"`` or ``"weighted_average"``.
        ``historical_ranks``
            Sorted list of ``(year, rank)`` pairs used in the model.

    Notes
    -----
    Fewer than 3 records causes an immediate fallback to a simple heuristic
    (last-year direction reversal) with ``confidence = "low"``.
    """
    if not records:
        return {
            "is_big_year": False,
            "is_small_year": False,
            "predicted_rank": 0,
            "confidence": "low",
            "reason": "No historical records provided.",
            "oscillation_strength": 0.0,
            "model_used": "none",
            "historical_ranks": [],
        }

    # Sort and extract, filter out None min_rank.
    sorted_records = sorted(
        [r for r in records if (r.get("min_rank") or 0) > 0],
        key=lambda r: r["year"]
    )
    if not sorted_records:
        return {
            "is_big_year": False, "is_small_year": False,
            "predicted_rank": 0, "confidence": "low",
            "reason": "No valid rank data.", "oscillation_strength": 0.0,
            "model_used": "none", "historical_ranks": [],
        }
    years = [int(r["year"]) for r in sorted_records]
    raw_ranks = [float(r["min_rank"]) for r in sorted_records]

    historical_ranks = list(zip(years, [int(r) for r in raw_ranks]))

    # ------------------------------------------------------------------
    # Heuristic fallback for very sparse data (< 3 records)
    # ------------------------------------------------------------------
    if len(sorted_records) < 3:
        reason = (
            f"Only {len(sorted_records)} record(s); insufficient for AR(2). "
            "Applying simple last-year direction reversal heuristic."
        )
        if len(raw_ranks) >= 2:
            # If last year rank went up (more competitive), predict reversal.
            direction = raw_ranks[-1] - raw_ranks[-2]
            predicted = max(1, int(round(raw_ranks[-1] - direction * 0.5)))
            is_big = direction < 0
            is_small = direction > 0
        else:
            predicted = int(round(raw_ranks[-1])) if raw_ranks else 0
            is_big = False
            is_small = False

        return {
            "is_big_year": is_big,
            "is_small_year": is_small,
            "predicted_rank": predicted,
            "confidence": "low",
            "reason": reason,
            "oscillation_strength": 0.0,
            "model_used": "heuristic",
            "historical_ranks": historical_ranks,
        }

    # ------------------------------------------------------------------
    # Fill any gaps in the year sequence before passing to AR(2).
    # ------------------------------------------------------------------
    filled_years, filled_ranks = _fill_gaps(years, raw_ranks)

    current_year = filled_years[-1]
    result = predict_next_rank(filled_ranks, current_year)

    return {
        "is_big_year": result["is_big_year"],
        "is_small_year": result["is_small_year"],
        "predicted_rank": result["predicted_rank"],
        "confidence": result["confidence"],
        "reason": result["reason"],
        "oscillation_strength": result["oscillation_strength"],
        "model_used": result["model_used"],
        "historical_ranks": historical_ranks,
        # Extended keys for richer consumers.
        "prediction_std": result.get("prediction_std", 0.0),
    }
