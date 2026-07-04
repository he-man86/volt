## Context

`st-body-ast` produces a statement/expression tree for ST bodies. An interpreter walks that tree to *execute* logic, giving headless CI tests of PLC behavior — something no current tool provides (TcUnit / CODESYS Test Manager need the real runtime; not headless, not text-diffable).

Proven precedents (verified, not assumed): the tree-walk execution model is textbook (*Crafting Interpreters* — lexer/parser/AST/evaluator, visitor pattern). For ST specifically, **esstee** is an existing ST interpreter (Flex/Bison → AST → runnable representation) with exactly the scan-cycle test shape we want: pre-execution variable init → run N cycles → post-execution state query. **MATIEC** (ST→C) and **RuSTy** (ST→LLVM) prove the transpiler alternative but are heavier and copyleft (GPL/LGPL) — we take their *grammar/semantics as reference*, not their code (see `st-body-ast` design D1/D1a).

The irreducible cost is **IEC execution semantics** — identical whether you interpret or transpile. Interpreting skips the codegen backend + build step, so it is the lazier correct choice for testing (see the decision thread that spawned this change).

## Goals / Non-Goals

**Goals**
- Deterministic scan-cycle execution of ST POUs (FB / PROGRAM / FUNCTION) over the `st-body-ast` tree.
- Persistent instance/RETAIN state across scans; injected clock for time-dependent logic.
- A `bun test`-friendly API: set inputs → run N scans → assert outputs/state.
- Correctness *proven* against the vendor runtime oracle, not asserted.
- Corpus-driven, ratcheted coverage — implement the semantics the target POUs need, fail loudly on the rest.

**Non-Goals**
- Any ST→JS/C/LLVM transpiler (deferred; interpretation covers testing).
- Type *checking* (LSP's job; `st-body-ast` follow-ups).
- IL / FBD / LD / SFC execution (ST only). VG bodies are graphical — out of scope for logic execution here.
- Real-time / cycle-time fidelity beyond logical scan order (no jitter, no task scheduling).
- Full IEC standard library on day one — phased, injectable.

## Decisions

### D1: Tree-walking interpreter, not a transpiler — and not an imported one
Walk the `st-body-ast` tree with an evaluator + environment. Rejected: (a) transpile to JS/C — adds a codegen backend and build step for no testing benefit, and splits correctness across transpiler + runtime lib; (b) import esstee/MATIEC/RuSTy — wrong language (C/Rust), whole-compiler not a body-AST library, and GPL/LGPL copyleft is a nonstarter for closed commercial Volt. We reuse their *design and grammar*, which is free.

### D2: Value model = tagged IEC values with explicit width/signedness
A discriminated union of runtime values (`BoolVal`, `IntVal {bits, signed, value}`, `RealVal {bits}`, `TimeVal`, `StringVal`, `EnumVal`, `StructVal`, `ArrayVal`, `FbInstanceVal`). Integer arithmetic wraps per declared width — the single most common source of real PLC behavior that naive JS-number evaluation gets wrong. Use `BigInt` where 64-bit exactness matters (LINT/ULINT/LWORD); narrower types wrap via masking. **Alternative:** raw JS numbers — rejected, silently wrong on overflow and 64-bit.

### D3: Environment = a scope chain with a persistent instance store
Per-scan locals live in a scope frame; FB instance variables and RETAIN vars live in a persistent store keyed by instance path, carried across scans. An FB call binds inputs → runs the instance body against its persistent store → reads outputs. This mirrors PLC instance memory and is what makes stateful tests meaningful. Reuse the existing symbol table (`symbol-table.ts`) for declaration/type lookup so the interpreter and LSP share one source of truth.

### D4: Standard library is a pluggable registry, phased
Standard FBs/functions (`TON`/`TOF`/`TP`, `R_TRIG`/`F_TRIG`, `CTU`/`CTD`, math/string funcs) are entries in a registry the evaluator consults on call. Implement the ones the first target POUs use; every unimplemented element throws a **named** "not implemented" error that fails the test explicitly (never a silent wrong value). Timers read the **injected clock**. Ratchet the implemented set up as real tests demand. **Alternative:** implement the whole IEC stdlib first — rejected (YAGNI; huge surface, most unused by any given test).

### D5: Clock is injected, never wall-clock
Time-dependent FBs take their `now` from an injected time source the test advances explicitly (`advance(100ms)`), so timer tests are reproducible and fast. This is also how esstee and every deterministic PLC simulator handle time.

### D6: Correctness is oracle-proven (extends `lsp-vs-compiler.ts`)
A harness runs a representative POU set through both the interpreter and the vendor runtime (via the headless bridge) with a fixed input sequence, and asserts equal output sequences. A divergence is an interpreter bug, not a new baseline. This is the *how do we know it's right* answer — the same ground-truth discipline that took the LSP corpus to zero FPs. Getting vendor "run N scans and dump variables" ground truth may need a small bridge affordance; scope that when the harness is built.

### D7: One package — a new `src/interp/` module inside `volt-lsp-iec`
The interpreter lives in `volt-lsp-iec` as a new top-level module `src/interp/` (value model, environment, evaluator, scan driver, stdlib registry, test API), parallel to `src/parser` / `src/semantic` / `src/vg`; the oracle harness lands in `scripts/` beside `lsp-vs-compiler.ts`. Rationale: the interpreter's hard dependencies — the `st-body-ast` tree, the symbol table, the type resolver — all live here, and a single package means **no cross-package export surface, no dep wiring, one build, one test command**. It is all TypeScript and tree-shakeable, so LSP consumers that never import `src/interp` pay nothing. **Alternative:** a sibling `packages/volt-st-run` — rejected: it would force `volt-lsp-iec` to export its parser/symbol-table internals as a public API purely to feed one in-repo consumer, which is more surface and more friction for no isolation benefit at this stage. If the interpreter ever grows its own consumers or ship target, splitting it out later is a mechanical move (`// ponytail:` upgrade path).

## Risks / Trade-offs

- **IEC semantics are a deep well (coercion, overflow, TIME, STRING ops, edge cases)** → a subtly-wrong rule gives confidently-wrong test results, worse than no test. **Mitigation:** oracle-diff harness (D6) is the gate; per-rule unit tests; fail-loud on unimplemented (D4). Never ship a rule the oracle hasn't confirmed.
- **Standard-library surface is large** → scope creep. **Mitigation:** registry + phased + fail-loud (D4); corpus/test-driven, not spec-exhaustive.
- **Depends on `st-body-ast` not yet built** → can't start. **Mitigation:** this change is scoped-only until the tree lands; sequencing is explicit.
- **Vendor ground truth for execution may be awkward to harvest headlessly** → oracle harness friction. **Mitigation:** start with POUs the headless bridge can already build/run; add a minimal bridge "run-and-dump" affordance only if needed, tracked separately.
- **Temptation to grow into a full soft-PLC** → out of scope. **Mitigation:** non-goals fix this at logic testing, not runtime replacement.

## Migration Plan

1. (Blocked on `st-body-ast`.) Stand up the value model + environment + expression evaluator; unit-test overflow/coercion/TIME.
2. Statement executor (assignment + control flow); scan driver + `bun test` API.
3. FB/function/method call semantics with the persistent instance store.
4. Minimal stdlib registry (timers + edge + counters) on the injected clock — only what the first tests need.
5. Oracle-diff harness on a small real-POU set; make it green; ratchet a coverage metric.
6. Grow stdlib + semantics test-by-test, each oracle-confirmed.

**Rollback:** additive new package/module; nothing else depends on it, so it can be shelved without impact.

## Open Questions

- ~~Package placement~~ — **resolved: one package**, `src/interp/` inside `volt-lsp-iec` (D7).
- **Test authoring surface**: is the audience engineers writing `bun test` in TS, or should tests be authored in ST itself (TcUnit-style FBs the interpreter runs)? (Lean: start with the TS API — lazier, no new authoring language; an ST-authored harness can wrap it later if demanded.)
- **How much vendor-runtime ground truth is harvestable headlessly** for D6, and whether it needs a bridge "execute + dump variables" endpoint (a separate bridge change if so).
- **Non-determinism sources** to forbid explicitly (e.g. `SysTimeGetMs`, pointer addresses) — enumerate and stub deterministically.
