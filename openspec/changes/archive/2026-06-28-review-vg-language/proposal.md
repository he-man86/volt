## Why

VG (Volt Graphical) is shipped as a first-class textual language: editable FBD/LD bodies
round-trip PlcOpen XML ⇄ VG (the bridge is the source of truth), the LSP analyzes it as its own
sublanguage routed by the leading `NETWORK` token, and `volt-vscode` highlights it by a
content-injection that catches whole `.fbd`/`.ld` files *and* a graphical body inlined in a `.st`
POU. CFC/SFC are read-only. Walk it and capture as `vg-language` (folds D12).

## What Changes

- Author `specs/vg-language/spec.md` — VG is its own language (not ST): exact XML⇄VG round-trip,
  `NETWORK`-token routing/content-detection, editable FBD/LD vs read-only CFC/SFC.

## Capabilities

### New Capabilities
- `vg-language`: editable graphical bodies are a first-class textual language round-tripped exactly by the bridge and analyzed/highlighted by content-detection on the `NETWORK` token.

## Impact

Spec/docs only. Source of truth: `packages/volt-bridge/docs/vg-language.md`, D12.
