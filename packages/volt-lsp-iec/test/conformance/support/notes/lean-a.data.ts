/**
 * the review's lean items (`lean.data.ts`) — part A.
 *
 * One slice of `lean.data.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a test support
 * file is held to 400 lines).
 */
export const LEAN_A = {
shapes10_1: {
    improvement: "When the divisor is a nonzero constant other than -1 (every date conversion: 86400, 86400000, 86400000000000), the zero guard and the let-block are dead code. Emit `l % K` directly.",
    alternatives: [
      "today: the guarded let-block for every integer MOD",
      "a const nonzero divisor (other than -1) emits plain `%`. Chosen: this is exact and it is what a Rust engineer writes",
    ],
    chosen: "a const nonzero divisor (other than -1) emits plain `%`",
    why: "this is exact and it is what a Rust engineer writes",
  },
  shapes10_2: {
    improvement: "Keep the whole days as `count / day * day` instead of `count - count MOD day`. This also fixes the double-evaluation finding: one read, no MOD, no wrapping_sub (which can never underflow here anyway).",
    alternatives: [
      "today: count.wrapping_sub(count MOD day), which evaluates count twice",
      "count / day * day. Chosen: single evaluation, shortest, the same value for unsigned ticks",
      "a let-bound temporary. Correct, but longer",
    ],
    chosen: "count / day * day",
    why: "single evaluation, shortest, the same value for unsigned ticks",
  },
  shapes10_3: {
    improvement: "MOD on SINT/INT/USINT/UINT/BYTE/WORD widens both operands to i32 and narrows the result. Remainder never overflows except MIN % -1, and wrapping_rem at native width already gives 0 there, so computing at native width gives identical results.",
    alternatives: [
      "today: widen to i32, wrapping_rem, then cast back",
      "native width `if r == 0 { 0 } else { l.wrapping_rem(r) }` with no casts. Chosen: identical values for every input",
    ],
    chosen: "native width `if r == 0 { 0 } else { l.wrapping_rem(r) }` with no casts",
    why: "identical values for every input",
  },
  shapes10_4: {
    improvement: "SEL's integer literal arms are typed i64, or its INT arms widened to i32, then the whole `if` is cast back to the target. Literals can be typed at the destination (`20i16`) and INT arms left unwidened. (SEL prints a plain `if` now — only the selected arm is evaluated, as CODESYS does, transpile-review-2026-09-29 task 41.)",
  },
  shapes10_5: {
    improvement: "`.to()` re-copies the string even when the value is already `IecString::<N>` of the target's own capacity (for example `IecString::<80>::lit(...).to()` into an IecString<80>). Emit it only when the capacities differ or the target's capacity is generic (VAR_IN_OUT).",
    alternatives: [
      "today: `.to()` on every string store",
      "`.to()` only when the capacities differ or are generic. Chosen: the other stores need no copy because IecStr is Copy",
    ],
    chosen: "`.to()` only when the capacities differ or are generic",
    why: "the other stores need no copy because IecStr is Copy",
  },
  shapes10_6: {
    improvement: "For a head-tested loop with no step (WHILE), a `continue 'loop_N;` is exact, because Rust's continue returns to the head test. The labeled body block is only needed for FOR (step after the body) and REPEAT (UNTIL at the tail).",
    alternatives: [
      "today: a labeled body block plus `break 'body_N` for every loop kind",
      "WHILE uses `continue 'loop_N`, FOR and REPEAT keep the block. Chosen: shorter, and the construct a Rust engineer expects; the block stays where it is semantically needed",
    ],
    chosen: "WHILE uses `continue 'loop_N`, FOR and REPEAT keep the block",
    why: "shorter, and the construct a Rust engineer expects; the block stays where it is semantically needed",
  },
  shapes10_7: {
    improvement: "TRUNC of a constant argument still emits the run-time range check (`(-3.7f64).trunc()` with a contains check). Fold it at emit time to the i32 literal.",
    alternatives: [
      "today: the run-time check",
      "fold when args[0] is const. Chosen for constants only. The f64 widening of a REAL argument is NOT removable: 2147483647.0f32 rounds to 2^31, so the range check must stay in f64",
    ],
    chosen: "fold when args[0] is const",
    why: "The f64 widening of a REAL argument is NOT removable: 2147483647.0f32 rounds to 2^31, so the range check must stay in f64",
  },
  shapes5_1: {
    improvement: "f64::round already rounds half away from zero and is odd-symmetric: round(-2.5) = -3, round(-0.0) = -0.0, round(NaN) = NaN. So the sign branch is the identity. Emit `let c = v.round();`. The 32-bit helper can also fold to `if c.is_nan() || c >= 9223372036854775808.0 { 0 } else if c < -2147483648.0 { i32::MIN } else { c as i64 as i32 }`.",
  },
  shapes5_3: {
    improvement: "An all-constant integer expression is already folded at full width in lowering (expressions.ts:241-247), but the node is kept and printed. Emit the folded literal. Constant-folding in lowering is fine; CODESYS folding it too does not matter for a value.",
    alternatives: [
      "emit the folded literal (preferred)",
      "keep `0i64.wrapping_sub(1i64)` (today): rustc folds it anyway, so this is readability only",
    ],
    chosen: "emit the folded literal",
  },
  shapes5_4: {
    improvement: "When the divisor is a nonzero literal the zero check cannot fire. Print plain `a / 3.0f64` and emit the iec_div helper only when a divisor can be zero.",
  },
  shapes5_5: {
    improvement: "If the divisor is a literal other than 0 (and other than -1 for signed), emit `l % r` directly. The block, the zero test and wrapping_rem are dead code for a literal divisor.",
  },
  shapes5_6: {
    improvement: "Widening both sides of a compare cannot change the answer, so when both operands share signedness and the literal fits the narrow type, compare in the operand's own type: `self.n == 2`. This removes the cast_lossless lints (4 per fixture here).",
    alternatives: [
      "compare in the narrow type when the literal fits (preferred: what a Rust engineer writes)",
      "keep the promoted compare (today): always correct, including for an out-of-range literal, which is why it is promoted",
    ],
    chosen: "compare in the narrow type when the literal fits",
    why: "what a Rust engineer writes",
  },
  shapes5_7: {
    improvement: "Outside routine mode, the chain temporary becomes a public field of the POU struct. It persists across scans, appears in Debug/PartialEq, and triggers clippy::pub_underscore_fields. Make it a local `let`, or skip the temp entirely when the value is a plain load of a place no target in the chain writes.",
    alternatives: [
      "a scan-local `let __chain_value = ...;` (preferred)",
      "no temp when the value is a side-effect-free load: `self.y = self.z; self.x = self.y;`",
      "struct field (today)",
    ],
    chosen: "a scan-local `let __chain_value = ...;`",
  },
  shapes5_8: {
    improvement: "The assignment always adds `.to()`, even when the value is already a fresh IecString of the target's capacity, so each assignment copies 2-3 times. Skip the outer `.to()` when the value's type capacity equals the target's. Build a literal or format! result directly at the target capacity: `IecString::<12>::lit(...)`.",
  },
  shapes5_9: {
    improvement: "A lossless widening followed by a conversion back to the source's own Rust type is the identity. Peephole: if e.value is a convert from type X with rustType(X) === target and the middle step is a widening, emit X's text.",
  },
  shapes5_10: {
    improvement: "Several spellings are correct.",
    alternatives: [
      "`f32::from(u8::from(self.v))`: lossless and lint-free (my choice)",
      "`if self.v { 1.0 } else { 0.0 }`",
      "`(self.v as u8) as f32` (today): correct, but flags cast_lossless",
    ],
    chosen: "`f32::from(u8::from(self.v))`: lossless and lint-free",
  },
  shapes5_11: {
    improvement: "For SQRT only, f32::sqrt is correctly rounded, and f64 sqrt followed by narrowing is provably the same (53 >= 2*24+2). So a REAL SQRT can be `x.sqrt()` in f32. Keep the f64 detour for the other transcendentals, where it is load-bearing.",
  },
  shapes5_12: {
    improvement: "Unary `!` binds tighter than every binary operator, so the parentheses are always redundant: emit `!x` and let the binary printer add parentheses only where needed. The `&`/`|` for eager AND/OR are deliberate and stay.",
  },
  shapes5_14: {
    improvement: "Lowering already knows these are compile-time constants: 7/2 is folded at LINT width by the measured rule. Emit the folded, converted literal (`3.0f32`; `0.3f64 as f32` becomes its f32 literal). The value must be folded exactly as the vendor does, since `x : REAL := 7 / 2` is 3.",
  },
  shapes4_1: {
    improvement: "A struct-literal initializer repeats the type suffix even though the field's declared type already fixes it (`l25: 2.5f64`, `next_day: 0u32`, `di: 0i32`). The suffix is needed only where the literal is a method receiver or an untyped operand (`100i64.wrapping_add(...)`).",
    alternatives: [
      "(A) EMITTED TODAY: always suffix (`2.5f64`, `0u32`). One spelling everywhere, and it is safe in receiver position, which the negative-literal parenthesization comment depends on.",
      "(B) Drop the suffix in pure initializer / assignment-RHS positions where the target type is annotated (`l25: 2.5`, `next_day: 0`). This is what a hand-written struct init looks like.",
      "Choice: keep (A). The saving is cosmetic, and one uniform spelling from literal() is exactly what keeps receiver positions correct. A context flag would add a second path.",
    ],
    chosen: "keep (A). The saving is cosmetic, and one uniform spelling from literal() is exactly what keeps receiver positions correct. A context flag would add a second path.",
  },
  shapes4_2: {
    improvement: "Large integer initializers such as DATE/DT seconds and TIME ms (`d28: 1709078400u32`, `one_day: 86400000u32`) trip clippy::unreadable_literal (1-2 per fixture across date_plus_time, date_width_wrap, dt_minus_time, constant_arithmetic_width, signed_overflow). Grouping the digits (`1_709_078_400u32`) removes that lint class.",
    alternatives: [
      "(A) EMITTED TODAY: plain digits `1709078400u32`.",
      "(B) `1_709_078_400u32` for literals of 6 or more digits: a one-line regex in literal().",
      "(C) For DATE/TIME, a named constructor or comment (`/* D#2024-02-28 */`). More readable, but more machinery.",
      "Choice: (B). It is trivial and lint-clean, and the value is unchanged.",
    ],
    chosen: "(B). It is trivial and lint-clean, and the value is unchanged.",
  },
  shapes4_3: {
    improvement: "The f32 overflow test (`!isFinite(Math.fround(v))`) already rounds to f32, but the printed text still uses the unrounded v. Printing the rounded value's shortest round-tripping decimal is both the correctness fix for the midpoint finding and leaner: one rounding decision instead of two (JS for the infinity check, rustc for the digits).",
    alternatives: [
      "(A) EMITTED TODAY: `${v}f32`, so rustc rounds the float64's decimal. Wrong on midpoints.",
      "(B) `(${v}f64 as f32)`. Exact, but adds a cast on every REAL literal and a clippy cast lint.",
      "(C) The shortest decimal d with Math.fround(+d) === Math.fround(v), suffixed f32. Exact and short.",
      "Choice: (C).",
    ],
    chosen: "(C).",
  },
  shapes6_1: {
    improvement: "A field initializer in `Self { .. }` has a declared type, so the literal suffix is redundant there. `li: 0i64,` could be `li: 0,` and `v: 305419896u32,` could be `v: 305419896,`. The suffix is needed only where the literal is a method receiver (`100i64.wrapping_add(..)`). Also, pointer/reference slots already print bare `ref_: 0,` because their type is not elementary, so today the same construct comes out two ways within one struct.",
    alternatives: [
      "`x: 0i64,` (emitted today): literal() always appends rustType(t)",
      "`x: 0,` / `x: 0.0,`: rely on the field type. This is what I would choose: pass a 'typed position' flag from initOf to literal() and drop the suffix there, keeping it everywhere a literal can be a receiver",
      "`..Default::default()` for all-zero fields: shorter, but hides the declared values and needs Default for arrays over 32 elements, which the file comment rejects",
    ],
    chosen: "`x: 0,` / `x: 0.0,`: rely on the field type. This is what I would choose: pass a 'typed position' flag from initOf to literal() and drop the suffix there, keeping it everywhere a literal can be a receiver",
  },
  shapes6_2: {
    improvement: "A reference bound at its declaration to a variable of the same instance always gets the constant tag 1 (`ref_: 0` in new(), then `self.ref_ = 1;` in init()). The tag does not depend on init order: refdecl_target_after reads an address, not a value. Folding it into new() as `ref_: 1,` removes the init()/__init() method and its call chain (`self.inst.__init()` in the parent) for every refdecl_* fixture.",
  },
  shapes6_3: {
    improvement: "When a reference is bound unconditionally at its declaration and has a single target (lw.boundPointers already records unconditional binds), the `iec_deref(self.ref_)` null check can never fire. `{ iec_deref(self.ref_); self.v }` could be `self.v`. That also drops the `fn iec_deref` prelude when nothing else uses it.",
  },
  shapes6_4: {
    improvement: "Every struct gets `pub fn new()` plus a hand-written `impl Default { fn default() -> Self { Self::new() } }` (5 lines each). Clippy's `new_without_default` is the only reason for the impl. Where every initializer is its type's zero and no array exceeds 32 elements, `#[derive(Default)]` alone would do. Otherwise, keeping `new` and dropping Default (with an allow) is shorter.",
    alternatives: [
      "new() + manual impl Default calling new (emitted today, uniform, satisfies clippy::new_without_default)",
      "#[derive(Default)] when all initializers are zero-valued and no array exceeds 32 elements: shortest, but gives two code paths",
      "only new() plus #[allow(clippy::new_without_default)]: one line instead of five. I would choose this; the uniform shape is kept",
    ],
    chosen: "only new() plus #[allow(clippy::new_without_default)]: one line instead of five. I would choose this; the uniform shape is kept",
  },
  shapes4_4: {
    improvement: "`let c = if v < 0.0 { -((-v).round()) } else { v.round() };` does the same as `let c = v.round();`. f64::round already rounds half away from zero on both signs, and -0.0 stays -0.0. Emitted in every one of 182+57 fixtures that use the helpers.",
  },
  shapes4_5: {
    improvement: "`if c.is_nan() { return 0; }` and `if c >= 9223372036854775808.0 { return 0; }` return the same value and can be one test: `if c.is_nan() || c >= 9223372036854775808.0 { return 0; }`. Better still, write the whole helper as one match on ranges, like iec_r2i64 already folds NaN into its range test.",
    alternatives: [
      "today: separate NaN / below-min / above-2^63 early returns, then (c as i64) as i32",
      "merge NaN and >= 2^63 into one `return 0` (preferred: same table, one line fewer, reads like the r2i64 twin)",
    ],
    chosen: "merge NaN and >= 2^63 into one `return 0`",
    why: "same table, one line fewer, reads like the r2i64 twin",
  },
  shapes4_6: {
    improvement: "In a PROGRAM or FB body, the temp for a chain `x := y := z` is a persistent **pub struct field**: it appears in new(), in PartialEq and Debug, and in the public API. It is scratch storage that lives only for one statement. Emit it as a `let` local in scan()/call(), which routine mode already does. When the value is a plain load or a constant, drop the temp: `self.y = self.z; self.x = self.y;`, where the conversion already goes through y's type.",
    alternatives: [
      "today: temp as struct field (__chain_value_N) in body mode, local in routine mode",
      "a `let __chain_value_N = …;` local in every mode (preferred: one rule, no state leaked into the instance)",
      "no temp at all when the value is side-effect-free (a load/const), reading the previous link instead",
    ],
    chosen: "a `let __chain_value_N = …;` local in every mode",
    why: "one rule, no state leaked into the instance",
  },
  shapes4_7: {
    improvement: "Comparisons are always promoted, which gives `(self.ea as i32) == 1i32` for an INT enum and `1i64 == 1i64` for two enum constants (clippy eq_op; the fixture's `same := A1 = B1` folds to `true`). The comment says promotion is there for a narrow operand compared with an out-of-range literal. Promote only when a literal does not fit the operand's own type; otherwise compare in the common type with no casts. Fold constant == constant.",
    alternatives: [
      "today: every comparison is lifted to the promoted type (i32/i64), so both sides get cast",
      "widen only when an operand is a literal outside the other operand's range (preferred: gives the same answer in all cases, since widening never changes a comparison, and emits `self.ea == 1i16`)",
      "fold a comparison of two constants to its BOOL",
    ],
    chosen: "widen only when an operand is a literal outside the other operand's range",
    why: "gives the same answer in all cases, since widening never changes a comparison, and emits `self.ea == 1i16`",
  },
  shapes4_8: {
    improvement: "`iec_div(self.seed, 3.0f64)` checks a divisor that is a nonzero literal, so the check can never fire. When the right operand is a constant other than ±0.0, emit plain `(l / r)`. Keep iec_div only for a divisor that could be zero at run time.",
    alternatives: [
      "today: every REAL `/` goes through iec_div",
      "plain `/` when the divisor is a nonzero const (preferred: same stops; the check is dead code for a literal divisor)",
    ],
    chosen: "plain `/` when the divisor is a nonzero const",
    why: "same stops; the check is dead code for a literal divisor",
  },
  shapes4_9: {
    improvement: "A negated literal is printed as `(-0.5f64)`. `self.seed * -0.5f64` is valid Rust with the same precedence, and a negative literal constant could be emitted as one token.",
  },
  shapes13_1: {
    improvement: "The field declaration itself is already lean and correct. LWORD, ULINT and LTIME map to u64 (LTIME counts nanoseconds and is unsigned, as recorded in ltime_basic: 1s+1ns = LINT 1000000001). WORD and UINT map to u16, LINT to i64. I probed these with rustc under scratchpad/review/b13/p.rs. Every u16 and u8 input to unsigned_underflow matches a same-width wrap. SHL(LWORD 1, n) for n in {-1, 64, 65, 127, i16::MIN} follows the 6-bit mask that shift_64bit and the DWORD case (33 gives 2) establish. DINT against UDINT 3e9 meets in DINT, which signed_unsigned_comparison confirms: udMax > -1 is FALSE, so this is bits and not a widened compare. LTIME max+1 wraps to 0. diff.json has 0 interpreter/Rust disagreements across all 569 members of these three shapes. The only choice worth noting is the other mapping that produces `pub x: u64`: an INTERFACE is emitted as u64 (emit/rust/types.ts rustType), while a POINTER/REFERENCE is usize (the same rustType).",
    alternatives: [
      "Today: interface → u64 tag, pointer/reference → usize index. Correct, but two handle kinds use two integer types, and an interface field reads exactly like an LWORD field in the emitted struct.",
      "Interface → usize, the same as a pointer: one handle type, and no `as usize` where a tag indexes a table. This is my choice if tags are ever used as indices.",
      "A newtype `struct Itf(u64)` / `Option<NonZeroUsize>`: self-documenting and null-safe, but costs a derive and more code at every compare against 0. Not worth it for generated code.",
    ],
    chosen: "Interface → usize, the same as a pointer: one handle type, and no `as usize` where a tag indexes a table",
  },
  shapes13_2: {
    improvement: "castTo does not fold a constant operand. A literal shift/rotate count is typed as its narrowest type (SINT), then cast with `as u32` at run time. For a non-negative literal count, print the bare literal (`wrapping_shr(1)`, `rotate_left(4)`). Rust infers u32 there, and a negative literal already becomes its masked u32 value when it is folded.",
    alternatives: [
      "Today: `x.rotate_left(1i8 as u32)`, a literal typed SINT and then cast.",
      "Fold in castTo: when the operand is an IR const, print `${value}` (or `${value as u32}u32` when it is negative). My choice: it is shortest, and clippy::unnecessary_cast-style noise goes away.",
      "Type the literal from its context (u32) in lowering. This is cleaner in principle, but the count's context is not an IEC type.",
    ],
    chosen: "Fold in castTo: when the operand is an IR const, print `${value}` (or `${value as u32}u32` when it is negative)",
    why: "it is shortest, and clippy::unnecessary_cast-style noise goes away.",
  },
  shapes13_3: {
    improvement: "Promoting first is the measured CODESYS rule (arithmetic_width: SINT 127 + 1 into INT is 128), so it has to stay when the result is stored WIDER. When an add/sub/mul result is narrowed straight back to the operands' own width, the low bits are identical. I checked all 65536 u16 and all 256 u8 inputs: `(x as i32).wrapping_sub(1) as u16 == x.wrapping_sub(1)`. The emitter can peephole `(a as W).wrapping_{add,sub,mul}(b) as T`, where a and b are both T (or a literal that fits T), into `a.wrapping_op(b)`. This does NOT hold for div/mod (sign/overflow), for comparisons, or for a wider target.",
    alternatives: [
      "Today: always promote, then truncate: `(x as i32).wrapping_sub(1i32) as u16`. This is one rule and trivially correct.",
      "Peephole at the store when target width == operand width and op ∈ {add, sub, mul, and, or, xor}: `x.wrapping_sub(1)`. My choice: it is what a Rust engineer writes, and it is provably equal (mod 2^n arithmetic).",
      "Decide it in lowering (skip promotion when the consumer narrows back). This is harder: the IR would have to see the store's type while lowering the expression.",
    ],
    chosen: "Peephole at the store when target width == operand width and op ∈ {add, sub, mul, and, or, xor}: `x.wrapping_sub(1)`",
    why: "it is what a Rust engineer writes, and it is provably equal (mod 2^n arithmetic).",
  },
  shapes13_4: {
    improvement: "All-constant integer arithmetic is typed LINT, as measured (CODESYS folds at full width: 30000+30000 into DINT is 60000). It is still emitted as a run-time i64 wrapping op plus a narrowing cast. Folding it in lowering, computing the LINT value with wrapping at i64 and then converting to the target, would emit `200i16` / `4000000000i64`. This is the same value by construction, and it is what CODESYS's own compiler does.",
    alternatives: [
      "Today: emit the fold's arithmetic at run time in i64 and cast. Correct, and there is one code path.",
      "Fold in lowering into an IrConst typed LINT, then retype. My choice: the interpreter also stops redoing it every scan, and the emitted line matches the ST author's intent.",
      "Fold only in the Rust printer (const-eval of literal operands). Smaller change, but the interpreter and Rust would then differ in structure, which the equivalence harness would not see.",
    ],
    chosen: "Fold in lowering into an IrConst typed LINT, then retype",
    why: "the interpreter also stops redoing it every scan, and the emitted line matches the ST author's intent.",
  },
  shapes1_1: {
    improvement: "A negative constant in a non-receiver position is still wrapped: `s_minus1: (-1i8),`, `neg_big: (-40000.5f32),`. The parens only matter when the literal is a method receiver. Apply `unparen` (or skip the parens) in field-initializer and argument positions.",
  },
  shapes1_3: {
    improvement: "The body is always wrapped in an extra `{ ... }` block even when it has no CONTINUE, and a loop whose only EXIT sits directly in its own body gets `'loop_N:` + `break 'loop_N;` although a plain `break;` works when the body block is unlabeled. Emit the body inline when `!frame.continues`, and use an unlabeled `break` when no labeled body block sits between the EXIT and the loop.",
  },
  shapes1_5: {
    improvement: "In a PROGRAM/FB body, a lowering temporary (`__chain_value_N`, and likewise the output/property/inout_guard temps from calls.ts:787/1229/1261) becomes a persistent `pub` struct field. It appears in Debug/PartialEq/new() and is carried across scans, though it is only ever a statement-local value. Emit it as a `let` in scan()/call(), as routineMode already does. SIZEOF correctly ignores it (probed r1/sz.st: 16 = 16).",
  },
  shapes1_6: {
    improvement: "A constant index is printed as `self.arr[((5i8 as i64) - 1i64) as usize]`, `self.u.b[(1i8 as i64) as usize]`, `self.arr[0i64 as usize]`. Fold a constant index minus the lower bound to a usize literal: `self.arr[4]`. The pointer path is `(self.p as i64).wrapping_add(-1i64)`, and ADR(arr[1]) stores `1i64.wrapping_sub(-1i64) as usize`, which should be `2`.",
  },
  shapes1_7: {
    improvement: "Keeping the members of a WORD/BYTE[2] union in sync emits `{ let __mod_l = ...; let __mod_r = 256u64; if __mod_r == 0 { 0 } else { __mod_l.wrapping_rem(__mod_r) } }` twice per write, zero-guarding a constant 256. A Rust engineer writes `self.u.b = self.u.w.to_le_bytes();` and `self.u.w = u16::from_le_bytes(self.u.b);`. Values are correct (probed r1/un.st: 4813, 205, 171).",
    alternatives: [
      "today: per-byte MOD/DIV arithmetic with constant-divisor zero guards",
      "to_le_bytes/from_le_bytes on the whole member (preferred: 1 line, obviously right on a little-endian target, which CODESYS x86/ARM are)",
      "at minimum: drop the `__mod_r == 0` guard when the divisor is a nonzero constant",
    ],
    chosen: "to_le_bytes/from_le_bytes on the whole member",
    why: "1 line, obviously right on a little-endian target, which CODESYS x86/ARM are",
  },
  shapes1_8: {
    improvement: "`p : POINTER TO INT := ADR(x)` becomes `p: 0` in new() plus `self.p = 1;` in a separate init()/__init(). The handle is a compile-time constant, and init-reads-later already refuses any initializer that could see it at 0, so the tag can be the starting value (`p: 1`). That drops init()/__init for most POUs, along with the requirement that callers remember to call it.",
  },
  shapes1_9: {
    improvement: "The function return is always `let mut f: T = default; ...; f = expr; f`, and a VAR_OUTPUT is reset at entry even when the body assigns it unconditionally (`*i_carry_out = 0i16;` twice). All parameters are declared `mut` even when never reassigned (`mut i_a: i16`). When the result or output is assigned exactly once on every path, return the expression directly, drop the entry reset, and declare `mut` only on reassigned parameters.",
  },
  shapes1_10: {
    improvement: "Large integer literals are emitted unseparated (`1709078400u32`, `86400000u32`, `1000000000u64`), which is 200+ clippy::unreadable_literal hits across the decl/assign literal shapes. Group digits with `_` (e.g. `1_709_078_400u32`) for literals of 6+ digits.",
  },
  shapes1_11: {
    improvement: "Statements after an unconditional RETURN/EXIT are still printed (`return; self.n = 99i16; ...`, the body after `break 'loop_2;`). rustc reports unreachable_code, and the policy allows it. The printer could stop emitting a block after a diverging statement; the ST line is dead either way.",
  },
  shapes2_1: {
    improvement: "The same ST construct `x := x + 1` is emitted two ways. A body statement is widened to i32 and narrowed back; the FOR step is added in the counter's own type. For add, sub, mul and neg, truncating the wide wrapping result equals wrapping in the narrow type, so an assign whose value is convert(promoted add/sub/mul of operands converted up from T) back to T can be printed narrow. Comparisons (`(self.runs as i32) > 10i32`) can also be printed narrow, because a sign-preserving widening keeps the order.",
    alternatives: [
      "A: widen, then wrapping op, then narrow: `(x as i32).wrapping_add(1i32) as i16`. Emitted today for every body expression. Always right, including for DIV: INT_MIN / -1 must stay in i32 (32768 then `as i16` gives -32768), because a narrow i16 `/` would panic.",
      "B: narrow wrapping op: `x.wrapping_add(1i16)`. Emitted today only for the FOR step. Identical results for add/sub/mul/neg when the result is stored back into T.",
      "Choose B for add/sub/mul/neg and comparisons whose result goes straight back to T or into a bool, and keep A for DIV and for a result stored into a wider target (ABS(INT_MIN) into a DINT, `si + 1000` into an INT). It removes 2 casts per statement on the most common line in the corpus.",
    ],
    chosen: "B for add/sub/mul/neg and comparisons whose result goes straight back to T or into a bool, and keep A for DIV and for a result stored into a wider target (ABS(INT_MIN) into a DINT, `si + 1000` into an INT). It removes 2 casts per statement on the most common line in the corpus.",
  },
  shapes2_3: {
    improvement: "A constant index prints as `(4i8 as i64) as usize` and should print `4`, since the lowering already knows it is in range and rustc checks constant indices. For lower == 0 and a signed variable index, `(self.k as i64) as usize` can be `self.k as usize`: a signed-to-usize `as` sign-extends, so a negative index still becomes huge and still panics. The i64 hop is needed only when a non-zero lower bound is subtracted.",
  },
  shapes2_4: {
    improvement: "`ADR(arr[1])` over ARRAY[0..4] is emitted as `1i64.wrapping_sub(-1i64) as usize` instead of the folded constant `2`. Fold it when the index is constant. On deref the pointer has already passed `iec_deref` (it is non-zero), so `(self.p as i64).wrapping_add(-1i64) as usize` can be `self.p - 1`, plus `+ k` for p[k].",
  },
  shapes2_5: {
    improvement: "Re-lending a VAR_IN_OUT that is already `&mut T` prints an explicit reborrow `&mut (*x)`. Passing `x` reborrows implicitly. When the bound place is a bare inout or lent root with an empty path, print the name.",
  },
  shapes2_6: {
    improvement: "A string literal is built at its own (default 80) capacity and then copied with `.to()` into the target. `lit` already truncates, so `IecString::<N>::lit(b\"abc\")` at the target's capacity is the same value with one copy fewer. The `lit(format!(..)).to::<12>().to()` double copies collapse in the same way when the intermediate capacity is at least the final one. This affects about 472 emitted lines.",
  },
  shapes2_7: {
    improvement: "`array.element.kind === \"elementary\"` decides between a repeat expression and from_fn, so a 2-D array of i16 goes through a closure. [i16; N] is Copy, so `[[0i16; 3]; 2]` is legal. Use the emitter's existing isCopy(type) in that condition.",
  },
  shapes2_8: {
    improvement: "The aggregate initializer builds a mutable temporary and assigns fields one by one.",
    alternatives: [
      "A (today): `{ let mut v = T::new(); v.x = 1; v.y = 2.5; v }`. Works for FB types and nested initializers.",
      "B: struct update syntax `T { x: 1i16, y: 2.5f32, ..T::new() }`. One expression, no mut, and the idiomatic Rust form. The fields are pub and in the same module, so it compiles.",
      "Choose B. The only reason to keep A would be an initializer that reads a sibling, and those go through __init anyway.",
    ],
    chosen: "B. The only reason to keep A would be an initializer that reads a sibling, and those go through __init anyway.",
  },
  shapes2_9: {
    improvement: "DUT structs derive only Clone, so a struct store needs `.clone()` and a struct array needs from_fn. A struct whose fields are all Copy (elementary, IecStr, usize pointers, arrays of those) could `#[derive(Clone, Copy)]`. The store then becomes a plain assignment and the array becomes `[T::new(); N]` (with a const fn new) or keeps from_fn.",
  },
  shapes2_10: {
    improvement: "ABS of an unsigned argument is the identity, as the lowering comment itself says. Returning `arg` there removes a widen, an abs and a narrow; the emitter's own unsigned shortcut in emit/rust/builtins.ts never fires because the type has already been promoted to DINT.",
  },
  shapes2_11: {
    improvement: "Every input is declared `mut` and every method carries `#[allow(unused_mut, unused_variables, unused_assignments)]`. Print `mut` only for an input the body stores to (the IR knows the assigned places). When the result local is never assigned, return `false`/default directly instead of `let mut fb_init = false; ... fb_init`. The allows could then go.",
  },
  shapes2_12: {
    improvement: "init() always gets `#[allow(unused_variables)]`, even without a g or prg parameter. Guard it the way line 1240 does (`usesGlobals || usesPrograms`).",
  },
  shapes2_13: {
    improvement: "The parentheses guard a negative constant as a method receiver. In a field initializer or other non-receiver position they are noise (clippy unused_parens territory). Only `-f32::INFINITY` needs them, and only as a receiver.",
  },
  shapes2_14: {
    improvement: "The helper is `assert!(at != 0, \"dereference of a null pointer\")`, which states the check in one line.",
    alternatives: [
      "A (today): `fn iec_deref(at: usize) { if at == 0 { panic!(..) } }` wrapped around every read in a block `{ iec_deref(p); x }`.",
      "B: `assert_ne!(at, 0, ..)` / `assert!` in the same helper. Same behaviour, shorter.",
      "C: model a single-target pointer as `Option<()>` or NonZeroUsize. Heavier; not worth it. Choose B.",
    ],
  },
  shapes5_15: {
    improvement: "An f32 literal whose value is already frounded (REAL#0.1, REAL#3.14159) prints the full float64 repr of that f32: `a: 0.10000000149011612f32`, `b: 3.141590118408203f32`. Print the shortest decimal that round-trips as f32 instead (the smallest p in 1..9 with Math.fround(+v.toPrecision(p)) === Math.fround(v)), giving `0.1f32` and `3.14159f32`. Doing it this way also fixes the double-rounding finding when applied to fround(v).",
    alternatives: [
      "today: `${v}f32`, the f64 shortest repr of the value (long for a frounded value, and double-rounding-unsafe for an unfrounded one)",
      "print `${Math.fround(v)}f32`: correct, but still 17 digits",
      "print the shortest f32 repr of Math.fround(v): correct and lean (chosen)",
    ],
    chosen: "print the shortest f32 repr of Math.fround(v): correct and lean",
  },
  shapes5_16: {
    improvement: "At a struct-field initializer the field's type is already declared, so the type suffix is redundant: `lt1s: 1000000000u64,` could be `lt1s: 1_000_000_000,`. The suffix is only needed where the literal is a method receiver. clippy::unreadable_literal fires 11 times on this shape and 3 times on 74845f98c6: separate digits in groups of three for integers of 5 or more digits.",
    alternatives: [
      "today: a suffixed literal everywhere (`0u64`, `65535u16`, `0.0f32`), which is uniform and safe at receivers",
      "an untyped literal in typed positions (field init, `let x: T =`) and a suffix only at receivers: leaner, but needs a position flag in literal()",
      "keep the suffix but add `_` digit grouping: the smallest change and removes the lint (my choice: add grouping now, keep the suffix for uniformity)",
    ],
    chosen: "keep the suffix but add `_` digit grouping: the smallest change and removes the lint",
    why: "add grouping now, keep the suffix for uniformity",
  },
  shapes5_17: {
    improvement: "A negative literal is wrapped in parens even at a field-init position, where it can never be a method receiver: `im5: (-5i16),` and `i_min: (-32768i16),`, 87 lines across the fixtures. rustc's unused_parens does not fire there, so the lint scan does not see it. The initOf field pushes could unparen() the value, which is already used for assignment right-hand sides.",
    alternatives: [
      "today: parens always, which is safe at every receiver",
      "unparen() at the initOf call sites (:1170/:1190/:1227/:1072), the same treatment assignments already get (chosen)",
    ],
    chosen: "unparen() at the initOf call sites (:1170/:1190/:1227/:1072), the same treatment assignments already get",
  },
  shapes11_1: {
    improvement: "When a pointer's target is an array element, lowering adds (lower-1) to the handle and then hands the emitter an index step with `lower` set, which the emitter subtracts again, so the lower bound cancels at runtime. For ARRAY[3..7], probe ptr_neg_step emits `self.arr[((self.p as i64).wrapping_add(2i64) - 3i64) as usize]`, which is just `self.p - 1`. It also mixes `wrapping_add` with a plain `-` in one expression. If pointeePlace built a zero-based index (`p - 1 (+ extra)`) with `lower: 0n`, the emitter would print `[(self.p as i64 - 1) as usize]`. With lower 0 it already prints `.wrapping_add(-1i64)`, and that could be a plain `- 1`.",
  },
  shapes11_2: {
    improvement: "`ADR(arr[1])` with a constant index emits `self.p = 1i64.wrapping_sub(-1i64) as usize;`, and `ADR(arr[7])` over ARRAY[3..7] emits `self.p = 7i64.wrapping_sub(2i64) as usize;`. When last.index is a const, the handle is a compile-time constant (2 and 5). It should be emitted as `self.p = 2;`, the same way a scalar ADR already emits `self.p = 1;`.",
    alternatives: [
      "today: the generic `LINT(index) - (lower-1)` expression, cast to usize, even for a constant index",
      "fold in addressOf when last.index.kind === 'const' and emit the literal handle (my choice: it is identical to the scalar-ADR form `self.p = 1;` and costs about 3 lines)",
      "a generic const-folding pass over IR binaries (bigger, and it would help elsewhere too)",
    ],
    chosen: "fold in addressOf when last.index.kind === 'const' and emit the literal handle",
    why: "it is identical to the scalar-ADR form `self.p = 1;` and costs about 3 lines",
  },
}
