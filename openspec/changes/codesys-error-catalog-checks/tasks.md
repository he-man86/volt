## 0. Status matrix (updated 2026-07-09)

**103 / 220 implemented** — each a registered check in `src/analysis/checks/**`, emitting through the core
`computeSemanticDiagnostics` → server `documentDiagnostics` path (both push + pull LSP transports), central
per-vendor `messages.ts`, corpus zero-FP gate green. All wording `PROVISIONAL` until the §4 live recording.

**Audit (2026-07-09) — no mess, everything mirrors CODESYS.** A full sweep of `src/analysis` found: 0 dead/
unregistered checks (all 32 registered), 0 colliding codes (no two checks share a diagnostic `code`), 0 double-
firing on overlapping inputs (subrange / constant-overflow / binary-op / narrowing each fire alone), 0 unused
message builders (55/55 used). Every check emits a genuine CODESYS message — none invents a "stricter than
CODESYS" diagnostic (the product mirrors CODESYS+TC, it is not a better checker). The pre-catalog checks are
distinct, corpus-validated coverage, NOT duplicates — so the cleanup was **reconciliation, not removal**:
- Flipped 6 pre-existing checks to their codes with our live-calibrated wording: **C0081** (pragmas, lowercase
  "pragma"), **C0195/C0196/C0197** (narrowing/sign, "Possible"), **C0208** (binary-op MOD, two-var repro),
  **C0351** (unknown-attribute, opt-in lint, double-space quirk).
- `conversion` + `subrange` emit the **C0032** message (already mapped) — additional "Cannot convert"
  contributors, no separate code.
- Remaining unmapped (real CODESYS behaviour, per-case reconciliation pending, **NOT removable**):
  `call-arguments` (fires on FB *and* function calls — C0040 wording is function-only, FB over-args is a
  different code), `abstract-instantiation` (→ C0511/C0573, needs a triggering repro), and the
  unterminated-`{IF}`-pragma message (live-calibrated but CODESYS assigns it no distinct `Cnnnn`). None of these
  invents a non-CODESYS diagnostic — so the mirror principle holds; only the code-linking is incomplete.

| Code | Check module | Our code | Notes |
|------|--------------|----------|-------|
| C0001 | types/constant-overflow | constant-too-large | zero-FP provable-overflow subset |
| C0003 | types/bit-number | invalid-bit-number | int/bit-string base only |
| C0032 | types/assignment | (cannotConvert) | pre-existing |
| C0018 | flow/statement-rules | not-assignment-target | write to a `VAR CONSTANT` — via `constancyOf` |
| C0004 | names/unresolved-identifier | unknown-member | member not a component of a struct (reconcile) |
| C0033 | types/pointer-conversion | pointer-not-convertible | pointer → non-pointer (WARNING) |
| C0037 | calls/call-arguments | unknown-named-argument | `name := value` naming no input of the callee (reconcile; wording aligned to CODESYS) |
| C0038 | calls/call-arguments | unknown-named-output | `name => target` binding naming no output of the callee (split by `arg.output`) |
| C0041 | calls/call-arguments | in-out-needs-writable | VAR_IN_OUT bound to a provably-constant arg (needed `CalleeInfo.positional`, inOut-tagged) |
| C0039 | calls/call-arguments | in-out-not-assigned | a VAR_IN_OUT left unbound in a call (coverage: positional-by-index / named-by-name; non-mixed, complete) |
| C0201 | calls/call-arguments | in-out-type-mismatch | a VAR_IN_OUT bound to a non-identical type (exact match required; both-elementary subset) |
| C0224 | calls/recursive-call | call-recursion | a FUNCTION that calls itself (direct self-recursion; `recursive` attr not on AST but corpus has none) |
| C0040 | calls/call-arguments | function-argument-count | function/method too-many-positional (reconcile — split the shared arity check by callee kind) |
| C0044 | calls/call-arguments | input-assignment-missing | FB too-many-positional (reconcile — replaced the unmapped `tooManyArguments` message) |
| C0045 | flow/this-super-context | this-not-allowed | `THIS` in a PROGRAM/FUNCTION |
| C0061 | types/bit-number | bit-access-on-call | bit access on a function-call result |
| C0068 | types/comparison | compare-array | relational op on an array (same-type) |
| C0069 | types/comparison | compare-array-mismatch | relational op on two different arrays |
| C0046 | names/unresolved-identifier | unresolved-identifier | cascade trimmed to primary msg |
| C0048 | types/indexing | array-index-count | array indexed with wrong number of indices |
| C0140 | types/reference-assign | reference-assign-target | `REF=` to a non-reference target |
| C0142 | names/duplicate-declaration | duplicate-declaration | duplicate local variable (reconcile; docs expect was truncated) |
| C0070 | calls/intrinsic-operands | ini-needs-instance | `INI(x,…)` where x isn't an FB/DUT instance |
| C0072 | calls/intrinsic-operands | operator-not-possible | math op (`ABS`/`SQRT`/…) on a non-numeric type — unshadowed, KNOWN-non-ANY_NUM only |
| C0143 | oop/property-access | property-lacks-getter | reading a set-only property (member access; read = not-the-assign-target) |
| C0130 | oop/method-reference | method-referenced-without-parens | method member used as a value (member access; called = not-a-call-callee) |
| C0087 | oop/interface-implementation | missing-interface-implementation | FB missing an implemented interface method (reconcile) |
| C0091 | oop/inheritance | circular-inheritance | FB that EXTENDS itself |
| C0090 | oop/inheritance | base-class-not-found | `EXTENDS <name>` resolving nowhere (reuses `nameResolves`; library FBs skipped) |
| C0086 | oop/inheritance | interface-not-found | `IMPLEMENTS <name>` resolving nowhere (reuses `nameResolves`; library FBs skipped) |
| C0097 | oop/inherited-variable | duplicate-inherited-variable | derived FB var name colliding with a base FB var (walks EXTENDS chain; project bases only) |
| C0101 | types/data-recursion | data-recursion | FB/struct transitively containing an instance of itself (composition graph; arrays nest, pointers break) |
| C0124 | types/enum-init | enum-init-not-convertible | enum member with a real initializer (constEval: real→number, int→bigint) |
| C0228 | declarations/constant-initializer | constant-no-initial-value | elementary `VAR`/`VAR_GLOBAL CONSTANT` with no init (VAR_INPUT + composite excluded — both default-init) |
| C0354 | types/comparison | enum-comparison | comparison of two different enum-typed operands (preempts generic C0066) |
| C0047 | types/indexing | indexing-non-array | strings/pointers excluded |
| C0049 | types/array-bounds | array-index-out-of-bounds | exact flip |
| C0064 | types/deref | deref-non-pointer | ⚠ docs "Dereferencing" vs ours "Dereference" — settle at §4 |
| C0066 | types/comparison | incompatible-comparison | reuses `classifyConversion` |
| C0074 | types/array-init | unexpected-array-init | `[…]` on non-array (parser `form==="array"`) |
| C0075 | types/array-init | array-init-count | too many values (single-dim, repeats expand) — via the aggregate parser |
| C0076 | types/struct-init | unexpected-struct-init | `(field:=…)` on elementary |
| C0077 | names/unknown-type | unknown-type | pre-existing (opt-in lint) |
| C0080 | calls/fb-instantiation | fb-not-instantiated | FB called by type name (project FBs only) |
| C0122 | flow/this-super-context | super-not-allowed | `SUPER` in a PROGRAM/FUNCTION |
| C0126 | types/indexing | pointer-index-arity | pointer indexed with a count ≠ 1 |
| C0131 | calls/intrinsic-operands | invalid-adr-operand | `ADR(<literal>)` — a literal has no address |
| C0139 | flow/no-op-statement | no-op-statement | statement expression with no effect (WARNING) |
| C0119 | oop/lifecycle | fb-lifecycle-signature | malformed `FB_Init` signature (reconcile; docs = TC form) |
| C0120 | oop/lifecycle | fb-lifecycle-signature | malformed `FB_Exit` signature (reconcile; docs = TC form) |
| C0132 | flow/statement-rules | exit-outside-loop | `EXIT` with no enclosing loop |
| C0161 | declarations/const-context | array-bound-non-const | non-constant array bound — via `constancyOf` |
| C0162 | types/array-init | array-init-count-non-const | repeat count `n(v)` is a variable — via `constancyOf` |
| C0168 | declarations/var-section-placement | misplaced-var-config | `VAR_CONFIG` block in a POU |
| C0169 | declarations/var-section-placement | var-section-placement | `VAR_GLOBAL` outside a GVL (reconciled to our wording) |
| C0174 | declarations/var-section-placement | var-section-placement | `VAR_TEMP` in a METHOD (reconciled; FUNCTION is allowed) |
| C0175 | declarations/var-section-placement | retain-not-allowed | `VAR RETAIN`/`PERSISTENT` in a FUNCTION/METHOD |
| C0177 | declarations/non-instantiable | not-instantiable | variable declared with a FUNCTION type |
| C0198 | types/string-constant | string-constant-too-long | string literal longer than `STRING(n)` (`$`-escape aware) |
| C0199 | calls/fb-instantiation | interface-not-instantiated | interface called by type name |
| C0565 | oop/lifecycle | fb-lifecycle-signature | malformed `FB_Exit` signature (reconcile; same rule as C0120) |
| C0509 | flow/statement-rules | multiple-assignment-new | `__NEW` in a chained assignment |
| C0203 | declarations/bit-usage | bit-wrong-container | `BIT` var in a PROGRAM/FUNCTION/METHOD |
| C0204 | declarations/bit-usage | bit-wrong-block | `BIT` var in a disallowed VAR block |
| C0205 | declarations/bit-usage | pointer-to-bit | `POINTER TO BIT` |
| C0206 | declarations/bit-usage | bit-array-base | `ARRAY OF BIT` |
| C0355 | calls/intrinsic-operands | adr-on-bit | `ADR` of a BIT var (WARNING) |
| C0227 | declarations/const-context | const-init-non-const | `VAR CONSTANT` init is a variable — via `constancyOf` |
| C0526 | declarations/const-context | default-not-constant | `VAR_INPUT` default is a mutable variable (zero-FP slice; call defaults skipped) |
| C0242 | calls/intrinsic-operands | delete-non-pointer | `__DELETE(x)` where `x` is not a pointer |
| C0216 | flow/case-labels | case-label-duplicate | const-eval |
| C0217 | flow/case-labels | case-label-in-range | const-eval |
| C0218 | flow/case-labels | case-label-non-const | non-constant variable label — via `constancyOf` (enums/consts quiet) |
| C0219 | flow/case-labels | case-overlapping-ranges | const-eval |
| C0222 | declarations/output-rules | output-reference-type | `VAR_OUTPUT` of `REFERENCE TO` |
| C0230 | names/type-as-value | type-name-as-value | DUT type name used as an assignment value/target |
| C0232 | types/array-init | array-init-nesting | flat scalar where a nested array is expected — via the aggregate parser |
| C0233 | types/array-init | array-init-element | scalar where a struct-init list is expected (enums excepted) — via the aggregate parser |
| C0096 | declarations/header-rules | multiple-inheritance | FB `EXTENDS A, B` (single inheritance) — parser now captures the illegal extra bases (`extendsExtra`); verified CS |
| C0182 | declarations/header-rules | return-type-not-allowed | return type on a non-FUNCTION/METHOD POU (`PROGRAM P : BOOL`) — parser captures program `returnType`; verified CS |
| C0421 | declarations/header-rules | interface-implements | INTERFACE using `IMPLEMENTS` instead of `EXTENDS` — parser captures `implementsMisused`; verified CS |
| C0550 | declarations/attribute-placement | pack-mode-not-allowed | `{attribute 'pack_mode'}` on a FUNCTION/METHOD — re-lex + leading-trivia ownership attaches the attribute to its unit; verified CS (`not allowed for '<KIND>'`, docs word-order was wrong) |
| C0566 | oop/lifecycle | fb-reinit-shape | FB_ReInit with any input or non-BOOL return; **CODESYS-only** (conformance oracle: TC silently accepts) — verified CS (real IDE ends with `!`) |
| C0089 | oop/method-signature | override-mismatch-interface | FB method's param count ≠ the interface method it implements; verified CS (`doesn't match`) |
| C0094 | oop/method-signature | override-mismatch-base | override's param count ≠ the base FB method; verified CS (`of overridden method … of base`) |
| C0568 | oop/method-signature | override-mismatch-base | same rule/wording as C0094 (two codes, one diagnostic) — verified CS |
| C0533 | oop/abstract-output-default | abstract-output-default | VAR_OUTPUT initializer in an interface/abstract method (warning); zero-FP subset = interface + explicit-`ABSTRACT` methods (implicit-abstract-FB case deferred); verified CS |
| C0022 | calls/intrinsic-operands | operator-operand-count | intrinsic operator with wrong exact operand count (`ADR`/`SIZEOF`/`SEL`); arity table corpus-validated + verified live CS |
| C0023 | calls/intrinsic-operands | operator-operand-count | intrinsic operator below its minimum operand count (`MUX`); same check as C0022, verified live CS |
| C0185 | calls/call-result-access | call-result-access | component/index/call access directly on a function-call result (`f().x`); excludes `__`-intrinsics (`__VARINFO(x).size` — conformance oracle caught the FP); verified live CS |
| C0238 | declarations/external-initializer | external-initializer | `VAR_EXTERNAL` decl with an inline initializer (value must come from the GVL); verified live CS |
| C0454 | flow/new-in-expression | new-in-expression | `__NEW` assignment-expression inside another expr (`IF (p := __NEW(T)) = 0`); offline-correct + corpus/conformance clean, but live-verify env-blocked (test project has no `__NEW` memory pool → prerequisite errors preempt it) |
| C0525 | declarations/input-default | input-default-composite | array-typed `VAR_INPUT` default — **FUNCTION-only** (corpus proved FBs/methods legitimately take array-input defaults, 64 cases; docs cause confirms "in the FUNCTION declaration"); type name from source text; verified live CS |
| C0240 | calls/intrinsic-operands | query-pointer-operand | `__QueryPointer` first operand a known elementary (not interface-ref/FB); verified live CS (`First operand` lowercase) |
| C0241 | calls/intrinsic-operands | query-pointer-operand | `__QueryPointer` second operand a known elementary (not pointer); verified live CS (real IDE says `Second operand of __QueryInterface must be a pointer` — CODESYS quirk) |
| C0373 | pragmas/pragmas | message-pragma-warning | `{warning 'text'}` echoed verbatim — free reconcile (pre-existing message-pragma check code-linked); verified live CS |
| C0098 | declarations/deprecated-keyword | deprecated-functionblock | deprecated `FUNCTIONBLOCK` spelling (re-lex token-pair scan, zero-FP); offline-correct + corpus/conformance clean, live-verify harness-blocked (lexed as identifier → not a pushable unit) |

**Tier map of the remaining 136** (full lists + reuse-clusters in `docs/codesys-reference/TRIAGE.md`):
`A · clean-ast` (cheap, no new infra) · `B · resolution-dependent` · `C · parse/decl-structure`
(parser's job, separate track) · `D · ide-only 22` (record-only, no offline check).

**Clean-code batch complete (84/220, 38.2%).** The offline-checkable, AST-present, single-message codes are
implemented. The remaining tranche is systematically gated — probing confirmed each wall:
- **Parser-track — assessed 2026-07-10 (iteration 4), NOT undertaken: the diminishing-returns frontier.** Each is
  high-effort and/or FP-prone and/or low-value, so grinding them fails the "does this need to exist" bar:
  syntax-error codes (C0002–C0031) require the parser to reconstruct CODESYS's *exact* recovery wording (e.g.
  `',' or ')' expected instead of ';'`) from its own different recovery — high effort, high FP, marginal value
  (the LSP already flags the error); jump labels (C0114/116/117/118) need a JMP/label AST for a rare, discouraged
  ST feature (corpus has none); C0065 (`.name` leading-dot) needs parser support; C0543 (reserved-word-as-ident)
  needs a curated IEC reserved list — FP-prone; C0149 (VAR in interface) — the parser emits its own recovery
  error. **Recommendation: tackle deliberately (not on the autonomous loop) if/when specific codes are prioritized.**
  Live-probed extras: `abstract-instantiation` (our check) emits the IDE-exact `Function block <X> is ABSTRACT and
  cannot be instantiated`, confirmed via live /build — but NO catalog `Cnnnn` documents it (C0511 is the distinct
  "assignment target" case), so it stays correct-but-uncodable.
- **POU-header structure — LANDED (2026-07-10).** The "attributes-on-AST" bucket split on inspection: three were
  header-shape facts the parser only needed to *capture in the illegal case*, not pragmas — **C0096** (`extendsExtra`),
  **C0182** (program `returnType`), **C0421** (`implementsMisused`), all in `declarations/header-rules.ts`, all
  verified live CS, zero-FP. The C0096 fix also repaired a real parse-corruption bug (`EXTENDS A, B` used to leak
  `, B` into the following var-sections). Still open in this bucket: **C0149** (VAR in interface — the parser emits
  its own recovery error; needs the interface parser to emit C0149 wording instead). **C0533 LANDED (iteration 4)**
  — `oop/abstract-output-default.ts`, interface + explicit-`ABSTRACT` methods, verified live CS; implicit-abstract-
  FB-method form deferred (FP-prone empty-body heuristic).
- **Pragma-attribute-on-unit — LANDED (2026-07-10, iteration 2).** `checks/declarations/attribute-placement.ts`
  re-lexes and attaches each POU-leading `{attribute '…'}` to the unit it immediately precedes (leading-trivia
  ownership the parser skips), giving **C0550** (`pack_mode` on FUNCTION/METHOD), verified live CS (the docs
  word-order was wrong: real IDE is `Attribute 'pack_mode' not allowed for '<KIND>'`). Also required a verify-
  harness fix — `splitRepro`'s `leadStart` now carries a unit's leading pragmas into the pushed item (it used to
  slice from `span.start` and drop them; this also un-masked C0351, see §4.2). **C0540** (`no_assign` propagation)
  DEFERRED: needs cross-unit type resolution (a wrapper FB whose member type is a `no_assign` FB but which isn't
  itself `no_assign`) — high FP risk, low value; revisit with the signature/type-graph infra.
- **Method-signature model — LANDED (2026-07-10, iteration 3).** `checks/oop/method-signature.ts` compares an
  overriding method against the interface/base method it overrides (methods are `method` symbols on the FB scope
  carrying their `Method` AST; interface methods are `interface_method` symbols — both expose `varSections`).
  Landed **C0089** (vs implemented interface), **C0094 == C0568** (vs base FB, one diagnostic under two codes).
  **Zero-FP subset:** compares only per-section parameter COUNTS (a legal override has an identical param list →
  identical counts, so a delta is unambiguous; same-count/different-type is deliberately not flagged yet) — corpus
  + conformance both clean. Also landed **C0566** (FB_ReInit shape) in `oop/lifecycle.ts`, **CODESYS-only** (the
  conformance replay caught a TC false positive — TC silently accepts a param'd FB_ReInit, `diagnostics: []`).
  Still open: **C0138** (no matching FB_Init at an instantiation site — needs FB_Init param↔call-arg matching,
  FP-prone), **C0243** (signature-name-vs-object-name — no repro/expect/ground truth, skip).
- **Graphical-only** (not ST): C0225 (FBD explicit FB-call typing).
- **Task/memory config** (not offline): C0102/104/164/165/398/415.
- **Unverified message / library-floor**: C0035, C0582 (no verified `expect`), C0513–517 (library access rules).

Next unlocks, in impact order: (1) **POU-header structure** → **DONE** (C0096/C0182/C0421); (2) **pragma-attribute-
on-unit** → **DONE** (C0550; C0540 deferred); (3) **method-signature model** → **DONE** (C0089/C0094/C0568/C0566;
C0138 deferred, C0243 skipped); (4) **parser syntax-error track** → **assessed & NOT undertaken** (see the
Parser-track note above — the diminishing-returns frontier: high-effort/FP-prone/low-value). Iteration 4 instead
banked **C0533** (abstract/interface VAR_OUTPUT default) opportunistically. **The clean, high-confidence, zero-FP,
live-verifiable wins are now exhausted** (93/220; the remaining ~127 are parser-recovery, task/memory config,
graphical-only, library-floor, or no-ground-truth). Further codes should be picked deliberately per-code, not
ground out on the autonomous loop.

**Deferred with recorded reason** (corpus-gate demotions + infra blockers, each carries a `note` in the catalog):

| Code(s) | Why deferred | Unblocked by |
|---------|--------------|--------------|
| C0062 | `int.name` is symbolic bit access vs struct access — needs the member resolved as a bit-alias constant | ✅ resolver landed — re-attemptable on `constancyOf` (apply to the member) |
| C0426 | CODESYS accepts empty fall-through CASE arms — not an error offline | (won't fix — reclassify) |
| C0540 | `no_assign` propagation — needs cross-unit type resolution (wrapper FB member typed as a `no_assign` FB, wrapper not itself `no_assign`); high FP risk | signature/type-graph infra |
| C0138 | "no matching FB_Init for instantiation" — needs FB_Init param↔instantiation-arg matching at the declaration site; FP-prone | FB_Init overload/arg model |
| C0243 | signature name ≠ object name — no repro/expect/ground truth to build against | (skip — reclassify if a case appears) |

**Infra unlock #1 — aggregate initializer-list parser: LANDED, and its whole family shipped.** `AggregateInit`
now carries `form` (array/struct/unknown) + a parsed `elements` list (scalar / nested / field / repeat);
`tokens` retained for the formatter's round-trip. Total & error-tolerant (unparsable → `unparsed`/`unknown`,
checks skip → 0-FP). It unblocked and landed **C0075, C0232, C0233** (and migrated C0074/C0076 off token-poking
onto `form`) — the entire aggregate-init cluster is now done. C0162 (repeat-count const) is reachable next.
See design D7 / task §7.4.

**Infra unlock #2 — symbol-constancy / enum-member resolver: LANDED.** `constancyOf(expr, scope)` in
`const-eval.ts` answers what `constEval` can't — it returns `constant | variable | unknown`, keyed on the symbol
**kind** (`enum_value` → constant) and the `CONSTANT` flag, with library/unresolved → `unknown`. Checks flag only
`variable`. This is the missing signal the earlier `constEval`-only C0218 lacked (it checked the `constant` flag
but not the `enum_value` kind → 207 FPs). Implemented **C0162** (repeat count) and re-enabled **C0218** (CASE
label) on it — corpus zero-FP. C0062 (bit-access disambiguation) is now re-attemptable (apply `constancyOf` to
the member name — a constant member is a bit-alias, not a struct access).

**Architecture integration (verified first-class, not bolted on):**
- Checks run in the real LSP path (`server/diagnostics.ts` → both transports), config-aware (vendor / dead-code /
  references), wording centralized per-vendor. ✅
- **Parse-once fix landed:** `parseStatements` is now memoized on `BodySpan` — the ~15 checks that iterate
  `bodies()` no longer re-parse each POU body per check (was O(checks) re-parses per file). ✅
- **Quick-fixes:** `code-actions.ts` `FIXABLE` currently covers only `assignment-type-mismatch` /
  `narrowing-conversion`; the new codes are diagnose-only. Add fixes only where a mechanical correction exists
  (e.g. C0074/C0076 → suggest the correct aggregate/scalar form) — tracked, not a gap.

## 1. Catalog scaffold (data model) — DONE

- [x] 1.1 Catalog entry shape + typed accessor `src/reference/error-codes.ts` over `docs/codesys-reference/error-catalog.json`. Shape: `{ code, url, kind, category, cause, message: string|string[], repro, expect: string[], fix, status: "implemented"|"checkable"|"ide-only"|"pending", ourCheck, ourCode, lint, verified: { codesys, twincat } }` + `errorCatalog()` / `lookupErrorCode()`.
- [x] 1.2 Seed every code from `_toc.json` as a stub so the catalog enumerates all codes before harvest fills them.
- [x] 1.3 Completeness test (`error-catalog.test.ts`): one entry per `_toc.json` code + well-formedness (harvested ⇒ message; repro ⇒ expect).
- [x] 1.4 **Catalog-integrity guard (gap found):** URL-derived codes can mislabel — `_cds_error_c0008-2040066.html` is C0454, not C0008. Split fixed + real C0008 fetched. Keep the completeness test as the guard against regression.

## 2. Harvest — DONE (approach corrected)

- [x] 2.1 **CORRECTION to original plan:** we DO mirror the docs' own fixtures — capture the "Example of the error:" block as `repro`, its concrete "Message:" as `expect`, and the "Example of an error correction:" block as `fix`. These are functional test fixtures (input code → compiler output), not prose. Do NOT copy the pages' prose descriptions or fix-explanation paragraphs; `cause` stays a one-line paraphrase.
- [x] 2.2 Ran the harvest (16 sonnet agents): all codes have message/category/cause; ~199 have `expect`, ~197 have `repro`, ~78 have `fix`.
- [ ] 2.3 **Fidelity pass (gap found):** the bulk harvest is reliable for MESSAGES but lossy for MULTI-OBJECT code examples (e.g. C0565 dropped the `PROGRAM PLC_PRG` unit + `END_` keywords). Repros are DRAFTS. Do not trust a harvested repro wholesale — finalize a well-formed repro per code at implementation time (§5). Single-unit repros are usually fine as-is.
- [ ] 2.4 Rewrite the stance section of `13-error-messages.md`: catalog is the coverage checklist; our diagnostics map to `Cnnnn` as metadata (own `source`/`code` unchanged).

## 3. Triage — DONE (`docs/codesys-reference/TRIAGE.md`)

- [x] 3.1 Every code assigned a status; the `checkable` bucket further split into honest tiers (A clean-ast / B resolution-dependent / C parse / D ide-only) because "checkable" hid ≥4 different kinds of work — see TRIAGE.md.
- [x] 3.2 Mapped existing checks to codes **empirically, not by guess**: ran every `checkable` repro through the live engine. Key finding — the seeded `ourCheck` tags were aspirational; only C0049 matched exactly, C0046 matched its primary msg. Everywhere else our wording ≠ docs, so "reconcile" ≠ "free flip".
- [x] 3.3 Flip-to-`implemented` decided per code with `expect`=our wording, `verified.codesys=false`, docs-drift recorded (e.g. C0064 Dereference/Dereferencing) for §4. **Corpus gate is the arbiter** — it demoted C0062/C0218/C0426 mid-flip.
- [x] 3.4 Honesty test = the data-driven burn-in (`error-catalog.test.ts`): an `implemented` code with no faithful repro/expect, or wrong wording, fails the suite.

## 4. Conformance (live-build oracle) — CODESYS + TwinCAT DONE (2026-07-10)

- [x] 4.1 `scripts/verify-catalog.ts` builds each implemented code's `repro` on the live bridge (`/push`→`/build`,
  reset-isolated, synth-PLC for untasked units) and compares the real diagnostics against the LSP's own message
  for `ourCode`. `--write` stamps `verified.<vendor>` + records `<vendor>Actual` on mismatches. TwinCAT reuses
  the same script (auto-detects vendor from `/health`); only needs the `:8555` bridge up.
- [x] 4.2 **Live-CODESYS run 2026-07-10: 75/84 verified, 8 mismatch, 1 silent.** Adopted the live wording into
  `messages.ts` + catalog `expect` (updated the 6 colocated/burn-in tests that asserted the old wording). The 9
  residuals are all explained — NONE is a real FP against project code (corpus gate stays the FP authority):
  - **opt-in lints** — C0077 (unknown-type; repro `USNT` parses as "Unexpected statement" in the IDE, so no
    unknown-type diagnostic). NOTE (corrected 2026-07-10): C0351 (unknown-attribute) was briefly listed here as
    "the build doesn't surface it" — that was a HARNESS artifact: `splitRepro` sliced from the unit's `span.start`
    and dropped the POU-*leading* `{attribute}` pragma, so the pushed unit had no attribute and the build was
    silent. The `leadStart` fix (iteration 2) makes the slice carry leading pragmas, and C0351 now **verifies**
    live — the build DOES emit the unknown-attribute warning. (`pragmas.ts` still correctly excludes the
    `call_after_ini` typo from the known-attribute list.)
  - **IDE embeds/elides the source in its message** (cosmetic, ours is cleaner) — C0139 (`"i;\r\n"` vs `"i"`),
    C0198 (IDE elides the string constant to `'...'`).
  - **harness artifact of a multi-unit repro** — C0101 (the repro puts both FBs in one doc so both cycle
    directions fire; in production one-item-per-file each file reports its own participation — correct LSP model).
  - **repro isn't a clean IDE trigger** — C0032 (silent; repro is a syntax error → "Unexpected statement"),
    C0224 (`Fib(n-1)` as a FUNCTION self-call → IDE reports "function block instance expected" first).
  - **wording/severity divergence to settle** — C0033 (our C0033 warning vs the IDE's hard C0032 convert error for
    `POINTER TO INT := DWORD`), C0130 (our "method referenced without parens" vs IDE "Cannot convert 'METH1' to
    'INT'"). Left PROVISIONAL — adopting either would collide with C0032 / lose specificity.
- [x] 4.3 `verified.codesys` now set for the confirmed set (**85/93** after iterations 1–4 added C0096/C0182/C0421/
  C0550/C0566/C0089/C0094/C0568/C0533 and the `leadStart` harness fix un-masked C0351; report:
  `docs/codesys-reference/catalog-verification.json`). Remaining 7 mismatch + 1 silent are the genuine residuals
  (C0032/C0033/C0077/C0101/C0130/C0139/C0198/C0224). TwinCAT re-verify of the new codes still pending (§4.4).
- [x] 4.4 **Live-TwinCAT run 2026-07-10 (fresh-built `:8555` bridge, scratch project): 72/84 verified, 10
  mismatch, 2 silent.** Residuals overlap CODESYS's categories; the TC-specific findings:
  - **adopted TC wording via tc-branches** (→ verified) — C0175 (TC keeps the quotes `'RETAIN' or 'PERSISTENT'`;
    CS drops them), C0101 (TC capitalizes `Data Recursion`; still non-verified here only because the multi-unit
    repro fires both cycle directions — the wording is now correct for TC).
  - **TC build silent where CS flags** (left PROVISIONAL — TC doesn't surface these in a build) — C0509
    (chained `__NEW` assignment), C0526 (non-constant `VAR_INPUT` default).
  - **TC IDE quirk** — C0126 renders the pointer type as `'1'` (`Variable of type '1' requires exactly 1 Index`);
    unmatchable, left as-is.
  - `verified.twincat` + `twincatActual` stamped; `verified.codesys` preserved (`--write` is per-vendor).
- [x] 4.5 **TwinCAT re-verify of the 9 iteration-1–4 codes (2026-07-10):** signature model **C0089/C0094/C0568
  verified on TC** unchanged; **C0096/C0182/C0421 verified after tc-branches** (TC wording deltas: `EXTENDS-list`
  hyphen, `of Type` cap-T, `Use Keyword … Interfaces … IMPLEMENTS.`); **C0533 + C0550 are CODESYS-only** — live TC
  build emits nothing, so both were vendor-gated (`ctx.config.vendor !== "codesys" → return`), joining C0566 as
  CS-only lifecycle/attribute checks. Full TC pass now 75/93 verified (the delta from CS is the CS-only trio +
  the same TC-specific residuals from §4.4: C0509/C0526 silent, C0126 quirk, etc.).

## 5. Implementation loop (easy → hard, one code per unit) — IN PROGRESS (14 landed)

- [x] 5.1 The per-code loop is proven and repeatable: finalize repro → check under `checks/<group>/` → register → route wording through `messages.ts` → flip `status` → burn-in runs it both ways → corpus gate. Shared traversal extracted to `_shared.forEachExpr` so expr-checks don't each re-hand-roll `bodies()→walkAllExprs`.
- [x] 5.2 Landed by cluster (reuse-driven, not one-at-a-time): constant/literal (C0001), type-shape (C0003/C0047/C0066), init-shape (C0074/C0076), CASE-labels (C0216/C0217/C0219), plus flips (C0046/C0049/C0064). Clustering lands several codes per shared mechanism.
- [ ] 5.3 Reconcile `covered` codes (C0004/C0037/C0565…): still open — the empirical pass (3.2) showed these emit OUR wording, not the docs', so each is a per-code provisional flip, not free. Backlog.
- [x] 5.4 **Refined:** FP-prone-AND-lintable → opt-in `LintConfig` (like `unknownType`). But some FP-prone codes are NOT lintable — they need resolution the LSP lacks (C0062/C0218 enum-constancy, C0426 fall-through). Those revert to `checkable` with a `note`, not a lint. The corpus gate makes the demotion automatic.

## 6. Guardrails

- [x] 6.1 Corpus zero-FP gate green after every implemented code — and it earned it: it rejected 46 (init cluster) + 208 (CASE cluster) false positives before they shipped, forcing the demotions above. Committed `scripts/corpus-fp.ts` tallies FPs by code for fast diagnosis. Gate is never weakened.
- [x] 6.1c **Cross-fixture resolution in the conformance harness.** C0090 (unknown base class) exposed that `replay.test.ts`'s `CROSS_DECLS` excluded FBs, so a subclass fixture couldn't see its base FB → false C0090. Fixed by including all non-`program` units (FBs + their standalone method/property/action units) in the cross-fixture context: each fixture is its own file so members bind to their own FB (no leak), and unique `FB_LANG_<name>` pouNames prevent collisions. Also skip library-provided FBs in `checkInheritance` (their base may be library-internal, unseeable). Corpus + conformance both green with C0090/C0086 active.
- [x] 6.1b **TWO FP oracles, both mandatory per batch.** `scripts/corpus-fp.ts` (real project source) and `test/conformance/replay.test.ts` (recorded live-IDE messages) are DIFFERENT fixture sets — the corpus lacks conditional-compilation pragmas, so it missed a C0139 `no-op-statement` FP that fired on code inside stripped `{IF defined(…)}` branches; the conformance replay caught it. Fix: C0139 now requires the expr to RESOLVE (an unresolved bare name isn't a "no effect" case — the IDE strips it or reports it undefined). Run BOTH `bun scripts/corpus-fp.ts` AND `bun test test/conformance/replay.test.ts` after every batch, not just the corpus.
- [x] 6.2 `bun typecheck` + `bun test src/analysis src/reference` green after each batch (currently 161+ pass / 0 fail); oxlint clean on touched files.
- [ ] 6.3 Point `src/analysis` check docs at the catalog + TRIAGE.md as the coverage source of truth; remaining `checkable` codes are tracked follow-on units. (TRIAGE.md is now that map; the `13-error-messages.md` stance rewrite in 2.4 is still open.)

## 7. Core-integration & performance (added 2026-07-09)

- [x] 7.1 Verified the checks are first-class: registered → `computeSemanticDiagnostics` → `server/diagnostics.ts` `documentDiagnostics` → both LSP transports; config-aware; central per-vendor wording. Not a second-class side-channel.
- [x] 7.2 **Parse-once:** memoized `parseStatements` on `BodySpan` — the ~15 checks iterating `bodies()` no longer re-parse each POU body per check. Corpus green + full suite green after the change.
- [ ] 7.3 Quick-fix coverage: extend `code-actions.ts` `FIXABLE` where a mechanical correction exists (C0074/C0076 aggregate-vs-scalar, C0064 add `ADR`/pointer). Optional per code — diagnose-only is acceptable.
- [x] 7.4 (Infra unlock) aggregate initializer-list parser — **DONE**. Added `form` + parsed `elements` to `AggregateInit` (additive: `tokens` kept for the formatter's round-trip). `parseAggregate` in `expression.ts` handles array/struct/STRUCT forms, nesting, `name:=value` fields, and `n(v)` repeats; total & error-tolerant. Migrated C0074/C0076 consumers onto `form`; implemented C0075 on it. Colocated parser test + corpus green. C0232/C0233 now trivially buildable (§5 follow-on).
- [x] 7.5 (Infra unlock) symbol-constancy / enum-member resolver — **DONE**. `constancyOf` in `const-eval.ts` (constant/variable/unknown, keyed on symbol kind incl. `enum_value`). Implemented C0162 + re-enabled C0218 on it; colocated `constancy.test.ts`; corpus zero-FP (fixed the 207 C0218 FPs). C0062 now re-attemptable.
