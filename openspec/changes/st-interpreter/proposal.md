## Why

Today there is no way to **execute** PLC logic outside the vendor IDE — you can't unit-test a function block's behavior in CI without CODESYS/TwinCAT and hardware. The vendor test frameworks (TcUnit, CODESYS Test Manager) run in the real runtime (true ground truth) but are not headless, not CI-native, and not text-diffable. Once `st-body-ast` lands a statement/expression tree, a **tree-walking interpreter** over that tree gives hardware-free, deterministic, CI-native tests of ST logic — the missing piece for testing Volt-managed projects.

This is the proven, minimal path: a tree-walk evaluator is the textbook execution model (*Crafting Interpreters*), and the exact scan-cycle shape is validated by `esstee` (an existing ST interpreter: init inputs → run N scans → inspect state). We deliberately choose interpretation over a JS/C transpiler — the irreducible cost (encoding IEC execution semantics) is identical for both, and interpretation skips the codegen backend and build step.

## What Changes

- **New: an ST scan-cycle interpreter** — a tree-walking evaluator over the `st-body-ast` statement/expression tree, with an IEC value model (typed values with correct integer width/overflow, REAL/LREAL, TIME, BOOL, STRING, enums, structs, arrays), a variable environment with **persistent instance state across scans** (FB instance memory / RETAIN), and a statement executor (assignment, IF/CASE/FOR/WHILE/REPEAT, EXIT/CONTINUE/RETURN).
- **New: a scan-cycle driver + test API** — `set inputs → run N scans → read outputs`, exposed as a thin helper usable from `bun test`. Deterministic clock injection for time-dependent logic.
- **New: an oracle-diff harness** — run the same ST in CODESYS/TwinCAT and diff outputs against the interpreter (extends the existing `lsp-vs-compiler.ts` ground-truth pattern) so the evaluator is *proven correct*, not merely plausible.
- **Phased standard library** — start with the standard FBs/functions the target logic actually needs; **inject/stub** the rest rather than implement the full IEC stdlib up front. Coverage is ratcheted, corpus-driven.
- **Explicitly out of scope**: any ST→JS/C/LLVM **transpiler** (deferred — interpretation covers testing; a transpiler is a `// ponytail:` upgrade path only if large/fast simulation is later needed); type *checking* (that's the LSP's job and `st-body-ast` follow-ups); non-ST languages (IL/FBD/LD/SFC execution); real-time/timing fidelity beyond logical scan order.

## Capabilities

### New Capabilities
- `st-interpreter`: execute Structured Text POU logic in a deterministic scan-cycle model with persistent instance state, exposed as a headless test API, with correctness proven against the vendor-runtime oracle.

### Modified Capabilities
- (none — this is a new execution surface; it consumes the `st-body-ast` tree but changes no existing spec.)

## Impact

- **Depends on `st-body-ast`** — the interpreter walks that tree; it cannot start until the body AST exists. This proposal is scoped, not started, until then.
- **Code (volt-lsp-iec, or a new sibling package):** a new interpreter module (value model, environment, expression eval, statement exec, scan driver, stdlib-FB registry) + the test API + the oracle-diff harness. Decision on package placement is in design.md.
- **Tests:** unit tests per semantic rule (overflow, coercion, TIME arithmetic, instance persistence, control flow); the oracle-diff harness against a small set of real POUs; a ratcheted coverage metric (which POUs evaluate cleanly).
- **No wire/bridge/protocol impact** for the interpreter itself; the oracle harness reuses the existing headless-bridge build path to get vendor ground truth.
- **Unlocks**: CI-native regression tests of PLC logic for any Volt-managed project, and (later, if justified) a transpiler that reuses the same tree + semantics.
