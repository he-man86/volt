# 13 — Error Messages and Warnings

> **Source:** https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_struct_reference_errors.html
> **Retrieved:** 2026-05-26
> **CODESYS version:** V3.5.22.0

## Summary

CODESYS publishes a catalog of ~200 numeric diagnostic codes (`C0001`–`C0587`, with gaps). Each code has a dedicated page describing the trigger, an example that produces it, and the recommended fix. The catalog itself is an index — no top-level rules live here. This file's role is to be the **lookup gateway**: name the codes, link to each one, and document the patterns used.

## How CODESYS codes are formatted

- Prefix `C` followed by a 4-digit zero-padded number: `C0001`, `C0354`, `C0587`.
- Numbering is **not** dense — missing numbers are reserved for deprecated checks or vendor extensions.
- Single per-code pages live at URLs of the form `_cds_error_<code-lowercase>.html` (e.g. `_cds_error_c0001.html`). One known exception: `C0454` lives at `_cds_error_c0008-2040066.html`.
- Most are errors; a few are warnings (`_cds_warning_c0584.html` — note the `_warning_` infix).

## Code index

The full list (with URLs) is in [`_toc.json`](./_toc.json) under `"Error Messages and Warnings"`. Total: ~200 entries. Range: `C0001`–`C0587` with gaps.

**Examples of what each range tends to cover** (derived from spot-checks; not exhaustive):

| Range | Theme (approximate) |
|---|---|
| `C0001`–`C0050` | Lexer / parser / fundamental name resolution |
| `C0051`–`C0100` | Type mismatch, conversion errors |
| `C0101`–`C0150` | Array / pointer / addressing errors |
| `C0151`–`C0220` | Method / interface / extends / override semantics |
| `C0221`–`C0270` | Persistence, retain, init-slot, GVL semantics |
| `C0271`–`C0400` | Library / namespace / module errors |
| `C0401`–`C0500` | Pragma errors, attribute misuse |
| `C0501`–`C0587` | Newer / vendor-specific checks |

Don't rely on the ranges — each page is the authoritative source for its own code.

## Why this matters for tooling

We **do not own these codes**. The LSP's own diagnostics (`source: "plcassist-st-lsp"`) use our own message text. We don't try to issue CODESYS codes from the LSP — that would be misleading, because:

1. CODESYS may upgrade or change a code's meaning across versions.
2. The IDE will emit the *real* code on push; our diagnostic is a heads-up, not a substitute.
3. Our checks are a subset of what CODESYS catches; mapping 1:1 would over-promise.

What we **do** want from this catalog:

- **Hover documentation for IDE diagnostics**: if a CODESYS push fails and surfaces `C0042` in the bridge response, we can link to the CODESYS doc URL for that code so the user/AI sees the canonical explanation.
- **Diagnostic-code → fix-recipe lookup**: in future, an LSP code-action provider could suggest common fixes for specific CODESYS errors when they surface from the bridge.

## Sub-pages

200+ individual pages, one per code. Catalog is in `_toc.json`. Per-code URLs follow the pattern:

```
https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_error_<code>.html
                                                                     ^^^^^^ lowercase, e.g. "c0042"
```

Exception: `C0454` is at `_cds_error_c0008-2040066.html`. Treat the URL in `_toc.json` as authoritative.

## Notes for tooling

**Possible Stage 6 work:**
- `src/reference/error-codes.ts` exporting `{ code: "C0042", title: "...", url: "https://..." }` for every known code, hydrated by scraping the per-code pages.
- A bridge-response augmenter that detects `Cnnnn` in an IDE compile error and decorates it with our local catalog entry (title + URL) before surfacing to the user/AI.

**Not part of any current stage:**
- Pre-emitting CODESYS-style codes from LSP diagnostics. We keep our own diagnostic source/code namespace.

**Stage 6 work is optional** — this section is the lowest-priority of the 13 because the codes describe IDE-side enforcement, not language quirks the AI must learn.
