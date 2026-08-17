# ⚠️ STANDING RULE — READ BEFORE TOUCHING ANYTHING

This file is the **sole README for every Edu-BLOOM production app**.

**Every session that changes, builds, or adjusts any production app MUST update this file
before the session ends. No exceptions. No deferring. Same session, always.**

Information about production apps lives HERE — not in individual repo READMEs.
Individual repo READMEs must be kept minimal and must point here.
If you are about to write something in a repo README that belongs in this file, stop and put it here instead.

---

# Edu-BLOOM · Production Master README

**Maintained by:** Bayo (Adebayo Adesanya) · AariNAT Company Limited
**Last updated:** 2026-08-18
**Kept by:** Claude (Anthropic) — updated every session per standing rule above

---

## 📦 Production App Directory

| App | Repo | Live URL | Purpose |
|---|---|---|---|
| **Agent App** | `bloom-agent` | agent.edubloom.com.ng | Field agents submit school deals |
| **Admin Portal** | `bloom-portal` | portal.edubloom.com.ng | Bayo approves deals, manages agents, pays commission |
| **School App** | `School-Bloom` | school.edubloom.com.ng | School staff manage students, fees, scores, attendance |
| **OCR Service** | `aarinat` | (legacy — superseded by AariNAT Cloudflare Worker) | Original offline agent + school toolkit |
| **Website** | `edubloom-website` | edubloom.com.ng | Public-facing Edu-BLOOM website |

---

## 🔑 Critical Shared Credentials & Infrastructure

| Item | Value |
|---|---|
| Firebase Project | `educationbloom-699ed` |
| Firebase UID (Bayo) | `HSpdm2NYK4hEGqBxyTPEi2wy39F2` |
| Bayo login email | `adebayoadesanya423@gmail.com` |
| Portal fallback password | `aarinat2024` |
| Bayo WhatsApp | +234 814 507 3941 |
| Agent app URL | agent.edubloom.com.ng |
| Portal URL | portal.edubloom.com.ng |
| School app URL | school.edubloom.com.ng |

### Firebase Web App Registration (all three apps use this single registration)
- `appId: 2b3da887`
- `apiKey: AIzaSyCVEdunn3...`
- All three apps (bloom-agent, bloom-portal, School-Bloom) point to the same Firestore project

---

## 🗄️ Firestore Collections — Access Matrix

| Collection | Read by | Write by | Auth required? |
|---|---|---|---|
| `admin_settings` | portal only | portal only | ✅ Bayo UID only |
| `public_ocr_keys` | agent + school apps | portal only | Read: open; Write: Bayo UID |
| `admin_agents` | agent app (login) + portal | portal only | Write: Bayo UID |
| `admin_deals` | agent app (own) + portal | agent app (create) + portal (update/delete) | Create: open |
| `admin_ledger` | agent app + portal | portal only | Write: Bayo UID |
| `admin_approved_schools` | portal + school app | portal only | Write: Bayo UID |
| `admin_agent_requests` | portal only | agent app (create) | Create: open |
| `schools` | school app + portal | school app + portal | Open (needs full auth redesign — deferred) |
| `public_ocr_keys/main` | agent + school apps | portal (syncOcrKeysToPublic) | Read: open |

### Current Firestore Rules (published — last corrected 2026-08-10)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /admin_settings/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == 'HSpdm2NYK4hEGqBxyTPEi2wy39F2';
    }
    match /public_ocr_keys/{docId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == 'HSpdm2NYK4hEGqBxyTPEi2wy39F2';
    }
    match /admin_agents/{docId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == 'HSpdm2NYK4hEGqBxyTPEi2wy39F2';
    }
    match /admin_deals/{docId} {
      allow create: if true;
      allow read: if true;
      allow update, delete: if request.auth != null && request.auth.uid == 'HSpdm2NYK4hEGqBxyTPEi2wy39F2';
    }
    match /admin_ledger/{docId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == 'HSpdm2NYK4hEGqBxyTPEi2wy39F2';
    }
    match /admin_approved_schools/{docId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == 'HSpdm2NYK4hEGqBxyTPEi2wy39F2';
    }
    match /admin_alerts/{docId} {
      allow create: if true;
      allow read, update, delete: if request.auth != null && request.auth.uid == 'HSpdm2NYK4hEGqBxyTPEi2wy39F2';
    }
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

> ⚠️ The `schools` collection stays on the catch-all rule. It holds real school data.
> Locking it down properly requires per-school Firebase Auth identities — a larger redesign
> that must be scoped and tested on a single test school before touching production.

---

## 🔄 OCR Cascade (all apps)

**AariNAT OCR** (custom Cloudflare Worker, primary)
→ **Groq Vision** (`qwen/qwen3.6-27b`, fallback)
→ **HuggingFace** (Qwen2.5-VL-7B)
→ **OCR.space**

OCR keys (`groqApiKey`, `hfApiKey`, `ocrServiceUrl`) live in Firestore `public_ocr_keys/main`.
The portal mirrors these from `admin_settings` via `syncOcrKeysToPublic()` whenever keys change.
No app reads keys from any external proxy — all reads are direct Firestore calls.

---

## 💰 Business Rules

| Rule | Value |
|---|---|
| All plans | Premium only (basic tier eliminated 2026-08-10) |
| Slogan | GIVE YOUR SCHOOL THE PREMIUM EXPERIENCE |
| Agent commission | 20% of term fee on every approved deal |
| Branding | Edu-BLOOM (Edu- in purple #7c3aed · BLOOM in orange #f97316) |

### Premium Pricing Tiers (×1.5 of old basic prices — confirmed from Partnership Proposal)

| Tier | Students | Term Fee | Agent Commission |
|---|---|---|---|
| Premium · 1–50 | 1–50 | ₦15,000 | ₦3,000 |
| Premium · 51–100 | 51–100 | ₦30,000 | ₦6,000 |
| Premium · 101–200 | 101–200 | ₦52,500 | ₦10,500 |
| Premium · 201–350 | 201–350 | ₦82,500 | ₦16,500 |
| Premium · 351+ | 351+ | ₦112,500 | ₦22,500 |

---

## ⚙️ Standing Dev Rules (all production apps)

1. **Cache-bust every push** — bump `?v=YYYYMMDD-descriptor` on `app.js`/`style.css` in `index.html` AND bump `CACHE_NAME` in `sw.js` in the same commit. Both must change together or the service worker keeps serving stale files.
2. **Update this README every session** — no exceptions, same session, before closing.
3. **No auth/security changes without Bayo explicitly requesting them** — if a gap is spotted, document it here and flag it. Never silently implement it.
4. **New features: sandbox first** — build and prove in v2 sandbox, then port verbatim to production. Never build directly in production.
5. **Port verbatim** — when moving code from sandbox to production, copy exactly as written. No deviations, no "while I'm here" edits.
6. **`_isPremium()` in School-Bloom permanently returns `true`** — all schools are Premium. Do not change without Bayo's explicit instruction.
7. **Portal password is `aarinat2024`** — this is the one fallback. No hardcoded bypasses. No emergency passwords.
8. **Password recovery in School-Bloom routes to Bayo/AariNAT only** — never to agents.

---

## 📱 bloom-agent (Production — Field Agent App)

**Repo:** github.com/KobOmoba/bloom-agent
**URL:** agent.edubloom.com.ng
**What it does:** Field agents log in by phone number, scan school signboards, count students, scan fee ledgers, select a Premium plan, and submit deals to the portal.

### Current State (2026-08-18)
- ✅ Login by phone number lookup (`admin_agents` collection)
- ✅ Section 1: School Signboard Scan (Groq Vision → auto-fills name/address/LGA/state)
- ✅ Section 2: Smart Register Counter (CSV paste or photo OCR → student headcount)
- ✅ Section 3: Financial Ledger Scan (multi-page, class-grouped results, retry failed pages)
- ✅ All 5 Premium tier cards with correct pricing
- ✅ Show Principal full-screen pitch panel
- ✅ Deal submission to Firestore `admin_deals`
- ✅ New Agent registration form (photo + bank details → `admin_agent_requests`)
- ✅ Agent Manual (`AGENT_MANUAL.html`) committed and linked from registration form + Settings
- ✅ Dark navy theme confirmed correct
- ✅ New Agent page scroll fixed (overflow-y:auto)

### Key Files
| File | Purpose |
|---|---|
| `index.html` | App shell, all HTML sections, cache-busting params |
| `app.js` | All logic — OCR, deal submission, tier selection |
| `style.css` | Dark navy theme |
| `sw.js` | Service worker — cache name must be bumped with every push |
| `AGENT_MANUAL.html` | 14-chapter field agent user manual |

### Latest Cache Versions
- `app.js?v=20260725-nobase44`
- `style.css?v=20260817-manual`
- `CACHE_NAME` in sw.js: check sw.js directly

---

## 🖥️ bloom-portal (Production — Bayo's Admin Command Centre)

**Repo:** github.com/KobOmoba/bloom-portal
**URL:** portal.edubloom.com.ng
**What it does:** Bayo approves agent deals, manages agents and schools, pays commission, holds API keys, generates agent ID cards, runs term calendar.

### Current State (2026-08-18)
- ✅ Login: Firebase Auth first → Firestore password fallback (`aarinat2024`)
- ✅ Pending deals — approve, reject, re-apply stuck deals
- ✅ Agent management — add/edit/delete agents, view photos + bank details
- ✅ Agent request approval — real-time listener on `admin_agent_requests`, approve/reject with WhatsApp notification
- ✅ Agent ID Card auto-generation on approval (canvas-based, 856×540px, downloadable PNG)
- ✅ Approved schools list with activation timestamps + term expiry
- ✅ Nigeria Term Calendar (state-specific, editable, drives subscription expiry)
- ✅ Commission ledger
- ✅ Settings: Groq key, HF key, OCR URL, admin password, bank details, `syncOcrKeysToPublic()`
- ✅ Reset Principal Password tool (on each approved school card)
- ✅ Service worker: network-first fetch with cache fallback (fixed 2026-08-03)

### Portal Login Flow
1. `signInWithEmailAndPassword(adebayoadesanya423@gmail.com, [password])`
2. If Firebase Auth fails → compare against `admin_settings/main.adminPassword` (default: `aarinat2024`)
3. No third path. No hardcoded bypass.

### Agent ID Card Design
- Deep purple gradient background (#0f0a2e → #1e1254)
- Gold stripe top and bottom
- Edu-BLOOM logo: Edu- in purple, BLOOM in orange
- Agent photo (100px circle with gold ring)
- Agent name, ID chip (AGENT-XXXXXX), state, commission, bank details
- Slogan: *GIVE YOUR SCHOOL THE PREMIUM EXPERIENCE*
- Footer: AariNAT Company Limited · agent.edubloom.com.ng · +234 814 507 3941

---

## 🎓 School-Bloom (Production — School Management App)

**Repo:** github.com/KobOmoba/School-Bloom
**URL:** school.edubloom.com.ng
**What it does:** Principals and staff manage students, fees, scores, attendance, payroll, expenses, and Finance AI. BloomCollect enables fee payment via WhatsApp bank transfer.

### Current State (2026-08-18)
- ✅ Login by School ID (looks up `admin_approved_schools` then loads `schools/{id}`)
- ✅ `_isPremium()` permanently returns `true` — all schools Premium
- ✅ Revenue: fee tracking, individual + bulk WhatsApp reminders with bank details
- ✅ Students: add/edit/delete, student register OCR
- ✅ Student Profile full-page: Fees tab, Scores tab, Attendance tab, SWOT tab
- ✅ Scores: per-class/subject/term view + CSV export
- ✅ Score Sheet Scan: Groq Vision OCR (`reasoning_format:'hidden'`, `max_tokens:8192`, `1800px` image)
- ✅ Attendance: daily register with Present/Late/Absent toggles + CSV export
- ✅ Report Cards / Scorecard
- ✅ Staff management + role-based nav whitelist
- ✅ Payroll: run payroll, deduct from cash balance, history
- ✅ Expenses tracking
- ✅ Finance AI: conversational setup agent (FSA), rich context, health cards, quick-question cards
- ✅ BloomCollect: bank transfer (zero cost, live); Paystack gateway (built, not yet deployed)
- ✅ Navigation: 4 group categories with sub-pages (Students / Staff & Finance / Insights / Extras)
- ✅ Safety features: Absence Alert, Collector Check, Sign-Out Alert
- ✅ Opportunity Scout
- ✅ In-app Help System (18 searchable accordion topics, Support section)
- ✅ User Manual: `EduBLOOM_School_App_Manual.docx` (32 pages, in School-Bloom repo)
- ✅ Offline mode (service worker)

### BloomCollect Status
- **Zero-cost version (LIVE):** School registers bank account in Settings → every WhatsApp reminder includes bank details + student name as reference → parent transfers directly → principal uploads bank statement CSV → auto-reconcile
- **Gateway version (BUILT, NOT DEPLOYED):** Firebase Cloud Functions in `functions/bloomcollect.js` — needs Paystack account + `firebase deploy --only functions` to go live. Business model: parent pays fee + 2.5% surcharge; school gets exact fee; AariNAT nets ~1%.

### Password Recovery
Routes ONLY to Bayo/AariNAT (+234 814 507 3941). Never to agents. Non-negotiable.

---

## 📜 Unified Change History (newest first)

### 2026-08-18 — Standing Rule: Sole README per environment
Two master README files established:
- `bloom-agent/README.md` → sole README for all production apps (this file)
- `bloom-agent-v2/README.md` → sole README for all sandbox apps
Standing rule written into both: must be updated every session after any change to any app in the environment. Individual repo READMEs point here and carry no content.

### 2026-08-17 (2) — Agent Manual linked inside Agent App
Two entry points added to `bloom-agent/index.html` (commit `a005bd7`):
- Blue banner on New Agent registration form (below Submit button): "📖 Download the Agent Manual"
- Card in ⚙️ Settings tab: "📚 Agent Manual" with "Open & Download Manual" button
Both open `AGENT_MANUAL.html` in a new tab. Cache-bust: `style.css?v=20260817-manual`.

### 2026-08-17 — New Agent Page Scroll Fix + Agent Manual
**Scroll fix** (`bloom-agent/style.css`, commit `03a58e3`): `.login` had `align-items:center` and no `overflow-y`. Register form overflowed above the viewport with no way to scroll back up. Fix: `align-items:flex-start` + `overflow-y:auto` on `.login`; `margin:auto` on `.login-box`. Cache-bust: `style.css?v=20260817-scrollfix` (`cc7c0d6`).
**Agent Manual** (`AGENT_MANUAL.html`, commit `274915a`): Full 14-chapter guide committed to `bloom-agent`. Covers every feature in plain English. Live at kobomoba.github.io/bloom-agent/AGENT_MANUAL.html.

### 2026-08-16 — Edu-BLOOM User Manual (School App)
`EduBLOOM_School_App_Manual.docx` committed to `School-Bloom` (commit `d846cd0`). 32 pages, 23 chapters, written in plain English for non-technical principals. In-app Help System added to School-Bloom (18 searchable accordion topics, `app.js` commit `1bcc723`, `index.html` commit `4ada61b`).

### 2026-08-15 — Branding Correction Across All Apps
52 replacements across 6 files: `EduBloom` → `Edu-BLOOM`, `Educational Bloom` → `Edu-BLOOM`. Agent ID card canvas updated: Edu- in purple (#7c3aed), BLOOM in orange (#f97316), hyphen added, font baseline raised to y=57.

### 2026-08-12 — Agent Registration, ID Card, Portal Agent Requests (multiple)
- `bloom-agent`: Full registration form with photo + bank details. `submitAgentRequest()` writes to `admin_agent_requests` → Firestore first, WhatsApp second (commits `367f77f`, `b19e311`).
- `bloom-portal`: Real-time listener on `admin_agent_requests` (`startAgentRequestsListener`). Approve → creates agent in `admin_agents` + WhatsApp. Reject → marks rejected + optional WhatsApp reason (commits `54e88d0`, `4b3f7d1`).
- `bloom-portal`: Agent request cards show photo + bank details. `approveAgentRequest()` saves photo + bank to `admin_agents` (commit `9ec0faf`).
- `bloom-portal`: Agent ID Card auto-generated on approval (`generateAgentIDCard`, canvas 856×540px). `showAgentIDCard()` modal with download/print. Auto-shows after approval (commit `684f1eb`).
- `School-Bloom`: BloomCollect bank details now included in all fee reminder WhatsApp messages (commit `98ef9f5`).
- `School-Bloom`: Full BloomCollect Paystack gateway built — `functions/bloomcollect.js` (3 Cloud Functions: createSubaccount, createPaymentLink, paystackWebhook), commits `d554eef`, `59159ae`, `284f5d5`.

### 2026-08-12 — Premium Tier Naming + Pricing Applied (all apps)
All tier names updated from Starter/Small/Medium/Large/Enterprise to `Premium · [range]`. Premium pricing (×1.5 of basic) applied to `bloom-agent` (`app.js` + `index.html`), `bloom-portal` (`TIERS` array), and `School-Bloom`. Commits: `0f2f0b1`, `2ace785` (agent); `e5d1e7b` (portal).

### 2026-08-11 — School App Navigation Rebuild + Finance AI + Payroll + Sub-Pages
- Navigation reorganised into 4 groups with sub-pages (Students, Staff & Finance, Insights, Extras)
- New full pages: Student Profile, Scores, Attendance, Payroll
- Finance AI rebuilt: Finance Setup Agent (FSA), rich context (`buildRichFinanceContext`), health cards, one-tap question cards
- Commits: `1059e12` (app.js), `2ce1d22` (index.html) for nav; `7d6d575`, `cb3e683` for Finance AI

### 2026-08-10 — Strategic Decision: Basic Tier Eliminated
Bayo's decision: all schools are now Premium. New slogan: GIVE YOUR SCHOOL THE PREMIUM EXPERIENCE. `_isPremium()` in School-Bloom set to permanently return `true` (commits `0cea5ec`, `64d0f23`). Same decision noted in bloom-agent and bloom-portal (no code change needed there).

### 2026-08-10 — Firestore Rules Emergency + Multiple Bug Fixes
- Firestore rules corrected: `authed()` requirement removed from `admin_*` collections (broke portal writes and agent login). Corrected rules published.
- `bloom-portal`: Approval bug fix — `confirmApproval()` now writes directly to Firestore, not via SQ. Stuck-deal detection + Re-Apply button added. Emergency password removed. Term Calendar added. Activation timestamps added. Commits: `ff107c6`, `f26b745`, `32793d9`.
- `School-Bloom`: Score OCR fix (added `reasoning_format:'hidden'`, raised `max_tokens` to 8192, image to 1800px). Score table panel display bug fixed. Commits: `8872c9b`, `4114e8e`, `0cea5ec`, `64d0f23`.

### 2026-08-09 — Step 4: School-Bloom production ported from school-bloom-v2
`app.js`, `index.html`, `style.css` ported verbatim from `school-bloom-v2`. Cache-bust: `?v=20260809-step4port`. Firestore rules mistake introduced here (corrected 2026-08-10).

### 2026-08-05 — Firebase API Key Consolidated
`bloom-portal` reverted to single Firebase registration (`appId: 2b3da887`) shared with all other apps. Old registration (`appId: 0f9d338f`) orphaned — safe to delete from Firebase Console.

### 2026-08-03 — Authorized Domains Fix + Service Worker Rewrite (Portal)
Firebase Console: `portal.edubloom.com.ng`, `school.edubloom.com.ng`, `agent.edubloom.com.ng` added to Authorized Domains (was missing — caused `auth/network-request-failed`). Portal `sw.js` rewritten: network-first for all assets with real cache fallback (`{ignoreSearch: true}`).

### 2026-08-02 — Portal Login Hardening
Firestore-password fallback restored in `doLogin()` (Firebase Auth first, then `aarinat2024`). Error messages now specific per Firebase error code (no longer all showing "Incorrect password"). `sw.js` CACHE_NAME bumped to force refresh after lockdown stale cache.

### 2026-07-25 — Security Lockdown + OCR Keys Split
- Reverted unauthorized Base44 login change that locked Bayo out. Restored `doLogin()` to Firestore-password check.
- Real Firebase Auth wired into portal (`signInWithEmailAndPassword`). Bayo's UID: `HSpdm2NYK4hEGqBxyTPEi2wy39F2`.
- Legacy password fallback fully removed from portal after Firebase Auth confirmed working. `admin_settings` locked to Bayo's UID.
- OCR keys split from `admin_settings` into `public_ocr_keys/main`. `syncOcrKeysToPublic()` button added to Settings.
- `bloom-agent`: Base44 OCR proxy removed. `_fetchGroqKeyFromFirestore()` now reads `public_ocr_keys/main` directly. Cache-bust: `?v=20260725-nobase44`.
- Dark theme restored in bloom-agent after wrong-repo push overwrote style.css with School-Bloom-v2's light theme. App.js also restored after School-Bloom code landed in bloom-agent (emergency commit). Both incidents traced to wrong-repo push during cross-repo port work.

### 2026-07-25 — Page Counter Fix + Ledger max_tokens Fix (Agent App)
- Page 6/5 display bug and retry mapping bug fixed: `ledgerPageOrderMap` added (commit 2026-07-25 2).
- Ledger `max_tokens` raised from 1600 to 4096 to match bloom-agent-v2. `reasoning_effort:'none'` aligned. Other params matched to v2 exactly.

### 2026-07-24 — Multi-Page Ledger Pipeline Ported to bloom-agent
Section 3 (Financial Ledger Scan) upgraded from single-page to full multi-page pipeline ported from `bloom-agent-v2`. Added: `processOnePage`, `processAllLedgers`, `retryFailedPages`, cascade builder, live feed, class-grouped results.

### 2026-07-19 — Signboard Scan + Financial Ledger Scan + Show Principal (bloom-agent)
Signboard Scan: new Section 1, Groq Vision, auto-fills school name/address/LGA/state. Financial Ledger Scan: new Section 3, LEDGER_FINANCIAL_PROMPT, 62% crop, UNCLEAR discipline, Retry-After rate limiting. Show Principal: full-screen pitch panel showing headcount + outstanding fees. Image resolution raised 400px → 1000px. Blur detection added.

