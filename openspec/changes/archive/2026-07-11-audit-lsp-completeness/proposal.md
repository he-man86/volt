# LSP completeness audit — close the resolution-depth & VG-parity gaps

## Why

The error-catalog work made **diagnostics** thorough and live-verified, but the rest of the LSP
(navigation, completion, hover, signature help, semantic tokens, formatting) was never systematically
audited. A four-agent audit against the `st-language-server` spec ran two lenses:

- **Lens #1 — scenario→test traceability:** 92 spec scenarios → **49 COVERED · 17 PARTIAL · 26 NONE**.
- **Lens #3 — feature × input-class matrix:** every feature probed live across project / library /
  device / interface / cross-file / graphical-VG / POU-kinds.

The findings cluster on **two root causes**, not scattered bugs: *symbol-tree completeness* (devices,
interfaces, non-materialized library types are absent from `buildSymbolTable`) and *VG-variant wiring*
(some features got graphical-aware variants, several didn't). Plus one real **correctness bug**: rename
of a type silently produces broken code.

## What changes

Close the gaps top-down (correctness → high-leverage resolution → VG parity → test debt). Each fix ships
with the test that would have caught it; corpus zero-FP gate held; live-verified where a bridge helps.

Non-goals: mirroring the CODESYS object model (rejected — trades away git-native/text/AI-editability),
overload resolution (structurally unrepresentable), and the bridge/CLI-owned scenarios (R36–R39 push).

See `tasks.md` for the prioritized checklist and `../../specs/st-language-server/spec.md` for the contract.
