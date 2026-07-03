## Why

The LSP is a **single vendor-neutral IEC 61131-3 engine** — one binary that serves both CODESYS and
TwinCAT via a runtime `vendor` switch (`codesys | twincat | auto`). Two things drift from that reality:

1. **The package is misnamed `volt-lsp-codesys`.** It already covers all of CODESYS *and* TwinCAT's
   languages (Structured Text + the editable graphical VG form). The "codesys" name suggests a
   CODESYS-only tool and a mythical separate TwinCAT LSP that doesn't (and shouldn't) exist — per the
   package README, a *separate* vendor LSP is only warranted for a different-structure language (e.g.
   Siemens TIA/SCL), not for CODESYS vs TwinCAT.

2. **The vendor-divergence layer is probably over-modeled.** Today the vendor difference is: the
   `wrong-vendor-pragma` check, the CODESYS-only `__`-operator check, and ~14 of 95 reference-catalog
   entries tagged `codesys`/`twincat` (13 codesys, 1 twincat). The suspicion — worth verifying against
   ground truth — is that the *real* CODESYS↔TwinCAT difference is **smaller** than what's tagged: some
   entries flagged vendor-specific are actually shared IEC that both compilers accept, so the LSP may
   raise `wrong-vendor` false-positives and carry needless dialect state. (Precedent: `__ISVALIDREF` was
   already found to be TC-compatible and moved off the CODESYS-only list.)

## What Changes

**A. Rename the LSP package to a vendor-neutral name.** Recommended: **`volt-lsp-iec`** (it implements
IEC 61131-3, the standard both vendors share) — alternative `volt-lsp-st`. Rename the folder, `package.json`
`name` + `bin`, the `.opencode/opencode.json` LSP registration, the cross-package deps (`volt-git`,
desktop/opencode seams), and the docs (CLAUDE.md, the package README, the AGENT config). Do NOT rewrite
archived OpenSpec changes — they are historical records.

**B. Audit + collapse the vendor divergence.** Verify each vendor-tagged reference entry and each
vendor-gated check against ground truth (CODESYS docs + TwinCAT/Beckhoff InfoSys, ideally a live TwinCAT
conformance recording via the http-recorder). Retag anything both vendors accept as `shared`; keep only
genuinely dialect-specific items vendor-tagged. Confirm the `__`-operator rejection list is accurate.
Outcome: fewer `wrong-vendor` false-positives and a smaller, evidence-backed dialect layer.

This is a naming/refactor + verification change — no new LSP capability, and the shared IEC parser /
resolver / symbol table / catalogs stay untouched.
