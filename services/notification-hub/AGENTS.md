# `notification-hub` Microservice

## Role & Responsibility
**Telegram Alerts Publisher**
The `notification-hub` listens for final decisions and signals from the `core-brain` (via Redis) and dispatches user-friendly notifications to Telegram.

## Technical Specifications
- **Stack:** Node.js
- **Internal Port:** 3006
- **Status:** Integrated into Docker environment (Phase 3).

## Data Consumption
- Listens for messages on Redis.
- Formats final signals: BUY/SELL/HOLD + confidence + reason into a readable, Arabic-aware message.

## Notes for AI Agents
- **Arabic Native Support:** Ensure this service handles Arabic strings natively. Do not add English translations before sending unless explicitly designed as bilingual.
- Utilize the `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` environment variables for sending out messages safely.
