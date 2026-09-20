# The fixture tree

**The folder IS the topic tree.** A file lives under the thing it asks the vendor about, so an empty or thin folder
is a visible gap rather than an invisible one. That is the whole reason for the shape — see
`openspec/changes/fixture-census`.

| folder | what it asks about |
|---|---|
| `types/` | what a type IS — declaration, default, width, boundaries, literals, DUTs |
| `operators/` | what an operator PRODUCES and what it refuses, per operand type |
| `conversions/` | `<A>_TO_<B>`, implicit conversion, the CHECK functions |
| `declarations/` | VAR sections, initializers, lifetimes, shadowing, identifiers, keywords |
| `calls/` | call shapes — argument forms, VAR_IN_OUT, interface calls, routine state |
| `oop/` | interfaces, inheritance, methods, properties, FB lifecycle |
| `memory/` | pointers, references, `ADR`/`SIZEOF`, direct addresses, layout |
| `pragmas/` | attribute pragmas, both vendors', and conditional compilation |
| `graphical/` | network text (FBD/LD) — the non-ST sublanguage |
| `cross-object/` | one fixture reaching another object: GVLs, DUTs, signature names |
| `semantics/` | whole-program behaviour that is not one construct — execution order, catalog wording |
| `batches/` | **not a topic.** See below. |

## `batches/` is the honest name for what is left

`check-coverage.ts` through `check-coverage-six.ts` are named after **the batch they arrived in**, not after
anything they ask. There were more: `cross-object-two/-three/-four` and five `corpus-*` files, which at least named
a real subject and are filed under it.

A provenance name is not a topic, and a set grouped by provenance cannot answer *is this finished?* — which is how
four unary-operator fixtures came to look like coverage while thirty-five systematic probes found a different rule
and two product bugs. **`batches/` should shrink to nothing.** Each of its fixtures belongs under a topic above;
moving one is a small, safe commit, and nothing here is deleted for being redundant.

## Adding a fixture

1. Put it under the topic it asks about. If there is no such topic, the tree is missing one — add it.
2. **Record before implementing.** An implementation written first decides what the fixture asks.
3. One question per fixture. A fixture that exercises three types at once cannot report which one is wrong.
4. Put the vendor's own message in `refused`, and a whole recorded table in the file header when the file is a
   generated family (`operators/unary-operand.ts` is the worked example).
5. A fixture that declares nothing `PLC_PRG` can read is **silently skipped by the recorder** — give it a
   `plcPrgVar`, or say in `execSkip` why it cannot be asked.

`evidence.generated.ts` is written by `scripts/rate-fixtures.ts` and checked by `fixtures.test.ts`; never edit it
by hand.
