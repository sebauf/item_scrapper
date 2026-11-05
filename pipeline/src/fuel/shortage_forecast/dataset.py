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
    History,
    compute_features,
    is_active,
    label,
    seconds,
)

DEFAULT_NEGATIVE_RATE = 0.05
_CHUNK = 4000


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
        rows = slice(lo, lo + _CHUNK)
        b, e = begin[rows], stop[rows]
        n_days = np.maximum((e - first_day) // DAY - (b - first_day) // DAY + 1, 0)
        n_days = np.where(e >= b, n_days, 0)
        if n_days.sum() == 0:
            continue
        idx = np.repeat(np.arange(lo, lo + len(b)), n_days)
        day0 = first_day + ((b - first_day) // DAY) * DAY
        offsets = np.concatenate([np.arange(n) for n in n_days])
        t = np.repeat(day0, n_days) + offsets * DAY + rng.integers(0, DAY, size=len(idx))
        inside = (t >= np.repeat(b, n_days)) & (t <= np.repeat(e, n_days))
        idx, t = idx[inside], t[inside]
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
