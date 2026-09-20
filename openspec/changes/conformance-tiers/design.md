# Design — four concerns, six files

## The shape

```
test/
  fixtures.test.ts        1. THE FIXTURE CONTRACT — one driver, one row per evidence rating
  corpus.test.ts          2. THE CORPUS — no false positive, lowering is total, self-consistent
  backends.test.ts        3. CROSS-BACKEND — interp vs emitted Rust where no recording reaches
  suite.test.ts           4. IS ENOUGH BEING ASKED — the census and construct coverage
  properties.test.ts      2b. the memory model as properties (no oracle, not corpus-driven)
  catalog.test.ts         1b. the documented error codes, each with its repro
```

Six files, four concerns. Each states its question in its first paragraph. The name is the question, not the
mechanism.

## 1. `fixtures.test.ts` — the fixture contract

One walk over `ALL_TESTS`. For each fixture, its evidence rating names the row to assert:

| rating | asserted |
|---|---|
| `confirmed` | interpreter values == recording, emitted Rust values == recording |
| `refused` | an LSP error exists containing the vendor's message fragment |
| `not-lowered` | lowering refuses, and the code is in the registry |
| `diverges` | still disagrees, and carries `deferred.transpile` saying what was measured |
| `lsp-gap` | the LSP is silent, and the fixture carries `deferred.lsp` |
| `unaskable` | nothing, and `execSkip`/`recorderSkip` says why |

Plus the two ratchets that must only ever move one way: exact message agreement per vendor, and the ceilings per
rating.

**Replaces** `replay.test.ts`, `refused.test.ts`, `transpile.test.ts`, `confidence.test.ts`.

**Why one file and not four:** they already share one input (the fixtures), one derivation (the rating) and one
report. Today each re-selects its own subset, which is why a fixture can be covered by three and a fixture in a
new state by none. A row that no rating maps to is a hole the table shows; four selections cannot show it.

**Cost:** it is the expensive one (rustc for every lowering case, bounded to one process per core). It stays its
own file precisely so it can be run alone.

## 2. `corpus.test.ts` — real code, no recordings

One walk over 29,359 files, three questions:

- **no false positive** — every error-severity diagnostic is one the recorded IDE build also emitted
  (today's `corpus/build-conformance.test.ts` + `warning-conformance.test.ts`);
- **totality** — no POU makes lowering throw, and the documented reach figures are what is measured
  (today's `lowering-totality.test.ts`, minus its three regressions);
- **self-consistency** — the new gate: a POU that lowers with no diagnostics has not silently dropped a
  declaration's initial value.

**Why these three together:** they are one expensive walk. Splitting them means walking the corpus three times,
which is the reason `build-conformance` and `warning-conformance` already share theirs.

## 3. `backends.test.ts` — B against C

Unchanged in substance; it is already exactly one question with one mechanism. It moves only for its name.

## 4. `suite.test.ts` — is enough being asked

The census (cells derived from the language) and construct coverage (constructs derived from the grammar and the
vendor's reference). Both ask "does every X have a fixture" from an authority that is NOT the suite. They are a
pair and have never been filed as one.

## 5. `properties.test.ts`

The memory model asserted as properties rather than examples. It needs no oracle and is not corpus-driven, so it
belongs with neither 1 nor 2. It is small and stays separate rather than being hidden inside a larger file.

## 6. `catalog.test.ts`

The documented CODESYS error codes, each with a repro that must produce its message. A vendor-oracle question, but
its oracle is the published catalog rather than a recording, and its fixtures are in the catalog JSON rather than
in `ALL_TESTS` — so it cannot join 1 without dragging a second input into it.

## What moves out of the suite entirely

Three tests in `lowering-totality.test.ts` pin ONE past defect each — a date literal past JS `Date`'s range, a
pointer stepped over a zero-byte element, and the temporal literals that prove that refusal did not widen. A
regression about one function belongs in that module's own test file, which is the repo's stated policy
(`lsp-test-policy-corpus-finds-src-acks`). They move to `src/transpile/lower/`.

## The new gate, concretely

Inside concern 2's existing walk, for each unit that lowers with no diagnostics:

```
for each slot in pou.slots (and each field of each layout):
  find the declaration it came from
  if that declaration had an initializer:
    require  slot.init != defaultValueOf(slot.type)
          OR pou.init contains an assignment whose target is that slot
```

**What it catches:** a refusal discarded before it reached the output; a deferred initializer queued into a
lowering with no init step; a base class's initializers never run on a derived instance. Three of the four
defects that prompted this.

**What it does not catch:** a wrong value written into a field whose declaration had NO initializer — the fourth
defect, where a struct was given another POU's init routine. That needs a different invariant (roughly: every
statement in the init step writes a place rooted in the instance it runs on), which is follow-on work and is named
here so the gap is not mistaken for coverage.

**Why it is sound:** it compares the product against its own input, so it needs no vendor and cannot go stale. A
deferred initializer passes because the value IS assigned — the slot's default is the state before the init step
runs, which is the measured semantics (`declarations/init-sequence.ts`).

## Order

1. Land the new gate FIRST, in `lowering-totality.test.ts` where it will live. It is the reason for the change and
   it should be protecting the tree during the rewrite rather than after it.
2. Move the three regressions to `src/transpile/lower/`.
3. Build `fixtures.test.ts` from the four it replaces, carrying every comment.
4. Rename and regroup the rest.
5. Delete the originals in the same commit as their replacement — never both at once in the tree.
