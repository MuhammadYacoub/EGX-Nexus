# `training-pipeline` Microservice

## Role & Responsibility
**Hybrid AI Training Pipeline (ML + DL) on EGX Data**
This is the algorithmic and neural network backbone of EGX-Nexus. It uses Python scripts to continuously train and retrain specialized Machine Learning (ML) classifiers and advanced Deep Learning (DL) models (like LSTMs/Transformers) using historical EGX data harvested by the `data-harvester`.

## Technical Specifications
- **Stack:** Python, Scikit-learn, TensorFlow / PyTorch
- **Internal Port:** N/A (Offline Batch Processing / Scheduled Jobs)
- **Status:** Scaffolded. Phase 7 Target.

## Target Functionality (Phase 7)
- **Dataset:** Massive EGX historical datasets and OHLCV chunks from MySQL.
- **Model Types:** Traditional classifiers (SVM, Random Forest) for `core-brain` agents, and Deep Neural Networks (LSTMs) for the `deep-learning-engine`.
- **Output:** Model artifacts that are loaded into `core-brain` and the `deep-learning-engine` dynamically.

## Notes for AI Agents
- **NO LLMS HERE.** Do not use OpenAI/Anthropic APIs for analysis or data generation. This pipeline is exclusively for structural, mathematical, and algorithmic model building.
- Always support dual export formats depending on the target framework (e.g., `.pkl` for scikit-learn ML agents, `.pt`/`.h5` for PyTorch/TF engines).
- Keep dependencies clearly mapped in a `requirements.txt` file when the time comes.
