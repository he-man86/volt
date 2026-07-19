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

> **Stance updated 2026-07-10** (supersedes the earlier "we do not own these codes" position). The catalog is now
> the LSP's **coverage checklist** and the live `/build` output is a **byte-exact conformance oracle**. See the
> `codesys-error-catalog-checks` change and `TRIAGE.md`.

We keep our **own diagnostic namespace** — the LSP's diagnostics carry `source: "volt-lsp-iec"` and our own `code`
string, never a `Cnnnn` as the primary code. But each diagnostic that mirrors a catalog code now **maps to that
`Cnnnn` as metadata**, and new checks are **sourced from the catalog** rather than from whatever we happened to
notice. Concretely:

1. **Catalog-driven coverage.** [`error-catalog.json`](./error-catalog.json) records every code with its exact
   message template(s), category, a minimal repro, and a coverage status (`covered` / `checkable` / `ide-only`).
   `src/reference/error-codes.ts` wraps it. A `checkable` code with no check yet is a *visible, tracked* gap
   (TRIAGE.md), not a silent absence.
2. **Conformance-verified wording.** Any message we share with the compilers is verified byte-identical against how
   the live IDE actually builds (CODESYS / TwinCAT `/build`, which emits `Cnnnn: <message>`).
   Unverified wording is marked `PROVISIONAL`; per-vendor differences live as data in the vendor-keyed message
   builders, not as guesses.
3. **`Cnnnn` stays metadata, not our code.** The IDE remains authoritative — it emits the *real* code on build;
   our offline diagnostic is a fast heads-up, and our checks are a deliberate zero-FP subset (mapping 1:1 as our
   own code would over-promise, since CODESYS may change a code's meaning across versions).

What we also want from the catalog (unchanged):

- **Hover documentation**: attach the mirrored `Cnnnn`'s doc URL (via the diagnostic's `data`/`codeDescription`) so
  the user/AI can reach the canonical CODESYS explanation.
- **Diagnostic-code → fix-recipe lookup**: an LSP code-action provider could suggest common fixes for specific
  codes (started for a few `checkable` codes; diagnose-only is acceptable for the rest).

## Sub-pages

200+ individual pages, one per code. Catalog is in `_toc.json`. Per-code URLs follow the pattern:

```
https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_error_<code>.html
                                                                     ^^^^^^ lowercase, e.g. "c0042"
```

Exception: `C0454` is at `_cds_error_c0008-2040066.html`. Treat the URL in `_toc.json` as authoritative.

## Notes for tooling

**Landed** (via the `codesys-error-catalog-checks` change):
- `src/reference/error-codes.ts` + [`error-catalog.json`](./error-catalog.json) — the structured catalog for every code (message, category, repro, coverage status), consumed by checks and the offline completeness test.
- ~104 catalog-sourced offline checks under `src/analysis/checks/**`, each conformance-verified (or `PROVISIONAL`) against the live IDE build.
- [`TRIAGE.md`](./TRIAGE.md) — the per-code coverage map and the backlog of remaining `checkable` codes.

**Still open / optional:**
- A bridge-response augmenter that detects `Cnnnn` in an IDE compile error and decorates it with the local catalog entry (title + URL) before surfacing to the user/AI.
- Extending code-actions beyond the current few `FIXABLE` codes.

**Deliberately not done:**
- Pre-emitting CODESYS-style codes as our own diagnostic `code`. We keep our own `source`/`code` namespace and carry `Cnnnn` only as metadata.
