import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

MONGODB_URI = os.environ["MONGODB_URI"]
DB_NAME = "scrapper"
MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "deal_price_model.joblib"
