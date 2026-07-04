# Volt LSP-ST — test layout

The suite is built around one principle: **every language feature is proven, and each thing is tested exactly one way.** Three layers, each with a distinct job — no feature is covered two ways.

```
volt-lsp-iec/src/tests/
├── support/          shared test helpers (buildProject / diagnosticsFor — used by every diagnostics test)
├── unit/             pure-function tests: parser, lexer, semantic checks, resolver, symbol-table, type-infer, reference, VG, formatter
├── scenarios/        end-to-end LSP queries against a constructed Workspace
│   ├── queries/      nav features: definition, references, completion, hover, semantic-tokens, rename, namespace, navigation-queries
│   └── server/       LSP protocol — initialize, didOpen, didChange, routing
├── conformance/      the compiler-oracle layer
│   ├── fixtures/     the FEATURE CATALOG — LanguageTest cases organized BY LANGUAGE PRINCIPLE (operators, data-types, conversions, interfaces, oop, lifecycle, pragmas, …)
│   ├── language.test.ts  diffs LSP diagnostics vs recorded compiler ground truth
│   ├── recordings/   expected-{codesys,tc}.json — the compiler's per-object diagnostics
│   └── corpus/       the 5 nav queries with no assertion twin (code-action, document-highlight, folding-range, selection-range, signature-help)
└── real-corpus.test.ts   the SAFETY NET — the 4 committed real projects
```

`src/tests/conformance/` carries the public `./conformance` package export (`fixtures/`, `types.ts`, `index.ts`, `recordings/`).

## The model — how a feature is verified

1. **Semantics (diagnostics) → the feature catalog verified against the live compiler.**
   `conformance/fixtures/` is a catalog of cases grouped by IEC language principle. Each case's diagnostic outcome is checked against the **real CODESYS/TwinCAT compiler** (the oracle): the compiler's diagnostics are recorded (`recordings/expected-{vendor}.json`) and `language.test.ts` asserts the LSP agrees on the same source, per vendor (documented `KNOWN_DIVERGENCES` excepted). Adding a language feature = **add a catalog case + re-record**. The `unit/` diagnostics + `check-*` tests are the fast inner loop for the same checks (via the `support/` helper); the catalog+oracle is the authority.

2. **Navigation (def / hover / completion / references / rename / …) → assertion tests.**
   The compiler gives no go-to-definition or hover ground truth, so nav can't be bridge-verified. Each nav query has **one** authoritative assertion test under `scenarios/queries/` (correctness checks: cross-file resolution, member chains, positions). The 5 queries with no natural assertion form keep a single snapshot under `conformance/corpus/` — that snapshot IS their one mechanism, not a duplicate.

3. **The 4 real projects → the safety net.**
   `real-corpus.test.ts` runs over `test-corpus/{pro2193, bakon-nano, awa-palletizer, lenze-mid}` (they compile clean in the IDE, so any diagnostic is a false positive). It ratchets parse/ingest/precision/body-AST floors. **When the corpus surfaces a miss the feature tests didn't — the fix is to add a feature test, not just move a threshold.**

That's the whole loop: **feature test ⇄ live compiler** for semantics, **assertion** for nav, **corpus** as the net, **corpus gap → new feature test.**

## Adding a test — the decision

- New semantic/diagnostic behavior? → add a **catalog case** in `conformance/fixtures/<principle>.ts` (and a fast `unit/` case via `support/diagnosticsFor` if you want an inner-loop check). Re-record against the bridge.
- New nav-query behavior? → one **assertion** in `scenarios/queries/`.
- A pure module (parser/lexer/resolver/…) in isolation? → `unit/`.
- Corpus surfaced a false positive / miss? → promote it to a catalog or assertion feature test.

Do NOT add a second mechanism for a feature already covered (no snapshot-plus-assertion of the same query).

## Running

```sh
bun test                              # everything
bun test src/tests/unit/              # fast inner loop
bun test src/tests/scenarios/         # nav queries + server protocol
bun test src/tests/conformance/       # catalog oracle + the 5 corpus-only queries
bun test src/tests/real-corpus.test.ts   # the safety net
```

Re-record the compiler ground truth (needs a live bridge — `volt-scripts/codesys-bridge.ps1 up`):

```sh
bun run record:language               # CODESYS (:8556) / TwinCAT (:8555) by port
```

> The `record:language` recorder is being restored into this package (it left with `volt-agent`); until then the recordings are frozen. See openspec `clean-lsp-test-architecture` §4.
