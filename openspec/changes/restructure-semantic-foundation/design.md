## Context

The audit findings (proposal) show the debt is concentrated in the type/semantic layer: facts and policy are
duplicated and leak across layers (a *reference* catalog owns compatibility policy; a *check* owns the type
lattice and is imported by another check; queries re-inline the resolution service). The parser AST is sound —
its only gap is discarding type-relevant scalars (subrange bounds) that a typechecker needs. The 3594-test
suite + corpus + conformance replay encode the oracle-calibrated behaviour and are the migration invariant.

## Goals / Non-Goals

**Goals**
- A clean **layered** architecture with **one source of truth per concern** and no upward leakage.
- A self-contained, independently-testable **type-system** module that the typechecker builds on directly.
- Consumers (checks + queries) become thin: they call services, they don't re-implement them.
- Behaviour-preserving except three audited bug fixes (below), all covered by tests.

**Non-Goals**
- No parser rewrite (additive subrange capture only). No new diagnostics (that is `st-static-typechecker`).
- Not standardizing every check signature (R6) nor unifying VG's inference (both deferred, noted).
- No wire/protocol/API change; `inferExprType` stays the entry point (richer return).

## The base layer is the foundation — it must be pro FIRST

The type-system and the formatter both stand on the parser/AST/treewalker. Today that base uses an
"opaque `BodySpan` + let each consumer re-parse" pattern for every type-relevant scalar, and both complex
consumers work around it (the formatter reprints types/inits/`AT` verbatim from source spans; `const-eval`
would re-parse the same spans). That is "complex feature on top of a shaky base" — the mistake this rebuild
must not repeat. So **Phase 0 makes the base a pro implementation**: the AST models the language completely, so
consumers read structured, evaluated nodes — never raw tokens.

Base-layer upgrades (AST model + the parser code that produces the nodes; the lexer and the overall parse
driver are sound and stay):

- **Type expressions become structured, not opaque.** `ArrayType.dims` → parsed `{lower, upper}` bound
  expressions; `StringType.length` → parsed length; **`SubrangeType` modeled** (bounds parsed, not discarded);
  `__VECTOR` a proper node (`size`, `element`), not a lossy array. Enum member values parsed.
- **Literals carry a value + precise type.** `Literal → { text, kind, value, type }` — `16#FF`, `INT#40000`,
  `3.14`, `T#5S` parsed to their value/type at parse time (integers as `bigint`), not left as strings for every
  consumer to re-scan.
- **`VarDecl.init` parses into the expression tree** (not a `BodySpan`), so the formatter prints it canonically
  from the AST and the typechecker type-checks it directly — one parse, many consumers.
- **Clean qualified names** — resolve the `NamedType` qualifier inversion so namespace resolution reads
  naturally.

This is the KEY DIFF of the clean impl: a base that fully models IEC 61131-3, so formatting and typechecking are
thin readers of a complete AST — not re-parsers of spans. It is done first; everything else consumes it.
Blast radius is real (every check/query/formatter reads these nodes), so it migrates node-by-node with the
suite (body-AST 100%-clean, formatter round-trip, conformance replay) green at each step.

## Target architecture

```
── PHASE 0: base layer (pro) ───────────────────────────────────────────────────────
lexer (sound) → parser → AST (COMPLETE: structured dims/length/subrange/vector, literals with
                                value+type, init as expression tree, clean qualifiers)
              → treewalker (statement/expression AST — the shared base for formatter + typechecker)
  │
  ▼  ── semantic/type-system/  (the clean core — one SSOT per concern) ──────────────
  │     elementary.ts     name → { canonical, family, bits, signed, range:bigint, rank, aliases }
  │                       + ANY_* generic families.  THE source of truth for type facts.
  │     type.ts           the rich `Type` model (elementary+facts | subrange | array | string |
  │                       enum | struct/fb | alias | pointer/ref | unknown) + constructors.
  │     resolve.ts        declared `TypeExpr` → `Type`   (was `type-resolver` + `typeExprToInferred`)
  │     infer.ts          `Expr` → `Type`                (ONE inference engine; was `type-infer`)
  │     const-eval.ts     `Expr`/`BodySpan` → `ConstValue`  (new; folds literals + const exprs)
  │     compat.ts         assignable / narrowing / arithResult / conversionSource  (was `isAssignable`
  │                       in a check + `isAcceptableSource` in reference + inline narrowing)
  │     render.ts         `Type`/`TypeExpr` → display string  (ONE parameterized renderer; was 4+)
  │
  ▼  ── semantic/  (services over the model + symbol table) ──────────────────────────
  │     symbol-table(.build)   scopes & symbols  (build split via one `makeScope` helper)
  │     scope-nav.ts           scope-tree navigation SSOT  (was 6+ re-impls)
  │     symbol-resolve.ts      `symbolAtOffset`/`symbolAndRangeAtOffset`  (shared by checks + queries)
  │     diagnostics.ts         orchestrator
  │     checks/                thin rules on type-system + services
  │
  ▼  ── lsp/queries/  (thin over services) ───────────────────────────────────────────
        shared: locations.ts (`locationOfSymbol`), symbol-kinds.ts (3 mappers + one `humanKind`),
                token-scan.ts (`tokenAt`, `enclosingCall`), hierarchy.ts (call+type shared core)
        + extracted: config/editorconfig.ts (out of format.ts), hover-annotations.ts (out of hover.ts)
```

**Layer rule:** facts flow *up* only. `reference/` = human-facing data catalogs (hover content, conversion
pairs) — it may *read* the type-system but never owns policy. `type-system/` = the model + relations, no LSP
or check imports. `checks/` and `lsp/queries/` = consumers.

**`reference/data-types.ts`** stays (vendor/source/gotchas/examples hover content) but its *"Range …"* prose is
DERIVED from `type-system/elementary.ts`, and its dead second `TypeFamily` enum + 4 shadowed alias entries are
removed — so range numbers live in exactly one place.

## Decisions

### The `Type` model (`type-system/type.ts`)

Replaces `InferredType` with a discriminated union that carries checkable facts (per `st-static-typechecker`
design task 0): elementary `{name, family, bits, signed, range}` · `subrange{base, min, max}` ·
`array{element, dims}` · `string{wide, maxLen}` · `enum{scope, members}` · `struct|function_block{scope}` ·
`alias{underlying}` · `pointer|reference{target}` · `unknown`. `UNKNOWN` stays the total-function fallback
(zero-FP). Facts are read off the already-carried `typeExpr` + the elementary table + `const-eval`, not stored
redundantly. A compatibility shim keeps `.name`/`.scope`/`.typeExpr` accessors during migration so consumers
move incrementally.

### Consolidation map (what deletes onto what)

| Deleted / merged | Into |
|---|---|
| `NUMERIC_RANK`, `ISOLATED`, both `ENUM_ISOLATED` (check-assignment-types) | `elementary.ts` (rank/family) + `compat.ts` |
| `INTEGER_TYPES`, `NUMERIC_TYPES` (check-binary-operators) | `elementary.ts` (family/`isNumeric`) |
| `ELEMENTARY_TYPES` set (type-resolver) · `ELEMENTARY_TYPES` array (type-conversion) | `elementary.ts` (`elementaryType`, generic table) |
| `ELEM_ABBREV`, `DATETIME_TYPES`, `DURATION_TYPES` (type-infer) | `elementary.ts` (aliases + family) |
| `isAssignable` (check) · `isAcceptableSource` (reference) · inline narrowing · `temporalArithResult` | `compat.ts` |
| `renderTypeExpr`, hover `typeText`, code-action `typeExprToString`, vg `renderType`/`simpleType` | `render.ts` (parameterized) |
| `bodyOf`×3, `pouBody` | `getAnyBody` (already exported) |
| `findUriForUnitByName`, `findUnitByName`, inline `"name" in unit` guards | one workspace `findUnitByName` + `getUnitName` |
| CallHierarchyItem/TypeHierarchyItem + builders + prepare | `hierarchy.ts` shared core |
| symbol→Location (×7) | `locationOfSymbol` |
| 6+ scope-tree walks | `scope-nav.ts` |
| `lspSymbolKindFor` / `lspKindForSymbol` / `tokenTypeForSymbol` + `humanKind`×2 | `symbol-kinds.ts` (one `humanKind`) |

### Bug fixes carried by the migration (each gets a test)

1. `humanKind` unified → hover and completion show the same words.
2. `definition`/`hover` delegate to `symbolAtOffset` → nav semantics can't drift from references/rename.
3. `call-hierarchy incomingCalls` uses type-aware `findReferences` → same precision as references.

### Parser: subrange capture (`type-expr.ts:183`)

The `(lo..hi)` after a named type is already fully consumed with a depth counter then discarded. Retain it as
`NamedType.subrange?: { lower: BodySpan; upper: BodySpan }` (additive; a `..`-containing constraint only — an
FB-init `(a := b)` yields no subrange). `resolve.ts` reads it into `Type.subrange` via `const-eval`.

### Dead code removed

`conversionsForSource` (0 callers), over-exported `findSymbolByName`, `void parseResult`, duplicate
`ENUM_ISOLATED`, dead long-form date entries, `data-types.ts` dead family enum + 4 shadowed aliases,
`semantic-tokens` always-0 mods, `folding-range` duplicate `type_decl` branch. Also: `type-conversion.ts`
linear `.find`/`.filter` → the existing `TYPE_CONVERSIONS` Map.

## Migration approach (the invariant)

Per area: **build the clean module → route consumers → delete the duplicates → `bun test` + `bun typecheck` +
corpus ratchet green → commit.** Never a big-bang; each commit is independently green. The order (tasks) puts
the SSOT first (everything derives from it), then compat, then services, then query dedup, then splits, then
subrange. A shim on `Type` lets consumers migrate a few at a time without a flag day.

## Risks / Trade-offs

- **Behaviour drift during consolidation.** *Mitigation:* the 3594 tests + corpus 0-FP + conformance replay
  are the spec; each step must keep them green, and the three bug fixes get dedicated tests so they're
  intentional, not accidental.
- **64-bit ranges vs JS number.** *Mitigation:* `bigint` in `elementary.ts`/`const-eval`.
- **Scope creep.** *Mitigation:* Non-Goals fence off R6 (check-signature standardization) and VG unification as
  explicit follow-ups.
- **Merge conflicts with in-flight `st-static-typechecker`.** *Mitigation:* this lands first; that change
  rebases to consume the delivered core.
