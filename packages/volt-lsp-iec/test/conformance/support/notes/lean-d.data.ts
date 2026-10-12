/**
 * the review's lean items (`lean.data.ts`) — part D.
 *
 * One slice of `lean.data.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a test support
 * file is held to 400 lines).
 */
export const LEAN_D = {
  shapes20_9: {
    improvement: "The same construct, moving a value out of its owner for a call and putting it back, is emitted three ways: `let mut program = std::mem::take(..)`, `let mut __program = std::mem::take(..)`, and `.clone()` then write-back for an own field lent to an own METHOD. Lowering already refuses real aliasing (`call-inout-alias`, which I probed: a method that reads the field it is lent is refused), so the clone is a copy the program never needs. Use `std::mem::take` / `std::mem::replace` everywhere. For fixed arrays longer than 32, where `[T;N]: Default` does not hold, use `std::mem::replace(&mut self.points, <init>)`. Use one binding name.",
    alternatives: [
      "(a) today, for own fields: clone, call, write back.",
      "(b) `let mut t = std::mem::take(&mut self.points); self.shift(.., &mut t); self.points = t;`, which moves and does not copy.",
      "(c) split the borrow by making the method a free fn over the fields it touches. This is a bigger change.",
      "Choose (b). It matches the program-instance form already emitted.",
    ],
    chosen: "(b). It matches the program-instance form already emitted.",
  },
  shapes20_10: {
    improvement: "Lowering temps in an FB or program body (a property-set value, an in-out index captured before the call, a pointer guard) become persistent `pub` struct fields. They show in the struct, in PartialEq/Debug and in `new()`, and they cause clippy::pub_underscore_fields. They live for one statement, so a Rust `let` in the emitted body is enough: `self.tank.level_set(5i16)`, or `let idx = self.cursor; ...`.",
  },
  shapes20_11: {
    improvement: "Passing a whole VAR_IN_OUT on to another routine prints `&mut (*values)`. Passing `values` reborrows implicitly. At minimum `&mut *values` drops the parentheses. This appears in 19 fixtures.",
  },
  shapes20_12: {
    improvement: "An index offset is printed two ways: `.wrapping_sub` for an open array and plain `-` for a declared bound. Both are i64 over an i32 or i16 index and cannot overflow, so use one form. An ARRAY[*] also carries both `__lower` and `__upper` i32 params, but the slice already has its length (upper = lower + len - 1). Passing only the lower bound shortens every signature and call. 1546 also computes the same element index twice in a read-modify-write. `let e = &mut line[i]; e.x = e.x.wrapping_add(offset);` names it once.",
  },
  shapes20_13: {
    improvement: "A bit store always emits the general block. Correctness holds: I probed INT.15, SINT.7 and LINT.63 set to TRUE, which gave -32768, -128 and i64::MIN in both backends. For a constant value the store is `self.w |= 1u16 << 3;` or `self.w &= !(1u16 << 3);`. The `&mut` alias is needed only when the place's index holds a call. For a variable value, a branch-free `self.w = (self.w & !m) | (u16::from(v) << 3)` also works.",
    alternatives: [
      "(a) today: bind the value and the place, then choose with an if.",
      "(b) a literal TRUE/FALSE gives `|=` / `&= !`; a pure place writes directly; the block stays only when the index holds a call.",
      "(c) branch-free `(x & !m) | (T::from(v) << i)`.",
      "Choose (b), with (c) for a variable value.",
    ],
    chosen: "(b), with (c) for a variable value.",
  },
  shapes20_14: {
    improvement: "A dispatch used as a statement prints `(match ..);`, which is clippy::unnecessary_semicolon (2 in itf_call_dispatches_on_instance). As a statement it can be a bare `match .. { .. }`. A method call on a lent instance prints `(*__lent_N).take(..)`. Auto-deref makes `__lent_N.take(..)` the same call, as place() already relies on for field and index steps.",
  },
  shapes20_15: {
    improvement: "A store through a pointer that also reads through the same pointer checks for null twice in a row: once on the guard line and once in the value block. The guard line already covers the read. Each ANY_INT monomorph still receives its diSize as a `mut input: i32` param and emits `match input`, though since transpile-review 17 only the arm for its own size is lowered (the others dereferenced pValue as a type it is not), so the match has one arm and the param could be dropped.",
  },
  shapes12_1: {
    improvement: "A nested array whose element is Copy is built with std::array::from_fn closures. `[[[0i16; 3]; 2]; 2]` is the direct form. initOf already has isCopy (emit/rust/types.ts), and its test should be isCopy(array.element) instead of array.element.kind === 'elementary'.",
  },
  shapes12_2: {
    improvement: "A constant index is printed as a typed literal, then cast, then offset at run time: `self.partial[((5i8 as i64) - 1i64) as usize]`. When step.index is a const, print the folded usize (`[4]`). rustc would also reject an out-of-range constant at compile time, as it already does for array_index_const_out_of_bounds.",
    alternatives: [
      "TODAY: `[((5i8 as i64) - 1i64) as usize]`: uniform, but noisy",
      "fold in the emitter when step.index.kind === 'const': `[4]` (my choice: one line in place(), and a constant OOB becomes a compile error)",
      "fold in lowering (index node already LINT const minus lower): same output, but the interpreter would share it",
    ],
    chosen: "fold in the emitter when step.index.kind === 'const': `[4]`, and a constant OOB becomes a compile error)",
    why: "one line in place(",
  },
  shapes12_3: {
    improvement: "A pointer's element index is built as cursor + (lower - 1), which gives `(self.cursor as i64).wrapping_add(-1i64) as usize`. ADR(slots[0]) is built as `0i64.wrapping_sub(-1i64) as usize` instead of the constant 1. Fold the constant when last.index is a const. Emit the dereference index in the same form array subscripts use (`(x - 1i64)`), or as `self.cursor - 1`: iec_deref has already proved the cursor non-zero, so it cannot underflow. Today pointer indices and array indices are two spellings of one operation.",
    alternatives: [
      "TODAY: `(c as i64).wrapping_add(-1i64) as usize` for the pointer, `(i as i64 - 1i64) as usize` for arrays",
      "`self.slots[self.cursor - 1]`: the cursor is usize and non-null after iec_deref (my choice)",
      "express the dereference as an index step with lower = 1 so the same place() code prints it",
    ],
    chosen: "`self.slots[self.cursor - 1]`: the cursor is usize and non-null after iec_deref",
  },
  shapes12_4: {
    improvement: "MOD always gets the zero-divisor block, even for a nonzero constant divisor: `{ let __mod_l = ..; let __mod_r = 256u64; if __mod_r == 0 { 0 } else { __mod_l.wrapping_rem(__mod_r) } }`. When e.right is a nonzero const, print `(l % r)` (or `.wrapping_rem` for a signed MIN % -1). The union overlay also builds each byte with div/mod/mul on u64, where `(w >> 8) as u8` or `(w & 0xFF00) | b as u16` says the same thing. A u8 value % 256 is the identity.",
    alternatives: [
      "TODAY: guarded block for every integer MOD",
      "const nonzero divisor → `(l % r)`; keep the guard only for a runtime divisor (my choice: MOD by a literal is the common case)",
      "unions: to_le_bytes/from_le_bytes round-trip per member, which is shorter but a different IR the interpreter would need to mirror",
    ],
    chosen: "const nonzero divisor → `(l % r)`; keep the guard only for a runtime divisor",
    why: "MOD by a literal is the common case",
  },
  shapes12_5: {
    improvement: "An inout FB or struct passed on, or called, is printed as `(*target).call()`, `(*target).dim()` and `m(4i32, &mut (*book))`. Method calls auto-deref, and a `&mut T` binding reborrows implicitly when passed. Print `target.call()` and `f_x3_mark(4, book)`, the same exemption the emitter already makes for `.x` and `[i]`.",
  },
  shapes12_6: {
    improvement: "A character read through a string cursor copies the whole IecStr out of the borrow: `{ iec_deref(p); *__str_p }.char_at(i)` is 256+ bytes per character, so O(n²) per LEN/TRIM/COPY loop. A write guards twice and copies twice: `iec_deref(p); *__str_p = { iec_deref(p); *__str_p }.with_char(..).to();`. Put the guard around the whole method call (`{ iec_deref(p); __str_p.char_at(i) }`) and add an in-place `set_char(&mut self, i, c)` to the prelude for stores.",
    alternatives: [
      "TODAY: value-semantics with_char(self) -> Self, plus a copy out of the borrow",
      "`&mut self` set_char plus a guard around the call (my choice: same semantics, and the interpreter's setChar needs no change)",
      "keep with_char but guard the call rather than the load: removes the read copy only",
    ],
    chosen: "`&mut self` set_char plus a guard around the call",
    why: "same semantics, and the interpreter's setChar needs no change",
  },
  shapes12_7: {
    improvement: "Every string store appends `.to()`, a truncating copy through lit, even when the value already has the target's capacity. Examples: `left = left.with_char(..).to()`, `concat = str1.to()`, and `self.left_two = left(..).to::<80>().to()`, which converts twice. Skip `.to()` when rustType(s.value.type) === rustType(into) and the target is not a generic-capacity inout.",
  },
  shapes12_8: {
    improvement: "Every input parameter is `mut`, whether or not the body assigns it, and the resulting warnings are silenced with #[allow(unused_mut, unused_variables, unused_assignments)]. Print `mut` only for parameters the body writes (the IR knows which slots are assignment targets), and drop the allow.",
  },
  shapes12_9: {
    improvement: "A pointer whose only target is a whole variable is the constant 1 (`pointer_to_value = 1;`), and each dereference still emits `{ iec_deref(pointer_to_value); *value }`. A borrowed pointer parameter is passed as a dead `0` (`f_lang_ptrread(0, &mut self.value)`) that the body never reads. The same goes for the string-cursor calls `strtrima_pstring_string20(1, &mut self.both)`. When the pointer slot is only ever stored constants ≠ 0, skip the guard. When the callee never reads the integer, drop the parameter.",
  },
  shapes12_10: {
    improvement: "Each routine declares `let mut f: T = 0; f = expr; f`, where `expr` as the tail is the idiomatic form. Each FOR prints `i = 0i32;` right after `let mut i: i32 = 0i32;`. Both are dead stores. When the result is assigned exactly once as the last statement, return the expression. Otherwise the pattern is correct and only verbose.",
  },
  shapes12_11: {
    improvement: "LEN copies the argument into a STRING(255) by value, then counts it one char_at at a time. IecStr already stores `len`. Emitted by hand, LEN is `s.units().len() as i16` (the truncation to 255 is `.min(255)`). Library bodies are ST by design (only s[i] and TIME() are primitives), so this is a trade-off rather than a defect.",
    alternatives: [
      "TODAY: ST library body, one source for both backends, O(n) plus a copy",
      "a prelude intrinsic for LEN_INTERNAL only (`units().len()`), which every other string function calls, so one primitive speeds them all (my choice)",
      "intrinsics for every Standard string function: fastest, but it re-creates the TS/Rust twin the library repo was built to delete",
    ],
    chosen: "a prelude intrinsic for LEN_INTERNAL only (`units().len()`), which every other string function calls, so one primitive speeds them all",
  },
  shapes12_12: {
    improvement: "Arithmetic whose operands are all literals is not folded in a body. `self.di := 30000 + 30000` is emitted as `30000i64.wrapping_add(30000i64) as i32` instead of `60000i32`. Lowering already has the exact evaluator (`builtinValue`/`arith`, the one the declaration folding uses), so running it over an all-const binary node gives the recorded value by construction.",
    alternatives: [
      "A: emit the unfolded i64 wrapping_add then cast (emitted today)",
      "B: fold in lowering with the shared semantics/fold.ts table and emit a typed literal (preferred: CODESYS itself folds at compile time, and the value comes from the one table both backends use)",
      "C: leave it to rustc/LLVM const-folding (the same machine code, but the source stays noisy)",
    ],
    chosen: "B: fold in lowering with the shared semantics/fold.ts table and emit a typed literal",
    why: "CODESYS itself folds at compile time, and the value comes from the one table both backends use",
  },
  shapes12_13: {
    improvement: "SINT/INT add, sub and mul are widened to DINT and narrowed back: `(self.si as i32).wrapping_add(1i32) as i8`. When the node's only consumer is a store or conversion back to the operand's own width, `self.si.wrapping_add(1i8)` gives the same answer, because wrapping add/sub/mul commute with truncation mod 2^n. Division, MOD, comparisons and wider stores still need the promotion (SINT -128 / -1 is measured to be 128 in DINT).",
    alternatives: [
      "A: always promote to i32 and cast back (emitted today; uniform, and the promotion is what CODESYS measures)",
      "B: narrow-width wrapping op when the result converts straight back to the operand width and op is in {add,sub,mul} (preferred for readability; exact by modular arithmetic)",
      "C: keep the promotion in the IR and peephole `(x as i32).wrapping_add(c) as i8` in the emitter (smaller change, but a second place that knows the rule)",
    ],
    chosen: "B: narrow-width wrapping op when the result converts straight back to the operand width and op is in {add,sub,mul} (preferred for readability; exact by modular arithmetic)",
  },
  shapes12_14: {
    improvement: "MAX/MIN of a REAL variable and an untyped real literal goes through f64 and back: `(self.n as f64).max(2.5f64) as f32`. max/min only select one of their inputs, so when the literal is exactly representable in f32 the answer equals `self.n.max(2.5f32)`. Arithmetic (+ - * /) must keep the widening, because it changes rounding.",
    alternatives: [
      "A: widen to f64 and cast back (emitted today; uniform with arithmetic)",
      "B: keep f32 for selection builtins when every constant round-trips through f32 exactly (preferred: the same value with no casts)",
    ],
    chosen: "B: keep f32 for selection builtins when every constant round-trips through f32 exactly",
    why: "the same value with no casts",
  },
  shapes16_1: {
    improvement: "Every store into a string gets another `.to()`, even when the value already has the target's capacity. That covers `left(...).to::<80>().to()`, `x = x.with_char(..).to()` and `IecString::<80>::lit(b\"..\").to()`. The extra `.to()` is an identity copy through lit(). Append it only when the target capacity is a generic (the VAR_IN_OUT case the comment is about) or differs from the value's type.",
  },
  shapes16_2: {
    improvement: "A character read through a string cursor prints `{ iec_deref(p); *__str_p }.char_at(i)`. The block's tail moves the WHOLE IecString out (it is Copy) just to read one byte. Loops such as StrLenA, StrFindA and the null-cursor length therefore copy the whole string once per character, which makes an O(n) walk O(n*N). Return a borrow instead (`{ iec_deref(p); &*__str_p }.char_at(i)`) or put the check inside the index. A write prints `iec_deref(p);` on its own line and then the same guard again inside the value, so each character store checks the pointer twice.",
  },
  shapes16_3: {
    improvement: "`s[i] := c` is lowered as a value, `s = s.with_char(i, c).to()`. That makes three whole-string moves or copies per character: self by value, the return, and `.to()`. A statement-level setchar could print `s.set_char(i, c);` with `set_char(&mut self, ..)`.",
    alternatives: [
      "Today: an expression `x = x.with_char(i,c).to()`, which the value-semantics IR uses for every character store, including through cursors (`*p = { iec_deref(q); *p }.with_char(..).to()`).",
      "In-place `x.set_char(i, c)` when a setchar's source and target are the same place: this is what I would choose. It is one bounds check and a one-byte write. The IR already knows target == source.",
    ],
    chosen: "In-place `x.set_char(i, c)` when a setchar's source and target are the same place: this is what I would choose. It is one bounds check and a one-byte write. The IR already knows target == source.",
  },
  shapes16_4: {
    improvement: "The MOD-by-zero guard is printed even when the divisor is a non-zero constant, e.g. `{ let __mod_l = self.n as i32; let __mod_r = 2i32; if __mod_r == 0 { 0 } else { __mod_l.wrapping_rem(__mod_r) } }`.",
    alternatives: [
      "Today: the let-bound guard block for every integer MOD.",
      "Constant divisor ≠ 0 and ≠ -1: `(l % 2i32)`. This is what I would choose. `%` truncates toward zero exactly like IEC MOD and cannot panic for such a divisor.",
      "Constant divisor -1: `l.wrapping_rem(-1)`, or `0`, pending the MIN MOD -1 recording above.",
      "Variable divisor: keep the guard (shape 3357f26b8d needs it).",
    ],
    chosen: "Constant divisor ≠ 0 and ≠ -1: `(l % 2i32)`. This is what I would choose. `%` truncates toward zero exactly like IEC MOD and cannot panic for such a divisor.",
  },
  shapes16_5: {
    improvement: "Comparisons between same-typed narrow operands, or against a literal that fits, are printed in DINT: `((self.n as i32) == 1i32) | ((self.n as i32) == 3i32)` and `(c as i32) != 0i32` for a u8 char. Comparing in the operands' own type gives the same answer whenever both sides share a type (or the literal fits it). Promotion only matters for mixed signedness or mixed widths.",
    alternatives: [
      "Today: always promote to DINT/LINT and cast each operand.",
      "Compare in the common type when the operands' types are equal (or a const fits): `self.n == 1`, `c != 0`. This is what I would choose, because it gives identical results and drops two casts per comparison.",
      "A further step for OR chains of equality against constants: `matches!(self.n, 1 | 3)`, or `matches!(c, 9..=13 | 32 | 160)` for lib_stu_trim's IsSpace. It is shorter but a bigger emitter change.",
    ],
    chosen: "Compare in the common type when the operands' types are equal (or a const fits): `self.n == 1`, `c != 0`. This is what I would choose, because it gives identical results and drops two casts per comparison.",
  },
  shapes16_6: {
    improvement: "Narrow arithmetic stored straight back into its own width is computed in DINT and truncated: `x = (x as i32).wrapping_mul(3i32).wrapping_add(y as i32) as i16`. For + - * the low 16 bits do not depend on the width, so this equals `x.wrapping_mul(3).wrapping_add(y)`. The widening only matters when the result is divided, compared, shifted right or stored wider.",
    alternatives: [
      "Today: promote, then wrapping_* in i32, then `as i16`. This is correct for every consumer.",
      "When the whole tree is + - * (with no DIV/MOD/compare/shift inside) and the store target has the operands' width: compute in that width with wrapping_*. This is what I would choose. It is bit-identical and drops 2-3 casts per line.",
      "Keep the promotion everywhere and just accept the casts. This is the simplest rule and is what the interpreter mirrors.",
    ],
    chosen: "When the whole tree is + - * (with no DIV/MOD/compare/shift inside) and the store target has the operands' width: compute in that width with wrapping_*. This is what I would choose. It is bit-identical and drops 2-3 casts per line.",
  },
  shapes16_7: {
    improvement: "An index prints `[(i as i64) as usize]`. On a 64-bit target, `i as usize` is bit-identical for every integer i (sign-extension is the same), so the i64 hop only earns its place when a lower bound is subtracted. A literal index prints `[(1i8 as i64) as usize]` where `[1]` is enough. The lower-bound form uses plain `-` (`((self.i as i64) - 1i64) as usize`), while the same subtraction written in ST prints `.wrapping_sub`, so the same construct has two spellings.",
    alternatives: [
      "Today: always castTo i64, then `as usize` or `(.. - lower) as usize`.",
      "lower == 0: `[i as usize]`, and a const index folded to `[k]`. This is what I would choose.",
      "lower != 0 with a const index: fold `k - lower` at emit time.",
    ],
    chosen: "lower == 0: `[i as usize]`, and a const index folded to `[k]`. This is what I would choose.",
  },
  shapes16_9: {
    improvement: "StrFindA's `MAX(uiSearchStart, 1) - 1` prints `(((uisearchstart as i32).max(1i32) as u16) as i32).wrapping_sub(1i32)`. That promotes, narrows back to UINT (a no-op, because the max of two UINTs is a UINT), and then promotes again. `(uisearchstart.max(1) as i32) - 1`, or the u16 max followed by one widening, is the same value.",
  },
  shapes16_10: {
    improvement: "A cursor index is built as `sub(p,1)` then `add(extra)` without folding. For `p^[1]` that prints `(p as i64).wrapping_sub(1i64).wrapping_add(1i64)`. When extra is a constant, fold it to `(p as i64) + (extra-1)`, or to `p as i64` for extra == 1.",
  },
  shapes16_11: {
    improvement: "LEN/LEFT/RIGHT/MID/CONCAT/INSERT/DELETE/REPLACE/FIND take `mut str: IecString<255>` BY VALUE. Every call site therefore converts `self.hello.to::<255>()` (a 256-byte copy through lit), and every result comes back as `.to::<80>()`. LEN then walks 255 bytes with char_at in a loop capped at 1e6 iterations, although the length is `s.len`. The xo3 WSTRING chain `.narrow::<80>().to::<10>().to()` is three copies for one conversion (the operand keeps its own capacity since transpile-review 11, so the leading `.to::<80>()` is gone). The 255 cut on the way in is measured (string_input_truncation), so a generic `&IecStr<N>` parameter would need an explicit `min(len, 255)` view to stay right.",
    alternatives: [
      "Today: monomorphic STRING(255) by value, the ST body run as written, conversions at both ends.",
      "A generic `<const N>` borrow with the 255 cut applied as a view (units()[..min(len,255)]): this removes both copies and keeps the body.",
      "Narrow straight to the target (`narrow::<10>()`), since narrow already truncates at M. This is the cheap fix for shape 08b9196831.",
    ],
  },
  shapes16_12: {
    improvement: "A VAR_IN_OUT CONSTANT given a LITERAL is still bound to a `let __copy_1 = IecString::<80>::lit(b\"abc\");` before the call. The reason for the copy (E0503, a copy of x beside &mut x) cannot arise for a literal, so `&IecString::<80>::lit(b\"abc\")` inline is enough, because the temporary lives for the whole call. The scalar CONSTANT in-out is also passed as `&i16`, where a value would be leaner.",
  },
  shapes16_13: {
    improvement: "An aggregate initializer prints `{ let mut v = T::new(); v.first = ..; v.last = ..; v }`. Struct-update syntax, `T { first: .., last: .., ..T::new() }`, is the idiomatic single expression and needs no mut binding. For an FB, keep the block form if its fields are private or new() has side effects.",
  },
  shapes16_14: {
    improvement: "A borrowed in-out passed on is printed `&mut (*__str_pstfrom)` (a needless reborrow spelling; `__str_pstfrom` or `&mut *__str_pstfrom` will do). len_internal reads `(*str).char_at(..)`, where auto-deref makes the `(*..)` redundant (clippy explicit_auto_deref territory).",
  },
  shapes16_15: {
    improvement: "An ARRAY[*] parameter is passed as `(mut __x_lower_N: i32, mut __x_upper_N: i32, x: &mut [T])`. The slice already carries its length, so the upper bound is always `lower + len - 1`. Passing only the lower bound, or deriving upper from `x.len()`, removes one parameter per dimension and one argument per call. `mut` is printed on bound parameters that are never assigned; it is silenced by allow(unused_mut) rather than left out.",
    alternatives: [
      "Today: pass both bounds as i32, with `mut` on each.",
      "Pass lower only; compute UPPER_BOUND as `lower + x.len() as i32 - 1`. This is what I would choose.",
      "Keep both, but drop `mut` when the IR never assigns the slot.",
    ],
    chosen: "Pass lower only; compute UPPER_BOUND as `lower + x.len() as i32 - 1`. This is what I would choose.",
  },
  shapes16_16: {
    improvement: "A nested call argument is hoisted into a `let __arg_0` even when it is the only argument, so evaluation order cannot differ. `len(concat(..))` is the same program.",
  },
  shapes8_9: {
    improvement: "This line is correct for every input, because a BOOL's declared or default initial value is a literal. Nothing needs to change. Several spellings would be correct here, so the options are listed below. Shape 496b8acb56 is the same emission: the normalizer in test/conformance/support/transpile/shape.ts (its KEEP set) keeps `g` as a reserved word (it stands for the globals parameter), so a field that happens to be named `g` (sel_sel_false, sel_sel_true, ct_bit_packing_sizes) was counted as a separate shape. That is a quirk of the review tool, not of the transpiler.",
    alternatives: [
      "Explicit literal `x: false,` inside `new()`, with `impl Default` calling `Self::new()`. This is emitted today and is the one I would keep: it is the shortest, it states the IEC initial value at the declaration, and it is the same path used for every other elementary init.",
      "`x: Default::default(),` or `..Default::default()`: this hides the declared value, only works for fields whose init is the type's zero, and needs a derived Default, which Rust refuses for arrays longer than 32 (emit/rust/structs.ts gives this reason).",
      "`#[derive(Default)]` plus `new() { Self::default() }` when every field has its zero init: this would remove the per-field lines in some structs, but the struct shape would then depend on the init values, which breaks 'the same construct always emitted the same way'.",
    ],
  },
  shapes8_10: {
    improvement: "The call itself is correct and lean. I probed INT wrap at 32767 -> -32768 and -1 -> 0 through outer->inner, and both match CODESYS's wrap. The in-frame specialization in lower/calls/specialize.ts is also correct for the aliasing cases (a:=n, b:=n gives 6 in CODESYS). The waste is in the lines around the call: every generated routine gets `#[allow(unused_mut, unused_variables, unused_assignments)]`, including `outer`, `inner` and `two_a_0_b_0`, which have no parameters and no locals, so none of the three lints can fire. Emit the attribute only when the routine declares at least one local or in-out/lent parameter, and only name the lints that can apply (for example `unused_mut`/`unused_assignments` only when there are locals). The comment says the lints are 'verified load-bearing', but that holds only for routines that have bindings.",
  },
  shapes8_11: {
    improvement: "SEL binds both arms eagerly so that side effects match the interpreter, and that is right in general. When every argument is a side-effect-free place or literal, though, the eager block is the same as a plain `if`. Separately, widening INT to i32 and narrowing back is a no-op for a selection; the promotion comes from lowering treating SEL like arithmetic.",
    alternatives: [
      "Eager block with i32 widening. This is emitted today; it is always correct but costs 3 temporaries and 3 casts.",
      "`if self.g { self.b } else { self.a }` when all arms are pure (no invoke, dispatch or call in the IR, which is the same test as callsNothing in lower/calls/specialize.ts) and the arms are not promoted. I would choose this: it is what a Rust engineer writes and gives an identical result, because selecting between two i16 values cannot overflow.",
      "Keep the eager block but drop the widening: `let __sel_f = self.a;` and no trailing `as i16`. This is a smaller change with the same correctness.",
    ],
    chosen: "`if self.g { self.b } else { self.a }` when all arms are pure (no invoke, dispatch or call in the IR, which is the same test as callsNothing in lower/calls/specialize.ts) and the arms are not promoted",
    why: "it is what a Rust engineer writes and gives an identical result, because selecting between two i16 values cannot overflow.",
  },
  shapes9_1: {
    improvement: "A conversion already builds an IecString<80>, and the assignment then always adds `.to()`, which copies it into an IecString<80> again. That is a second 80-byte copy with no effect. Skip `.to()` when the value's static capacity equals the target's, or build the literal straight at the target capacity when it is ≥ the conversion's 80.",
  },
  shapes9_2: {
    improvement: "`lit(..).to::<12>().to()`: the explicit truncating copy into STRING(12) is followed by a second same-capacity `.to()`. Drop the outer copy when the capacities match; with the lean above, this becomes a single `IecString::<12>::lit(..)`.",
  },
  shapes9_3: {
    improvement: "`(a as i32).wrapping_add(b as i32) as i16` when a, b and the destination are all INT. Addition, subtraction and multiplication modulo 2^32 truncated to 16 bits equal the same operations modulo 2^16, so the native-width call gives the same result.",
    alternatives: [
      "A (emitted today): promote both operands to the DINT register, wrap there, truncate with `as i16`. This mirrors the IR, which always promotes, and is what clippy flags as cast_lossless and cast_possible_truncation (36 + 21 + 16 + 6 hits across these shapes).",
      "B: a peephole in emit/rust/convert.ts: when a convert-to-T wraps a binary add/sub/mul whose operands are both converts from T, print `a.wrapping_add(b)` in T. The results are identical, and it removes 3 casts per line.",
      "C: `i32::from(a)` instead of `a as i32` for the widening only. That silences cast_lossless but keeps the round trip.",
      "Choose B for add/sub/mul (it is exact) and keep A for div, where INT_MIN / -1 must not panic (measured arithedge_int_div_min_by_minus_one = -32768) and for comparisons that mix signedness.",
    ],
    chosen: "B for add/sub/mul (it is exact) and keep A for div, where INT_MIN / -1 must not panic (measured arithedge_int_div_min_by_minus_one = -32768) and for comparisons that mix signedness.",
  },
  shapes9_4: {
    improvement: "`{ let __mod_l = v; let __mod_r = 86400000000000u64; if __mod_r == 0 { 0 } else { __mod_l.wrapping_rem(__mod_r) } }`: the divisor is a nonzero literal (every calendar conversion lowers to this), so the zero check and both bindings are dead. Print `(v % 86_400_000_000_000u64)` when the right operand is a nonzero constant; wrapping_rem is only needed for a signed divisor of -1.",
  },
  shapes9_5: {
    improvement: "`(if false { 10i64 } else { 20i64 }) as i16`: the literals are typed i64 and then cast, and a constant selector could be folded.",
    alternatives: [
      "A (emitted today): a plain `if` — only the selected arm is evaluated (transpile-review-2026-09-29 task 41).",
      "C: fold SEL with a constant selector to the chosen arm, and type literal arms as the result type (10i16) instead of LINT.",
    ],
    chosen: "C: fold SEL with a constant selector to the chosen arm, and type literal arms as the result type (10i16) instead of LINT.",
  },
  shapes9_6: {
    improvement: "`(match k { 0 => self.a as i32, 1 => self.b as i32, _ => self.c as i32 }) as i16` for INT inputs into an INT destination: the widening per arm and the narrowing afterwards cancel out (20 cast lints). Emit the match in the inputs' own type when it equals the destination's.",
  },
  shapes9_8: {
    improvement: "`{ let mut __program = std::mem::take(&mut prg.x); __program.boot(prg); prg.x = __program; };` builds a whole default program (arrays, strings included) and moves it twice on every call, even when the callee never reads `prg` (its fn carries #[allow(unused_variables)] for exactly that). When the callee's body does not reach Programs, call `prg.x.call()` directly and drop the prg parameter. The statement form also carries a stray `;` after the block.",
  },
  shapes9_9: {
    improvement: "`pub fn fb_init(&mut self, prg: &mut Programs, mut b_init_retains: bool, mut b_in_copy_code: bool) -> bool { let mut fb_init: bool = false; …; fb_init }` marks inputs mut even though they are never written, then suppresses the result with #[allow(unused_mut, unused_variables, unused_assignments)]. Emit `mut` only for inputs the body assigns (the IR knows the stores), and drop the allow.",
  },
  shapes9_10: {
    improvement: "`iec_deref(self.ref_); self.n = ({ iec_deref(self.ref_); self.n } as i32)…`: the same pointer is null-checked twice in one statement, once for the store target and once for the read. Skip a read guard whose guard place equals the target's guard, which has already run on the previous line.",
  },
  shapes9_11: {
    improvement: "`((x as f64).sqrt() as f32)` for SQRT of a REAL.",
    alternatives: [
      "A (emitted today): widen to f64, sqrt, narrow. This matches the interpreter's float64 Math path by construction.",
      "B: `x.sqrt()` on f32. IEEE sqrt is correctly rounded, and f64 has more than 2*24+2 bits, so the double rounding is innocuous and the result is bit-identical for every input. That does NOT hold for ln/sin/exp, which must stay on A.",
      "Choose B for sqrt only; it removes 2 casts per call.",
    ],
    chosen: "B for sqrt only; it removes 2 casts per call.",
  },
  shapes9_12: {
    improvement: "`a & (b | (c & !d))` on plain BOOL loads: clippy::needless_bitwise_bool.",
    alternatives: [
      "A (emitted today): `&`/`|` always, so a call on the right side runs in both backends (the reason given in emit/rust/expr.ts).",
      "B: `&&`/`||` when the right operand is side-effect free (loads, constants, comparisons of loads). The results are identical, and it is what a Rust engineer writes.",
      "Choose B only for pure right operands; the current rule is still needed when the right side can have effects.",
    ],
    chosen: "B only for pure right operands; the current rule is still needed when the right side can have effects.",
  },
  shapes9_13: {
    improvement: "A widening that cannot lose information (i16→i32, u32→i64, f32→f64) is printed `x as T`. `T::from(x)` states that it is lossless and is what clippy asks for. Choose it only for widenings; wrapping narrowings must keep `as`.",
  },
}
