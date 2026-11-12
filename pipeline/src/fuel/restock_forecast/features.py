"""Variables du modèle de réapprovisionnement.

On part des **mêmes** variables que le modèle de rupture
(`shortage_forecast.features.compute_features`) : historique du couple,
autres carburants de la station, vagues départementales et nationales,
calendrier. Elles décrivent aussi bien une station qui va manquer qu'une
station qui va être livrée — une crise régionale retarde les deux.

S'y ajoutent les variables qui n'ont de sens que **pendant** une rupture :

| variable | intuition |
|---|---|
| `shortage_age_hours` | la plupart des ruptures durent moins d'un jour ; une rupture qui dure depuis trois jours a des chances de durer encore (la station attend une livraison qui ne vient pas) |
| `sf_mean_duration_hours_180d` / `sf_closed_180d` | une station qui se fait livrer en quelques heures le fera probablement encore |
| `station_other_ends_24h` | une citerne livre souvent plusieurs carburants : si le SP98 vient de revenir, le gazole suit |
| `dept_ends_24h_share`, `nat_ends_24h_share` | fin de crise, déblocage d'un dépôt : les livraisons reprennent par vagues |

Comme pour la rupture, rien n'est lu après `t` : la fin de la rupture en
cours, inconnue à `t`, n'entre dans aucune variable (`tests/test_restock_
forecast.py` le vérifie en ajoutant l'avenir et en comparant).
"""
import numpy as np
import pandas as pd

from src.fuel.fuels import FUELS
from src.fuel.shortage_forecast.features import (
    _KEY,
    CATEGORICAL_FEATURES,
    DAY,
    HORIZON_SECONDS,
    HOUR,
    NUMERIC_FEATURES as SHORTAGE_NUMERIC_FEATURES,
    History,
    _alive,
    _count_between,
    _Groups,
    _hours_since,
    _last_le,
    _sorted_keys,
    compute_features as compute_context_features,
    seconds,
)

HORIZON_HOURS = HORIZON_SECONDS // HOUR

# Fenêtre de la durée habituelle : celle du plus long comptage du modèle de
# rupture (`sf_starts_180d`), donc ce que `fuel_shortages` retient.
DURATION_WINDOW_SECONDS = 180 * DAY

RESTOCK_FEATURES = [
    "shortage_age_hours",
    "sf_mean_duration_hours_180d",
    "sf_closed_180d",
    "station_other_ends_24h",
    "dept_ends_24h_share",
    "nat_ends_24h_share",
]
NUMERIC_FEATURES = SHORTAGE_NUMERIC_FEATURES + RESTOCK_FEATURES
FEATURE_COLUMNS = NUMERIC_FEATURES + CATEGORICAL_FEATURES


def _pair(left, right) -> np.ndarray:
    return pd.Series(left, dtype=object).astype(str).to_numpy() + "|" + np.asarray(right, dtype=str)


def compute_features(history: History, queries: pd.DataFrame) -> pd.DataFrame:
    """Variables de chaque ligne de `queries` (`station`, `fuel`, `t`), un
    couple en rupture à `t`. Mêmes conventions que le modèle de rupture."""
    q = queries.reset_index(drop=True).copy()
    q["station"], q["fuel"] = q["station"].astype(str), q["fuel"].astype(str)
    t = seconds(q["t"])
    sh, sold = history.shortages, history.sold
    out = compute_context_features(history, q)

    dept_of = sold.drop_duplicates("station").set_index("station")["dept"]
    closed = sh[sh["end"].notna()].reset_index(drop=True)
    q_dept = dept_of.reindex(q["station"]).to_numpy()
    c_dept = dept_of.reindex(closed["station"]).to_numpy()

    q_pair, sh_pair, c_pair = _pair(q["station"], q["fuel"]), _pair(sh["station"], sh["fuel"]), \
        _pair(closed["station"], closed["fuel"])
    q_deptfuel, c_deptfuel = _pair(q_dept, q["fuel"]), _pair(c_dept, closed["fuel"])
    sold_deptfuel = _pair(sold["dept"], sold["fuel"])

    pairs = _Groups(pd.Series(q_pair), pd.Series(sh_pair))
    stations = _Groups(q["station"], closed["station"])
    deptfuels = _Groups(pd.Series(q_deptfuel), pd.Series(c_deptfuel), pd.Series(sold_deptfuel))
    fuels = _Groups(pd.Series(FUELS), q["fuel"], closed["fuel"], sold["fuel"])
    q_p, q_st = pairs.ids(pd.Series(q_pair)), stations.ids(q["station"])
    q_df, q_f = deptfuels.ids(pd.Series(q_deptfuel)), fuels.ids(q["fuel"])

    empty = np.zeros(0, dtype=np.int64)
    start = seconds(sh["start"]) if len(sh) else empty
    c_start = seconds(closed["start"]) if len(closed) else empty
    c_end = seconds(closed["end"]) if len(closed) else empty

    # — la rupture en cours : son début est le dernier début du couple ≤ t
    current_start = _last_le(_sorted_keys(pairs.ids(pd.Series(sh_pair)), start), q_p, t)
    out["shortage_age_hours"] = _hours_since(current_start, t)

    # — durée moyenne des ruptures du couple **closes** à t, sur 180 jours :
    # somme glissante des durées par double recherche dans des clés triées.
    c_p = pairs.ids(pd.Series(c_pair))
    keys = c_p * _KEY + c_end
    order = np.argsort(keys, kind="stable")
    keys = keys[order]
    cumulated = np.concatenate([[0], np.cumsum((c_end - c_start)[order])]).astype(float)
    hi = np.searchsorted(keys, q_p * _KEY + t, side="right")
    lo = np.searchsorted(keys, q_p * _KEY + t - DURATION_WINDOW_SECONDS, side="right")
    n_closed = (hi - lo).astype(float)
    with np.errstate(divide="ignore", invalid="ignore"):
        out["sf_mean_duration_hours_180d"] = np.where(
            n_closed > 0, (cumulated[hi] - cumulated[lo]) / n_closed / HOUR, np.nan
        )
    out["sf_closed_180d"] = n_closed

    # — fins de rupture des dernières 24 h : la station, le département, la France
    pair_ends = keys
    station_ends = _sorted_keys(stations.ids(closed["station"]), c_end)
    out["station_other_ends_24h"] = (_count_between(station_ends, q_st, t - DAY, t)
                                     - _count_between(pair_ends, q_p, t - DAY, t)).astype(float)
    first, last = seconds(sold["first_at"]), seconds(sold["last_at"])
    with np.errstate(divide="ignore", invalid="ignore"):
        dept_sold = _alive(deptfuels.ids(pd.Series(sold_deptfuel)), first, last, q_df, t)
        nat_sold = _alive(fuels.ids(sold["fuel"]), first, last, q_f, t)
        dept_ends = _sorted_keys(deptfuels.ids(pd.Series(c_deptfuel)), c_end)
        nat_ends = _sorted_keys(fuels.ids(closed["fuel"]), c_end)
        out["dept_ends_24h_share"] = _count_between(dept_ends, q_df, t - DAY, t) / dept_sold
        out["nat_ends_24h_share"] = _count_between(nat_ends, q_f, t - DAY, t) / nat_sold

    frame = out.astype(float).replace([np.inf, -np.inf], np.nan)
    return frame[FEATURE_COLUMNS]
