## Context

Two read-only audits (C# layers; TS packages + the C#↔TS contract) inventoried every stringly-typed closed
vocabulary. The findings split cleanly:

- **Intra-C# duplication** — a vocabulary consumed only within C# but re-spelled in many files. Fully fixable with
  one typed source; zero wire risk.
- **Cross-language contracts** — a vocabulary whose string *value* crosses the pipe/HTTP boundary to a TS peer. The
  two languages can't share a type; the risk is the spellings drifting apart. The TS side is already centralized
  per-vocabulary; the missing piece is a guard.

The existing precedents this change extends, not reinvents:
- `BridgeErrorCodes` (C# `const class`, defined once) — the pattern to copy for op codes / kinds / vendors / status.
- `volt-scripts/check-wiring.ts` — already cross-checks the 6 writable-source extensions across all 7 C#/TS/JSON
  copies at build. The guard to *extend*.
- `VendorParityGuardTests` — already fails if a vendor literal appears in `Volt.Engine`. The model for a "no raw
  literal outside its definition" guard.

## Goals / Non-Goals

**Goals:**
- One definition per vocabulary, per language; every other use is a reference.
- Delete the hand-maintained `ItemKind` reverse map — the single highest-value correctness win.
- Turn the "keep C#↔TS spellings in sync by hand" convention into an automated guard for the vocabularies that
  currently have none.
- Keep every wire **value** byte-identical (naming, not renaming).

**Non-Goals:**
- No cross-language codegen / shared-schema build step — heavier than the drift it prevents; a guard is enough.
- No new error codes, status words, or ops — this is centralization, not protocol change.
- No touching the load-bearing pipe/vendor asymmetries (parity work already fenced those).
- The internal enums (result-kind, diff-row) are a nice-to-have final phase, not the point.

## Decisions

**1. `const string` classes, not C# `enum`s, for anything that touches the wire.** The wire carries the *string*;
an enum would force `.ToString()`/parse at every boundary and risk a name≠value mismatch. `const string`
(the `BridgeErrorCodes` pattern) keeps the literal value visible and lets `switch`/`case` stay string-based.
Enums are reserved for the **internal-only** discriminators (result-kind, diff-row) where the compiler-checked
exhaustiveness is worth the conversion and nothing serializes them raw.

**2. `ItemKind` owns both directions.** Add named `const string` kind members and a `KindToCode(string)` inverse
(or a `FromWire` table) so `PushService.cs:532-545`'s hand-rolled reverse map is deleted, not duplicated. The kind
*values* are a cross-language contract — naming them in C# is safe; the guard (Decision 5) covers the TS peers.

**3. Op codes and progress labels share one `Ops` const class.** They are the same vocabulary reaching two fields
(`PipeRequest.Op` and `ProgressFrame.Operation`). One source removes the second, silent copy. Fixes the incidental
`HealthProbe` doc bug (`"pull"` where the wire says `"fetch"`) in passing.

**4. `Vendors` const class beside `PipeNames`, since `ForVendor` already implies it.** Carries both the bare id
(`codesys`) and display name (`CODESYS`). On the TS side, `volt-control` already owns `Vendor`/`VENDORS`/
`displayName()`; LSP + vscode import them (or a tiny shared `vendor.ts`) instead of the 3 re-declarations + 5
ternaries. The C# id and TS id remain independent strings (process boundary) — covered by the guard.

**5. The `volt` CLI (+ connector HTTP) IS the abstraction boundary — don't guard across it.** Everything TS reads
across that boundary (status words in `health.ts`, `BridgeStatus` in `connector.ts`, error codes, op codes in the
e2e harness) is a **client-side DTO of a response TS parses** — normal client/server practice, not duplication to
police. The only vocabulary genuinely shared *independently* on both sides is **file extensions**, because the LSP
and vscode must decide "is this file Structured Text?" WITHOUT invoking the CLI. `check-wiring.ts` already guards
the 6 writable-source extensions across all copies. The one gap in that same class: the **reference extensions**
(`.library`/`.device`/`.task`) are hand-typed in `volt-lsp-iec/.../server.ts:272` with no guard — fold them into the
existing check. That is the entire cross-language scope; no new guard for status/error/op spellings.

**5b. The C#-side rot-guard is the load-bearing anti-drift piece.** A test on the `VendorParityGuardTests` model
that fails if a named C# vocabulary's literal is re-spelled outside its definition class — this is why the cleanup
won't rot back the way `BridgeErrorCodes` already did (3 leaked literals). Scoped to the intra-C# vocabularies this
change centralizes; it does NOT reach across the CLI boundary.

**6. Phase by value, land independently.** Each vocabulary is its own commit behind the parity/wiring tests, so a
phase can ship or be dropped without blocking the rest. Order: kinds → ops+labels → vendors (C#+TS) → status →
error-code leaks → guard extension → (optional) internal enums.

## Risks / Trade-offs

- **Accidentally changing a wire value** during a rename-to-reference is the one real hazard. Mitigation: the
  named constant is initialized to the *exact* current literal, and `WireContractParityTests` + `check-wiring.ts`
  fail loudly on any value change. Do the constant-introduction and the call-site swap in the same commit so the
  diff shows literal→reference with no value edit.
- **Guard false-positives** (a legitimate literal flagged). Mitigation: scope the guard to the specific vocabularies
  and allow the definition file itself; model it on the already-tuned `VendorParityGuardTests` comment-stripping.
- **Churn vs. payoff on the low-value phases.** The result-kind/diff-row enums touch real files for modest gain;
  they're explicitly last and optional so the high-value work isn't held hostage to them.
- **The `BridgeError` client-assembly can't see `Volt.Engine`.** The 3 stray `PLC_DISCONNECTED` literals live in an
  assembly that doesn't reference `BridgeErrorCodes`. Decision: give that assembly a one-line shared const (or make
  it reference the canonical) rather than leave the literal — the guard will otherwise keep flagging it.
