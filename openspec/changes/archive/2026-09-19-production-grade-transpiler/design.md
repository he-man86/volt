# Design

## D0 — What the first draft got wrong, kept because it is the point

The first draft justified its centrepiece with "26,175 corpus files become differential tests". The measured
number is **55 POUs**. The gate is *narrower* than the 625-program suite it claimed to exceed, and the exclusion
list then scoped out the only work that would raise it.

That is the failure mode this whole change exists to prevent, reproduced by the change itself: **a confident
number that nobody measured.** It is recorded here rather than quietly corrected, because every remaining
justification in this document should be read as a claim that could be wrong the same way — and most of them are
now followed by the command that checks them.

## D1 — B↔C, and why it needs a generator rather than the corpus

`interp/` and `emit/rust/` print the same IR. Each is checked against the CODESYS recordings; neither is checked
against the other. So the pair can only be caught being wrong *together* on the 625 recorded programs, and may
diverge freely everywhere else. Five confirmed divergences, all outside the recorded set:

- the MOD expansion shadowed a parameter — `7 MOD 3` compiled to `0` (fixed, `1a81fe3ca5`);
- **no termination contract** — `interp.ts:43` caps a loop at 1,000,000 iterations and throws; the emitter has
  no counterpart, so the same POU fails loud in B and hangs forever in C. For a product whose deliverable is a
  `cargo test` run, this is the worst of the five;
- `IrBuiltin` does not define argument evaluation — interp evaluates every argument, the emitter does not;
- `REAL → integer` saturates in Rust above `i64`, wraps in the interpreter;
- unary negation of a REAL is `0 - x` in the interpreter, so `-0.0` becomes `+0.0`.

**The corpus cannot drive this gate.** 55 POUs, 150 slots, no interface dispatch, four builtins. A generator of
ST *inside the input contract* is the only source with no coverage ceiling, so it moves to Phase 0 and the 55
corpus POUs become a fixed regression set beside it.

**The gate needs three things specified before it can be written**, and the first draft named none of them:

1. **Inputs.** The existing harness never sets one — it scans from declared initial values. A real POU scanned
   from defaults takes no branch (its enables are FALSE), so the gate would run near-nothing while reporting
   thousands of agreeing assertions. Seeded values per input slot, via the same machinery the generator needs.
2. **Place enumeration.** `rustAccess` and interp's `resolvePath` both take a path the caller already knows;
   nothing enumerates a POU's places. Needs a walk over `IrPou.slots` + `layouts`, bounded on array elements.
3. **The comparison domain.** REAL/LREAL must compare **bit-exactly** or the gate cannot see its own finding
   (`-0.0` vs `+0.0` is invisible under `==`); NaN needs a stated rule; a POINTER is a handle in B and a `usize`
   in C; a STRING is a JS value vs an `IecStr`.

## D2 — Totality is a contract, so it has a gate · DONE

Landed in `825346dd3e`: every runnable POU in the corpus is lowered and must not throw (~29k files, ~80s), in
the conformance tier rather than `test/corpus/` because that tier is a ratchet and this is an invariant.

It passed on the day it was written, which is why it needed the second half. Both violations were **unreachable
from 29k files of real customer code** — nobody writes a year 300000 or steps a pointer over a struct with no
fields — so they got targeted cases. **A corpus sweep is evidence, not proof.**

The fix taught the sharper lesson. Returning `undefined` for the out-of-range date stopped the throw and fell
through to the string branch, because a date literal's AST value *is* a string: `D#300000-01-01` became a STRING
constant with no diagnostic. Trading a loud crash for a silent wrong answer is worse than the bug. **The tests
assert the diagnostic, not merely the absence of a throw** — the only assertion that catches it.

## D3 — The interpreter is the most dangerous file in the tree

It is the reference C is judged against, so a bug in it is invisible to B↔C and caught by A only where a
recording happens to cover it. Therefore: interpreter defects outrank emitter defects of equal severity, new
fixtures go first to interpreter behaviour no recording covers, and a fallback in it — the `coerce` STRING
catch-all that answers for BOOL and TIME targets by parsing digits — is the worst possible place for one.

## D4 — Fallbacks are defects, and the review named them

`lowerSource` swallows parse errors in library and GVL files; two specializer fallbacks would each collapse
distinct bindings onto one body; `rootInstance` can return an empty body with no diagnostic; shift/rotate widths
fall back to a silent 32 where lowering always types the node. Each is removed: unrepresentable becomes a coded
refusal, unreachable becomes a hard failure that says so.

## D5 — A refusal is the product's main surface, because 82% of bodies get one

`blocked: 249 (81.9%)`. For anyone who did not write the compiler, **the refusal IS the product**, and today it
is a maintainer's slug: `LowerDiagnostic.code` is bare `string`, there is no registry, one code is templated
(`slot-${kind}`), and ~94 distinct codes exist across `lower/`. Nothing carries the three-way taxonomy
`index.ts` itself declares — *your code is invalid* / *understood but not built* / *compiles but unmeasured* —
so a user cannot tell whether to fix their ST, wait for a release, or file a bug.

This also makes "a fixture for every refusal code" unimplementable as written: with `code: string` there is no
set to enumerate. The registry comes first; the fixture gate follows from it.

## D6 — Scope

**In:** the defects; the contract statements (subset, refusals, termination, emitted API) and their gates; the
B↔C gate and its generator.

**Out, and why:**
- **New lowering coverage** — `place-not-local` (170), `init-not-constant` (200), `expr-call` (75), and the
  56,629 METHOD/ACTION bodies belong to `transpile-st-to-rust`. Two exceptions, both *mis-classified* rather
  than unbuilt: a property through a `REFERENCE TO` an FB, and a `REFERENCE` not dereferenced for a field step.
  Both are one call from an existing solution (`instancePlace`, `lowerPlace`) and inflate a tracked bucket with
  work already done.
- **The delivery surface** — `emitRust` has exactly one caller in the repo, the package is `private`, and the
  emitter is structurally single-POU (prelude and layouts are re-emitted per call; two standing `ponytail:`
  notes say to hoist them "when whole projects are emitted"). Making the transpiler *invocable* is a separate
  change with its own proposal, and `transpile-st-to-rust` already says the test API must be designed first.
  **This change therefore hardens the engine, not the product** — the proposal says so plainly rather than
  claiming otherwise.
- **IEC as an oracle** — wrong target, see the proposal. **IEC as an index is now IN** (task 0.6).
- **Performance** — nothing measured slow. But the gates have a CI budget (D7).

## D7 — Sequencing, and the argument that expired

The first draft argued "gates strictly first, not negotiable" from the emitter being unverified in CI. That
stopped being true *during the review*: `273a3da2f1` landed the toolchain, so the 625-program suite now runs the
emitter on every push. The remaining Phase 0 work does not block Phase 1, and the honest ordering is:

    contract + registry ──> defects (1,2,3) ──> generator-driven B↔C ──> hardening

with three rules throughout:

1. **A failing test before every fix**, naming the input that triggers it.
2. **Where a task rests on a claim about CODESYS, it is measured live against SP21** and the fixture records the
   measurement.
3. **Every gate states its CI cost.** The totality gate is ~80s; the corpus sweeps are minutes. A gate that
   doubles CI time needs a reason, and "it is a gate" is not one.
