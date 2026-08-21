# bloom-agent — Production Field Agent App

**Domain:** agent.edubloom.com.ng
**Repo:** bloom-agent
**Last updated:** 2026-08-20

---

## App Overview

Vanilla JS/HTML PWA. Field agents submit school deals to Bayo for approval.
Offline-first: deals queued in localStorage SQ when offline, auto-synced on reconnect.
Login: phone number only — no Firebase Auth. Agent profile read from `admin_agents` by phone.
First login needs internet. All subsequent use works offline.

---

## Current Versions

| File | Version |
|------|---------|
| app.js | `?v=20260820-security` |
| sw.js CACHE_NAME | `edubloom-bloom-agent-20260820-security` |

---

## Session History

### 2026-08-20 — Production Security Audit

**XSS fix — app.js line 635:**
- OCR name list was rendered with `n.replace(/<\/g,'&lt;')` — only escaped `<`, not full HTML
- OCR output injected directly into `listEl.innerHTML`
- **Fix:** Replaced with `esc(n)` — full HTML entity encoding via the existing sanitizer

**Cache bust:** `app.js?v=20260820-security` | CACHE_NAME bumped | sw.js bumped

**Firestore pentest findings (shared rules — see School-Bloom README for full rule text):**
6 collections returning 403 when they should be open. Bayo must update Firebase Console rules.
Affected: `admin_agents` read, `admin_deals` read, `admin_ledger` read, `public_ocr_keys` read,
`schools` parent doc read, `admin_agent_requests` create.

---

### 2026-08-18 — Groq Rotator

Added Groq key rotator. OCR keys loaded from `public_ocr_keys/main`.
HF fallback key cached in localStorage (public key — acceptable by design).
Self-registration (`doRegister`) routes to `submitAgentRequest()` which creates a
pending request in `admin_agent_requests` (Bayo must approve). Not a bypass — correct design.

---

## Commission Structure

| Type | Rate |
|------|------|
| New school (closer) | 20% of term fee |
| Renewal (original closer, permanent) | 10% of term fee |

## Pricing Tiers

| Students | Fee/term |
|----------|----------|
| 1–50 | ₦10,000 |
| 51–100 | ₦20,000 |
| 101–200 | ₦35,000 |
| 201–350 | ₦55,000 |
| 351+ | ₦75,000 |
