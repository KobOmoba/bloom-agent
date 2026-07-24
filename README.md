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


