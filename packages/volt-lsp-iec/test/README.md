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

Plus `frontend/` — the FRONT-END MEASURED (openspec `frontend-conformance`, phase 0): does the parser, the binder and
the type layer (`src/frontend/syntax`, `symbols`, `types`) answer as the recordings do, over every corpus file, fixture
and library body? `parse-census` (0.1), `fixed-point` (0.2, the printer), `resolution-dump` (0.3), `type-dump` and
`fold-dump` (0.4) each pin their findings in `frontend/baselines/` — a new finding fails and so does one that vanished
(`VOLT_WRITE_BASELINE=1` rewrites them). `baselines/ceilings.json` makes "may only fall" mechanical: the writer refuses a
disagreement measure above its ceiling and lowers each ceiling to what it measured, and `baseline.test.ts` fails a
ceilings file that rose against any committed version of itself; `rules.test.ts` (0.5) holds design.md §4's rule catalogue (`rules.ts`) to the
fixtures and recordings that exist. The dump builders (`dumps.ts`) are shared with snapshot F. `bound-census.ts` walks
everything bound ONCE for 0.3 and 0.4.

Plus `analysis/` — the ANALYSIS MEASURED (openspec `analysis-conformance`, phase 0): does every diagnostic the LSP's
analysis gives say what the vendor's build said? `diagnostic-census.test.ts` runs every registry check over every
conformance fixture as the replay binds it (`conformance/support/replay.ts`, the composition `fixtures.test.ts` gates), on
both vendors, and over the six corpora as the server analyses them, and attributes each finding to its check and its
message builder: TP, SEV, FP (`div` where the replay pins a divergence) and GAP (IDE-only, attributed by shape, or
`unowned`). The builder is `census.ts`; the counts and findings are pinned in `analysis/baselines/` (`fixtures.codesys`,
`fixtures.twincat`, `corpus`, `coverage`) with their own `ceilings.json`, held by the same discipline as `frontend/`
(`frontend/baseline.ts` takes the directory; `frontend/baseline.test.ts` holds both ceilings files to their history).
A census row is a registry entry (`diagnostic-census.test.ts` holds census rows == `CHECK_REGISTRY`); an unowned GAP is
classed `owned-by-frontend` / `project-config` / `missing-rule` by its wording (`census.ts` `unownedClass`). A GAP that
rises because a step recorded new ground no check owns yet is a named `CEILING_EXCEPTIONS` entry in `frontend/baseline.ts`,
never a raised ceiling (analysis-conformance 3.11's REFERENCE TO BIT alias, 3.12's initialization order of PROGRAMs).

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
