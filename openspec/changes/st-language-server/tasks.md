Build order = the layer stack, bottom-up. Invariant for EVERY task: `cd packages/volt-lsp-iec && bun test` +
`bun typecheck` + corpus 0-error + conformance replay green before its commit. Freeze a layer's contract →
verify → let the next consume it.

## A. syntax
- [ ] A.1 Complete AST: structured type-expr dims/length/subrange/vector, literals with value+type, initializers
      as expression trees, clean qualified names.
- [x] A.2 Subrange bounds retained in the AST.
- [ ] A.3 Parser produces the complete nodes (error-tolerant driver + treewalker). Gate: body-AST corpus 100%,
      `parse(format(x))≡parse(x)`, format-corpus + fuzz green.

## B. symbols
- [ ] B.1 `binder` (AST → scope tree, workspace cross-indexed) via one `makeScope`; the EXTENDS post-pass split out.
- [ ] B.2 `scope-nav` — the one scope-tree navigator. Keep `qualified_only` resolution independent of type isolation.

## C. types
- [x] C.1 `elementary` — the type-facts SSOT + golden test (derived views reproduce the legacy sets exactly).
- [ ] C.2 `type` (rich model, `UNKNOWN` total fallback) + `resolve` (reads structured AST facts).
- [ ] C.3 `const-eval` (literals valued in A; folds unary/const-ref/const-arith; `bigint`; non-const→undefined).
- [ ] C.4 `infer` — the one engine (`inferExprType` the public entry).
- [ ] C.5 `compat` — the one relation (assignable/narrowing/arith/conversion). Golden test across the full
      elementary cross-product. `render` — the one parameterized renderer (exact-output assertion per call site).
- [ ] C.6 A conservative-skip invariant: any `Type` with an unresolved sub-part yields skip at every consumer.

## D. analysis
- [ ] D.1 `diagnostics` orchestrator + `config` (vendor + opt-in lints) + `messages` (per-vendor builders).
- [ ] D.2 checks grouped `types/ · declarations/ · names/ · oop/ · pragmas/`, each thin on `compat`/`infer`,
      each traced to a conformance fixture recorded against CODESYS + TwinCAT.
- [ ] D.3 The full type-checker rule set (subrange/overflow/array-bounds/composite-shape/member-count/…) —
      fixture → record → mirror → replay green; corpus 0-error.

## E. services
- [ ] E.1 `shared` (`resolve-at`, `locations`, `symbol-kinds`+`humanKind`, `token-scan`). One resolution
      semantics; one kind label everywhere (hover↔completion parity test).
- [ ] E.2 navigation (definition·type-definition·references·rename·prepareRename·highlight·implementation) all via
      `resolve-at`; `hierarchy` (call+type, incoming-calls type-aware with a member-call negative test).
- [ ] E.3 `assist` (hover·completion+resolve·signature-help), `inlay-hints`, `code-lens`, `semantic-tokens`,
      `structure`, `formatting` (print·editorconfig·on-type·range), `code-actions`.

## F. reference · graphical
- [ ] F.1 `reference` catalogs; ranges derive from `types/elementary`.
- [ ] F.2 `graphical` — native by reuse: surface (`text/`) + `infer` adapter onto `types` + graph-structure
      checks (via the shared orchestrator) + the graphical branch of the services.

## G. server
- [ ] G.1 LSP 3.17 / stdio, vendor-keyed; push+pull diagnostics, progress, cancellation, incremental sync.

## Testing · backend
- [ ] T.1 `test/conformance/` (catalog · record · recordings · replay) + `test/corpus/` ratchet + co-located
      unit tests. Message parity byte-identical per vendor is the single criterion.
- [ ] X.1 (future) `transpile/rust/` + `test/exec/` — transpile a POU, build, drive scan cycles, assert I/O.

## Land
- [ ] Z.1 Full suite + typecheck + corpus 0-error + conformance replay green; `check-divergence` clean; sync the
      `st-language-server` spec + archive.
