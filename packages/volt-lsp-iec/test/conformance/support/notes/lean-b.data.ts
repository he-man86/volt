/**
 * the review's lean items (`lean.data.ts`) — part B.
 *
 * One slice of `lean.data.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a test support
 * file is held to 400 lines).
 */
export const LEAN_B = {
  shapes11_3: {
    improvement: "The null check is emitted even when every value ever stored into the pointer is a non-zero constant, with no `p := 0` and no stepping. In mem_adr_of_inout_member it reads `self.p = 1; iec_deref(self.p); io.y = 99i16;`, and that check can never fire. Lowering already knows every store into a form-1 pointer (lw.shared.pointers). If none of them can produce 0, it could drop `guard`. But a single-target pointer's field starts at 0 and can be read before any store in a later scan, so this is only safe when a store dominates the deref in the same body. That is the case the scoped VAR_IN_OUT path already proves (`boundPointers`).",
    alternatives: [
      "today: always guard (simple, always correct)",
      "drop the guard only when a store of a non-zero constant dominates the deref in the same run (the boundPointers case). I would do only this narrow case, or leave it as is, because the saving is small and a wrong elision turns a CODESYS fault into a silent wrong index (p[i] with p=0 can land on a valid element)",
    ],
  },
  shapes11_4: {
    improvement: "The helper is `fn iec_deref(at: usize) { if at == 0 { panic!(\"dereference of a null pointer\"); } }`. clippy::manual_assert flags it in every pointer fixture (mem_pointer_index_struct_array: 2, mem_adr_of_inout_member: 1). `assert!(at != 0, \"dereference of a null pointer\");` says the same thing in the idiomatic way, and the panic message does not change.",
    alternatives: [
      "today: an if with panic! inside the helper",
      "`assert!(at != 0, \"dereference of a null pointer\")` inside the helper (my choice: one-line change, same message, clippy-clean)",
      "an inline `assert_ne!(self.p, 0, ...)` at each site with no helper (more text per site, not better)",
    ],
    chosen: "`assert!(at != 0, \"dereference of a null pointer\")` inside the helper",
    why: "one-line change, same message, clippy-clean",
  },
  shapes11_5: {
    improvement: "The field line itself is already minimal and correct (INT to i16, LREAL to f64). Probes of its edge inputs match the interpreter: INT := 40000 gives -25536, SINT := 200 gives -56, UINT := -1 gives 65535, LREAL 1e300 to REAL gives inf, 16777217.0 to REAL rounds to 16777216. The surrounding boilerplate is what a Rust engineer would trim. Every struct gets a hand-written new() plus `impl Default { fn default() { Self::new() } }`, even when every initialiser is the type's zero. Zero initialisers also use typed-suffix literals (`0i16`, `0.0f32`), while a pointer field uses a bare `0`.",
    alternatives: [
      "today: hand-written new() with every field listed, plus impl Default delegating to new(). This is always valid, including for arrays longer than 32 (which have no std Default) and for non-zero initialisers",
      "`#[derive(Default)]` when every field's initialiser is its type's zero and no array is longer than 32, keeping new() as `Self::default()`. Shorter, but it gives two emission paths for one construct, which breaks the 'same construct, same shortest way' rule",
      "keep today's form (my choice: one uniform path is worth the lines; the suffix-vs-bare literal inconsistency is cosmetic)",
    ],
    chosen: "keep today's form",
    why: "one uniform path is worth the lines; the suffix-vs-bare literal inconsistency is cosmetic",
  },
  shapes11_6: {
    improvement: "A widening that cannot lose data (BYTE to INT, u8 to i16) is emitted as a bare `as`, which clippy::cast_lossless flags (1 hit in literal_out_of_range_init, 3 in mem_pointer_index_struct_array). `i16::from(self.b300)` says 'lossless' in the type system. Whether this is worth doing is a style choice.",
    alternatives: [
      "today: `x as T` for every integer conversion (one uniform spelling, wrapping where narrowing)",
      "`T::from(x)` for lossless widenings and `as` only where wrap or truncation is intended. That makes the narrowing casts stand out, which suits a reviewer (my choice if the lint list is being worked down)",
    ],
    chosen: "`T::from(x)` for lossless widenings and `as` only where wrap or truncation is intended. That makes the narrowing casts stand out, which suits a reviewer (my choice if the lint list is being worked down)",
  },
  shapes13_6: {
    improvement: "A FOR ... BY -1 step is printed as `i.wrapping_add(-1i32)`. When the step is a negative constant, print `i.wrapping_sub(1i32)` instead.",
    alternatives: [
      "emitted today: `i.wrapping_add(-1i32)`",
      "`i.wrapping_sub(1i32)` (chosen: identical for every value, including MIN, and idiomatic)",
    ],
    chosen: "`i.wrapping_sub(1i32)`",
    why: "identical for every value, including MIN, and idiomatic",
  },
  shapes13_7: {
    improvement: "With lower bound 0, `(n as i64) as usize` is the same as `n as usize` for every signed or unsigned integer of 64 bits or fewer, because a negative value sign-extends to a huge usize either way and still panics. Drop the i64 hop when lower===0n. For ARRAY[*], `.wrapping_sub` on two widened i32 cannot overflow, so a plain `-` is enough and matches the static-bound form `[(i - L) as usize]`.",
    alternatives: [
      "emitted today: `[(n as i64) as usize]` / `[(i as i64).wrapping_sub(lo as i64) as usize]`",
      "`[n as usize]` for lower 0 and `[(i as i64 - lo as i64) as usize]` for open bounds (chosen: same panics, fewer tokens)",
    ],
    chosen: "`[n as usize]` for lower 0 and `[(i as i64 - lo as i64) as usize]` for open bounds",
    why: "same panics, fewer tokens",
  },
  shapes13_8: {
    improvement: "Every string assignment adds `.to()` even when the value already has the target's capacity, because the call lowering converted it already or the literal was built with that capacity. Each `.to()` is a full IecStr copy through lit(). Add it only when the value's capacity differs from the target's, or when the target capacity is generic.",
    alternatives: [
      "emitted today: always append `.to()`",
      "append only when rustType(value.type) !== rustType(target) or the target is an inout generic (chosen)",
    ],
    chosen: "append only when rustType(value.type) !== rustType(target) or the target is an inout generic",
  },
  shapes13_9: {
    improvement: "Passing an in-out on to another call prints `&mut (*numbers)`. When the place is the bare inout root, print the binding itself (`numbers`); Rust reborrows it implicitly.",
  },
  shapes13_10: {
    improvement: "Temporaries for a property setter argument and for an unbound function output become persistent `pub` fields of the PROGRAM/FB struct (clippy::pub_underscore_fields, 19 in this batch). They are also compared by PartialEq and printed by Debug. The setter can take the value directly (`self.fb.threshold_set(100i16)`), and an unbound output can be a call-scoped `&mut 0i16` or a `let mut` in the enclosing block.",
  },
  shapes13_11: {
    improvement: "A DUT struct always derives only Clone, so assigning it prints `.clone()` even when every field is Copy (i16, bool, IecString<4>). Derive Copy for structs whose fields are all Copy and let isCopy say so; the `.clone()` then goes away.",
  },
  shapes13_12: {
    improvement: "Every VAR_INPUT parameter is declared `mut`, and a blanket #[allow(unused_mut)] hides it. The IR shows whether the body writes the input (an assign whose target is that local slot, or a `&mut` lend of it). Print `mut` only then and drop unused_mut from the allow list.",
  },
  shapes13_13: {
    improvement: "AND/OR always print non-short-circuit `&`/`|`, so a side effect on the right runs as it does in the interpreter (clippy::needless_bitwise_bool, 48 here). When both operands are free of side effects (loads, consts, comparisons, no call), `||`/`&&` gives the same result.",
    alternatives: [
      "emitted today: `|` / `&` always (correct, avoids any evaluation-order divergence)",
      "`||`/`&&` when neither side contains a call (equivalent; chosen for readability)",
      "keep `|` everywhere and accept the lint (simplest emitter)",
    ],
    chosen: "`||`/`&&` when neither side contains a call (equivalent; chosen for readability)",
  },
  shapes13_14: {
    improvement: "Comparisons widen both sides to the promoted type. When both operands already have the same narrow type and the literal fits that type, the narrow comparison gives the same answer, e.g. `raw > 0i16`.",
    alternatives: [
      "emitted today: widen to i32 (always correct, including out-of-range literals)",
      "compare natively when the operand types are equal and the const fits (chosen at emit: exact and shorter)",
      "`i32::from(x)` instead of `as` (silences cast_lossless, not shorter)",
    ],
    chosen: "compare natively when the operand types are equal and the const fits (chosen at emit: exact and shorter)",
  },
  shapes13_15: {
    improvement: "LEN_INTERNAL only reads its argument but declares it VAR_IN_OUT, so it takes `&mut IecString<N>` and forces every caller's STRING input to be `mut`. Declare it VAR_IN_OUT CONSTANT (emitted as `&IecString<N>`). Its counter `(len_internal as i32).wrapping_add(1i32) as u16` can also count in DINT and convert once.",
  },
  shapes13_16: {
    improvement: "A library routine is lowered once per caller string type and per call context, yet every copy is already generic over `const N___STR_*`. The copies come out byte-identical apart from the name. Key the variant on the cursor shape (and not on capacity) or dedupe routines with identical bodies at emit.",
  },
  shapes13_17: {
    improvement: "An open array is passed as a slice plus hidden lower and upper DINTs, and in an FB these are stored as two pub fields per dimension. The upper bound is always lower + slice.len() - 1, so passing it again is redundant. Pass only the lower bound and compute UPPER_BOUND from `.len()`.",
  },
  shapes6_6: {
    improvement: "Fold all-constant integer and real expressions to a single literal. The comment already says 'folds at FULL width', but the IR still carries the operation: `2000000000i64.wrapping_add(2000000000i64)`, `100i64.wrapping_add(100i64) as i16`, `9i64.min(2i64) as i16`, `((-1e15f64) * 1e15f64) * self.grow`. Folding via semantics/fold.ts gives `4000000000i64`, `200i16`, `2i16`, `-1e30f64 * self.grow`.",
  },
  shapes6_7: {
    improvement: "A comparison of a narrow variable with a literal that fits its type is widened to DINT: `(self.a as i32) <= 3i32` where `self.a <= 3i16` is equal for every input, because widening is value-preserving for comparison. MIN(INT, INT) likewise prints `(self.a3 as i32).min(self.b7 as i32) as i16`, where `self.a3.min(self.b7)` is equal.",
    alternatives: [
      "today: promote both sides to DINT (the IEC register-width rule, needed for + - *)",
      "compare in the operands' own common type when the op is a comparison or MIN/MAX and every constant fits it. My choice: exact for every input and no casts",
      "`i32::from(self.a) <= 3`: clippy-pedantic's preferred lossless cast spelling, but longer",
    ],
    chosen: "compare in the operands' own common type when the op is a comparison or MIN/MAX and every constant fits it",
    why: "exact for every input and no casts",
  },
  shapes6_8: {
    improvement: "An assignment chain in a PROGRAM or FB body stores its temporary as a struct FIELD (`pub __chain_value_7: f64`, initialised in new()), which is persistent state that only ever holds one statement's value. Each link re-converts from the temp instead of reading the previous target: `self.out_l = (self.__chain_value_7 as f32) as f64` could be `self.out_l = self.mid_r as f64` (the same value, since mid_r was just assigned that conversion), or the temp could be a `let`.",
    alternatives: [
      "today: temp as struct field, re-convert the whole chain per link",
      "`let __chain_value = self.src_l;` a local, each link converting from the previous TARGET. My choice: no hidden field, one cast per link",
      "no temp at all when the value is a plain load with no side effect: `self.mid_r = self.src_l as f32; self.out_l = self.mid_r as f64;`",
    ],
    chosen: "`let __chain_value = self.src_l;` a local, each link converting from the previous TARGET",
    why: "no hidden field, one cast per link",
  },
  shapes6_9: {
    improvement: "A literal index prints `self.arr_uai[(0i8 as i64) as usize]`. A constant index already range-checked by lowering can print as `[0]`. The dynamic-lower-bound form uses `.wrapping_sub(...)` (callshape_array_star_fb_inout), while a static lower bound uses plain `-`. Choose one.",
  },
  shapes6_10: {
    improvement: "REAL math goes through f64 and back: `(self.arg as f64).exp() as f32`.",
    alternatives: [
      "today: widen to f64, compute, narrow. Matches the interpreter bit for bit, and is closer to the x87 extended-precision CODESYS computes with (mathret_* recorded equal)",
      "`self.arg.exp()` on f32: shorter, but a different float32 routine that can differ in the last ULP from both the interpreter and CODESYS",
      "Keep today's form: the cast is the price of parity, not waste",
    ],
  },
  shapes6_11: {
    improvement: "`iec_r2i32(self.big_real as f64) as u16` is correct against all 192 measured cells (re-probed: -2147483648.6, 9.3E18, 4294967295.5 and -0.4 agree between backends).",
    alternatives: [
      "today: one f64 helper per register width, then an `as` wrap into the destination",
      "a generic `fn iec_r2i32<T: From<f32>>`: saves the `as f64` on a REAL source but adds a trait bound; not worth it",
      "Keep today's form",
    ],
  },
  shapes6_12: {
    improvement: "`(self.a ^ self.c) ^ self.b` keeps parentheses around a left-associative same-operator chain. `self.a ^ self.c ^ self.b` is identical. `a | (b & c)` is fine as written.",
  },
  shapes6_13: {
    improvement: "Every loop in production Rust carries a u64 counter and a branch per iteration. Behind a cfg(test) or harness flag the emitted loop would be the plain `loop { if !cond { break } … }` a Rust engineer writes.",
  },
  shapes7_1: {
    improvement: "Fold all-constant integer subtrees. `v := 0 - 42` is emitted as `0i64.wrapping_sub(42i64) as i32`, `x := MAX(1,5,3)` as `1i64.max(5i64).max(3i64) as i16` (clippy::unnecessary_min_or_max), a shift count literal as `1i8 as u32`, and `d + T#1H` as `3600000u32 / 1000u32`. The declaration path already folds (lower/values/fold.ts foldConstant/constEval), and CODESYS folds these at compile time too.",
    alternatives: [
      "(a) TODAY: runtime i64 wrapping arithmetic then `as T`. rustc const-folds it, so it only costs readability.",
      "(b) fold in lowering to an IrExpr const of the destination type, reusing constEval. One place, and the interpreter benefits too. My choice.",
      "(c) fold only in the emitter when both operands are `const`. Smaller change, but a second folding rule.",
    ],
    chosen: "(b) fold in lowering to an IrExpr const of the destination type, reusing constEval. One place, and the interpreter benefits too",
  },
  shapes7_2: {
    improvement: "A comparison of two operands of the SAME narrow type (SINT/SINT, INT/INT, the same enum) is printed as `(a as i32) < (b as i32)`. Comparing in the operands' own type gives the same result, because a comparison cannot overflow. Only mixed-sign or mixed-width pairs need the lift.",
    alternatives: [
      "(a) TODAY: always promote to DINT, then compare.",
      "(b) skip the promotion when rustType(left) === rustType(right) for eq/ne/lt/le/gt/ge. My choice.",
      "(c) promote to the smallest common type (i16 for INT vs USINT). More rules, and little gain beyond (b).",
    ],
    chosen: "(b) skip the promotion when rustType(left) === rustType(right) for eq/ne/lt/le/gt/ge",
  },
  shapes7_3: {
    improvement: "Unary minus and ABS widen to i32 and narrow back: `(self.a as i32).wrapping_neg() as u8`, `(self.u200 as i32).wrapping_abs() as u8`. When the destination has the operand's width, `self.a.wrapping_neg()` / `self.a.wrapping_abs()` give the same bits. ABS of a promoted UNSIGNED operand is the identity (`self.u200`). When the result stays wide, `-(self.i_min as i32)` cannot overflow, so the wrapping call is dead.",
    alternatives: [
      "(a) TODAY: promote to DINT, wrapping_neg/wrapping_abs, then cast to the destination.",
      "(b) narrow-in/narrow-out → the operand's own wrapping_neg/wrapping_abs; unsigned ABS → the operand; widened result → plain `-`. My choice, because the bits are provably identical.",
      "(c) keep the IR as is and add a peephole in the emitter's `convert` for `(x as i32).op() as <x's type>`.",
    ],
    chosen: "(b) narrow-in/narrow-out → the operand's own wrapping_neg/wrapping_abs; unsigned ABS → the operand; widened result → plain `-`",
  },
  shapes7_4: {
    improvement: "Every widening cast is printed with `as` (`self.n as u32`, `self.x as f64`, `self.a as i32`). That is ~200 clippy::cast_lossless findings in this batch alone. A lossless widening reads better as `u32::from(x)` / `f64::from(x)`, and `as` would then mark only the conversions that truncate, wrap or reinterpret sign.",
    alternatives: [
      "(a) TODAY: `as` everywhere.",
      "(b) `T::from(x)` when the source→target is lossless (sign-preserving widening, integer ≤ 16 bits → f32, ≤ 32 bits → f64), `as` otherwise. My choice.",
      "(c) leave `as` and allow cast_lossless in the lint list. Zero effort, but the reader loses the lossy/lossless signal.",
    ],
    chosen: "(b) `T::from(x)` when the source→target is lossless (sign-preserving widening, integer ≤ 16 bits → f32, ≤ 32 bits → f64), `as` otherwise",
  },
  shapes7_5: {
    improvement: "TIME/DATE/DT/TOD → LTIME/LDT is `(self.v as u64).wrapping_mul(1000000u64)`, and a u32 count times at most 1e9 cannot overflow u64. TOD→DT is `((self.v as u64) / 1000u64) as u32`, which needs no u64 at all: it is `self.v / 1000`. The 64-bit work type is only needed where a mod-by-day follows an up-scaling (DT→TOD).",
    alternatives: [
      "(a) TODAY: always ULINT, wrapping_mul.",
      "(b) ULINT only when an up-scale feeds a day mask. Plain `*` where the product provably fits; stay in u32 for a pure down-scale. My choice.",
      "(c) keep ULINT and only swap wrapping_mul for `*`.",
    ],
    chosen: "(b) ULINT only when an up-scale feeds a day mask. Plain `*` where the product provably fits; stay in u32 for a pure down-scale",
  },
  shapes7_6: {
    improvement: "The chained-assignment temporary becomes a `pub __chain_value_N` FIELD of the POU struct: declared, initialised in new(), part of Debug/PartialEq and clippy::pub_underscore_fields. It holds a value only for one statement, so it should be a `let` local. The last link `(self.__chain_value_7 as f32) as f64` could also just read the target it has just written.",
    alternatives: [
      "(a) TODAY: a frame slot, i.e. a struct field.",
      "(b) a statement-scoped `let` (the MOD/SEL expansions already use `let __mod_l`). My choice.",
      "(c) evaluate once into the LAST target and read that target for each earlier link. Wrong when a target's index holds a call, so it is not general.",
    ],
    chosen: "(b) a statement-scoped `let` (the MOD/SEL expansions already use `let __mod_l`)",
  },
  shapes7_7: {
    improvement: "`self.into_wide = self.narrow.widen::<80>().to();` copies twice: widen already produces IecWString<80>, and `.to()` copies it again into the same capacity. `self.abc == IecString::<3>::lit(b\"abc\")` builds a whole string only to compare it. `self.abc.units() == b\"abc\"` (or `< &b\"z\"[..]` for ordering) compares the same used units.",
    alternatives: [
      "(a) TODAY: `.to()` on every string store; a literal is always an IecString::lit.",
      "(b) skip `.to()` when the value's printed type already has the target's capacity; compare against a literal via `units()` slices. My choice.",
      "(c) implement PartialEq<[T]> on IecStr and compare against `b\"abc\"[..]` directly.",
    ],
    chosen: "(b) skip `.to()` when the value's printed type already has the target's capacity; compare against a literal via `units()` slices",
  },
  shapes7_8: {
    improvement: "Every METHOD of a PROGRAM gets `prg: &mut Programs`, and a blanket `#[allow(unused_mut, unused_variables, unused_assignments)]` covers the unused ones (init_slot_program_own `boot`, fbcall_program_own_members `deeper`/`tidy`/`twice`). Pass `prg` only to routines that reach Programs, directly or through a callee, the way `usesPrograms` is already computed for scan.",
    alternatives: [
      "(a) TODAY: uniform signature for every routine of a program plus allow(unused).",
      "(b) per-routine reachability of Programs (a transitive call-graph flag). My choice: signatures then say what a routine touches.",
      "(c) keep the uniform signature and name it `_prg`. Silences the lint, keeps the noise.",
    ],
    chosen: "(b) per-routine reachability of Programs (a transitive call-graph flag)",
    why: "signatures then say what a routine touches.",
  },
  shapes7_9: {
    improvement: "`let c = if v < 0.0 { -((-v).round()) } else { v.round() };` is exactly `v.round()`: f64::round already rounds half away from zero, symmetrically.",
  },
  shapes7_10: {
    improvement: "`iec_div(self.int7 as f64, 2.0f64)` pays for a zero check and a generic call when the divisor is a non-zero constant. When the right operand is a `const` other than 0, print plain `/`.",
  },
  shapes7_11: {
    improvement: "`{ let mut v = T::new(); v.offset = 7i16; v }` is a block with a mutable temporary. Rust's struct-update syntax says the same thing in one expression.",
    alternatives: [
      "(a) TODAY: `{ let mut v = T::new(); v.f = x; v }`. Works for nested paths too.",
      "(b) `T { f: x, ..T::new() }`. Idiomatic; needs the field list to be the struct's own direct fields, which is exactly what `sets` holds. My choice.",
      "(c) generate a `T::with_f(x)` constructor. More code, no gain.",
    ],
    chosen: "(b) `T { f: x, ..T::new() }`. Idiomatic; needs the field list to be the struct's own direct fields, which is exactly what `sets` holds",
  },
  shapes11_7: {
    improvement: "A constant array index is printed as `[(1i8 as i64) as usize]`, or `[((1i8 as i64) - 1i64) as usize]` for a non-zero lower bound. It should fold to `[1]` / `[0]`. The same constant also comes out two ways in one fixture: xo_union_across_objects has both `halves[0i64 as usize]` and `halves[(0i8 as i64) as usize]`.",
  },
  shapes11_8: {
    improvement: "A runtime FOR step is printed in full three times per pass: twice in the test and once in the step. For callshape_for_runtime_step that is a SEL `if` each time. It is side-effect free because calls are refused, so it can be bound once per pass (`let __step = ...;`) and referenced.",
  },
  shapes11_9: {
    improvement: "When the body has no CONTINUE, only the label `'body_N:` is stripped and a bare `{ ... }` block is left around the body. Drop the braces too, as is already done for `'loop_N:`.",
  },
  shapes11_10: {
    improvement: "`WHILE TRUE` / `REPEAT ... UNTIL FALSE` print `if false { break; }`. When the negated test is the constant false, omit the line.",
  },
  shapes11_11: {
    improvement: "Lowering temps in a PROGRAM/FB body become persistent pub struct fields (`pub __chain_value_3: bool`, `pub __property_1: i16`). They are written before they are read in the same statement, so they should be Rust locals (`let chain = self.c;`), or passed directly (`self.fb_upw.threshold_set(100i16)`). Today they grow the FB's state and its PartialEq, and trip pub_underscore_fields.",
  },
  shapes11_12: {
    improvement: "VAR_TEMP arrays and structs are fields reset at the top of every call (`self.a = [0i16; 3];`, `self.scratch = T::new();`). As a Rust local (`let mut a = [0i16; 3];`) they would carry no reset and no persistent state.",
  },
  shapes11_13: {
    improvement: "initOf checks only the first array level for elementary elements, so a 2D array of f32/i16 prints `std::array::from_fn(|_| [0.0f32; 4])` where `[[0.0f32; 4]; 4]` is a const expression. Apply peelArray recursively: if the leaf is elementary, use nested repeat expressions.",
  },
  shapes11_14: {
    improvement: "With a constant non-zero divisor, the MOD block `{ let __mod_l = ...; let __mod_r = 2i32; if __mod_r == 0 { 0 } else { __mod_l.wrapping_rem(__mod_r) } }` reduces to `(self.i as i32) % 2`. `%` by a non-zero, non -1 constant cannot panic.",
  },
  shapes11_15: {
    improvement: "Integer + - * on INT operands whose result is stored straight back into an INT is emitted widened, when the narrow form gives the same stored result.",
    alternatives: [
      "Emitted today: `(self.sum as i32).wrapping_add(self.i as i32) as i16`. This is faithful to CODESYS's 32-bit intermediate, and it is required when the result feeds a compare, a division or a wider store.",
      "Narrow: `self.sum.wrapping_add(self.i)`. Truncating a wrapping add/sub/mul is a ring homomorphism, so the stored value is identical for every input. This is my choice when the consumer is a same-typed store, because it removes 3 casts and the cast_possible_truncation/cast_lossless findings.",
    ],
    chosen: "Narrow: `self.sum.wrapping_add(self.i)`. Truncating a wrapping add/sub/mul is a ring homomorphism, so the stored value is identical for every input",
  },
  shapes11_16: {
    improvement: "Comparing a variable with an in-range literal of the variable's own type widens both sides.",
    alternatives: [
      "Emitted today: `(self.n as i32) > 5i32`, uniform, and safe for out-of-range literals.",
      "Narrow: `self.n > 5i16`, used when the literal fits the variable's type (the answer cannot differ). The FOR test already emits `self.i > 10i16` for the same comparison, so one construct currently has two spellings. I would narrow when the constant fits.",
    ],
  },
  shapes11_17: {
    improvement: "BOOL AND is always `&`.",
    alternatives: [
      "Emitted today: `&` everywhere, so both sides are evaluated, which matches CODESYS AND and the interpreter.",
      "`&&` when the right side holds no call and no deref guard. It is identical in value and is idiomatic Rust. I would keep `&` because it is one uniform, provably faithful rule and clippy does not flag it.",
    ],
  },
  shapes11_18: {
    improvement: "`cursor := ADR(slots[0])` prints `0i64.wrapping_sub(-1i64) as usize`. The handle is a constant, so it can fold to `1`.",
  },
  shapes11_19: {
    improvement: "Negative literals in array initialisers are parenthesised: `[(-1i32), 0i32]` and `[1.0f32, (-3.0f32)]`. They should print as `-1i32`.",
  },
  shapes11_20: {
    improvement: "ST `x := x;` prints `self.copied = self.copied;`, which is clippy::self_assignment (a correctness-group lint) in initseq_member_of_struct and cc3_empty_and_noop. It could be dropped when target and source are the same side-effect-free place with no conversion.",
  },
  shapes17_1: {
    improvement: "A read-modify-write through a pointer or string cursor checks the same pointer twice: iec_deref(p); on the line before, then again in `{ iec_deref(p); *__str_p }` inside the value. In the StringUtils bodies the pointer has already been tested at entry (IF p = 0 THEN RETURN), so every check inside the loops is dead. Emit the guard once per statement, and none at all after a dominating null test. Also stop copying the whole IecStr (`*__str_p`, 88+ bytes, Copy) just to read one character: `__str_p.char_at(i)` borrows it.",
  },
  shapes17_2: {
    improvement: "A character store is emitted as `*s = { ..; *s }.with_char(i, c).to();`, which copies the string by value, rebuilds it through lit() in .to() at the SAME capacity, and moves it back. An in-place `s.set_char(i, c)` (&mut self) does the same thing with no copies. More generally, skip the .to() whenever source and target capacity are the same (REPLACE: `insert(..) }.to()` 255->255, then `.to::<80>().to()` at the call site converts twice).",
    alternatives: [
      "TODAY: value-style `*s = {copy}.with_char(i,c).to()`, which keeps the IR's load/setchar/assign triple literal",
      "in-place `s.set_char(i, c)`: the shortest form with no copies, and I would choose it, since the setchar is always stored straight back into the place it loaded",
      "keep value style but drop .to() when capacities match: the smallest emitter change",
    ],
    chosen: "in-place `s.set_char(i, c)`: the shortest form with no copies, and I would choose it, since the setchar is always stored straight back into the place it loaded",
  },
  shapes17_3: {
    improvement: "The same construct, index minus lower bound, is printed two ways. A fixed array gets a plain `(i - 1i64) as usize` (emit/rust/place.ts). An ARRAY[*] dimension or a string cursor gets `(i as i64).wrapping_sub(lower as i64) as usize` or `(p as i64).wrapping_sub(1i64).wrapping_add(n as i64)`, because the offset goes through the generic IR sub/add, which prints as wrapping. Two i32 values widened to i64 cannot overflow, so the wrapping is noise. Give the open-array and cursor offset the index-step form the emitter already has (a `lower` expression on the step), so all three print `[(i - lower) as usize]`.",
  },
  shapes17_4: {
    improvement: "When one argument holds a call, EVERY argument is hoisted into its own `let __arg_N`, pure ones included (REPLACE: `let __arg_1 = str2; let __arg_2 = (p-1).max(0) as i16;`). Order only matters between arguments that have effects or read what an earlier one writes. Hoist only the call-holding arguments, plus anything evaluated before them that they could change, and leave pure locals and constants inline.",
    alternatives: [
      "TODAY: hoist all inputs when any holds a call. Simple and obviously order-preserving",
      "hoist only a prefix up to the last call-holding input. Still order-preserving, since trailing pure args cannot observe anything",
      "hoist only effectful inputs. The shortest, but it needs a purity analysis, which holdsCall almost is. I would choose the prefix rule: trivially correct and it removes the trailing lets",
    ],
    chosen: "hoist only effectful inputs. The shortest, but it needs a purity analysis, which holdsCall almost is. I would choose the prefix rule: trivially correct and it removes the trailing lets",
  },
  shapes17_5: {
    improvement: "Every call on a PROGRAM-owned instance moves the whole program out with std::mem::take, which builds a fresh PROGRAM::new() (every initialiser, every string lit) as a stand-in. It then moves it back, even when the callee never touches `prg` (FB_CS_relay20.map has `#[allow(unused_variables)]` on `prg`). Pass `prg` only to routines that transitively reach a program. Then `prg.prg_cs_station20.relay.map()` is a plain field call with no take. Re-entrancy is already refused by lowering (call-program-reentrant, verified with a probe), so the take only exists to satisfy the borrow checker.",
  },
  shapes17_6: {
    improvement: "TRUNC is printed inline as a 110-character block, `{ let t = (x as f64).trunc(); if (-2147483648.0..=2147483647.0).contains(&t) { t as i32 } else { i32::MIN } }`, at every use. REAL_TO_DINT already goes through a prelude helper (iec_r2i32). Emit an `iec_trunc_i32(v: f64) -> i32` helper next to it and call that. It is correct as it stands (NaN and out of range give i32::MIN, as measured).",
  },
  shapes17_7: {
    improvement: "INT arithmetic is widened to i32, done with wrapping ops and narrowed with `as i16`. For a chain of + - * stored straight back into an INT, i16 wrapping_* gives bit-identical results, because the ring homomorphism mod 2^16 holds. Only division, MOD, comparisons and shifts need the widening.",
    alternatives: [
      "TODAY: widen every operand to i32, wrapping_* in i32, then truncate with `as i16`. Uniform, and matches CODESYS's register width for / and comparisons",
      "native i16 wrapping_* for pure add/sub/mul chains that end in an INT store: fewer casts, same result. I would choose this for ring-only chains and keep the widening wherever /, MOD, a comparison or a shift is in the chain",
    ],
    chosen: "native i16 wrapping_* for pure add/sub/mul chains that end in an INT store: fewer casts, same result. I would choose this for ring-only chains and keep the widening wherever /, MOD, a comparison or a shift is in the chain",
  },
  shapes17_8: {
    improvement: "An ARRAY OF an interface is a `[u64; N]` of instance tags, but because the element kind is not 'elementary' it is initialised with `std::array::from_fn(|_| 0)`. Any Copy element whose init is a literal can be `[0; N]`.",
  },
  shapes17_9: {
    improvement: "An output nobody binds (f_state_split(9, ..)) is written into a persistent `pub __output_N` field of PLC_PRG (4 such fields in state_routine_outputs). A local `let mut __out = 0;` or a `&mut 0i16` temporary would keep the struct to the variables the ST declared.",
  },
  shapes17_10: {
    improvement: "A UNION whose members are all pointers is a struct of usize fields, and `u.p1_Byte := x` is followed by `u.p1_sint = u.p1_byte; u.p2_int = ..; ..` for every member. All the members share the same address, so one field would do. Relatedly, in an ANY_INT monomorph the CASE on the compile-time diSize (passed as a constant `1i32`) still emits all four arms, three of them dead reinterpretations of the caller's type.",
  },
  shapes17_11: {
    improvement: "Every parameter is `mut`, and a blanket allow hides it. The string-pointer parameters come in pairs (usize address + &mut IecString), which pushes StringUtils functions past clippy::too_many_arguments. Emit `mut` only on parameters the body assigns. For a cursor the address is always 1 unless it was stepped, so it could be omitted when never stepped. An ARRAY[*] also passes its upper bounds as arguments, when they are derivable from the slice length (lower + len - 1).",
  },
  shapes17_12: {
    improvement: "`(((uisearchstart as i32).max(1i32) as u16) as i32)` goes u16 -> i32 -> u16 -> i32. `(uisearchstart.max(1) as i32)` is the same value.",
  },
  shapes3_1: {
    improvement: "A single store into a UNION member expands to one statement per overlapping byte of every other member. Each statement is a mod/div/mul/add chain in u64, and each MOD carries a `let __mod_l..; if __mod_r == 0 {0} else {wrapping_rem}` block even though the divisor is the literal 256. c3/un.st (DWORD/ARRAY[1..2] OF WORD/ARRAY[0..3] OF BYTE/LWORD) emits about 30 lines of this for 4 ST stores.",
    alternatives: [
      "(a) TODAY: byte-wise arithmetic built in the IR, so the interpreter runs the same nodes.",
      "(b) Per member, from little-endian bytes: `let b = self.u.l.to_le_bytes(); self.u.d = u32::from_le_bytes(b[..4].try_into().unwrap()); self.u.b.copy_from_slice(&b[..4]);`. A byte-array member is written directly and a scalar goes through from_le_bytes. This needs an IR node such as `overlay(src, dst)` with a twin in the interpreter.",
      "(c) Lay the union out as one `[u8; N]` with get/set accessors per member, so no copies are needed. This is the biggest change.",
      "I would choose (b): an IR 'reinterpret bytes' node is small, keeps the interpreter in parity, and emits what a Rust engineer would write.",
    ],
    chosen: "I would choose (b): an IR 'reinterpret bytes' node is small, keeps the interpreter in parity, and emits what a Rust engineer would write.",
  },
  shapes3_2: {
    improvement: "Integer MOD by a non-zero CONSTANT still prints the zero-divisor guard block. When the right operand is a const ≠ 0 (and not -1 for signed), emit `(l % r)`. For unsigned operands, `wrapping_rem` is not needed.",
    alternatives: [
      "TODAY: the guarded block for every MOD",
      "`l % c` when c is a const outside {0, -1}",
      "I would choose the const fast path. It is correct for every input, since Rust `%` only panics on 0 and on MIN % -1.",
    ],
    chosen: "I would choose the const fast path. It is correct for every input, since Rust `%` only panics on 0 and on MIN % -1.",
  },
  shapes3_3: {
    improvement: "A constant index is printed through casts and an unfolded lower-bound subtraction: `self.pairs[(0i8 as i64) as usize]`, `self.dut_u.a_bytes[0i64 as usize]`, `self.u.w[(1i64 - 1i64) as usize]`. When step.index is a const, print `[value - lower]` as a bare usize literal.",
  },
  shapes3_4: {
    improvement: "The pointer tag arithmetic is never folded. ADR prints `1i64.wrapping_sub(-1i64) as usize` for the constant 2, and p[i] prints `(self.p as i64).wrapping_add(-1i64).wrapping_add(2i64) as usize`. Fold the constant ADR to a literal and merge the two const offsets into one. Because `iec_deref` has already rejected 0, the element index can be `self.p - 1 + k` in usize, with no i64 round trip.",
  },
  shapes3_5: {
    improvement: "The same construct, a read through a pointer or REFERENCE, is emitted two ways. A single target gives `{ iec_deref(self.ref_); self.first }` and several targets give `match self.ref_ { 1 => self.first, 2 => self.second, _ => panic!(..) }`. refdecl_rebound_by_statement shows both on adjacent lines.",
    alternatives: [
      "TODAY: guard block for 1 target, match for 2 or more",
      "A match for every arity: `match p { 1 => x, _ => panic!() }` (clippy may call a single arm match_single_binding-adjacent; still clear)",
      "The guard form for every arity, via `iec_deref(p);` plus an indexable target table. That does not fit fields of different types.",
      "I would keep today's split, since the guard form is shorter for the common case, but share one panic helper so the message and the code path are single-sourced.",
    ],
  },
}
