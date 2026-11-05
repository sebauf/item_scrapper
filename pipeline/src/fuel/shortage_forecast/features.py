"""Historique commun et variables explicatives.

**Une seule fonction**, `compute_features`, calcule les variables d'un couple
(station × carburant) à un instant `t`, que ce soit pour l'entraînement (des
centaines de milliers d'instants passés, lus dans l'archive) ou pour la
prévision (maintenant, lu dans MongoDB). C'est la protection principale contre
le défaut classique du ML en production : un modèle qui reçoit, une fois
déployé, des variables calculées autrement que celles sur lesquelles il a
appris (*training/serving skew*).

Elle ne lit que le passé de `t` — jamais une rupture commencée après — sans
quoi le modèle « apprendrait » l'avenir et s'effondrerait en production
(*fuite de données*). `tests/test_shortage_features.py` le vérifie.

Les variables, et ce qu'elles captent :

| variable | intuition |
|---|---|
| `sf_starts_7d/30d/180d` | une station en rupture souvent le sera encore : 10 % des stations font la moitié des ruptures |
| `sf_hours_since_end` | une livraison vient d'arriver, ou au contraire le cycle habituel arrive à son terme |
| `sf_hours_since_price` | les stations changent souvent leur prix à la livraison d'une citerne |
| `station_other_active` / `station_other_starts_24h` | les cuves se vident souvent en cascade (SP98, puis E10…) |
| `station_fuels_sold` | taille de la station |
| `dept_*`, `nat_*` | vagues régionales ou nationales (grèves, blocage de dépôts, crise d'approvisionnement) |
| `hour_local`, `weekday_local` | pas de livraison le week-end : les ruptures commencent surtout le lundi matin |
| `fuel`, `pop` | carburant, et station de route ou d'autoroute |

Les instants sont des secondes Unix (int64) ; chaque comptage est une double
recherche dichotomique (`np.searchsorted`) dans des clés triées
`groupe × 2³² + seconde`, ce qui traite un million d'instants en quelques
secondes sans boucle Python.
"""
from dataclasses import dataclass

import numpy as np
import pandas as pd

from src.fuel.shortage_forecast.archive import FUEL_CODES

FUELS = tuple(FUEL_CODES.values())

HOUR = 3600
DAY = 24 * HOUR

# Une rupture plus courte n'en est pas une pour l'utilisateur (pistolet en
# panne, saisie corrigée) : 10 % des ruptures de l'archive durent moins
# d'1 h 30. Écartée de l'historique comme des étiquettes.
MIN_SHORTAGE_SECONDS = HOUR

# Une rupture jamais close cesse d'être comptée « en cours » après ce délai :
# 90 % durent moins de 4 jours, et une station qui ne déclare plus rien ne doit
# pas gonfler indéfiniment la part de stations en rupture de son département.
OPEN_ACTIVE_SECONDS = 7 * DAY

HORIZON_SECONDS = DAY
_SINCE_CAP_HOURS = 180 * 24

NUMERIC_FEATURES = [
    "sf_starts_7d",
    "sf_starts_30d",
    "sf_starts_180d",
    "sf_hours_since_end",
    "sf_hours_since_price",
    "station_other_active",
    "station_other_starts_24h",
    "station_fuels_sold",
    "dept_active_share",
    "dept_starts_24h_share",
    "dept_starts_7d_share",
    "nat_active_share",
    "nat_starts_24h_share",
    "hour_local",
    "weekday_local",
]
CATEGORICAL_FEATURES = ["fuel", "pop"]
FEATURE_COLUMNS = NUMERIC_FEATURES + CATEGORICAL_FEATURES

_KEY = np.int64(1) << 32


def seconds(values) -> np.ndarray:
    """datetime64 (Series, Index ou ndarray) → secondes Unix int64."""
    return np.asarray(pd.to_datetime(values), dtype="datetime64[s]").astype(np.int64)


@dataclass
class History:
    """Ce que l'on sait des stations jusqu'à `as_of`.

    - `shortages` : `station`, `fuel`, `start`, `end` (NaT si en cours) ;
    - `sold` : `station`, `fuel`, `dept`, `pop`, `first_at`, `last_at` — un
      couple par carburant vendu, et la période où on l'a vu vendu ;
    - `prices` : `station`, `fuel`, `at` — dates des changements de prix (en
      direct, seulement le dernier : c'est tout ce que la variable utilise).
    """
    shortages: pd.DataFrame
    sold: pd.DataFrame
    prices: pd.DataFrame
    as_of: pd.Timestamp

    def __post_init__(self):
        # Identifiants en texte partout : l'archive et MongoDB doivent
        # produire les mêmes clés.
        for frame in (self.shortages, self.sold, self.prices):
            for column in ("station", "fuel"):
                frame[column] = frame[column].astype(str)
        s = self.shortages
        duration = s["end"] - s["start"]
        # Les ruptures closes trop courtes sont du bruit ; celles en cours
        # sont gardées, leur durée est encore inconnue.
        self.shortages = s[s["end"].isna() | (duration >= pd.Timedelta(seconds=MIN_SHORTAGE_SECONDS))]
        self.shortages = self.shortages.reset_index(drop=True)


class _Groups:
    """Numérote des groupes (station, couple, département × carburant…)."""

    def __init__(self, *frames_keys):
        values = pd.concat([k for k in frames_keys], ignore_index=True).astype(str)
        self.codes = pd.Index(values.unique())

    def ids(self, keys: pd.Series) -> np.ndarray:
        return self.codes.get_indexer(keys.astype(str)).astype(np.int64)


def _sorted_keys(group_ids: np.ndarray, times: np.ndarray) -> np.ndarray:
    keys = group_ids * _KEY + times
    keys.sort()
    return keys


def _count_le(keys: np.ndarray, group_ids: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Nombre d'événements du groupe à des instants ≤ t."""
    upper = np.searchsorted(keys, group_ids * _KEY + t, side="right")
    lower = np.searchsorted(keys, group_ids * _KEY, side="left")
    return upper - lower


def _count_between(keys, group_ids, a, b) -> np.ndarray:
    """Nombre d'événements du groupe dans ]a, b]."""
    return (np.searchsorted(keys, group_ids * _KEY + b, side="right")
            - np.searchsorted(keys, group_ids * _KEY + a, side="right"))


def _last_le(keys, group_ids, t) -> np.ndarray:
    """Instant du dernier événement du groupe ≤ t, ou -1."""
    idx = np.searchsorted(keys, group_ids * _KEY + t, side="right") - 1
    found = idx >= 0
    safe = np.where(found, idx, 0)
    same_group = found & (keys[safe] // _KEY == group_ids) if len(keys) else np.zeros_like(found)
    return np.where(same_group, keys[safe] % _KEY if len(keys) else 0, -1)


def _hours_since(last: np.ndarray, t: np.ndarray) -> np.ndarray:
    hours = (t - last) / HOUR
    return np.where(last < 0, np.nan, np.minimum(hours, _SINCE_CAP_HOURS))


def _local_calendar(t: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    local = pd.to_datetime(t, unit="s").tz_localize("UTC").tz_convert("Europe/Paris")
    return (local.hour + local.minute / 60).to_numpy(dtype=float), local.weekday.to_numpy(dtype=float)


def effective_end(shortages: pd.DataFrame) -> np.ndarray:
    """Fin « en cours » d'une rupture : sa fin, ou début + 7 jours si non
    close (cf. OPEN_ACTIVE_SECONDS)."""
    start = seconds(shortages["start"])
    end = seconds(shortages["end"].fillna(shortages["start"]))
    return np.where(shortages["end"].isna().to_numpy(), start + OPEN_ACTIVE_SECONDS, end)


def _alive(sold_groups: np.ndarray, first: np.ndarray, last: np.ndarray, groups, t) -> np.ndarray:
    """Nombre de couples vendus à `t` dans chaque groupe : vus vendus pour la
    première fois avant `t`, et pour la dernière fois à `t` ou après."""
    first_keys, last_keys = _sorted_keys(sold_groups, first), _sorted_keys(sold_groups, last)
    return (_count_le(first_keys, groups, t) - _count_le(last_keys, groups, t - 1)).astype(float)


def compute_features(history: History, queries: pd.DataFrame) -> pd.DataFrame:
    """Variables de chaque ligne de `queries` (`station`, `fuel`, `t`).

    `t` est un datetime64 UTC naïf. Une station inconnue de `history.sold`
    reçoit des valeurs manquantes là où il faut la connaître (département,
    type de route) : le modèle sait les traiter.
    """
    q = queries.reset_index(drop=True).copy()
    q["station"], q["fuel"] = q["station"].astype(str), q["fuel"].astype(str)
    t = seconds(q["t"])
    sh, sold, prices = history.shortages, history.sold, history.prices

    # Département et type de route ne dépendent que de la station.
    by_station = sold.drop_duplicates("station").set_index("station")
    q_dept = by_station["dept"].reindex(q["station"]).to_numpy()
    q_pop = by_station["pop"].reindex(q["station"]).to_numpy()
    sh_dept = by_station["dept"].reindex(sh["station"]).to_numpy()

    def pair(stations, fuels):
        return pd.Series(stations, dtype=object).astype(str).to_numpy() + "|" + np.asarray(fuels, dtype=str)

    q_pair, sh_pair = pair(q["station"], q["fuel"]), pair(sh["station"], sh["fuel"])
    q_deptfuel, sh_deptfuel = pair(q_dept, q["fuel"]), pair(sh_dept, sh["fuel"])
    sold_deptfuel = pair(sold["dept"], sold["fuel"])
    price_pair = pair(prices["station"], prices["fuel"])

    sf = _Groups(pd.Series(q_pair), pd.Series(sh_pair), pd.Series(price_pair))
    st = _Groups(q["station"], sh["station"], sold["station"])
    dfg = _Groups(pd.Series(q_deptfuel), pd.Series(sh_deptfuel), pd.Series(sold_deptfuel))
    fg = _Groups(pd.Series(FUELS), q["fuel"], sh["fuel"], sold["fuel"])

    q_sf, q_st = sf.ids(pd.Series(q_pair)), st.ids(q["station"])
    q_df, q_f = dfg.ids(pd.Series(q_deptfuel)), fg.ids(q["fuel"])
    sh_sf, sh_st = sf.ids(pd.Series(sh_pair)), st.ids(sh["station"])
    sh_df, sh_f = dfg.ids(pd.Series(sh_deptfuel)), fg.ids(sh["fuel"])

    start = seconds(sh["start"]) if len(sh) else np.zeros(0, dtype=np.int64)
    end_eff = effective_end(sh) if len(sh) else np.zeros(0, dtype=np.int64)
    closed = sh["end"].notna().to_numpy()
    real_end = seconds(sh["end"][closed]) if closed.any() else np.zeros(0, dtype=np.int64)

    def active(groups_sh, groups_q):
        return (_count_le(_sorted_keys(groups_sh, start), groups_q, t)
                - _count_le(_sorted_keys(groups_sh, end_eff), groups_q, t)).astype(float)

    out = {}
    # — le couple (station × carburant) lui-même
    sf_starts = _sorted_keys(sh_sf, start)
    for days in (7, 30, 180):
        out[f"sf_starts_{days}d"] = _count_between(sf_starts, q_sf, t - days * DAY, t)
    out["sf_hours_since_end"] = _hours_since(_last_le(_sorted_keys(sh_sf[closed], real_end), q_sf, t), t)
    price_keys = _sorted_keys(sf.ids(pd.Series(price_pair)), seconds(prices["at"]))
    out["sf_hours_since_price"] = _hours_since(_last_le(price_keys, q_sf, t), t)

    # — la station : ses autres carburants
    out["station_other_active"] = active(sh_st, q_st) - active(sh_sf, q_sf)
    st_starts = _sorted_keys(sh_st, start)
    out["station_other_starts_24h"] = (_count_between(st_starts, q_st, t - DAY, t)
                                       - _count_between(sf_starts, q_sf, t - DAY, t))
    first, last = seconds(sold["first_at"]), seconds(sold["last_at"])
    out["station_fuels_sold"] = _alive(st.ids(sold["station"]), first, last, q_st, t)

    # — département × carburant, France × carburant : parts de couples vendus
    with np.errstate(divide="ignore", invalid="ignore"):
        dept_sold = _alive(dfg.ids(pd.Series(sold_deptfuel)), first, last, q_df, t)
        nat_sold = _alive(fg.ids(sold["fuel"]), first, last, q_f, t)
        df_starts, f_starts = _sorted_keys(sh_df, start), _sorted_keys(sh_f, start)
        out["dept_active_share"] = active(sh_df, q_df) / dept_sold
        out["dept_starts_24h_share"] = _count_between(df_starts, q_df, t - DAY, t) / dept_sold
        out["dept_starts_7d_share"] = _count_between(df_starts, q_df, t - 7 * DAY, t) / dept_sold
        out["nat_active_share"] = active(sh_f, q_f) / nat_sold
        out["nat_starts_24h_share"] = _count_between(f_starts, q_f, t - DAY, t) / nat_sold

    out["hour_local"], out["weekday_local"] = _local_calendar(t)
    out["fuel"] = q["fuel"].map({code: i for i, code in enumerate(FUELS)}).to_numpy(dtype=float)
    out["pop"] = pd.Series(q_pop).map({"R": 0, "A": 1}).to_numpy(dtype=float)

    frame = pd.DataFrame(out).astype(float)
    # Une part sans dénominateur (département inconnu, aucune station) n'a
    # pas de valeur : manquante, plutôt qu'infinie.
    return frame.replace([np.inf, -np.inf], np.nan)[FEATURE_COLUMNS]


def is_active(history: History, queries: pd.DataFrame) -> np.ndarray:
    """Le couple est-il en rupture à `t` ? (règle d'éligibilité : on ne
    prévoit une rupture que pour un carburant disponible)."""
    q = queries.reset_index(drop=True)
    t = seconds(q["t"])
    sh = history.shortages
    key = lambda frame: frame["station"].astype(str) + "|" + frame["fuel"].astype(str)
    groups = _Groups(key(q), key(sh))
    g_sh, g_q = groups.ids(key(sh)), groups.ids(key(q))
    start = seconds(sh["start"]) if len(sh) else np.zeros(0, np.int64)
    end = effective_end(sh) if len(sh) else np.zeros(0, np.int64)
    return (_count_le(_sorted_keys(g_sh, start), g_q, t) - _count_le(_sorted_keys(g_sh, end), g_q, t)) > 0


def label(history: History, queries: pd.DataFrame, horizon: int = HORIZON_SECONDS) -> np.ndarray:
    """1 si une rupture du couple commence dans ]t, t + 24 h]."""
    q = queries.reset_index(drop=True)
    t = seconds(q["t"])
    sh = history.shortages
    key = lambda frame: frame["station"].astype(str) + "|" + frame["fuel"].astype(str)
    groups = _Groups(key(q), key(sh))
    starts = _sorted_keys(groups.ids(key(sh)), seconds(sh["start"]) if len(sh) else np.zeros(0, np.int64))
    return (_count_between(starts, groups.ids(key(q)), t, t + horizon) > 0).astype(np.int8)
