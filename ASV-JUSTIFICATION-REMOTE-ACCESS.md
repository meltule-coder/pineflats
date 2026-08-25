# ASV / Clover Data Security Manager — Directory browsing & remote access

**Site:** https://pineflatsrvpark.com  
**Date:** 2026-07-29  
**Merchant:** Pine Flats RV Park  

## Finding

> Browsing of directories on web servers or having remote access software present can lead to information disclosure or potential exploit. Due to increased risk to the cardholder data environment, please 1) justify the business need for this configuration to the ASV, or 2) confirm that it is disabled.

---

## 1) Directory browsing — **DISABLED (confirm to ASV)**

| Control | Status |
|--------|--------|
| nginx `autoindex` | **off** on all server blocks |
| Express static `index` | **false** (no automatic index.html for directories) |
| Directory URL probes (`/uploads/`, `/assets/`, `/dist/`, etc.) | **HTTP 403** |
| Application SPA no longer serves HTML for trailing-slash directory paths | **HTTP 403** |
| Sensitive paths (`.env`, `.git`, `node_modules`, `data/`, etc.) | **HTTP 404** |

**Business need:** None. Directory listing is not required and is disabled.

---

## 2) Remote access software on the web host

### A) Web-based remote access UI (`/ssh`, `/vps`) — **DISABLED (confirm to ASV)**

| Item | Status |
|------|--------|
| Public routes `/ssh`, `/vps`, `/ssh.html` | **Removed / return 404** |
| TeamViewer, AnyDesk, VNC, RDP, Webmin, Cockpit, phpMyAdmin | **Not installed** |
| Application listens on public interfaces | **No** — Node binds to `127.0.0.1:3000` only; nginx is the sole public reverse proxy on 80/443 |

Server administration tooling for the park is a **desktop Electron app on staff PCs only**, not exposed on the cardholder data website.

### B) SSH (OpenSSH) — **business justification for ASV**

| Item | Detail |
|------|--------|
| Service | OpenSSH (`sshd`) on TCP **22** only |
| Purpose | **Server administration only** — deploy application updates, renew TLS certificates (Let's Encrypt), apply OS security patches, and recover from outages |
| Not used for | Payment processing, card entry, or guest-facing access |
| Card data | Full PAN/CVV are **never stored** on this host; online cards use **Clover Hosted iframe** (token `clv_…` only) |
| Hardening | fail2ban, restricted cipher/config where applied, password not used for payment systems; app not bound publicly |
| Alternatives considered | Console-only access would prevent automated deploys and cert renewal for this VPS |

**ASV response option:**  
*SSH is required solely for infrastructure administration of the web host. No other remote-access software is present. Web remote-access pages are disabled. Directory browsing is disabled. Cardholder data is not stored on this server.*

---

## How to answer in Clover Data Security Manager

1. **Directory browsing:** select **Disabled / remediated** (or equivalent).  
2. **Remote access software:**  
   - Web remote tools: **Disabled**  
   - SSH: **Justified** using the text under section 2B above  

Then request a **re-scan**.

---

## 3) Stateless / host firewall — **configured (confirm to ASV)**

Host firewall (**UFW**, default deny incoming) is enabled on the VPS.

| Traffic | Policy |
|--------|--------|
| **Default inbound** | **Deny** (only listed rules allowed) |
| **TCP 80, 443** | Allow from **Anywhere** — required for public park website, booking, and Clover Hosted iframe checkout |
| **TCP 22 (SSH)** | Allow **only** from specified admin IP(s) — management plane |
| **TCP 3000** | **Deny** public access (app binds to loopback only) |
| **All other inbound** | **Denied** |

**ASV response option:**  
*A host-based firewall is configured with default deny inbound. Public HTTP/HTTPS (80/443) is allowed for the merchant website and payment checkout pages. Administrative SSH (22) is restricted to specified IP addresses only. No other remote management ports are open.*

**To add another admin IP later** (from a machine that is already allowed):

```text
npx electron setup-firewall.cjs --ips=69.36.202.47,NEW.IP.HERE
```

(run from `vps-access` with your current and new IPs listed together)
