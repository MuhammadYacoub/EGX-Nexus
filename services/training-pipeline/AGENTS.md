# `training-pipeline` Microservice

## Role & Responsibility
**Python ML Model Training on EGX Data**
This is the machine learning backbone of the EGX-Nexus. It uses Python scripts to train and retrain specialized models based on historical EGX data harvested by the `data-harvester`.

## Technical Specifications
- **Stack:** Python
- **Internal Port:** N/A (Offline Batch Processing / Scheduled Jobs)
- **Status:** Scaffolded. Phase 7 Target.

## Target Functionality (Phase 7)
- **Dataset:** EGX historical data from the MySQL `data-harvester` source.
- **Model Types:** Pattern classifiers and regime detectors.
- **Output:** Model artifacts consumed by the Chaimera model loader inside `core-brain` agents.

## Notes for AI Agents
- **NO LLMS HERE.** Do not use OpenAI/Anthropic APIs for analysis or data generation. This is purely for algorithmic ML models like Random Forests, SVM, or specialized neural networks designed for financial pattern recognition.
- Keep dependencies clearly mapped in a `requirements.txt` file when the time comes.
