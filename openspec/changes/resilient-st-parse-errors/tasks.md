# Tasks — resilient ST parse-error diagnostics

**Status (2026-07-10): Phase 1 + Phase 2.4 SHIPPED — statement syntax errors now surface with precise spans.**
Open: Phase 2.1–2.3 (resilient multi-error recovery — the parser currently reports the first error per body),
Phase 3 (declaration-layer resilience — the "unterminated <unit>" class), Phase 4 (per-code CODESYS wording +
`Cnnnn` mapping via the live recorder). All guardrails green (incl. a perf bug this validation surfaced — see §5.3).

Grounding (measured 2026-07-10): statement parser produces `firstError:"expected THEN in IF, got identifier
'x'"` for a missing `THEN` (discarded today); corpus completeness = **1938/1938 ST bodies parse with zero
errors (100%)**, so surfacing is zero-FP on known-good code. Probe: `scratchpad/measure-parse.ts`.

## 1. Phase 1 — surface statement-parse errors, gated (zero-FP by measurement)

- [x] 1.1 `parseStatements` now exposes `errors: readonly ParseError[]` (stops discarding — the `Cursor`
  already collected them). `ok`/`firstError` kept for existing callers (back-compat). `statements.ts`.
- [x] 1.2 `checkParseErrors` (`checks/syntax/parse-errors.ts`) maps recorded parse errors → `DiagnosticItem`
  (`code:"syntax-error"`, precise span). Chose the **check-pipeline** integration over a separate producer —
  it inherits the corpus gate + both LSP transports + dead-member filtering for free. Phase-1 conservatism:
  only *recorded* `expect*` errors are surfaced, not the "stopped, no recorded error" fallback.
- [x] 1.3 **Check REGISTERED and shipping (2026-07-10)** — 2.4 closed the gaps, both gates green, so
  `checkParseErrors` is live in `CHECKS`. Wording is the parser's own (`expected THEN in IF, got identifier
  'x'`) under `code:"syntax-error"`; routing through `messages.ts` + per-code `Cnnnn` mapping (C0006/C0011/…)
  is deferred to phase 4 (needs the resilient-recovery structured errors to key wording on, and the live
  recorder to settle each string). The precise span + which-token — the IDE-parity-hard part — ships now.
- [x] 1.4 The check-pipeline integration IS the gate: `corpus-fp.ts` / `corpus.test.ts` (checks) and
  `replay.test.ts` (conformance) both run `computeSemanticDiagnostics`, so registering `checkParseErrors`
  auto-subjects it to both zero-FP oracles. Colocated mechanism test (missing THEN / FOR-init / valid ST).
- [x] 1.5 **GATE FINDING (2026-07-10): the check is NOT registered yet — the conformance gate is RED.** Corpus
  (1938 bodies) is clean, but the conformance set (a larger, live-recorded oracle) caught **2 grammar gaps** —
  valid CODESYS ST our expression parser rejects:
  - **partial variable access** `dwSource.%W1` / `.%B3` / `.%X0` / `.%D0` → our `parsePostfix` errors
    `expected member name after '.'`. (`operand_partial_word_in_dword`)
  - **typed char literal** `UCHAR#'A'` → the lexer emits `#` as `unknown`, so `parsePrimary` stops early.
    (`operand_uchar_literal`)
  Both are CODESYS-only extensions (TC rejects them too), but CODESYS accepts them, so our error is a genuine
  FP. **This is the gate working as designed** — surfacing must not ship until the grammar is complete. These
  become Phase-2 grammar-completion work (§2.4). The check + exposed errors are landed and tested (mechanism
  green); registration is one line, gated on 2.4.

## 2. Phase 2 — resilient statement recovery (IDE-quality)

- [~] 2.1 **Finding: statement-LIST-level skip-recovery is the WRONG tool — it cascades.** Tried it first
  (recover to a `;`/statement-starter/block-closer sync set + progress guard). It made the common case *worse*:
  on a missing `THEN`, `parseIf` bails and dumps the IF body + `END_IF` back to the list, which mis-parses them
  into a spurious 2nd error (`expected ';' … got end of input`). Reverted. The right technique is per-construct
  **missing-token insertion** (2.2), not list-level token-skipping.
- [~] 2.2 **Missing-token insertion — PROVEN on IF/THEN (the highest-value case).** `parseIfBranch` now records
  an absent `THEN` (`cur.expectKeyword` without bailing) and parses the body anyway, so the IF consumes its
  `END_IF`: **one error in → one error out, no cascade**, AND subsequent errors in the same body now surface
  (multi-error). Verified: `IF b\n x:=9;\nEND_IF` → exactly `[expected THEN…]`; a 2nd error after the IF also
  surfaces; valid IF stays silent; corpus 100%-materialize + conformance + fuzz all green (valid code takes the
  identical path). **Follow-on (mechanical, same pattern):** apply insertion to `CASE`'s `OF`, `FOR`'s
  `TO`/`DO`, `WHILE`'s `DO`, `REPEAT`'s `UNTIL`, and the block closers (`END_IF`/`END_CASE`/… → record + return
  the node), validating each against the gates. The *unexpected-tokens* error node (skip-and-wrap) is still open.
- [ ] 2.3 Multi-error per body + a per-body diagnostic cap (match IDE). Extend the fuzz test to assert
  termination + bounded diagnostics (every recovery step consumes ≥1 token).
- [x] 2.4 **Grammar completeness — DONE (2026-07-10); unblocked the ship.** Closed the two conformance-gate
  gaps: **partial variable access** `x.%W1`/`.%B3`/`.%X0`/`.%D0` in `parsePostfix` (recombines the lexer's
  `. % <spec>` into one member named `%<spec>`; member-resolution checks already only fire on struct/FB bases,
  so an elementary base's slice selector is never re-flagged — no C0004 FP, confirmed by the corpus gate);
  **typed char/string literals** `UCHAR#'A'` in the lexer (an identifier + `#` + a quote is unambiguously a
  typed literal → one `typed_lit` token). Colocated parser tests + regression guard in `parse-errors.test.ts`.
  Re-ran BOTH gates: corpus "No false positives", conformance 253/283 with zero LSP-only FPs. No further gaps
  surfaced in either oracle → `checkParseErrors` registered. (Phase 2.1–2.3 resilient multi-error recovery is
  still open — this delivered the *completeness* half that gates surfacing; the current parser reports the
  first error per body, which is enough to ship precisely.)

## 3. Phase 3 — declaration-layer resilience

- [ ] 3.1 Apply the same recovery to the unit/VAR-section/type-decl parsers so "unterminated `<unit>`" fires
  only for a genuinely unterminated unit. Land C0173/C0189/C0190/C0211/C0212/C0213/C0215/C0221.
- [ ] 3.2 The reported example (`IF` missing `THEN` *and* no `END_PROGRAM`) reports the precise `THEN` error,
  not the misleading `unterminated program`.

## 4. Phase 4 — wording reconciliation

- [ ] 4.1 Live-record each new parser code against `:8556`/`:8555`; flip `verified`; settle CODESYS-exact
  strings; hook `codeDescription` URLs. Update TRIAGE.md (parser bucket shrinks) + supersede the `st-body-ast`
  D3 note (record, don't delete).

## 5. Guardrails (every phase)

- [x] 5.1 `bun typecheck` + `bun test src/analysis src/reference src/syntax` green (Phase 1 + 2.4).
- [x] 5.2 Corpus zero-FP gate (checks AND parse errors) + conformance replay green. Full `corpus.test.ts`
  8/8 pass at its original 120s budget; `corpus-fp.ts` "No false positives"; conformance 253/283, zero
  LSP-only FPs.
- [x] 5.3 No performance regression — and, in fact, **fixed a pre-existing O(n²) one that validating this
  change surfaced.** Running the full (rarely-run, 545s) `corpus.test.ts` showed 2 "failures" that were really
  120s TIMEOUTS (the assertion never ran; `corpus-fp.ts` has no timeout so it stayed green — that divergence
  was the tell). Per-check profiling (new env-gated `PROFILE_CHECKS=1` hook in `diagnostics.ts`) traced 84.8%
  of all check time to `checkDataRecursion` rebuilding the whole-project composition graph **per file**. Fixed
  by memoizing the graph on `Scope` identity (commit `6e905526`): checks 7.3x faster (47s→6.5s), full corpus
  test 236s→76s, back under the original budget. Lesson recorded: a timeout is a bug, not a budget — root-cause
  it, don't raise it. (Orthogonal to parse errors; committed as its own `perf(lsp)` fix.)
