# `auth-gateway` Microservice

## Role & Responsibility
**Session Management + TradingView Auth**
The `auth-gateway` provides session security, manages authentication, and specifically handles external API keys or TradingView WebSocket credentials via Thndr.

## Technical Specifications
- **Stack:** Node.js (Express, Redis for session cache)
- **Internal Port:** 3001
- **Status:** Integrated into Docker environment (Phase 3).

## Notes for AI Agents
- **Security First:** Never log sensitive tokens or passwords in plain text.
- **Port Constraints:** Ensure this service listens strictly on `3001` to map correctly into the internal `nginx` configuration on port `8080`.
- Verify external inputs rigorously to prevent credential leaks.
