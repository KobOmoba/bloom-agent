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
