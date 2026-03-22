from fastapi import FastAPI
from pydantic import BaseModel
import os
import torch

app = FastAPI(title="EGX-Nexus Deep Learning Engine")

# Fetch environment variables for GPU usage and DL framework
USE_GPU = os.getenv("USE_GPU", "false").lower() == "true"
DL_FRAMEWORK = os.getenv("DL_FRAMEWORK", "pytorch").lower()

# Check CUDA availability if requested
DEVICE = "cuda" if USE_GPU and torch.cuda.is_available() else "cpu"

class PredictionRequest(BaseModel):
    symbol: str
    features: list[float]

@app.get("/")
def read_root():
    return {
        "service": "deep-learning-engine",
        "status": "active",
        "framework": DL_FRAMEWORK,
        "device": DEVICE,
        "hybrid_mode": True
    }

@app.get("/health")
def health_check():
    """Health check endpoint for Docker container orchestration."""
    return {"status": "ok"}

@app.post("/predict")
def predict_trend(request: PredictionRequest):
    """
    Placeholder endpoint for DL models (LSTMs/Transformers).
    Receives high-dimensional feature embeddings and returns
    non-linear probabilities for Bull/Bear/Hold.
    """
    # Logic: Pass `request.features` into the loaded PyTorch/TensorFlow model
    # Returning a mock payload for the multi-agent debate system (core-brain)
    return {
        "symbol": request.symbol,
        "probabilities": {
            "bullish": 0.65,
            "bearish": 0.20,
            "neutral": 0.15
        },
        "regime_shift_detected": False,
        "confidence": 0.85
    }
