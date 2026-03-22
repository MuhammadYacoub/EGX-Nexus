# `prediction-engine` Microservice

## Role & Responsibility
**TradingView WebSocket Listener (via Thndr) + Real-time Signal Publisher**
This service maintains the real-time WebSocket connection to TradingView to retrieve live price data and stream signals directly into the Redis queue for other microservices.

## Technical Specifications
- **Stack:** Node.js / TypeScript
- **Internal Port:** 3003
- **Status:** **Phase 2 Complete.** Populated from the Chaimera broker-gateway.

## Notes for AI Agents
- **IMMUTABLE SERVICE:** This service was completed in Phase 2. **Never modify this service** unless explicitly instructed to do so by the user.
- It forms the core stream of real-time market data directly into the system. Breaking this breaks EGX-Nexus.
