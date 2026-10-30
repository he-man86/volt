> DRAFT, written from Sim-Assist (change `network-viewer`, 2026-10-30). Measured, not started.

## Why

`computeDiagnostics` is the diagnostics entry point that bundle consumers call: Sim-Assist does, and so does PLC
Assist's LSP bundle. It does not run the network checks. Only the language server's `documentFindings`
(`analysis/pipeline/document.ts:69-71`) appends `networkDiagnostics`. So a consumer that is not the language server
never sees the network refusals (`network-plain-st`, `network-unnamed-target`, and the wire, `%` line, `BRANCH` and
`R_EDGE` arity checks). Its users can save network text that `volt push` then refuses.

Measured on volt dev `3e4c6c4082` with a probe bundle. Sim-Assist's vendored `5ed026b373` gives the same result.

```
PROGRAM Main
VAR
	a : BOOL;
	b : BOOL;
	x : BOOL;
END_VAR
%LANGUAGE LD
%NETWORK
x := a XOR b;
END_PROGRAM
```

The file is parsed with `{ networkText: true, unicodeIdentifiers: false }`, and the project is this file plus
Standard 3.5.18.0:

| Call | Result |
|---|---|
| `computeDiagnostics({parseResult, source, project, config: resolveConfig({vendor:"codesys"}), uri})` | no network diagnostic |
| `networkDiagnostics(parseResult, project)` | `error network-plain-st` "an infix 'XOR': in a network every box is a call, and only contacts are infix AND / OR" on `a XOR b` |

Sim-Assist works around this in `plc/engine/volt-engine.ts`. It calls `networkDiagnostics` next to
`computeDiagnostics` for every network-text POU and de-duplicates by code + span, so the workaround stays correct
once this change lands.

## What changes

- `computeDiagnostics` includes `networkDiagnostics` for a document whose bodies are network text, once per
  diagnostic, exactly as the language server reports them.
- `documentFindings` stops appending them separately, so the language server does not report them twice.

## Impact

- `src/analysis/pipeline/diagnostics.ts` and `src/analysis/pipeline/document.ts`.
- Consumers (Sim-Assist, PLC Assist) see the same network refusals as the language server. Sim-Assist can drop its
  extra call after `npm run build:volt`.
