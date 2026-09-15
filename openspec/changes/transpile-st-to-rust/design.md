# Design — decisions

Decisions taken 2026-09-03/04 while building the skeleton. Each records the evidence, because several were
taken *against* a plausible alternative and the reason is not recoverable from the code.

## 1. Nothing lowers to a Rust reference

**Decision.** A POU is a flat frame of slots. A name is a slot index. Pointers, `REFERENCE TO` and
`VAR_IN_OUT` will become indices into that same frame. Nothing in the IR ever becomes a Rust `&`/`&mut`.

**Why.** ST has no ownership. It has one static memory image: instances are fixed allocations, `VAR_IN_OUT`
*is* a pointer, `POINTER TO`/`REFERENCE TO` are real aliases, GVLs are global mutable state. Mapping any of
that onto Rust references loses to the borrow checker the moment two aliases are live — not at some exotic
edge, but at the ordinary case of an FB holding a pointer to another FB while a method mutates both.

**Evidence it is necessary.** `ADR` is the most-called name in the corpus (333 sites), ahead of `MAX` (309)
and `SEL` (209), with `SIZEOF` (56) and `__ISVALIDREF` (48) behind it. Aliasing is not a tail case in PLC
code; it is the mainstream.

**Evidence it works.** The emitted crate compiles under `rustc --emit=metadata -D warnings`, which runs
borrowck. `&mut self` is the only borrow in the output. Verified by a test that is skipped where rustc is
absent, so `bun test` stays toolchain-free.

**Cost accepted.** Index arithmetic instead of zero-cost references, and bounds checks (elidable later, if
measured). Rejected alternative: `unsafe` raw pointers, which matches ST semantics exactly but gives up the
one property that makes generated code auditable.

## 2. The IR carries the semantics; a backend carries none

**Decision.** Implicit widening is an explicit `convert` node. CASE labels are resolved constant ranges.
FOR/WHILE/REPEAT lower to one `loop` shape. ELSIF is a nested `if`. Every node holds a resolved `Type` from
`types/`. **If a backend ever has to decide something, the lowering is incomplete — that is the bug.**

**Why.** 100% coverage means handling implicit conversion, aliasing, overloads, arrays, strings and every
place ST diverges from the target language. If a backend reads the AST it must re-derive types at every node,
and the rules scatter across string-building code. One IR is one home for semantics, and it is what lets the
interpreter and the emitter share them rather than drift.

**Enforced, not hoped.** `scripts/check-layering.ts`: inside `transpile/`, only `ir/` is importable across
folders. A backend cannot reach into `lower/`, and the backends cannot reach each other.

## 3. Codegen typing is a different question from inference typing

**Decision.** Lowering does not take operator types from `inferExprType`. It computes them from the operand
types over the widening lattice `types/elementary` already owns, and reports `type-unknown` if that fails.

**Why.** `inferExprType` answers the LSP's question — "what can I safely say this is?" — and returns
`UNKNOWN` wherever a guess would be a false positive. `REAL + INT` is one of those. A backend cannot emit
`UNKNOWN`. Both behaviours are right for their consumer; the mistake would be to change inference to suit
codegen and lose the zero-FP property that the diagnostics depend on.

**Not a duplicate.** The *facts* (family · bits · signed · rank) still come from `types/elementary`. Only the
question differs.

## 4. Literals type from context, sibling operand first

**Decision.** An IEC integer literal has no intrinsic type. It takes the sibling operand's type if there is a
typed one, then the assignment target's, then the narrowest type that holds the value.

**Why.** `rate := n / 2` with `n : INT` must divide in INT and convert the *result*. Propagating the
assignment target inward instead makes it 3.5 — a different program, silently. Found by a test, not by
reading.

**The all-constant corner — measured, and the code is wrong.** An all-constant expression (`x : REAL := 7 / 2`)
takes the context's type in `lower.ts`, which makes it 3.5. CODESYS 3.5.21.40 gives **3**, in REAL and LREAL, as
a body assignment and as a declaration initializer (conformance, case `all_constant_division_in_real_context`):
constants divide in the integer type first and the result widens — the same rule as a variable operand. The
special branch is deleted.

**One REAL operand makes it REAL** (conformance `division_with_a_real_operand`): `7 / 2.0`, `7.0 / 2`,
`int7 / 2.0`, `real7 / 2` and `real7 / int2` are all 3.5, in a body or an initializer; only INT / INT is 3. So a
constant adopts its variable neighbour's type only when that does not demote a REAL to an integer — `int7 / 2.0`
used to retype the `2.0` to INT and divide integrally (`adopt` in `lower.ts`).

**Integer promotion — measured, and it overrides "narrowest".** The literal rule above picks the narrowest type
that holds a value, and a store into the same type cannot tell where arithmetic wraps. A store into a wider one
can (conformance `arithmetic_width`, `constant_arithmetic_width`), and CODESYS 3.5.21.40 answers like C:
- an `int`-family operand under 32 bits computes in **signed DINT** — `SINT 127 + 1` is 128, `USINT 0 - 1` is -1;
- DINT is not promoted further — `DINT max + 1` is -2147483648 even stored into a LINT;
- an all-constant integer expression folds at full width — `2000000000 + 2000000000` is 4000000000.

Lowering owns this (`promoted`, applied to arithmetic and — because widening cannot change the answer —
comparisons), so the interpreter's width fit and the emitter's `wrapping_*` follow the IR's types with no rule of
their own. Measured next (2026-09-14, conformance):
- **bit strings promote the same way** — `BYTE 255 + 1` into WORD is 256; `BYTE 0 - 1` and `WORD 0 - 1` into DINT
  are -1 (signed DINT);
- **AND/OR/XOR promote; NOT does not** — `SINT -1 AND 255` into INT is 255, `NOT USINT 255` into DINT is 0;
- **a signed/unsigned comparison meets at the wider rank** — `UDINT max > DINT -1` is FALSE and `=` is TRUE, which
  the existing meet already did; **at the same width the SIGNED type wins, on either side** — `UDINT 0 > DINT -1`,
  `ULINT 0 > LINT -1` and `DWORD 0 > DINT -1` are TRUE and `UDINT 0 + DINT -1` into a LINT is -1
  (`same_width_mixed_sign_order`, `same_width_bitstring_sign`). The meet let the LEFT operand win, and only
  unsigned-left with equal bits had been measured, where the two rules agree;
- **unary minus promotes like arithmetic** — `-SINT(-128)` is 128 (and `sint := -sint` does not compile: "Cannot
  convert type 'INT' to type 'SINT'"), `-INT(-32768)` into DINT is 32768, `-DINT(min)` into LINT is still
  -2147483648. The emitter prints integer negation as `wrapping_neg()`: Rust's `-` panicked on that last one;
- **there is no implicit REAL → INT** — it does not compile, so REAL → INT only ever happens through a built-in;
- **`**` is not CODESYS ST** — it does not parse; EXPT is the only power.
TwinCAT is unmeasured throughout.

## 5. Coverage is counted over POUs *with a body*

**Decision.** `lower-completeness.ts` reports lowered/blocked against the 301 POUs that have statements, and
lists declaration-only POUs and METHOD/ACTION bodies separately.

**Why.** The first version of the script counted all 6,079 units and reported **91.4% lowered** while not one
real POU ran — because 5,778 units are empty-bodied, with their logic in separate METHOD/ACTION units. A
coverage number whose denominator flatters it is worse than none.

## 6. The standard blocks and functions are runtime, not language server

**Decision.** `TON`, `CTU`, `R_TRIG`, and the built-in functions belong in a Rust runtime crate beside the
IEC numeric semantics — written once, ground-truthed against the vendor. Not hardcoded in `volt-lsp-iec`.
The crate is created when something needs it, not as empty scaffolding.

**Why.** They are a library implementation, not language semantics — and the LSP's job for them is only to
know the names exist (`reference.ts` already does that). An earlier attempt implemented nine of them as
native TypeScript inside the LSP; it was removed.

**The failure it prevents.** That attempt's parameter names (`RESET1` for RS, `PT`/`ET` for TON) were written
from memory and checked by nothing. They would have run POUs wrongly while passing their own tests — exactly
the failure the backend's `Unsupported`-everything-unknown rule exists to avoid. Parameter names must come
from the bridge's library-signature extraction.

## 7. The oracle is differential execution, not recall

**Decision.** Before the built-ins are implemented, build a harness that runs a POU in a live headless IDE
and through the interpreter, and compares state.

**Why.** 81 built-ins plus conversion and rounding rules is far past the point where remembered vendor
behaviour is safe. Two vendor facts asserted from memory in one session were wrong (that `LIMIT` is usable as
a variable name; the standard blocks' parameter names). At this scale that is not an occasional slip, it is
the dominant cost — and it produces confidently wrong results, which is worse than gaps.

**It is cheap here — but not through the bridge.** This first said the pipe harness only lacked a state-read
verb. Measured on SP21 (`volt-cli/scripts/probe-online-state.py`): the scripting online API does run a POU in
simulation and read every variable back in ~3s, but its `ScriptOnline` object only works inside a running
script, so a C# pipe op cannot call it. The recorder is therefore a `--runscript` (`scripts/record-exec.py`,
driven by `bun run record:exec`), which is the right shape anyway: recording ground truth is a dev-time act
on a fixture copy, not something a bridge serving an engineer's project should do.

Three facts the recorder is built on, all measured: there is no single-cycle step on the scripting surface
(PLC_PRG gates its own body on a counter and raises a done flag); login must use `OnlineChangeOption.Never`,
because an online change keeps variable values across a code change; values come back as typed monitoring
strings (`INT#5`, `REAL#3`, `LREAL#0.33333333333333331`, `TRUE`).

## 8. What "fully implemented" means

| target | reachable |
|---|---|
| every language construct lowers and runs | yes |
| every **built-in** (2,424 corpus sites, 81 names) | yes — IEC-specified and bounded |
| every corpus POU executes correctly | yes, with 1–2 above |
| every real project runs | **no** — third-party libraries ship compiled, with no source to lower |

**Decision.** The goal is *language + built-ins + the standard library*, plus a way to **stub an external FB**
so a POU that calls one is still testable. Chasing literal 100% means reimplementing other vendors' libraries
indefinitely.

## 10. The value functions are one IR node, and every rule is measured

**Decision.** MAX/MIN/LIMIT/SEL lower to an `IrBuiltin` whose arguments lowering has already converted to one type,
so neither backend picks a comparison type. Rules, from CODESYS 3.5.21.40 (conformance `max_*`, `limit_*`, `sel_basic`):
- MAX/MIN are extensible (`MAX(1, 5, 3)` is 5);
- arguments meet like a binary operator's operands — `MAX(INT 3, REAL 2.5)` is REAL 3, and `MAX(USINT 200, SINT -1)`
  is 200, a comparison of values after promotion;
- `LIMIT(MN, IN, MX)` is exactly `MIN(MAX(IN, MN), MX)`: with MN > MX it returns MX for every IN;
- `SEL(G, IN0, IN1)` is IN0 on FALSE and IN1 on TRUE.

**The trap it avoids.** Rust's `clamp` panics when MN > MX — a case CODESYS answers — so LIMIT emits
`.max(mn).min(mx)`. It would have been the natural choice, and wrong exactly where the oracle looked.

## 18. STRING is a fixed-capacity value; its functions come from the referenced library

**Measured on CODESYS 3.5.21.40** (conformance `string_*`, `wstring_*`, `real_to_string_digits`):
- **Capacity.** `STRING(n)` holds n characters, a sizeless STRING **80** (85 stored → LEN 80), and a sizeless WSTRING 80
  too. Every store truncates: `STRING(5) := 'abcdefgh'` is 'abcde'. The capacity rides on the resolved type
  (`ElementaryTypeRef.length`); two capacities differ like two types, so the store's `convert` node is the truncation.
- **Comparison** is by code unit, never after converting to one capacity: 'abc' < 'b', 'A' < 'a'.
- **Escapes.** `$T`/`$t` tab, `$N` and `$L` ONE line feed, `$R` CR, `$P` form feed, `$$`, `$'`, `$"`, and two hex digits
  one byte. The IDE displays them re-escaped.
- **A WSTRING holds UTF-16 code units**: "héllo" into a WSTRING(3) is "hél", "ü!" fits a WSTRING(2), and a four-digit
  escape is one unit ("h$00E9llo" = "héllo"). Unmeasured, so refused: a character beyond the BMP, a WSTRING's named
  escapes, and which byte a non-ASCII character typed into a STRING becomes. (A first recording said "hé" — the
  RECORDER's IronPython json had turned é into two characters on the way in; fixed, see the recorder note below.)
- **Standard's string functions** (LEN/LEFT/RIGHT/MID/CONCAT/INSERT/DELETE/REPLACE/FIND) are a LIBRARY, not language
  (plc-library-runtime, tier 1): lowering binds them only when the call resolves to the declaration under
  `Library Manager/Standard/`, and takes its signature from there — STRING(255) in and out, so a STRING(300) argument is
  cut to 255 on the way in (`string_input_truncation`). Positions are 1-based; a count clamps to the string; MID/DELETE
  select nothing at a position below 1 or a length ≤ 0; INSERT prepends at 0 but leaves the string alone past its end
  or below 0; FIND of '' is 0; REPLACE is DELETE then INSERT at max(P − 1, 0). A WSTRING argument does not compile
  ("Cannot convert type 'WSTRING' to type 'STRING(255)'") — the W-functions need Standard64, which the fixture does not
  reference.
- **Conversions.** An integer or bit string → its decimal text; BOOL → 'TRUE'/'FALSE'; TIME → `T#` and its non-zero
  components ('T#1d2h', 'T#0ms'). STRING → integer skips spaces and tabs, takes one sign, reads digits up to the first
  other character, then wraps ('12abc' → 12, '- 5' → 0, '99999' → INT -31073). STRING → REAL/LREAL reads a decimal
  prefix after spaces and tabs: '.5' → 0.5, '5.' → 5, '1.5E' → 1.5, '2e2' → 200, '1,5' → 1, 'abc' → 0; REAL rounds to
  the nearest float32 ('1.23456789' → 1.23456788).
- **REAL_TO_STRING is NOT one rule — refused (user decision 2026-09-14: keep refusing for now).** Samples (`string_conversions_*`,
  `real_to_string_digits`): '3.0', '0.1', '1000000.0', '10000000.0', '99999990.0', '16777220.0', '1E08', '1.5E08',
  '-1E08', '1E10', '3.402824E38', '0.0001', '1E-05', '2.5E-10', ties up ('1234566.5' → '1234567.0'). Seven significant
  digits fits all of them EXCEPT 123456792 → '1.2345679E08' (eight). That is CODESYS's own digit routine; more samples
  narrow it but cannot prove it. LREAL_TO_STRING is a different format again ('1.0e-1'). Options: keep refusing (the
  default — a POU that formats a REAL reports `conversion-type`), or accept a documented approximation.

**Rust.** One generated `IecStr<T, N>` — `[T; N]` plus a length, `Copy`, `IecString<N>` = u8 units and `IecWString<N>` =
u16 — prepended only to a POU that holds a string. `lit`/`to` keep at most N units, so truncation holds by construction;
`PartialOrd` compares used units. The Standard functions are `iec_*` helpers mirroring the interpreter line for line.

**What was wrong, and why no test caught it.**
- Every STRING slot started EMPTY: `constEval` folds no strings and `declare` silently dropped an initializer it could
  not fold. No oracle case held a string, and nothing asserted that an initializer reaches its slot unless it folded.
  Now an unfoldable initializer is reported (`init-not-constant`, 22 corpus POUs — each one was silently wrong).
- STRING mapped to Rust `String`, which `self.a = self.b` MOVES out of `self` — no string program was ever in the rustc
  crate check.
- A STRING capacity was never resolved (`resolve.ts` dropped `STRING(5)`'s length).
- My first REPLACE rule ("DELETE then INSERT at P − 1") implied INSERT at −1 prepends; the recorded INSERT said otherwise.
  Inferences stay inferences until a case records them.

**The test harness prints a string's units, not Rust's `Debug`** — Debug writes a form feed as `\u{c}`, which is not JSON.

**The recorder is ASCII-only in both directions.** The runscript's IronPython `json` treats every string as UTF-8 bytes:
a case's "héllo" reached CODESYS as "hÃ©llo", and a genuine é read back crashed the dump and lost the whole recording.
`record-exec.ts` now writes non-ASCII as `\uXXXX` escapes, and the runscript returns values the same way.

## 17. DATE and DT count seconds, TOD milliseconds — and their displays lose information

**Measured on CODESYS 3.5.21.40** (conformance `date_*`, `dt_*`, `tod_*`, `ldate_ltod_ldt`):
- **DATE and DT are 32-bit counts of SECONDS since 1970-01-01** — `DATE_TO_UDINT(D#1970-01-02)` is 86400, not 1 —
  and DT wraps: `DT#2106-02-07-06:28:15 + T#1S` is the epoch. (`types/elementary` said DT is 64 bits; fixed.)
- **TOD is a 32-bit count of MILLISECONDS since midnight, NOT reduced modulo a day**: `TOD#12:30:15.5 + T#12H` stores
  88215500 ms, while the IDE shows `TIME_OF_DAY#0:30:15.500`.
- **LDATE / LDT / LTOD are 64-bit NANOSECONDS**.
- **A date ± a duration converts the duration into the date's unit by TRUNCATING division** (`DT + T#1500MS` adds one
  second) and computes in the date's width; `DT - TIME` and `DATE + TIME` compile (`D#2024-02-28 + T#1D` is 2024-02-29).
- **A date − a date of the same type is the difference scaled into TIME** (LTIME for the L variants):
  `D#2024-03-01 - D#2024-02-28` is `T#2D`, and the reverse wraps as a UDINT (4122167296 ms).

Lowering scales through one table of nanoseconds per unit (`calendarArithmetic`), and runs BEFORE the constant
retyping — otherwise `dt + T#1S` would stamp the 1000-ms literal as a DT and add 1000 seconds. A duration finer than its
date (a TIME on an LDT) was not measured and is refused.

**What was wrong.** A date literal reached lowering as its TEXT and was typed STRING; as an initializer it did not fold
(slots began at 0); and date arithmetic did not lower at all. *Why missed:* no date oracle case, and no fixture.

**The recorder's displays are lossy.** A TOD displays modulo a day and a DATE without its time of day, so the replay
compares the backends' values AS DISPLAYED, and each case reads the stored truth through a lossless `*_TO_UDINT`
variable.

## 16. TIME is 32-bit milliseconds; LTIME is 64-bit nanoseconds

**Measured on CODESYS 3.5.21.40** (conformance `time_*`, `ltime_basic`):
- **TIME is an unsigned 32-bit count of MILLISECONDS.** `T#49D17H2M47S295MS` (4294967295 ms) plus `T#1MS` is `T#0MS`,
  and `T#500MS - T#1S` wraps below zero to `T#49D17H2M46S796MS`. `TIME_TO_DINT(T#1S500MS)` is 1500 and
  `DINT_TO_TIME(2500)` is `T#2S500MS` — conversions count milliseconds.
- **LTIME is a 64-bit count of NANOSECONDS**: `LTIME_TO_LINT(LTIME#1S + LTIME#1NS)` is 1000000001.
- **A duration times or divided by an integer stays a duration** (`T#1S * 3` is `T#3S`, `T#1S / 4` is `T#250MS`), and
  durations compare as their counts.
- **`T#1500US` does not compile** — TIME has no microsecond unit; sub-millisecond precision is LTIME's.

**What was wrong, and why nothing caught it.** The IR held every duration as an unbounded bigint of NANOSECONDS and
the emitter printed it as an `i64` — a recalled design note, while `types/elementary` already declared TIME 32 bits.
Worse, `constEval` folds only numbers and booleans, so `t : TIME := T#1S` started at 0. The oracle had no TIME case.
Now a duration literal is held in its type's unit (the prefix decides — the AST gives `T#` and `LTIME#` the same
`literalKind`), the interpreter wraps it at its width, and the emitter prints `u32` / `u64`. Duration ↔ REAL/BOOL
conversions are unmeasured and refused.

## 15. S= and R= are latches, and a chain acts on its final value

**Measured on CODESYS 3.5.21.40** (conformance `set_reset_*`):
- **`x S= c` is a latch, not an assignment**: it sets `x` only when `c` is TRUE and otherwise leaves it — a set `x`
  stays set under `S= FALSE`, and `R=` clears the same way. The whole right-hand side is the condition
  (`x S= (i > 5) AND flag`), across scan cycles too. It lowers to the IF it is; no backend sees an `S=`.
- **Assignment chains: the VALUE flows right to left, converted to each link's type as it passes; a `:=` link stores
  it, an `S=`/`R=` link latches its target on it and passes it on unchanged.** Every chain measured fits:
  `a S= b R= c` compiles, and with `b` FALSE and `c` TRUE `a` is SET — it latches on `c`, not on `b`;
  `plain := latch S= cond` with `cond` FALSE makes `plain` FALSE although `latch` stays TRUE; and
  `sint := dint := int` fails "Cannot convert type 'DINT' to type 'SINT'" — `sint` receives the value as converted
  through the DINT link (`assign_chained_plain` confirms the same by value, through a REAL link). Lowering evaluates
  the value once into a temp.

**Two tools were wrong about chains, and no test covered either.** The parser accepted only `:=` links after a plain
`:=` ("';' expected instead of 'R='" on valid code), and the formatter printed one operator for the whole chain — it
would have rewritten `a S= b R= c` into `a S= b S= c` in the user's file. Neither had a single chain test, no
conformance fixture used `S=`/`R=` at all, and the corpus contains no chain, so the zero-FP gate could never see it.
Both now carry per-link operators (`chainOps`) with a parser test and a formatter round-trip test.

## 14. Bit operations, and bit access as the first `Place.path` step

**Measured on CODESYS 3.5.21.40** (conformance `shift_*`, `rotate_*`, `mux_*`, `bit_access_*`):
- **SHL/SHR shift the PROMOTED value**: `SHL(BYTE 1, 9)` into a WORD is 512. The count is **masked to the width's
  bits, like x86**: `SHL(DWORD 1, 32)` is 1, `SHL(DWORD 1, 33)` is 2, and a count of -1 behaves as 31 (`SHL(BYTE 8, -1)`
  is 0). **SHR is arithmetic on a signed value**: `SHR(SINT -128, 1)` is -64, `SHR(INT -2, 1)` is -1. A 64-bit type
  masks to 6 bits — `SHL(LWORD 1, 65)` is 2 — and `SHR(LINT -8, 1)` is -4 (`shift_64bit`).
- **ROL/ROR rotate in the value's OWN width** — `ROL(BYTE 129, 1)` is 3, `ROR(BYTE 129, 1)` is 192 — with the count
  taken modulo that width: `ROL(BYTE 129, 9)` is 3 and `ROL(BYTE 129, 8)` is 129.
- **MUX's inputs meet like MAX's** (`MUX(0, INT 10, REAL 2.5)` is REAL 10), and **an out-of-range K picks the LAST
  input** — for K = 3 of three inputs, and for K = -1.
- **Bit access `x.n` is two's complement**, readable and writable: `INT -1 .15` is TRUE, `DWORD .31` reads, `INT 0
  .15 := TRUE` makes -32768, and clearing bit 0 of WORD 65535 gives 65534.

**Rust's own features match every edge here** (§13): `wrapping_shl`/`wrapping_shr` mask the count exactly as above
and shift signed values arithmetically; `rotate_left`/`rotate_right` take the count modulo the width. MUX prints as a
`match` whose `_` arm is the last input. A bit reads as `((x >> n) & 1) != 0` and writes as `x | (1T << n)` /
`x & !(1T << n)` with a typed one, so `1i16 << 15` is exactly the IDE's -32768.

**Why bit access does not need §9.** It is one `Access` step — `{ kind: "bit", index }` — on one local integer slot:
no pointer can target it and no instance holds it, so none of the slot+path / byte-image trade-offs apply. Every other
dotted name (a struct or instance member) still reports `expr-member` / `place-shape`, unchanged.

## 13. Use the Rust feature — once the oracle proves it means the same thing

**Decision (2026-09-14).** When Rust has a feature for an IEC operation, the emitter uses it — `.max()`, `.round()`,
`.sqrt()`, `.powf()`, `rotate_left` — so the output reads as ordinary Rust. The condition is not the name but the
EDGES: the feature is used only once `conformance` shows it agrees with CODESYS where the two could differ.

**Why the condition is not a formality.** Every emitter divergence so far was a Rust feature with the right name
and a different edge: `clamp` panics when MN > MX (CODESYS returns MX); float → int `as` truncates and saturates
(CODESYS rounds half away from zero and wraps); `-x` and `abs` panic on a signed minimum in a debug build (CODESYS
wraps); `f32::ln` is its own float32 routine (CODESYS's REAL results are the float64 ones, narrowed). Where the edge
differs, the emitter composes the measured behaviour from features that do agree, and says why at the call site.

## 12. Math functions: the argument's width is the computation's width

**Measured on CODESYS 3.5.21.40** (conformance `abs_values`, `abs_unsigned`, `sqrt_precision`, `exp_log_precision`,
`trig_precision`); results stored into LREAL, so a 32-bit computation shows its float32 digits:
- **SQRT, LN, LOG (base 10), EXP, SIN/COS/TAN/ASIN/ACOS/ATAN** keep a REAL argument in REAL — `SQRT(REAL 2.0)` is
  1.4142135381698608, `LN(REAL 2.0)` is 0.69314718246459961 — compute an LREAL in LREAL, and take an INTEGER argument
  to LREAL (`SQRT(INT 2)` is 1.4142135623730951, `LN(INT 10)` is 2.302585092994046).
- **A REAL result equals the float64 result narrowed to float32** for all ten — which is how both backends compute
  it: the interpreter through `Math.*` then `fit`, the emitter through `(x as f64).fn() as f32`. `f32::ln` is a
  different float32 routine and is deliberately not used.
- **ABS promotes like unary minus**: `ABS(SINT -128)` is 128; `ABS(INT -32768)` is 32768 into a DINT and wraps back to
  -32768 into an INT. `ABS` of a USINT compiles and is the value itself. The emitter prints `wrapping_abs` (`abs`
  panics on a signed minimum in a debug build) and the identity for unsigned types (which have no `abs`).
- **EXPT computes in REAL only when BOTH arguments are REAL** (conformance `expt_types`, `expt_mixed_width`):
  `EXPT(REAL 2.0, REAL 0.5)` is float32's √2, but `EXPT(REAL 3.0, INT 20)` is 3486784401 (float32 gives 3486784512),
  and `EXPT(INT 2, REAL 0.5)` / `EXPT(LREAL, REAL)` are float64. `EXPT(INT, INT)` is LREAL-typed — into an INT it does
  not compile. **Open, for the LSP not the transpiler:** `reference.ts` types EXPT as always LREAL, and `infer.ts`
  leans on that for a narrowing warning. Whether `EXPT(REAL, REAL)` is typed REAL or LREAL cannot be told from values
  — an implicit LREAL → REAL compiles (`implicit_lreal_to_real`), so `real := EXPT(r, r)` compiling proves nothing.
- **A domain error stops the application**: `SQRT(-1.0)` / `LN(0.0)` made the simulated application stop answering
  (the recorder's read timed out). It is a runtime exception, like division by zero; neither backend models runtime
  exceptions, and the oracle cannot record a value for one.

## 11. Conversions are one IR node with one meaning, implicit or explicit

**Decision.** `X_TO_Y(v)` and `TO_Y(v)` lower to the same `convert` node lowering already inserts for implicit
widening — so the two cannot drift. `X_TO_Y` first brings `v` to X the way the compiler would. The explicit step is
always a node, never a retyped constant: `DINT_TO_SINT(300)` stamped as a SINT constant would print as Rust's
out-of-range literal `300i8`. TRUNC/TRUNC_INT is the one conversion that does not round, so it is a `trunc` builtin.
A name is a conversion only when both halves are elementary types; a project function called `GO_TO_START` is not.

**The rules — measured on CODESYS 3.5.21.40** (conformance: 12 cases, inputs as variables so the conversion runs at
scan time, and one case proving constants fold to the same answers):
- **REAL/LREAL → integer rounds half AWAY from zero**: 0.5 → 1, 2.5 → 3, -2.5 → -3, -0.5 → -1. Not truncation (what
  the interpreter did), and not banker's rounding.
- **every integer result wraps to its width** — out-of-range REAL too: `REAL_TO_INT(40000.0)` is -25536,
  `LREAL_TO_DINT(3.0E9)` is -1294967296; and integer → integer of any width or signedness: `DINT_TO_SINT(300)` is 44,
  `DINT_TO_SINT(-129)` is 127, `SINT_TO_USINT(-1)` is 255, `UDINT_TO_DINT(4294967295)` is -1.
- **TRUNC/TRUNC_INT go toward zero**, into DINT / INT: `TRUNC(-2.7)` is -2. **Out of DINT range TRUNC is DINT's
  minimum** — `TRUNC(3.0E9)` is -2147483648, x86's "integer indefinite", neither a wrap nor a saturation — while
  `LREAL_TO_DINT(3.0E9)` wraps to -1294967296: TRUNC does not go through 64 bits. `TRUNC_INT` truncates into that
  DINT and then wraps into INT (`TRUNC_INT(40000.5)` is -25536). Confirmed beyond DINT (`trunc_beyond_dint`):
  `TRUNC_INT(3.0E9)` and `TRUNC_INT(-3.0E9)` are 0 (DINT's minimum, wrapped into INT), `TRUNC(-3.0E9)` is
  -2147483648. The emitter range-checks into `i32::MIN`.
- **BOOL → numeric is 1/0; numeric → BOOL is "not zero"** — INT 2, INT -1, BYTE 16 and REAL 0.5 are all TRUE.
- **→ REAL is float32**: `DINT_TO_REAL(16777217)` is 16777216; `REAL_TO_LREAL` widens the float32 exactly
  (`0.1` → 0.10000000149011612). `LINT_TO_LREAL(9007199254740993)` is 9007199254740992.
- **`TO_Y` exists** (SP21) and follows the same rules.

**The emitter traps.** Rust's float → int `as` truncates AND saturates; CODESYS rounds and wraps. So a REAL →
integer prints `(x.round() as i64) as T` — `f64::round` is exactly half-away-from-zero, and `as` between integers
wraps. `as bool` does not exist (`!= 0`), nor does `bool as f32` (`as u8` first).

## 23. Every declaration is owned, borrowed, or a handle — and none needs `unsafe`

ST allocates nothing at run time (`__NEW` is refused and unused), so every variable's storage is known when the program
compiles, and every form of it is safe Rust. The rustc builds forbid `unsafe_code` outright. The review of 2026-09-15 put
each declaration kind in one of three forms:

- **Owned** — the POU's, instance's or routine's own storage, mutated in place: VAR; VAR_INPUT (an FB's is a field the
  call assigns, a routine's a by-value parameter — ST copies inputs, and the callee may change its copy); an FB's
  VAR_OUTPUT (a field read after the call); VAR_INST (an instance field); VAR_STAT (one global per declaring FB or
  METHOD, shared by every instance — measured for both); VAR_TEMP (a slot started over at its initial value at the head of
  every run — measured for FB and PROGRAM); GVL variables and called PROGRAMs (owned by `Globals`/`Programs`, lent to
  every body as `g`/`prg`); an `AT` variable (plain storage, as the simulator runs it — refused where its address aliases
  another variable or is shared by several instances of an FB).
- **Borrowed for the call** — VAR_IN_OUT: a `&mut` parameter that never outlives the call. A root PROGRAM's or FB's
  VAR_IN_OUT has no caller and is refused. A VAR_IN_OUT CONSTANT holding no FB instance is a shared `&`: a variable is
  lent by reference, a STRING literal (and a variable the call already holds mutably, when the callee provably changes
  nothing) as a copy taken into a `let` before the call. One holding an FB instance is `&mut` — CODESYS calls the lent
  instance and its METHODs, each on `&mut self` — and no store into either kind lowers.
- **A handle, re-borrowed at each use** — POINTER TO, REFERENCE TO and interfaces stored in a frame. They outlive the call
  and usually point into the struct that holds them, which a Rust borrow cannot express without a self-referential
  struct; a `usize` (one target, §9 form 1) or a `u64` instance tag (§22) names the target, and each dereference is a
  fresh borrow of that place.

Open in this model (tasks.md): a routine's VAR_OUTPUT is a `&mut` reset on entry, where CODESYS copies it back after
the call — equal while every binding the callee could also see is refused, not beyond; a stored pointer with several
targets needs a multi-target handle; a REFERENCE or POINTER input of a routine could be a borrow for the call.

## 22. An interface holds its instance's tag; a call through it is a dispatch

Measured (conformance `itf_*`): an interface variable starts null and keeps what it holds across cycles; a call runs the
held instance's METHOD, a PROPERTY read or write its accessor; an interface copies into a variable of an interface it
EXTENDS; `__QUERYINTERFACE` answers TRUE and binds the target when the instance implements its interface, and on FALSE
sets the target to null — it does not keep what it held.

Lowering gives each FB instance place that is stored into an interface a TAG (1 and up, per lowered POU); the variable
holds the tag, 0 when null — a `u64` in Rust. A call through it is an `IrDispatch`: an expression whose arms each invoke
the routine on one instance, and which faults when no arm matches, as a null call stops the application. So a copy
between interfaces is a plain copy, and both backends see ordinary invokes — `match` in Rust, borrowing one field per arm.

The arms cannot be decided where the call lowers: `ref := b` later in the source reaches a call earlier in it on the
next cycle. Stores record what a variable may hold — tags, and edges from variables copied into it (filtered by interface
for a query) — and every dispatch and query is finished once the whole POU has lowered (`finishInterfaces`), repeating
while finishing lowers more. An arm on an instance of another frame is refused; so are, until built, an interface passed
as an input or bound as an in-out or output, a method with VAR_IN_OUT/VAR_OUTPUT called through one, and an instance
that is a local, an in-out, a dereference or an element at a runtime index.

## 21. A UNION is a struct kept overlaid by its stores

Measured: every member starts at offset 0, little-endian (`iWord := 16#ABCD` reads `aBytes[0] = 16#CD`). The byte view
of design §9 is not built for it. The union is a struct holding every member, and lowering follows a plain `:=` into one
member with IR copies of its bytes into each other member — unsigned `div`/`mod` by powers of 256, which neither backend
can overflow. Every read stays a plain field read, so both backends, the replay paths and `rustAccess` need nothing new.
The price is that the copy must follow EVERY write, so every write that cannot carry it is refused rather than trusted:
in-out and output bindings and latches and chain links (all through `through`), FOR variables, and ADR. A signed, REAL,
BOOL or STRING member is unmeasured and refused, and so is SIZEOF of a union.

## 20. An aggregate initializer is a structured initial value, not code

A slot's `init` is an `IrInit`: a scalar, `{ elements }` for an array, or `{ fields }` by upper-cased name for a struct or
FB instance. Nothing is desugared into assignments — the value exists before the first scan, as the IDE's does. What an
initializer leaves out is left out of the IR too, and each backend fills it from the type: an element from its type's
own initial value, a field from its TYPE's declaration (`new()` in Rust, the layout's `init` in the interpreter). That is
the measured rule — `(y := 7)` on a struct whose `x : INT := 5` keeps `x = 5`, nested and in array elements alike — and
it is why lowering never copies a type's defaults into the initializer: a copy would be a second place for them to live.
Row order for a multi-dimensional array, `n(v)` repeats and string truncation are all measured (conformance
`array_initializers`, `init_*`).

## 19. The 2026-09-14 review — what it found, and the direction taken

A critical read of `transpile/` before phase 3, with a probe for each suspicion. Four bugs, none reachable by an oracle
case, all fixed and pinned:
- **CONTINUE** printed a bare Rust `continue`, which skipped a FOR's step and a REPEAT's UNTIL test and looped forever.
  CODESYS runs both (conformance `continue_in_for`, `continue_in_while`, `continue_in_repeat`: FOR counts 4 and ends at
  i = 6, REPEAT counts 3 and ends at j = 5). The body now sits in a labeled block that CONTINUE leaves; labels print
  only when used, since the crate builds under `-D warnings`.
- **Field names**: the bare `snake` of an ST name was the Rust field, so `loop` emitted `pub loop: i16` and `aB` beside
  `a_b` two `a_b` fields. `emit/rust/fieldNames` suffixes a keyword and numbers a collision.
- **Unrepresentable slots**: an unused `POINTER TO INT` lowered, and the emitter threw on its type. Lowering now refuses a
  POU with a slot that has no runtime representation (`slot-<kind>`), checked last so another blocker keeps its category.
- *Why missed:* the oracle exercises the shapes it holds, and "lowering never throws" stopped at lowering — nothing
  asserted that a backend accepts what lowering accepts.

The verdict: the measured expression semantics and the oracle stay; a full rewrite now would have to guess the memory
model, and splitting `lower.ts` in place would polish the frame layer phase 3 replaces. **Chosen (user, 2026-09-14):
settle §9, then build phase 3 as a new IR** — a backend-only type that is total by construction (no optional capacity
for an emitter to throw on), places with paths, one application frame — porting the expression rules and the oracle
unchanged, with lowering's failure propagation made a boundary throw instead of 44 `undefined` checks. The runtime-tier
question (native Rust + a TS mirror, or an ST shim) is settled alongside, so builtins stop being written twice.

## 9. The memory model — decided: three forms in safe Rust (the first analysis kept above the decision)

`Place` is `{ slot, path }` with `path` empty. Two ways forward:

| | slot + path | byte-addressed image |
|---|---|---|
| locals, fields, array elements | direct | direct |
| `ADR` of an arbitrary sub-location | needs an encoding | native |
| `VAR_IN_OUT` | index + path tuple | offset |
| emitted Rust | named struct fields — readable | one `[u8; N]` — opaque |
| debuggability of output | high | low |

**The coverage ratchet now says so too** (2026-09-14): the first four built-ins moved `expr-call` from 60 to 58
POUs and fully-lowered POUs stayed at 1 of 304, because `stmt-call_stmt` (84%) and `expr-member` (31%) block
nearly every real POU. More built-ins are correct work that barely moves the number; this decision is what does.

**This must be settled before FB instances, methods and GVLs are built**, because those are what a pointer
points *at*. Building them on slot indices and then discovering `ADR` needs offsets means doing that work
twice. A hybrid is likely — named fields for the common case, with a lowering-computed offset for anything
`ADR` is taken of — but it is a decision, not a default, and it is not taken yet.

**The corpus census (2026-09-14)** — project code only, Library Manager copies excluded (they inflate POINTER TO to
25 086), over awa-palletizer, bakon-nano, lenze-mid and pro2193:

| construct | count | what it points at |
|---|---|---|
| `ADR(…)` | 460 | 415 are call arguments: string buffers to StringUtils (`StrConcatA` 64, `StrFindA` 10, `StrCpyA` 8 …), an FB instance handed over as an object (`DiffLogger(Logger := ADR(g_Logger))` 124), an array start (`Calc_CopyCutsWithOffset` 43) |
| `ADR` of a member / an element | 13 / 30 | a sub-location — a place with a path |
| POINTER TO | 130 | BOOL, STRING, library structs, arrays; BYTE only 7 |
| `p^[i]` / `p[i]` on a pointer | 32 / seen | element indexing — `I_dataArray[i - lb]` on a `POINTER TO XYA_Target` |
| `(p + n)^`, `p := p + …` | 0 / 3 | raw pointer arithmetic is almost absent |
| SIZEOF | 58 | with the few byte-level calls: `CreateJson` (5), `StrCpyA` (1), `…CopyStruct`, `FcCompareStructs` |
| REFERENCE TO · VAR_IN_OUT · `REF=` · deref `^` | 112 · 176 · 69 · 616 | aliases of whole places |

So a pointer is almost always a **typed handle to a place**: a root (a GVL, an instance, a frame) plus a path of fields
and indices. Indexing a pointer moves its last index step. What needs BYTES is narrow: SIZEOF, and a handful of
library functions that copy, compare or serialize a struct by address.

**Recommended: a hybrid, handle-first.** A pointer/reference value is `{ root, path }` over the named-field model
(readable Rust stays), `p[i]` and `p + k·SIZEOF(T)` move the last index step, and a byte view of a place is produced
ON DEMAND from a lowering-computed layout — only where SIZEOF or a byte-level library function asks for one. Refused
(counted), never guessed: arithmetic that leaves a typed element boundary, `POINTER TO BYTE` walks over a non-byte
place, pointers compared or stored as integers.

**Measure before building it** (the oracle, as for every rule): SIZEOF of a mixed struct and of an FB instance on the
simulation device (alignment and padding); `p[i]` and `p + SIZEOF(T)` over an array of structs; a pointer to an FB
instance calling a method through `^`; `ADR` of a member of a VAR_IN_OUT; what a dangling or null dereference does
(the recorder already sees a null write stop the application).

**Why it stays simple — and safe Rust (review, 2026-09-14).** IEC declares every variable in a declaration section:
no heap (`__NEW`: 0 in the corpus), no lifetimes to infer. The application is ONE tree of owned values whose shape is
known at compile time, so the Rust is plain nested structs — `#[derive(Default)]`, arrays by value, no `Box`, `Rc`,
`RefCell` or `unsafe`, and no Rust reference ever stored:
- a program is `impl PlcPrg { fn scan(&mut self, g: &mut Globals) }` — its own state and the globals are disjoint borrows;
- an FB is a struct of its VAR, a method `&mut self`, a call on a declared instance `self.inst.bump()`;
- a pointer, reference or VAR_IN_OUT takes the FIRST of three forms that applies — simplest first:
  1. **its target is static** (one ADR of it, assigned before any use, never tested for null) → the place itself:
     `p := ADR(arr[1]); p[2].x` is `self.arr[1 + 2].x`, `pInst^.Bump()` is `self.inst.bump()` — no pointer at all;
  2. **it never outlives the call** (VAR_IN_OUT, a FUNCTION/METHOD pointer parameter, an ADR used within the call) → a
     `&mut` borrow, a slice `&mut [T]` when indexed (`Calc_CopyCutsWithOffset(I_dataArray := ADR(arr))`);
  3. **it is stored and has several targets** → a handle: a small `enum` of its targets with the element index,
     matched where it is dereferenced.
`memory-sketch.rs` shows all three for the six fixtures (plus a slice parameter and a two-target handle); it compiles
under `-D warnings` and asserts the recorded values.

**How often each form applies** (census of the 171 pointer/reference variables in project code, targets read from
`x := ADR(…)` / `x REF= …`): where a local's targets are visible, most have ONE (FB locals 19 of 25, METHOD locals 24
of 34, FUNCTION locals 5 of 5) — form 1; the 46 FUNCTION/METHOD pointer parameters are form 2 unless a method stores
one; form 3 is the minority — 16 multi-target locals, and an FB's 32 pointer INPUTS, which persist between calls by
definition. A pointer the text search saw no target for (a copy of another pointer, a positional argument) is decided
by lowering from the parse, never assumed static.
Safe Rust holds for everything the program owns. It stops at two edges, both refused-and-counted, never `unsafe`:
memory the program only sees as BYTES (a `POINTER TO BYTE` over a struct, a copy or compare by `ADR` + `SIZEOF`) —
reachable through an on-demand byte view, safe but less readable; and a pointer that comes from OUTSIDE the program
(`AppGetCurrent`, `IecTaskGetCurrent` return runtime-system memory) — runtime tier, not transpiled code. One subtle
case: the same place passed to two VAR_IN_OUT parameters is two `&mut` to one place, which Rust rejects — that call
takes the handle path.

**Measured (2026-09-14, conformance `mem_*`, the 64-bit simulator):**
- a struct lays out as C does: `b : BYTE; i : INT; d : DINT; x : BOOL; l : LREAL` has offsets 0 / 2 / 4 / 8 / 16 and
  SIZEOF 24 (each field aligned to its size, the struct to its widest); an array of three is 72; a BOOL is 1 byte; a
  STRING is 81 (80 + terminator); SIZEOF returns a width that widens silently into ULINT, and `ADR(a) - ADR(b)` into
  ULINT compiles without a message;
- an FB instance is LARGER than its variables: `b : BYTE; d : DINT` plus a method is 16, where the same struct is 8 —
  consistent with one hidden pointer-sized header; its placement is not measured;
- `p := ADR(arr[1])`: `p^.x` is arr[1], `p[2].x` arr[3], `p + SIZEOF(T)` arr[2], and `p[3].x := 77` writes arr[4] — an
  index step, exactly the handle's; `(p + SIZEOF(T))^` does not PARSE ("';' expected instead of '^'"), so a stepped
  pointer is always a stored one;
- a method called through `pInst^` runs on the instance (n = 2 after two calls), and ADR of a VAR_IN_OUT member
  written through changes the CALLER's place (rec.y = 99).
`memory-sketch.rs` asserts these same values.

**Decided (user, 2026-09-14): the handle-first hybrid.** Slot + path with no byte view, and a full byte image, were the
alternatives. The measurements above are recorded before any of it is built.
