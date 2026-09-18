# Design — the topic tree, and how a cell becomes a fixture

## The tree is derived from the language, not from the fixtures

This is the whole idea. If the tree were built by reading the 1,002 fixtures and grouping them, it would reproduce
exactly the blind spots it exists to find — a topic nobody thought of would have no fixtures and therefore no node.

So each topic's **subtopic axes come from a source that is not us**:

| topic family | the axes, and where they come from |
|---|---|
| operators | the operator table in `src/syntax` × the 20 elementary types in `src/types/elementary.ts` |
| conversions | `<A>_TO_<B>` over the same 20 types, plus the `TRUNC` / `REAL_TO_*` family |
| declarations | the `VarSectionKind` union × type category (elementary, struct, enum, array, FB, pointer, reference) |
| call shapes | callee kind (FUNCTION / FB / METHOD / ACTION / PROPERTY / library) × argument form (positional, named, output-binding, VAR_IN_OUT, omitted, EN/ENO) |
| attributes / pragmas | `src/reference/pragmas.ts`, which already enumerates them per vendor |
| literals | `LiteralKind` × the typed-prefix forms |
| statements | the statement kinds in the AST |

A cell is `(topic, subtopic, case)` — e.g. `operators / unary minus / operand is LWORD`. The product is large and
most of it is uninteresting; **the tree records which cells are interesting and why**, and that judgement is written
down per topic rather than left implicit.

## The probe pattern

`fixtures/unary-operand.ts` is the worked example and the template:

```ts
function probe(slug, op, decl, outType, refused) { … }        // one cell -> one fixture
const neg = (slug, decl, refused) => probe(`uop_neg_${slug}`, "-", decl, "STRING", refused)
```

Three properties make it work, and all three are load-bearing:

1. **One cell per fixture.** `neg("lword", "x : LWORD := 1;", …)` asks exactly one thing. A fixture that exercises
   three types at once cannot report which one is wrong.
2. **The destination is deliberately incompatible.** Assigning `-x` into a `STRING` forces CODESYS to name the type
   it inferred in order to complain about it. Without that trick, a correct-looking program compiles and tells us
   nothing — which is how `-SINT` went unmeasured.
3. **The recorded answer lives in the fixture.** `refused` carries the vendor's own message, and the file header
   carries the whole table. Reading one entry tells you what was asked and what came back.

## How a cell is closed

A cell is closed when it holds one of:

- **a recorded answer** — the fixture exists, `bun run record:exec` has an entry, `evidence` is `confirmed`,
  `refused`, `not-lowered` or `diverges`;
- **an `execSkip`** saying, in its own words, why the vendor cannot be asked. The existing rule stands: this is
  NOTHING TO MEASURE or NOTHING TO COMPARE, never a recorder that is merely unfinished;
- **a written "not interesting"** on the topic's node, with the reason. `INT_TO_INT` needs no fixture and the tree
  should say so once, rather than leave a hole that looks like an oversight.

`unasked: 0` in `confidence.test.ts` is the standing gate and does not move.

## Where the tree lives

A generated report, not a hand-maintained document — a hand-maintained one drifts, and the first thing it would
drift out of alignment with is the fixture set it describes.

`scripts/fixture-census.ts` reads `ALL_TESTS` plus the topic definitions and prints the tree with each cell's
status, the same way `rate-fixtures.ts` reads the recordings. A test asserts every defined cell is closed, so a
newly defined cell is red until it is answered — the mechanism that drove `unasked` to zero, pointed at topics
instead of at individual fixtures.

## Ordering

Topics go in the order of **how much of the transpiler and the LSP depend on them**, which is roughly:

1. **conversions** — 20×20, the largest single surface, and `real_to_dint_below_range` is already a known
   divergence sitting in it;
2. **operators** — binary as well as unary; the unary family is done and is the evidence this works;
3. **declarations and initialization** — the enum-default rule was measured this way and found the vendor picks the
   ZERO enumerator, which nobody would have guessed;
4. **call shapes** — the biggest source of `not-lowered` blockers right now;
5. the rest.

Each topic is a commit: define the cells, generate the fixtures, record, implement what the answers demand, close.
