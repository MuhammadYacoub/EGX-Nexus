# `data-harvester` Microservice

## Role & Responsibility
**Yahoo Finance OHLCV Collector**
The `data-harvester` ensures the MySQL database is continuously updated with the latest OHLCV (Open, High, Low, Close, Volume) data.

## Technical Specifications
- **Stack:** Node.js
- **Internal Port:** 3005
- **Status:** **Phase 2 Complete.**

## Execution Details
- Uses a `cron` job scheduler set to run daily at 7 PM Cairo time.
- Gathers data from Yahoo Finance and updates the `MySQL` database safely.

## Notes for AI Agents
- **IMMUTABLE SERVICE:** This service was built and completed in Phase 2. **Never modify this service** without explicit instructions.
- Ensure any database reads in other microservices point strictly to the `MySQL` instance updated by this service.
