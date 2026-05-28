---
name: st-reference
description: IEC 61131-3 Structured Text reference for CODESYS and TwinCAT 3 — pragmas, FB lifecycle, shadowing, init slots, error catalog. Load when writing or reviewing .st files.
license: MIT
metadata:
  language: structured-text
  source-package: "@opencode-ai/volt-lsp-st"
---

## Purpose

Authoritative language reference for IEC 61131-3 Structured Text targeting CODESYS V3 and TwinCAT 3. Use this when writing or reviewing `.st` files in this monorepo (test fixtures in `packages/volt-lsp-st/`, future ST samples, etc.).

## Where the docs live

Single source of truth — the LSP package owns its language reference. Do not duplicate; read in place:

- `packages/volt-lsp-st/docs/codesys-reference/` — CODESYS V3 reference
- `packages/volt-lsp-st/docs/twincat-reference/` — TwinCAT 3 deltas (~10% divergence)

Start at `packages/volt-lsp-st/docs/codesys-reference/00-index.md` for the full table of contents.

## Files to read first

Pretraining is unreliable for ST — vendor-specific pragmas, lifecycle slots, and shadowing rules are easy to get wrong from memory. Always check the reference before guessing:

- `07-pragmas.md` — pragmas that silently change behavior
- `09-shadowing.md` — name-resolution search order
- `11-fb-lifecycle.md` — `FB_Init` / `FB_Reinit` / `FB_Exit` rules
- `12-global-init-slots.md` — global init slot ordering
- `13-error-messages.md` — compiler error catalog
- `twincat-reference/01-pragmas-twincat.md` — TwinCAT-specific pragma extensions

Use the Read tool to pull only the section you need. Loading the full corpus per session is wasteful.

## Vendor selection

The `volt-st` LSP auto-detects CODESYS vs TwinCAT from workspace contents. If you write a vendor-specific pragma and see a `wrong-vendor-pragma` diagnostic, the equivalent for the other vendor is suggested when one exists — consult `twincat-reference/01-pragmas-twincat.md` (TwinCAT) or `codesys-reference/07-pragmas.md` (CODESYS) for the mapping.
