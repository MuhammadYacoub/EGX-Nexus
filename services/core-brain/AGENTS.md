# `core-brain` Microservice

## Role & Responsibility
**Orchestrator & Multi-Agent Debate Manager**
The `core-brain` acts as the central hub of the EGX-Nexus. It coordinates the execution of various AI agents, manages the debate system, filters through the risk manager, and finalizes the trading decision (BUY/SELL/HOLD).

## Technical Specifications
- **Stack:** Node.js
- **Internal Port:** 3000
- **Status:** Scaffolded. Phase 6 target for full Multi-Agent Debate implementation.

## Agent System Guidelines (`src/agents/`)
This service houses the core intelligence of EGX-Nexus.
**CRITICAL:** Do not use OpenAI/Anthropic APIs here.
- `bull-agent.js` / `bear-agent.js`: Use Chaimera specialized ML models.
- `technical-agent.js`: Pure deterministic logic (Wyckoff, Elliott). No LLM.
- `sentiment-agent.js`: Uses local Ollama (`llama3`) for Arabic news ONLY.
- `debate-manager.js`: Weighted voting (70% ML models, 30% sentiment).
- `risk-manager.js`: Applies position sizing and drawdown limits.
- `decision-agent.js`: Final publisher to Redis. Outputs strictly structured JSON.

## Notes for AI Agents
- Ensure all logic is fully modular.
- Do not bypass the `debate-manager` or `risk-manager` when publishing a final decision.
- Wait for Phase 6 instructions before making major logic changes to agents.
