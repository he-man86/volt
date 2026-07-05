# ST Language Server — architecture & build order (empty → full)

**What this is.** The blueprint for `volt-lsp-iec` as a *clean, layered* implementation, and the **dependency
order** to build it from nothing to the full-featured LSP. Each layer has ONE responsibility and ONE public
contract; a layer depends only on the layers below it. You build bottom-up: freeze a layer's contract, verify
it, then let the next layer consume it. Nothing higher reaches around a layer to touch a lower one.

**Why an ordered blueprint.** The current LSP works (3594 tests green) but grew organically — the base uses
"opaque token spans + let each consumer re-parse," and type facts / compatibility / renderers are duplicated
across 5–7 sites. Complex features (formatter, typechecker) were bolted onto that base, so each re-implements
what a complete base should have handed it. The clean rebuild inverts this: **a professional base first**, then
thin consumers. The existing code + its tests are the *reference and the behavioral spec* — every layer must
keep `bun test` + corpus ratchet + conformance replay green as it's rebuilt.

**How to read the tables.** Each module lists: **Contract** (what it exposes), **Depends** (lower layers it
uses), **Verify** (the tests that pin it), **Build** (🟢 reuse largely as-is · 🟡 consolidate/upgrade ·
🔴 rebuild clean). The order within a phase is itself dependency-ordered.

---

## Professional folder structure (the target — folders ARE the layers)

The rebuild targets this tree. Each folder is one architecture layer; imports only ever point *downward*
(a lint-able invariant). The current `lexer/ parser/ semantic/ lsp/` layout blurs the layers — that blur is
what let type facts and compatibility policy leak across files. Build each layer fresh INTO this tree; the old
folders stay as reference until a layer is fully subsumed, then are deleted.

```
src/
├── syntax/            # A — lexical + syntactic. NO semantics, no symbol table, no types.
│   ├── token.ts           TokenKind · Token · trivia
│   ├── lexer.ts           source → Token[]
│   ├── ast.ts             the COMPLETE AST (declarations · type-exprs structured · statements · expressions ·
│   │                      literals with value+type)
│   ├── parser.ts          parse(source) → { units, diagnostics } — the driver
│   ├── parse/             grammar modules: declarations · types · statements · expressions
│   └── cursor.ts          cursor + parse utils
├── symbols/           # B — binder. Names & scopes over the AST.
│   ├── symbol.ts · scope.ts
│   ├── binder.ts          AST → scope tree
│   └── scope-nav.ts       the ONE scope-tree navigator
├── types/             # C — the type system. The clean core.
│   ├── elementary.ts      type-facts SSOT
│   ├── type.ts            the Type model
│   ├── resolve.ts         TypeExpr → Type      · infer.ts   Expr → Type (one engine)
│   ├── const-eval.ts      Expr → value          · compat.ts  assignable/narrowing/arith/conversion
│   └── render.ts          Type/TypeExpr → string (the ONE renderer)
├── analysis/          # D — diagnostics.
│   ├── diagnostics.ts     orchestrator          · messages.ts  per-vendor message builders
│   └── checks/            the rules (thin), grouped: types/ · declarations/ · names/ · oop/ · pragmas/
├── services/          # E — LSP language services (features), thin over C/D.
│   ├── resolve-at.ts      cursor → symbol/scope/token (shared by every position query)
│   ├── navigation.ts · hierarchy.ts · hover.ts · completion.ts · signature-help.ts · semantic-tokens.ts
│   ├── document-symbol.ts · folding.ts · selection.ts · code-actions.ts
│   ├── formatting/        format.ts + editorconfig.ts
│   └── shared/            position · locations · symbol-kinds (+ humanKind) · token-scan
├── reference/         # F — language reference catalogs (hover/completion DATA; ranges derive from types/)
├── graphical/         # F — the VG sublanguage (ast · parser · infer-adapter · checks · render)
├── server/            # G — LSP 3.17 / stdio · dispatch · capabilities
├── index.ts           # the public API surface (what volt-git + vscode + the harness import)
└── test/              # mirrors the src tree
```

Dependency rule (enforceable): `syntax ← symbols ← types ← analysis ← services ← server`; `reference` and
`graphical` sit beside/above `types`; nothing imports `services` except `server`. If a file needs something
from a higher layer, the layering is wrong — fix the layering, don't add the import.

## The stack (bottom → top)

```
G  Integration     server (LSP 3.17 / stdio, vendor-keyed) · conformance harness (record+replay) · corpus ratchet
F  Sublang+catalog  reference catalogs (types/ops/conversions/pragmas/fns/fbs) · VG graphical sublanguage
E  LSP features     nav (def/refs/rename/highlight/hierarchy) · display (hover/completion/sig-help/tokens) ·
                    structure (symbols/folding/selection) · formatting · code-actions
D  Semantic         symbol-resolve service · diagnostics orchestrator · the checks (thin rules)
C  Type system      elementary SSOT · Type model · resolve · const-eval · infer · compat · render
B  Symbols          symbol table + scope tree · scope-nav
A  Base (PRO)       tokens+lexer · AST (complete) · parser+treewalker
```

Dependency rule: **A ← B ← C ← D ← E**. F (catalogs + VG) is data/side-language woven in from C upward.
G (server + harness) wraps the whole and is stood up early as a thin shell, filled as features land.

---

## Phase A — Base layer (the pro foundation)

The one non-negotiable: the AST **fully models IEC 61131-3**, so every consumer reads structured, evaluated
nodes — never raw tokens it must re-parse. This is the key diff of the clean impl.

| Module | Contract | Depends | Verify | Build |
|---|---|---|---|---|
| **tokens + lexer** | `lex(source) → Token[]` incl. trivia (comments/pragmas/`%FOLDER`), position spans, error-tolerant | — | lexer tests | 🟢 reuse |
| **AST model** | complete node types: declarations; **type expressions structured** — `ArrayType.dims:{lower,upper: Expr}`, `StringType.length: Expr`, **`SubrangeType{base,lower,upper}`**, `VectorType{size,element}`; **`Literal{text,kind,value,type}`** (value parsed, ints `bigint`); **`VarDecl.init: Expr`** (not a span); clean qualified names | tokens | AST shape tests | 🔴 rebuild (complete the model) |
| **parser + treewalker** | `parse(source) → { units, errors }`; error-tolerant (partial tree on bad input, precision never regresses); the statement/expression **treewalker** is the shared base for formatter + typechecker | AST | body-AST 100%-clean corpus test, parse-error tests, `parse(format(x))≡parse(x)` | 🟡 upgrade (produce the complete nodes; keep the parse driver) |

**Invariant carried up from A:** a consumer never re-lexes/re-parses a sub-span. If it needs the value of an
array bound or an initializer, the node already has it.

## Phase B — Symbols & scopes

| Module | Contract | Depends | Verify | Build |
|---|---|---|---|---|
| **symbol table + build** | `buildSymbolTable(units) → Scope tree`; symbols carry name/kind/typeExpr/uri/spans; workspace cross-indexed | A | symbol-table tests, corpus ingest 100% | 🟡 split the 15 `ingest*` into one `makeScope` |
| **scope-nav** | `findChildScopeByName` · `findScopeBySpan` · `walkScopes` — the ONE scope-tree navigator | table | reuse existing nav tests | 🔴 new (consolidate 6+ re-impls) |

## Phase C — Type system (the clean core, one SSOT per concern)

| Module | Contract | Depends | Verify | Build |
|---|---|---|---|---|
| **elementary** | `elementaryType(name) → {family,bits,signed,range:bigint,rank,aliases}` + `ANY_*` families; the SOLE type-facts source | — | table tests + **golden test**: derived views == old sets exactly | 🔴 new (SSOT) |
| **type** | the rich `Type` union (elementary+facts \| subrange \| array \| string \| enum \| struct/fb \| alias \| ptr/ref \| unknown); `UNKNOWN` total fallback | elementary, A | constructor tests | 🔴 new |
| **resolve** | `TypeExpr → Type` (reads structured AST facts straight in — no re-parse) | type, B | resolve tests | 🟡 from `type-resolver` |
| **const-eval** | `evalConst(Expr) → ConstValue?` (literals already valued by A; folds unary/const-ref/const-arith; ints `bigint`; non-const→undefined) | A, B | eval + "not-constant" tests | 🔴 new |
| **infer** | `inferExprType(Expr, scope) → Type` — ONE inference engine; unknown on any unresolved sub-part | resolve, const-eval | inference tests, conformance | 🟡 from `type-infer` |
| **compat** | `assignable(src,srcConst?,dst) → Violation?` · `isNarrowing` · `arithResultType` · `conversionSource` — ONE compatibility module | elementary, type | compat unit tests + **golden vs old `isAssignable`** | 🔴 new (merges 3-layer policy) |
| **render** | `renderType(Type\|TypeExpr, opts) → string` — ONE parameterized renderer (was 4) | type | renderer tests | 🔴 new (merge 4) |

**Contract with requirement #1 (conservative, not authoritative):** every relation returns *unknown / no
violation* on any unresolved input — the zero-FP guarantee. The type system informs diagnostics; the IDE stays
the authoritative checker/codegen. "Static typechecker" = this layer; it is not a compiler.

## Phase D — Semantic analysis

| Module | Contract | Depends | Verify | Build |
|---|---|---|---|---|
| **symbol-resolve** | `symbolAtOffset` / `symbolAndRangeAtOffset` — the ONE cursor→symbol service (shared by D + E) | B, C | resolution tests | 🟡 from `symbol-refs` |
| **diagnostics** | orchestrator: run enabled checks over a doc, vendor-keyed config, collect `DiagnosticItem[]` | C | diagnostics tests | 🟡 standardize check signature |
| **messages** | per-vendor message builders (`cannotConvert` + the vendor-wording map) | — | message tests | 🔴 new (centralize) |
| **checks/** (rules, each thin on C + services) | grouped: **type-compat** (assignment/binary/conversion/narrowing/call-arg → `compat`) · **declaration** (subrange/overflow/array-bounds/`POINTER TO BIT`/enum+struct member-count/vector) · **var-section** (placement+modifiers) · **name/shape** (unresolved-id/duplicate/shadowing/identifier) · **OOP** (interface-impl/abstract-inst/lifecycle) · **external-write** · **pragmas** | C, symbol-resolve, messages | each check's fixtures + conformance replay + corpus 0-FP | 🟡 migrate existing onto `compat`; 🔴 new gap checks |

## Phase E — LSP features (thin over C/D services)

| Module | Contract | Depends | Verify | Build |
|---|---|---|---|---|
| **query utils** | `position` map · `locationOfSymbol` · `symbol-kinds` (3 mappers + ONE `humanKind`) · `token-scan` (`tokenAt`,`enclosingCall`) | B | util tests | 🔴 new (dedup 7×/4×/3×) |
| **navigation** | definition · references · rename · document-highlight — all via `symbolAtOffset` (one semantics) | symbol-resolve | nav assertion tests | 🟡 delegate (fix drift) |
| **hierarchy** | call + type hierarchy — ONE shared core; incoming-calls type-aware | symbol-resolve | hierarchy tests | 🔴 merge two files |
| **display** | hover · completion · signature-help · semantic-tokens — via `infer`/`resolve`/`render` | C | assertion + snapshot tests | 🟡 dedup renderers/kinds |
| **structure** | document-symbol · folding · selection-range | B | snapshot tests | 🟢 reuse (drop dead branches) |
| **formatting** | `format(doc)` — prints from the AST (statements/expressions/declarations); round-trip + idempotent + comment-safe | A, render | format-corpus + unit tests | 🟡 extract `editorconfig`; declarations print from structured AST now |
| **code-actions** | quick-fixes + interface/method stub gen | C, render | code-action tests | 🟡 fold `typeExprToString` into `render` |

## Phase F — Sublanguages & catalogs (woven in)

| Module | Contract | Depends | Verify | Build |
|---|---|---|---|---|
| **reference catalogs** | hover/reference data: elementary (ranges DERIVED from C.elementary), operators, conversions (Map-indexed), pragmas, standard fns/fbs, lifecycle | C.elementary | reference tests | 🟡 derive ranges, dedup lists, kill dead entries |
| **VG graphical** | FBD/LD-as-text: parser · type-infer (adapter onto C, not a parallel engine) · code + structure checks · round-trip owned by the bridge | A, C | VG tests | 🟡 later: adapter onto shared infer |

## Phase G — Integration

| Module | Contract | Depends | Verify | Build |
|---|---|---|---|---|
| **server** | LSP 3.17 JSON-RPC over stdio, `--stdio` only; vendor-keyed init (`codesys\|twincat\|auto`); one binary both vendors | E | server/dispatch tests | 🟢 reuse |
| **conformance harness** | recorder (push→build→record per-vendor oracle) + offline replay diff; the corpus ratchet | D | `language.test.ts` replay green | 🟢 reuse |

---

## Build order (the sequence from empty)

1. **A. Base** — tokens/lexer (reuse) → complete AST model → parser produces the complete nodes. *Gate:* body-AST corpus 100%, format round-trip holds.
2. **B. Symbols** — table + `scope-nav`. *Gate:* ingest 100%, nav tests.
3. **C. Type system** — `elementary` (golden) → `type` → `resolve` → `const-eval` → `infer` → `compat` (golden) → `render`. *Gate:* conformance replay + corpus 0-FP unchanged.
4. **D. Semantic** — `symbol-resolve` → `messages` → migrate checks onto `compat`, then add the new gap checks (typechecker rows). *Gate:* all fixtures + conformance + corpus.
5. **E. Features** — query utils → migrate nav/display/formatting/hierarchy onto the services. *Gate:* every query's tests + the 3 bug-fix tests.
6. **F/G** woven throughout; VG-infer adapter and any deferred items last.

Catalogs (F) that feed hover/completion/checks are stood up alongside C (they derive from `elementary`).

## Relationship to the OpenSpec changes

- **`restructure-semantic-foundation`** executes Phases A–C + the D/E service-and-query dedup (behavior-
  preserving + 3 bug fixes). It is the clean-rebuild vehicle; its tasks are this order.
- **`st-static-typechecker`** is the new diagnostic rows in Phase D (overflow/subrange/bounds/…), consuming the
  Phase-C core delivered above.
- **`toolchain-map.md`** stays the *feature-phase* roadmap (diagnostics parity → nav → formatter → perf →
  interpreter); THIS doc is the *structural* blueprint (layers + order). They are complementary axes.

## Invariants (hold at every step)

- The 3594-test suite + corpus 0-error + conformance replay are green before each commit; they are the spec.
- One source of truth per concern (type facts, compatibility, rendering, scope-nav, symbol-resolution, kind
  labels). A second list is a bug.
- Conservative & non-authoritative: unknown types skip; the IDE owns final type-checking + codegen (req #1).
- Additive to the wire/protocol: no consumer API break; `inferExprType` stays the entry point.
