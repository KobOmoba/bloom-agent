# bloom-agent — Production Field Agent App

**Domain:** agent.edubloom.com.ng
**Repo:** bloom-agent
**Last updated:** 2026-09-11

---

## Current Versions

| File | Version |
|------|---------|
| app.js | `?v=20260911-ocr-fix` |
| sw.js CACHE_NAME | `edubloom-bloom-agent-20260911-ocr-fix` |

---

## Session History

### 2026-09-11 — OCR fix: reasoning_format regression

**Problem:** Register scanner was silently failing on Groq and cascading to
HuggingFace → OCR.space, producing poor results or "All OCR failed" errors.

**Root cause (two locations):**

1. `groqVisionOCR()` line 1618 — called `GroqRotator.vision()` with
   `reasoning_format: 'hidden'` explicitly set.
2. `_ocrAllCrops()` line 3630 — included `reasoning_format: 'hidden'`
   in the default `groqOpts` passed to `GroqRotator.vision()`.

`GroqRotator.vision()` was deliberately built to NOT pass `reasoning_format`
because Groq's vision endpoint rejects it and returns "Failed to validate JSON".
The parameter is valid only for text completions (where `text()` correctly
defaults it to 'hidden'). Both callers were copying the text pattern — wrong
for vision.

**Effect:** Every Groq vision call returned a 400 validation error. The error
handler marked each key as failed, exhausting the rotator. Final message showed
"All Groq API keys are currently rate-limited" — misleading but that's the
catch-all error. Cascade to HF then OCR.space.

**Fix:** Removed `reasoning_format: 'hidden'` from both call sites. One key
deleted from each opts object. `GroqRotator.vision()`'s own logic handles this
correctly — it passes `reasoning_format` only if explicitly set by the caller,
and now neither caller sets it.

**Not changed:** `groqLedgerFinancialOCR()` uses `reasoning_effort: 'none'`
(a different parameter, goes to Groq API directly, not through GroqRotator.vision).
Left unchanged pending evidence of a problem there.

---

### 2026-08-20 — Security audit

XSS fix: esc(n) on OCR list. Cache bumped to 20260820-security.

---

## Commission Structure

| Type | Rate |
|------|------|
| New school | 20% of term fee |
| Renewal (permanent) | 10% of term fee |

## Pricing Tiers

| Students | Fee/term |
|----------|----------|
| 1–50 | ₦10,000 |
| 51–100 | ₦20,000 |
| 101–200 | ₦35,000 |
| 201–350 | ₦55,000 |
| 351+ | ₦75,000 |
