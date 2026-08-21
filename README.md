---

## 2026-08-18 — Website, Proposal & Flyer: Full Rebuild

### Context
After market research revealed Klasify, Edumaat, and Schoolmo as competitors, the old materials ("Gold Standard for Nigerian Schools", generic feature list) could not compete. The new materials are rebuilt entirely around three specific differentiators no competitor can honestly claim.

### New positioning — three pillars
1. **Teachers:** Only school software in Nigeria with AI lesson notes + exam papers genuinely aligned to the FG new curriculum. Teachers get 3–5 hours back per week.
2. **Proprietors:** Only school software with bank-statement-only fee authority + Proprietor-only audit log + 7-day entry reversal. No manual approval by any staff member is possible.
3. **Agents:** Ledger scan shows the school their own outstanding fees before any pitch is made. Most powerful sales tool in the market — no competitor has it.

### New pricing (revised from old tiers)
| Tier | Students | Per Term |
|---|---|---|
| Small | 1–50 | ₦15,000 |
| Growing | 51–100 | ₦25,000 |
| Medium | 101–200 | ₦38,000 |
| Large | 201–350 | ₦55,000 |
| Very Large | 351+ | ₦75,000 |

Mid-tiers reduced significantly to survive Klasify comparison (was ₦52,500 for 101–200 vs ₦20,000 Klasify flat).

### Files pushed (edubloom-website repo)
- `index.html` — Full website rebuild. 600 lines. Hero, 3-pillar section, teacher demo, fraud protection, agent ledger preview, features grid, safety, pricing, steps, testimonials, CTA, footer.
- `edubloom_proposal.html` — Print-ready proposal. 286 lines. Cover page, 3-problem opener, 3-solution sections, feature list, pricing table, next steps, signature.
- `edubloom_flyer.html` — A5 double-sided flyer. 233 lines. Front: teachers + overview pricing. Back: Proprietor fraud protection + subject maps.

**Requested by:** Bayo. Implemented by Claude (Anthropic).
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
