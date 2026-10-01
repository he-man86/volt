## Why

`src/analysis` (≈7,900 lines, 97 files: checks for calls, declarations, flow, names, oop, pragmas, types, plus the
diagnostics pipeline) produces every diagnostic an engineer sees in the editor. Its oracle exists: the CODESYS and TwinCAT
build recordings and the six real corpora (`build-conformance.test.ts`: LSP errors ⊆ recorded IDE build). An LSP-only
message is a false positive; an IDE-only one is a gap. The owner's order (2026-10-01): after `frontend-conformance`, BEFORE
`transpile-restructure` — the editor's diagnostics must be right on the corrected front-end before the transpiler is
rebuilt.

Network languages (LD/FBD): their DETAILS will change (a later LD/FBD coverage change), so this change touches network text
ONLY where it is integrated into the LSP — how network bodies enter diagnostics, services and the server — not its parser,
model or checks.

## What Changes

- **Measure first** (scripts, no judgement): every diagnostic the LSP emits on the corpora and the fixtures vs the recorded
  builds of both vendors — false positives and gaps, per check, per message, per vendor.
- **Restructure design-first** (output-neutral): one home per check group, one diagnostics pipeline, import rules (analysis
  reads the front-end only through its index).
- **Conformance per check group**, rule by rule: every message the IDE gives has a fixture recorded from CODESYS/TwinCAT and
  the LSP gives the same message at the same place, or the divergence is recorded (niche: accepted loss).
- **Network-text integration only:** the seams where network bodies enter analysis/services/server get one clear interface;
  nothing inside network text is redesigned.

## Non-goals

- LD/FBD network text's parser, model and network checks (a later change).
- Services/server behaviour beyond what diagnostics need.

## Impact

- `packages/volt-lsp-iec/src/analysis/**`, the network-text integration seams in `src/{services,server}`, conformance
  fixtures/recordings (via the recorders), `build-conformance.test.ts`.
