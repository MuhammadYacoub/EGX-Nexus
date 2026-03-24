# EGX-Nexus Port Registry

## Internal Service Ports (Docker network)
| Service           | Internal Port | External Port | Notes |
|---|---|---|---|
| nginx             | 80            | 8080          | Host port — NPM routes to this |
| core-brain        | 3000          | 3000          | Internal only in production |
| auth-gateway      | 3001          | 3001          | Internal only in production |
| analysis-engine   | 3002          | 3002          | Internal only in production |
| prediction-engine | 3003          | 3003          | Internal only in production |
| data-harvester    | 3005          | 3005          | Internal only in production |
| notification-hub  | 3006          | 3006          | Internal only in production |
| dashboard-api     | 3007          | 3007          | Internal only in production |
| mysql             | 3306          | 3306          | Restrict in production |
| timescaledb       | 5432          | 5432          | Restrict in production |
| redis             | 6379          | 6379          | Restrict in production |
| ollama            | 11434         | 11434         | Phase 6 — not yet active |

## Conflict Warnings
- Port 80/443: Reserved for Nginx Proxy Manager
- Port 8080: EGX-Nexus entry point — NPM proxies to here

## Constraints
- Do NOT modify any files inside services/ directory
- Do NOT change healthcheck logic
- Do NOT change depends_on conditions
- All changes must be in: infrastructure/ and root config files only
