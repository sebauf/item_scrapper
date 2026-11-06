"""Le modèle de réapprovisionnement : un `ModelSpec` de plus.

Estimateur, pondération temporelle, calibration de Platt, backtest
(entraînement | 1 j | calibration 21 j | 1 j | test 28 j), garde-fou et
stockage : exactement ceux du modèle de rupture
(`shortage_forecast.model`, voir sa docstring). Seuls changent :

- les **variables** (`restock_forecast.features`) ;
- la **méthode naïve** à battre, ci-dessous ;
- la **collection** : `fuel_restock_models` (`_id: "current"` /
  `"last_rejected"`), même forme que `fuel_shortage_models`. Même mise en
  garde : le modèle est un pickle, qui peut écrire dans cette collection peut
  exécuter du code dans les tâches du pipeline.
"""
import numpy as np
import pandas as pd

from src.fuel.restock_forecast.features import FEATURE_COLUMNS, HORIZON_HOURS
from src.fuel.shortage_forecast.features import CATEGORICAL_FEATURES
from src.fuel.shortage_forecast.model import ModelSpec

COLLECTION = "fuel_restock_models"


def baseline(X: pd.DataFrame, prior: float) -> np.ndarray:
    """Méthode naïve : la rupture dure comme d'habitude pour ce couple.

    Si l'on suppose une durée sans mémoire (loi exponentielle) de moyenne
    égale à la durée moyenne des ruptures du couple sur 180 jours, la chance
    qu'elle se termine dans les 24 h vaut 1 − exp(−24 / durée moyenne). Un
    couple sans rupture close dans la fenêtre reçoit le taux de base de
    l'entraînement (`prior`). C'est ce que ferait quelqu'un qui connaît sa
    station — le modèle doit faire mieux, notamment en tenant compte de l'âge
    de la rupture et des livraisons alentour.
    """
    mean_hours = X["sf_mean_duration_hours_180d"].to_numpy(dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        p = 1 - np.exp(-HORIZON_HOURS / mean_hours)
    known = np.isfinite(mean_hours) & (mean_hours > 0)
    return np.clip(np.where(known, p, prior), 0, 1)


RESTOCK = ModelSpec(
    collection=COLLECTION,
    feature_columns=tuple(FEATURE_COLUMNS),
    categorical_features=tuple(CATEGORICAL_FEATURES),
    baseline=baseline,
    baseline_label="la durée habituelle des ruptures du couple",
    events="réapprovisionnements",
    log="restock-chance",
)
