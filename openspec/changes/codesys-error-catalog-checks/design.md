## Context

`volt-lsp-iec` has ~15 offline semantic checks in `src/analysis/checks/`, vendor-keyed message builders (`messages.ts`), an opt-in `LintConfig` for FP-prone checks (`config.ts`), and a zero-FP corpus gate (`test/corpus`). Coverage grew opportunistically — there is no map of "what a real build catches."

CODESYS publishes ~220 numbered diagnostics (`C0001`–`C0587`, gaps) at `content.helpme-codesys.com/_cds_error_cNNNN.html`; the code→URL list is already in `docs/codesys-reference/_toc.json`. Each per-code page gives the exact message, a cause, a repro, and a fix. Critically, a live build emits every diagnostic as `Cnnnn: <message>` — observed directly, e.g. `C0077: Unknown type: 'USNT'` and `C0032: Cannot convert type 'BIT' to type 'USNT'`. So the catalog is the checklist and the live `/build` output (already exposed by both bridges) is a byte-exact conformance oracle.

This reverses `13-error-messages.md`'s "we do not own these codes" position: we keep our own diagnostic `source`, but we map each diagnostic to the `Cnnnn` it mirrors and source new checks from the catalog.

## Goals / Non-Goals

**Goals:**
- A structured, machine-usable catalog of all ~220 codes with coverage status, consumable by checks and (later) code-actions.
- A repeatable triage that makes every gap visible (`covered` / `checkable` / `ide-only`).
- An incremental implementation loop: one code → one check + one repro test + conformance recording, corpus gate green throughout.
- Byte-identical messages per vendor, verified from live `/build` output.

**Non-Goals:**
- Implementing all 220 at once (this change lands the catalog, the triage, and the first batch).
- Emitting `Cnnnn` as our own diagnostic `code` (misleading across CODESYS versions; the code is metadata only).
- Checking `ide-only` codes offline (library resolution, licensing, codegen) — documented as out of scope, deferred to the bridge's real build.
- Reproducing the docs' copyrighted prose (we extract facts + author our own repros).

## Decisions

### D1 — Catalog storage: one machine-readable source of truth, generated views
`src/reference/error-codes.ts` (or a checked-in `errors.json` it wraps) is the single source: `{ code, message: string|string[], category, status, repro, cause, ourCheck?, ourCode?, verified: {codesys, twincat} }`. Human-browsable per-code notes live under `docs/codesys-reference/errors/`. Checks and future code-actions import the TS module; the corpus/conformance tests assert against it. Alternative (per-code Markdown only) rejected — not consumable by code.

### D2 — Harvest is a bounded, copyright-safe extraction
Fetch each per-code page; extract only the code, the verbatim message template(s) (functional interop facts — the byte-for-byte parity target), and the category. Author our own minimal repros (do not copy the docs' examples wholesale) and paraphrase the cause to one line. No prose/fix text copied. The 220 fetches are mechanical and independent — a good fan-out (subagent-per-batch) if the user opts into a workflow; otherwise batched sequentially.

### D3 — Triage rubric (assign exactly one status)
- `covered` — an existing check already mirrors it. Record `ourCheck` + `ourCode`. Seed known ones: `unknown-type` → C0077, `cannotConvert`/assignment → C0032, `unresolved-identifier` → its code, etc.
- `checkable` — decidable from the parsed project + symbol table with zero FP (constant range, literal-type suffix mismatch, duplicate decl, section placement, MOD-on-non-int…). Implement.
- `ide-only` — needs a live build, library/device resolution, licensing, or codegen. Out of LSP scope; documented so the gap is intentional, not forgotten.
The rubric is applied per code during harvest and recorded in the catalog; it is the unit backlog for implementation.

### D4 — Implementation loop mirrors the existing architecture
Per `checkable` code: a check module `(ctx, out) => void` under `checks/<group>/`, registered in `diagnostics.ts`; wording added to `messages.ts` (per-vendor); a colocated repro test (red before, green after); FP-prone → an opt-in `LintConfig` flag (default off, like `unknownType`/`unknownAttribute`). The corpus zero-FP gate runs every batch and must stay green.

### D5 — Conformance via the EXISTING per-vendor harness (`test/conformance/`), not a new runner
There is already a live-IDE conformance mechanism and we REUSE it rather than build a parallel one: `test/conformance/fixtures/*.ts` export `LanguageTest[]`; `scripts/record-language.ts` (`bun run record:language`) pushes each fixture to the live IDE and records the compiler's diagnostics into `recordings/expected-codesys.json` (`:8556`) and `expected-tc.json` (`:8555`); `replay.test.ts` runs the LSP over the same source and passes ONLY when the LSP message set is byte-identical to the recorded IDE set (per vendor). The bridge `/build` returns vendor-normalized `{severity, message, line, object, section}` — the `message` is exactly what the LSP emits, so it IS the authoritative `expect`.

Integration: every code we implement/reconcile gets a `LanguageTest` fixture in `test/conformance/fixtures/` (a new `error-catalog.ts` category), so it is recorded against BOTH IDEs and enforced byte-identical there. A fixture's `source` must be reshaped to the harness's model — a `LANG_`-prefixed POU plus a `plcPrgVar`/`plcPrgBody` instantiation so TC actually analyzes it (the harvested `PROGRAM PLC_PRG` repros are drafts that must be adapted). The `src/reference/error-catalog.json` + its offline test remain the coverage CHECKLIST; the conformance fixtures are the live-IDE PROOF. `verified` flips per vendor when a recording exists; unrecorded stays `PROVISIONAL`. Where a vendor does not emit a code, the recording captures that fact (some codes are CODESYS-only).

### D2b — Fixtures mirror the docs' own examples (supersedes "author our own repro")
The docs already provide the exact repro (the "Example of the error:" block) and its correction ("Example of an error correction:"). We mirror those as the test fixtures — the error example is the negative-test input, the correction is the positive-test input (compiles clean). These are functional test fixtures (input code → compiler output), captured as data, not the pages' prose. The bulk harvest is reliable for messages but LOSSY for multi-object code (it dropped units + `END_` keywords, e.g. C0565), so a harvested repro is a DRAFT: finalize a well-formed, harness-shaped repro per code at implementation time and let the live recording lock its wording.

### D6 — `Cnnnn` as diagnostic metadata
Attach the mirrored code via the LSP diagnostic's `data`/`codeDescription` (href to the CODESYS doc URL), keeping our own `code` in the `volt-lsp-iec` namespace. Enables a future hover/code-action that links the canonical explanation without over-promising 1:1 parity.

### D7 — Checks are core-path, parse-once; two infra unlocks gate the rest (added 2026-07-09)

Verified during implementation that each catalog check is **first-class**, not a side-channel: it is registered
in the `CHECKS` array, runs inside `computeSemanticDiagnostics`, and is consumed by `server/diagnostics.ts`
`documentDiagnostics` — the ONE function feeding both the push (`publishDiagnostics`) and pull
(`textDocument/diagnostic`) transports. So a catalog check reaches the editor exactly like every other
diagnostic, config-aware (vendor / dead-code / references) with wording centralized per-vendor in `messages.ts`.

**Parse-once.** The multi-check registry means ~15 checks each iterate `bodies()` → `parseStatements(body)`.
`parseStatements` is now memoized on `BodySpan` identity (immutable per parse; a document re-parse yields fresh
spans, old entries GC'd), so a POU body is parsed once per diagnostic run, not once per check. This is what
keeps "add another check" cheap and makes the registry model actually optimal rather than O(checks) re-parses.

**Two infra unlocks, justified by the triage's own bar.** Three clusters (C0062, CASE-non-const, aggregate-init)
hit the same wall: a slice of the nominally-"clean-ast" tier is actually blocked on missing infrastructure. Per
"build the resolver when the family is ≥3–5 codes," two pieces are now warranted and scheduled as their own
units (tasks §7.4/§7.5), NOT worked around with fragile token-peeking (which the corpus gate rejects anyway):

1. **Aggregate initializer-list parser — LANDED.** `AggregateInit` was deliberately opaque tokens (`ast.ts`:
   "per-field grammar is deferred"). Rather than replace `.tokens` (the formatter round-trips them), we ADDED
   `form` (array/struct/unknown) + a parsed `elements` list (scalar / nested / field / repeat), keeping `tokens`.
   `parseAggregate` (in `expression.ts`) is total and error-tolerant — an unclassifiable element degrades to
   `unparsed` and an unknown outer shape to `form: "unknown"`, so checks skip rather than false-positive. C0074
   and C0076 migrated off token-poking onto `form`; **C0075 (count) is implemented** on it; **C0232 (nesting) /
   C0233 (per-element type)** are now cheap follow-ons. Pure syntax, corpus-verified zero-FP.
2. **Symbol-constancy / enum-member resolver** — an enum member and a `VAR CONSTANT` are valid where a constant
   is expected but don't uniformly read as "constant" in the symbol model, so "folds to a constant?" ≠ "is a
   constant". Unblocks C0062, C0218, and the const-context codes. This is a genuine gap the fragile heuristics
   only papered over (207 corpus FPs on C0218).

The discipline that keeps this honest: build a cluster, let the corpus gate demote the members that need infra,
ship the solid subset, and record the blocker in the deferred code's `note` + `TRIAGE.md`.

## Risks / Trade-offs

- **Harvest volume (220 pages) / rate-limits** → batch fetches, cache, and make the harvest resumable (skip codes already in the catalog); it is a one-time cost.
- **Library-floor FPs re-appear** (many type/name codes are only zero-FP with full signatures) → default those codes to opt-in lints; the corpus gate is the backstop. Solving the library floor (loading signatures) is tracked separately and would let several opt-in codes graduate to always-on.
- **Provisional wording drift across CODESYS versions** → the catalog records the version; `verified` is per-vendor and re-recordable; our `code` namespace is stable regardless.
- **Over-scoping** → the change explicitly lands catalog + triage + first batch only; remaining `checkable` codes are follow-on units, each independently shippable.
- **Copyright** → extraction limited to functional facts + our own repros; no prose reproduced.

## Open Questions

- Exact catalog file shape (`errors.json` + thin TS wrapper vs. a hand-maintained TS module) — settle at D1 implementation; both satisfy the spec.
- Whether to record conformance in this change or defer to when the user's live IDEs are available (the recording step needs `:8556`/`:8555` running); until then messages ship `PROVISIONAL`.
- First-batch selection: propose the highest-value zero-FP codes (constant-range C0001, literal/type-suffix C0032 family gaps, and confirming C0077 unknown-type = the check just built).
