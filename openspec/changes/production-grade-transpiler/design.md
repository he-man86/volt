# Design

## D1 — The missing edge: B↔C, and why it is the centre of this change

`interp/` and `emit/rust/` print the same IR. They are checked against CODESYS recordings (A), and never
against **each other**. So the pair can only be wrong together on the 625 recorded programs — and can
diverge freely on everything else.

That is not hypothetical. The review found three confirmed divergences, all outside the recorded set:

- `IrBuiltin` says nothing about argument evaluation; the interpreter evaluates every argument, the emitter
  does not. A builtin argument with a side effect therefore means two different things.
- `REAL → integer` saturates in Rust above the `i64` range and wraps in the interpreter.
- unary negation of a REAL is computed as `0 - x` in the interpreter, so `-0.0` comes out `+0.0`, which the
  emitted Rust does not do.

**The gate.** For every POU in the 4-project corpus that lowers, run it in the interpreter and in the
emitted Rust with the same inputs and compare every reachable place. No CODESYS needed — it is a pure
self-consistency property, so it can run on every push and over 26,175 files rather than 625.

Two honest limits, stated because they decide how much this gate is worth:

1. It proves *agreement*, never *correctness* — both backends can be wrong together, and only A catches
   that. A stays the truth, this widens the net.
2. Most corpus POUs do not lower yet (see `lower-completeness.ts`). The gate's reach grows as coverage
   does, which is the right coupling: it means coverage work automatically buys verification.

## D2 — Totality is a contract, so it gets a gate, not a comment

`index.ts` states it: lowering is **total** — never throws, reports a coded `LowerDiagnostic` for anything
it cannot represent. The review found two places that throw instead: a `RangeError` from a pointer stepped
over a zero-size element, and a date literal outside JS `Date`'s range.

A property this load-bearing cannot be enforced by a doc comment. The gate lowers every file in the corpus
plus every conformance fixture and asserts that **nothing throws** — the diagnostics may say whatever they
like. This is cheap, it runs everywhere, and it is the one gate that would have caught both defects.

## D3 — Why the interpreter is the most dangerous file in the tree

`interp/` is the reference the emitter is judged against. A bug there is not caught by B↔C (the emitter is
compared *to* it) and is only caught by A where a recording happens to cover it.

Consequences for how this change treats it:

- Interpreter defects rank above emitter defects of the same severity.
- Interpreter behaviour that is *not* covered by a recording is where new fixtures go first.
- The `coerce` catch-all found by the review (a STRING branch that answers for BOOL and TIME targets by
  parsing digits) is the archetype: a fallback in the oracle, which is the worst possible place for one.

## D4 — Fallbacks are defects here, and the review found them by name

The repo rule is fail-loud. The review found, and the verifier confirmed, several places that quietly guess:

- `lowerSource` swallows parse errors in library and GVL files;
- two specializer fallbacks would each collapse distinct bindings onto one body;
- `rootInstance` can return an empty body with no diagnostic — a POU that "succeeds" and does nothing;
- the shift/rotate widths fall back to a silent 32 where lowering always types the node.

Each is removed rather than documented. Where a case is genuinely unrepresentable, it becomes a coded
refusal; where it is unreachable, it becomes a hard failure that says so.

## D5 — Duplicated rules, because that is how the next bug gets in

Four of the cleanup findings are one rule spelled twice: the positional-parameter order derived twice from
the same AST, the direct-address rule spelled as a regex *and* a shape check *and* overlap bookkeeping,
`storage.ts` and `bytes.ts` stating opposite things about `VAR_TEMP`, and three files carrying two stacked
doc comments where the first contradicts the field.

These are low severity and they are not low value: this exact pattern — two copies of one rule, drifting —
is what produced the property/method signature-parser bug this repo already paid for. They get merged.

## D6 — What this change deliberately does NOT do

- **No IEC 61131-3 conformance work.** The oracle is CODESYS. See the proposal.
- **No new lowering coverage.** The `lower-completeness` buckets (`place-not-local` 170, `init-not-constant`
  200, `expr-call` 75, …) stay with `transpile-st-to-rust`. Two exceptions, because the review showed they
  are *mis-classified* rather than unbuilt: a property through a `REFERENCE TO` an FB, and a `REFERENCE`
  never dereferenced for a field or index step. Both are already-solved resolution one call away from the
  site that refuses them, and both currently inflate a tracked bucket with work that is done.
- **No performance work.** Nothing has been measured as slow; optimising now would be speculation.
- **No second backend.** `emit/rust/` is the deliverable; a C or IL backend is not in scope.

## D7 — Sequencing, and why gates come strictly first

Phase 1 fixes five defects in a component that CI does not currently execute. Doing that before Phase 0
produces changes whose correctness rests on one engineer running one command on one machine — which is the
condition that produced the defects. So:

    Phase 0 (gates) ──> Phase 1 (high) ──> Phase 2 (medium) ──> Phase 3 (cleanup) ──> Phase 4 (hardening)

with one rule throughout: **every defect gets a failing test before it gets a fix**, and the test names the
input that triggers it. Where the trigger is a claim about CODESYS, it is measured live against SP21 and
the fixture records the measurement — never reasoned from the standard.

Expect Phase 0 to find more than the review did. That is the point of it, and it is the reason the phase
ordering is not negotiable.
