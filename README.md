---

## 2026-08-18 (hotfix) — Portal Login Broken: SQ.push Syntax Error

**Root cause:** During the GroqRotator multi-key patch, the 4 extra Groq key spreads were appended AFTER the closing `})` of the `SQ.push` call in `saveSettings()`, making the line syntactically invalid and preventing `portal_app.js` from loading at all — breaking login entirely.

**Fix (commit `06b2956`):** Moved `groqKey2–5` spreads to their correct position INSIDE the `d:{}` object, before the `hfKey` spread. Node.js `--check` used to verify syntax before push. Cache bumped to `?v=20260818-hotfix` so the browser drops the broken cached file immediately.

**Prevention going forward:** Any `portal_app.js` change must be syntax-checked with `node --check` before push.

---

## 2026-08-18 — GroqRotator: Multi-Key Round-Robin API Rotation

### Problem
Every feature — signboard scan, register OCR, ledger scan, score sheets, fee ledger, lesson notes, question generator — shared a single Groq API key. When two features ran simultaneously they both hit the same free-tier rate limit bucket. The existing logic would wait (Retry-After) on the one key, stalling the user.

### Solution
`GroqRotator` — a 170-line singleton module injected identically into every app that touches Groq. Supports up to 5 keys rotating round-robin. On a 429 the rate-limited key is cooled exactly by its `Retry-After` header and the next key is tried immediately — no waiting at all when a second key is available.

### How it works
- **Key loading:** reads `groqApiKey`, `groqApiKey2`, `groqApiKey3`, `groqApiKey4`, `groqApiKey5` from `public_ocr_keys/main` in Firestore (+ `groqKeys` array for future-compat). Single Firestore read, result cached for the session.
- **Round-robin pick:** `_pick()` starts from an incrementing pointer and scans forward, skipping any key whose cooldown hasn't expired. Returns the first ready key + `wait:0`. If all keys are cooling, returns the soonest-waking key + exact `wait` ms.
- **429 handling:** `_setCooldown(key, header)` sets `_cd[key] = now + retryAfterSecs * 1000` (clamped 5–120 s). Caller loop continues to `_pick()` for the next key immediately.
- **Proactive buffer:** when `x-ratelimit-remaining-requests < 2`, puts an 8-second buffer on that key so the next call goes elsewhere before the hard limit hits.
- **Two call surfaces:** `GroqRotator.vision(prompt, base64, mime, opts)` for all image calls; `GroqRotator.text(prompt, systemMsg, opts)` for lesson notes, question generator, finance AI.
- **Backward compat:** first key is still written to `window.GROQ_API_KEY` and `localStorage` so any legacy `getGroqKey()` callers continue to work.

### Files changed (7 commits)

**`bloom-agent/app.js` (`899951f`):**
- `_fetchGroqKeyFromFirestore()` → now calls `GroqRotator.reload()` only
- `_callGroqSignboardVision()` → `GroqRotator.vision()` (no more single-key fetch with AbortController)
- `groqVisionOCR()` → `GroqRotator.vision()` (register OCR)
- Ledger `groqKey` check → `GroqRotator.keyCount() > 0`
- `GroqRotator` module injected after `_fetchGroqKeyFromFirestore`

**`School-Bloom/app.js` (`cbf4495`):**
- `_fetchGroqKeyFromFirestore()` → `GroqRotator.reload()`
- `groqVisionOCR()` → `GroqRotator.vision()`
- `_groqScoreOCR()` → `GroqRotator.vision()` (score sheet OCR)
- `_getFeeGroqKey()` → returns sentinel, `GroqRotator.reload()` called
- `_callGroqGenericVision()` → `GroqRotator.vision()` (fee scan generic)
- `_callGroqFeeVision()` → `GroqRotator.vision()` (fee ledger scan)
- Both `_getGroqKey()` + `_callGroqTeach()` pairs (teaching tools — 2 duplicates) → `GroqRotator.text()`

**`school-bloom-v2/app.js` (`5c696c8`):** `_callGroqTeach()` → `GroqRotator.text()`

**`bloom-portal/portal_app.js` (`d4abc17`):**
- `syncOcrKeysToPublic()` now writes `groqApiKey2…5` + `groqKeys[]` array + `activeKeyCount` to `public_ocr_keys/main`
- `saveSettings()` reads and saves `s-groq-2` through `s-groq-5` inputs
- `loadSettings()` populates all 5 masked fields + shows active key count chip

**`bloom-portal/index.html` (`c7f9529`):** Settings expanded from 1 Groq key field to 5 labeled fields (Key 1–5) with active-key count badge and rotation explanation note.

**Cache-busters:** `app.js?v=20260818-rotator` on `bloom-agent` and `School-Bloom`.

### How Bayo adds more keys
1. Go to **Groq Console → API Keys → Create new key** (free account, takes 30 seconds)
2. Paste the `gsk_…` key into Key 2 (or 3, 4, 5) in Portal → Settings
3. Tap **Save Settings** then **Sync Keys to Apps**
4. Done — all apps immediately rotate across both keys

### Effect
With N keys, effective throughput is N× before any waiting occurs. With 3 keys on the free tier, the system can run 3 concurrent Groq requests without any rate-limit collision.

**Requested by:** Bayo. Implemented by Claude (Anthropic).
---

## 2026-08-18 — Teaching Tools: Lesson Note Generator + Question Generator

### Context
Federal Government of Nigeria is rolling out a new curriculum across primary and secondary schools.
Teachers requested two tools inside the school app: (1) AI-generated lesson notes, and (2) CA and exam question generation with full answer keys.

### What was built

**Built in `school-bloom-v2` first (commits `248a040`, `24657a0`), then ported verbatim to `School-Bloom` (commits `e8581af`, `6dd8fb9`).**

Both tools are accessible from two new nav tabs: **📖 Lessons** and **❓ Questions**.

---

#### 📖 Lesson Note Generator (`sec-lessons`)

**Inputs:**
- School Level: Primary (Basic 1–6) / Junior Secondary (JSS 1–3) / Senior Secondary (SS 1–3)
- Class (dynamic — updates when level changes)
- Subject (dynamic — full FG curriculum subject list per level)
- Topic (required) + Sub-Topic (optional)
- Duration: 30 / 40 / 45 / 60 / 80 minutes
- Term: 1st / 2nd / 3rd + Week: 1–13

**Output — full NTI/NCCE 5-step lesson note:**
- School name, Subject, Class, Topic, Sub-Topic, Duration, Term, Week, Date and Time fields
- Behavioural Objectives (4–5 action-verb objectives)
- Entry Behaviour / Previous Knowledge
- Instructional Materials (Nigeria-specific, classroom-realistic)
- Reference Books (approved Nigerian textbooks)
- Step I: Introduction (5 min)
- Step II: Presentation / Development (proportional to duration)
- Step III: Further Development
- Step IV: Application / Class Activity
- Step V: Evaluation (5 evaluation questions)
- Conclusion / Summary
- Assignment

**Actions:** 🖨️ Print (opens print-ready page) | 📋 Copy to clipboard

---

#### ❓ Question Generator (`sec-questions`)

**Inputs:**
- School Level, Class, Subject (same dynamic selectors as Lesson Notes)
- Topic(s) — free text, can be multiple topics
- Exam Type: 1st CA / 2nd CA / Mid-Term / End of Term / Mock / Assignment / Weekly Quiz
- Total Marks
- Question counts per type (each independently settable):
  - Objective / MCQ (default: 20)
  - Theory / Essay (default: 5)
  - Short Answer (default: 0)
  - Fill in the Blank (default: 0)

**Output — two-part document:**
1. **Question Paper** — properly formatted Nigerian exam paper with school name, subject, class, date, time, total marks, instructions, section headers, and all questions numbered correctly
2. **Answer Key / Marking Scheme** — complete answers for every question (MCQ answer letters, fill-in-blank words, short answer model sentences, theory model answers with marks allocation per point)

**Actions:** 🖨️ Print Questions only | 🖨️ Print with Answer Key | 📋 Copy All | 👁 Toggle Answer Key visibility

---

#### Curriculum Subject Maps (`CURRICULUM` constant)

Three levels, each with a complete subject list matching the FG Nigeria curriculum:

- **Primary (Basic 1–6):** 17 subjects including English, Maths, Basic Science, Social Studies, CCA, Civic Education, PHE, Agric, ICT, CRS, IRS, Yoruba/Hausa/Igbo, French, Quantitative and Verbal Reasoning
- **JSS 1–3:** 19 subjects including BST, Business Studies, Home Economics, Pre-Vocational Studies, Arabic, CRK, IRK
- **SS 1–3:** 30 subjects covering Sciences, Commercial, Arts, and vocational electives

#### Groq Integration
Both tools call Groq (`qwen/qwen3.6-27b`, `max_tokens:8192`, `reasoning_effort:'none'`) via `_callGroqTeach()`.
Key is fetched once from Firestore `public_ocr_keys/main` and cached in `_groqKey`.
Same key used by OCR — no new key needed.

#### Layout
Two-column grid (form left, output right). Collapses to single column on screens under 640px.

### Cache-busters bumped
- `School-Bloom/index.html`: `app.js?v=20260818-teaching`, `style.css?v=20260818-teaching`

**Requested by:** Teachers (via Bayo). Implemented by Claude (Anthropic).


---

## 2026-08-18 — Agent Deactivation System

### Problem
No way to block access or stop commission when an agent resigns, is dismissed, or commits fraud.
The old "Remove" button permanently deleted the agent record — no audit trail, and the agent
could still log in if they had the app cached on their phone.

### What was built

**`bloom-portal/portal_app.js` (commit `8aee6e26`):**

`deactivateAgent(id, name)` — replaces the old hard-delete flow:
- Bayo is prompted to enter a reason: `resigned`, `dismissed`, or `fraud`
- Writes to `admin_agents/{id}`: `{active: false, status: 'deactivated', deactivatedAt, deactivationReason}`
- **If fraud:** queries all pending deals by that agent → sets `status: 'flagged_fraud'` + `fraudNote` on each, using a Firestore batch write. Alert shows how many deals were flagged.
- Agent card immediately shows a 🚫 DEACTIVATED / 🚨 FRAUD badge, dimmed opacity, and red/amber border
- Card action buttons replaced with "✅ Reactivate" and "🗑️ Delete Record" only

`reactivateAgent(id, name)`:
- Sets `active: true`, clears `deactivatedAt` and `deactivationReason` via `FieldValue.delete()`
- Restores all normal action buttons on the card

`deleteAgent(id, name)` — now a permanent hard-delete (kept for genuine record removal), with a
warning prompt suggesting Deactivate instead.

Commission gate (in `confirmApproval()`):
- Before writing the commission ledger entry, reads the agent's Firestore doc
- If `active === false` → skips commission write entirely + logs "Commission skipped — agent deactivated"
- Prevents any future deal approved under a deactivated agent from earning commission

Performance table: status column now shows Active / Resigned / Dismissed / 🚨 FRAUD chip.

**`bloom-agent/app.js` (commit `6b9c94f0`):**

Three login gates — all three paths an agent can take to get into the app are now blocked:

**Gate 1 — First-time login (no cache):**
After Firestore lookup, checks `agent.active === false` before calling `startApp()`.
Shows reason-specific message (fraud vs dismissed vs resigned) and halts.

**Gate 2 — Cached login (phone already known):**
Before trusting the localStorage cache, checks `cachedAgent.active === false`.
Clears the cache and shows the deactivation message — no way in even offline.

**Gate 3 — Background refresh (already inside app):**
`refreshAgentBackground()` now checks if the freshly fetched profile has `active === false`.
If so: clears localStorage, sets `agent = null`, hides the main app, shows the login screen
with the deactivation message. This is the key gate — it means if Bayo deactivates someone
while they are actively using the app, the next time their app refreshes from Firestore
(every login attempt) they are immediately signed out.

### Deactivation messages shown to agents
| Reason | Message |
|---|---|
| resigned | 🚫 Your agent account is no longer active. Contact Bayo: +234 814 507 3941 |
| dismissed | 🚫 Your agent account has been deactivated. Contact Bayo: +234 814 507 3941 |
| fraud | 🚨 Your account has been suspended due to a fraud report. Contact AariNAT: +234 814 507 3941 |

### Cache-busters bumped
- `bloom-agent/index.html`: `app.js?v=20260818-deactivate` (commit `239f635d`)
- `bloom-portal/index.html`: `portal_app.js?v=20260818-deactivate` (commit `66d68d94`)

**Requested by:** Bayo. Implemented by Claude (Anthropic).

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

