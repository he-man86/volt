Rehomed from `build-st-language-server` (task X.1). The architecture is in place; coverage is the work.

**Two progress measures, for two kinds of work.**
- **Primitives (phase 2)** — measured by the oracle: every type/operator row below is done when its cases in
  `test/exec` are recorded from CODESYS and green in BOTH `interp/` and the emitted Rust.
- **Structure (phase 3+)** — measured by `bun run scripts/lower-completeness.ts` over the 4-project corpus
  (304 POUs with a body). Primitives barely move that number, by design: calls to FB instances (84%) and member
  access (31%) block nearly every real POU, and both wait on design §9. Primitives go first anyway (decided
  2026-09-14): they are fully testable today, need no design decision, and are what an ST unit test exercises most.

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
      - **REAL_TO_STRING / LREAL_TO_STRING — stays REFUSED (user decision 2026-09-14)**: no one digit rule fits the
        samples (§18). The recorded case `real_to_string_digits` is `deferred`, not red;
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
- [ ] VAR_IN_OUT CONSTANT as `&`.
- [ ] A multi-target handle for stored POINTER/REFERENCE (`pointer-targets`).
- [ ] REFERENCE/POINTER inputs of a routine as borrows for the call — and interface inputs (`itf_function_input`).

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
  - [ ] An interface passed as an input (`itf_function_input`, recorded: 17) — refused `interface-input`; the routine
        needs the caller's instance, a `&mut` per concrete FB type.
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
