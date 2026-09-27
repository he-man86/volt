## Why

The transpiler's VALUES are gated three ways. `fixtures.test.ts` runs every confirmed fixture through the CODESYS
recording (A), the interpreter (B) and the emitted Rust (C) and compares all three; `backends.test.ts` compares B
against C where no recording reaches. 1,935 fixtures are `confirmed` under that machinery.

**Nobody has ever looked at the Rust.** The A↔C pass compiles all of it and then names the style lints as
exceptions, with the reason written down:

```
//   dead_code / unused_parens — as the crate check: generated code is not read for style.
```

That reason was true while the Rust was only an oracle. It stopped being true when `emit/rust/index.ts` declared an
emitted SURFACE a user's harness reaches into by name — at which point somebody does read it, and "the values match"
stops being the whole answer to *how good is this transpile?*

So the fixture catalog can say how well a fixture is EVIDENCED (`evidence.generated.ts`, generated and gated) and
cannot say anything about the code it produces. There is no per-fixture record of what a fixture transpiles TO, no
ordering from the simplest construct to the hardest, and no measurement of optimality at all — only of correctness.

**Measured 2026-09-24**, clippy over the emitted Rust of every confirmed fixture, `clippy::all` with the existing
rustc exceptions:

| tier (the band the fixture's OWN body reaches) | fixtures | clean | the findings on the rest |
|---|---:|---:|---|
| `decl` | 329 | 251 (76%) | `possible_missing_else` 108 · `manual_range_contains` 36 · `unused_parens` 29 · `self_assignment` 27 |
| `arith` | 1324 | 43 (3%) | `unused_parens` 2096 · `possible_missing_else` 672 · `unnecessary_cast` 548 · `manual_range_contains` 318 · `double_parens` 220 |
| `control` | 54 | 15 (28%) | `unused_parens` 72 · `nonminimal_bool` 29 |
| `aggregate` | 24 | 13 (54%) | `unused_parens` 37 · `double_parens` 11 · `unnecessary_cast` 10 |
| `call` | 88 | 17 (19%) | `unused_parens` 172 · `double_parens` 34 · `explicit_auto_deref` 15 |
| `indirect` | 116 | 30 (26%) | `unused_parens` 316 · `double_parens` 81 · `redundant_closure_call` 29 |
| **total** | **1935** | **369 (19%)** | |

The top of that list is not defect and not noise in equal measure, and telling the two apart is the work:
`cast_possible_truncation` IS the IEC width rule the transpiler exists to implement, while `unnecessary_cast`,
`unused_parens` and `double_parens` are the printer emitting text no one would write by hand.

## What changes

**1. A TIER per fixture, derived from the lowered IR.** `decl` → `arith` → `control` → `aggregate` → `call` →
`indirect`, assigned by the set of IR node kinds the fixture actually produces — not by its folder and not by
anyone's judgement. That is the simplest-first ladder the sweep walks, and because it is measured it cannot go
stale when a fixture moves or a lowering changes.

**2. ONE ROW PER FIXTURE, IN ONE FILE.** `fixtures/evidence.generated.ts` becomes `fixtures/map.generated.ts` and
carries everything derived that is known about a fixture. It is generated for the reason the old one was — 458 of
the 2,606 fixtures come from factory helpers or template-literal names, where a per-entry field cannot reach —
and merged in `fixtures/index.ts` so reading one fixture at runtime tells you all of it:

| field | what it is |
|---|---|
| `evidence` | unchanged: `confirmed` / `refused` / `not-lowered` / `diverges` / `lsp-gap` / `unasked` / `unaskable` |
| `tier` | the band its own body reaches |
| `rust` | which oracle reached the EMITTED RUST — `vendor` (the recording's values came back out of it), `compiles` (it built, no recorded value reaches it), `none` (it does not lower) |
| `lints` | the linter findings on that Rust that survive the policy. Absent means clean |
| `diverges` | the vendors it is recorded as not matching, from `divergences.ts` — `triage` or `known` |

There is no `backends` oracle value, deliberately: `backends.test.ts` compares the two backends on a deterministic
SAMPLE of 120, which is a property of the suite rather than a fact about a fixture.

**What does NOT move into it.** `recordings/*.json` is the vendor's own answer and only a recorder may write it —
folding a five-minute regeneration into 1.5 MB of measured ground truth means every rating change rewrites the
evidence. And `support/divergences.ts` keeps the paragraph explaining each divergence; the row carries the
membership, that file carries the reason. One row to read, one owner per file on disk.

**3. clippy REPLACES rustc in the A↔C pass.** Not a second pass over the same 1,935 programs: `clippy-driver`
compiles and lints in one invocation, so the whole optimality half costs the compile that already runs.

**4. A lint POLICY, one line of reason per allowed lint**, in the shape the four existing rustc exceptions already
have. A lint Volt accepts as its own answer is named with WHY it is the answer; everything else is a finding.
An allowed lint with no reason fails the gate — that is how this avoids rotting into decoration.

**5. `-D warnings` becomes a per-fixture RATCHET.** The build stops denying lints and records them instead: a
fixture may report only what its stored row already carries, and reporting more fails the suite naming the fixture
and the lint. Same guarantee, and it now covers clippy's lints where `-D warnings` only ever covered rustc's. It
has to work this way — `-D` makes a diagnostic `level: "error"`, so a findings parser reading warnings sees
nothing; measured, it wrote 2,295 rows clean while the build was failing for reasons no row recorded.

**6. The sweep walks the tiers from `decl` upward** — fix the printer, re-measure, watch the count fall. A tier is
closed when it has no surviving lints, and it stays closed because the ratchet fails if it grows.

## What this is not

No dashboard, no report file, no new test file, no new `bun run` script, no second rating system — the count of
generated modules goes DOWN by one. The map answers the same question `evidence` answers, *what do we know about
this fixture?*, so it is the same row.

Confidence is not a number out of ten. A score invites tuning; `rust` names WHERE the evidence is and `lints`
names WHAT is wrong, and both are recomputed from the recordings and the compiler on every run.

## Impact

- `test/conformance/support/transpile-confidence.ts` — the tier, the policy, the rater (one implementation, used by
  the generator and the gate, as `evidence.ts` is)
- `test/conformance/fixtures/map.generated.ts` — replaces `evidence.generated.ts`; merged in `fixtures/index.ts`
- `test/conformance/types.ts` — `LanguageTest.transpile`
- `test/conformance/support/rustc.ts` — `CLIPPY` and `skipLintCheck`, the same not-silent skip rule `RUSTC` has
- `scripts/rate-fixtures.ts` — the one producer; it compiles every fixture now, so it takes ~60s rather than being
  instant, and it REFUSES to run without clippy (every row would be written clean, which is indistinguishable from
  actually being clean)
- `test/conformance/fixtures.test.ts` — the A↔C pass builds with `clippy-driver`; the rows are recomputed
- `src/transpile/emit/rust/emit.ts` and `prelude.ts` — where the findings get fixed
- CI: `rustup component add clippy` beside the existing `VOLT_REQUIRE_RUSTC=1`
