# Security Policy

## Hardening (app)

| Control | Status |
|--------|--------|
| Admin password at rest | **scrypt** hash in `data/config.json` (`adminPasswordHash`). Legacy plain `adminPassword` is verified once then migrated. |
| Minimum admin password | **12 characters** (set/reset in UI and API). |
| Admin session cookie | `httpOnly`, `secure` in production, 12h sliding TTL, rate-limited login. |
| Public write rate limits | Comments **5 / 15 min / IP**, bookings **10 / 15 min / IP**, admin/preview login **8 / 15 min / IP**, recovery **6 / 15 min / IP**. |
| Card data | Clover Hosted iframe only — full PAN/CVV rejected on park APIs. |
| Security headers | CSP, HSTS (HTTPS), nosniff, frame options, referrer, permissions policy. |

Env secrets (`ADMIN_PASSWORD`, payment keys) stay in environment / secret store — not returned by any API.

## Production checklist

1. Set a unique admin password (≥12 chars) via **Settings → Change password** (stores scrypt hash).
2. Set `ADMIN_PASSWORD` only as bootstrap if needed; prefer changing password in the UI so only a hash is on disk.
3. Confirm `NODE_ENV=production` and HTTPS via nginx.
4. Keep SSH key-based admin access; no public `/ssh` web UI.

## Reporting a Vulnerability

Email the park operators / maintainers privately. Do not open a public issue with exploit details for live systems.

## External penetration testing / ASV

Authorized third-party external pen tests and PCI **ASV** scans require a signed scope of work. This repository’s code review and hardening are **not** a substitute for a formal external assessment.
