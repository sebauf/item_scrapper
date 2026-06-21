"""Trains a regression model that predicts the 'expected' price of a
product from its context (category, discount info, rolling price stats).

The model is trained across *all* products at once rather than per-product,
since any single product only has a handful of daily observations — pooling
data lets the model learn general pricing patterns even with shallow
per-product history.
"""
import joblib
from pymongo.database import Database
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from src.scoring.features import FEATURE_COLUMNS, TARGET_COLUMN, build_frame

CATEGORICAL_FEATURES = ["shop", "keyword"]
NUMERIC_FEATURES = [c for c in FEATURE_COLUMNS if c not in CATEGORICAL_FEATURES]

MIN_TRAINING_ROWS = 20


def build_model() -> Pipeline:
    preprocessor = ColumnTransformer(
        transformers=[
            ("categorical", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
            ("numeric", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
        ]
    )
    return Pipeline(
        steps=[
            ("preprocess", preprocessor),
            ("model", GradientBoostingRegressor(random_state=0)),
        ]
    )


def train(db: Database, model_path) -> Pipeline | None:
    docs = list(db["price_history"].find({}))
    frame = build_frame(docs)

    if len(frame) < MIN_TRAINING_ROWS:
        print(f"Not enough data to train ({len(frame)} rows, need >= {MIN_TRAINING_ROWS}). Skipping.")
        return None

    pipeline = build_model()
    pipeline.fit(frame[FEATURE_COLUMNS], frame[TARGET_COLUMN])

    model_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, model_path)
    print(f"Model trained on {len(frame)} rows, saved to {model_path}")
    return pipeline


if __name__ == "__main__":
    from pymongo import MongoClient

    from src.config import DB_NAME, MODEL_PATH, MONGODB_URI

    client = MongoClient(MONGODB_URI)
    train(client[DB_NAME], MODEL_PATH)
