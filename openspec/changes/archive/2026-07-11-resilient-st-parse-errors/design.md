# Design — resilient ST parse-error diagnostics

## Context — what the parser actually does today (measured)

`volt-lsp-iec` has a **two-layer** parser:

1. **Unit layer** (`src/syntax/units/*`, `parser.ts`) — parses POU/DUT headers + VAR sections, then captures
   each body as an **opaque `BodySpan` of tokens** up to the matching `END_*`. Its only body-level error is
   "unterminated `<unit>`: expected `END_*`". It never inspects statement structure.
2. **Statement layer** (`src/syntax/statements.ts` + `expression.ts`) — a full recursive-descent parser for
   the ST statement/expression grammar (`IF/CASE/FOR/WHILE/REPEAT/__TRY`, assignments incl. `S=`/`R=`/`REF=`
   and chained `:=`, calls, all operators). Run **on demand** by consumers (checks, nav, folding, formatting)
   via `parseStatements(body)`.

The statement parser's `Cursor` already has the recovery primitives: `expect*` records a precise diagnostic
(`expected THEN in IF, got identifier 'x'`), and `recoverTo({keywords, puncts})` is panic-mode
synchronization. `parseIfBranch` literally calls `expectKeyword("THEN", "in IF")`.

**The gap is policy, not capability.** `parseStatements`'s contract (statements.ts:5–9, 26–27):

> on any unexpected/unmodeled token it stops and returns `ok:false`, WITHOUT throwing and WITHOUT emitting a
> diagnostic … `firstError` is for corpus triage only — **never surfaced to the user**.

So the precise message is computed and thrown away. Two measurements settle the design:

- **Missing `THEN` in a well-terminated POU** → unit errors `[]`, statement parse `ok:false`,
  `firstError:"expected THEN in IF, got identifier 'x'"` (discarded). Net user-visible diagnostics: **none**.
- **Corpus completeness** → `parseStatements` over every ST body: **1938/1938 (100%) parse with zero errors.**

### Why D3 swallowed errors, and why that changes now

D3's fear was **false positives from an incomplete grammar**: if the parser doesn't model some valid ST
construct, `ok:false` is a *parser bug*, and surfacing "expected X" would redline valid code — violating the
zero-FP invariant and `[[feedback-no-fallbacks-single-source]]`. That was the right call when completeness was
unmeasured. It is now measured (100% on the corpus), and — critically — it can be *gated*: treat a
statement-parse error on clean corpus/conformance code exactly like a check false-positive today (a CI
failure to fix), so the grammar can evolve without regressing. The invariant is preserved, not weakened.

## Goals / Non-Goals

**Goals**
- Surface statement- and declaration-level **syntax** errors as diagnostics with a precise span + message.
- Best-practice **resilient parsing**: one mistake → one diagnostic, tree still built, no cascade.
- Preserve zero-FP via a permanent grammar-completeness gate (corpus + conformance).
- Map each surfaced error to its CODESYS `Cnnnn` as metadata; retire most of the `parser` triage bucket.

**Non-Goals**
- Reproducing every byte of CODESYS's recovery wording on day one (PROVISIONAL until the live recorder
  settles each; the *span + which-token* is the hard part and we already have it).
- Changing statement **semantics** ownership — type/flow/overload resolution stays the IDE's job. This is
  syntax structure the parser already decides.
- Rewriting to a lossless/CST parser (rowan-style). We keep the existing AST; resilience is added in place.

## Best-practice basis (not invented — the established techniques)

Error-tolerant recursive-descent parsing is well-trodden. The design follows these references:

- **Resilient LL parsing** (Alex Kladov / matklad, 2023; the rust-analyzer approach) — the modern canonical
  guide. Key ideas adopted: *never bail the whole input*; on error, either **insert a missing node** or
  **skip unexpected tokens into an error node**; recover using the enclosing constructs' **follow sets**;
  every node is always produced so downstream tools keep working.
- **Roslyn** (the C# compiler) — *missing tokens* (zero-width synthesized tokens carrying the "X expected"
  diagnostic) and *skipped-tokens trivia*; a single malformed construct yields one diagnostic and a complete
  tree. We mirror the two-diagnostic-kinds model (missing vs unexpected).
- **Microsoft Tolerant PHP Parser** — its design notes on error-tolerant parsing for IDE tooling (produce a
  tree for *any* input; attach errors to nodes).
- **tree-sitter** — `MISSING` / `ERROR` nodes; recovery bounded to the smallest enclosing construct.
- **Dragon book** (Aho/Lam/Sethi/Ullman) — the classic taxonomy: **panic-mode** recovery with
  **synchronization sets** and **phrase-level** recovery. Our `Cursor.recoverTo` is already panic-mode; we
  make the synchronization sets per-construct and principled.

Distilled into rules this parser will follow:

1. **A parse never fails to produce a node.** `parseStatement`/branch parsers return a node in *all* cases —
   on error they emit a diagnostic and return an `error`/partial node, never `undefined`-that-breaks-the-list.
2. **Two diagnostic kinds.** *Missing token* (`'THEN' expected …`, zero-width span at the insertion point)
   and *unexpected tokens* (skip to the recovery set, one diagnostic covering the skipped span).
3. **Per-construct synchronization sets.** Each block parser carries its recovery anchors: statement level →
   `{ ; , statement-starter keywords, all block closers }`; inside `IF` → `{ THEN, ELSIF, ELSE, END_IF }`;
   inside `CASE` → `{ : , OF, ELSE, END_CASE }`; etc. Recovery skips to the nearest anchor, then resumes.
4. **Bounded blast radius.** A missing `THEN` recovers at the branch body and still consumes `END_IF`; a bad
   statement recovers at the next `;`/statement-start. Errors don't propagate to the enclosing unit.
5. **Cap the diagnostics per body** (e.g. first N, matching IDE behavior) so a pathological body doesn't spray.

## Decisions

### D1 — Surface via a dedicated diagnostic step, gated by completeness
Add a `computeParseDiagnostics(body)` producer (in `src/analysis`, joined into the existing
`server/diagnostics.ts` path alongside `parseResult.errors` and semantic checks). It runs `parseStatements`
and turns recorded parse errors into `DiagnosticItem`s (`source:"volt-lsp-iec"`, own `code`, mapped `Cnnnn`
metadata). It is **guarded** by the completeness gate (D3): because the corpus is 100% clean, it ships zero
FPs on day one.

### D2 — Resilient recovery in `statements.ts` (the core work)
Refactor `parseStatementList`/`parseStatement`/`parseIfBranch`/`parseCase`/… from "return `undefined` →
`break`" to "diagnose + recover-to-sync-set + continue". Keep the `BodyParse` shape but replace the single
`firstError` with the full `errors: ParseError[]` (already collected on the `Cursor` — just stop discarding
them). `ok` stays `errors.length === 0 && atEof()` for existing consumers (fallback behavior unchanged when
callers only read `ok`).

### D3 — The completeness gate is the zero-FP guard (load-bearing)
`corpus.test.ts` and `test/conformance/replay.test.ts` gain an assertion: **zero** statement/declaration
parse errors on their (clean) inputs. A new grammar gap → red CI, fixed by extending the grammar, never by
suppressing the diagnostic. This is the exact discipline that protects the checks, applied to parsing. It is
what makes reversing D3 safe.

### D4 — Declaration-layer resilience (phase 2)
Give the unit/VAR-section parsers the same treatment so "unterminated program" only fires for a *genuinely*
unterminated unit, and C0173/C0189/C0190/C0211/C0212/C0213/C0215/C0221 get precise messages. This also fixes
the reported example fully (the repro had *both* a missing `THEN` and no `END_PROGRAM`; today only the latter
is reported, and misleadingly).

### D5 — Message wording: PROVISIONAL, catalog-mapped, recorder-settled
Route wording through `messages.ts`; attach the `Cnnnn`. The *span and which-token* (the genuinely hard,
IDE-parity part) we already have; the exact string is PROVISIONAL until the live recorder locks it — same
lifecycle as every other catalog code.

## Phased plan (each phase independently shippable + gated)

- **Phase 1 — surface, gated (small, high value).** `computeParseDiagnostics` + wire into
  `server/diagnostics.ts` + completeness gate. Stop discarding `Cursor` errors in `parseStatements`. Fixes the
  well-terminated-POU case immediately, provably zero-FP. Lands C0006/C0011/C0013/C0015/C0020/C0026/C0027/
  C0030/C0031 wording as the parser already phrases them (PROVISIONAL).
- **Phase 2 — resilient statement recovery.** Per-construct sync sets + missing/error nodes + multi-error +
  cap. IDE-quality precision and multiple errors per body.
- **Phase 3 — declaration-layer resilience.** Unit/VAR-section recovery; retire the "unterminated" mislabel;
  land C0173/C0189/C0190/C0211/C0212/C0213/C0215/C0221.
- **Phase 4 — wording reconciliation.** Live-record each new code, flip `verified`, settle CODESYS-exact
  strings, hook `codeDescription` URLs.

## Risks

- **Hidden grammar gaps outside the corpus** → a real FP in the wild. Mitigation: the completeness gate over
  corpus + the (larger, live-recorded) conformance set; ship Phase 1 behind the gate; expand the corpus when a
  gap is found (same loop as check FPs).
- **Recovery loops / non-termination** on adversarial input. Mitigation: the existing fuzz test
  (`parseStatements never throws on mutated bodies`) is extended to assert *termination + bounded diagnostics*;
  every recovery step must consume ≥1 token.
- **Performance** — parsing every body eagerly for diagnostics. Mitigation: `parseStatements` is already
  memoized per `BodySpan`; the checks already parse every body, so the marginal cost is ~zero.
