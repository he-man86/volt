## Why

Volt's closed vocabularies — the pipe **op codes**, **item-kind** strings, **vendor** ids, **health-status** words,
**error codes** — are spelled as raw string literals scattered across the codebase instead of being defined once
and reused. Two read-only audits mapped the blast radius:

- **Op codes** (`refs`/`fetch`/`init`/`push`/`build`/`health`/`instances`/`select`/`deselect`) have **no single
  source**: the host `switch`, the paused-allowlist, every `BridgeClient.Call(...)`, and **both** connector sources
  each re-spell them. A rename touches ~6 C# files with nothing enforcing agreement.
- **Item kinds** are the worst offender — raw literals in **~15 files**, including a **hand-maintained reverse map**
  (`PushService.cs:532-545`) that is just `ItemKind.Map()` inverted by hand. `ItemKind` is meant to be the source of
  truth but exposes no named constants and no code↔string inverse, so every consumer re-types the literal.
- The **same op vocabulary is duplicated a second time** as `ProgressFrame.Operation` / active-op labels.
- **Vendor ids** (`codesys`/`twincat`) + display names have no canonical constant even though `PipeNames.ForVendor`
  consumes an id nothing defines; the TS side re-declares the `Vendor` union **3×** and copy-pastes the
  `"TwinCAT"/"CODESYS"` display ternary **5×**.
- Even the vocabulary that *is* centralized — `BridgeErrorCodes` — **leaks**: 3 raw `"PLC_DISCONNECTED"` literals
  bypass it. That proves a one-time cleanup won't hold: without a guard, drift returns.

On the C#↔TS boundary there is *less* to do than it first looks: the `volt` CLI (+ connector HTTP) is a real
abstraction boundary, so everything TS reads across it (status words, error codes, op codes) is a client-side DTO of
a parsed response — normal client/server practice, not duplication to police. The **one** vocabulary genuinely
shared independently on both sides is **file extensions** (the LSP/vscode must classify ST files without invoking
the CLI), and `check-wiring.ts` already guards the 6 writable-source ones. The single gap in that class: the
**reference extensions** (`.library`/`.device`/`.task`) are hand-typed with no guard.

## What Changes

- **Name each C#-only vocabulary once** and replace the literals: an `Ops` const class (op codes + the progress /
  active-op labels that mirror them); named kind constants **and** a `KindToCode` inverse on `ItemKind` (deleting the
  hand-rolled reverse map); a `Vendors` const class (id + display name) beside `PipeNames`; health-status constants;
  and fix the 3 stray error-code literals to reference the canonical spelling.
- **Centralize the TS `Vendor` type + `displayName()`** in one module and import it from LSP/vscode instead of the
  three re-declarations and five copy-pasted ternaries. (Intra-TS — not a cross-language concern.)
- **Guard against re-rot** with a C#-side test (the `VendorParityGuardTests` model) that fails if a centralized
  vocabulary's literal is re-spelled outside its definition class — scoped to the intra-C# vocabularies, not across
  the CLI boundary. Cross-language, the ONLY addition is folding the reference extensions into the existing
  `check-wiring.ts` extension check.
- **Lower-value internal discriminators** (`ok`/`error`/`refused`/`conflict` result kinds; `add`/`delete`/`rename`
  diff-row kinds) become C# enums — optional, last phase.

Non-goals: changing any wire **value** (all shared strings keep their exact spelling — naming ≠ renaming);
introducing a cross-language codegen build step (the guard approach is lazier and sufficient); touching the
load-bearing pipe/vendor asymmetries the parity work already fenced.

## Capabilities

### New Capabilities
- `wire-vocabulary-single-source`: every closed wire/domain vocabulary is defined in exactly one place per language,
  consumed by reference everywhere else, and — where it crosses the C#↔TS boundary — protected from silent drift by
  an automated guard rather than by hand-sync convention.

### Modified Capabilities

## Impact

- **C# (`packages/volt-cli`)**: `Volt.Engine/Workspace/ItemKind.cs` (add kind consts + `KindToCode`), `Volt.Engine/Wire`
  (`Ops` + health-status consts), `Volt.Cli.Transport/PipeNames.cs` (add `Vendors`), and ~20 consumer files whose raw
  literals become references. No behavioral change — the emitted wire strings are byte-identical
  (`WireContractParityTests` is the regression net).
- **TS (`volt-control`/`volt-lsp-iec`/`volt-vscode`)**: one shared `Vendor`/`displayName()` source, imported instead of
  re-declared.
- **Guards**: `volt-scripts/check-wiring.ts` (or a sibling) gains coverage of the currently-unguarded shared
  vocabularies; a small C# test asserts no raw literal re-spells a named vocabulary outside its definition.
- **Risk**: low — this is a rename-to-reference refactor behind existing parity/wiring tests; the main hazard is
  accidentally changing a wire value, which the parity + wiring guards catch.
