"""EGX-Nexus Training Pipeline"""
import os
import joblib
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sqlalchemy import create_engine

MODELS_PATH = os.getenv("MODELS_PATH", "./models")
os.makedirs(MODELS_PATH, exist_ok=True)

def load_data():
    engine = create_engine(os.getenv("MYSQL_URL"))
    df = pd.read_sql("SELECT * FROM stock_features WHERE created_at > DATE_SUB(NOW(), INTERVAL 180 DAY)", engine)
    return df

def train_signal_classifier(df):
    features = ["rsi", "macd", "bb_position", "volume_ratio", "price_change_5d"]
    X = df[features].dropna()
    y = df.loc[X.index, "signal"]  # 0=hold, 1=buy, -1=sell
    model = GradientBoostingClassifier(n_estimators=200, max_depth=4)
    model.fit(X, y)
    joblib.dump(model, f"{MODELS_PATH}/signal_classifier.pkl")
    print(f"✅ Signal classifier trained | samples: {len(X)}")

if __name__ == "__main__":
    try:
        df = load_data()
        train_signal_classifier(df)
    except Exception as e:
        print(f"⚠️ Could not connect to DB or load data. Error: {e}")
