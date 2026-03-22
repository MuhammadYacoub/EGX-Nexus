# EGX-Nexus — Master Context Prompt for AI Agents

Welcome, AI Agent. This file serves as your core directive and master context when operating within the EGX-Nexus repository. Please read this entirely before making any modifications.

## Project Identity
- **Name:** EGX-Nexus (Egyptian Exchange Nexus)
- **Owner:** Muhammad Yacoub — Digital Transformation Leader, Egyptian State Lawsuits Authority
- **Status:** Active development — Phase 3 complete, Phase 4 next
- **Language Stack:** Node.js, TypeScript, Python, SQL
- **Infrastructure:** Docker Compose, MySQL, TimescaleDB, Redis, Nginx

## Core Mission
Build a fully autonomous AI-powered trading intelligence platform exclusively for the Egyptian Stock Exchange (EGX). The system must:
- Operate locally with **no dependency on paid external APIs** (e.g., OpenAI, Anthropic).
- Use specialized ML models trained on EGX data.
- Provide real-time analysis and BUY/SELL/HOLD decisions.
- Democratize financial intelligence for Egyptian traders.

## Architecture — Microservices
All services run in Docker containers orchestrated by `docker-compose.yml`.

| Service | Port | Role | Tech Stack |
|---------|------|------|------------|
| `core-brain` | 3000 | Orchestrator + Multi-Agent Debate Manager | Node.js |
| `auth-gateway` | 3001 | Session management + TradingView auth | Node.js |
| `analysis-engine` | 3002 | Technical indicators: Wyckoff, Elliott, RSI, MACD | Node.js |
| `prediction-engine` | 3003 | TradingView WebSocket listener (via Thndr) + signal publisher | Node.js/TS |
| `data-harvester` | 3005 | Yahoo Finance OHLCV collector, cron daily 7PM Cairo time | Node.js |
| `notification-hub` | 3006 | Telegram alerts for signals and decisions | Node.js |
| `dashboard-api` | 3007 | REST API for UI and dashboard | Node.js |
| `training-pipeline`| N/A | Python ML model training on EGX data | Python |
| `ollama` | 11434 | Local LLM for NLP and Arabic news only | Ollama |

## Databases
- **MySQL:** Relational data, stock metadata, OHLCV history.
- **TimescaleDB:** Time-series data for real-time price streams.
- **Redis:** Live signal bus, caching, pub/sub between services.

## Infrastructure Notes
- Server runs Nginx Proxy Manager (NPM) on port `80`/`443`.
- **EGX-Nexus internal Nginx must use port `8080` (not `80`) to avoid conflicts.**
- All services must be checked for port conflicts before `docker-compose up`.

## The Multi-Agent Debate System (Phase 6 — Planned)
This is the intelligence core of EGX-Nexus. Located inside: `services/core-brain/src/agents/`

**CRITICAL DESIGN DECISION:** Do **NOT** use generic LLMs (OpenAI, Anthropic) for financial analysis. Use specialized models trained on EGX data from the Chaimera project. Ollama is **only** for Arabic NLP and news sentiment.

### Agent Roles:
1. **bull-agent.js**: Uses Chaimera specialized model. Finds bullish signals, accumulation phases, demand zones.
2. **bear-agent.js**: Uses Chaimera specialized model. Finds bearish signals, distribution phases, supply zones.
3. **technical-agent.js**: Deterministic rule engine (Wyckoff + Elliott Wave rules). Identifies market phase, wave count. **Does NOT use any LLM.**
4. **sentiment-agent.js**: Uses Ollama `llama3` (local). Analyzes Arabic news, market sentiment, EGX announcements. **Only agent allowed to use Ollama.**
5. **debate-manager.js**: Collects all agent outputs, runs weighted voting. Weights: specialized models 70%, Ollama sentiment 30%. Output: `{ action, confidence, reasoning, dissenting_view }`.
6. **risk-manager.js**: Applies position sizing, drawdown limits, risk filters to the debate-manager output. Output: final executable signal.
7. **decision-agent.js**: Formats final decision, publishes to Redis, triggers `notification-hub`.

### Data Flow Cycle:
`prediction-engine` (live price) ──→ Redis
`data-harvester` (OHLCV history) ──→ MySQL
`analysis-engine` (indicators)   ──→ Redis
        ↓
`core-brain` collects all data
        ↓
`bull-agent` + `bear-agent` + `technical-agent` run in parallel
        ↓
`sentiment-agent` runs (Ollama — Arabic news)
        ↓
`debate-manager` resolves with weighted voting
        ↓
`risk-manager` applies filters
        ↓
`decision-agent` publishes: BUY / SELL / HOLD + confidence + reason
        ↓
`notification-hub` → Telegram alert
        ↓
`dashboard-api` → UI visualization

## Chaimera Connection
Chaimera is a sister project (private repo) that contains trained ML models specialized on EGX patterns, an Alpha engine, and the broker gateway. EGX-Nexus consumes Chaimera models—it does not retrain them. Training happens in `services/training-pipeline` (Python). Models are stored as artifacts and loaded by the agents at runtime.

## Project Phases
- **Phase 1 [Complete]:** Full microservices scaffold.
- **Phase 2 [Complete]:** `prediction-engine` + `data-harvester`.
- **Phase 3 [Complete]:** `docker-compose.yml` with healthchecks.
- **Phase 4 [Current]:** Nginx internal config (port `8080`), audit server ports, write `nginx.conf`, document `.env.example`.
- **Phase 5 [Planned]:** `analysis-engine` (Wyckoff, Elliott, RSI, MACD).
- **Phase 6 [Planned]:** Multi-Agent Debate System integration in `core-brain`.
- **Phase 7 [Planned]:** `training-pipeline` scripts.
- **Phase 8 [Planned]:** Dashboard UI.

## Explicit AI Instructions & Rules
1. **Context Awareness:** Always check which Phase is current before making changes.
2. **Immutable Services:** Never modify `prediction-engine` or `data-harvester` (Phase 2 complete) unless explicitly instructed.
3. **LLM Restrictions:** Never use OpenAI or Anthropic APIs. Local models only.
4. **Port Allocation:** Port `80` is taken by NPM. Use `8080` for internal Nginx.
5. **Infrastructure Updates:** When adding new services, add `healthcheck` and `depends_on` to `docker-compose.yml`.
6. **Commit Guidelines:** Use conventional commits: `type(scope): description`.
   - *Example:* `feat(core-brain): add bull-agent scaffold`
7. **Data Formatting:** All analysis logic must output structured JSON (not plain text).
8. **Localization:** Arabic content must be handled natively—do not translate to English first.
