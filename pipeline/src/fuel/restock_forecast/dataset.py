"""Jeu d'entraînement du réapprovisionnement : des instantanés **pendant** une
rupture, tirés de l'archive.

Un **instantané** = (station, carburant, instant `t`) où le carburant est en
rupture. Son étiquette vaut 1 si cette rupture se termine — le carburant
revient à la pompe — dans les 24 heures qui suivent.

**Tirage.** Un instant au hasard dans chaque journée, pour chaque épisode de
rupture qui la touche, gardé s'il tombe pendant la rupture. Le temps passé en
rupture est ainsi échantillonné uniformément, comme la prévision qui tourne
toutes les 30 minutes : une rupture de 3 heures donne un instantané une
journée sur huit, une rupture de 4 jours en donne quatre. Pas de
sous-échantillonnage : contrairement aux ruptures (1 couple sur 300 par jour),
les réapprovisionnements ne sont pas rares — la moitié des ruptures se
terminent en moins d'un jour.

**Fenêtre d'éligibilité** : du début de la rupture à sa fin, et au plus
`MAX_SHORTAGE_AGE_SECONDS` (7 jours). Au-delà, l'historique ne sait plus
distinguer une longue rupture d'une station qui a cessé de déclarer
(`features.OPEN_ACTIVE_SECONDS`, même seuil), et l'archive écarte déjà les
ruptures de plus de 30 jours : le modèle n'apprendrait pas sur les longues
ruptures ce qu'elles sont vraiment. La prévision en direct s'abstient donc
au-delà de 7 jours (cf. forecasts.py).

**Biais connu, assumé** : les ruptures closes en moins d'une heure sont
écartées de l'historique (du bruit, cf. `MIN_SHORTAGE_SECONDS`), donc de
l'échantillon. Pour une rupture vieille de quelques minutes, la prévision
sous-estime donc légèrement la chance d'un retour rapide — elle répond en
pratique à « si c'est une vraie rupture, finit-elle dans les 24 h ? ».
"""
import numpy as np
import pandas as pd

from src.fuel.shortage_forecast.dataset import Dataset, daily_random_instants
from src.fuel.shortage_forecast.features import (
    HORIZON_SECONDS,
    OPEN_ACTIVE_SECONDS,
    History,
    effective_end,
    seconds,
)
from src.fuel.restock_forecast.features import compute_features

MAX_SHORTAGE_AGE_SECONDS = OPEN_ACTIVE_SECONDS


def sample_snapshots(
    history: History,
    start: pd.Timestamp,
    end: pd.Timestamp,
    seed: int = 0,
) -> pd.DataFrame:
    """Instantanés en rupture entre `start` et `end`, étiquetés (`y`).

    `end` est ramené à `as_of - 24 h` : une rupture encore ouverte à la fin
    de l'archive n'est un exemple négatif (« pas finie dans les 24 h ») que si
    l'archive couvre ces 24 h.
    """
    rng = np.random.default_rng(seed)
    end = min(pd.Timestamp(end), history.as_of - pd.Timedelta(seconds=HORIZON_SECONDS))
    first_day = seconds(pd.Series([pd.Timestamp(start).normalize()]))[0]
    last = seconds(pd.Series([end]))[0]

    sh = history.shortages.reset_index(drop=True)
    columns = ["station", "fuel", "t", "y"]
    if sh.empty:
        return pd.DataFrame(columns=columns)
    shortage_start = seconds(sh["start"])
    # Fin de l'éligibilité (exclue) : la fin réelle, ou 7 jours pour une
    # rupture ouverte (effective_end), et jamais plus de 7 jours de rupture.
    until = np.minimum(effective_end(sh), shortage_start + MAX_SHORTAGE_AGE_SECONDS)
    begin = np.maximum(shortage_start, first_day)
    stop = np.minimum(until - 1, last)

    idx, t = daily_random_instants(begin, stop, first_day, rng)
    if len(idx) == 0:
        return pd.DataFrame(columns=columns)

    closed = sh["end"].notna().to_numpy()[idx]
    real_end = seconds(sh["end"].fillna(sh["start"]))[idx]
    y = (closed & (real_end - t <= HORIZON_SECONDS)).astype(np.int8)
    return pd.DataFrame({
        "station": sh["station"].to_numpy()[idx],
        "fuel": sh["fuel"].to_numpy()[idx],
        "t": pd.to_datetime(t, unit="s"),
        "y": y,
    })


def build_dataset(history: History, start: pd.Timestamp, end: pd.Timestamp, seed: int = 0) -> Dataset:
    snapshots = sample_snapshots(history, start, end, seed)
    y = snapshots["y"].to_numpy(dtype=np.int8)
    X = compute_features(history, snapshots[["station", "fuel", "t"]])
    return Dataset(X=X, y=y, weight=np.ones(len(y)), meta=snapshots[["station", "fuel", "t"]])
