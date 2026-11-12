"""Comptage d'événements par groupe, sans boucle Python.

Les variables des deux modèles se ramènent à quelques questions posées pour
des centaines de milliers d'instants `t` à la fois : combien de débuts de
rupture du couple dans ]t − 30 j, t] ? quand a fini la dernière ? Chaque
événement devient une clé entière `groupe × 2³² + seconde`, les clés sont
triées, et chaque question une double recherche dichotomique
(`np.searchsorted`) : un million d'instants en quelques secondes.

Les groupes (couple station × carburant, station, département × carburant,
carburant) sont numérotés par `Groups` ; les instants sont des secondes Unix
(int64).
"""
import numpy as np
import pandas as pd

# 2³² secondes ≈ 136 ans : toute seconde Unix d'ici 2106 tient sous le groupe.
GROUP_SHIFT = np.int64(1) << 32


class Groups:
    """Numérote les valeurs distinctes de plusieurs séries de clés."""

    def __init__(self, *keys):
        values = pd.concat([pd.Series(k) for k in keys], ignore_index=True).astype(str)
        self.codes = pd.Index(values.unique())

    def ids(self, keys) -> np.ndarray:
        return self.codes.get_indexer(pd.Series(keys).astype(str)).astype(np.int64)


def pair_keys(left, right) -> np.ndarray:
    """Clé texte d'un couple, `"<gauche>|<droite>"` : station|carburant,
    département|carburant…"""
    return pd.Series(left, dtype=object).astype(str).to_numpy() + "|" + np.asarray(right, dtype=str)


def sorted_keys(group_ids: np.ndarray, times: np.ndarray) -> np.ndarray:
    keys = group_ids * GROUP_SHIFT + times
    keys.sort()
    return keys


def count_at_or_before(keys: np.ndarray, group_ids: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Nombre d'événements du groupe à des instants ≤ t."""
    upper = np.searchsorted(keys, group_ids * GROUP_SHIFT + t, side="right")
    lower = np.searchsorted(keys, group_ids * GROUP_SHIFT, side="left")
    return upper - lower


def count_between(keys: np.ndarray, group_ids: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Nombre d'événements du groupe dans ]a, b]."""
    return (np.searchsorted(keys, group_ids * GROUP_SHIFT + b, side="right")
            - np.searchsorted(keys, group_ids * GROUP_SHIFT + a, side="right"))


def last_at_or_before(keys: np.ndarray, group_ids: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Instant du dernier événement du groupe ≤ t, ou -1."""
    idx = np.searchsorted(keys, group_ids * GROUP_SHIFT + t, side="right") - 1
    found = idx >= 0
    safe = np.where(found, idx, 0)
    same_group = found & (keys[safe] // GROUP_SHIFT == group_ids) if len(keys) else np.zeros_like(found)
    return np.where(same_group, keys[safe] % GROUP_SHIFT if len(keys) else 0, -1)


def alive_count(
    member_groups: np.ndarray, first: np.ndarray, last: np.ndarray, groups: np.ndarray, t: np.ndarray
) -> np.ndarray:
    """Nombre de membres de chaque groupe présents à `t` : vus pour la
    première fois à `t` ou avant, et pour la dernière fois à `t` ou après."""
    first_keys, last_keys = sorted_keys(member_groups, first), sorted_keys(member_groups, last)
    return (count_at_or_before(first_keys, groups, t)
            - count_at_or_before(last_keys, groups, t - 1)).astype(float)
