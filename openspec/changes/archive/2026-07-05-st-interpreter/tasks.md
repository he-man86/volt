## 0. Prerequisite

- [ ] 0.1 Confirm `st-body-ast` has landed (statement/expression tree exposed on `BodyModel`) — this change walks that tree and cannot start before it.
- [ ] 0.2 Scaffold `packages/volt-lsp-iec/src/interp/` (single-package placement per design D7), parallel to `src/parser`/`src/semantic`/`src/vg`; oracle harness under `scripts/`.
- [ ] 0.3 **Walking-skeleton spike FIRST** (de-risk before committing): pick ONE real pure-logic FB, evaluate it end-to-end (value model → env → eval → scan driver → one assertion), and prove it against the vendor runtime by hand. If the oracle ground-truth path (task 6.2) turns out hard, learn it here in week 1 — not after building the whole interpreter.

## 1. Value model

- [ ] 1.1 Define the runtime value union: `BoolVal`, `IntVal {bits, signed, value}`, `RealVal {bits}`, `TimeVal`, `StringVal`/`WStringVal`, `EnumVal`, `StructVal`, `ArrayVal`, `FbInstanceVal`.
- [ ] 1.2 Integer arithmetic with correct width/signedness wraparound (mask narrow types; `BigInt` for 64-bit LINT/ULINT/LWORD). REAL/LREAL via IEEE-754.
- [ ] 1.3 Implicit-conversion / promotion rules per IEC (integer widening, INT↔REAL where legal); TIME arithmetic.
- [ ] 1.4 Unit tests: overflow wrap (BYTE 255+1=0), 64-bit exactness, INT→REAL promotion, TIME add/subtract.

## 2. Environment & expression evaluator

- [ ] 2.1 Scope-chain environment: per-scan local frame + a persistent instance store keyed by instance path (FB instance vars + RETAIN carried across scans). Reuse `symbol-table.ts` for declaration/type lookup.
- [ ] 2.2 Expression evaluator over the `st-body-ast` expression tree: literals, identifiers, binary/unary ops (using the D1a precedence already encoded), member access, array index, dereference, parenthesised.
- [ ] 2.3 Unit tests: expression evaluation incl. member/index chains and short-circuit-free IEC boolean ops.

## 3. Statement executor & scan driver

- [ ] 3.1 Statement executor: assignment, IF/CASE/FOR/WHILE/REPEAT, EXIT/CONTINUE/RETURN, bare-call statements.
- [ ] 3.2 Scan driver: one scan = execute the POU body once against its environment; run N scans; expose read/write of variables by name/path.
- [ ] 3.3 `bun test` API: `set inputs → run N scans → assert outputs/state`, no vendor/hardware.
- [ ] 3.4 Unit tests: counter over 3 scans, FOR-loop sum, CASE state machine transitions.

## 4. Call semantics

- [ ] 4.1 Function call (pure, returns a value) and method call over the evaluator.
- [ ] 4.2 FB-instance call: bind inputs → run instance body against its persistent store → read outputs; verify instance memory persists across scans.
- [ ] 4.3 Unit test: two instances of the same FB keep independent state across scans.

## 5. Standard-library registry (phased, injected clock)

- [ ] 5.1 Pluggable stdlib registry the evaluator consults on call; unimplemented element → a **named** "not implemented" error that fails the test (never a silent wrong value).
- [ ] 5.2 Injected clock; implement `TON`/`TOF`/`TP` against it; `R_TRIG`/`F_TRIG`; `CTU`/`CTD`.
- [ ] 5.3 Unit tests: `TON` elapses after the injected time advances; `R_TRIG` fires once on a rising edge across scans.

## 6. Oracle-diff harness (proof of correctness)

- [ ] 6.1 Harness that runs a POU through the interpreter AND the vendor runtime (via the headless bridge) with a fixed input sequence, and asserts equal output sequences — extends the `lsp-vs-compiler.ts` oracle discipline.
- [ ] 6.2 Determine how much vendor "run N scans + dump variables" ground truth is harvestable headlessly; if a bridge "execute + dump" affordance is needed, spec it as a separate bridge change and reference it here.
- [ ] 6.3 Pick a small representative real-POU set (pure logic first — no exotic stdlib); make the diff green; triage any divergence as an interpreter bug.
- [ ] 6.4 Add a ratcheted coverage metric (which POUs evaluate cleanly under the interpreter); grow stdlib/semantics test-by-test, each oracle-confirmed.

## 7. Land it

- [ ] 7.1 `bun test` green (unit + oracle harness) and `bun typecheck` clean in the interpreter package.
- [ ] 7.2 Ensure unit tests run in CI without a bridge/vendor runtime; gate the oracle harness (needs the bridge) appropriately.
- [ ] 7.3 `openspec validate st-interpreter`; sync the `st-interpreter` spec and archive when done. Confirm the fork-surface check (`check-divergence.ts`) still passes (purely additive).
