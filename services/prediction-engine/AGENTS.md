# `prediction-engine` Microservice

## Role & Responsibility
**Live Broker WebSocket Listener + Real-time Signal Publisher**
This service maintains the real-time WebSocket connection to the local broker API to retrieve live price data and stream signals directly into the Redis queue for other microservices.

## Technical Specifications
- **Stack:** Node.js / TypeScript
- **Internal Port:** 3003
- **Status:** **Phase 2 Complete.**

## Notes for AI Agents
- **IMMUTABLE SERVICE:** This service was completed in Phase 2. **Never modify this service** unless explicitly instructed to do so by the user.
- It forms the core stream of real-time market data directly into the system. Breaking this breaks EGX-Nexus.
