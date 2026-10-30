> Written from Sim-Assist; built in volt-lsp-iec 2026-10-30.

## 1. Diagnostics

- [x] 1.1 `computeDiagnostics` appends `networkDiagnostics(parseResult, project)` when a unit's body is network text
- [x] 1.2 `documentFindings` no longer appends them a second time

## 2. Test

- [x] 2.1 The repro of proposal.md: `computeDiagnostics` gives exactly one `network-plain-st` on `a XOR b`
- [x] 2.2 The language server path gives that diagnostic once, not twice
- [x] 2.3 An ST body gives no network diagnostics

## 3. Consumers

- [x] 3.1 Sim-Assist regenerates its bundle and removes the extra `networkDiagnostics` call in `volt-engine.ts` — handed to Sim-Assist
