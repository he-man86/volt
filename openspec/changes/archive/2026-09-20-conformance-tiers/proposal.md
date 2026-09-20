# Conformance suite — rewrite it around the evidence rating, not around the escapes it grew from

## Why

**Fourteen test files, each written to catch the last escape, none written from a picture of the whole.**

Every one is good at its job. As a set they have no shape:

- the file name says the MECHANISM (`replay`, `transpile`, `backend-agreement`), not the QUESTION, so a reader
  cannot tell which one would catch a given mistake or whether two of them overlap;
- three answer the same question from different recordings, and nothing says they are a pair;
- one answers four unrelated questions and carries three one-off regressions that belong beside the code;
- and a whole class of defect is caught by none of them.

**Three HIGH defects shipped green on 2026-09-19 and 2026-09-20.** All were the same failure — a declaration's
initial value silently became the type's default and the POU lowered CLEAN. No crash, no wrong refusal, a
plausible wrong answer. Every gate was blind for a structural reason:

| tier | why it could not see it |
|---|---|
| differential execution | compares values only for a FIXTURE, so it catches a shape only if somebody wrote that fixture |
| corpus build-conformance | compares **diagnostics**. It never executes anything |
| totality / reach | counts what lowers, not whether the result is right |
| typecheck · lint · layering | structural |

A code review found them, reading the diff, twice. That does not scale, and nobody chose it — it is what is left
over after fourteen files that each grew to catch one escape.

## The thing we know now that we did not know then

**The evidence rating already says, per fixture, what should be asserted about it.** `support/evidence.ts` rates
every fixture `confirmed` · `refused` · `not-lowered` · `lsp-gap` · `diverges` · `unaskable` · `unasked`, and
`confidence.test.ts` recomputes all of it so a stored rating cannot go stale.

That rating is a complete contract, and it arrived late. The older gates predate it and each re-derives its own
slice of the same question: `replay` picks the fixtures with a build recording, `refused` picks the ones with a
refusal, `transpile` picks the ones with values. Three selections, three mechanisms, one underlying fact.

Written today, that is one table:

| rating | what must be true |
|---|---|
| `confirmed` | the vendor ran it, and BOTH backends compute its recorded values |
| `refused` | the vendor rejected it, and the LSP errors with the vendor's own wording |
| `not-lowered` | the vendor ran it, lowering refuses, and the refusal's code is registered |
| `diverges` | the vendor ran it and we DISAGREE — pinned, with the measurement written down |
| `lsp-gap` | the vendor rejected it and the LSP is silent — pinned and counted |
| `unaskable` | nothing is asserted, and the fixture says in its own words why |

One driver walking every fixture and asserting its rating's row replaces four files with one, and — more to the
point — makes the suite's coverage a property anyone can read off a table instead of inferring from four
selections.

## What this change does

**Rewrite the suite as four concerns, from the current understanding, rather than reorganising what accreted.**

1. **The fixture contract** — one driver, one row per rating, over every fixture. Subsumes `replay`, `refused`,
   `transpile` and `confidence`'s ceilings.
2. **The corpus** — real code, no recordings. Three questions: no false positive against the recorded build,
   lowering never throws, and the product is self-consistent with its own input.
3. **Cross-backend** — the interpreter against the emitted Rust, wherever no recording reaches. Already one clean
   file; it keeps its shape.
4. **The suite's own completeness** — the census and construct coverage, which ask whether enough is being asked.

**And it adds the gate the escape class needs**, in concern 2, needing no oracle:

> For every corpus POU that lowers **with no diagnostics**, every slot whose declaration carried an initializer
> must have either a non-default `init` or a statement in the init sequence.

It runs inside the walk concern 2 already does over 29,359 files. It would have turned three of the four defects
red before they were pushed. **It does not catch the fourth** — a wrong value written into a field that had no
initializer — and this change says so rather than implying the class is closed.

## The risk, and how it is handled

**These files carry more knowledge in their prose than in their assertions.** `replay.test.ts`'s agreement floors
each cite the measurement that moved them; `backend-agreement.test.ts` names five divergences and how each was
found; `lowering-totality.test.ts` records why a documented figure exists at all. A rewrite that keeps the
assertions and loses the comments would destroy evidence that took months to gather and cannot be re-derived.

So: **every comment moves with its assertion, and the change is not done until a diff shows no measured fact was
dropped.** The rewrite is a re-grouping of existing prose plus one new gate — not new text about old facts.

**And it lands in one step, not two.** A half-migrated suite has two files answering one question, which is the
state this change exists to end.

## What this change does NOT do

- **It does not change any oracle, recording or fixture.** Every assertion that holds today holds after it.
- **It does not widen coverage** beyond the one gate above. Asking more is the census's job; this is about being
  able to tell what is already asked.
- **It does not merge to reduce the count.** `transpile` (147s) and the corpus walk (160s) stay separable, because
  a selective run is how this suite is actually used.
