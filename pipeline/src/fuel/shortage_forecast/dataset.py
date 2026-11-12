"""Jeu d'entraînement : des instantanés étiquetés, tirés de l'archive.

Un **instantané** = (station, carburant, instant `t`) où le carburant est
vendu et disponible. Son étiquette vaut 1 si une rupture de ce carburant
commence dans cette station dans les 24 heures qui suivent.

Comment on les tire : un instant **au hasard dans chaque journée**, pour
chaque couple vendu. Au hasard, parce que la prévision tourne toutes les
30 minutes, jour et nuit : le modèle doit avoir vu toutes les heures (une
rupture « dans les 24 h » est bien plus probable vue d'un dimanche soir que
d'un mardi midi).

**Sous-échantillonnage des négatifs.** Sur un jour donné, environ 1 couple
sur 300 entre en rupture (année 2026, en crise). Garder tous les négatifs
ferait des dizaines de millions de lignes presque identiques. On garde tous
les positifs et une fraction `negative_rate` des négatifs, chacun pesant
`1 / negative_rate` : l'estimateur voit la vraie proportion, en moyenne, et
ses probabilités restent interprétables (« 30 % de risque » veut dire 30 %).
"""
from dataclasses import dataclass

import numpy as np
import pandas as pd

from src.fuel.shortage_forecast.archive import Archive
from src.fuel.shortage_forecast.features import (
    DAY,
    HORIZON_SECONDS,
    LONGEST_WINDOW_DAYS,
    History,
    compute_features,
    is_active,
    label,
    seconds,
)

DEFAULT_NEGATIVE_RATE = 0.05
# Couples traités par lot : borne la mémoire du tirage (un tableau par jour
# et par couple), sans effet sur le résultat.
_CHUNK = 4000

# Fenêtre des instantanés : chacun doit avoir ses 180 jours de passé dans
# l'archive, et 400 jours d'instantanés demandent l'année précédente entière
# plus l'année en cours. Partagée par les deux modèles.
LOOKBACK_DAYS = LONGEST_WINDOW_DAYS
TRAINING_DAYS = 400


# Un couple dont le prix a bougé dans ce délai est encore vendu à la fin de
# l'archive (cf. history_from_archive).
STILL_SOLD_DAYS = 30


def history_from_archive(archive: Archive) -> History:
    """L'archive vue comme un `History` : un couple est vendu entre son
    premier et son dernier changement de prix.

    Exception à la fin de l'archive : un prix stable depuis trois jours ne
    veut pas dire que la station a cessé de vendre. Un couple vu dans les
    `STILL_SOLD_DAYS` derniers jours est donc vendu jusqu'à `generated_at` —
    c'est ce que voit la prévision en direct, où tout carburant du dernier
    import est vendu.
    """
    prices = archive.prices
    sold = (
        prices.groupby(["station", "fuel"], observed=True)["at"]
        .agg(first_at="min", last_at="max")
        .reset_index()
        .merge(archive.stations[["station", "dept", "pop"]], on="station", how="left")
    )
    sold["dept"] = sold["dept"].fillna("??")
    as_of = pd.Timestamp(archive.generated_at)
    recent = as_of - sold["last_at"] <= pd.Timedelta(days=STILL_SOLD_DAYS)
    sold.loc[recent, "last_at"] = as_of
    return History(
        shortages=archive.shortages.copy(),
        sold=sold,
        prices=prices.copy(),
        as_of=as_of,
    )


def training_start(history: History) -> pd.Timestamp:
    """Premier instant tiré : après `LOOKBACK_DAYS` d'archive, au plus
    `TRAINING_DAYS` avant sa fin."""
    covered_from = history.sold["first_at"].min()
    return max(covered_from + pd.Timedelta(days=LOOKBACK_DAYS),
               history.as_of - pd.Timedelta(days=TRAINING_DAYS))


@dataclass
class Dataset:
    X: pd.DataFrame
    y: np.ndarray
    weight: np.ndarray
    meta: pd.DataFrame  # station, fuel, t


def sample_snapshots(
    history: History,
    start: pd.Timestamp,
    end: pd.Timestamp,
    negative_rate: float = DEFAULT_NEGATIVE_RATE,
    seed: int = 0,
) -> pd.DataFrame:
    """Instantanés éligibles entre `start` et `end`, négatifs sous-échantillonnés.

    `end` est ramené à `as_of - 24 h` : au-delà, l'archive ne peut pas encore
    dire si une rupture a commencé dans les 24 h — une étiquette 0 y serait
    une absence d'information, pas une absence de rupture.
    """
    rng = np.random.default_rng(seed)
    end = min(pd.Timestamp(end), history.as_of - pd.Timedelta(seconds=HORIZON_SECONDS))
    first_day = seconds(pd.Series([pd.Timestamp(start).normalize()]))[0]
    last = seconds(pd.Series([end]))[0]

    sold = history.sold.reset_index(drop=True)
    begin = np.maximum(seconds(sold["first_at"]), first_day)
    stop = np.minimum(seconds(sold["last_at"]), last)

    kept = []
    for lo in range(0, len(sold), _CHUNK):
        rows, t = daily_random_instants(begin[lo:lo + _CHUNK], stop[lo:lo + _CHUNK], first_day, rng)
        if len(rows) == 0:
            continue
        idx = rows + lo
        q = pd.DataFrame({
            "station": sold["station"].to_numpy()[idx],
            "fuel": sold["fuel"].to_numpy()[idx],
            "t": pd.to_datetime(t, unit="s"),
        })
        q = q[~is_active(history, q)].reset_index(drop=True)
        y = label(history, q)
        keep = (y == 1) | (rng.random(len(q)) < negative_rate)
        kept.append(q[keep].assign(y=y[keep]))
    if not kept:
        return pd.DataFrame(columns=["station", "fuel", "t", "y"])
    return pd.concat(kept, ignore_index=True)


def daily_random_instants(
    begin: np.ndarray, stop: np.ndarray, first_day: int, rng: np.random.Generator
) -> tuple[np.ndarray, np.ndarray]:
    """Un instant au hasard dans chaque journée de chaque intervalle
    [begin_i, stop_i] (secondes Unix) — la règle de tirage des deux modèles.

    Renvoie (indices i, instants). Les journées partent de `first_day`
    (minuit UTC) ; un tirage tombé hors de l'intervalle, dans une journée
    entamée, est écarté : le temps couvert reste échantillonné uniformément.
    """
    n_days = np.maximum((stop - first_day) // DAY - (begin - first_day) // DAY + 1, 0)
    n_days = np.where(stop >= begin, n_days, 0)
    if n_days.sum() == 0:
        return np.zeros(0, dtype=np.int64), np.zeros(0, dtype=np.int64)
    idx = np.repeat(np.arange(len(begin)), n_days)
    day0 = first_day + ((begin - first_day) // DAY) * DAY
    offsets = np.concatenate([np.arange(n) for n in n_days])
    t = np.repeat(day0, n_days) + offsets * DAY + rng.integers(0, DAY, size=len(idx))
    inside = (t >= begin[idx]) & (t <= stop[idx])
    return idx[inside], t[inside]


def build_dataset(
    history: History,
    start: pd.Timestamp,
    end: pd.Timestamp,
    negative_rate: float = DEFAULT_NEGATIVE_RATE,
    seed: int = 0,
) -> Dataset:
    snapshots = sample_snapshots(history, start, end, negative_rate, seed)
    y = snapshots["y"].to_numpy(dtype=np.int8)
    weight = np.where(y == 1, 1.0, 1.0 / negative_rate)
    X = compute_features(history, snapshots[["station", "fuel", "t"]])
    return Dataset(X=X, y=y, weight=weight, meta=snapshots[["station", "fuel", "t"]])
