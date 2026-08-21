# bloom-agent — Production Field Agent App

**Domain:** agent.edubloom.com.ng
**Repo:** bloom-agent
**Last updated:** 2026-08-20

---

## App Overview

Vanilla JS/HTML PWA. Field agents submit school deals to Bayo for approval.
Offline-first: deals queued in localStorage SQ when offline, auto-synced on reconnect.
Login: phone number only (no Firebase Auth). Agent profile read from `admin_agents` by phone.
First login needs internet. All subsequent use works fully offline.

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
OCR name list rendered with `n.replace(/<\/g,'&lt;')` — only escaped `<`, left
`>`, `"`, `&` raw. OCR output going directly into `listEl.innerHTML`.
Fixed: replaced with `esc(n)` — full HTML entity encoding via existing sanitizer.
`esc()` is already used throughout the file; this brings this one instance in line.

**Cache bump:** `?v=20260820-security` | sw.js CACHE_NAME bumped to match

**Firestore rules:** Correctly published Aug 19, 2026. No changes needed.
`admin_agents` is `allow read: if true` — agent phone login works as designed.

**Note on pentest-ci.js:** Cannot run from Claude's network (firestore.googleapis.com
not in egress allowlist). Runs correctly in GitHub Actions CI. False negatives appear
when run locally from Claude — ignore those; the GitHub Actions results are authoritative.

---

### 2026-08-18 — Groq Rotator

Groq key rotator added. OCR keys loaded from `public_ocr_keys/main` (synced by portal).
HF fallback cached in localStorage (public key — acceptable by design).
Self-registration (`doRegister`) routes to `submitAgentRequest()` → creates pending
request in `admin_agent_requests` for Bayo to approve. This is correct design, not a bypass.

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
