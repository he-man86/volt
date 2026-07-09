---
name: st-reference
description: TwinCAT 3 and IEC 61131-3 Structured Text reference — pragmas, FB lifecycle, TC-specific operators, library namespaces, init slots. Load when writing or reviewing Structured Text source files in a TwinCAT project.
license: MIT
metadata:
  language: structured-text
  vendor: twincat
  source-package: "@opencode-ai/volt-lsp-iec"
  installed-by: "volt-lsp-iec init"
---

## Purpose

TwinCAT 3 Structured Text language reference, installed into this workspace by `volt-lsp-iec init` (run via `volt init`). Use when writing or reviewing `.st` files.

## Where the docs live

```
twincat-reference/     ← TwinCAT-specific (pragmas, operators, library namespaces)
codesys-reference/     ← Shared base (IEC 61131-3 rules, data types, FB lifecycle)
```

Both are siblings of this SKILL.md. The TwinCAT reference is "deltas only" — it cross-references `codesys-reference/` for shared language rules.

## Files to read first (TwinCAT)

- `twincat-reference/00-index.md` — TwinCAT delta index
- `twincat-reference/07-pragmas.md` — Tc* attribute pragmas
- `twincat-reference/03-operators.md` — `__NEW`, `__DELETE`, `__QUERY_INTERFACE`, etc.
- `twincat-reference/12-global-init-slots.md` — TwinCAT-reserved init slot ranges
- `twincat-reference/14-libraries.md` — Tc2_*/Tc3_* library naming and imports
- `twincat-reference/13-error-messages.md` — compiler and ADS error codes

## Files to read first (shared base)

- `codesys-reference/07-pragmas.md` — shared pragmas (both vendors)
- `codesys-reference/09-shadowing.md` — name-resolution search order
- `codesys-reference/11-fb-lifecycle.md` — `FB_Init` / `FB_Reinit` / `FB_Exit` rules
- `codesys-reference/13-error-messages.md` — compiler error catalog

## Updates

Run `volt init --force` to refresh the corpus when the LSP package version changes.
