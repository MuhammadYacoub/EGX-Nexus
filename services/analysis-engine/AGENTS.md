# `analysis-engine` Microservice

## Role & Responsibility
**Technical Indicators & Analytical Framework**
The `analysis-engine` calculates key technical indicators and interprets the market using classic and complex methodologies. This service is purely analytical and deterministically processes price/volume data coming from Redis/MySQL.

## Technical Specifications
- **Stack:** Node.js
- **Internal Port:** 3002
- **Status:** Scaffolded. Phase 5 Target.

## Target Indicators (Phase 5)
- **Wyckoff Method**: Phase detection algorithm.
- **Elliott Wave**: Wave counter logic.
- **RSI, MACD, Bollinger Bands**.
- **Volume Profile analysis**.

## Notes for AI Agents
- **NO LLMS HERE.** All logic should be strictly mathematical and rule-based.
- Outputs must be structured JSON signals per symbol and sent to Redis to be consumed by `core-brain`.
