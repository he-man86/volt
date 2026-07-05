## Context

A clean, from-scratch layered language server. Folders are layers; imports point downward only
(`syntax ← symbols ← types ← analysis ← services ← server`), a lint-enforceable invariant. Built bottom-up:
freeze a layer's contract, verify against the tests, then let the next layer consume it. The detailed blueprint
is `specs/language-server/architecture.md`.

## Goals / Non-Goals

**Goals** — a complete AST that models IEC fully; one type system (facts SSOT + `Type` model + inference +
const-eval + compatibility + rendering) reused by every backend; byte-identical diagnostic messages vs
CODESYS + TwinCAT; the graphical FBD/LD sublanguage native by reuse; a Rust transpile backend for headless
tests; the modern LSP 3.17 feature set.

**Non-Goals** — not the authoritative type-checker or a compiler (the IDE owns final type-checking + codegen);
no protocol break; no parallel stacks (graphical and transpile consume the shared frontend, not their own).

## Decisions

### Layer stack

```
server        LSP 3.17 / stdio · push+pull diagnostics · progress · cancellation
graphical · reference   FBD/LD sublanguage (native by reuse) · language data catalogs
services      navigation · hierarchy · hover/completion/signature-help · inlay-hints · code-lens ·
              semantic-tokens · structure · formatting · code-actions
analysis      diagnostics orchestrator · messages · checks (thin rules)
types         elementary facts · Type model · resolve · const-eval · infer · compat · render
symbols       symbol table · binder · scope-nav
syntax        tokens · lexer · complete AST · parser + treewalker
   ↘ transpile (Rust backend) consumes syntax·symbols·types directly — headless test execution
```

### Frontend contracts

- **`syntax`** — `parse(source) → { units, diagnostics }`; error-tolerant; the AST carries structured
  type-expr bounds/lengths/subrange/vector, literals with value + type, initializers as expression trees.
- **`symbols`** — the binder builds the scope tree (workspace cross-indexed); `scope-nav` is the one navigator.
- **`types`** — `elementary` is the sole type-facts source (family, bits, signed, `bigint` range, rank,
  aliases, `ANY_*`); `Type` is the rich model with `UNKNOWN` as the total conservative fallback; `infer` is
  the one inference engine; `compat` the one compatibility relation; `render` the one type renderer; `const-eval`
  folds constants. Powers diagnostics, hover, completion, navigation, and codegen alike.

### Backends consume, they don't duplicate

`analysis`+`services` (the LSP), `graphical` (FBD/LD readable text — imports `types`/`services/shared`, adds
only the graph surface + structure checks; one type engine, one orchestrator), and `transpile` (AST + resolved
types + const values → Rust; `transpile/rust/` an umbrella for future targets) are independent consumers of the
frontend.

### Config

Minimal and meaningful: `vendor` (`codesys | twincat | auto`) plus a small opt-in set of stricter-than-compiler
lints (all default off). Compiler-mirroring diagnostics are not individually configurable — they are what the
compiler does. Client capabilities (e.g. snippet support) come from the protocol, not config.

### Testing designed in

`test/conformance/`: `catalog/` (one fixture per rule) → `record.ts` (push to the live bridge, build, capture
the compiler's exact diagnostics) → `recordings/` (committed oracle truth) → `replay.test.ts` (offline; message
set byte-identical per vendor — the single criterion; `KNOWN_DIVERGENCES` the only opt-out). `test/corpus/` is
the real-project ratchet (a miss ⇒ add a fixture); unit tests co-locate with modules; `test/exec/` runs
transpiled Rust. A diagnostic cannot ship unless its message matches both compilers.

## Risks / Trade-offs

- **Behavioral drift while building** — the full suite + corpus 0-error + conformance replay are the spec; green
  before every commit.
- **Getting the IEC type lattice right** — driven from the reference docs + the live-compiler oracle, never
  invented; fixtures are recorded before a rule ships.
- **64-bit ranges vs JS number** — `bigint` in `elementary`/`const-eval`.
