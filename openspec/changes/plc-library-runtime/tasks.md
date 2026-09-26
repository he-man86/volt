## SUPERSEDED 2026-09-25 — the library repo (design §6)

Tier 1's intrinsics below are DELETED: the nine string functions are ST in `packages/volt-lsp-iec/libraries/Standard/
3.5.18.0/`, written over `s[i]`, and the same recorded string fixtures confirm them (now 1947 confirmed, up from
1945 — `string_non_ascii_bytes` was only not-lowered for want of `s[i]`, and `cs_clock_reads` for want of
`TIME()`). The history below is kept as it was written.

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

## Tier 2 — the stateful FBs · DONE as ST in the library repo (2026-09-25)

- [x] Prerequisite: FB instances in the frame (`transpile-st-to-rust` design §9, phase 3).
- [x] Prerequisite: a simulated clock injected per scan — `TIME()`/`LTIME()` read a `__clock` global the harness sets.
- [x] **Decision: native Rust crate + TS mirror, or ST shims** (design §5) — ST, and as a repo (design §6).
- [x] `TON`/`TOF`/`TP`, `CTU`/`CTD`/`CTUD`, `R_TRIG`/`F_TRIG`, `RS`/`SR`, `RTC` — bound by (library, resolved version).
- [ ] Record the FB bodies against CODESYS — the edges the IEC definition leaves open (design §6, "Not yet recorded").
- [x] Util's `BLINK` (3.5.19.0 and 3.5.21.0, the versions the corpus resolves) — the Util element real code calls
      most (44 sites); its phase timer is Standard's TP, so it is also one repo library running on another. One more
      corpus POU lowers (54 -> 55).
- [ ] StringUtils — blocked on the memory model, not on writing it: every element takes a `CHARBUFFERPTR`
      (`POINTER TO BYTE`) that callers fill with `ADR(someString)`, a byte view of a string the pointer model does
      not hold (`pointer-order`).
- [ ] Standard64: a fixture project that references it, then `libraries/Standard64/<version>/` — the W-functions,
      `LTON`/`LTOF`/`LTP`, `LCTU`/`LCTD`/`LCTUD`.

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

## The spec delta against what was BUILT — re-checked 2026-09-25, before anyone archives this

The delta was rewritten to the library repo (it described tier 1's intrinsics). Against the code:

- [x] *a library element executes only where the project references its library* — met: a body exists only where
      `withImplementations` put the repo's file under the project's own `Library Manager/<library>/`, and
      `prepareProject` marks every library unit, so a bodyless one is refused (`call-library`) rather than run empty.
- [x] *a library element's interface is the materialized one* — met and gated: `test/libraries/standard.test.ts`.
- [x] *a library element runs only for the version it was written for* — met by the key: the repo is looked up by the
      manifest's RESOLUTION; the same test holds that 3.5.19.0 stays refused.
- [x] *the LSP knows a library only through its materialization* — met: `src/reference/` lists no library element.
      pro2193 calls `StrReplaceA`, which the old bridge never materialized (it dropped return-less functions); the
      bridge renders them now, and the corpus build gate stays red on that one name until pro2193 is re-pulled.
- [ ] Behaviour recorded against CODESYS for the FB bodies — see tier 2 above.
