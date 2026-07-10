# Tasks — resilient ST parse-error diagnostics

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
- [ ] 1.3 Route wording through `messages.ts` (per-vendor, PROVISIONAL); map to catalog codes C0006/C0011/
  C0013/C0015/C0020/C0026/C0027/C0030/C0031 and flip their `status`/`triage`. **Blocked on 1.5.**
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

- [ ] 2.1 Per-construct synchronization sets (statement level, IF, CASE, FOR/WHILE/REPEAT, __TRY) — encode the
  recovery anchors; `parseStatement*` diagnose + `recoverTo(sync)` + continue instead of `return undefined`.
- [ ] 2.2 Two diagnostic kinds: *missing token* (zero-width span at insertion point) and *unexpected tokens*
  (one diagnostic over the skipped span, wrapped as an error/partial node). Every parser returns a node.
- [ ] 2.3 Multi-error per body + a per-body diagnostic cap (match IDE). Extend the fuzz test to assert
  termination + bounded diagnostics (every recovery step consumes ≥1 token).
- [ ] 2.4 **Grammar completeness (unblocks 1.3/1.5 — the ship gate).** Parse the valid CODESYS forms the
  conformance gate flagged, so surfacing ships zero-FP: **partial variable access** (`.%X`/`.%B`/`.%W`/`.%D<n>`)
  in `parsePostfix` — AND make the member downstream-aware (like the existing numeric bit-access special-case)
  so member-resolution checks (C0004) don't re-flag it; **typed char literals** (`UCHAR#'A'`) in the lexer's
  typed-literal rule (currently `TYPE#<number>` only). Re-run BOTH gates; register `checkParseErrors` when
  green. Expect the gate to surface further gaps — each is a grammar fix, never a suppression.

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

- [ ] 5.1 `bun typecheck` + `bun test src/analysis src/reference src/syntax` green.
- [ ] 5.2 Corpus zero-FP gate (checks AND parse errors) + conformance replay green after each phase.
- [ ] 5.3 No performance regression (parseStatements already memoized; checks already parse every body).
