Rehomed from `build-st-language-server` (task X.1). The architecture is in place; coverage is the work.

## Done — the skeleton, and the executable core

- [x] `ir/` — places-not-references, resolved types, one loop shape, coded codegen diagnostics.
- [x] `lower/` — assignment, expressions, IF/ELSIF, CASE, FOR/WHILE/REPEAT, EXIT/CONTINUE/RETURN.
      Total: never throws; every gap is a counted code.
- [x] `interp/` — runs the IR.
- [x] `emit/rust/` — flat struct + `scan(&mut self)`, `wrapping_*` numerics, source map. Verified by rustc
      (`--emit=metadata -D warnings`), which is also the proof the no-references decision holds.
- [x] `scripts/lower-completeness.ts` — the ratchet.

## Coverage — in the order the corpus says (301 POUs with a body; 1 lowers)

- [ ] `stmt-call_stmt` (254 POUs, 84%) — calling an FB instance. Needs instances in the frame.
- [ ] `expr-member` (91, 30%) — `inst.Q`, `struct.field`. Needs `Place.path`.
- [ ] `place-shape` (84, 28%) — assigning to a member/index.
- [ ] `expr-call` (60, 20%) — FUNCTION calls, standard functions among them.
- [ ] `place-not-local` (47, 16%) — GVL access. Needs a frame wider than one POU.
- [ ] `aggregate-init` (31, 10%) · `assign-op` (17) · `type-unknown` (16) · `stmt-try` (6) ·
      `expr-index` (4) · `expr-assign_expr` (1) · `expr-deref` (1)
- [ ] METHOD/ACTION bodies — 34090 of them, sharing their FB's frame. The single biggest unreached surface.

## Open decisions

- [ ] **The standard blocks (TON, CTU, R_TRIG …) are a LIBRARY, not language.** They belong in a Rust runtime
      crate beside the IEC numeric semantics, written once and ground-truthed against the vendor — not
      hardcoded in the language server. Parameter names must come from the bridge's library-signature
      extraction, not from memory. Where that crate lives is undecided; it gets created when something needs
      it, not before.
- [ ] `test/exec/` — build the emitted Rust and drive scan cycles. Blocked on nothing but a reason: the
      interpreter already answers "does this POU compute the right thing", and `--emit=metadata` already
      answers "is the Rust valid".
