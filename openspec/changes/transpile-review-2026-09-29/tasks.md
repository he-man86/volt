# Tasks — confirmed root causes, high → medium, by layer

Paths are relative to `packages/volt-lsp-iec/`. Scratch repros live under the review scratchpad (`…/scratchpad/review/`),
which is session-local; each task restates its repro inline. **Every task: red test first** (a conformance fixture,
recorded with `record:exec` when the task says "record", and a colocated `src` test), then the fix, then the corpus
gate. "LIVE" = measured on CODESYS SP21 during the review (raw values in `scratchpad/review/live/results.json`); copy
those values into the new fixture's recording.

---

# HIGH

## Types layer

## 1. commonType lets a wider UNSIGNED operand win over a narrower SIGNED one
- Root cause: `src/types/arith.ts:35` (`return ea.rank > eb.rank ? a : b`; signedness only compared at equal rank);
  used by `lower/expressions.ts:250-251` (meet, then promote), `lower/builtins.ts:427` (MIN/MAX/LIMIT/SEL),
  `lower/statements.ts:321` (FOR compare).
- Explains: shapes 708, 715-717, 721, 722, 764, 766 (`self.a.wrapping_add(self.b as u64)`); groups
  commontype-unsigned-wins-over-signed and const-eval-real-at-double (mislabelled representative).
- Repro: `ul:ULINT:=6; s:SINT:=-2; w:DWORD:=10; i:INT:=-2; z:DWORD:=0; ud:UDINT:=7` →
  `ul/s`, `w/i`, `z>i`, `ul>s`, `ud MOD i`, `MIN(ud,i)` give 0, 0, FALSE, FALSE, 7, 7 in both backends.
- CODESYS: the meet is signed at the wider width — `codesys.build.json` plat_uxint_meet_dint / plat_xword_meet_dint
  ("Implicit conversion from unsigned Type 'ULINT' to signed Type 'LINT'"), `fixtures/operators/mixed-type.ts`
  (meet_ulint_div_sint = LINT, meet_dword_plus_sint = DINT). Expected -5, -5, TRUE, TRUE, 1, -2.
- Fix: in commonType's integer branch, when exactly one side is signed return `integerOfWidth(maxBits, true)`
  (checkedMeetType's rule); promote each operand BEFORE the meet. Also run the LSP corpus gate.
- [x] 1.1 Run fixture `meet_mixed_sign_wider_unsigned` (the repro, one scan) + arith src test — red. Recorded with
  `record:exec`: CODESYS answers -3 (not -5: 6 / -2), -5, TRUE, TRUE, 1, -2; both backends gave 0, 0, FALSE, FALSE, 7, 7.
- [x] 1.2 Fix commonType; re-run LSP + transpile gates. Different widths, one side signed -> the signed type of the
  wider width (`src/types/arith.ts`, `arith.test.ts`); fixtures.test.ts 4225 pass, map unchanged beyond the new row.

## 2. A named integer CONSTANT folds to its unwrapped initializer
- Root cause: `src/types/const-eval.ts:127` (initialValue never narrows to the declared integer width; the slot does,
  via `stored()`).
- Explains: `C : INT := 40000` folds to 40000 in initializers, CASE labels, FOR steps and repeat counts while the
  slot holds -25536; the Rust CASE arm `40000 =>` on an i16 does not compile.
- Repro: `VAR CONSTANT C : INT := 40000; END_VAR VAR x : DINT := C; s : INT := -25536; END_VAR CASE s OF C: …` →
  x=40000, CASE takes ELSE.
- CODESYS (LIVE): x=-25536, y=-25536, `CASE s OF C` matches (res=1). BUT a constant initialised from a constant
  EXPRESSION keeps its unwrapped value: `D : SINT := K + 1` (K=127) reads 128, `E : USINT := U + 3` reads 258 and
  `[E(7)]` is "Too many initializers for array".
- Fix: narrow a constant initialised from a plain literal to its declared type; keep the unwrapped fold for an
  expression initializer (as measured). Move the narrowing into `types/` so the LSP shares it.
- [x] 2.1 Record `named_const_literal_wrap` and `named_const_expression_keeps` from the LIVE case — red.
  Recorded with record:exec: C=-25536, x=y=-25536, CASE matches; N : SINT := 200 reads -56. Emitted Rust `40000 =>` on i16 failed rate:fixtures.
- [x] 2.2 Fix initialValue. A literal initializer is held at the declared integer width (`heldAs` in `types/const-eval.ts`, shared by LSP and lowering); an expression initializer keeps the unwrapped fold (d1 = 128, e1 = 258 match).
- [ ] 2.3 `named_const_expression_keeps` diverges on the SLOT: CODESYS reads D as SINT#128 / E as USINT#258 and `d2 := D` = 128;
  lowering stores the constant wrapped (-128 / 2) and reads it from that slot. Deferred (diverges ceiling 3 -> 4) —
  a constant reference would have to lower to its folded value, and the constant's own read cannot be held in its declared width.

## 3. REAL constants and REAL# literals fold at double precision
- Root cause: `src/types/const-eval.ts:69` (literal ignores REAL#), `:127` (no Math.fround for a REAL constant),
  `:149` (foldNumber computes in f64); reached from `lower/storage.ts:481`.
- Explains: an initializer and the identical assignment disagree (`x : LREAL := C` = 0.1 vs `y := C` =
  0.10000000149011612).
- CODESYS (LIVE): every initializer equals its runtime twin: iRef = 0.10000000149011612, iAdd = 16777216,
  iDiv = 0.3333333432674408, iLit = 0.10000000149011612; `(CBig+1)-CBig` = 1 (intermediates wider, rounded once
  to REAL at the end); an LREAL constant `DChain := C01` is exactly 0.1 (literal substituted).
- Fix: type the fold (carry REAL width, round once at the REAL store), substitute the literal for LREAL-from-REAL
  constants as measured; or decline to fold when a REAL operand is involved.
- [x] 3.1 Record `real_constant_fold_width` (the 12-variable LIVE program) — red. Recorded with record:exec; the LIVE
  values above reproduced exactly (rBig = 1 and rChain = 0.1 too).
- [x] 3.2 Fix const-eval. The fold carries a REAL width and `constEval` rounds once at the end; a CONSTANT's own slot takes
  the unrounded fold (`asConstant`); lowering folds an all-constant REAL expression instead of computing it in f32
  (`rBig`); the Rust emitter prints an f32 constant in its shortest digits (no `excessive_precision`). Fixture confirmed.

## 4. A VAR_INPUT CONSTANT parameter's default is folded as a compile-time constant
- Root cause: `src/types/const-eval.ts:118` (initialValue accepts any `symbol.constant`) and `:44` (constancyOf);
  consumers `lower/statements.ts:304` (FOR step), `:210` (CASE), `lower/storage.ts:244/481`.
- Repro: `FUNCTION F VAR_INPUT CONSTANT n : INT := 1; … FOR i := 0 TO 9 BY n …; loc : INT := n*10` called
  `F(n := 3)` → 1010 (expected 430). Rust hard-codes step 1 and ignores `n`.
- CODESYS: VAR_INPUT is pass-by-value; `var_input_constant` recording shows the parameter holds the caller's argument.
- Fix: fold only non-parameter CONSTANT sections (key on varSection). LSP C0218 changes accordingly.
- [x] 4.1 Fixture `var_input_constant_default_as_step` — red. Recorded with record:exec (F(n := 3) = 4 passes, F() = 10); the initializer half split out as `var_input_constant_default_in_init` (LIVE 30 / 10).
- [x] 4.2 Fix. `initialValue` folds only a CONSTANT that is not a VAR_INPUT/VAR_IN_OUT parameter; `constancyOf` is unchanged (its "constant" also means read-only: the "no valid assignment target" check on `inout_const_write_5` needs it, and no recording says C0218 for a parameter label). A routine local initialised from a parameter is now refused (`init-not-constant`, rated not-lowered) instead of taking the default.

## Lowering layer

## 5. All-constant integer fold forces LINT and wraps ULINT/LWORD literals ≥ 2^63
- Root cause: `lower/expressions.ts:247-248` (retype every constant to LINT; false comment "LINT is the widest the IR
  can type"), then `lower/convert.ts:23` (`stored` asIntN); `lower/builtins.ts:428` (meetOperands) for MIN/MAX/LIMIT/MUX.
- Explains: groups all-const-fold-retypes-to-lint, struct-field-fbinit-args-wrong-scope (mislabelled).
- Repro: `18446744073709551615 > 5` → FALSE, `/ 2` → 0, `MIN(…,5)` → -1, `16#8000000000000000 > 1` → FALSE.
- CODESYS (LIVE): isgt=TRUE, half=9223372036854775807, mx=18446744073709551615, hexgt=TRUE,
  hexdiv=1152921504606846975, signbit=TRUE.
- Fix: fold at commonType(LINT, the literal's own `integerLiteralType`) — ULINT when an operand needs it — or fold
  exactly in bigint and store once.
- [x] 5.1 Record `const_literal_wider_than_lint` — red. Recorded with record:exec; the LIVE values reproduced exactly; both
  backends gave FALSE, 0, 5, FALSE, 0, FALSE.
- [x] 5.2 Fix. `integerFoldType` (`lower/convert.ts`): an all-constant fold is LINT, or ULINT when an operand's value exceeds
  LINT's range — used by the binary fold and `meetOperands`; fixtures.test.ts 4249 pass, map unchanged beyond the new row.

## 6. An integer literal adopts its neighbour's type even when it does not fit, and wraps
- Root cause: `lower/constants.ts:324` (contextLiteralType returns the expected type regardless of range), reached
  from `lower/expressions.ts:203` (right operand lowered with expected = left.type) and `:240-241` / `lower/convert.ts:46`
  (`adopt` retypes without a range check); `lower/builtins.ts:425-427` for MIN/MAX/LIMIT.
- Explains: groups literal-adopts-neighbour-type-without-range (in part), queryinterface-foreign-edge (mislabelled
  representative), the second symptom of all-const-fold-retypes-to-lint.
- Repro: `x : DINT := 5`: `x > -3000000000` → FALSE; `x + -3000000000` → 1294967301; `ud : UDINT`: `ud + 5000000000`
  → 705032709; `ud > 5000000000` → wraps; `MAX(ud, 5000000000)` → 1000000000.
- CODESYS (LIVE): gNegLint=TRUE, sumNegLint=-2999999995, sumUdLint=5000000005, gUdLint=FALSE, gUdintLit=FALSE,
  gUdintLitRev=FALSE, mulUdintLit=15000000000 — a UDINT literal beside a DINT meets at LINT.
- Fix: when the literal does not fit `lift(neighbour)`, keep `integerLiteralType(literal)` and let commonType meet
  the pair; assignment still wraps at the target (cc_literal_3e9_into_dint stays right).
- [x] 6.1 Record `literal_beyond_dint_neighbour` — red.
  Recorded 2026-09-29 (record:exec): `tr_6_literal_beyond_dint_neighbour` — diverges (deferred.transpile).
- [x] 6.2 Fix. `beside` (lower/convert.ts): an integer constant takes its variable neighbour's lifted type only when it fits, else keeps its literal type and meets via commonType (LINT/ULINT when the meet cannot hold it); `meetOperands` does the same for MIN/MAX/LIMIT/SEL. Fixture confirmed, mark removed; src test in lower.test.ts; corpus gate green.

## 7. A negative literal is a runtime negation, not a constant
- Root cause: `lower/expressions.ts:174-175` (unary `-` always builds a `neg` node; never folds a const operand);
  treated as a variable by `expressions.ts:237-247` and `builtins.ts:424`.
- Explains: groups negative-literal-not-a-constant (the MAX half), unary-minus-unsigned-stays-unsigned (mislabelled
  representative); `-2000000000 - 2000000000` → 294967296.
- Repro: `MAX(-5, 3000000000)` → -5; `MAX(-1,3000000000,7)` → 7; `-5 + 3000000000` → -1294967301;
  `MIN(-5,3000000000)` → -1294967296.
- CODESYS (LIVE): a=3000000000, b=3000000000, c=d=e=2999999995, f=-4000000000, h=-5.
- Fix: fold `-<const>` into a const at lowering; the all-constant rules then apply unchanged. Keep promote+wrapping_neg
  for variables (unary_minus_at_the_edge).
- [x] 7.1 Record `negative_literal_constant_fold` — red. Recorded with record:exec; the LIVE values reproduced exactly (a=b=3000000000, c=d=e=2999999995, f=-4000000000, h=-5); both backends gave -5, 7, -1294967301, -1294967301, 2999999995, 294967296, -1294967296.
- [x] 7.2 Fix. The unary case (`lower/expressions.ts`) lowers `-<int|real literal>` as the negative literal itself (context type, else the narrowest that holds it), so the all-constant fold and MIN/MAX's meet apply; a variable keeps promote+wrapping_neg. The review notes about the unfolded negation (14 constructs, shapes1_2/5_2/6_5/9_7/13_5/14_1/16_8/18_5/20_5) are done and deleted; the survivors re-keyed; the dead `clippy::min_max` allow folded into `unnecessary_min_or_max`.

## 8. Unary minus on UDINT/DWORD/ULINT/LWORD computes in the unsigned type
- Root cause: `lower/expressions.ts:174` (`promoteForRuntime(operand.type)` never changes signedness at 32/64 bits).
- Repro: `u : UDINT := 5`: `li : LINT := -u` → 4294967291; `r : LREAL := -ul` → 1.8e19; `-u < 0` → FALSE.
- CODESYS: `codesys.build.json` uop_neg_udint / uop_neg_dword type DINT, uop_neg_ulint / uop_neg_lword type LINT;
  `unary_minus_at_the_edge` shows sign extension. Expected -5, -5.0, TRUE.
- Fix: negate in the signed integer of the operand's runtime width (checkedNegationType).
- [x] 8.1 Fixture `unary_minus_unsigned_widened` — red. Recorded with record:exec: -5, -5, LREAL -5, -5, `-udMax` = 1 (DINT wrap), TRUE, TRUE; both backends gave 4294967291 / 1.8e19 / FALSE.
- [x] 8.2 Fix. `lower/expressions.ts` negates in `checkedNegationType(promoteForRuntime(operand.type))` — the signed integer of the runtime width (DINT for UDINT/DWORD, LINT for ULINT/LWORD).

## 9. ROL/ROR on an expression rotate in the promoted (32-bit) width
- Root cause: `lower/builtins.ts:173` (width from the lowered operand's IR type, already DINT after promoteForRuntime).
- Repro: `w : WORD := 16#8001; ROL(w AND m, 1)` → 2; `ROR(b OR b, 1)` with b=16#81 → 64.
- CODESYS (LIVE): rolWordAnd=3, rorWordAnd=49152, rolByteAdd0=3, rolByteMax=3, rorByteOr=192, rolByteAndLit=3,
  rolByteOverflow=2, rolByteOverflowWide=258 (a BYTE+BYTE sum into a WORD destination rotates as 16 bits: the width
  follows the assignment context), rolMixed=258.
- Fix: rotate in the checked type of the expression (checkedMeetType / operand type), widened to the destination when
  the destination is wider, converting the promoted value down before `rotate_left`.
- [x] 9.1 Record `rotate_of_expression` — red. Recorded with record:exec; the LIVE values reproduced. Both backends gave 2, 16384,
  2, 2, 64, 2, 2, 514, 258. NOTE 258 is NOT a 16-bit rotate of 16#101 (that is 514): the low 8 bits rotate and the promoted bits
  above them ride along (x86 `rol al` in EAX) — so "widened to the destination" is not the rule.
- [x] 9.2 Fix. ROL/ROR rotate the low bits of the operand's checked width (`checkedBits` in `lower/builtins.ts`; an untyped literal
  takes the other operand's type) and keep the promoted bits above (`IrBuiltin.bits`, evaluate + Rust emitter); fixture confirmed.

## 10. DT/LDT/TOD → DATE/LDATE evaluates the source twice
- Root cause: `lower/builtins.ts:389` (`sub(count, mod(count, day))` reuses one IrExpr node).
- Repro: `d := DT_TO_DATE(F_Tick(calls))` with a VAR_IN_OUT counter → calls=2; `F_Walk` variant gives a DATE that is
  not a whole day (raw=86399).
- CODESYS: a call argument is evaluated once; `xf_dt_to_date` fixes the value rule. Expected calls=1, raw=86400.
- Fix: `div(count, day)` then `mul(…, day)` (single read; also leaner).
- [x] 10.1 Fixtures `xf_<src>_to_<date|ldate>_call_once` (all 10 pairs) — recorded with record:exec. The premise was half wrong: CODESYS itself reads a DT/LDT/TOD/LTOD source TWICE (`x - x MOD day`, left first, wrapping: DT 86405 then 172807 -> 86398; TOD 5s then 7s -> 16#FFFFFFFE), which the lowering already matched; only DATE<->LDATE reads it ONCE (calls=1, raw=86400) — red there.
- [x] 10.2 Fix. `lower/builtins.ts`: a DATE/LDATE source is already whole days, so the day mask (and its second read) is skipped; `mul(div(...))` was NOT applied — it would read the DT/TOD sources once, unlike CODESYS. The harness displays an LDATE signed (recorded `LDATE#1969-12-31` beside raw 2^64-2e9).

## 11. STRING↔WSTRING and STRING→number conversions cut the operand to 80 characters
- Root cause: `lower/builtins.ts:298-299` (`convert(arg, withStringCapacity(from!))` and result `withStringCapacity(to)`;
  false comment at `:261`).
- Explains: groups string-conversion-80-char-capacity and literal-adopts-neighbour-type-without-range (mislabelled
  representative); `xo3_string_wide_conversions` never exceeds 20 chars.
- Repro: `STRING_TO_INT(s)` of 90 spaces+'5' → 0 while `TO_INT(s)` → 5; `WSTRING_TO_STRING` of 100 chars → 80.
- CODESYS (LIVE): length-agnostic — namedInt=bareInt=5, crossNamed=crossBare=12345, n=100, narrowLen=91, n3=86.
- Fix: keep the argument's own capacity when it is already a string of the named family; size a wide result by the
  source's capacity.
- [x] 11.1 Record `string_conversion_beyond_80` — red.
  Recorded 2026-09-29 (record:exec): `tr_11_string_conversion_beyond_80` — not-lowered (`conversion-type`). CODESYS converts the whole operand (namedInt=5, crossNamed=12345).
- [x] 11.2 Fix. `lowerConversion` (lower/builtins.ts) keeps a string operand of the named width at its own capacity and sizes a STRING<->WSTRING result by it; WSTRING_TO_<number> and a bare `TO_<number>` of a string parse the narrowed text — fixture confirmed (rust vendor); src test in lower.test.ts; four xo3 notes re-keyed.

## 12. LDT/LDATE/LTOD → STRING: interpreter prints the raw count, Rust calls missing helpers
- Root cause: `lower/builtins.ts:273` (`hasText` admits the whole date family); `ir/values.ts:371` (falls through to
  `String(v)`); `emit/rust/emit.ts:678` (`iec_${source}_text` with no prelude definition — E0425).
- CODESYS (LIVE): 'LDT#1970-01-01-00:00:00', 'LDT#2024-02-29-13:05:09.000000001', 'LDT#2024-02-29-13:05:09.500000000',
  'LD#1970-01-01', 'LTOD#23:59:59.999999999', 'LTOD#01:02:03.500000000', 'LTOD#01:02:03.000001000'. Prefixes LDT#,
  LD#, LTOD#; a zero fraction is omitted, any other prints 9 digits; dates after 2262 wrap as signed i64 ns
  (2300-01-01 prints 1715-06-13), so the `as i64` in the emitter is right for these.
- Fix: implement ldt/ldate/ltod text in `values.ts` and the prelude from the recording (or refuse until then).
- [x] 12.1 Record `fmt_long_dates` (the 11-case LIVE program) — red.
  Recorded 2026-09-29 (record:exec): `tr_12_fmt_long_dates` — diverges; the emitted Rust does not compile. CODESYS wraps LDT/LDATE 2300 to 1715 (`LDT#1715-06-13-00:25:26.290448384`).
- [x] 12.2 Fix both backends. `longCalendarText` (`ir/values.ts`) + prelude `iec_ldt_text`/`iec_ldate_text`/`iec_ltod_text` read the u64 as i64; LDT's date floors but LDATE_TO_STRING's day TRUNCATES (2300 -> 'LD#1715-06-14', display LDATE#1715-6-13); the harness now reads an `LDATE_AND_TIME#` display signed like LDATE's. Fixture confirmed, rust vendor.

## 13. FOR whose limit is wider than the counter emits a step that does not compile (E0308)
- Root cause: `lower/statements.ts:341` (the step reuses `current`, the counter already converted to compareIn at
  `:322`).
- Explains: group for-step-uses-widened-counter; also surfaces in tasks 1, 36 and the `forMixed` probes.
- Repro: `FOR i := 1 TO k - 1` (INT), `TO UPPER_BOUND(a,1)`, `TO lim` (DINT), `FOR i := 5 TO -5 BY -1` →
  `self.i = (self.i as i32).wrapping_add(1i16)`; rustc E0308. Interpreter runs them.
- CODESYS: ordinary compiled FOR loops; counter ends one step past the limit (`callshape_for_bounds_changed_in_body`).
- Fix: step's left operand = `{kind:'load', place: control, type: control.type}`; widen only in the test.
  `emit.test.ts:694` must compile its output.
- [x] 13.1 Fixtures `for_limit_wider_than_counter_*` (DINT var, DINT expr, UPPER_BOUND, UINT `n-1`, `5 TO -5 BY -1`) — red. Recorded: CODESYS REFUSES the three DINT limits over an INT counter ("Cannot convert type 'DINT' to type 'INT'") — rated lsp-gap (LSP silent; follow-up); UINT `n-1` (3 passes, u=3) and the negative step (11 passes, sc=-6) confirmed.
- [x] 13.2 Fix. The step adds a fresh load of the counter in its own type; only the test widens (emit.test.ts compiles a UINT `n - 1` loop). The emit test's INT/DINT `hi` premise ("CODESYS compiles") is contradicted by the recording.

## 14. `p^ S= c` / `p^ R= c` through a multi-target pointer stores the condition
- Root cause: `lower/statements.ts:29` (storeThrough ignores `s.op`), called at `:129` before the latch branch at `:145`.
- Repro: `p := ADR(a); IF c THEN p := ADR(b); END_IF; p^ R= TRUE;` (c=FALSE) → a=TRUE.
- CODESYS: `set_reset_basic` / `set_reset_expression` recordings (R= TRUE clears, S= FALSE leaves alone).
- Fix: build the latch IF inside each arm of storeThrough.
- [x] 14.1 Fixture `set_reset_through_multi_target_pointer` — red.
  Recorded 2026-09-29 (record:exec): `tr_14_set_reset_through_multi_target_pointer` — diverges.
- [x] 14.2 Fix. `storeThrough` (lower/statements.ts) lowers an S=/R= right-hand side as the BOOL condition and builds the latch IF inside each arm; fixture confirmed (rust vendor), divergence mark removed; src test in lower.test.ts.

## 15. Copying an FB instance whole re-targets its ADR(own member) pointers
- Root cause: `lower/statements.ts:171` (whole-value assign of an FB/struct place with no check for instance-relative
  pointer/reference fields), with the frame-relative target encoding in `lower/pointers.ts:23-25,77`; the only refusal,
  `pointers.ts:115-118`, covers multi-target pointer copies only.
- Repro: `FB_P: x := 5; p : POINTER TO INT := ADR(x)`; `b := a; a(set := 7); b(set := 0); r := b.seen` → 5.
- CODESYS (LIVE): res=7, `b.p = ADR(a.x)` TRUE, `b.p = ADR(b.x)` FALSE — the copy keeps the source's address.
- Fix: refuse (`lw.bail`) a whole-value store of a type whose pointer/reference fields have instance-relative
  targets (or model a foreign target).
- [x] 15.1 Fixture `fb_copy_keeps_pointer_address` — red (expect refusal until modelled).
  Recorded 2026-09-29 (record:exec): `tr_15_fb_copy_keeps_pointer_address` — not-lowered (`pointer-value`). CODESYS: sameA=TRUE, sameB=FALSE, rb=7.
- [x] 15.2 Fix (refusal until a foreign target is modelled). The whole-value store (lower/statements.ts, `holdsOwnAddress`) refuses `copy-instance-pointer` (not-modelled) for an FB, or a type holding one, whose POINTER/REFERENCE field has a recorded non-global target; the fixture stays not-lowered, now refused at the copy first; src test in lower.test.ts.

## 16. Copying an FB instance whole carries its in-out binding tag, and the target's METHOD panics
- Root cause: `lower/bindings.ts:89` (dispatch arms only for tags written by this instance's own calls) and `:100-102`
  (refuses SUPER^ rebinding and never-called targets only).
- Repro: `w(shared := first); w2(shared := second); w2 := w; w2.AddTen();` → Rust `_ => panic!`, interpreter throws.
- CODESYS: instance assignment copies pointers (`docs/codesys-reference/07-pragmas.md:491-500`); the in-out binding
  lives in the instance (`callshape_inout_in_method_after_call`). Expected first=11, second=100.
- Fix: refuse (`call-fb-inout`) a whole-value store into an instance with armed dispatches, or arm every tag of the FB.
- [x] 16.1 src test next to `lower.test.ts:614` with the target called first — red.
  Recorded 2026-09-29 (record:exec): `tr_16_fb_copy_carries_inout_binding` — diverges (the interpreter faults). CODESYS: first=11, second=100.
- [x] 16.2 Fix (refusal). A whole-value store registers every FB it copies (`registerWholeCopy`, lower/bindings.ts; `shared.copiedWhole`), and `lastBinding` refuses `call-fb-inout` for a METHOD reaching the in-out of such an FB — the copy carries a binding no arm lends; the fixture is now not-lowered (CODESYS's first=11 waits for copying the binding tag), mark removed; src case in lower.test.ts.

## 17. ANY input's pValue ignores the pointer's declared type
- Root cause: `lower/pointers.ts:101-106` (pValue target = the whole hidden VAR_IN_OUT at the argument's type; no
  `sameStorage` check, unlike `:74-76` and `calls.ts:1142-1143`).
- Explains: group any-pvalue-binds-whole-argument; `state_any_int_pointer_increment` only derefs same-type arms.
- Repro: DINT 1065353216 through POINTER TO REAL → Rust 1065353200.0, interp 1065353216; BYTE 254 via POINTER TO SINT
  `/2` → 127; POINTER TO BYTE `pb^ := 16#FF` over DINT 16#01020304 → 255.
- CODESYS: pValue is a raw byte address (`docs/codesys-reference/06-data-types.md:150-159`); memory is little-endian
  (`type_dut_union`). Expected 1.0, 255/-1, 16909311.
- Fix: bail `pointer-type` on a mismatched pValue dereference; prune arms unreachable by constant diSize so
  Increment.AnyInt still lowers.
- [x] 17.1 Fixtures reading BYTE/UINT/DINT through SINT/INT/REAL/BYTE pointers — red (refusal).
  Recorded 2026-09-29 (record:exec): `tr_17_any_pvalue_dint_via_real`, `tr_17_any_pvalue_byte_via_sint`, `tr_17_any_pvalue_uint_via_int`, `tr_17_any_pvalue_dint_write_via_byte` — diverge.
- [x] 17.2 Fix (refusal). `pointeePlace` (lower/pointers.ts) bails `pointer-type` when a pointer is dereferenced as another type than the one variable it names (an ANY `pValue`, a union member); `CASE anyArg.diSize` (lower/statements.ts, `anySize`) lowers only the arm for the variant's own size, so `state_any_int_pointer_increment` still lowers and matches. The four fixtures are not-lowered (the byte view is unmodelled), marks removed, not-lowered ceiling 104 -> 108; src test in lower.test.ts.

## 18. __QUERYINTERFACE into a global never marks its edge foreign
- Root cause: `lower/interfaces.ts:358` (`foreign: false` hard-coded; storeInterface computes it at `:189-198`).
- Repro: FB X queries `src` (its own child) into GVL `gItf`; x1 queries, x2 does not; `x2.r` → 2.
- CODESYS: an interface variable holds one instance's address; the plain store `gItf := src` is already refused
  (`interface-instance-relative`). Expected 1 (or refusal).
- Fix: compute `foreign` in queryInto exactly as storeInterface does.
- [x] 18.1 Fixture (the p3 program) expecting refusal — red.
  Recorded 2026-09-29 (record:exec): `tr_18_queryinterface_into_global` — diverges (CODESYS accepts it: r1=r2=1). Its `__QUERYINTERFACE` adds three to the source map's rename ceiling.
- [x] 18.2 Fix. `foreignWrite` (lower/interfaces.ts) now sets the query's edge as storeInterface does; the fixture is refused (`interface-instance-relative`, not-lowered) — CODESYS's r1=r2=1 waits for cross-instance lending. Src test in lower.test.ts.

## 19. A METHOD's VAR_IN_OUT loses to the FB field or VAR_STAT it shadows
- Root cause: `lower/places.ts:172-177` (localByName → statics → byName → inoutByName only if not in byName).
- Repro: FB `x : INT := 5`; METHOD M `VAR_IN_OUT x`; `x := x + 100`; `r := fb.M(x := v)` with v=1 → r=105, v=1.
- CODESYS: method declarations shadow members (`shadowing_method_param_shadows_member`,
  `shadowing_method_local_shadows_member` recordings). Expected r=101, v=101.
- Fix: in routine mode, the routine's own in-outs win before statics and byName.
- [x] 19.1 Record `method_inout_shadows_member` (+ VAR_STAT variant) — red.
  Recorded 2026-09-29 (record:exec): `tr_19_method_inout_shadows_member`, `tr_19_method_inout_shadows_var_stat` — diverge (CODESYS: res=v=101).
- [x] 19.2 Fix. `lowerPlace` (lower/places.ts): in routine mode the routine's own VAR_IN_OUT/VAR_OUTPUT (not the FB's `ofInstance` in-outs) resolves right after its locals, before VAR_STAT and fields; both fixtures match (res=v=101). Src test in lower.test.ts.

## 20. A routine's `name => target` output is lent `&mut` before the call, so its index is read too early
- Root cause: `lower/calls.ts:1045` (output bound via bindInOut as a hidden in-out); freeze loop `:1244` / `:1252`
  only looks at later-argument calls.
- Repro: METHOD M `k := k + 1; o := 5`; `b := fb1.M(o => arr[fb1.k])` → arr[0]=5; FUNCTION + GVL index likewise.
- CODESYS (LIVE): arr[0]=0, arr[1]=5, arr2[0]=0, arr2[1]=5 — outputs copied out after the call.
- Fix: copy routine outputs out after the invoke (temp in-out, then assign), as lowerCallStatement does for FB outputs.
- [x] 20.1 Record `callshape_output_index_moved_by_callee` — red.
  Recorded 2026-09-29 (record:exec): `tr_20_output_index_moved_by_callee` — diverges (CODESYS: arr[1]=arr2[1]=5). It also found an LSP false positive (`'o' is no output of 'F_CS_OUT20'`), now in `KNOWN_DIVERGENCES.codesys`, and a source-map defect (a METHOD's VAR_OUTPUT reset maps into the sibling FUNCTION's text; `RENAMED_TARGETS`).
- [x] 20.2 Fix. `lowerInvoke` binds a routine's `o => target` as a copy lent `&mut` and written back to the target after the call (`IrCopy.back`, which both backends already honour), so the index is read then; no freeze/`call-inout-order` for it. `tr_20_output_index_moved_by_callee` confirmed; src test in lower.test.ts (and the E0503 refusal of `res => numbers[cursor]` beside `io := cursor` is gone — nothing is borrowed now; it runs 7 into numbers[1]). Two NOTES re-keyed to the new construct lines. Still open: the LSP false positive (`KNOWN_DIVERGENCES.codesys`), the source-map defect (`RENAMED_TARGETS`), a target through a dereference (still lent), and a CONVERTING routine output (task 43's routine half: the write-back has no conversion, so the exact-type `call-output-type` stays).

## 21. A namespace-qualified FUNCTION is cached and scoped by its bare name
- Root cause: `lower/calls.ts:538` (routine key = `sym.name`, memoised by `once`, `:148-160`), `:542`
  (`findChildScope(lw.project, sym.name)` with no asker), and `:1004` (bare call takes the first symbol by URI,
  ignoring `symbols/precedence.ts`).
- Repro: project `F_Scale := x+1`, library `LSC.F_Scale := x*10+1000`; `a := LSC.F_Scale(2); b := F_Scale(2)` → order
  decides (a=b=1020 or a=b=3).
- CODESYS: a qualified call names the library element; unqualified project code resolves to the project element.
  Expected a=1020, b=3.
- Fix: key and scope FUNCTION routines by symbol identity; resolve bare calls with the asker's precedence.
- [x] 21.1 lower.test.ts case with a namespaced library — red.
  Recorded 2026-09-29 (record:exec): `tr_21_namespace_qualified_first`, `tr_21_namespace_bare_first` — diverge (the harness reaches StringUtils `Stu.`; no lower.test.ts fallback needed).
- [x] 21.2 Fix. `calledRoutine` keys a library FUNCTION `<library>.<name>` and scopes it by its own `defUri`; a bare call to a project-level FUNCTION picks with the asker's precedence (`pickForAsker`); both fixtures confirmed, src test in lower.test.ts. The harness's `withDependencies` no longer takes a name a referenced library declares from another fixture (tr_21 had moved its CharToUpper into `lib_stu_chars`, a program CODESYS never ran).

## 22. An instance's non-constant field initializers run AFTER its FB_Init
- Root cause: `lower/lower.ts:468` (FB_Init invokes pushed to `mine`) before `:521-531` (the `<FB>.__INIT` invokes).
- Repro: FB_I `m := 7; p := ADR(m)`, FB_Init `seen := p^` → null-deref panic at startup; `a := F_Inc(6)` with FB_Init
  `seen := a; a := 100` → seen=0, a=7.
- CODESYS: implicit initialization completes before FB_Init (`docs/codesys-reference/11-fb-lifecycle.md:23`;
  `fb_init_runs_with_declared_arguments`). Expected seen=7, a=100.
- Fix: emit the chain's __INIT before the FB_Init invokes; record or refuse the EXTENDS interleaving.
- [x] 22.1 Record fixtures: FB_Init reading an ADR(), call and THIS-initialized field — red.
  Recorded 2026-09-29 (record:exec): `tr_22_fb_init_reads_adr_field` (diverges, null deref), `tr_22_fb_init_reads_call_field` (diverges), `tr_22_fb_init_reads_this_field` (not-lowered, `place-not-local`). CODESYS: seen=7 in all three.
- [x] 22.2 Fix. `visit` (lower/lower.ts) emits an instance's `<FB>.__INIT` chain before its FB_Init invokes; a derived type's initializers below a base's FB_Init are refused (`fb-init-order`, unrecorded). `tr_22_fb_init_reads_adr_field` and `_call_field` confirmed; `_this_field` stays not-lowered (`place-not-local`, another gap). Src test in lower.test.ts.

## 23. An FB_Init argument read from a variable with a non-folding initializer passes 0
- Root cause: `lower/lower.ts:298` (recordedArgument never checks pendingInits) and `:566` (the whole init sequence
  runs after every FB_Init call).
- Repro: `x : INT := F_Inc(3); h : FB_A(v := x);` → h.got=0.
- CODESYS: initializers and FB_Init interleave in declaration order (`initseq_fb_init_declared_last`,
  `initseq_after_fb_init`). Expected 4.
- Fix: interleave initSequence and fbInitCalls by declaration position (also lifts `init-reads-instance`), or refuse.
- [ ] 23.1 Fixture `fb_init_argument_from_pending_init` — red.
  Recorded 2026-09-29 (record:exec): `tr_23_fb_init_argument_from_pending_init` (CODESYS got=4), `tr_23_fb_init_argument_from_pending_init_reversed` (got=0) — both not-lowered (`fb-init-argument`).
- [ ] 23.2 Fix.

## 24. A VAR_TEMP with a non-constant initializer is always reset to 0
- Root cause: `lower/storage.ts:243` (VAR_TEMP is deferrable → pendingInits, run once) with `:173-177` (tempResets
  writes the type default every run).
- Repro: `VAR_TEMP t : INT := g; END_VAR r := t;` with g=7 → r=0 every scan.
- CODESYS (LIVE): fbSeen1=7, fbSeen2=8, prgSeen1=7, prgSeen2=8 — evaluated on every call.
- Fix: re-emit the initializer expression in tempResets.
- [x] 24.1 Record `var_temp_dynamic_init` — red.
  Recorded 2026-09-29 (record:exec): `var_temp_dynamic_init` — diverges (CODESYS: seen 9 then 10, expr 21).
- [x] 24.2 Fix. A deferred VAR_TEMP initializer goes to `Lowering.tempInits`, not the run-once `pendingInits`; `tempResets` (lower/storage.ts) re-lowers it as its assignment on every run (`lowerPendingInit`), and refuses one reading a later VAR_TEMP (`init-reads-later`, unrecorded). Fixture confirmed (rust vendor), mark removed; src test in lower.test.ts.

## 25. Array elements ignore their element type's default (enum, alias with initializer, alias array)
- Root cause: `lower/storage.ts:204-217` (aliasInit / enumDefault only for the declared type, never an array element);
  surfaces at `ir/values.ts:455`, `emit/rust/emit.ts:105` / `:416` via `ir/ir.ts:55` defaultValueOf.
- Explains: groups array-element-type-default-ignored and qualified-type-qualifier-dropped (mislabelled representative).
- Repro: `TYPE E : (A:=3,B:=4)`, `TYPE MyInt : INT := 5`, `TYPE MyArr : ARRAY[0..1] OF INT := [8,9]` →
  `ARRAY OF E` = 0, `ARRAY OF MyInt` = 0, `ARRAY OF MyArr` = 0.
- CODESYS (LIVE): r_ea0=r_ea1=3, r_eb1=1, r_ma0=r_ma1=5, r_aa1_0=8, r_aa1_1=9, r_sz1=5; a PARTIAL initializer `[7]`
  leaves the tail at 0 (r_alias_part2=0), so today's tail behaviour is right.
- Fix: resolve the element default in lowering and carry it in IrInit; keep partial tails at the family zero.
- [ ] 25.1 Record `array_element_type_default` — red.
  Recorded 2026-09-29 (record:exec): `array_element_type_default` — diverges.
- [ ] 25.2 Fix.

## 26. SIZEOF of an FB counts VAR CONSTANT and ignores IMPLEMENTS
- Root cause: `lower/bytes.ts:94` (skip list ignores the section's `constant` flag) and `:64` (never reads
  `unit.implements`).
- CODESYS (LIVE): scalar VAR CONSTANT=16 (Volt 24), const_non_replaced=24, struct constant=32, IMPLEMENTS one=24
  (Volt 16), two=32 (Volt 16), baseline=16.
- Fix: skip replaced scalar constants; add 8 bytes per implemented interface; keep refusing what is not measured.
- [x] 26.1 Record `mem_fb_var_constant_*` and `mem_fb_implements_*` — red.
  Recorded 2026-09-29 (record:exec): `mem_fb_var_constant_scalar` (SIZEOF 16), `mem_fb_implements_one` (24), `mem_fb_implements_two` (32) — diverge; `mem_fb_var_constant_non_replaced` (24) and `mem_fb_var_constant_struct` (32) — confirmed.
- [x] 26.2 Fix. `fieldBytes` (lower/bytes.ts) skips a replaced elementary VAR CONSTANT (not `const_non_replaced`, not a STRUCT), starts an FB's fields 8 bytes further per IMPLEMENTS, and refuses a STRING/ARRAY constant and an interface in a packed FB (unmeasured); all five fixtures confirmed, marks removed; src test in lower.test.ts.

## 27. Every loop panics after 1,000,000 passes; the two backends also trip at different counts
- Root cause: `ir/ir.ts:33-37` (LOOP_ITERATION_CAP as semantics), `emit/rust/emit.ts:904-911` (increment + check
  before the head test), `interp/interp.ts:240-242` (`n > CAP` from 0: one more pass). `emit.test.ts:398-425` checks
  only the text.
- Explains: groups loop-iteration-cap-policy and loop-cap-off-by-one-between-backends.
- Repro: `FOR i := 1 TO 1000000` → interp 1000000, Rust panics; `TO 1000001` → both panic.
- CODESYS (LIVE): no cap, no watchdog trip: for_1000000 cnt=1000000, for_1000001 cnt=1000001, repeat_1000001
  cnt=1000001, while_5000000 cnt=5000000.
- Fix: remove the cap from emitted semantics (at most a harness-only guard behind a cfg/option); where a guard
  remains, both backends count one iteration = one body entry.
- [ ] 27.1 Boundary test running both backends at CAP and CAP+1 for FOR/WHILE/REPEAT; record `loop_cap_*` — red.
  Recorded 2026-09-29 (record:exec): `tr_27_loop_cap_for_1000000`, `tr_27_loop_cap_for_1000001`, `tr_27_loop_cap_repeat_1000001`, `tr_27_loop_cap_while_5000000` — all diverge (CODESYS runs every pass; the interpreter faults on for_1000001 and while_5000000, the Rust on for_1000000 and repeat_1000001).
- [ ] 27.2 Fix.

## Emit / interpreter layer

## 28. MAX/MIN/LIMIT on REAL/LREAL: neither backend matches CODESYS on NaN and signed zero
- Root cause: `emit/rust/emit.ts:714-724` (f32/f64 max/min drop NaN) vs `ir/evaluate.ts:38-47` (compare-select with
  mirrored operands).
- CODESYS (LIVE): MAX(a,b) = IF a>b THEN a ELSE b; MIN(a,b) = IF a<b THEN a ELSE b (both return the SECOND argument on
  a tie or NaN); LIMIT(mn,in,mx) = MIN(MAX(mn,in),mx). MAX(n,1)=1, MAX(1,n)=NaN, MIN(n,1)=1, MIN(1,n)=NaN,
  LIMIT(0,n,5)=5, LIMIT(n,1,5)=1, LIMIT(0,1,n)=NaN; MAX(-0,+0)=+0, MAX(+0,-0)=-0. LREAL 1.0/0.0 STOPS the runtime,
  so read results as bits.
- Fix: emit exactly `if a > b { a } else { b }` (and the MIN/LIMIT forms) for reals; make `pick` match.
- [ ] 28.1 Record `minmax_limit_nan_signed_zero` (bit readback) — red.
  Recorded 2026-09-29 (record:exec): `tr_28_minmax_limit_nan_signed_zero_lreal`, `tr_28_minmax_limit_nan_signed_zero_real` — not-lowered (`pointer-type`, the bit readback).
- [ ] 28.2 Fix both backends.

## 29. A user METHOD named Clone / To_Owned / Into / Try_Into is shadowed by a prelude trait method
- Root cause: `emit/rust/emit.ts:989` (baseFnName reserves only keywords + new/call/scan; structs derive Clone at
  `:1162/1182/1217`).
- Repro: `METHOD Clone : INT`; `r := b.Clone()` → E0308. Result-less `b.Clone();` compiles and silently runs the
  derived clone (interp r=100, Rust r=0).
- Fix: reserve clone, to_owned, into, try_into (or emit UFCS calls).
- [x] 29.1 Fixture per name, with and without a result — red.
  Recorded 2026-09-29 (record:exec): all eight `tr_29_method_named_{clone,to_owned,into,try_into}_{result,no_result}` — diverge (six do not compile; clone/to_owned without a result leave b.v=100 where CODESYS gives 0).
- [x] 29.2 Fix. `baseFnName` reserves clone/to_owned/clone_into/into/try_into (a `&self`/`self` trait method wins Rust's lookup over a `&mut self` METHOD); all eight fixtures confirmed; EQ/NE (derived PartialEq) are unreachable — standard function names.

## 30. A VAR_TEMP array/struct reset ignores its declared initializer
- Root cause: `emit/rust/emit.ts:570` (`case "fresh"` calls the free, init-blind `initOf` at `:101` instead of
  `this.initOf`).
- Repro: `VAR_TEMP arr : ARRAY[0..2] OF INT := [5,6,7]; s : ST_P := (a := 9)` → Rust 0/0, interpreter 6/9.
- CODESYS: VAR_TEMP resets to its declared value each call (`decl_temp_initialized`, `decl_temp_array_counts`).
- Fix: `return this.initOf(e.type, e.init)`.
- [x] 30.1 Fixtures `decl_temp_array_init_resets`, `decl_temp_struct_init_resets` — red.
  Recorded 2026-09-29 (record:exec): `decl_temp_array_init_resets`, `decl_temp_struct_init_resets` — diverge (the Rust resets to zero).
- [x] 30.2 Fix. `case "fresh"` prints `this.initOf(e.type, e.init)`; both fixtures confirmed (first=second=6; 9/9/4), divergence marks removed.

## 31. BIT conversions dispatch on family "bitstring" while the Rust type is bool
- Root cause: `emit/rust/emit.ts:655` (`from`/`to` from `elem.family`), hitting `:675`, `:689`, `:690`.
- Repro: `TO_STRING(s.b0)` → "true"; `BIT_TO_REAL`, `TO_LREAL(bit)`, `INT_TO_BIT` → E0606/E0054.
- CODESYS: BIT reads as BOOL (`type_dut_struct_with_bit_fields`, `ct_bit_fields`); `xf_bool_to_string` = 'TRUE'.
- Fix: decide bool-ness by `isBit(t) || family === "bool"` in one place.
- [x] 31.1 Fixture converting a BIT field through each conversion — red.
  Recorded 2026-09-29 (record:exec): `tr_31_bit_conversions` — diverges; the emitted Rust does not compile. CODESYS accepts `INT_TO_BIT` (2 -> TRUE).
- [x] 31.2 Fix. `emittedFamily` (emit/rust/emit.ts) is the one place a BIT becomes "bool"; `rustType` and `convert` both ask it — fixture confirmed ('TRUE', 1.0, INT_TO_BIT(2)=TRUE), divergence mark removed.

## 32. LTIME_TO_STRING casts the u64 LTIME to i64
- Root cause: `emit/rust/emit.ts:678` (`castTo(value, type, "i64")`) and `emit/rust/prelude.ts:108`
  (`iec_ltime_text(ns: i64)`).
- Repro: LTIME#106752d → Rust 'LTIME#-106751d-23h-…'; interpreter correct.
- CODESYS: LTIME is unsigned 64-bit ns up to LTIME#213503d23h34m33s709ms551us615ns.
- Fix: `iec_ltime_text(ns: u64)`, no cast.
- [x] 32.1 Extend `fmt_ltime_every_component` with values ≥ 2^63 ns — red.
  Recorded 2026-09-29 (record:exec): `tr_32_fmt_ltime_past_i64` — diverges (the Rust prints a negative duration).
- [x] 32.2 Fix. `iec_ltime_text(ns: u64)` and the emitter passes an LTIME uncast (`castTo(..., "u64")`) — fixture confirmed through the maximum LTIME, divergence mark removed; the shapes9_1 note re-keyed to the uncast construct.

## 33. LREAL_TO_STRING rounds an exact 16th-digit tie to even in Rust
- Root cause: `emit/rust/prelude.ts:88` (`format!("{:.*e}", 14, …)` rounds half-even) vs `ir/values.ts:344`
  (`toExponential(14)`, half-up).
- CODESYS (LIVE): half-up — 1234567890123445 → '1.23456789012345e15', 1000000000000005 → '1.00000000000001e15',
  2500000000000005 → '2.50000000000001e15'; non-tie controls match both rules.
- Fix: in the prelude, take 17 exact digits and round half-up.
- [x] 33.1 Record `fmt_lreal_tie_*` (7 cells) — red.
  Recorded 2026-09-29 (record:exec): `tr_33_fmt_lreal_tie` — diverges (CODESYS rounds the tie up: `1.00000000000001e15`).
- [x] 33.2 Fix Rust. `iec_lreal_text` takes the EXACT expansion (`{:.800e}`) and rounds half-up on its 16th digit (17 digits could carry a sub-half into a tie) — all 7 recorded cells match, divergence mark removed.

## 34. A string's bytes past its terminator are thrown away
- Root cause: `emit/rust/prelude.ts:44` (store past len dropped), `:48` (0 store truncates and forgets), `:26`
  (`to()` rebuilds through `lit`, zeroing the tail); mirrored at `ir/values.ts:101-102`.
- Repro: right-to-left digit fill `s[4] := 0; s[3..0] := digits` → "4"; `t[2] := 0; t[2] := 88` on 'abcdef' → "abX";
  via POINTER TO BYTE `p[4] := 67; p[3] := 66` on 'abc' → 'abcB'.
- CODESYS: STRING(n) is n+1 bytes, `s[i]` is a byte access (`lib_prim_char_past_length`). Expected '4321', 'abXdef',
  'abcBC'. (Task 45's LIVE run shows assignment copies bytes past a NUL, uc3=99.)
- Fix: hold the full n+1 buffer; len = first 0; a store at or past len re-scans; `.to()` keeps units when N == M.
- [ ] 34.1 Record the `lib_prim_char_behind` extension — red.
  Recorded 2026-09-29 (record:exec): `tr_34_lib_prim_char_behind` — not-lowered (`pointer-type`). CODESYS: u='abcBC', lenU=5.
- [ ] 34.2 Fix both backends.

---

# MEDIUM

## 35. FOR constant step is not wrapped to the counter type
- Root cause: `lower/statements.ts:308` (folded step const typed `control.type` without wrapping) and `:326-331`
  (direction from the signed fold; runtime step assumes unsigned counts up).
- Repro: `b : BYTE; FOR b := 5 TO 1 BY -1` → `wrapping_add(-1u8)` E0600; `s : SINT … BY 300` → overflowing literal.
- CODESYS (LIVE): BY -1 on BYTE: n=5, b=0; BY -2 on UINT: n=5, u=0; BY 255 on BYTE: 0 passes; `BY st` with INT st on a
  BYTE counter and `BY 300` on SINT are BUILD ERRORS ("Cannot convert type 'INT' to type 'BYTE'/'SINT'").
- Fix: wrap the folded step to the counter width (`wrapping_add(255u8)`), keep the direction from the signed literal;
  refuse a runtime step or folded step whose type does not convert.
- [x] 35.1 Record `for_unsigned_negative_step` (split per loop) — red.
  Recorded 2026-09-29 (record:exec): `tr_35_for_byte_step_minus_one`, `tr_35_for_uint_step_minus_two` — diverge (the Rust does not compile); `tr_35_for_byte_step_255` — confirmed; `tr_35_for_byte_runtime_int_step`, `tr_35_for_sint_step_300` — refused by CODESYS, lsp-gap (`MEASURED_SILENT`).
- [x] 35.2 Fix. `lowerFor` (lower/statements.ts) holds a folded step at the counter width (`stored`: BY -1 on a BYTE adds 255) with the direction from the signed fold, and refuses `for-step-type` (invalid) for a folded step the counter cannot hold (a negative one on an unsigned counter excepted) or a variable step whose type does not convert; both diverging fixtures confirmed (rust vendor), marks removed; src test in lower.test.ts.

## 36. FOR literal limit is narrowed into the counter type
- Root cause: `lower/statements.ts:294` (`lowerExpr(lw, s.to, control.type)`) with `lower/constants.ts:324`.
- Repro: `small : SINT; FOR small := 1 TO 200` → `self.small > -56i8`, 0 passes; `TO (100+100)` runs.
- CODESYS: `cc6_loop_cannot_exit` never finished (commit 84100e3ff7) — the compare is against 200.
- Fix: lower the limit without the counter as expected type (needs task 13 first).
- [x] 36.1 Recordable variant with an EXIT guard (expected n=300, small=44) — red.
  Recorded 2026-09-29 (record:exec): `tr_36_for_literal_limit_beyond_counter` — diverges (CODESYS: n=n2=300, small=44).
- [x] 36.2 Fix. `lowerFor` lowers the limit with no expected type and passes it through `beside`: a literal the counter cannot hold meets it wider instead of narrowing (200 on a SINT stays 200). Fixture confirmed, mark removed; src test in lower.test.ts.

## 37. CASE labels outside the selector type, or inverted ranges, reach the emitter verbatim
- Root cause: `lower/statements.ts:209-217` (no range or lo≤hi check); printed at `emit/rust/emit.ts:878-881`.
- CODESYS (LIVE): out-of-type labels compile (warning) and compare BY VALUE — never match (r1=2, r2=2); an inverted
  range `5..1` and `0..200` on SINT are BUILD ERRORS ("Lower border must be lower than upper border").
- Fix: drop out-of-type labels at lowering (never match); bail on inverted / out-of-type ranges. Add the LSP check.
- [x] 37.1 Record the four `case_label_*` / `case_range_*` fixtures — red.
  Recorded 2026-09-29 (record:exec): `tr_37_case_label_wraps_300`, `tr_37_case_label_wraps_minus_212` ("Cannot convert type 'INT' to type 'SINT'"), `tr_37_case_range_inverted`, `tr_37_case_range_beyond_type` ("Lower border must be lower than upper border") — ALL refused by CODESYS; the wrapped-label premise is contradicted. lsp-gap (`MEASURED_SILENT`).
- [x] 37.2 Fix. Lowering refuses `case-label-type` (invalid) for a label outside the selector's type or a range inverted in it; the LSP `case-labels` check reports "Cannot convert type 'INT' to type 'SINT'" for an out-of-type literal label and "Lower border must be lower than upper border" for a range inverted once read in the selector's type. All four rated refused, out of MEASURED_SILENT; src tests in lower.test.ts and case-labels.test.ts; corpus gate green.

## 38. Implicit string-kind conversions CODESYS refuses are lowered
- Root cause: `lower/statements.ts:107-111` (refuseImplicitString only refuses STRING→non-string), `:93` (chain link
  converts with no refusal), `lower/expressions.ts:214` (a string compare only checks ANY_STRING).
- Explains: groups implicit-string-wstring-accepted and refused-real-to-string-lowered; `uop_neg_real` interp/Rust
  disagreement ('0' vs '-0', 'Infinity' vs 'inf'); 350 refused map rows carrying a tier.
- CODESYS: `string_wstring_mixing` ("Cannot convert type 'STRING' to type 'WSTRING'", "Cannot compare…"), `uop_*`
  ("Cannot convert type 'REAL' to type 'STRING'") in codesys.run.json / codesys.build.json.
- Fix: refuse implicit STRING↔WSTRING stores/arguments/chains/compares and any implicit non-string → STRING;
  explicit X_TO_Y stays legal. Refused rows lose tier/rust.
- [ ] 38.1 src tests from the recorded fixtures — red.
- [ ] 38.2 Fix; regenerate map.

## 39. EXIT/CONTINUE outside a loop lowers with no diagnostic
- Root cause: `lower/statements.ts:243-246`.
- Repro: `cc2_exit_outside_loop` → Rust E0268, interpreter "stops the body".
- CODESYS: "No enclosing loop of which to exit" (`codesys.build.json:474`).
- Fix: track loop depth; bail at depth 0.
- [x] 39.1 src test — red (lower.test.ts: EXIT/CONTINUE at top level, in an IF, after a loop lowered clean).
- [x] 39.2 Fix. `Lowering.loops` counts enclosing loop bodies (`loopBody` in lower/statements.ts); EXIT/CONTINUE at 0 bails `exit-outside-loop` (invalid) — `cc2_exit_outside_loop` no longer emits E0268 Rust (map row: refused, no rust).

## 40. DATE/DT/TOD ± LTIME is accepted (and narrows the duration to 32 bits)
- Root cause: `lower/expressions.ts:342` (convert before scale); `src/types/arith.ts:142/145` accepts the pair.
- CODESYS (LIVE): every form REFUSED ("Cannot convert type 'LTIME' to type 'ULINT'" …).
- Fix: refuse the pair in lowering (and the type layer); record as `rejects`.
- [x] 40.1 Fixture `date_plus_ltime_rejected` — red.
  Recorded 2026-09-29 (record:exec): `tr_40_date_plus_ltime`, `tr_40_dt_plus_ltime`, `tr_40_tod_minus_ltime`, `tr_40_ltime_plus_date` — refused by CODESYS ("Cannot convert type 'LTIME' to type 'ULINT'"), lsp-gap (`MEASURED_SILENT`).
- [x] 40.2 Fix. `arith.ts` `narrowDateWideDuration`: a 32-bit date beside an LTIME is no temporal pair; lowering refuses it `calendar-width` (invalid) and the LSP's binary-operator check reports "Cannot convert type 'LTIME' to type 'ULINT'". All four `tr_40_*` rated refused, out of MEASURED_SILENT; src tests in arith, binary-operators and lower tests; fixtures.test.ts green.

## 41. MUX is lazy in Rust but eager in the interpreter; LIMIT evaluates IN before MN
- Root cause: `emit/rust/emit.ts:745-749` (MUX `match`), `:724` (`IN.max(MN).min(MX)`); IR contract `ir/ir.ts:255-268`
  (stale premise that calls in expressions are refused).
- Repro: `MUX(0, Inc(a), Inc(b))` → interp both bumped, Rust one; `LIMIT(Add1(x), Dbl(x), 1000)` → x=2 vs x=1.
- CODESYS: unrecorded (help text says SEL/MUX evaluate only the selected input).
- Fix: record SEL/MUX/LIMIT with side-effecting arguments; make the IR contract and both backends follow it.
- [ ] 41.1 Record `sel_mux_limit_side_effects` — red.
  Recorded 2026-09-29 (record:exec): `tr_41_mux_side_effects`, `tr_41_sel_side_effects`, `tr_41_limit_evaluation_order` — diverge. CODESYS: MUX and SEL run only the selected input; LIMIT leaves x=4.
- [ ] 41.2 Fix.

## 42. ANY variant key collapses array types
- Root cause: `lower/calls.ts:362` (typeKey returns bare `t.kind` for arrays), used at `:535` and memoised at `:539`.
- Repro: one ANY FUNCTION called with ARRAY[0..3] OF INT and ARRAY[0..9] OF BYTE → Rust E0308; interp 8/10.
- Fix: key arrays by element + bounds (recursively). Enums/pointers were refuted.
- [x] 42.1 Fixture — red.
  Recorded 2026-09-29 (record:exec): `tr_42_any_array_variant_key` — diverges; the emitted Rust does not compile (E0308).
- [x] 42.2 Fix. `typeKey` (lower/calls.ts) keys an array as `ARRAY[lo:hi,...] OF <element key>`, recursively (no `.`: the emitter slices a routine name at the last one); fixture confirmed (rust vendor, 8/10/16/12/8), mark removed; src test in calls.test.ts.

## 43. Output bindings are type-checked by family, not by the assignment relation
- Root cause: `lower/calls.ts:1541-1544` (FB path, family compare) and `:1047` (routine path, exact name and length).
- Repro: `fb1(w => a, i => r)` WORD→UDINT, INT→REAL refused; DINT output into INT accepted and truncates.
- CODESYS: an output binding converts like assignment (`accepts_output_into_other_type`,
  `conversion_implicit_dint_to_int`).
- Fix: `isAssignable(target.type, field.type)` (types/compat.ts) on both paths.
- [x] 43.1 Fixtures WORD=>INT, WORD=>UDINT, INT=>REAL (run), DINT=>INT (rejected) — red.
  Recorded 2026-09-29 (record:exec): `tr_43_output_word_to_int` (a=-1), `tr_43_output_word_to_udint` (ud=65535), `tr_43_output_int_to_real` (res=-3.0) — not-lowered (`call-output-type`); `tr_43_output_dint_to_int` — refused by CODESYS and the LSP.
- [x] 43.2 Fix. FB path: `lowerCallStatement` checks an output binding with `isAssignable(target, field)` and converts; the three runnable `tr_43_*` now confirmed, DINT=>INT refused `call-output-type`; src test in lower.test.ts. The ROUTINE path still lends the target `&mut` (exact type only) — a converting binding needs the output copied out after the call, which is task 20.

## 44. A pointer stepped one element below its array's first element becomes NULL
- Root cause: `lower/pointers.ts:151-152` (backwards step with no floor) on the tag encoding `:87-88` (element k =
  tag k+1) whose contract is `lower/lowering.ts:126-129` (0 = NULL).
- Repro: `p := ADR(arr[0]); p := p - SIZEOF(INT); isNull := p = 0` → TRUE.
- CODESYS: a pointer is a byte address; ADR(arr[0]) - 2 is non-zero.
- Fix: bias array-element tags so no in-range step reaches 0.
- [ ] 44.1 Fixture — red.
  Recorded 2026-09-29 (record:exec): `tr_44_pointer_step_below_first_element` — not-lowered (`pointer-step`). CODESYS: back=backTwo=11, isNull=FALSE.
- [ ] 44.2 Fix.

## 45. A STRING literal with an embedded $00 keeps the characters after it
- Root cause: `src/syntax/literal-value.ts:50` (decodes $00 to a real NUL), `lower/constants.ts:147` (passes it),
  `emit/rust/prelude.ts:24` (`lit` len = text length), `ir/values.ts:271` (`fit` slices to capacity only).
- CODESYS (LIVE): compiles (STRING(3) initializer only warns); eqAb=TRUE, eqFull=TRUE, lenS=2, c2=0, c3=99,
  lenU=2, uc3=99 (assignment copies the bytes behind the NUL), weqAb=TRUE, cat='abX', lenS3=2.
- Fix: len = position of the first 0 unit, but keep the bytes behind it (ties into task 34).
- [ ] 45.1 Record `string_embedded_nul` — red.
  Recorded 2026-09-29 (record:exec): `tr_45_string_embedded_nul` — diverges (CODESYS: LEN 2, bytes behind the NUL are 0).
- [ ] 45.2 Fix.

## 46. EXPT: the interpreter's Math.pow disagrees with pow semantics; EXPT(0, negative) stops CODESYS
- Root cause: `ir/evaluate.ts:88-90` (`Math.pow`) vs `emit/rust/emit.ts:751-752` (`powf`); no domain guard like
  `iec_log`; `test/conformance/fixtures/operators/math-domain.ts` omits EXPT.
- CODESYS (LIVE): EXPT(1,NaN)=1, EXPT(-1,±inf)=1, EXPT(NaN,0)=1, REAL EXPT(1,NaN)=1 (Rust right, interpreter wrong);
  1e19**8 = 1E+152 exactly; EXPT(0,-1) and EXPT(0,-0.5) STOP; EXPT(0,-inf) = +inf with no stop.
- Fix: interpreter uses a correctly rounded C-semantics pow; both backends stop on 0 ** finite-negative.
- [x] 46.1 Record `exptdom_*` (one fixture per case) — red.
  Recorded 2026-09-29 (record:exec): `tr_46_exptdom_one_pow_nan`, `tr_46_exptdom_minus_one_pow_inf`, `tr_46_exptdom_minus_one_pow_minus_inf`, `tr_46_exptdom_real_one_pow_nan`, `tr_46_exptdom_1e19_pow_8` — diverge; `tr_46_exptdom_zero_pow_minus_one`, `tr_46_exptdom_zero_pow_minus_half` — CODESYS stops (timed out), both backends finish: diverge; `tr_46_exptdom_nan_pow_zero`, `tr_46_exptdom_zero_pow_minus_inf` — confirmed.
- [x] 46.2 Fix. `values.ts` `expt`: C's pow special cases, integer exponents correctly rounded (BigInt bracket, Ziv), 0 ** finite-negative stops; Rust emits `iec_pow` (same guard); all nine fixtures confirmed, src tests `ir/values.test.ts` + `emit.test.ts`.

## 47. LINT/ULINT/LWORD → REAL is rounded twice in the interpreter
- Root cause: `ir/values.ts:398` (`Number(n)` then `fit`'s `Math.fround` at `:292`).
- CODESYS (LIVE): single rounding — 2^60+2^36+1 → 1152921642045800448 (Rust `as f32` right; interpreter gives 2^60).
- Fix: round the bigint straight to 24 significant bits with a sticky bit when the target is 32-bit.
- [x] 47.1 Record `i2r_lint_to_real_double_round` — red.
  Recorded 2026-09-29 (record:exec): `tr_47_i2r_lint_to_real_double_round` — diverges (CODESYS: 1.15292164E+18).
- [x] 47.2 Fix. `coerce` rounds a bigint straight to 24 bits (half-even) for a 32-bit REAL target (`toSingle`); fixture now confirmed, src test `ir/values.test.ts`.

---

# LOW

## 48. The "vendor" oracle is granted to recordings whose inputs are all defaults
- Root cause: `test/conformance/support/transpile-confidence.ts:130` (any recording with values → `vendor`); inputs
  from `test/conformance/fixtures/batches/check-coverage.ts:63-88`.
- Evidence: 158 of 1950 `vendor` rows record only defaults (36 cc_ rows). No wrong value found — the model is pinned by
  arithmetic_width, signed_unsigned_comparison, max_signed_unsigned, bitwise_on_narrow_types.
- Fix: give the cc_ run fixtures discriminating initializers and re-record, or rate all-default recordings
  `compiles` (exempting prim_default_*).
- [ ] 48.1 Fix the rating or the inputs; regenerate map.
