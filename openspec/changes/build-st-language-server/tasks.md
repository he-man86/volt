Build order = the layer stack, bottom-up. Invariant for EVERY task: `cd packages/volt-lsp-iec && bun test` +
`bun typecheck` + corpus 0-error + conformance replay green before its commit. Freeze a layer's contract →
verify → let the next consume it.

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
      each traced to a conformance fixture recorded against CODESYS + TwinCAT. **11 checks across all 5 groups
      ported**: types/ (assignment · narrowing · binary-operators · conversion), names/ (duplicate-declaration),
      declarations/ (var-section-placement), oop/ (external-write · lifecycle · abstract-instantiation ·
      interface-implementation), pragmas/ (message + orphan-conditional). Agreement ratchet **230/259 TC ·
      227/259 CS**, zero false positives, all wording per-vendor via `messages`. Remaining non-agreements are
      documented IDE-only divergences (parse cascades, `op_sys_*`, app-config warnings). Deferred: deref ·
      conversion-catalog · unknown/conflict pragmas (the last needs the keyword/pragma catalogs, F.1).
      **`unresolved-identifier` is NOT catalog-blocked** — per `spec.md` "resolves library symbols from mirrored
      signatures + namespace stubs" (L252), referenced-library elements are materialized as ORDINARY source
      (`Library Manager/<lib>/*.fb|.fun|.enum|.struct|.gvl`) that the binder already ingests, so they resolve
      like any project symbol (no ambient/catalog machinery). What actually gates it is small: ingest the
      `.library` stub's `NAMESPACE` line (register the qualified root, e.g. `CAA`) + the `.device`-instance
      skip. Tracked with F.1's stub ingestion.
- [~] D.3 The full type-checker rule set (subrange/overflow/array-bounds/composite-shape/member-count/…) —
      fixture → record → mirror → replay green; corpus 0-error.
      **corpus 0-error ✅ DONE** (committed test: all analysis checks emit ZERO error-severity FPs across the
      4-project corpus, ~1500 files that compile clean — the offline half of the gate). Surfaced+fixed a real
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
      mirrored library covers. Remaining, in order of value: (1) **`.library` stub ingestion** — a new file
      kind carrying `NAMESPACE`/`PLACEHOLDER`/`SYSTEM`; register each library's namespace root so qualified
      refs (`CAA.HANDLE`) resolve and unresolved/vg-undeclared know which roots to skip (this is the real
      "library floor", and it unblocks `unresolved-identifier` + `vg-undeclared`); (2) the keyword/pragma
      catalogs + per-vendor equivalence (unblocks the opt-in unknown-pragma lint).
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
        — removed a real BOOL→INT corpus FP). **Corpus 0-FP gate now covers VG code diagnostics ✅.** Deferred:
        `vg-undeclared-identifier` (waits on the F.1 library/device catalogs to stay FP-free, like ST's
        unresolved check) + mirroring narrowing/binary-operator checks (not yet factored into per-pair helpers).
  - [~] F.2d **services** — the graphical branch: `vgResolveAt` (cursor→symbol via the SAME
        `exprAtOffset`/`memberAtOffset` descent + `resolveMemberChain`/`lookup`, wrapping VG operands as
        synthetic statements) + **hover** (incl. inferred wire type, reference-catalog fallback) · **definition**
        · **type-definition** · **completion** (POU vars + network wires + members + keywords). Reuses the ST
        cores (`symbolHover`, `completionAtScope`, `locationOf`). Server routes position queries by `inVgBody`.
        Outline ✅. Deferred: references/highlight/rename ACROSS VG bodies (need VG occurrence scanning) +
        semantic tokens for VG.
  - [x] F.2e **CFC/SFC marker** — `vgMarkerHover` explains a `(* @volt-graphical: <LANG> *)` body (authored in
        the IDE, no editable text form); wired as the ST-hover fallback. The marker is a comment → not analyzed
        as VG or ST, zero diagnostics (spec L403-413).
  - [~] F.2f **tests/corpus/conformance** — 24 graphical unit tests (parse · structure · infer · checks ·
        hover/def/completion/resolve · marker) + corpus VG parse gate + corpus 0-FP gate (incl. VG sink checks)
        + 3 server e2e (VG diagnostics · VG hover routing). 130 suite green, conformance held (230 TC/227 CS),
        layering clean, oxlint 0 errors. Pending: live-bridge record pass to lock the PROVISIONAL VG structural
        messages + any vg-undeclared wording (batched with the D.3 overflow/subrange lock, T.1).
  Status: F.2a·b·e DONE; F.2c·d·f substantially done (the code-correctness layer — infer · sink type-check ·
  hover · def · completion · nav — ships at ST parity). Remaining follow-ons: vg-undeclared (needs F.1
  catalogs) · references/rename across VG · VG semantic tokens · narrowing/binary VG checks · live-bridge
  message lock. ST bodies unaffected throughout.

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
