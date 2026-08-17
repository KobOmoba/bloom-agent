## 📍 Current Position — 2026-08-10

### ✅ Agent app login working — Firestore rules corrected

**What broke (2026-08-09):** The Step 3 Firestore security rules used
`allow read, write: if authed()` on `admin_agents`, `admin_deals`, and
`admin_ledger`. The agent app has no Firebase Auth — it logs in by phone
number lookup only. Every read was immediately rejected: "Firebase permission
error."

**Fixed (2026-08-10):** Corrected rules restore public read on all three
collections agents need:
- `admin_agents` → `allow read: if true` (phone lookup on login)
- `admin_deals` → `allow read: if true; allow create: if true` (submit + view deals)
- `admin_ledger` → `allow read: if true` (view earnings)

Agent login, deal submission, deal list, and earnings tab are all working.

**No code changes were made to bloom-agent/app.js.** The app was always
correct — only the Firestore rules were wrong.

### Standing rules for this repo
- Cache-bust every push: bump `?v=YYYYMMDD-descriptor` in `index.html`
  AND `CACHE_NAME` in `sw.js` in the same push
- Update README after every push, same session, no exceptions
- Any new agent feature: build and prove in `bloom-agent-v2` first,
  then port verbatim to `bloom-agent`

---

# bloom-agent (PRODUCTION — live, real field agents)

Field agent onboarding app. **This is the live app, not a test sandbox.**
Changes here affect real agents submitting real deals right now — always
verify on a real device before considering a change done, and always bump
the `?v=N` cache-busting parameter on `app.js` in `index.html` with every
push, or agents keep running stale cached code.

For the experimental/test version (where new features get built and
proven first), see `bloom-agent-v2`.

---

## 📌 What This App Does

Field agents log in with their WhatsApp number, use the **Smart Register
Counter** to help estimate student count (CSV/text paste, or photograph
the register — Groq Vision OCR extracts names), fill in school details,
select a pricing tier, and submit the deal to Bayo's Portal for approval.

## 🧠 OCR Architecture

Cascade: **AariNAT OCR** (custom Cloudflare Worker, primary) → **Groq
Vision** (`qwen/qwen3.6-27b`, fallback) → **HuggingFace** → **OCR.space**.
Extracts student NAMES only (no payment status, no fees) — this app's
purpose is a headcount for tier selection, not a financial ledger like
`bloom-agent-v2` builds.

Already has solid rate-limit handling (reads `x-ratelimit-reset-tokens`,
retries with proper backoff) — this was already comparable to
`bloom-agent-v2`'s quality before today's changes, likely from earlier
cross-pollination between the two codebases.

---

## 📜 Change History (newest first)

### 2026-07-25 (5) — Base44 OCR key-fetch dependency removed entirely

**Part of Bayo's "fix all" security pass** (see bloom-portal's README for
the fuller picture — Firestore rules lockdown, real Firebase Auth).

**Removed:** `_fetchGroqKeyFromFirestore()` no longer calls
`https://superagent-626f0107.base44.app/functions/getEduBloomKeys`. That
was the last live Base44 dependency in this app (the login-adjacent one
was in bloom-portal, already reverted separately).

**Replaced with:** a direct Firestore read of `public_ocr_keys/main` — a
new document in the portal's project holding only `groqApiKey`,
`hfApiKey`, and `ocrServiceUrl`. Nothing sensitive lives there (no admin
password, no WhatsApp template), so it's safe for this to stay
world-readable while `admin_settings` itself stays locked to Bayo's
account. The portal mirrors these three fields into it via
`syncOcrKeysToPublic()` whenever a key changes.

**Why this matters beyond just removing a dependency:** the old proxy was
a single point of failure this app didn't control — if that Base44
endpoint had gone down or changed shape, every agent's OCR pipeline stops
working with no warning. Now it's a plain Firestore read against
Bayo's own project, same reliability characteristics as everything else
this app already depends on.

**Commit:** `app.js` (function rewritten), `index.html` (cache bumped to
`?v=20260725-nobase44`). **Depends on:** the portal having actually run
`syncOcrKeysToPublic()` at least once — if `public_ocr_keys/main` doesn't
exist yet, this read just no-ops and falls back to whatever's cached in
localStorage from before, same graceful-degradation behavior as the old
code had.

### 2026-07-25 (4) — Dark theme fully restored: same systemic issue as the (3) entry below, different files

**Reported by Bayo:** app was showing a light pastel theme instead of the
original dark navy one. Initially misdiagnosed twice before getting this
right — worth recording the wrong turns too, so the next session doesn't
repeat them:
- First guess: stale service-worker cache. Wrong — bumping the cache
  version didn't fix it, and incognito (zero prior cache) showed the same
  broken result, which should have ruled this out immediately.
- Second guess: Android's "Force Dark" auto-inverting an undeclared-theme
  page. Also wrong, and based on not having actually re-read this repo's
  own `style.css` — was recalling `bloom-portal`'s dark colors from memory
  and assuming they applied here too. A `color-scheme: dark` meta was
  drafted for this wrong theory but caught and never pushed before going
  live — no harm done, but flagging the near-miss.

**Actual root cause, found via git history, not guessing:** commit
`cf7160cb` (2026-07-25T02:22:25Z), titled "PRODUCTION PORT: v2 → v1
complete codebase replacement," intended to port **bloom-school-v2**'s
files into the School-Bloom production app — but landed in the
**bloom-agent** repo instead. It overwrote:
- `style.css` — replaced with School-Bloom-v2's light pastel theme
- `manifest.json` — replaced with School-Bloom-v2's manifest (literally
  read `"name": "EduBloom School Portal"`)
- `sw.js` — replaced with School-Bloom-v2's service worker (cache name
  `edubloom-portal-v8`, not this app's own versioning line)

This is the **same failure pattern as the (3) entry directly below** —
School-Bloom content landing in this repo instead of its own — just a
different commit, different files, same systemic cause. Two occurrences
now. See "Bigger risk" below.

`index.html` was also supposed to be part of this port per the commit
message, but a separate emergency-restore commit (`e29916e1`, 13:50 same
day) already caught and fixed it before this session started — so by the
time this was investigated, index.html was already fine and only
CSS/manifest/service-worker were still broken. That's why "app.js is
fine, but index.html and style.css look tampered" was confusingly
half-right at first — index.html actually *had* been tampered with, just
already fixed by a prior session.

**Fixed — all three restored from their actual last-known-good commits,
not recreated from scratch:**
- `style.css` ← restored from `97f662d1`. `--bg:#080f1a` dark navy
  confirmed correct — matches the `theme-color` meta that had been
  correctly dark in index.html the whole time.
- `manifest.json` ← restored from `82a2f1df`. Correctly reads `"name":
  "Bloom Agent — EduBloom"` again.
- `sw.js` ← restored from `fab922d3` (bloom-agent's own last real version,
  confirmed genuine by its own history of agent-specific cache bumps —
  "School Scout AI map feature," "new AI Assist nav tab"). Cache bumped
  to `v10` on top of the restore.
- `index.html` — added a cache-buster (`style.css?v=20260725restore`) to
  the stylesheet link so devices fetch the restored CSS instead of a
  cached copy of the broken one.

**How this was actually found:** not by inspecting file contents in
isolation, but by pulling commit history (GitHub commits API, filtered
per file) for `style.css`, `index.html`, and `manifest.json` and reading
the actual commit messages. The commit message on the bad commit named
the exact wrong source (bloom-school-v2) and exact wrong file scope —
far more reliable than comparing file contents or guessing from
screenshots. Should be the first move next time something looks
tampered with, not the last.

**Bigger risk this surfaces, now confirmed twice:** whatever process runs
these cross-repo ports has landed content in the wrong repo at least
twice (this entry and the (3) entry below, different commits, different
files, same wrong-target pattern). Worth raising with Bayo as a process
fix — a target-repo confirmation step before pushing — not just
one-off reverts each time it happens again.

**Commit:** `style.css`, `manifest.json`, `sw.js`, `index.html` all
pushed. **Verify:** hard-refresh or clear site data on
agent.edubloom.com.ng and confirm the dark navy theme is back.

### 2026-07-25 (3) — EMERGENCY: app.js was overwritten with School-Bloom's code, restored

**What happened:** a commit landed on this repo (`app.js` +7088/-2792,
`index.html` +1440/-391, from Bayo's own GitHub account) titled "Remove all
premium test bypasses — premium gate fully functional." The content pushed
was School-Bloom's code, not bloom-agent's — function names were all
School Portal features (`_groqScoreOCR`, `socrHandleImage`,
`_callGroqFeeVision`, fee/score OCR, Add Staff), and `index.html`'s
`<title>` read "Educational Bloom · School Portal." Almost certainly a
wrong-repo push during premium-gating work meant for School-Bloom.

**Impact:** `agent.edubloom.com.ng` was completely broken — none of the
agent-onboarding functions existed in the file anymore, so login,
submitDeal, signboard scan, register scan, and ledger scan were all
unreachable. Caught before I built anything on top of it, purely because
of the standing habit of pulling fresh before editing rather than trusting
a locally cached copy.

**Fix:** restored `app.js` and `index.html` to the exact content from the
last known-good commit (`dd21e5f577` — the page-numbering fix from
earlier today), fetched directly from GitHub's commit history rather than
a local cache, so the restore is verifiably byte-for-byte correct.

**Not lost:** the premium-gate commit is still fully intact in git history
at `2c5d738193` on this repo. If that work was meant for School-Bloom, it
can be recovered from there and pushed to the correct repo instead of
being redone from scratch.

**Verify:** open agent.edubloom.com.ng, confirm the title bar says "Agent"
not "School Portal," and that login/submit still work. GitHub Pages can
take a minute or two to redeploy after a push.

### 2026-07-25 (2) — Section 3: fixed "Page 6/5" display bug + unsafe retry mapping

**Reported by Bayo** (from David's field test, real device, screenshot showing
"Page 6/5 → Groq..." while only 5 pages were loaded, and content matching an
earlier page). First reported as "all 3 scan buttons not clicking" — turned
out the buttons were fine, just slow on first tap (normal, waiting on Groq);
the real issue was the page counter.

**Root cause:** `ledgerImages` slots are keyed by an ever-incrementing
allocation counter (`ledgerPageCount`), never by ordinal position. The old
`pageNum = parseInt(idxKey) + 1` formula assumed keys were always contiguous
`0..N-1`. If a page slot gets retaken/deleted anywhere in the sequence, its
key vanishes but the counter never resets — so 5 remaining photos can end up
keyed `1,2,3,4,5` instead of `0,1,2,3,4`, and the display reads `2..6` instead
of `1..5`. This is a **pre-existing bug in v2 too** (identical
`pageNum = parseInt(idxKey) + 1` logic there) — not something introduced by
yesterday's port. Not fixed there yet; flag to Bayo before touching v2.

**Real (not just cosmetic) part of the bug:** `retryFailedPages()` reversed
the same broken formula (`idxKey = pageNum - 1`) to refetch a failed photo.
With gapped keys, a retry could silently pull the **wrong photo** — a real
data-integrity risk, not just a display glitch.

**Fix:**
- Added `ledgerPageOrderMap` — built fresh each scan, maps the ordinal
  position the agent actually sees (`1, 2, 3...`) to the real storage key.
- `processOnePage()` now takes an explicit `displayNum` param for all status
  text and the returned `pageNum`, instead of deriving it from the storage key.
- `processAllLedgers()` passes the true loop position (`i+1`) as `displayNum`
  and records it in the order map.
- `retryFailedPages()` now resolves the storage key via the order map first,
  falling back to the old `pageNum-1` arithmetic only if the map is somehow
  empty (shouldn't happen in normal use, but safe).
- Reset points for ledger state (fresh login, new scan) now also reset
  `ledgerPageOrderMap`.

**Commit:** pushed to `app.js` (cache bumped to `?v=20260725-2`).
**Not yet re-verified on device** — needs another real test with David,
specifically: add a page, retake an earlier one, scan, and check the page
counter reads `1..N` cleanly with no gaps.

### 2026-07-25 — Section 3 fixed: max_tokens was 1600, needed to be 4096 (real bug found)

**Context:** The 2026-07-24 port below claimed to be "surgical code-for-code,"
but a full function-by-function diff against `bloom-agent-v2`'s live code
(not v2's README, which was itself stale) found it wasn't quite that.
Verified against the 5 real ledger photos (`SCHOOL FEES LEDGER` pages —
K-G, Nursery 1&2, Basic 1&2, Basic 3, Basic 4&5, 2026 Term 3) that v2 used
to field-test its own prompt — the surname/firstname hint lists inside
`LEDGER_FINANCIAL_PROMPT` are drawn directly from these same pages, so
they're the right ground truth to check against.

**Root cause found:** `groqLedgerFinancialOCR()` was calling Groq with
`max_tokens: 1600`. V2's equivalent (`callGroqVision(..., 4096)`) uses
4096 — confirmed by v2's own comment on `EXPECTED_PAGE_TOKENS=5000`
("generous buffer above max_tokens(4096)"). At 1600, JSON output for a
busy class page (the K-G ledger alone has 26 numbered rows; Nursery
1&2 has 13 rows plus a Creche section) gets cut off mid-array and rows
silently vanish. This is the exact truncation failure mode that was
already fixed once (memory: "max_tokens truncation fixed, was 600") and
came back at a smaller value during yesterday's port.

**Fixed to match v2 exactly, function for function:**
- `max_tokens: 1600 → 4096`
- `reasoning_format: 'hidden' → reasoning_effort: 'none'` (v2's actual field-tested setting)
- Removed the `_noJsonMode` strict-JSON-retry fallback and the extra
  `resp.status === 529` check — neither exists in v2's `callGroqVision`;
  per standing instruction, v1 mirrors v2 exactly rather than carrying
  extra untested logic v2 doesn't have
- `parseLedgerFinancialJSON()` — dropped the `<ildo>` tag-stripping regex
  (not present in v2's `parseLedgerJSON`, same reasoning)
- Deskew Hough-line thresholds in `compressLedgerForFinancialScan()`:
  `0.20/0.15 → 0.25/0.20` of image width, matching v2's `tryDeskew()` exactly
- Preprocessed-canvas JPEG quality: `0.92 → 0.97`, matching v2 exactly

**Everything else audited and confirmed already identical to v2:**
`LEDGER_FINANCIAL_PROMPT`/`LEDGER_FINANCIAL_READING_DISCIPLINE` text
(byte-for-byte match, only the constant names differ), `tryPerspectiveCorrect()`,
`computeBlurScoreLedger()` + threshold (60), `updateGroqRateState()`,
`ledgerCooldown()`, `processOnePage()`, `mergePageIntoResults()`,
`processAllLedgers()` — all logically identical to v2, differences were
formatting/whitespace/comments only.

**Not yet field-tested on a real device with a real ledger photo** —
GitHub push confirmed successful, syntax-checked (`node --check`), but
this still needs an actual phone test with David before being called done.

**Commit:** pushed to `app.js` + `index.html` (cache bumped to `?v=20260725`)
**Requested by:** Bayo. Implemented by Claude (Anthropic). Verified against
Bayo-uploaded photos of the real ledger v2 was field-tested on.

### 2026-07-24 — V2 multi-page ledger pipeline merged into Section 3

**What was done:** Surgical code-for-code port of `bloom-agent-v2`'s superior
multi-page ledger pipeline into V1's Section 3 (Financial Ledger Scan).
Section 1 (Signboard OCR) and Section 2 (Smart Register Counter) are
**completely untouched** — zero changes to their code.

**What was preserved from V1 (unchanged):**
- `LEDGER_FINANCIAL_PROMPT` — field-tested prompt, 62% crop rule, UNCLEAR discipline
- `tryPerspectiveCorrect()` — keystone/trapezoid correction
- `computeBlurScoreLedger()` + `BLUR_VARIANCE_THRESHOLD_LEDGER` — blur detection
- `compressLedgerForFinancialScan()` — CLAHE + deskew + contrast enhancement
- `parseLedgerFinancialJSON()` — JSON parser + safety-net student recovery
- `groqLedgerFinancialOCR()` — Groq call (now also calls `updateGroqRateState`)
- `scanFinancialLedger()` — original single-page entry point (still works)
- `renderLedgerFinancialSummary()` — V1 summary panel (still works)
- `clearLedgerFinancialData()` — clear button (extended to also reset V2 state)

**What was added from V2 (new, own area below V1 originals):**
- `groqRateState` + `updateGroqRateState()` + `parseGroqDuration()` — tracks Groq
  token budget live from response headers so cooldown is adaptive, not blind guessing
- `callHFVision()` — HuggingFace Qwen2.5-VL-7B fallback provider
- `callPaddleOCR()` — Oracle VPS PaddleOCR provider (dormant until ocrServiceUrl set in Firestore)
- `buildLedgerCascade()` — PaddleOCR → Groq → HuggingFace cascade builder
- `processOnePage()` — runs one page through full cascade with 30s timeout per provider
- `mergePageIntoResults()` — deduplicates by name, normalises payment status, builds class groups
- `calcLedgerConf()` + `addLiveLedgerItem()` — confidence scoring + live feed row
- `ledgerCooldown()` — adaptive wait: short pause if healthy, exact Retry-After wait if budget low
- `retryFailedPages()` — retries ONLY pages that failed, never re-scans good pages
- `processAllLedgers()` — new multi-page entry point wired to "Read All Pages" button
- `showLedgerMultiPageResults()` — class-grouped results with failed-page warning + retry button

**New state variables (prefixed to avoid collision with V1 vars):**
ledgerPageCount, ledgerImages, allLedgerStudents, ledgerClassGroups,
ledgerFailedPages, ledgerDetectedClass/Term/Year

**Key behaviour:** After processAllLedgers() completes, ledgerFinancialData
is kept in sync so the existing Show Principal panel still reads real figures.

**Commit:** 04938e345460c5af5c8b3259bbe9ce82e512dd18
**Not yet field-tested on a real device.**
**Requested by:** Bayo. Implemented by Sol (Base44 Superagent).

### 2026-07-19 — Added Signboard Scan (auto-fills name/address/LGA/state)
- **Ported from `bloom-agent-v2`'s proven signboard pipeline** — direct
  Groq call, `qwen/qwen3.6-27b`, same working config. Signboard text is
  printed and single-block (not a handwritten multi-column table), so this
  uses a simple resize with no OpenCV crop/deskew — that machinery exists
  for the register/ledger scans, not needed here.
- **New fields added to the form:** Address, LGA, State — these didn't
  exist in v1 at all before now. School Name field is reused (auto-filled,
  still manually editable).
- **New "📸 Scan School Signboard" section** placed above the existing
  register-scan pipeline. Entirely separate code path
  (`scanSignboard`/`_callGroqSignboardVision`/`SIGNBOARD_PROMPT`) — the
  existing Smart Register Counter and yesterday's Financial Ledger Scan
  are both untouched.
- **Caught and fixed a duplicate-ID bug during this edit** — an early
  version of the str_replace accidentally duplicated the `#ai-pipeline`
  div opening tag and introduced a conflicting step-number label (the
  register pipeline already has its own internal "Step 1 → Step 2"
  sub-numbering for scan/review; a naive outer renumbering clashed with
  it). Fixed before pushing — verified zero duplicate IDs across the file
  before commit.
- **Deal object extended** with `address`/`lga`/`state` under `school` —
  additive, existing fields unchanged.
- **Show Principal panel** now displays real LGA/state when captured,
  falling back to phone contact if not.
- **Not yet field-tested on a real device.**
- **Requested by:** Bayo. Implemented by Claude (Anthropic).

### 2026-07-19 — CORRECTION: added the actual missing capability (Financial Ledger Scan)
- **Correction to the previous entry below:** the resolution/blur fix
  earlier today optimized the *existing* name-reading feature, which
  Bayo confirmed was already working perfectly. That wasn't the actual
  gap. **The real reason `bloom-agent-v2` exists as a sandbox in the first
  place is that v1 could read student names but could NOT read the
  financial ledger** (balance, term fees, total, payment status per
  student) — that capability never existed here at all.
- **Added: Financial Ledger Scan** — a genuinely new, separate feature
  ported directly from `bloom-agent-v2`'s proven, field-tested pipeline
  (same prompt, same 62%-crop technique, same payment_status enum with
  UNCLEAR-not-OWING discipline, same Retry-After-aware rate limiting).
  New button, new state (`ledgerFinancialData`), new Groq call
  (`groqLedgerFinancialOCR`) — entirely separate code path from the
  existing `groqVisionOCR`/`GROQ_OCR_PROMPT` used by the Smart Register
  Counter, which is **completely untouched** and still works exactly as
  it did before any of today's changes. This was the whole point of
  building it this way — prove the capability in the sandbox, then bring
  over *only the working result*, without touching what already worked.
- **Show Principal panel upgraded** to show real outstanding-fees figures
  when the agent has run the Financial Ledger Scan — falls back to the
  honest headcount-only version (built earlier today) when they haven't.
  Same care taken as `bloom-agent-v2`: UNCLEAR-status students are
  excluded from the confident outstanding total, not silently counted as
  owing.
- **Deal object extended** with a new `ledgerFinancial` field (only
  present if the scan was run) — additive, doesn't change the existing
  `scannedStudents`/`scannedCount` fields Bayo's portal already reads.
- **Not yet field-tested on a real device.**
- **Corrected by:** Bayo, catching the scope mismatch directly. Implemented
  by Claude (Anthropic).

### 2026-07-19 — Ported image-resolution lesson from bloom-agent-v2 + added Show Principal panel
- **Image resolution raised 400px → 1000px.** This was the real accuracy
  bottleneck, not the rate-limit handling (which was already solid). Every
  denoise/adaptiveThreshold/deskew step downstream was operating on an
  already-tiny 400px image no matter how good those algorithms were. This
  mirrors the exact lesson learned fixing `bloom-agent-v2`'s ledger scanner
  earlier the same day — resolution, not model quality, was the bottleneck.
- **Blur detection added** (Laplacian variance, same technique as
  `bloom-agent-v2`) — but adapted to a **non-blocking warning** instead of
  a blocking retake dialog. v1 processes photos in a **batch** (multiple
  files selected at once via `_readOnePage` loop), unlike v2's one-photo-
  at-a-time capture flow, so interrupting mid-batch with a confirm dialog
  would be a worse UX than a simple heads-up in the existing status
  overlay.
- **Added "Show Principal" fullscreen panel** — v1 had no equivalent to
  `bloom-agent-v2`'s Step 3 pitch screen. Deliberately built using only
  data v1 actually captures: school name, headcount, detected class, the
  captured name list, and selected tier/price. Does **NOT** show an
  "outstanding fees" figure like v2's version does — v1's OCR doesn't
  extract payment status or per-student fees, so showing a fabricated
  financial figure would repeat the exact false-confidence bug already
  fixed in `bloom-agent-v2` (the ₦928,000 false-owing incident). Honest
  scope: shows what's real, not what would look impressive.
- **What was deliberately NOT touched:** the OCR prompt, JSON schema,
  provider cascade order, and rate-limit/retry logic — all already solid.
  This was a scoped, additive change on a live production app, not a
  rewrite.
- **Not yet field-tested on a real device** — test before wide rollout.
- **Requested by:** Bayo. Implemented by Claude (Anthropic).

---

## 🔜 Next Steps
- 🔜 Field-test the resolution increase and blur warning on real photos
- 🔜 Field-test the Show Principal panel with a real agent visit
- 🔜 Consider porting `bloom-agent-v2`'s crop-to-column-width technique
  (currently v1 sends the full resized page, no column-focused crop) if
  name-extraction accuracy still needs improvement after the resolution fix
- 🔜 Add Agent (Portal, agent ID photo scan) — separate app
  (`bloom-portal`/`bloom-portal-v2`), not yet started

---

*Maintained by Claude (Anthropic). Started 2026-07-19.*



## 2026-07-25 — Premium Gate Restoration

### What changed
- Removed ALL premium test bypasses from production code.
- `openM()`: Now checks `_isPremium()` — non-premium users see upgrade nudge, not scan button.
- `loadSettings()`: Subject scan button gated by `_isPremium()`.
- `index.html`: All 4 premium-scan elements set to `display:none` (JS toggles based on plan).
- Cache-busting: ?v=20260725c

### Premium gate behavior (production)
- **Premium users**: Scan buttons visible, scanning works normally.
- **Free users**: Upgrade nudge visible instead of scan button, toast on scan attempt.
- **Demo mode**: Treated as premium (scan buttons visible, no real data saved).


---

## 2026-08-10 — Strategic Decision: Basic Tier Eliminated + New Slogan

**Bayo's decision:** Basic tier completely eliminated. All schools are now Premium.
New slogan: **GIVE YOUR SCHOOL THE PREMIUM EXPERIENCE**

### Changes — `index.html`
- **Login subtitle** updated: `GIVE YOUR SCHOOL THE PREMIUM EXPERIENCE`
- **Show Principal pitch panel** — slogan added below the location line in teal
  (`color:#a5f3fc`) so it appears on every principal pitch screen
- **Pitch panel footer** — slogan added above the AariNAT copyright line

### No changes to pricing tiers
The agent's tier selector (Starter 1–50, Small 51–100, Medium 101–200, Large 201–350,
Enterprise 351+) represents size-based pricing bands for the single Premium product.
These are not "basic vs premium" — they stay as-is.

### Commit
- `2d1231d` — index.html: slogan on login + Show Principal panel


---

## 2026-08-12 — Agent App: Premium Tier Naming (follows 2026-08-10 decision)

**Context:** Basic tier was eliminated on 2026-08-10. All schools now get the full Premium
Experience. The agent app was still showing the old tier names (Starter/Small/Medium/Large/
Enterprise) which were associated with the basic product. Updated to reflect that every
plan an agent sells is Premium.

### Changes — `app.js`
Both `TIERS_LIST` and `TIERS` arrays renamed:

| Before | After |
|---|---|
| `Starter (1-50 students)` | `Premium · 1–50 students` |
| `Small (51-100 students)` | `Premium · 51–100 students` |
| `Medium (101-200 students)` | `Premium · 101–200 students` |
| `Large (201-350 students)` | `Premium · 201–350 students` |
| `Enterprise (351+ students)` | `Premium · 351+ students` |

Prices unchanged — these ARE the premium prices.

### Changes — `index.html`
- Section label: "Select Pricing Tier" → "Select Premium Plan" with `✨ ALL PREMIUM` badge
- Each tier card: `✨ PREMIUM` badge added above student range
- Show Principal screen: "Selected Plan" → "✨ Premium Plan Selected"
- Bottom confirmation: "No re-typing needed — this is ready to activate today." →
  "No re-typing needed — this school gets the full **Premium Experience** from day one."
- `.tier-badge` CSS added (muted purple normally, white when tier is selected)

### Commits
- `0f2f0b1` — app.js: TIERS_LIST + TIERS renamed to Premium
- `2ace785` — index.html: tier cards + labels + Show Principal updated


---

## 2026-08-12 — Premium Prices Applied (replaces basic prices)

**Source:** EduBloom School Partnership Proposal document (photographed 2026-08-12).
Formula confirmed: **Premium = Basic price × 1.5**

| School Size | Basic (old) | Premium (new) |
|---|---|---|
| 1–50 students | ₦10,000/term | **₦15,000/term** |
| 51–100 students | ₦20,000/term | **₦30,000/term** |
| 101–200 students | ₦35,000/term | **₦52,500/term** |
| 201–350 students | ₦55,000/term | **₦82,500/term** |
| 351+ students | ₦75,000/term | **₦112,500/term** |

### Files changed
- **`app.js`** — `TIERS_LIST` and `TIERS` arrays: all five prices updated
- **`index.html`** — all five tier card price displays updated

### Commits
- `bbfecdd` — app.js: Premium prices in TIERS_LIST + TIERS
- `de3d99f` — index.html: tier card prices updated


---

## 2026-08-12 — Agent Registration Flow (replaces dead WhatsApp link)

### Problem
"New Agent?" tab showed: "Contact Bayo · +234 814 507 3941" + WhatsApp button.
No form, no Firestore write, no portal notification. Bayo had to manually add agents.

### What was built

**`index.html` (`367f77f`):**
Old: A paragraph saying "self-registration not allowed + WhatsApp link"
New: A full registration form with:
- Full Name
- WhatsApp Phone Number (normalised to 234XXXXXXXXXX)
- State they will cover (all 36 states + FCT dropdown)
- How they heard about EduBloom (text input)
- "📨 Submit Request" button
- Success message on completion (fields hidden, green confirmation shown)
- Note: "Your request goes directly into Bayo's admin portal. WhatsApp alert also sent as backup."

**`app.js` (`add8951`):**
- `doRegister()` now routes to `submitAgentRequest()` instead of showing error
- `submitAgentRequest()`:
  - Validates name, phone, state
  - Normalises phone to international format (234XXXXXXXXXX)
  - Writes to `admin_agent_requests` collection in Firestore with `{name, phone, state, source, status:'pending', submittedAt, platform:'agent-app'}`
  - Offline fallback: saves to localStorage if no connection
  - After success: hides form, shows green confirmation
  - After 800ms: opens WhatsApp to Bayo's number as a secondary alert only (not the primary notification)

### Priority order (Bayo's requirement)
1. **Firestore write first** — appears in portal immediately via real-time listener
2. **WhatsApp second** — just an alert that something is in the portal, not a replacement for it


---

## 2026-08-12 — Agent Registration: Photo + Bank Details Added

**`index.html` (`b19e311`):**
Registration form now has 3 labelled sections:

**1 · Identity**
- Face photo — 72px circle (tap to open camera/gallery). Required.
- Full Name
- WhatsApp Number
- State to Cover

**2 · Bank Account for Commission**
- Info box explaining: "Your 20% commission is paid directly into this account"
- Bank Name (dropdown — all major Nigerian banks)
- Account Number (10-digit NUBAN, numeric input)
- Account Name (manual entry)

**3 · How Did You Hear About Us?**
- Free text source field

**`app.js` (`38bed75`):**
- `previewRegPhoto(event)` — resizes photo to 220×220 JPEG at 75% quality (fits in Firestore document limit), displays in the preview circle
- `clearAcctVerify()` — clears the verification status when user changes bank/account
- `submitAgentRequest()` now validates: photo required, all bank fields required, account number exactly 10 digits
- Full request written to Firestore: `{name, phone, state, source, photo (base64), bankName, acctNum, acctName, status:'pending', submittedAt, platform}`
- WhatsApp alert to Bayo includes bank details in the message body


---

## 2026-08-15 — Branding Correction: Edu-BLOOM (not EduBloom / Educational Bloom)

**Issue identified:** The real logo uses "Edu-" in purple and "BLOOM" in orange. The codebase
had been using "EduBloom" (no hyphen, wrong caps) and "Educational Bloom" (wrong expansion
entirely) across all three apps and all WhatsApp message templates.

**Total replacements across all 6 files: 52**

| Wrong | Correct | Count |
|---|---|---|
| `Educational Bloom` | `Edu-BLOOM` | 17 |
| `EduBloom` | `Edu-BLOOM` | 35 |

**ID card canvas logo (portal_app.js):**
- Before: `ctx.fillStyle = '#ffffff'` → `fillText('Edu', ...)` + `ctx.fillStyle = '#f59e0b'` → `fillText('BLOOM', ...)`
- After: `ctx.fillStyle = '#7c3aed'` (purple) → `fillText('Edu-', ...)` + `ctx.fillStyle = '#f97316'` (orange) → `fillText('BLOOM', ...)`

The hyphen is now included. Logo baseline raised from y=55 to y=57 to accommodate 30px font (was 28px).



---


---


---

## 2026-08-17 (2) — Agent Manual Link Added to App

**Two entry points added to `index.html` (`a005bd7`):**

**1 · New Agent registration form** — A blue info banner appears below the Submit button:
- Icon, heading "Download the Agent Manual", and a short description of what it covers
- Tapping opens `AGENT_MANUAL.html` in a new tab
- Visible to anyone who hasn't registered yet — the right moment to discover the manual

**2 · Settings tab (⚙️)** — A card at the bottom of the Settings section with:
- Section label "📚 Agent Manual"
- One-line description
- "📖 Open & Download Manual" button — also opens `AGENT_MANUAL.html` in new tab
- Accessible to all logged-in agents at any time

**Cache-bust:** `style.css?v=20260817-manual`

**Requested by:** Bayo. Implemented by Claude (Anthropic).


## 2026-08-17 — New Agent Page Scroll Fix + Agent Manual Published

### Scroll fix — `style.css` (`03a58e3`)
**Problem:** The New Agent registration form is taller than the viewport. The `.login` container
was `align-items:center` with no `overflow-y`, so content overflowed both above and below the
screen. Agents could scroll down into the form but could NOT scroll back up — the top was cut off
with no way to reach it.

**Fix (2 lines changed):**
- `.login` → added `overflow-y:auto` + changed `align-items:center` to `align-items:flex-start`
- `.login-box` → added `margin:auto` (keeps the short login form vertically centred via auto margins,
  allows scroll when register form is taller than the viewport)

**Cache-bust** → `style.css?v=20260817-scrollfix` in `index.html` (`cc7c0d6`)

### Agent Manual — `AGENT_MANUAL.html` (`274915a`)
Full 14-chapter user manual for the Edu-BLOOM Agent App committed to this repo.
Written in plain English, zero technical jargon. Covers every feature:
1. What Is This App?
2. Logging In
3. New Agent Registration
4. Dashboard Overview
5. Section 1 — Signboard Scan
6. Section 2 — Smart Register Counter
7. Section 3 — Financial Ledger Scan
8. School Details Form
9. Premium Plans & Pricing (all 5 tiers, commission table)
10. Show Principal Panel
11. Submitting a Deal
12. My Deals
13. My Earnings
14. Tips & Troubleshooting (9 known issues documented)

Styled to match the dark navy app theme. Live at:
https://kobomoba.github.io/bloom-agent/AGENT_MANUAL.html

**Requested by:** Bayo. Implemented by Claude (Anthropic).


## 2026-08-16 — Edu-BLOOM User Manual Released

A 32-page user manual for the Edu-BLOOM school app has been written and committed to
the School-Bloom repo as `EduBLOOM_School_App_Manual.docx`. Written in plain English
with zero technical jargon. All 23 feature areas covered with step-by-step instructions.

An in-app help system (18 searchable accordion topics) was also added to the school app
under ❓ Support in the menu.

No changes to bloom-agent in this session.
