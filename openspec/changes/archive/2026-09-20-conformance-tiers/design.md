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

One walk over 29,359 files, two questions:

- **no false positive** — every error-severity diagnostic is one the recorded IDE build also emitted
  (today's `corpus/build-conformance.test.ts` + `warning-conformance.test.ts`);
- **totality** — no POU makes lowering throw, and the documented reach figures are what is measured
  (today's `lowering-totality.test.ts`, minus its three regressions);
*(A third question — self-consistency — was specified here and removed after being built and measured; it is not a
corpus question. See "The new gate, concretely" below.)*

**Why these together:** they are one expensive walk. Splitting them means walking the corpus three times,
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

## The new gate, concretely — and why it is not a gate

**This was specified as a corpus check and built as one. The corpus proved it wrong.** Recorded here because the
reasoning is the deliverable, not the code that was thrown away.

The specified check was:

```
for each slot in pou.slots (and each field of each layout):
  find the declaration it came from
  if that declaration had an initializer:
    require  slot.init != defaultValueOf(slot.type)
          OR pou.init contains an assignment whose target is that slot
```

It was implemented over all three storages (frame, globals, layouts) and run over the corpus: **386 findings on
3,051 clean-lowering POUs, and every one inspected was a false positive.** The first, `libDI.tOnDelay`, is
`tOnDelay : TIME := T#0MS` — an initializer whose value IS the type's default. The check cannot tell that from a
dropped one, because *the two produce the identical slot*.

The escape hatch made it worse rather than better. To let a legitimate `:= 0` pass, the check re-derives the
initializer's value with `types/constEval` — **a second evaluator**, which does not answer for a duration literal
and so reports a bug wherever it merely stays silent. `ir/evaluate.ts` already names this trap in its own header:
CODESYS folds an initializer to exactly what the expression computes at run time, and *"exactly" is a claim a
second implementation cannot keep*. The gate was about to re-introduce the disagreement that file exists to
prevent, and call the disagreement a defect.

**So the invariant is not checkable downstream.** A slot at its default is indistinguishable from a slot
initialized to its default — by construction, in the IR, permanently. No corpus walk recovers information the
representation does not carry.

### What replaced it

The silence is created at one line, so it is closed at one line. `lower/storage.ts` computed whether an
initializer failed to lower and then *dropped the fact*, under a comment asserting a refusal had been recorded.
Nothing enforced that assertion, and all four defects were that assertion being false. It now enforces it:

```ts
if (decl.init !== undefined && !deferred && init === undefined && lw.diagnostics.length === before)
  lw.bail("init-dropped", `${…}'s initial value did not lower and nothing said why`, decl.span)
```

**Why this is the root and the gate was the patch:** the gate detects the symptom in one consumer (a corpus POU)
long after the information needed to judge it is gone. The guard makes the state unrepresentable at the only
place it can arise, for every caller — frame, global, layout field, routine local — at once, and it needs no
oracle, no second evaluator and no corpus.

**Evidence, 2026-09-20.** Fires on 0 of 2,291 fixtures and 0 of 6,985 corpus POUs: every path that drops an
initializer today is already paired with a refusal, which is what the guard asserts. That it fires at all was
verified by injection — with `scalarInit`'s `init-not-constant` bail removed, a struct field initialized from a
non-constant reported `init-dropped` instead of lowering clean with the field at 0, which is defect shape 2
exactly. `init-sequence.test.ts` pins the other direction (an initializer that legitimately is the default must
not trip it); the four original shapes are already pinned there as regressions.

**What neither catches:** a wrong value written into a field whose declaration had NO initializer — the fourth
defect, where a struct was given another POU's init routine. That is a different invariant (roughly: every
statement in the init step writes a place rooted in the instance it runs on), it remains follow-on work, and it
is named here so the gap is not mistaken for coverage.

**Consequence for concern 2.** `corpus.test.ts` asks two questions, not three: no false positive, and totality +
reach. Self-consistency is not a corpus question and never was.

## Order

1. Land the new gate FIRST, in `lowering-totality.test.ts` where it will live. It is the reason for the change and
   it should be protecting the tree during the rewrite rather than after it.
2. Move the three regressions to `src/transpile/lower/`.
3. Build `fixtures.test.ts` from the four it replaces, carrying every comment.
4. Rename and regroup the rest.
5. Delete the originals in the same commit as their replacement — never both at once in the tree.
