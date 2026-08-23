---

## 2026-08-18 — Makeover Syntax Fix (Enter Portal & Try Demo restored)

**Root cause:** The `generateLessonNote()` Groq prompt used `\n` escape sequences inside single-quoted strings within template literal expressions. During multiple Python string-processing passes across sessions, these became literal newlines, breaking the JS parser. Both the original injection and a duplicate copy accumulated, giving two `const CURRICULUM` declarations and two `// TEACHING TOOLS` blocks.

**Fix (`20e6c88d`):**
1. Located FIRST occurrence of `// TEACHING TOOLS` marker and LAST occurrence of `// ── End Teaching Tools` marker — a 1,330-line span covering both duplicate blocks.
2. Replaced entire span with a single clean 271-line teaching tools block where:
   - No single-quoted strings contain `\n` escape sequences — prompt is built as an array of strings joined with `\n`
   - No template literals with conditional expressions containing string escapes
   - All string concatenation uses `+` operator inside expressions, not embedded escape sequences
3. Node `--check` confirmed syntax clean before push.
4. Cache-bumped `index.html` to `app.js?v=20260818-fixed`.

**Enter Portal, Try Demo, Lesson Notes, and Question Generator all restored.**

---

## 2026-08-18 — School App Makeover: Login Props, Role-Aware Home, Nav Regrouped

### Three targeted changes to school.edubloom.com.ng

**Why:** The old login screen said nothing useful. The nav was a flat wall of 30+ items with Revenue buried under STUDENTS and Lesson Notes at the very bottom. There was no dedicated home screen — the Home button just redirected to Revenue for everyone. Teachers looking for lesson notes had to hunt. The Proprietor Audit Log was invisible.

---

**Change 1 — Login screen value props (`index.html`, commit `42af4129`)**

Three lines added below the slogan, above the School ID input:
- 📖 AI lesson note for any subject in 30 seconds
- 🔒 Proprietor fraud protection only you can see
- 💰 Fee collection verified by your bank statement

Small pill-shaped items with border and subtle background. First thing a new school sees when they open the app.

---

**Change 2 — Role-aware Home dashboard (`app.js`, commit `b138ce71`)**

New `renderHome()` function — every role lands here first (all `ROLE_DEFAULT_TAB` values changed to `'home'`). Content is entirely different per role:

**Proprietor:** Audit Log card (purple, prominent, full width) → pending receipts count → POS today total → outstanding/collected fee split → quick links to students, staff, analytics, settings.

**Principal:** Outstanding fees (red) → pending receipts → students count → collection rate → six quick-action cards including Lesson Notes and CA Exams prominently featured.

**Bursar:** Outstanding fees big card → pending receipts → POS today → Upload Bank Statement shortcut → expenses and Finance AI.

**Class Teacher:** Two giant full-width cards: "📖 Generate Lesson Note — Start Now →" (purple) and "❓ Set a CA or Exam Paper — Create Paper →" (orange). Then class-specific shortcuts: Attendance, Scores, Student Profiles, Report Cards.

**Subject Teacher:** Same two giant teaching tools cards with the teacher's assigned subjects shown. Then Scores, Report Cards, Students, Attendance.

`ROLE_TABS` updated to include 'home' for all explicit whitelists (Class Teacher, Subject Teacher, Bursar). `go()` dispatch and `goDashboard()` both wired to 'home'.

---

**Change 3 — Navigation regrouped (`index.html`, commit `42af4129`)**

Old mainNav had Revenue under STUDENTS and Lesson Notes orphaned at the bottom with no group. New structure (7 groups):

1. **TEACHING TOOLS** — Lesson Notes, CA & Exams ← now first, most prominent
2. **FEES & FINANCE** — Revenue, Expenses, Payroll, Finance AI
3. **STUDENTS** — Students, Student Profile, Scores, Attendance, Report Cards
4. **STAFF** — Staff
5. **SAFETY & COMMS** — Safety, Communications, Alerts & Agents
6. **INSIGHTS** — Analytics, Opportunity Scout, Alumni
7. **EXTRAS** — Sports, Arts, Music, Health
8. **🔒 PROPRIETOR ONLY** — Audit Log (hidden until Proprietor logs in)
9. **SYSTEM** — Help & Support, Settings

Bottom nav reduced from 11 buttons to 5 clean ones: Home · Lessons · Students · Revenue · More

**Cache-bust:** `app.js?v=20260818-makeover`

**Requested by:** Bayo. Implemented by Claude (Anthropic).
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
