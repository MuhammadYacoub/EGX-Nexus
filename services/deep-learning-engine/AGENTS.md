# `deep-learning-engine` Microservice

## Role & Responsibility
**Hybrid AI Subsystem: GPU-Accelerated Deep Learning Model Serving**
The `deep-learning-engine` handles complex, high-dimensional financial data analysis utilizing Deep Learning (DL) models such as LSTMs and Transformers. It complements the traditional Machine Learning (ML) classifiers in the `core-brain` by providing sequence pattern recognition and dynamically adapting to market volatility.

## Technical Specifications
- **Stack:** Python, FastAPI, PyTorch / TensorFlow
- **Internal Port:** 3008
- **Status:** Scaffolded. Ready for Hybrid AI DL model integration.

## Key Environment Variables
- `USE_GPU`: Controls if the service utilizes CUDA resources (if available on the host machine).
- `DL_FRAMEWORK`: Dictates which backend to instantiate (`pytorch` or `tensorflow`).

## Notes for AI Agents
- **GPU Awareness:** Always write tensor ops in an interoperable way (e.g., using `.to(device)` in PyTorch depending on the `USE_GPU` flag).
- **Communication Protocol:** The service communicates with `core-brain` primarily via Redis message queues and standard REST endpoints exposed by FastAPI.
- **Data Formatting:** Output complex feature embeddings and non-linear probabilities natively as structured JSON to be consumed directly by the multi-agent debate system.
