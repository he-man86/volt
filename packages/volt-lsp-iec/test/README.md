# `test/` — four concerns, six files

Every file here states its question in its first paragraph, and **the file name is the question, not the
mechanism**. That was the point of the rewrite (`openspec/changes/conformance-tiers`): the suite had grown to
thirteen files named after how they work — `replay`, `transpile`, `backend-agreement`, `construct-coverage` — and a
reader could not tell from the tree what was being asked, nor whether anything was being asked twice or not at all.

For the package's whole testing story — unit tests, the tooling that records the oracles, which live bridge
produces what — see [`../TESTING.md`](../TESTING.md). This file is only the map of `test/`.

| Concern | File | Question | Oracle |
|---|---|---|---|
| 1. the fixture contract | `conformance/fixtures.test.ts` | for each fixture, does the thing its evidence rating claims actually hold? | the recorded CODESYS build **and** run |
| 1b. the documented codes | `catalog/catalog.test.ts` | does every `Cnnnn` the catalog documents have a repro and a message? | `docs/codesys-reference/error-catalog.json` |
| 2. real code | `corpus/corpus.test.ts` | can the LSP read 29k files of real code, does it invent nothing, and is lowering total over them? | the projects' own recorded IDE builds |
| 2b. the memory model | `conformance/properties.test.ts` | do the layout rules hold as properties, where no single recording can say? | none — they are properties |
| 3. cross-backend | `conformance/backends.test.ts` | do the interpreter and the emitted Rust agree where no recording reaches? | each other |
| 4. is enough being asked | `conformance/suite.test.ts` | does every cell, operator and construct have a fixture at all? | the language, our grammar, the vendor's index |

Plus `conformance/source-map.test.ts` — every emitted Rust line a mapping names exists and holds code. It is small
and it is its own question.

## Why these four, and not more

They divide by **what could be wrong**, which is the only division that makes a hole visible:

- **a wrong answer** → concern 1. There is an oracle and we disagree with it.
- **a false alarm, or a crash, on code nobody wrote for us** → concern 2.
- **the two backends disagreeing where nothing recorded the answer** → concern 3.
- **nobody having asked** → concern 4. No other concern can find this: every one of them iterates over what
  exists. The denominator has to come from outside the suite, and concern 4 is the only file that gets it there.

## The two rules the shape encodes

**One walk per input.** The corpus costs about three minutes to parse, bind and lower; the fixtures cost about
three to compile through `rustc`. A file that walks either of them a second time to ask a different question is
paying that again. `corpus.test.ts` parses each project once and asks every question of that one parse — it was
four files doing four walks, one of them five times within itself.

**One selection, and it must be total.** `fixtures.test.ts` is driven by the fixture's `evidence` rating, which is
derived for every fixture, so a rating with no row is a visible hole. It replaced four files that each hand-wrote
its own filter, where a fixture in a state nobody had thought of was simply covered by none of them — which is
exactly what happened, and what the merge found on the first run.

## Where a new test goes

- It reproduces a bug in one function → **beside the code**, `src/**/*.test.ts`. That is where the three
  lowering-totality regressions went, and where a src-colocated test belongs by policy.
- It asks CODESYS something → **a fixture**, `conformance/fixtures/`, then `bun run record:exec` /
  `record:language`. Never a new test file: `fixtures.test.ts` will pick it up under its rating.
- It is a new *concern* — something that could be wrong in a way none of the four covers → a new file, named for
  the question, with the first paragraph saying what it is and why nothing else can answer it.

Adding a seventh file for anything else is how the thirteen happened.
