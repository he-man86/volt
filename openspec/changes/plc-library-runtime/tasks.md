## Tier 1 — pure library functions as library-gated transpiler intrinsics · DONE (2026-09-21)

Delivered through `transpile-st-to-rust`'s STRING row; tracked there, summarised here. The boxes were still
unticked long after the code landed — `lowerStandardString` in `transpile/lower/builtins.ts` is the whole of it.

- [x] Gate: a call lowers to an intrinsic only when its callee resolves to a symbol under
      `Library Manager/Standard/` (or `Standard64/`); every other call stays a counted `expr-call`.
      `lowerStandardString` resolves the name and checks `libraryOf(sym) === "Standard"` — a project that
      references no Standard has no LEN, and a project FUNCTION called LEN is not this one.
- [x] Signatures read from the materialized `.fun` files — names, types, `STRING(255)` capacities. Taken from the
      symbol's own AST, never recalled: parameters and result both come from `sym.ast`, and an argument converts
      into the declared capacity exactly as the compiler passes it.
- [x] Standard: `LEN`, `LEFT`, `RIGHT`, `MID`, `CONCAT`, `INSERT`, `DELETE`, `REPLACE`, `FIND` — oracle-recorded in
      the fixture project (`Standard 3.5.18.0`), green in the interpreter and the emitted Rust. **69 string
      fixtures rated `confirmed`**; the three that are not are two refusals the vendor also refuses and one
      `not-lowered` (non-ASCII bytes).
- [x] A capacity edge measured, not assumed: a `STRING(300)` passed to a `STRING(255)` input —
      `string_input_truncation` asks `LEN`, `LEFT` and `CONCAT` of a 300-character argument.
- [ ] Standard64: the W-variants — needs a fixture project that references Standard64 before they can be
      recorded. Measured meanwhile as ABSENT rather than guessed: `WLEN`/`WLEFT` answer "Identifier 'WLEN' not
      defined" without the reference, and Standard's `LEN` refuses a WSTRING outright, so `wstring_basic`
      measures the WSTRING without functions at all.

## Tier 2 — stateful library FBs in a runtime · LATER

- [ ] Prerequisite: FB instances in the frame (`transpile-st-to-rust` design §9, phase 3).
- [ ] Prerequisite: a simulated clock injected per scan — never a wall clock.
- [ ] **Decision: native Rust crate + TS mirror, or ST shims** (design §5).
- [ ] `TON`/`TOF`/`TP`, `CTU`/`CTD`/`CTUD`, `R_TRIG`/`F_TRIG`, `RS`/`SR`, `RTC` — bound by (library, resolved version).
- [ ] Standard64's `LTON`/`LTOF`/`LTP`, `LCTU`/`LCTD`/`LCTUD`.

## What tier 1 did NOT decide, and is now worth writing down

- **A library with no BODY is a different problem, and it is bigger.** `call-library` blocks 34 corpus POUs and is
  the sole blocker of one; the names are vendor libraries (`L_MC1P_ModuloCycle`, `StrConcatA`, `SysTimeRtcGet`),
  not Standard's. `transpile-st-to-rust`'s plan parks that as the next proposal rather than a phase, and this
  change names none of those libraries.
- **A library's materialization is not the same thing as the library.** The conformance replay was measured on
  this in passing (2026-09-21): CODESYS's `Standard` materialization models TwinCAT's `Tc2_Standard` well enough
  that giving it to both vendors' replay projects added **zero false positives** across 2595 fixtures. That is a
  measurement about signatures agreeing, not a licence to treat the two as one library — a specific divergence,
  when one is found, is a reason to materialize `Tc2_Standard` separately.

## The spec delta against what was BUILT — checked 2026-09-21, before anyone archives this

Two of the three ADDED requirements are met by tier 1. The third is not, and saying so here is the point of the
check: a delta written at proposal time can assert a design the work never reached.

- [x] *a library element executes only where the project references its library* — met. `lowerStandardString`
      resolves the name and requires `libraryOf(sym) === "Standard"`; everything else stays a counted `expr-call`.
      - …with a CAVEAT that belongs to the LSP, not the transpiler: `reference.ts` still lists `LEN`…`FIND` and
        `TON`…`RS` as always-present names, so the LSP resolves them in a project that references no Standard
        while the transpiler refuses them. That is gap 10 in `transpile-st-to-rust`, parked by the user
        2026-09-14, and it is the one place the two disagree about this requirement.
- [x] *a library element's signature is read, not recalled* — met. Parameters and result come from the symbol's
      own AST, capacities included, so a longer argument is cut on the way in exactly as the compiler passes it.
- [ ] *a library element's behaviour is verified per library version* — **NOT met, and not started.** The gate is
      the FOLDER name (`libraryOf` matches `Library Manager/<folder>/`); nothing reads the `RESOLUTION` line of
      the `.library` manifest, so a project resolving a different `Standard` lowers to the same intrinsics with
      no word said. The manifests ARE parsed — `symbols/library-namespace.ts` reads LIBRARY, NAMESPACE and
      DEPENDENCIES for the namespace binding — so the version is one field away; what is missing is a decision
      about what to do when it differs, and a second recording to compare against.
