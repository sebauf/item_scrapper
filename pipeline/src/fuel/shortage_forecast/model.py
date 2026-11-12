"""Entraînement, validation et stockage du modèle de rupture à 24 heures.

**Estimateur** : `HistGradientBoostingClassifier` (scikit-learn), c'est-à-dire
du gradient boosting sur arbres, la famille qui domine sur les données
tabulaires. Il gère nativement les valeurs manquantes (station sans
historique) et les variables catégorielles (carburant), et capte les
interactions qu'une régression logistique manquerait (« dimanche soir **et**
station souvent en rupture »).

**Deux corrections du régime qui change.** La crise de 2026 a multiplié le
taux de rupture par 17 en quelques mois ; un modèle qui pèserait autant 2025
que la semaine dernière se tromperait d'échelle :

1. *Pondération temporelle* : un exemple vieux de `DECAY_DAYS` jours pèse
   e⁻¹ ≈ 37 % d'un exemple d'aujourd'hui.
2. *Calibration de Platt* sur les `CALIBRATION_DAYS` derniers jours, tenus à
   l'écart de l'entraînement : une régression logistique sur le logit des
   probabilités, qui les recale sur la fréquence observée récemment. Sans
   elle, la validation d'octobre 2026 montrait un modèle annonçant 87 % pour
   58 % de ruptures réelles.

**Validation temporelle, jamais aléatoire.** Mélanger les jours ferait
apprendre au modèle la veille et le lendemain du jour testé : il paraîtrait
excellent et ne le serait pas. On rejoue donc exactement la situation de
production, décalée dans le passé (*backtest*) :

    ──── entraînement ────┤1 j├── calibration (21 j) ──┤1 j├── test (28 j) ──┤ fin de l'archive − 24 h

Le jour d'écart évite qu'un même épisode de rupture serve d'étiquette d'un
côté et de variable de l'autre. Le modèle mis en service est ensuite
réentraîné de la même façon sur la période qui finit à la dernière date
étiquetable, test compris : les dernières semaines sont les plus utiles.

**Garde-fou** : le nouveau modèle n'est mis en service que s'il bat, sur le
test, la méthode naïve « fréquence des ruptures du couple sur 30 jours ». Un
modèle qui ne fait pas mieux qu'une moyenne n'a rien à faire en production ;
l'ancien reste alors en place.

**Deux modèles, une mécanique.** Le même code entraîne le modèle de
réapprovisionnement (`src.fuel.restock_forecast`) : seuls changent les
variables, la méthode naïve à battre et la collection de stockage, réunis dans
un `ModelSpec`. Le comportement par défaut (`SHORTAGE`) est celui du modèle de
rupture.

**Stockage** : le modèle sérialisé (pickle, ~1 Mo) va dans MongoDB
(`fuel_shortage_models`, `_id: "current"`), avec ses métriques. Pas de volume
persistant à monter : c'est ce qui avait fait retirer le précédent modèle du
projet. Contrepartie à connaître : charger un pickle exécute du code ; qui
peut écrire dans cette collection peut donc exécuter du code dans les tâches
du pipeline. La base n'est pas exposée hors du cluster pour cette raison
entre autres (le NodePort `mongodb-external` ne doit servir que sur le LAN).
"""
import io
import pickle
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np
import pandas as pd
import sklearn
from bson.binary import Binary
from pymongo.database import Database
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

from src.clock import naive_utc_now
from src.fuel.shortage_forecast.dataset import Dataset
from src.fuel.shortage_forecast.features import CATEGORICAL_FEATURES, FEATURE_COLUMNS

COLLECTION = "fuel_shortage_models"
MODEL_ID = "current"

DECAY_DAYS = 60
CALIBRATION_DAYS = 21
TEST_DAYS = 28
GAP_DAYS = 1

# En dessous, l'échantillon ne dit rien : pas d'entraînement.
MIN_POSITIVES = 500

# Seuil utilisé pour rapporter précision et rappel dans les métriques ; celui
# des alertes est réglable à part (cf. restock_alerts.py), le défaut étant le même.
REPORT_THRESHOLD = 0.5

HYPERPARAMETERS = dict(
    max_iter=300,
    learning_rate=0.08,
    max_leaf_nodes=31,
    min_samples_leaf=200,
    l2_regularization=1.0,
    early_stopping=False,
    random_state=0,
)


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


@dataclass
class ShortageModel:
    """Estimateur + calibration, et ce qu'il faut pour vérifier qu'il
    correspond au code qui le charge."""
    estimator: HistGradientBoostingClassifier
    calibrator: LogisticRegression
    feature_columns: list[str] = field(default_factory=lambda: list(FEATURE_COLUMNS))

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        """Probabilité qu'une rupture commence dans les 24 h."""
        raw = self.estimator.predict_proba(X[self.feature_columns])[:, 1]
        return self.calibrator.predict_proba(_logit(raw)[:, None])[:, 1]


def baseline(X: pd.DataFrame, prior: float | None = None) -> np.ndarray:
    """Méthode naïve : la fréquence quotidienne des ruptures du couple sur
    30 jours. C'est elle que le modèle doit battre. (`prior` : inutile ici,
    cf. `ModelSpec.baseline`.)"""
    return np.clip(X["sf_starts_30d"].to_numpy(dtype=float) / 30, 0, 1)


@dataclass(frozen=True)
class ModelSpec:
    """Ce qui distingue un modèle de l'autre ; tout le reste est partagé.

    - `baseline(X, prior)` : la méthode naïve à battre, en probabilité ;
      `prior` est le taux de base pondéré de l'entraînement, pour les
      instantanés sur lesquels la méthode naïve n'a rien à dire ;
    - `events` : le nom de l'événement prévu, pour les messages ;
    - `log` : préfixe des lignes de journal.
    """
    collection: str
    feature_columns: tuple[str, ...]
    categorical_features: tuple[str, ...]
    baseline: Callable[[pd.DataFrame, float], np.ndarray]
    baseline_label: str
    events: str
    log: str


SHORTAGE = ModelSpec(
    collection=COLLECTION,
    feature_columns=tuple(FEATURE_COLUMNS),
    categorical_features=tuple(CATEGORICAL_FEATURES),
    baseline=baseline,
    baseline_label="la fréquence sur 30 jours",
    events="ruptures",
    log="shortage-risk",
)


def time_weights(t: pd.Series, reference: pd.Timestamp) -> np.ndarray:
    age_days = ((reference - t).dt.total_seconds() / 86400).to_numpy()
    return np.exp(-np.maximum(age_days, 0) / DECAY_DAYS)


def fit(dataset: Dataset, train: np.ndarray, calibration: np.ndarray, reference: pd.Timestamp,
        spec: ModelSpec = SHORTAGE) -> ShortageModel:
    """Entraîne sur `train`, calibre sur `calibration` (masques booléens)."""
    t = dataset.meta["t"]
    weight = dataset.weight * time_weights(t, reference)
    columns = list(spec.feature_columns)
    estimator = HistGradientBoostingClassifier(
        categorical_features=[c in spec.categorical_features for c in columns], **HYPERPARAMETERS
    )
    X = dataset.X[columns]
    estimator.fit(X[train], dataset.y[train], sample_weight=weight[train])
    raw = estimator.predict_proba(X[calibration])[:, 1]
    # C très grand : pas de régularisation, deux paramètres seulement.
    calibrator = LogisticRegression(C=1e6)
    calibrator.fit(_logit(raw)[:, None], dataset.y[calibration], sample_weight=dataset.weight[calibration])
    return ShortageModel(estimator, calibrator, columns)


def evaluate(y: np.ndarray, weight: np.ndarray, p: np.ndarray, threshold: float = REPORT_THRESHOLD) -> dict:
    """Métriques pondérées (les poids corrigent le sous-échantillonnage).

    - `auc` : probabilité qu'un instantané suivi d'une rupture soit mieux
      classé qu'un autre — 0,5 = hasard, 1 = parfait ;
    - `averagePrecision` : aire sous la courbe précision-rappel, plus
      exigeante que l'AUC quand l'événement est rare ;
    - `brier` : erreur quadratique des probabilités (plus bas = mieux) ;
      c'est elle qui dit si « 30 % » veut bien dire 30 % ;
    - `precision` / `recall` au seuil d'alerte : part des alertes suivies
      d'une rupture, part des ruptures annoncées.
    """
    alert = p >= threshold
    positives = (weight * y).sum()
    return {
        "n": int(len(y)),
        "positives": int(y.sum()),
        "baseRate": float(np.average(y, weights=weight)),
        "meanPredicted": float(np.average(p, weights=weight)),
        "auc": float(roc_auc_score(y, p, sample_weight=weight)),
        "averagePrecision": float(average_precision_score(y, p, sample_weight=weight)),
        "brier": float(brier_score_loss(y, p, sample_weight=weight)),
        "threshold": threshold,
        "precision": float(np.average(y[alert], weights=weight[alert])) if alert.any() else None,
        "recall": float((weight[alert] * y[alert]).sum() / positives) if positives else None,
    }


def split_masks(t: pd.Series, end: pd.Timestamp, test_days: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Masques entraînement / calibration / test, du plus ancien au plus
    récent, séparés d'un jour. `test_days=0` : pas de test (mise en service)."""
    day = pd.Timedelta(days=1)
    test_start = end - test_days * day
    calib_end = test_start - (GAP_DAYS * day if test_days else pd.Timedelta(0))
    calib_start = calib_end - CALIBRATION_DAYS * day
    train_end = calib_start - GAP_DAYS * day
    train = (t < train_end).to_numpy()
    calibration = ((t >= calib_start) & (t < calib_end)).to_numpy()
    test = (t >= test_start).to_numpy() if test_days else np.zeros(len(t), dtype=bool)
    return train, calibration, test


@dataclass
class TrainingResult:
    model: ShortageModel | None
    metrics: dict
    accepted: bool
    reason: str


def train_and_validate(dataset: Dataset, spec: ModelSpec = SHORTAGE) -> TrainingResult:
    """Backtest, puis réentraînement sur toute la période si le modèle bat la
    méthode naïve."""
    t = dataset.meta["t"]
    positives, negatives = int(dataset.y.sum()), int(len(dataset.y) - dataset.y.sum())
    if positives < MIN_POSITIVES:
        return TrainingResult(None, {"positives": positives}, False,
                              f"moins de {MIN_POSITIVES} {spec.events} dans l'échantillon")
    if negatives < MIN_POSITIVES:
        return TrainingResult(None, {"positives": positives, "negatives": negatives}, False,
                              f"moins de {MIN_POSITIVES} instantanés sans {spec.events} dans l'échantillon")
    end = t.max().ceil("s") + pd.Timedelta(seconds=1)

    train, calibration, test = split_masks(t, end, TEST_DAYS)
    backtest = fit(dataset, train, calibration, reference=end - pd.Timedelta(days=TEST_DAYS), spec=spec)
    y, w = dataset.y[test], dataset.weight[test]
    prior = float(np.average(dataset.y[train], weights=dataset.weight[train]))
    model_metrics = evaluate(y, w, backtest.predict(dataset.X[test]))
    baseline_metrics = evaluate(y, w, spec.baseline(dataset.X[test], prior))
    metrics = {
        "test": model_metrics,
        "baseline": baseline_metrics,
        "testFrom": (end - pd.Timedelta(days=TEST_DAYS)).to_pydatetime(),
        "testUntil": end.to_pydatetime(),
    }

    better = (model_metrics["averagePrecision"] > baseline_metrics["averagePrecision"]
              and model_metrics["brier"] < baseline_metrics["brier"])
    if not better:
        return TrainingResult(None, metrics, False,
                              f"le modèle ne bat pas {spec.baseline_label} (précision moyenne et Brier)")

    train, calibration, _ = split_masks(t, end, 0)
    return TrainingResult(fit(dataset, train, calibration, reference=end, spec=spec), metrics, True, "ok")


def save_model(db: Database, result: TrainingResult, data_until: datetime, trained_at: datetime | None = None,
               spec: ModelSpec = SHORTAGE):
    """Met le modèle en service, avec ses métriques et ses versions."""
    trained_at = trained_at or naive_utc_now()
    buffer = io.BytesIO()
    pickle.dump(result.model, buffer, protocol=pickle.HIGHEST_PROTOCOL)
    db[spec.collection].replace_one(
        {"_id": MODEL_ID},
        {
            "payload": Binary(buffer.getvalue()),
            "trainedAt": trained_at,
            "dataUntil": data_until,
            "metrics": result.metrics,
            "featureColumns": list(spec.feature_columns),
            "sklearnVersion": sklearn.__version__,
        },
        upsert=True,
    )


def record_rejection(db: Database, result: TrainingResult, attempted_at: datetime,
                     spec: ModelSpec = SHORTAGE):
    """Garde la trace d'un entraînement refusé, sans toucher au modèle en service."""
    db[spec.collection].update_one(
        {"_id": "last_rejected"},
        {"$set": {"attemptedAt": attempted_at, "reason": result.reason, "metrics": result.metrics}},
        upsert=True,
    )


# Un modèle plus vieux ne connaît plus le régime en cours : mieux vaut ne
# rien annoncer qu'annoncer faux.
MAX_MODEL_AGE_DAYS = 7


def load_model(db: Database, now: datetime, spec: ModelSpec = SHORTAGE) -> ShortageModel | None:
    """Le modèle en service, ou None s'il manque, est périmé, ou ne
    correspond plus au code (variables, version de scikit-learn)."""
    doc = db[spec.collection].find_one({"_id": MODEL_ID})
    if doc is None:
        return None
    if now - doc["trainedAt"] > pd.Timedelta(days=MAX_MODEL_AGE_DAYS):
        print(f"{spec.log}: modèle du {doc['trainedAt']:%d/%m} trop ancien, ignoré")
        return None
    if doc.get("featureColumns") != list(spec.feature_columns):
        print(f"{spec.log}: modèle entraîné sur d'autres variables, ignoré")
        return None
    # Un pickle scikit-learn n'est garanti relisible que par la même version.
    if doc.get("sklearnVersion") != sklearn.__version__:
        print(f"{spec.log}: modèle scikit-learn {doc.get('sklearnVersion')} "
              f"≠ {sklearn.__version__}, ignoré jusqu'au prochain entraînement")
        return None
    return pickle.loads(doc["payload"])
