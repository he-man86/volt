## Why

`volt-lsp-codesys` is shipped: a from-scratch, vendor-keyed CODESYS/TwinCAT language server
(ST + the declaration kinds) with the full LSP feature set, an embedded language reference, a
diagnostics registry, and vendor-dialect selection. Walk it and capture as `language-server`.
(VG is captured separately in `review-vg-language`.)

## What Changes

- Author `specs/language-server/spec.md` — navigation + diagnostics first (**never** type-checking
  or codegen — the IDE compiler stays authoritative); vendor-keyed (a new vendor = a sibling LSP,
  D13); diagnostics default to "on only if TwinCAT itself rejects it"; dialect select via
  `initializationOptions.vendor`.

## Capabilities

### New Capabilities
- `language-server`: a TypeScript-native LSP for the CODESYS/TwinCAT language family; navigation + diagnostics, not type-checking; vendor-keyed.

## Impact

Spec/docs only. Source of truth: `packages/volt-lsp-codesys/README.md`, D13.
