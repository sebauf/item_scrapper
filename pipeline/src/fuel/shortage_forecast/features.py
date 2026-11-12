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

Les instants sont des secondes Unix (int64), comptés par
`event_search` (recherches dichotomiques dans des clés triées).

`compute_features` reste d'un bloc, par choix : ses ~60 lignes partagent une
quinzaine d'intermédiaires (identifiants de groupe, débuts, fins) ; la couper
par famille de variables obligerait à les transporter dans un objet de
contexte, et disperserait une seule idée — indexer, puis compter.
"""
from dataclasses import dataclass

import numpy as np
import pandas as pd

from src.fuel.fuels import FUEL_RANK, FUELS
from src.fuel.shortage_forecast.event_search import (
    Groups,
    alive_count,
    count_at_or_before,
    count_between,
    last_at_or_before,
    pair_keys,
    sorted_keys,
)

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

# Plus longue fenêtre des variables (`sf_starts_180d`). L'historique tenu en
# base (`episodes.RETENTION_DAYS`) et relu en direct (`predict`) la couvre.
LONGEST_WINDOW_DAYS = 180
_SINCE_CAP_HOURS = LONGEST_WINDOW_DAYS * 24

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


def hours_since(last: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Heures écoulées depuis `last` (-1 = jamais : manquant), plafonnées."""
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

    q_pair, sh_pair = pair_keys(q["station"], q["fuel"]), pair_keys(sh["station"], sh["fuel"])
    q_deptfuel, sh_deptfuel = pair_keys(q_dept, q["fuel"]), pair_keys(sh_dept, sh["fuel"])
    sold_deptfuel = pair_keys(sold["dept"], sold["fuel"])
    price_pair = pair_keys(prices["station"], prices["fuel"])

    sf = Groups(q_pair, sh_pair, price_pair)
    st = Groups(q["station"], sh["station"], sold["station"])
    dfg = Groups(q_deptfuel, sh_deptfuel, sold_deptfuel)
    fg = Groups(FUELS, q["fuel"], sh["fuel"], sold["fuel"])

    q_sf, q_st, q_df, q_f = sf.ids(q_pair), st.ids(q["station"]), dfg.ids(q_deptfuel), fg.ids(q["fuel"])
    sh_sf, sh_st = sf.ids(sh_pair), st.ids(sh["station"])
    sh_df, sh_f = dfg.ids(sh_deptfuel), fg.ids(sh["fuel"])

    start, end_eff = seconds(sh["start"]), effective_end(sh)
    closed = sh["end"].notna().to_numpy()
    real_end = seconds(sh["end"][closed])

    def active(groups_sh, groups_q):
        """Ruptures en cours à t, par groupe."""
        return (count_at_or_before(sorted_keys(groups_sh, start), groups_q, t)
                - count_at_or_before(sorted_keys(groups_sh, end_eff), groups_q, t)).astype(float)

    out = {}
    # — le couple (station × carburant) lui-même
    sf_starts = sorted_keys(sh_sf, start)
    for days in (7, 30, 180):
        out[f"sf_starts_{days}d"] = count_between(sf_starts, q_sf, t - days * DAY, t)
    out["sf_hours_since_end"] = hours_since(last_at_or_before(sorted_keys(sh_sf[closed], real_end), q_sf, t), t)
    price_keys = sorted_keys(sf.ids(price_pair), seconds(prices["at"]))
    out["sf_hours_since_price"] = hours_since(last_at_or_before(price_keys, q_sf, t), t)

    # — la station : ses autres carburants
    out["station_other_active"] = active(sh_st, q_st) - active(sh_sf, q_sf)
    st_starts = sorted_keys(sh_st, start)
    out["station_other_starts_24h"] = (count_between(st_starts, q_st, t - DAY, t)
                                       - count_between(sf_starts, q_sf, t - DAY, t))
    first, last = seconds(sold["first_at"]), seconds(sold["last_at"])
    out["station_fuels_sold"] = alive_count(st.ids(sold["station"]), first, last, q_st, t)

    # — département × carburant, France × carburant : parts de couples vendus
    with np.errstate(divide="ignore", invalid="ignore"):
        dept_sold = alive_count(dfg.ids(sold_deptfuel), first, last, q_df, t)
        nat_sold = alive_count(fg.ids(sold["fuel"]), first, last, q_f, t)
        df_starts, f_starts = sorted_keys(sh_df, start), sorted_keys(sh_f, start)
        out["dept_active_share"] = active(sh_df, q_df) / dept_sold
        out["dept_starts_24h_share"] = count_between(df_starts, q_df, t - DAY, t) / dept_sold
        out["dept_starts_7d_share"] = count_between(df_starts, q_df, t - 7 * DAY, t) / dept_sold
        out["nat_active_share"] = active(sh_f, q_f) / nat_sold
        out["nat_starts_24h_share"] = count_between(f_starts, q_f, t - DAY, t) / nat_sold

    out["hour_local"], out["weekday_local"] = _local_calendar(t)
    out["fuel"] = q["fuel"].map(FUEL_RANK).to_numpy(dtype=float)
    out["pop"] = pd.Series(q_pop).map({"R": 0, "A": 1}).to_numpy(dtype=float)

    frame = pd.DataFrame(out).astype(float)
    # Une part sans dénominateur (département inconnu, aucune station) n'a
    # pas de valeur : manquante, plutôt qu'infinie.
    return frame.replace([np.inf, -np.inf], np.nan)[FEATURE_COLUMNS]


def is_active(history: History, queries: pd.DataFrame) -> np.ndarray:
    """Le couple est-il en rupture à `t` ? (règle d'éligibilité : on ne
    prévoit une rupture que pour un carburant disponible)."""
    q, sh = queries.reset_index(drop=True), history.shortages
    t = seconds(q["t"])
    q_pair, sh_pair = pair_keys(q["station"], q["fuel"]), pair_keys(sh["station"], sh["fuel"])
    groups = Groups(q_pair, sh_pair)
    g_sh, g_q = groups.ids(sh_pair), groups.ids(q_pair)
    started = count_at_or_before(sorted_keys(g_sh, seconds(sh["start"])), g_q, t)
    ended = count_at_or_before(sorted_keys(g_sh, effective_end(sh)), g_q, t)
    return (started - ended) > 0


def label(history: History, queries: pd.DataFrame, horizon: int = HORIZON_SECONDS) -> np.ndarray:
    """1 si une rupture du couple commence dans ]t, t + 24 h]."""
    q, sh = queries.reset_index(drop=True), history.shortages
    t = seconds(q["t"])
    q_pair, sh_pair = pair_keys(q["station"], q["fuel"]), pair_keys(sh["station"], sh["fuel"])
    groups = Groups(q_pair, sh_pair)
    starts = sorted_keys(groups.ids(sh_pair), seconds(sh["start"]))
    return (count_between(starts, groups.ids(q_pair), t, t + horizon) > 0).astype(np.int8)
