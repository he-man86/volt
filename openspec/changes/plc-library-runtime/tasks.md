## Tier 1 — pure library functions as library-gated transpiler intrinsics · NOW

Delivered through `transpile-st-to-rust`'s STRING row; tracked there, summarised here.

- [ ] Gate: a call lowers to an intrinsic only when its callee resolves to a symbol under
      `Library Manager/Standard/` (or `Standard64/`); every other call stays a counted `expr-call`.
- [ ] Signatures read from the materialized `.fun` files — names, types, `STRING(255)` capacities.
- [ ] Standard: `LEN`, `LEFT`, `RIGHT`, `MID`, `CONCAT`, `INSERT`, `DELETE`, `REPLACE`, `FIND` — oracle-recorded in the
      fixture project (`Standard 3.5.18.0`), green in the interpreter and the emitted Rust.
- [ ] Standard64: the W-variants — needs a fixture project that references Standard64 before they can be recorded.
- [ ] A capacity edge measured, not assumed: a `STRING(300)` passed to a `STRING(255)` input.

## Tier 2 — stateful library FBs in a runtime · LATER

- [ ] Prerequisite: FB instances in the frame (`transpile-st-to-rust` design §9, phase 3).
- [ ] Prerequisite: a simulated clock injected per scan — never a wall clock.
- [ ] **Decision: native Rust crate + TS mirror, or ST shims** (design §5).
- [ ] `TON`/`TOF`/`TP`, `CTU`/`CTD`/`CTUD`, `R_TRIG`/`F_TRIG`, `RS`/`SR`, `RTC` — bound by (library, resolved version).
- [ ] Standard64's `LTON`/`LTOF`/`LTP`, `LCTU`/`LCTD`/`LCTUD`.
