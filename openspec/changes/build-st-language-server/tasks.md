Build order = the layer stack, bottom-up. Invariant for EVERY task: `cd packages/volt-lsp-iec && bun test` +
`bun typecheck` + corpus 0-error + conformance replay green before its commit. Freeze a layer's contract →
verify → let the next consume it.

## Diagnostic-check status matrix

Legend: ✅ shipped (0-FP on corpus) · ⏸ deferred (noted follow-on) · ⏳ pending. Conformance agreement ratchet
(exact byte-identical fixtures): **247/278 TC · 246/278 CS** — floors only ever rise.

| Check (code) | Lang | Severity | Status | Notes |
|---|---|---|---|---|
| assignment-type-mismatch | ST·VG | error | ✅ | shared `assignmentPairError`; VG sinks reuse it |
| narrowing (implicit conversion) | ST | warning | ✅ | vendor-keyed "Possible/possible loss" |
| binary-op-type-mismatch | ST | error | ✅ | MOD non-int · BOOL-in-arithmetic |
| conversion-source-mismatch | ST | error | ✅ | `<T>_TO_<U>` source vs arg |
| subrange · array-bounds | ST | error | ✅ | const-eval; array-bounds wording locked live, subrange a wording KNOWN_DIVERGENCE. **`constant-overflow` REMOVED** — it false-positived (CODESYS accepts out-of-range untyped literals) |
| deref-non-pointer (`x^`) | ST | error | ✅ | flags elementary/array bases; pointer/ref/THIS fold quiet |
| duplicate-declaration | ST | error | ✅ | per-scope, qualified_only-aware |
| **unresolved-identifier** | ST | error | ✅ | bare refs; `.library`/`.device` skip via `workspace-refs` (member access → `unknown-member` below) |
| **vg-undeclared-identifier** | VG | error | ✅ | shares ST resolver; skips LD `SET/RESET/RISING/FALLING` modifiers |
| var-section-placement | ST | error | ✅ | section not allowed for POU kind |
| external-write · lifecycle · abstract-instantiation · interface-implementation | ST | error | ✅ | oop/ group |
| pragmas (message + orphan-conditional + unterminated-conditional) | ST | error/info | ✅ | unterminated-`{IF}` wording locked live (both vendors); region/unknown-directive checks proven invalid live (build clean) so not built |
| VG structural (`VG_PARSE`/`_NOT_CLOSED`/`_DUPLICATE_*`) | VG | error | ✅ | LSP-ownable subset; canonical/round-trip stays bridge's |
| vg-undefined-label (JMP → missing label) | VG | error | ✅ | per-network, recurses EN/ENO; wording LOCKED (CODESYS `No such label…`); TwinCAT doesn't flag → TC divergence |
| vg-unknown-pin (box → undeclared pin) | VG | error | ✅ | project FBs only; skips unresolved EXTENDS bases; wording LOCKED both vendors (`'<pin>' is no input of '<FB UPPER>'`) |
| unknown-member (`a.b` not on `a`'s type) | ST | error | ✅ | wording locked live (`'x' is no component of 'T'`; TC uppercases type); library + namespace bases skip; struct EXTENDS honored |
| unknown-member (VG, `vg-unknown-member`) | VG | error | ✅ | shares `unresolvedMembers` + `notAMember` with ST; 0-FP on corpus after the qualified_only binder fix (Open items #1) |
| shadowing | ST | warning | ✅ | opt-in lint (default OFF) |
| unknown-attribute (`{attribute 'typo'}`) | ST | warning | ✅ | opt-in lint, **CODESYS-gated** (TwinCAT ignores unknowns — confirmed live); byte-identical CODESYS msg; catalog 0-hit on corpus. Hover + completion over the catalog ✅ |
| conversion-catalog | ST | — | ⏳ | narrowing-conversion catalog (own follow-on) |
| VG narrowing / binary-operator | VG | error/warn | ✅ | shared per-pair/per-node helpers; 0-FP on corpus |

**Dead-code suppression (what makes real-project checks 0-FP)** — the compiler never checks code it doesn't compile, so the LSP suppresses the same, at three granularities:
| Mechanism | Status | Notes |
|---|---|---|
| POU-level reachability (`deadPous`) | ✅ | seed PROGRAM roots → fixpoint over identifier edges + interface dispatch; whole file suppressed |
| task-root seeding (`.task` `Calls:`) | ✅ | roots = task-assigned PROGRAMs only, so an uncalled PROGRAM (call commented out) is dead; fallback all-programs |
| member-level reachability (`deadMemberSpans`) | ✅ | excluded/uncalled methods inside a LIVE FB; per-diagnostic suppression; whitelist lifecycle/property/interface (uncertain⇒live) |

## Corpus / harvest status (real-project 0-FP gate — `test/corpus/`)

Harvested from live headless CODESYS (`codesys-bridge.ps1 up -Project … ; packages/volt-lsp-iec/scripts/harvest-lsp-corpus.ts`). Source `.project`
files in `C:\Users\marce\Documents\codesysproject\`. All harvests are VERBOSE (library signatures + `.task`/
`.library`/`.device` reference files). Ratchet: conformance **247/278 TC · 246/278 CS**.

| Fixture | Files | State |
|---|---|---|
| CodesysTestProject | 594 | fresh |
| awa-palletizer | 4087 | ✅ refreshed, clean |
| bakon-nano | 6678 | ✅ refreshed, clean (task-root reachability suppresses uncalled ControlStatusAGMs) |
| pro2193 | 8095 | ✅ refreshed, clean (member-level dead-code + interface-impl abstract-skip) |
| lenze-mid | 8048 | ✅ clean, incl. `vg-unknown-member` — the FPs were binder bugs (qualified_only leak + commented-pragma), not a harvest problem; see Open items #1 |

## Open items (todos)

1. **VG unknown-member — ✅ RESOLVED + SHIPPED (2026-07-07).** The `Mach1.GenFlags` "anomaly" (197 VG FPs) was
   NOT a broken project or a precompile cache — it was two binder bugs, found by inspecting the real decls:
   (a) `qualified_only` GVL members leaked into the bare namespace, so bare `Mach1` bound to the qualified-only
   member `HMI_Var.Mach1 : sUDT_HMIVar_Mach1` (a struct with no GenFlags) instead of the GVL block `Mach1.gvl` —
   `lookupInChain` now skips qualified_only symbols (reachable only as `Gvl.member`); (b) the qualified_only
   pragma was matched by a raw regex that also hit a commented `//{attribute 'qualified_only'}` (`LST_General`),
   wrongly hiding bare `FF100ms` — now detected via the lexer (a commented pragma lexes as a comment). With both
   fixed, bare `Mach1` → the GVL block and `Mach1.Genflags.*` fully resolves; VG FPs 197 → 0. The held check is
   wired as `vg-unknown-member` (shares `unresolvedMembers` + `notAMember` with ST); corpus 0-FP holds, conformance
   unchanged (228/259). Regression tests: the collision, the commented attribute, a real VG miss, the Mach1 chain.
2. **Live-bridge message-lock + full check audit — DONE (2026-07-07).** **Recorder RECREATED** as
   `scripts/record-language.ts` (self-contained wire driver; the volt-agent one was removed) + `diff-recordings.ts`
   + `audit-check.ts` (LSP-vs-live-IDE differ). Re-recorded both vendors: **229/259 matched the committed ground
   truth exactly** (recordings validated accurate) and **14 range fixtures had no recording** (the replay was
   silently skipping them) — now merged. Ratchet raised **228→233 CS · 231→236 TC**. Locked wording:
   `unknown-member` (`'x' is no component of 'T'`; TC uppercases type), `array-index-out-of-bounds`, and
   `unterminated-conditional-pragma`. `unknown-attribute` gated to CODESYS (TC ignores unknowns — latent FP fixed).
   **AUDIT FINDINGS:** (a) **`constant-overflow` REMOVED** — proven to false-positive: CODESYS *accepts*
   out-of-range untyped literals (`INT:=40000`, `30000+10000` build clean with a conversion WARNING). This was
   the one genuinely-wrong check. (b) An **FP-bait battery** (compiler-accepted near-miss code) proved every
   OTHER type check (assignment/narrowing/conversion/binary-op/deref) has **zero false positives** — committed as
   a regression test. (c) **subrange** kept (never FPs) but its wording is a documented KNOWN_DIVERGENCE (both
   compilers use the conversion form). **REMAINING GAP (miss, not FP):** CODESYS emits signed/unsigned
   **implicit-conversion WARNINGS** (`WORD→INT`, `INT→UINT`) the LSP doesn't — a whole safe-to-add category
   (future `implicit-conversion-warning` check). **VG label/pin** wording still needs a graphical push to record.
3. **conversion-catalog** — narrowing conversions beyond the recorded `LREAL→REAL` (each needs a bridge recording).
3b. **Conformance-fixture coverage — ✅ 22/22, EVERY check covered (closed 2026-07-07).** Mapping every check
   code against the fixtures showed a gap (started 14/22 → 16/22 once PLC_PRG triggers were counted). Fully
   closed it via a `check-coverage.ts` fixture file, all recorded live + merged (`RECORD_ONLY`):
   - ST: `unterminated-conditional-pragma`, `unknown-member` (self-contained struct+FB; the recorder gained
     multi-unit `splitItems`), + a **FP-BAIT battery** (12 compiler-ACCEPTED near-miss cases — the permanent
     guard against the `constant-overflow`-class false positive).
   - **VG (all 4):** wired `computeVgDiagnostics` into the replay's `runLsp`, authored CANONICAL FBD/LD bodies
     (the recorder pushes them as real graphical POUs — an earlier "can't push VG" claim was WRONG; the bridge
     fully supports it via `GraphicalCode.Write`). `vg-undeclared`/`vg-unknown-member` matched our wording;
     **`vg-unknown-pin` LOCKED** to `'<pin>' is no input of '<FB-TYPE UPPER>'`; **`vg-undefined-label` LOCKED**
     to CODESYS `No such label '<LABEL UPPER>'…` with a TwinCAT divergence (TC doesn't flag VG jump labels).
   Ratchet **246/247 across 278 fixtures**, zero false positives. So "no fixture changes ≠ complete" is now moot
   — every diagnostic the LSP emits is backed by a live-IDE recording.
3c. **Bridge↔LSP VG responsibilities — BY DESIGN, no conflict (clarified 2026-07-07).** Earlier framed as a
   "parity gap"; the design intent resolves it: the **bridge's VG checks exist ONLY to prevent CORRUPT ladder/
   FBD logic** (can the body be stored + round-tripped without drift — `VG_NOT_CANONICAL`/`VG_PLCOPEN_DRIFT`/
   `VG_LEAF_*`), NOT to validate working code. **Validating the CODE is the LSP's job** (semantic checks). So the
   observed "divergence" — the LSP accepts a non-canonical body the bridge refuses — is NOT a conflict: the body
   is semantically valid (LSP right) AND not safely storable as-is (bridge right); the push error returns the
   canonical form. No corruption, no correctness bug → **no new openspec needed, not a blocker for LSP tests.**
   Residual (low-risk): the SHARED structural checks (`VG_PARSE`/`NOT_CLOSED`/`DUPLICATE`) are coded twice (C#+TS)
   and could drift — but the bridge still catches any corruption on push, so it's convenience-drift only. A
   shared VG parity corpus (feed the same bodies to both, assert identical STRUCTURAL verdicts) is a nice-to-have
   guard, not required.
4. **pragma checks — ✅ CLOSED (2026-07-07).** The live IDE pruned the speculative ones before they shipped:
   unterminated `{IF}` is a real error (shipped as `unterminated-conditional-pragma`, wording locked); but
   unterminated `{region}`, orphan `{endregion}`, and an unknown-pragma-DIRECTIVE lint all build CLEAN on CODESYS
   (regions are editor-only; unknown directives are silently ignored, unlike unknown attributes) — so they were
   NOT built (would have been FPs). Attribute-level `requires`/`forbids` conflict/companion remains hypothetical
   (no documented CODESYS conflict set; the constructible directive-pairing cases are non-errors), so not pursued.
5. **VG services (F.2d/f follow-ons) — ✅ CLOSED.** references/rename across VG bodies ✅ (cross-body compose in
   the graphical layer). **Pragma/attribute hover ✅** (`pragmaHover` — re-lex like the VG marker hover; directive
   + `{attribute '<name>'}` descriptions from a reference catalog). **Attribute completion ✅** (inside
   `{attribute '<partial>'}` offers the known-attribute catalog). VG semantic tokens: covered by the whole-doc
   `semanticTokens` pass (operands are ordinary tokens) + a guard test — a VG-specific pass is cosmetic, not built.
6. **Bridge item-filter — KEEP (do NOT remove).** Earlier thought it redundant; it is NOT. The bridge's
   `ExcludeFromBuild` filter drops items EXCLUDED from build regardless of use; LSP reachability only drops
   UNCALLED items. An excluded-but-REFERENCED item (kept live by reachability) would false-positive without the
   filter, since excluded code is often broken/WIP. Removing it needs item-level exclusion in the LSP first —
   not worth it.
7. **Land** — `feat/st-body-ast` → `dev` ✅ MERGED (fast-forward, 2026-07-06). Open items 1·4·5 ✅ CLOSED, 2
   LARGELY DONE (only overflow/subrange check-shape + VG label/pin left, both deferred with rationale). The one
   still-open topic is **#3 conversion-catalog** (bridge recordings). Archive once #3 + the two #2 remainders close.

## 0. Clean-room + guardrails (first — before any code)
- [x] 0.0 **CLEAN-ROOM — build in a NEW package; do NOT patch or build inside the existing `volt-lsp-iec`.**
      The existing `packages/volt-lsp-iec` stays UNTOUCHED as the reference/backup (git also preserves it).
      Scaffold a fresh package `packages/volt-lsp-iec-next` (SWAP DONE 2026-07-06 — promoted to `packages/volt-lsp-iec`,
      the old package deleted; git history preserves it) — isolated, so nothing imports it yet and there is
      ZERO breakage while it's built. Mirror the old package config: `package.json` (`type: module`; exports
      `.` → `src/index.ts` + `./conformance`; `bin` `volt-lsp-iec`; deps `vscode-languageserver-protocol` +
      `-textdocument`; devDeps from catalog; scripts build/typecheck/test/record:language); `tsconfig.json`
      (`extends @tsconfig/node22`, `rootDir src`, `module nodenext`, `lib es2022`); `turbo.json` (`extends
      ["//"]`, test task). The real-project corpus + conformance recordings are referenced from (or copied out
      of) the legacy package. When the new package subsumes the old and the conformance replay passes, SWAP:
      old → `volt-lsp-iec-legacy`, new → `volt-lsp-iec`. Build bottom-up (A→G); the legacy is reference only —
      never edited.
- [x] 0.1 Stand up the layer folders with an `index.ts` barrel each; consumers import from the layer, not deep
      files. Seed the ownership map (architecture.md) as the single lookup for "where does X live".
- [x] 0.2 Add a `dependency-cruiser` (or `eslint-plugin-boundaries`) config that FAILS on: an upward import
      (`types` → `analysis`), a check importing a sibling check, or a layer re-declaring a lower-layer type.
      Wire it into `bun lint` / CI so a duplicate/upward import is a build failure, not a review nit.

## A. syntax
- [x] A.1 Complete AST: structured type-expr dims/length/subrange/vector, literals with value+type, initializers
      as expression trees, clean qualified names. (literal *value* on the node; the literal Type is inferred in
      layer C from `literalKind`+`value` — storing it here would be an upward import.)
- [x] A.2 Subrange bounds retained in the AST.
- [x] A.3 Parser produces the complete nodes (error-tolerant driver + treewalker). Gate: body-AST corpus 100%
      ✅ (2199/2199 ST bodies, 0 parse errors / 1512 files), fuzz green ✅, **`parse(format(x))≡parse(x)` +
      format-corpus ✅ CLOSED** — the E.3 formatter round-trips ALL 1512 corpus files to an equivalent AST
      (committed corpus test). The generous corpus roundtrip surfaced+fixed 6 printer bugs (NOT-spacing,
      implicit-enum values, interface method var-sections/properties, property modifier, AT clause, chained assign).

## B. symbols
- [x] B.1 `binder` (AST → scope tree, workspace cross-indexed) via one `makeScope`; the EXTENDS post-pass split out.
      (`symbols/symbol.ts` types + `makeScope`; `symbols/binder.ts` `buildSymbolTable` + `linkExtends` split out.)
- [x] B.2 `scope-nav` — the one scope-tree navigator. Keep `qualified_only` resolution independent of type isolation.
      (`lookup`/`lookupMember`/`findChildScope`/`resolveBareEnumMember` — structural, no type inference.)

## C. types
- [x] C.1 `elementary` — the type-facts SSOT + golden test (derived views reproduce the legacy sets exactly).
- [x] C.2 `type` (rich model, `UNKNOWN` total fallback) + `resolve` (reads structured AST facts).
      (`type.ts` folds legacy ResolvedType+InferredType into one fact-carrying union; `resolve.ts` TypeExpr→Type.)
- [x] C.3 `const-eval` (literals valued in A; folds unary/const-ref/const-arith; `bigint`; non-const→undefined).
      (const-ref needs the `constant` flag — added to `Symbol`, threaded from the binder's CONSTANT sections.)
- [x] C.4 `infer` — the one engine (`inferExprType` the public entry). Rich Type makes index/deref/member read
      the sub-type off the node; `resolveMemberChain` co-located.
- [x] C.5 `compat` (assignable · narrowing · arithmetic-result · conversion-source) + `render`. assignable +
      narrowing oracle-calibrated on the rich Type; arithmetic-result lives in `infer.binaryResultType`;
      **conversion-source is `isAssignable(sourceType, argType)`** — the D.2 conversion check derives the source
      from the `X_TO_Y` name and uses it (no separate relation needed; the Layer-F catalog only adds
      conversion-FUNCTION reference metadata, not the compat relation). `render` = the one Type/TypeExpr renderer
      (`exprText`/`renderTypeExpr`, now also the formatter's expression printer); compiler-exact message forms
      stay in `analysis/messages`.
- [x] C.6 conservative-skip invariant: `isKnown` + `UNKNOWN` total fallback; every consumer skips on unknown.

## D. analysis
- [x] D.1 `diagnostics` orchestrator + `config` (vendor + opt-in lints) + `messages` (per-vendor builders).
      (Config collapses the ~30 legacy flags to `vendor` + opt-in lints; `messages` keys wording per vendor;
      orchestrator is vendor-keyed. **Conformance oracle stood up**: legacy live-IDE recordings reused,
      `replay.test.ts` asserts LSP ⊆ IDE (no false positives) per vendor + an exact-agreement ratchet.)
- [~] D.2 checks grouped `types/ · declarations/ · names/ · oop/ · pragmas/`, each thin on `compat`/`infer`,
      each traced to a conformance fixture recorded against CODESYS + TwinCAT. **13 checks across all 5 groups
      ported**: types/ (assignment · narrowing · binary-operators · conversion · deref), names/ (duplicate-declaration ·
      **unresolved-identifier**), declarations/ (var-section-placement), oop/ (external-write · lifecycle ·
      abstract-instantiation · interface-implementation), pragmas/ (message + orphan-conditional). Agreement
      ratchet **247/278 TC · 246/278 CS**, zero false positives, all wording per-vendor via `messages`. Remaining
      non-agreements are documented IDE-only divergences (parse cascades, `op_sys_*`, app-config warnings).
      Deferred: conversion-catalog · unknown/conflict pragmas (needs the keyword/pragma catalogs, F.1).
      **unknown-member (member access) ✅ DONE** — `a.b` type-checked against the base's project scope (library/
      namespace/unresolved bases skip; DUT `STRUCT EXTENDS` linked in the binder); **shared with VG as
      `vg-unknown-member`, wired 2026-07-07** after the qualified_only binder fix (bare `Mach1` no longer binds a
      qualified-only GVL member — see Open items #1). **deref-non-pointer
      ✅ DONE** — `x^` on an elementary/array base errors (byte-identical per vendor: "Dereference requires a
      pointer" / "…Pointer"); pointer/reference bases + the `THIS^`/reference-target infer-fold stay quiet, 0-FP.
      **`unresolved-identifier` ✅ DONE** — bare-reference resolution; the `.library` `NAMESPACE` line + the
      `.device`-instance skip ship as `src/workspace-refs.ts` (loaders → `WorkspaceRefs`, threaded via
      `DiagnosticsArgs.references`; the server loads them from `rootUri`, the corpus gate from the project dir).
      Message byte-identical both vendors (`Identifier '<name>' not defined`); skip surface covers `__`-ops,
      conversion shape, THIS/SUPER + `IoConfig_Globals`/`TYPE_CLASS`, the reference catalog, library namespaces,
      device instances, bare enum members. (The referenced-library ELEMENT bodies also resolve as ordinary
      ingested source per `spec.md` L252 — the namespace root is the only ambient piece, now handled.)
- [~] D.3 The full type-checker rule set (subrange/overflow/array-bounds/composite-shape/member-count/…) —
      fixture → record → mirror → replay green; corpus 0-error.
      **corpus 0-error ✅ DONE** (committed test: all analysis checks emit ZERO error-severity FPs across the
      5-project corpus, ~30k files after the verbose re-harvests — the offline half of the gate; dead-code
      suppression at POU/task/member granularity makes real projects clean, see the status tables above).
      Surfaced+fixed a real
      FP: enum member → LREAL is a valid int-widening, so `compat` isolates an enum only from BOOL/STRING/
      TIME/DATE, not from real. **overflow ✅ implemented** (const-eval range check, unit-tested, 0-FP on
      corpus) — its message is PROVISIONAL: the overflow fixtures have no bridge recording, so byte-identical
      wording is locked at the "record" step (T.1 bridge pass), per the spec's fixture→record→mirror→replay
      flow. **subrange-out-of-range + array-index-out-of-bounds ✅ implemented** (structured subrange/array-dim
      nodes + const-eval, unit-tested, 0-FP on corpus, conformance held 230/227) — messages likewise
      provisional/bridge-gated. Remaining (composite-shape/member-count) const-eval-ready, batched into the
      live-bridge pass with the message confirmations.

## E. services
- [x] E.1 `shared` (`resolve-at`, `locations`, `symbol-kinds`+`humanKind`, `token-scan`). One resolution
      semantics ✅ (`resolveAt` = body-path member-chain/ident, else declaration-path defining-span/name);
      `locations`, `token-scan`, and the one `humanKind` label ✅. (hover↔completion parity test lands with
      those features in E.3.) Also moved `scopeForUnit`/`findScopeByName` to `symbols/scope-nav` (one home).
- [x] E.2 navigation (definition·type-definition·references·rename·prepareRename·highlight·implementation) all via
      `resolve-at`; `hierarchy` (call+type, incoming-calls type-aware with a member-call negative test). ✅ ALL
      done — type-aware by symbol identity (member-name-ident double-count guarded); call-incoming type-aware
      with the member-call negative test green; implementation (interface→FBs) + type/call hierarchy shipped.
- [x] E.3 `assist` (hover·completion+resolve·signature-help), `inlay-hints`, `code-lens`, `semantic-tokens`,
      `structure`, `formatting` (print·editorconfig·on-type·range), `code-actions`. ✅ ALL done — hover ·
      completion (member+scope+keywords) · signature-help · inlay-hints · code-lens · semantic-tokens ·
      document-symbol · folding · selection · **formatting** (print + editorconfig/insertSpaces + range +
      on-type — closes A.3) · **code-actions** (wrap-in-conversion quick-fix). hover↔completion `humanKind`
      parity test green. (Comment re-attachment in reformatted bodies deferred — bodies with inline comments
      are preserved verbatim, still round-trip-correct.)
      **Code-quality pass**: consolidated `bodiesOf`/`isGraphicalBody`/`varInputParams` (10 copies → 1 in
      `syntax/bodies`), moved `scopeForUnit`/`findScopeByName` to Layer B (one home), extracted the shared
      `stBodies` iterator. oxlint clean, 93 tests green.

## F. reference · graphical
- [~] F.1 `reference` catalogs; ranges derive from `types/elementary`. **Lean catalog ✅** — `reference/`
      (built-in data-types with range/width DERIVED from `types/elementary` — no dup, per spec; operators;
      standard functions) + `lookupReference`/`renderReferenceHover`, wired into hover for built-ins (test
      green). Layering corrected: `reference` is a data layer BELOW analysis/services (the "F" grouping spans
      two dependency levels — reference low, graphical high); guard ranks updated.
      **Scope clarification (`spec.md` L252):** libraries are NOT a hand-built catalog — referenced-library
      element signatures are materialized as ordinary source under `Library Manager/<lib>/` and resolve
      through the normal symbol table; the curated standard-function table is only the FALLBACK for names no
      mirrored library covers. **Library floor ✅ DONE** — two parts: (a) the `.library` namespace-root +
      `.device` skip (`src/workspace-refs.ts` → `WorkspaceRefs`), so bare library/device roots never
      false-positive; (b) **member-access resolution** (`unknown-member`) — since the library ELEMENT signatures
      are already ingested as ordinary source (`Library Manager/<lib>/*.fb|.struct|.enum|…`), a member `a.b`
      type-checks against the base's real scope. Conservative to a fault (zero-FP): only a PROJECT (non-`Library
      Manager`) struct/FB/enum base with a fully-resolved EXTENDS chain is checked; library-typed, namespace-
      qualified (`CAA.HANDLE` — base is not a value → UNKNOWN), and unresolved bases skip. Surfaced+fixed a real
      binder gap: **CODESYS DUT `STRUCT EXTENDS` now links its base scope** (`ingestStruct`/`linkExtends`), so
      inherited fields resolve. Shared `unresolvedMembers` is wired for ST; VG member-access is HELD on the
      lenze anomaly (Open items #1) — do NOT patch it, needs a live-IDE clean-rebuild to decide. **Pragma
      catalog ✅ DONE** — `reference/pragmas.ts` (`isKnownAttribute`: the CODESYS + TwinCAT `{attribute '…'}`
      name set, alias-folded) drives the opt-in **`unknown-attribute`** lint: an unrecognized attribute warns
      byte-identical to CODESYS ("The attribute <n> is unknown and will be ignored by the  compiler." — the
      double space is the compiler's, matched exactly). Opt-in because completeness-sensitive; gated by a corpus
      assertion (lint ON ⇒ 0 hits, which surfaced + added the missing `no_explicit_call`). Remaining: the
      keyword catalog + per-vendor equivalence (hover/completion), and pragma conflict/companion checks.
- [~] F.2 `graphical` — the VG (FBD/LD) sublanguage at ST-parity for CODE correctness. Spec:
      `data-model.md §graphical` (the full AST), `spec.md §E` (routed-by-content · round-trip is the
      bridge's · **the LSP owns code correctness: infer · undeclared · hover · completion · nav** · wire
      types inferred-not-stored · CFC/SFC marker), and `spec.md` "VG unresolved consults library+device
      catalogs" (L323). Ownership boundary: the **bridge** owns FORMAT/round-trip (`VG_NOT_CANONICAL` ·
      `VG_PLCOPEN_DRIFT` · `VG_LEAF_FANOUT` · `VG_LEAF_REFERENCES_TEMP` — need the writer+PLCopen); the
      **LSP** owns code correctness and MIRRORS the pure-text structural codes so a body is fixed before
      push. LARGE (~1700 lines in legacy `vg/`); ST bodies already route around graphical (`isGraphicalBody`).
      **Reuse decision (rebuild refinement):** VG operands ARE fully-parenthesised ST expressions (same
      operators), so they parse into ST `Expr` and flow through the ONE type engine / `resolveMemberChain` /
      nav / hover — instead of a parallel `VgOperand`/`VgGroup` infer+resolve stack. The data-model's
      `VgOperand` tree is the topology carrier; its expression content is an `Expr` (operator-info folds onto
      the binary node). Honors "reuse the shared core — one type engine, one service set" (architecture F).
  - [x] F.2a **surface** — full VG AST + error-tolerant parser (`graphical/text/`). Networks (index/language
        · headerSpan) + the full statement set (wire-def[isEnBinding] · sink · fb-call · en-eno-if · **execute
        (inline-ST box, parsed with the ST statement parser)** · label · jump/return[condition] · comment ·
        unknown). Operands parsed into ST `Expr` via `parseExprFromTokens` (the reuse seam); nested en-eno-if
        bodies + execute bodies recurse. The 4 LSP-ownable structural codes (`VG_PARSE · VG_NETWORK_NOT_CLOSED
        · VG_DUPLICATE_NETWORK · VG_DUPLICATE_NAME`, messages PROVISIONAL/bridge-gated). **Corpus gate ✅** —
        43 bodies / 376 networks parse with zero structural errors (EXECUTE/IF-heavy Lenze networks included).
  - [x] F.2b **infer adapter** — `analyzeVgBody` builds a per-network scope (POU + each `LET` wire as a
        pseudo-symbol whose `typeExpr` is SYNTHESIZED from inferring its producer `Expr`), so the ONE type
        engine resolves wire refs like real vars — including chained wires (`LET en5 := en4`, inferred against
        the wires defined above). Wire types inferred, never stored (spec L399). Network-scoped (per
        VG_DUPLICATE_NAME).
  - [~] F.2c **checks** — sink assignment type-check runs the SAME `assignmentPairError` as ST (extracted to
        one home → byte-identical wording per vendor), against the wire-aware scope; recurses en-eno-if +
        execute bodies; **skips box-output sinks** (`out := box(...)` is a graph wire, the IDE/bridge's remit
        — removed a real BOOL→INT corpus FP). **`vg-undeclared-identifier` ✅ DONE** — shares ST's resolution
        (`unresolvedInExprs`, extracted to `_identifier-resolution.ts`) against each network's POU+wire scope,
        over all operand `Expr`s; skips LD coil/edge MODIFIER words (`SET`/`RESET`/`RISING`/`FALLING`, a
        corpus-found gap). Error severity ⇒ **corpus 0-FP gate covers VG code diagnostics ✅**. **`vg-undefined-label`
        ✅ DONE** (JMP → a label in no reachable network statement; labels+jumps gathered across EN/ENO).
        **`vg-unknown-pin` ✅ DONE** (a box passing a pin the FB doesn't declare — VAR_INPUT/OUTPUT/IN_OUT +
        properties, inherited included; runs ONLY for a project FB whose whole EXTENDS chain resolved, else
        skips — 0-FP). Both provisional-worded (VG has no recording). **VG narrowing + binary-operator ✅ DONE**
        — the ST checks now expose per-pair `narrowingPairError` / per-node `binaryOpError` (siblings of
        `assignmentPairError`); VG sinks run the narrowing pair, VG operands run the binary-op node check.
        Byte-identical wording (shared with ST), 0-FP on corpus — closes VG code-correctness at ST parity.
  - [~] F.2d **services** — the graphical branch: `vgResolveAt` (cursor→symbol via the SAME
        `exprAtOffset`/`memberAtOffset` descent + `resolveMemberChain`/`lookup`, wrapping VG operands as
        synthetic statements) + **hover** (incl. inferred wire type, reference-catalog fallback) · **definition**
        · **type-definition** · **completion** (POU vars + network wires + members + keywords). Reuses the ST
        cores (`symbolHover`, `completionAtScope`, `locationOf`). Server routes position queries by `inVgBody`.
        Outline ✅. **references/rename ACROSS VG bodies ✅ DONE** — `allReferences`/`referencesAnywhere`/
        `renameAnywhere`/`prepareRenameAnywhere` (graphical layer, may import services) compose ST `findReferences`
        with a walk over VG operand networks and resolve the cursor from either body kind; the server routes ALL
        references/rename here (a rename that missed a VG operand = data corruption). Cross-body test:
        a global read in one FB's ST body + another's VG (LD) body renames in all three files.
        Not built: VG **semantic tokens** — the whole-doc lexer already colors VG operand text; only LET-wire
        refinement is missing, which is cosmetic (a mis-colored wire is never wrong data).
  - [x] F.2e **CFC/SFC marker** — `vgMarkerHover` explains a `(* @volt-graphical: <LANG> *)` body (authored in
        the IDE, no editable text form); wired as the ST-hover fallback. The marker is a comment → not analyzed
        as VG or ST, zero diagnostics (spec L403-413).
  - [~] F.2f **tests/corpus/conformance** — VG unit tests (parse · structure · infer · checks · **undeclared ·
        unknown-member · undefined-label · unknown-pin** · hover/def/completion/resolve · **cross-body
        references/rename** · marker) + corpus VG parse gate + corpus 0-FP gate (incl. VG sink + undeclared +
        member + label + pin checks) + server e2e (VG diagnostics · VG hover routing). **239 suite green**,
        conformance held (231 TC/228 CS), layering clean, oxlint 0 errors. Pending: live-bridge record pass to
        lock the PROVISIONAL VG structural/label/pin/**member** messages (batched with the D.3 overflow/subrange
        lock, T.1).
  Status: F.2a·b·e DONE; F.2c·d·f substantially done (the code-correctness layer — infer · sink type-check ·
  **undeclared-identifier · undefined-label · unknown-pin** · hover · def · completion · nav · **references/rename
  across VG** — ships at ST parity). Remaining follow-ons: VG semantic tokens (cosmetic, deferred) · narrowing/binary
  VG checks · live-bridge message lock. ST bodies unaffected throughout.

## G. server
- [x] G.1 LSP 3.17 / stdio, vendor-keyed; push+pull diagnostics, progress, cancellation, incremental sync.
      ✅ **Runnable server** (`server/server.ts` via `vscode-languageserver-protocol` connection over stdio;
      `bin --stdio [--codesys|--twincat]`). Incremental `TextDocument` sync, push diagnostics on open/change,
      one cached project symbol table (rebuilt per edit). Wires EVERY E service + D diagnostics: hover ·
      definition · type-definition · implementation · references · highlight · rename/prepare · completion ·
      signature-help · document-symbol · folding · selection · inlay-hints · code-lens · code-actions ·
      formatting (doc+range) · semantic-tokens (legend advertised). **5 end-to-end tests over real LSP framing**
      (initialize→capabilities, didOpen→hover/definition/documentSymbol, pushed diagnostics) all green.
      (Pull diagnostics + progress/cancellation are protocol-surface follow-ons; push + incremental sync done.)

## Testing · backend
- [ ] T.1 `test/conformance/` (catalog · record · recordings · replay) + `test/corpus/` ratchet + co-located
      unit tests. Message parity byte-identical per vendor is the single criterion.
- [ ] X.1 (future) `transpile/rust/` + `test/exec/` — transpile a POU, build, drive scan cycles, assert I/O.

## Land
- [ ] Z.1 Full suite + typecheck + corpus 0-error + conformance replay green; `check-divergence` clean; sync the
      `st-language-server` spec + archive.
