Rehomed from `build-st-language-server` (task X.1). The architecture is in place; coverage is the work.

**Two progress measures, for two kinds of work.**
- **Primitives (phase 2)** — measured by the oracle: every type/operator row below is done when its cases in
  `test/exec` are recorded from CODESYS and green in BOTH `interp/` and the emitted Rust.
- **Structure (phase 3+)** — measured by `bun run scripts/lower-completeness.ts` over the 4-project corpus
  (304 POUs with a body). Primitives barely move that number, by design: calls to FB instances (84%) and member
  access (31%) block nearly every real POU, and both wait on design §9. Primitives go first anyway (decided
  2026-09-14): they are fully testable today, need no design decision, and are what an ST unit test exercises most.

**The current work order is "The plan from here" below (2026-09-16)** — measured by `sole` blocker, not by reach.
The phases below record what was built and what it measured; they are no longer the order.

## Phase 0 — the skeleton and the executable core · DONE

- [x] `ir/` — places-not-references, resolved `types/` `Type` per node, one loop shape, coded diagnostics.
- [x] `lower/` — assignment, expressions, IF/ELSIF, CASE, FOR/WHILE/REPEAT, EXIT/CONTINUE/RETURN.
      Total: never throws; every gap is a counted code.
- [x] `interp/` — runs the IR.
- [x] `emit/rust/` — flat struct + `scan(&mut self)`, `wrapping_*` numerics, source map. Verified by
      `rustc --emit=metadata -D warnings`, which is also the proof that decision 1 holds.
- [x] `scripts/lower-completeness.ts` — the ratchet, counted over POUs with a body.
- [x] `check-layering.ts` — inside `transpile/`, only `ir/` crosses folders.

## Phase 1 — the oracle · DONE

Nothing after this is built on remembered vendor behaviour (design §7).

- [x] Read variable state from CODESYS after N scan cycles: `bun run record:exec` runs `scripts/record-exec.py`
      inside a headless CODESYS, in SIMULATION, on a copy of the fixture. **Not a pipe verb**, as this line first
      said: the scripting `online` object only works inside a running script — measured on SP21 by
      `volt-cli/scripts/probe-online-state.py` (`ScriptOnline` peeks an execution stack that is empty outside one).
- [x] `test/exec/differential.test.ts` — same program, same initial values, IDE vs `interp/` AND vs the emitted
      Rust (each case its own debug binary, so an overflow panic is a divergence). Replays
      `test/exec/recordings/expected-codesys.json` offline, like `test/conformance/`.
- [x] Seed it with the executable core: arithmetic at type boundaries, integer division and MOD signs,
      REAL/LREAL precision, CASE range edges, FOR with a negative step.
- [x] Fix every divergence found — all in design §4: `7 / 2` into REAL is 3; REAL is float32; integers wrap at
      width; ints AND bit strings under 32 bits promote to signed DINT; AND/OR/XOR and unary minus promote, NOT
      does not; one REAL operand makes a division REAL; all-constant integers fold at full width. `**` and an
      implicit REAL → INT do not compile in CODESYS.
- [x] Re-verify C0582's wording. **It cannot be verified on SP21** (`volt-cli/scripts/probe-duplicate-method.py`):
      the object tree refuses a second same-named method at CREATE, so the compiler never sees the repro.
      Whether the LSP should mirror that creation error instead is an LSP-catalog decision, not taken here.

## The input contract — code CODESYS compiles (decided with the user 2026-09-14)

The transpiler is defined only for programs the vendor build accepts; the gate is that build, not the LSP (false
negatives). Written into `src/transpile/index.ts`. Consequences, done: `**`/`&` lost their IR meanings (neither parses
in CODESYS) and the IR `pow` op went; the `LEN(WSTRING)` refusal went. "Does not compile" is MEASURED: an exec case with
`rejects` asserts the refusal. Every remaining refusal is valid code, *not modelled yet* or *not measured yet*.
- [x] Recorded 2026-09-14 — every probe refused: `**`/`&` (parse errors), `LEN(WSTRING)`, `'x' + 'y'` ("Cannot convert
      type 'STRING' to type 'ANY_NUM'"), `word16.16` ("'16' is no valid bit number"), and STRING↔WSTRING stores and
      comparisons — so `mixedWidth` (`string-width`) was deleted: lowering has no rule for input that cannot exist.

## Phase 2 — the primitives · IN PROGRESS

Every row: record oracle cases FIRST, then implement, then green in both backends. In this order:

- [x] **Value functions** — `MAX` 309 · `SEL` 209 · `LIMIT` 62 · `MIN` 57. One `IrBuiltin` node; see design §10,
      incl. why LIMIT is not Rust's `clamp`.
- [x] **Conversions** — the `*_TO_*` family (504 sites, 43 names) plus `TRUNC`/`TRUNC_INT`, and `TO_*`. Done
      2026-09-14: 14 oracle cases, green in both backends; one `convert` node shared with the implicit conversions,
      table-driven from family/bits/signed. Measured rules in design §11 — REAL → integer rounds half AWAY from zero
      (the interpreter truncated); every integer result wraps; TRUNC out of DINT range is DINT's minimum (not a wrap).
      `expr-call` 58 → 53 POUs. TIME/DATE/STRING conversions report `conversion-type` until their rows.
- [x] **Math** — `ABS`, `SQRT`, `LN`, `LOG`, `EXP`, `EXPT`, `SIN`/`COS`/`TAN`/`ASIN`/`ACOS`/`ATAN`. Done 2026-09-14:
      9 oracle cases, green in both backends; rules in design §12 — a REAL argument computes in float32, an LREAL or
      integer in LREAL; EXPT is REAL only when both arguments are REAL; ABS promotes. Left open, each noted in §12:
      - runtime exceptions (a math domain error, division by zero) — the application stops; not modelled, and the
        oracle cannot record a value for one;
      - the LSP types EXPT as always LREAL (`reference.ts`) — maybe wrong for `EXPT(REAL, REAL)`, undecidable from
        values; an LSP-catalog question;
      - `**` does not parse in CODESYS, yet `lower.ts` still maps it to `pow`.
- [x] **Bit operations** — `SHL`/`SHR`/`ROL`/`ROR`, `MUX`, bit access `x.3` for READ and WRITE. Done 2026-09-14:
      13 oracle cases, green in both backends; rules in design §14 — SHL/SHR shift the promoted value with an
      x86-style count mask (5 bits, 6 for 64-bit types) and SHR is arithmetic on signed; ROL/ROR keep their own width;
      MUX's out-of-range K picks the last input; bits are two's complement. Rust's `wrapping_shl`/`rotate_left` match
      every edge. Bit access is the first `Place.path` step and needed no §9 decision. **Ratchet: fully lowered
      1 → 5 of 304** — the first primitive row to move it. `bit-on-reference` (1 POU) is aliasing, phase 4.
- [x] **Set/reset assignment** — `S=` / `R=`. Done 2026-09-14: 7 oracle cases, green in both backends; rules in
      design §15 — a latch, not an assignment; in a chain the VALUE flows right to left, converted at each link, and
      a latch passes it on unchanged. `assign-op` 17 → 0 POUs; **fully lowered 5 → 6 of 304**. Bugs it exposed, each
      with the test gap that let it through: the LSP parser rejected valid chains (no chain test, no `S=` fixture,
      none in the corpus); the formatter would have rewritten `a S= b R= c` into `a S= b S= c` (no chain test); two
      temps in one POU emitted duplicate Rust fields (no test ever had two temps).
- [x] **TIME / LTIME** — Done 2026-09-14: 6 oracle cases, green in both backends; rules in design §16 — TIME is
      32-bit MILLISECONDS (max + 1 ms wraps to 0), LTIME 64-bit nanoseconds, a duration × ÷ an integer stays a
      duration, `T#1500US` does not compile. The suspected bug was real, and worse: every duration was an unbounded
      bigint of nanoseconds (emitted `i64`), and `t : TIME := T#1S` started at 0 because `constEval` skips durations.
      *Why missed:* no TIME oracle case; the unit was a recalled note while `types/elementary` said 32 bits. Ratchet
      unchanged (6 of 304) — no POU was blocked on TIME alone. LSP gaps 7/8 (above) await a bridge pass.
- [x] **DATE / TOD / DT** (+ L variants) — Done 2026-09-14: 10 oracle cases, green in both backends; rules in design §17
      — DATE/DT 32-bit SECONDS (not days), TOD 32-bit milliseconds NOT reduced modulo a day, L variants 64-bit ns; a
      date ± a duration truncates into the date's unit; date − date scales into TIME and wraps as a UDINT. Bugs: a date
      literal was typed STRING, its initializer never folded, date arithmetic did not lower, and `types/elementary`
      said DT is 64 bits. *Why missed:* no date oracle case. The recorder's TOD/DATE displays are lossy, so the replay
      compares values as displayed and reads stored truth through `*_TO_UDINT`. Ratchet unchanged (6 of 304).
- [ ] **STRING / WSTRING** — nearly done 2026-09-14; rules in design §18. Green in both backends: capacity on the
      resolved type (sizeless = 80, STRING and WSTRING), truncation on every store, comparison by code unit, every `$`
      escape, the nine Standard string functions as LIBRARY-GATED intrinsics (bound only to `Library Manager/Standard/`,
      signature STRING(255) from the `.fun`, so a longer argument is cut on the way in) with all position edges, and
      integer/bit string/BOOL/TIME → STRING, STRING → integer/REAL/LREAL. Rust: a generated `IecStr<T, N>` (u8 / u16).
      Bugs, each with why no test caught it (§18): every string slot started EMPTY (`declare` silently dropped an
      unfoldable initializer — now `init-not-constant`, 22 corpus POUs that were silently wrong); `String` moved out of
      `self`; `STRING(n)`'s length was never resolved; the recorder mangled non-ASCII in both directions. Open:
      - **LREAL_TO_STRING — DONE 2026-09-19.** The 2026-09-14 decision ("no one digit rule fits the samples") was
        right about both and true of only one. A sweep of 70 more cells determined the LREAL formatter completely —
        fifteen significant digits, trailing zeros stripped, FIXED while the decimal exponent is 0..13 and
        exponential otherwise with a lowercase `e` — and it is implemented in the interpreter and mirrored in the
        prelude, with all 35 of its cells `confirmed` in both backends;
      - **REAL_TO_STRING — stays REFUSED**, now with the evidence rather than the impression. It is a DIFFERENT
        formatter (uppercase E, exponent padded to two digits, no `.0` on an exponential mantissa, fixed down to
        1E-4) and 70 cells show it is not derivable: two exponential cells print EIGHT significant digits beside
        four printing seven at the same magnitudes, and four fractions round their seventh digit where rounding the
        value does not — 1/3 is `'0.3333334'`, 1/7 is `'0.1428572'`, while 1/9 and 1/11 print eight and stop;
      - (done) WSTRING is UTF-16 units — `wstring_code_units`, recorded once the recorder stopped mangling non-ASCII;
      - Standard64's W-functions — PARKED with the rest of the Standard-library work (user, 2026-09-14).

## Found along the way — LSP gaps the oracle exposed · RESEARCH AND FIX (decided 2026-09-14)

The execution oracle compiles every case in real CODESYS, so it keeps finding places where the LSP disagrees with
the compiler. Each is researched and fixed where found, not parked: a conformance fixture recorded from the live
compiler (`bun run record:language`, `RECORD_ONLY=`) so the wording is the IDE's, then the fix, then a colocated
test. A rule that may differ on TwinCAT goes behind the vendor config — never a new FP on the other vendor.

**Every fix also answers "why did no test catch this?" — and closes THAT hole** (decided 2026-09-14). The pattern so
far: the conformance gate fails only on a FALSE POSITIVE, and its agreement ratchet only covers fixtures that already
exist — so a construct with no fixture can be silently accepted forever, and the corpus cannot help (real projects do
not contain the invalid code). A missing fixture is the symptom; the class fix is a coverage check (e.g. every
operator and reserved word in the reference catalog has a conformance fixture), so the next gap shows up as a missing
row instead of being found by accident.

All five fixed 2026-09-14 — 22 fixtures in `check-coverage.ts` recorded live over the bridge; CODESYS exact agreement
264 → 275 (floor raised), zero-FP gate and corpus green:

- [x] **`R` / `S` as names** — CODESYS rejects a variable named `r`/`s` at the declaration AND every use
      (`Unexpected token 's' found`, echoing the name as written). New check `names/set-reset-name.ts`, CODESYS-only
      (TwinCAT unmeasured). *Why missed:* the lexer reads a bare `r`/`s` as an identifier; no fixture declared one;
      no project does. **It also exposed three unit tests whose "compiler-accepted" premise was false** — they
      declared `s` — verified by `cc_reserved_name_s_string`, then renamed.
- [x] **`**`** — CODESYS parse error (`';' expected instead of '**'`, `Unexpected token '**' found`). New check
      `types/power-operator.ts`, CODESYS-only. *Why missed:* the grammar took `**` from the IEC standard, never a
      compiler, and no fixture used it.
- [x] **Unary minus typing** — the signed type of the operand's width, at least 16 bits: SINT/USINT/BYTE/UINT/WORD →
      INT, UDINT → DINT (64-bit unsigned unmeasured → unknown), plus the operand's "change of sign" for UINT/WORD/
      UDINT. `infer.ts` `negatedType`, `narrowing.ts` `negationOperandWarning`. *Why missed:* a recalled comment
      ("NOT/-/+ preserve the type") and no FP-bait or fixture ever negated a narrow type.
- [x] **EXPT's type** — REAL only when both arguments are REAL, else LREAL (an int literal counts as not-REAL; a REAL
      beside an int literal stays unknown — unmeasured). It was a LIVE FALSE POSITIVE: `real := EXPT(real, real)`
      warned. `infer.ts` `exptType`; the recalled "always LREAL" left `reference.ts`. *Why missed:* no fixture
      stored a REAL-argument EXPT into a REAL.
- [x] **Chained `a S= b R= c`** — parser + formatter fixed (design §15); `cc_fp_set_reset*` recorded and green.
- [x] **`T#1500US`** (gap 7) — FIXED 2026-09-14. Recorded (`cc_time_microsecond_literal*`, `cc_time_nanosecond_literal`,
      `cc_time_seconds_then_microseconds`, `cc_fp_ltime_microsecond_literal`): a TIME literal has no US/NS unit — CODESYS
      ends the literal there and reports `';' expected instead of 'T#1500'` and `Expression expected instead of 'T#1500'`
      (+ a failed initial value in a declaration); `LTIME#1500US` is fine. The lexer now ends a TIME body at `u`/`n`/`µ`,
      and `types/time-literal-unit.ts` (CODESYS-only) reports the literal. *Why missed:* the lexer accepted every duration
      unit for every duration prefix (LTIME needs them), no fixture used one on a TIME, no compiling project has one.
- [x] **LTIME literal typing** (gap 8) — FIXED 2026-09-14. Inference typed `LTIME#1S` as TIME: `lt := LTIME#1S` was a
      FALSE POSITIVE and `t := LTIME#1S` silent ("Cannot convert type 'LTIME' to type 'TIME'"). `infer.ts` reads the
      prefix. *Why missed:* one `literalKind` for both, and no fixture put an LTIME literal anywhere. An `LT#` prefix was
      claimed by inference and by the transpiler without a measurement (the lexer reads `LT` as a keyword) — removed.
- [x] **The class fix: every grammar operator has a fixture** — `test/conformance/coverage.test.ts` reads the grammar's
      own `BINARY_PRECEDENCE`. First measured: `/`, `<=`, `&`, `XOR`, `AND_THEN`, `OR_ELSE` had NO fixture. Recording
      them found **gap 6 on the spot: `&` is not an operator in CODESYS** (parse error, exactly like `**`) — the check
      became `types/unsupported-operator.ts` for both. CODESYS agreement 275 → 280.
- [ ] **C0582's wording** — unreachable on SP21 (design §7 of phase 1 above). Mirror the tree's creation error
      instead? A decision for the user, not researched further.
- [x] **A Standard function's arguments are never checked** (gap 9) — FIXED 2026-09-14: a library FUNCTION's arguments
      are checked (a library FB or method stays skipped — inheritance is flattened there); `renderType` prints a declared
      string length (`STRING(255)`); the CODESYS replay project now holds Standard's `.fun` files, as the recording
      project does. Fixture `cc_standard_len_wstring`. — `call-arguments.ts` skips EVERY library callee
      ("library signatures flatten var sections"), so `LEN(wide)` with a WSTRING is silent while CODESYS refuses it:
      "Cannot convert type 'WSTRING' to type 'STRING(255)'" (execution oracle, `wstring_basic`, 2026-09-14). Standard's
      materialized `.fun` files are complete (VAR_INPUT kept), so the skip is too broad for them. Needs a fixture recorded
      live before the fix. *Why missed:* the skip was written for lossy libraries and no fixture passed a library
      function a wrong argument.
- [x] **Arithmetic on a STRING is silent** (gap 11) — FIXED 2026-09-14 in `binary-operators.ts`: a string on the LEFT of
      + - * / is "Cannot convert type '<STRING|WSTRING>' to type 'ANY_NUM'", on the RIGHT of a number "Cannot convert type
      'STRING' to type '<that number>'" (fixtures `cc_string_*`, `cc_int_plus_string`, `cc_wstring_plus_wstring`). — `joined := left + right` with two STRINGs: CODESYS "Cannot convert
      type 'STRING' to type 'ANY_NUM'" (exec `string_arithmetic_rejected`, 2026-09-14); the LSP reports nothing. Found by
      running every `rejects` case through `computeSemanticDiagnostics`: 4 of 6 agree (`**`, `&`, bit number, STRING↔
      WSTRING); the other miss is gap 9. *Why missed:* `binary-operators.ts` covers BOOL-with-numeric, and no fixture
      added two strings.
- [x] **A stray token after a declaration's initializer is silent** (gap 12) — FIXED 2026-09-14. `x : INT := 5 abc;` is
      "';' expected instead of 'abc'" (fixtures `cc_decl_init_trailing_ident` / `_int`); found while fixing gap 7, whose
      declaration shape stayed silent. `var-section.ts` reports the first token after a complete scalar initializer.
      *Why missed:* `collectInitTokens` took everything up to `;` and an unparsable tail became an opaque aggregate with
      no error; no fixture had a malformed initializer.
- [x] **An untyped integer literal out of its target's range is silent** (gap 13) — FIXED 2026-09-14, found by the class
      fix below the moment the transpiler review recorded `b : BYTE := 300` as not compiling. CODESYS types the literal
      as the narrowest of SINT, USINT, INT, UINT, DINT, UDINT, LINT, ULINT that holds it and converts that like a variable:
      300 into BYTE is "Cannot convert type 'INT' to type 'BYTE'", 128 into SINT a sign-change warning, and a value the
      target holds is silent (`us := 5`, `w := 5`, `b := 255`). 27 fixtures (`overflow_*`, `cc_literal_*`,
      `cc_fp_literal_*`). `types/elementary.ts` `integerLiteralType` (also the transpiler's literal fallback, which had
      its own SINT/INT/DINT/LINT list) and `types/infer.ts` `literalCheckType`, used by the assignment and sign-change
      checks for statements and declarations. CODESYS agreement 293 → 311, TwinCAT 253 → 255. *Why missed:* the
      constant-overflow check was removed as a false positive (2026-07-07) with the note "CODESYS accepts out-of-range
      untyped literals" — true only when the literal's own type still converts; the error half was never re-homed.
- [ ] **A declaration's initializer is never type-checked** (gap 14) — the assignment and sign-change checks walked
      statements only; gap 13 added declarations for the measured literal shape alone. `x : BYTE := someInt;` and every
      other non-literal initializer stay unchecked until recorded.
- [x] **The class fix: every source CODESYS refuses is an LSP error** — `test/exec/rejects-lsp.test.ts` runs every exec
      `rejects` case through the LSP and requires CODESYS's own wording. It went red on gaps 9 and 11 before their fixes.
- [x] **The replay counted every declaration parse error twice** (`replay.test.ts` pushed `parseResult.errors` next to
      `checkParseErrors`, which already reports them) — so no declaration-level parse-error fixture could agree exactly.
      Removed; CODESYS agreement 280 → 293 across this pass.
- [ ] **Standard's functions and blocks are also hard-coded as always-present names** (gap 10, raised by the user
      2026-09-14) — `reference.ts` lists LEN…FIND and TON…RS, so they resolve even in a project that references no
      Standard. Analysis done. **PARKED by the user 2026-09-14** ("a lot still to cover before we get to that") —
      together with all other Standard-library work (Standard64, the runtime tier).

## Route the oracle through the C# bridge — every case becomes a CLI test too (proposed 2026-09-14)

`record:language` already talks to the live IDE through the bridge (`push` → `build` → diagnostics over the pipe);
`record:exec` does not — it is a headless runscript, because the scripting `online` object only works inside a
running script (`volt-cli/scripts/probe-online-state.py`). Routing the execution oracle through the bridge turns
every oracle case into a real-code test of the bridge the CLI ships, on constructs its own fixtures never hold:

- [ ] **Push round-trip** — push each case's ST through the bridge, fetch it back, require it byte-identical. Existing
      ops only; catches serialization bugs on bit access, chains, conversions, literals.
- [ ] **Build parity** — the bridge's `build` diagnostics for each case agree with what the oracle compile reported.
- [ ] **Execution through the bridge** — a `run` op on the Core online API (`IOnlineApplication.Login/Start/
      SingleCycle` exist on SP21); reading values there is still to probe. Only then can `record:exec` drop the
      runscript. TwinCAT would need its own answer.

## Phase 3 — the memory model, then the frame · DONE 2026-09-14 (form 1 pointers; form 3 handles not needed by any recorded case)

**Result.** Conformance cases lowering 111 → 349 of 384, every result equal to CODESYS in both backends. The corpus
ratchet (one symbol table per project): POUs with a body lowering **4 → 24 of 304**. What blocks the corpus now — the
work list after this phase, most first: `place-shape` 149 · `init-not-constant` 142 · `place-not-local` 121 (mostly
library globals and constants) · `enum-value` 73 (a written value that does not fold) · `call-this` 63 (a bare method
call inside an FB) · `aggregate-init` 56 · `call-positional` 38 · `attr-instance-path` 35 · `layout-struct` 33 (library
structs) · `call-extends` 33.

**Decide design §9 before writing any of this.** Instances, methods and GVLs are what a pointer points at;
building them on slot indices and then finding `ADR` needs offsets means doing the work twice.

**The ratchet today (2026-09-14, one symbol table per project):** 4 of 304 POUs with a body lower. It read 6 before the
review refused struct- and FB-typed slots the emitter could not print (`slot-struct`, `slot-function_block`) — a
deliberate drop, not a regression. `stmt-call_stmt` blocks 256, and is the ONLY blocker of 93: calls on declared FB
instances alone take the ratchet from 4 to as many as 97.

**The plan — a new IR, built in this order, each step oracle-first (record, then build, then green in both backends):**
1. **Port before adding.** A backend-only type that is total by construction; places as root (self · globals · a
   parameter) + path (field · normalised index · bit); lowering's failure propagation a throw caught at the POU
   boundary. Gate: every case `transpile.test.ts` passes today still passes, value for value, before anything new lands.
2. **The application frame.** A DUT is a struct, an FB a struct of its VAR/VAR_INPUT/VAR_OUTPUT/VAR_STAT, the GVLs one
   `Globals`, each program `fn scan(&mut self, g: &mut Globals)` (design §9, `memory-sketch.rs`).
3. **Calls on declared instances** (the 93): `inst(a := x, q => y)` assigns inputs, runs the body, reads outputs.
   Record first: inputs retained across calls, outputs read after the call, an instance called twice in one scan, an
   unconnected input.
4. **METHOD / ACTION bodies** on the FB's frame; **FUNCTION calls** with locals per call (record whether they reset).
5. **Member access and GVLs** (`expr-member` 95, `place-shape` 91, `place-not-local` 51) on the same places.
6. **Handles** — ADR, POINTER TO, REFERENCE TO, VAR_IN_OUT (phase 4's list moves here: the model is settled) — and
   SIZEOF from the measured layout.
**Checkpoint before step 1:** the user reviews this plan, since it replaces the IR the interpreter and emitter print.
Reviewed — "loop over this plan to refactor and finish" (user, 2026-09-14). Step 1 was folded into step 2: the IR was
reshaped in place, each commit gated value-for-value by the conformance replay, rather than duplicated beside itself.

- [x] **Step 2 — the frame is a tree of owned values.** DONE 2026-09-14: places are root + `field`/`index`/`bit` path,
      layouts for every struct and FB, bounded arrays (`types/` resolves constant bounds), whole-struct copies; Rust
      plain structs with `new()`. Cases lowering 111 → 117. Bug caught by the oracle: a BIT field is a boolean.
- [x] **Step 3 — calls on declared FB instances.** DONE 2026-09-14: inputs and outputs are assignments around an
      `IrCall`; the FB body runs on the instance; VAR_IN_OUT is a bound place / `&mut` parameter. Twelve `fbcall_*`
      fixtures recorded first. Cases lowering 117 → 233. Bugs the newly running fixtures caught: a constant was not
      stored at its variable's width (`INT := 40000`, `si := 128` — rustc rejected the literal) and an integer into a BOOL
      stayed an integer. Refused, counted, until measured: FB with VAR_TEMP, EXTENDS, `instance-path` and `call_after_*`
      attributes (the AST keeps no pragmas — `syntax/unitAttributes` reads the lexer), a VAR_IN_OUT aliasing its instance.
- [x] **Step 4 — METHOD / ACTION / FUNCTION calls.** DONE 2026-09-14: an `IrInvoke` runs an `IrRoutine` — per-call
      locals (result, VAR_INPUT, VAR), the instance's fields for a METHOD or ACTION, VAR_IN_OUT bound. Rust: an `fn` in the
      FB's `impl`, a free `fn` for a FUNCTION, inputs by value. Cases lowering 233 → 315. The newly running cases caught: a
      backtick-quoted variable (`` `TYPE` ``) that the path readers could not name — and, in the test harness, one case that
      throws while being prepared took every emitted-Rust case down with it (each is now prepared on its own). Deferred,
      measured: `op_math_trig` — COS(1.5708) is one ULP from CODESYS's value. Refused, counted, until measured: a routine
      with VAR_OUTPUT, VAR_INST or VAR_STAT, a call with an input left out, a METHOD of a derived FB (dispatch), a bare
      or THIS^ method call inside an FB (`call-this`), and an FB carrying `instance-path` or a `call_after_*` attribute
      (now refused wherever it is instantiated — the compiler acts on it without a call).
- [x] **Step 5 — PROGRAM calls and GVLs.** DONE 2026-09-14: a GVL variable and a called PROGRAM's instance are the
      application's storage (`IrPou.globals`, place root `global`), shared by every body. A VAR_EXTERNAL declared a
      LOCAL COPY until now — a write through it would never have reached the global; it names the global instead. Rust
      keeps two structs so a call borrows two things: `Globals` (handed to every body as `g`) and `Programs` (the POU's
      own `scan` only) — `prg.prg_writer.call(g)`, where one struct would have been borrowed twice (rustc E0499, caught
      by `fbcall_program_writes_global`). Cases lowering 315 → 317. Refused, counted: a PROGRAM called from inside an FB,
      a routine or another program, a VAR_IN_OUT bound to a global, and a library's globals.
- [x] **Enums and THIS^** (pulled forward from phase 5: 23 recorded cases, measured semantics, no handle needed). DONE
      2026-09-14: an enum variable is stored as its written base type, else INT (as a project enum converts); `E.Value`
      and a bare value are constants — the written `:= n`, else one more than the value before, from 0 — in expressions
      and CASE labels; a variable's own name wins over an enum value's. `THIS^` is a place root: the instance the body
      runs on (`self` in Rust). CODESYS displays an enum value by NAME, so the replay maps it back through the case's
      TYPE declarations. Cases lowering 317 → 340, every earlier result unchanged.
- [x] **Step 6a — the byte layout.** DONE 2026-09-14: `SIZEOF` of a variable or a type, and `ADR(a) - ADR(b)` inside
      one variable, are constants from the layout the `mem_*` fixtures measured — each field aligned to its own size, a
      struct padded to its widest field, a BOOL one byte, a STRING(n) n + 1, an array whole elements, an FB instance an
      8-byte header plus its variables (its fields have no offset: where the header sits is not measured). VAR_TEMP,
      VAR_STAT and lowering's temps are not instance storage. A ULINT, as a SIZEOF widens into one without a message.
      Refused, counted: a BIT, a WSTRING, a pointer or a reference inside the type; an FB field's offset. Cases lowering
      340 → 343 — the three layout fixtures agree with CODESYS in both backends.
- [x] **Step 6b — pointers and references with one target** (design §9 form 1). DONE 2026-09-14: lowering records each
      pointer or reference variable's ONE target — a variable, or an array's elements — and its value is 0 (null), 1, or
      element index + 1, a plain integer in both backends (`usize` in Rust). A dereference lowers to the target place
      itself, guarded by the pointer: a null one throws in the interpreter and panics in Rust, as it stops the CODESYS
      application. `ADR`, `REF=`, `p^`, `p[i]`, `p + n·SIZEOF(T)`, `pInst^.M()`, reference reads and writes, `= 0`/`<> 0`
      and `__ISVALIDREF` lower. Cases lowering 343 → 349. Caught by the replay's Rust half: the pointer–integer crossings
      went unconverted (`convert` skips a non-elementary side), so an `i64` reached a `usize` field — now an explicit node.
      Refused, counted: a pointer with more than one target (form 3, the handle enum), a pointer's value used as a number
      (it is no real address here), a dereference before any address was stored, and a persistent pointer to a local or
      VAR_IN_OUT that dies with the call (`mem_adr_of_inout_member`).

- [x] **Review before phase 3** (2026-09-14, design §19): four emitter/lowering bugs found by probe and fixed — CONTINUE
      (3 oracle cases recorded), Rust field names (keywords, snake_case collisions), unrepresentable slots. Direction
      chosen: keep the measured semantics and the oracle; phase 3 is a new IR on the settled memory model.
- [x] **Decision: slot+path, byte-addressed image, or the hybrid.** DONE 2026-09-14 — the handle-first hybrid (user),
      from a corpus census; six `mem_*` fixtures recorded (layout, FB header, pointer steps, method through a pointer,
      ADR of a VAR_IN_OUT member); `memory-sketch.rs` proves the emitted shape is plain safe Rust (design §9).
- [x] **Multi-agent review after phase 3** (2026-09-15): six confirmed bugs fixed, each with a colocated test and why it
      was missed — an address re-reading a runtime index, `r = 0` on a REFERENCE, writes through a reference by `=>` /
      VAR_IN_OUT / `S=` `R=` / chains, `ADR` of another type, a routine calling itself, a call on a GVL instance. The
      unverified findings were checked (borrow claims by compiling): eager BOOL AND/OR in Rust, in-out aliasing across
      bindings and THIS^, a call nested in a call's arguments, a bit store naming its place twice, SIZEOF of derived
      and in-out layouts, an enum type's default — fixed or refused. Then `lower.ts` (~2000 lines) split move-only into
      one file per concern and `interp/values.ts` out of the machine, gated by an export pin and a byte-identical
      `lower-completeness`.
(The pre-plan rows that stood here — `Place.path`, calls on FB instances, METHOD/ACTION bodies, GVLs, FUNCTION calls,
ADR/SIZEOF — are steps 2–6b above. `UPPER_BOUND`/`LOWER_BOUND` move to the corpus work list below.)

## Phase 3½ — the corpus work list (2026-09-15)

What blocks the corpus after phase 3 (POUs with a body, one symbol table per project; 24 of 304 lower), each row
taken apart by construct before anything is built — record first, then build, then green in both backends.

**The census** (a scratch pass over every refusal, grouped by construct):
- `place-shape` 146 — **129 are `SUPER^`** (a derived FB's body or method); the rest member access through a library
  type and indexing a non-array. With `call-extends` 33, inheritance is the largest single construct in the corpus.
- `place-not-local` 121 — a name with no slot: 59 a `var` of another scope, **39 a `GVL.var` qualifier**, 23 names that
  do not resolve (Lenze libraries not materialized), 16 a PROPERTY.
- `init-not-constant` 142 · `enum-value` 73 — mostly declarations reaching LIBRARY constants and enums: pro2193's
  `enumErrorSeverity` is `TO_USINT(L_IE1P.L_IE1P_SeverityLevel.…)`, whose values the corpus does not carry. Correctly
  refused until the library tier exists.
- `call-this` 63 — **37 a bare `M()`** on the FB's own method or action.

- [x] **Inheritance** (EXTENDS, `SUPER^`). DONE 2026-09-15 — conformance cases lowering 349 → 362 of 394, every one
      equal to CODESYS in both backends. Recorded first (`fixtures/inheritance.ts`, 2026-09-15): calling a derived FB
      runs ONLY its own body — the base body does not run, not even under an empty derived body; the base's inputs and
      outputs are the instance's fields. `SUPER^()` runs the base body on the same instance. A base body run that way
      reaches the DERIVED override, through `THIS^.M()` and a bare `M()` alike; from a derived body `SUPER^.M()` runs
      the base's method and a bare `M()` the override. `SUPER^(in := x, io := y)` is a call: it assigns the instance's
      input (it stays assigned) and binds the in-out, then runs the base body. Dispatch is by the instance's type
      everywhere — a base METHOD reached through `SUPER^.M()`, or inherited and called from outside, calls the
      derived override too. So: one body per FB, a base body is a routine of each derived FB that reaches it, and every
      method call resolves against the instance's own (most-derived) type.
- [x] **A bare method or action call** inside an FB is a `THIS^` call — measured (`fbcall_bare_method_call`). DONE.
- [x] **A `GVL.var` qualifier** names the global itself — measured (`fbcall_gvl_qualified`). DONE: a `qualified_only`
      list's variables are keyed by the list, so two lists may each hold a `gX`. The replay gave every GVL the file name
      `source` (all fixtures folded into one text); each GVL fixture is now a file named by its pouName, as the recorder
      loads it as an object of that name.
- [x] **Routine state and call edges** (`fixtures/routine-state.ts`, recorded 2026-09-15). DONE — conformance cases
      lowering 362 → 371 of 399, corpus POUs with a body 34 → 37. A METHOD's VAR_INST is kept per instance from its
      initial value (a field of the instance, named for the method that declares it, so `inst.M()` and `SUPER^.M()`
      share it); its VAR_STAT is one variable for every instance (a global); a PROPERTY getter runs once per read with its
      VAR started over, and a set computes its value into a temp before the setter runs (a getter inside it would
      otherwise be a call in the setter's arguments); `inst(a := , b := 2)` assigns nothing to `a`. SIZEOF of an FB
      whose method has VAR_INST is refused — the field appears when the method lowers, and its place is not measured.
- [ ] **A PROGRAM called from an FB body** (60 corpus POUs) — recorded (`state_program_called_from_fb`: the one
      instance PLC_PRG calls), not built. Rust holds program instances in `Programs`, handed only to the POU's own
      `scan`; an FB body would need them too, and a program body calling on would borrow them twice. The likely shape:
      every body takes `prg`, and a program call moves its instance out and back (`mem::replace`), with a lowering guard
      against re-entering a body still being lowered.
- [x] **An FB lowered on its own is one instance of itself**, called each scan — so THIS^, its bases, SUPER^ and its
      methods exist, as for a called instance; it had been lowered as if it were a PROGRAM. Corpus POUs with a body
      lowering **24 → 34 of 304**. Declaration-only POUs lowering fell 2972 → 1801, and a per-POU diff against the
      previous lowering accounts for every loss: each is a derived FB, whose base's fields were simply MISSING before
      (so its "lowered" was wrong, and its base's refusals now count), or an FB with VAR_IN_OUT (`root-inout` — only a
      caller binds one). No FB without EXTENDS or VAR_IN_OUT stopped lowering.

## Review 2026-09-15 — declarations (design §23)

- [x] No `unsafe` anywhere in the generator or prelude; every rustc build now forbids `unsafe_code`.
- [x] `AT` variables were plain fields without a check. They stay plain storage — the simulator agrees
      (`operand_hw_address_marker`) — but overlapping addresses (byte or word addressing alike), several names on one
      address, `%I*`, an address in a routine, and an FB field's address shared by several instances are refused.
- [x] A root PROGRAM's VAR_IN_OUT lowered as an owned field — refused (`root-inout`).
- [x] Recorded first (`declaration-lifetimes.ts`): an FB body's VAR_STAT is shared by every instance (was a field per
      instance); an FB's and a PROGRAM's VAR_TEMP start over at their initial value on every run (a PROGRAM's was kept
      across scans, an FB's refused). Conformance lowering **444 → 447 of 462**. *Why missed:* no running fixture declared
      any of them — the section fixtures only prove the declarations compile, and VAR_TEMP was only recorded in a METHOD.
- [ ] A routine's VAR_OUTPUT as a local copied back after the call, not a `&mut` reset on entry.
- [x] VAR_IN_OUT CONSTANT as `&`. Recorded (`inout-constant.ts`, CODESYS SP21), in a FUNCTION, a METHOD and an FB
      alike: a variable binds (7 → 6), a STRING literal and a STRING `VAR CONSTANT` bind; an integer literal, an integer
      `VAR CONSTANT` and an expression do not ("VAR_IN_OUT CONSTANT parameter … needs variable as input" — the expression
      in the plain in-out wording); a write inside the callee does not compile. Transpiler today: a variable and a STRING
      constant lower (as `&mut` — values right, borrow too wide); a STRING literal is refused (`place-shape`); a
      METHOD bound to its own field is refused (`call-inout-alias`). The LSP's in-out check treated the section as a
      plain VAR_IN_OUT — false positives on the STRING forms, fixed with the recording.
      Built (design §23): `IrBinding` = the caller's place or a copy. A VAR_IN_OUT CONSTANT holding no FB instance is lent
      `&`; a STRING literal is lent as a copy; a variable the call already holds mutably (the instance a METHOD runs on,
      or `g`) as a copy only when the callee writes nothing but locals and calls nothing; every copy is taken into a `let`
      before the call. One holding an FB instance is lent `&mut`, as recorded later: CODESYS calls the lent instance and
      its METHODs (`inout_const_fb_method_12`, `_call_13`) and takes the in-out's address (`inout_const_adr_11`). Every
      store into it — `:=`, chain, FOR, input of a lent instance, through a pointer or reference — is refused.
      Conformance lowering **449 → 455 of 470**. The batch's review workflow (4 lenses, adversarial verify) confirmed
      12 findings, all folded in: a copy beside a `&mut` of the same variable (E0503 → `let` first); calls on a lent
      instance through `&` (E0596 → recorded, lent `&mut`); ADR refused in unrecorded wording (→ recorded, allowed);
      `(own)` skipping the alias check; missing negative tests. Open: the copy rule refuses callees that write fields or
      outputs that cannot reach the lent variable (coverage only, never a wrong result).
- [ ] A multi-target handle for stored POINTER/REFERENCE (`pointer-targets`).
- [ ] REFERENCE/POINTER inputs of a routine as borrows for the call — and interface inputs (`itf_function_input`).

## The fixture programme — the corpus is the LAST check, not the specification (user, 2026-09-16)

"the fixtures should cover all things that are possible in the test corpus. the test corpus are only as a last check."
So a construct real projects use belongs in a FIXTURE, where it is recorded from the IDE and replayed by the LSP and
both transpiler backends, rather than merely compiled once. Two measurements drive it, and both are scripts:

- **`bun run scripts/corpus-census.ts`** — every construct in the four corpus projects against every construct in the
  fixtures. It read **97** the corpus had and the fixtures lacked; after the `corpus-*` batches it reads what is left,
  which is library FB instances and library functions — not language.
- **the untriggered checks** — of the 85 diagnostic codes the analysis can emit, **56** were never produced by any
  fixture (2026-09-16), so their message had never been compared with the IDE's. `check-coverage-two.ts` took the
  first twelve; **41** are left.

91 fixtures added in eight batches (705 → 796). What they found, each recorded first and fixed:

| found | where |
|---|---|
| the semantic pass HUNG on `A EXTENDS B` / `B EXTENDS A` | LSP — an unguarded chain walk |
| `circular-inheritance` saw only a DIRECT self-cycle | LSP |
| `duplicate-inherited-variable` reported an FB duplicating itself | LSP |
| `ANY_TO_INT` and its family were "Identifier not defined" | LSP — 72 corpus uses |
| `chosen(…)` on a `REFERENCE TO` an FB was "not callable" | LSP |
| the language recorder never pushed a fixture's DEPENDENCIES | the recorder — 27 recordings were fallout |
| the `AT` overlap check refused the ordinary word-addressed pattern | transpiler — measured, it is word-addressed |
| calling through a `REFERENCE TO` an FB, an ARRAY of interfaces, an FB in a STRUCT field, a PROPERTY through `SUPER^` | transpiler |
| `WSTRING`↔`STRING`, `__POUNAME`, `XSIZEOF`, `MOVE`, `pack_mode`, BIT packing, a direct address as a place | transpiler |
| a STRING `VAR_IN_OUT` printed the slot's capacity, so the Rust would not compile | emitter |

Three checks emit a message CODESYS does not (`call-recursion`, `method-referenced-without-parens`,
`var-in-interface`) — each recorded in `KNOWN_DIVERGENCES` with what the IDE says instead. Deleting a check on one
measurement is a decision, not a cleanup.

**Two things every new fixture needs**, both learned the hard way: its POU must be INSTANTIATED in PLC_PRG (CODESYS
compiles only what the entry point reaches — twelve fixtures recorded empty until they were), and a name that is a
standard function or a keyword is not a variable (`add`, `by`, `of`, `r` each cost a recording round; the LSP was right
every time).

## The fixtures — every standard language feature the conformance suite describes (user ask 2026-09-16)

`test/conformance/fixtures/` is the specification: 528 cases, each recorded from CODESYS SP21 and replayed through the
interpreter AND the emitted Rust. **509 lower and every one equals the IDE.** The 19 that do not are, exactly:

| | why it does not lower |
|---|---|
| 8 | **`refused`** — CODESYS does not compile them. They pin the input contract; the transpiler never sees them. |
| 6 | **the run faults in CODESYS** — a null dereference, a division by zero, a METHOD called before its in-out was bound. The recorder has no values to compare. |
| 4 | **deferred, each a decision** — the two `instance_path_*` (the simulator's path holds a `Device.Sim.` segment the project tree does not), `op_math_trig` (COS near π/2, one ULP), `real_to_string_digits` (no digit rule fits, user 2026-09-14). |
| **0** | nothing. `[transpile] 510 of 528 cases lower; what blocks the rest: nothing`. |

Closed 2026-09-16, each recorded first and green in both backends:

- [x] **An in-out bound INSIDE the instance its routine runs on** (`call-inout-alias`, 4 fixtures: an own field lent to
      its own METHOD that also reads it by name 10, one field lent to two in-outs 6, `SUPER^` binding both base in-outs
      to one field 6, a child's field lent through THIS^ while the METHOD writes it by name 11). By reference the in-out
      and the field are ONE storage — which a `&mut` cannot say beside the `&mut` of the instance (E0499), and which the
      copy-written-back gets wrong as soon as the callee reaches the field another way. So the parameter is not a
      reference: it is a PATH from the instance, and the routine is specialized on it (`lower/specialize.ts`), the
      parameter gone. Narrow on purpose — the routine must CALL nothing, the path must be static, and a VAR_IN_OUT
      CONSTANT is excluded (what it reads after the callee writes the field by name is not recorded).
- [x] **An in-out through a POINTER bound where written** (`call-inout-order`, `callshape_inout_pointer_before_call`: 101
      — a later argument repoints `p` and `boundValue` is still `numbers[0]`). The binding-order pass already froze a
      runtime index into a temp at the written position; the pointer's own value is frozen the same way, carrying the
      null check with it.

- [x] **`state_any_int_pointer_increment`** — an `ANY_INT` input's `pValue` taken into a UNION of POINTERs, the caller's
      variable written through the member its `diSize` selects (1 → 6, 2 → 7, 3 → 8, 4 → 9 over four calls with
      SINT/INT/DINT/LINT). Three refusals at once: `any-input` allowed only `.diSize`, `layout-union` only members whose
      bytes are measured, and a pointer records ONE target (design §9 form 1) while the four call sites pass four
      different variables — which read as form 3, the handle enum. It is not: **an ANY input a call names a VARIABLE for
      is a hidden VAR_IN_OUT bound to that variable**, so the routine is lowered once per argument TYPE (the variant in
      its name, `anyArgumentTypes` reading the AST before the routine lowers) and each variant has exactly one target.
      `pValue` is that parameter; the write lands in the caller's own variable at its own width; and the CASE arms the
      size does not select are dead, so their pointee type differing from the target's costs nothing. Beside it: a union
      whose members are ALL pointers is laid out (they are one integer in this model) and its overlay is a plain copy,
      not the byte walk — a member never written would otherwise read 0 and fault on the null guard; and `pointerKey`
      normalises any union member to the union, so the five members are one pointer with one target. An ANY argument
      that is not a variable keeps `pValue` refused, as `diSize` alone still works.

## The plan from here — measured, not ranked by reach (2026-09-16)

**Corpus today: 52 of 304 POUs with a body (17.1%).** The work list above ranked constructs by how many POUs each
one *reaches*, and that number is misleading: almost every blocked POU is blocked by several constructs at once, so
the construct with the biggest reach can unlock nothing. `lower-completeness` now prints `sole` beside `reach` — how
many POUs a construct is the ONLY blocker of — and ranks by it. `init-not-constant` reaches 202 POUs and is the sole
blocker of 3.

**Where the corpus is really blocked.** Of the 252 blocked POUs, **190 are blocked by BOTH** a library construct and a
language one, 53 by language alone, 9 by a library alone. So neither half opens the corpus by itself:

| | |
|---|---|
| **20.1% (61/304)** | the library half alone, today's language |
| **~41% (125/304)** | the language list below alone, today's libraries |
| **100%** | the two together — every blocked POU is in one of the three groups above |

**And the library half is NOT a missing runtime — it is a missing namespace (measured 2026-09-16).** Every one of the
top "does not resolve" names is a library NAMESPACE whose declarations the corpus already carries, materialized under
`Library Manager/`:

| the code writes | the folder | probe |
|---|---|---|
| `L_IE1P.L_IE1P_SeverityLevel.No_Response` | `L_IE1P_ApplicationErrorsTypes/L_IE1P_SEVERITYLEVEL.enum` | `L_IE1P_SeverityLevel` → **found**, `L_IE1P` → NOT FOUND |
| `L_LA.L_AddLog2` | `L_PLCLoggingAccess/L_ADDLOG2.fun` | `L_AddLog2` → **found**, `L_LA` → NOT FOUND |
| `L_IMHP.…` · `CmpApp.…` · `L_MC1P.…` · `PACK_ML.…` · `TICKS.…` · `stu.…` | each its own folder | same shape |

Each folder holds a `<folder>.library` manifest that names it — `LIBRARY L_IE1P_ApplicationErrorsTypes` /
`NAMESPACE L_IE1P_Types` / `RESOLUTION …, 3.32.0.11 (Lenze)`. **Volt never reads those manifests**, so a library's
symbols exist in the table under their own names but under no namespace, and every qualified use falls to
`place-not-local` / `enum-value` / `expr-call`. Reach of the names that fail this way: 134 + 133 (the `enumErrorSeverity`
folds) · 105 `L_LA` · 93 `L_IMHP` · 86 `stu` · 73 `CmpApp` · 25 `PACK_ML` · 21 `L_MC1P` · 9 `TICKS`.

- [x] **Read the `.library` manifests and bind each library's symbols under its NAMESPACE.** DONE 2026-09-16
      (`symbols/library-namespace.ts`): the manifest is parsed whole — LIBRARY (the title other manifests name it by),
      NAMESPACE, DEPENDENCIES — and each library gets a `namespace` scope over the units it materialized, its
      dependencies' included (which is what makes `L_IE1P.L_IE1P_SeverityLevel` resolve: that enum belongs to
      `L_IE1P_ApplicationErrorsTypes`, a dependency of the `L_IE1P` library). The binding is ADDITIVE and shares the
      very same scopes, so every bare name still resolves as before. Threaded through `WorkspaceRefs.libraryManifests`
      → `buildSymbolTable(files, manifests)` → the server's store, the corpus harnesses and `lowerSource`.
      The namespace symbol DECLARES the manifest file, so `isLibrarySymbol` is true for it and every check that already
      skips a library type skips the namespace — a library's member set is incomplete by construction. Without that the
      member check fired 9 false positives the moment `L_OEEA_Lib` began resolving; the corpus gate caught it.
      Then the values: `enumConstant` resolves a `Ns.Enum.Value` base, and an enum value's written initializer folds a
      `TO_*` conversion at the target's width — pro2193's `enumErrorSeverity` is `TO_USINT(L_IE1P.…)` throughout.
      **`enum-value` 134 → 0 reach**; `layout-union` 61 → 20 (the union-of-pointers work); POUs 52 → 53.
**Measured again after it landed (2026-09-16).** Of 251 blocked POUs, 9 are blocked ONLY by a library, 161 are mixed,
81 have no library blocker at all — so the ceiling with no library BODIES is still 44.1% (134/304), and the ordered
language list below reaches ~40% of it. The namespace was never the ceiling; it was the thing standing between the
language work and the POUs it applies to, and the refusals it left say what they are: `L_LA is a namespace, which has
no frame slot yet` is a call into a library with no body, not an unresolved name.

- [ ] **Then** what is left of the library half: a call into a library FUNCTION or FB, whose BODY really is absent
      (`L_MC1P_ModuloCycle`, `StrConcatA`, `SysTimeRtcGet`) — design §8's stub mechanism, so a POU that calls one is
      still testable. `plc-library-runtime` covers Standard/Standard64 only and names none of these vendor libraries.
      Parked as the user asked (2026-09-16), and it is the next proposal after this change, not a phase of it.


**The order, each step `+N` POUs and the running total** (greedy over the library-free set; record first, build, green
in both backends, as every row above):

- [x] `root-inout` +10 → 52 — an FB's or PROGRAM's in-out is the harness's variable (2026-09-16). `ARRAY[*]` still refused.
- [ ] `place-not-local` +4 → 56 — the library-free half: a `var` of another scope with no frame slot (`Unit`, `AxisRef`).
- [ ] `init-not-constant` +3 → 59 — the library-free half: an initializer that folds but is not reached.
- [ ] `graphical-body` +6 → 65 — an FBD/LD body reaching the backend through **network text**, not through `lowerUnit`.
- [ ] `place-shape` +4 → 69 — member access on a base with no layout, an index on a non-array, a literal as a place.
- [ ] `pointer-order` +5 → 74.
- [ ] `call-body` +5 → 79.
- [ ] `aggregate-init` +3 → 82 — an initializer naming an INHERITED field (`instanceNo` of a base FB) is the top shape.
- [ ] `enum-value` +17 → 99 — **the biggest single step**: the library-free half, an enum value that does not fold.
- [ ] `call-param` +4 → 103.
- [ ] `interface-type` +3 → 106.
- [ ] `expr-member` +4 → 110.
- [ ] `stmt-try` +3 → 113 — `__TRY`/`__CATCH`; Rust has no exceptions, so decide a strategy or refuse explicitly.
- [ ] `layout-union` +4 → 117.
- [ ] `conversion-type` +2 → 119 · `fb-init-argument` +2 → 121 · `expr-call` +2 → 123 (the built-ins `ADR`, `LTIME`,
      `TEST_AND_SET`, `DELETE` reaching the generic call path) · `call-inout-alias` +1 → 124 · `stmt-call_stmt` +1 → 125.

**Not on this list, and why.** The blockers with the largest reach — `init-not-constant` 202, `enum-value` 134,
`call-body` 118, `expr-member` 93, `place-shape` 81, `pointer-value` 77, `expr-call` 75, `interface-*` 62–73,
`layout-union` 61 — are mostly the same library-bound POUs seen from different angles, and most of that is the one
namespace item above. Re-measure this list after it lands: the greedy order is derived from the refusals, so it
changes when they do.

## Phase 4 — aliasing

- [ ] `VAR_IN_OUT`, `POINTER TO`, `REFERENCE TO`, `expr-deref` — on the phase-3 model.
  - [x] An FB field pointing into the body's own VAR_IN_OUT (`mem_adr_of_inout_member`): exact where the body stored it
        unconditionally earlier in the same run — the in-out is the variable bound for this call. A dereference anywhere
        else (a method, the caller, before the store, after a store inside IF/CASE/a loop) would follow the next binding
        where CODESYS follows the stale address — unmeasured, so refused (`pointer-outlives`).
- [ ] `__ISVALIDREF` and the pointer built-ins, which only mean something here.

## Phase 5 — the remaining language

- [ ] Interfaces, `EXTENDS`, `__QUERYINTERFACE` — dynamic dispatch.
  - [x] Recorded first (`interface-calls.ts`, 5 cases), then built (design §22): interface variables hold the held
        instance's tag; METHOD calls and PROPERTY get/set dispatch on it, arms finished after the whole POU lowers;
        copies to a base interface; `found := __QUERYINTERFACE(from, into)`, null on failure (measured). Conformance
        lowering **440 → 444 of 459**. *Why missed:* no fixture ever read a value through an interface — the five in
        `interface.ts` only pin declarations that compile, so they had "nothing to read", and the one lowering test
        pinned `slot-interface` as the expected refusal.
  - [x] Interface inputs (design §24). Recorded first (`interface-calls.ts` cases 6–9): an FB keeps an interface input
        across calls — null before any is given, the last instance after — and a METHOD's input can be passed on. Built:
        an FB's input field is a tag keyed `FB:<type>.<field>`, a routine's input a tag argument; a body that dispatches
        on an instance of another frame is lent a `&mut` of it per call, filled through every caller once the POU has
        lowered. Conformance lowering **455 → 460 of 474**; every conformance fixture that should lower now does.
        Reviewed between batches (4 lenses, adversarial verify): 6 confirmed. Two wrong results — a tag naming a field
        of one FB instance reached another instance of the same type (`x2(shape := x1.mine)`; a METHOD of an in-out) and
        answered for the wrong one — now refused: interfaces are read only through the frame's own variables, a write
        reached through another instance is foreign, and an FB-frame tag may not arrive foreign or be lent to a call on
        another instance. `THIS^` lent printed `&mut self` (E0596) → `&mut *self`. Open: one FB type given interface
        inputs from two frames is refused (`interface-context`) — its lends are per type, not per instance.
- [x] Call shapes the corpus refused (design §25). Recorded first (`call-shapes.ts`, CODESYS SP21): arguments run in
      the order written (a reversed call runs 3 then 4; property reads too); an input left out of a METHOD or FUNCTION
      call starts at its declared initial value on every call (54, 51) and one with no initial value does not compile; a
      METHOD of a PROGRAM runs on the program's one instance (14, the caller sees 24); an FB's VAR_IN_OUT reached from
      its METHOD is the binding of the body's current call (21), and from outside after a call the LAST binding (11,
      110 — not modelled, refused `call-fb-inout`); a FOR step that is a variable runs up (3 visits, index 7) and down
      (3 visits, index −1). Built: `IrInvoke.order`, the interpreter evaluating inputs in it and the emitter taking every
      input into a `let` in it when one holds a call (the `call-nested` refusal lifted for inputs); omitted inputs from
      `slot.init`; the program moved out of `Programs` around its METHOD; the FB's in-outs appended to its METHODs as
      `ofInstance` in-outs, bound from `THIS`; a runtime step evaluated once into a temp with a two-armed test. Found on
      the way in the corpus (compile-evident, no recording): an array bound naming the POU's own `VAR CONSTANT`
      (`resolveTypeExpr` folds in the declaring scope), and a GVL variable named like its own list (lenze-mid
      `Mach1_Alarms`). Conformance lowering **460 → 467 of 486**. *Why missed:* two lowering tests pinned the refusals
      as the intended result (`runtime FOR step` refused, a call inside another call's arguments refused) — both
      rewritten from the recordings, not the code.
      Reviewed between batches (4 lenses, adversarial verify): 5 defects confirmed and fixed — a PROGRAM METHOD's
      arguments read after the move-out, `THIS^.child.M()` given the parent's in-out, foreign declarations folded in the
      caller's scope, every METHOD taking every FB in-out (order-dependent refusals), `0u16 <= step`. Two unevidenced
      claims were recorded (`callshape_for_bounds_changed_in_body`, `callshape_inout_binding_order`): **a FOR reads its
      limit and step on every pass** — the once-evaluated limit temp, there since phase 1, was wrong, and two older tests
      pinned it (rewritten from the recording) — and an in-out is bound where written (a movable binding before a call is
      refused, `call-inout-order`).
- [x] `ARRAY[*]` VAR_IN_OUT with LOWER_BOUND/UPPER_BOUND (design §26) — the largest shape behind pro2193's `place-shape`.
      Recorded first (`callshape_array_star_*`, `callshape_bounds_of_sized_array`): the bounds are the bound array's, per
      dimension, passed on unchanged (9804), per call on an FB (2 then 4), DINT (wraps at 70002 * 40000), folded on a
      sized array. Built: a slice in Rust (`&mut [i16]`, an inner open dimension a const generic), the lower bound beside
      it as hidden DINT inputs of a routine or hidden fields of an FB, an open index offset by it at lowering. Conformance
      lowering **467 → 473 of 490**; corpus `expr-call` 105 → 75, `place-shape` 91 → 81 POUs. *Why missed:* no fixture
      declared an `ARRAY[*]`. Reviewed between batches (4 lenses, adversarial verify): 6 confirmed, all refusals of
      uses no recording covers that slipped through once the slice was representable — a whole-array read or store
      (uncompilable Rust, a swapped caller array), ADR of an element (store dropped silently), a union behind an open
      index (no copy), `SUPER^` rebinding (stale bounds), a METHOD reading the bounds, an untested `call-open-array`.
      An `ARRAY[*]` takes the size of the array connected to it — it only looks dynamic — so whether it chains was
      recorded too (`callshape_array_star_fb_chain`): an FB hands its `ARRAY[*]` in-out on to a nested FB's, and the inner
      FB sees the caller's bounds (306) and writes the caller's array; the hidden-field model already gave both.
      Open: `callshape_array_star_of_struct` stays refused (`call-inout-alias`) — an FB lending its
      own field to its own METHOD is two `&mut` of one instance, independent of open arrays.
- [x] An FB instance inside a PROGRAM, reached from outside it (pro2193's `SER.EnableFreqInvertersRelay.Map()`,
      `Attach`/`Detach`; `call-program-method` no longer ranks, though every corpus POU it stopped still stops at another
      refusal — the corpus lowered count is unchanged). Recorded (`callshape_program_instance_from_outside`):
      a METHOD and a body call from PLC_PRG and from an FB run on the program's own instance (303, 403 over two cycles).
      Built: the program is moved out of `Programs` for the call, as for its own METHOD, and the call runs on the path
      into it. Refused: a runtime index on that path (read on the stand-in), a body or METHOD reaching the program.
      Also found on the way, library-bound and parked: `init-not-constant` (199) is Library Manager types initialized
      from library enums and `ADR`s; `call-param` on `SetErrorFB.severity` is its library-bound enum default; `enum-value`
      (132) is `enumErrorSeverity`'s values taken from `L_IE1P`. Project constants named through their GVL or PROGRAM
      (`GVL_Constants.N`, `XiUnits.MaxVacuums`) now fold in the shared `constEval` — compile-evident name resolution.
      Reviewed between batches (3 lenses, adversarial verify): 7 confirmed, all fixed with a test — a constant cycle hung
      `constEval` (the editor's diagnostics too; the bare cycle already did), a REAL constant folded as an integer
      (`RC / 4` = 2), a `qualified_only` list's bare sibling resolved to another list's constant, a PROPERTY on an instance
      inside a program ran on the stand-in (now refused, unrecorded), a body reaching the program through an interface
      call escaped the re-entrancy check (refused), two refusals untested, and a corpus figure in this entry was wrong.
- [x] `__QUERYINTERFACE` as an IF's or ELSIF's whole condition, or under NOT — pro2193's form (~30 uses), which only lowered as
      `found := __QUERYINTERFACE(from, into)`. It is that recorded query into a hidden BOOL, taken just before the test; an
      ELSIF's inside the ELSE its IF lowers to, so only when reached. Anywhere else — under AND_THEN / OR_ELSE, inside another
      expression — it is refused (`interface-query`), where the timing of its store is not modelled. Then extended to the
      condition's LEADING operand (under NOT, the left side of AND_THEN / OR_ELSE, which always runs first — pro2193's
      `IF NOT __QUERYINTERFACE(xuUnit, xuUnitExtended) OR_ELSE NOT xuUnitExtended.InSafePosForMouldEntry THEN`).
- [x] An FB's own field lent to its own METHOD (`call-inout-alias`; the recorded `callshape_array_star_of_struct`
      `Shift(line := points)` and `callshape_positional_arguments` `Mixed(counter, 3)`) — two `&mut` of one instance.
      Built: the field is copied in, lent `&mut`, and written back after the call (`IrCopy.back`) — in exactly one shape:
      the call is on THIS itself and nothing else it binds is that field; the field is the FB's own, reached by fields
      and constant indices, of the parameter's type, not an output; and the callee touches only its own locals, inputs
      and in-outs and calls nothing. The first cut allowed any callee that did not NAME the field; its review found eight
      ways a stale copy was still seen (another in-out of the call, a THIS^ sub-instance, an interface, a FUNCTION given
      THIS^, an output, a derived type) — each a wrong value — so the rule is now the one that is exact by construction.
      Also recorded while looking for silently ignored semantics (`implicit-checks.ts`): a FUNCTION named `CheckBounds`
      or `CheckDivDInt` loaded as a plain POU is not called by CODESYS (0 calls; an out-of-range write lands in the next
      variable, `10 MOD 0` is 0, DINT and REAL division by zero stop the run) — an implicit check must be CODESYS's own
      object kind, which the fixture loader cannot create. Whether the bridge keeps that kind for bakon-nano's and
      pro2193's check POUs is open. Without one, an out-of-range index stops the run in both backends (the interpreter
      throws, Rust's indexing panics — never `unsafe`, which the crate forbids): a deliberate difference from CODESYS's
      silent write into the next variable. The narrowed rule's review found SUPER^ and the FB body call building their
      held list from bound places alone — `SUPER^(a := n, b := n)` copied n twice (101 where by reference it is 6) — now
      one `holding` for all three calls; and an FB `call` whose in-outs go unread under SUPER^ failed `-D warnings`.
      Recorded for the next item: `fbcall_program_own_members` — a PROGRAM calling its own METHODs and ACTION bare runs
      them on its one instance (calls 4, deep 40, tidied 200, doubled 8). It lowers when called; lowered as the root it
      is still `call-this`.
- [x] A root PROGRAM calling its own METHOD or ACTION bare (`call-this`, ~25 corpus POUs: `Initialize()`, `Alarms()`,
      `act_Assign_Errors_01_09()`; recorded `fbcall_program_own_members`). Built: a PROGRAM that has METHODs or ACTIONs
      lowers as its one instance, as a root FB already did (`rootInstance`), so a bare call resolves on THIS; a PROGRAM
      without members keeps its variables as the POU's own slots. The corpus has no `call-this` left; none of those POUs
      lowers yet, as each has other blockers. Its review found what the slot form had and the instance form lost: an
      instance-path took the program's name twice (`Device.Application.P.P.outer.inner`), and an FB_Init argument naming
      the program's own VAR (recorded: 4) was refused — both kept now. A PROGRAM's own FB_Init or init-slot METHOD, which
      the slot form never ran and the instance form would, is refused (`fb-init-program`) until recorded; so is nothing
      else — THIS^ in such a PROGRAM now lowers, and whether CODESYS compiles it is unrecorded.
- [x] An in-out written before a call that moves its index (`call-inout-order`; recorded `callshape_inout_binding_order`:
      101 — CODESYS binds an in-out where it is written). Built: `IrInvoke.order` also holds an `IrFreeze` — each runtime
      index of such an in-out taken into a temp at its written position, the binding indexing by that temp; the
      interpreter's order loop and the emitter's argument lets both take it there. A pointer's target or a copied value
      written before such a call stays refused, as does the FB body call's form — and so does a VAR_OUTPUT `=>` target
      with a runtime index: its review found dropping the old check had let one through, its index read after the call,
      where CODESYS reads it is not recorded. The earlier refusal test was a
      representability premise and now asserts the recorded 101. Conformance: 491 of 508 lower; `call-fb-inout` is the
      last blocker.
- [x] An FB's VAR_IN_OUT reached by its METHOD called from OUTSIDE the FB's run (`call-fb-inout`; ~14 corpus sites,
      pro2193's `Conveyor.Reset()` / `BufferAir.Set()` from the holder's other METHODs). Recorded: the METHOD uses the
      instance's LAST binding (`callshape_inout_in_method_after_call`: 11 then 110), kept into later cycles
      (`callshape_inout_method_in_later_cycle`: 21 after three), and a METHOD run before any call bound it stops the
      application (`callshape_inout_method_before_binding`: timeout); CODESYS builds each with the warning "Access to
      VAR_IN_OUT … from external context". A model that fits all three: a hidden binding tag per instance, stored by
      every body call (one tag per static place bound), and the outside METHOD call a dispatch on that tag whose arms
      lend each place — tag 0 faulting, as the recording stops. The binding sites can lower after the METHOD call, so
      the arms fill once the POU has lowered, as an interface call's do (`finishInterfaces`). Built (user decision
      2026-09-15, `lower/bindings.ts`): every call of an FB with in-outs registers its instance and binding; a METHOD or
      ACTION called from outside is a dispatch on the hidden `__inout_binding` field, one arm per binding a call made on
      that instance, each call storing its tag (`IrCall.bind`) before the body. Exact only where the instance is named one
      way — every call of the FB on a static place of its frame or the globals, not through another instance — and bound
      to places that frame can lend again; anything else stays `call-fb-inout`. The two recorded cases that run now
      lower and match (11/110, 21); the one before any binding faults, as CODESYS stops. Its review found two wrong
      values and two unrecorded acceptances, each now refused with a src test: the tag was read before an input that
      calls (which could bind the instance first); a PROGRAM's one instance bound from an FB of which there are several
      instances lent the running one's field — a PROGRAM's binding is taken only from the root's own frame; a SUPER^
      binding the in-out to another place, and an instance copied whole, leave a binding no recording shows. The corpus's
      ~14 sites are a different shape, recorded since (`callshape_inout_base_method_from_derived_method`: 11,
      `callshape_inout_base_method_from_outside_derived`: 21, `callshape_inout_super_method_from_override`: 11): a
      DERIVED FB's METHOD reaching the BASE's in-out through a base METHOD — refused, as a METHOD takes only its own
      FB's declared in-outs, not its bases'. Built since: a METHOD takes the in-outs of its owner's whole EXTENDS chain,
      and the three lower and match (502 of 526). pro2193's sites stay refused: they are yet another shape — the BASE's
      body, run through the derived body's SUPER^(), calls a METHOD the derived FB overrides, which writes the DERIVED
      FB's own in-out; the SUPER^ body takes only its base chain's in-outs. Recorded next
      (`callshape_inout_override_from_base_body`: 11, `callshape_inout_override_from_outside_base_method`: 21) and built:
      a METHOD takes the in-outs of its FRAME's chain — the instance's type, not the METHOD's owner — and the SUPER^ body
      also takes the derived frame's own, which `lowerSuperCall` passes on as themselves. Both lower and match (504 of
      528), and the corpus has no `call-fb-inout` left; its POUs stay behind other blockers (43 of 304 lower).
- [x] Conformance fixtures for every shape this phase met only in the test corpus or a src test (user request
      2026-09-15: "so we dont rely on the testcorpus") — each recorded in CODESYS SP21, build and run, and replayed by
      the LSP and both transpiler backends. The LSP's error/warning set matches CODESYS exactly on all but
      `fbcall_this_in_program`, where it has the refusing error but not CODESYS's four follow-on errors. Recorded:
      an own field lent to its own METHOD that also reads it by name, 10 (by reference); one field lent to two in-outs,
      6; SUPER^ binding both base in-outs to one field, 6, and to two, 5 and 201; a child's field lent through THIS^
      while the METHOD writes it by name, 11; a VAR_OUTPUT target's index read AFTER the inputs, 7 into numbers[1];
      a nested index taken where written, 401; an in-out through a pointer bound where written, 101; a PROGRAM's own
      FB_Init leaving its variables as they were, 1, and its init-slot METHOD running, 101; an FB_Init argument from the
      VAR of a PROGRAM with a METHOD, 4; an instance-path through such a PROGRAM, its name once; THIS^ in a PROGRAM
      refused; an ANY_INT's caller variable written through a union of pointers (6, 7, 8, 9). They overturned three
      refusals and one acceptance, each rewritten with its recording: a FUNCTION's VAR_OUTPUT with a runtime index now
      lowers; a PROGRAM's own FB_Init is not called (refused if it calls or writes a global); a PROGRAM the root calls
      is visited by the init step (it was `attr-init-unreached`: FB_Init arguments, instance-path, init-slot METHODs);
      THIS^ in a PROGRAM is refused (`this-in-program`). `refused.test.ts` analysed a refused fixture without its own
      source. Still refused, exactly: the four by-reference aliases (`call-inout-alias`), the pointer in-out
      (`call-inout-order`), the ANY_INT union of pointers (`layout-union`). Conformance: 497 of 523 lower. The review
      of these fixes found four holes, each now closed with a src test: a PROGRAM first reached by another program's
      init-slot METHOD was never visited (0 where FB_Init gives 5) — the globals are walked by index; an init-step call
      on an instance inside a called PROGRAM that reads that program ran moved out, Rust reading the `::new()` stand-in —
      refused `call-program-reentrant`, as a body's call is (`programReentrant`); a structured initializer beside FB_Init
      arguments was re-applied only on the first instance of its layout (the second started from 0, not 9) — each
      instance now sees the declared initializers; and the VAR_OUTPUT rule let an in-out on the index variable beside it
      print E0503 — it now holds only for a FUNCTION that binds nothing else and touches only its own locals.
- [x] FB_Init — silently ignored until now: an ordinary METHOD nothing called, and the parser dropped a declaration's
      `inst : FB(x := 1)` arguments, so every instance started as if it had none, with no diagnostic. Recorded first
      (`lifecycle.ts` `fb_init_runs_with_declared_arguments`, `fb_init_base_and_derived`, `fb_init_argument_left_out`):
      FB_Init runs once per instance before the first cycle, after the fields' own initial values (35, not 5), with
      bInitRetains TRUE and bInCopyCode FALSE at a cold start and the declared arguments; the base FB's FB_Init runs
      first with the same arguments (order 12); an instance declared without a required argument does not compile, nor
      does the argument written as an initializer (`:= (startValue := 5)` — "Check syntax 'five : FB(INT)'"). Built: the
      parser keeps the arguments (`NamedType.initArgs`), and the init step runs each FB_Init of the chain, base first,
      on every instance it reaches. Refused, unrecorded: a non-constant or positional argument, an FB_Init instance nested
      inside another (their order), and instances in arrays, globals or locals (as for the init attribute). Found on the
      way, an LSP data loss: the formatter printed a declared type without its FB_Init arguments (`renderTypeExpr`), so
      formatting deleted them from the user's file — invisible to the round-trip gate while the AST held nothing to
      compare; keeping the arguments made the gate fail on 29 pro2193 files, fixed with a test. The corpus lowered count
      went 45 → 43 POUs with a body (2804 → 2651 declaration-only): Lenze library FBs whose FB_Init takes interfaces or
      nests other FB_Init instances, which lowered silently wrong before and are refused now. Reviewed between batches: 3
      confirmed, all orders the batch chose without a recording — recorded then (`fb_init_and_structured_initializer`,
      `fb_init_before_slot_method_nested`, `fb_init_before_slot_method_sibling`): every FB_Init runs before any
      call_after_global_init_slot method, a holder's and an earlier sibling's alike (5, 7), and a structured initializer on
      an instance running FB_Init applies AFTER it (FB_Init saw 0, the 9 stayed) — the batch had them interleaved per
      instance with the initializer first. Built as recorded: the FB_Init calls, then those initializers, then the slots.
      The sibling recording then exposed a harness-path bug: `lowerSource` read `{attribute …}`s from the main source only,
      so an FB's init-slot METHOD in a GVL or library file never ran (0 where CODESYS gives 7) — every file's are read now.
      Conformance lowering 477 → 482 of 500.
      Then the two refusals left recorded (`fb_init_nested_in_fb_init`, `fb_init_argument_from_variable`,
      `fb_init_argument_from_global`): an instance's FB_Init runs after those of the instances inside it (the outer's saw
      the inner's 5), and an argument naming a variable gives its value, the initial one (4, 6). Built: FB_Init calls in
      that order, a variable argument as a load where the POU itself declares the instance. Still refused: a variable
      argument in a declaration inside an FB (it names that FB's field), an interface argument, a positional one.
      Reviewed between batches: 4 confirmed, each fixed with a test — a variable argument in a STRUCT field's declaration
      was read in the POU's scope; later, VAR_TEMP and instance-field variables and a global an FB_Init writes were
      accepted unrecorded; dropping the order refusal also fixed an unrecorded order for a derived FB holding FB_Init
      instances (refused again); a global only `init` reads left `g` unused in Rust's `scan` (-D warnings). A variable
      argument is now exactly what was recorded: an elementary VAR/VAR_INPUT declared before the instance, or a global no
      FB_Init of the init step writes.
- [x] Positional arguments across sections (`call-positional`, 62 corpus POUs). Recorded (`callshape_positional_arguments`):
      they bind in declaration order across VAR_INPUT and VAR_IN_OUT, interleaved too (100, 315, 46). Built: each routine
      keeps its parameters' declaration order; a positional argument is named by the one at its position. They were refused
      whenever the routine had an in-out (`Arrays.Bool_All(result, TRUE)`), and a METHOD calling its FB's own METHODs takes
      the FB's in-outs, so even `ManualControl(a, b)` was. Still refused: a position counted across a VAR_OUTPUT (not
      recorded), and positional FB body calls. The recorded case itself binds the FB's own field to its own METHOD, which
      stays refused on other grounds (`call-inout-alias`, two `&mut` of one instance) — its values are checked in
      `lower.test.ts` with the METHODs on a child instance. Also fixed, found by the batch before's review: a call through an interface
      nothing is ever stored into printed a `!`-typed match rustc refused (E0605) — its panic arm is typed now.
- [x] A PROPERTY of an FB instance inside a PROGRAM, read from outside it (pro2193's `HardwareButtons.F1.ObserverCount`;
      `call-program-property` 64 corpus POUs, a refusal the batch before added). Recorded (`callshape_program_instance_property`):
      the getter runs on the program's instance (33, 34) — and a WRITE from outside does not compile ("'gauge' is no
      input of 'PRG_CS_station21'"), recorded while making the case. The read lowers under a METHOD's checks there; a write
      from outside stays refused.
- [x] A call in a FOR limit (`for-bound-call`, 25 corpus POUs — property reads like `fbModuleManager.baseModulesCount`).
      Recorded (`callshape_for_limit_call`): a PROPERTY getter and a METHOD in the limit each run 4 times for 3 passes —
      once per test, as the limit is read. Lowered as such; a call in the step, or in a limit a runtime step tests on two
      arms, stays refused (unrecorded).
- [ ] `__POUNAME` 304 and the other CODESYS compiler operators.
- [x] `aggregate-init` — recorded first (`array_initializers`, `init_struct_by_field`, `init_array_of_structs`,
      `init_fb_instance_inputs`), then lowered to a structured initial value (`IrInit`: elements / named fields) that the
      interpreter and `initOf` both build. Measured: a short array list leaves the rest at the element's own initial
      value; `n(v)` repeats; a multi-dimensional array fills row by row; a struct or FB instance sets only the fields it
      names, every other field keeping its TYPE's initial value (nested and array-of-struct elements too); `STRUCT(…)`
      is `(…)`. A field the type lacks, or a positional element in struct form, is refused. Conformance lowering
      **434 → 438 of 454**. *Why missed:* two parser gaps hid behind the refusal — a one-field `(y := 7)` parsed as a
      parenthesized inline assignment, and a top-level `STRUCT(…)` as a call — so neither was ever an aggregate;
      every aggregate parser test used two fields or more, and one documented the call as intended.
- [ ] `expr-assign_expr` (1).
- [x] UNION (`type_dut_union`, measured little-endian overlay) — laid out as a struct of its members; a plain `:=` into
      one member is followed by copying its bytes into every other (design §21). Only unsigned integers and bit strings,
      and one-dimensional arrays of them, without initial values; SIZEOF, an aggregate initializer, and every other write
      path (in-out/output binding, latch, chain, FOR variable, ADR) are refused. Conformance lowering **439 → 440 of
      454** — every fixture that should lower now does. *Why missed:* `buildLayout` had no union branch at all, and its
      refusal was the generic `layout-struct`, so no count ever named UNION.
- [ ] `stmt-try` (6, 2%) — `__TRY`/`__CATCH`. The interpreter can run it; Rust has no exceptions, so the
      emitter needs a strategy or an explicit refusal. Decide rather than default.
- [ ] `type-unknown` (18, 6%) — triage; each is a type the frontend could not resolve.

## Phase 6 — the standard library

- [ ] Create the Rust runtime crate. **Not before something needs it** (design §6); location undecided.
- [ ] `TON`/`TOF`/`TP` — the three that cannot be written in ST at all, since they read a clock the language
      does not expose. Simulated time, injected per scan; never a wall clock.
- [ ] `CTU`/`CTD`/`CTUD`/`R_TRIG`/`F_TRIG`/`RS`/`SR`.
- [ ] **Parameter names come from the bridge's library-signature extraction, not from memory** (design §6).
- [ ] Stub mechanism for third-party library FBs, so a POU that calls one is still testable (design §8).

## Beyond this change — ST under a standard test framework

The goal all of this serves: an engineer or an agent tests ST with an **ordinary test framework** — `cargo test`
over the emitted Rust, `bun test` over `interp/` — rather than a PLC-specific tool. The oracle is what makes a
green run mean the PLC would agree. When that becomes user-facing (`volt test`), it gets its own proposal — and
it needs one before phase 6, because the test API (inputs, cycles, simulated time, stubs) shapes the runtime crate.
Running tests in the vendor's simulator through the bridge was considered and is NOT the default: it switches the
engineer's device to simulation and downloads over their application, and TwinCAT has no equivalent. (If it is
ever wanted, SP21's Core `IOnlineApplication` has a real `SingleCycle()` that the scripting surface does not.)

## Non-goals

- Running a real project end to end. Third-party libraries ship compiled; see design §8.
- Replacing the IDE compiler. The IDE stays authoritative for type-checking and codegen.
- Shipping the emitted Rust as a product. It is a test target until a decision says otherwise.
