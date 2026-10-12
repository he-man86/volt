/**
 * the review's lean items (`lean.data.ts`) — part C.
 *
 * One slice of `lean.data.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a test support
 * file is held to 400 lines).
 */
export const LEAN_C = {
  shapes3_6: {
    improvement: "Every call of a PROGRAM becomes `{ let mut program = std::mem::take(&mut prg.p); program.call(prg); prg.p = program; }`, even when the program's body never touches `prg`. That costs a full `P::new()` (all arrays and strings initialised) per call, plus a `#[allow(unused_variables)]` for the unused `prg`. Seen in c3/prgin.st, init_slot_program_own and sn_program_mismatch. Pass `prg` only to programs that reach Programs, and call them as `prg.p.call()` with no take. The two sites also disagree on the temporary's name (`__program` vs `program`). The method form at 599 leaves a trailing `};` in statement position (init_slot_program_own.rs:67), which is clippy unnecessary_semicolon.",
    alternatives: [
      "TODAY: mem::take on every program call (requires Default)",
      "A direct `prg.p.call()` when the callee's closure does not reach Programs, with take kept for the rest",
      "Split borrows: pass only the other programs' fields. This is a larger change.",
      "I would choose the second option. It is a static fact lowering already computes (it refuses self-reentry).",
    ],
    chosen: "I would choose the second option. It is a static fact lowering already computes (it refuses self-reentry).",
  },
  shapes3_7: {
    improvement: "A structured initial value is emitted as a block that mutates a fresh value: `{ let mut v = T::new(); v.x = 1i16; v.y = 2.5f32; v }`, nested for a struct inside a struct. Struct update syntax, `T { x: 1i16, y: 2.5f32, ..T::new() }`, is the idiomatic single expression and needs no shadowed `v`.",
  },
  shapes3_8: {
    improvement: "`let c = if v < 0.0 { -((-v).round()) } else { v.round() };` equals `v.round()` for every f64, because f64::round already rounds half away from zero symmetrically (including -0.0 and NaN). The measured table (r2ilad_*, r2i_*_nan/inf, trunc_beyond_dint) otherwise matches both helpers; I found no wrong input.",
  },
  shapes3_9: {
    improvement: "Every METHOD, ACTION and FUNCTION carries `#[allow(unused_mut, unused_variables, unused_assignments)]` (438 of 2333 files), including bodies with no locals or parameters at all, such as `widen`, `clamp` and `narrow`. Emit each allow only when the routine has a local, parameter or initialiser that can trigger it.",
  },
  shapes3_10: {
    improvement: "LIMIT over INT operands is printed widened and narrowed back: `(self.i_raw as i32).max(0i32).min(100i32) as i16`. The result of min/max over same-typed operands cannot leave that type, so `self.i_raw.max(0i16).min(100i16)` is equal for all inputs. Skip the promotion for min, max and limit when all operands share a type.",
  },
  shapes3_11: {
    improvement: "Conversions and divisions of CONSTANTS are not folded: `true as u8`, `5u8 as u32`, `-1i8 as i16`, `300i32 as i8` (=44), `5u8 != 0`, `iec_div(1.0f64, 3.0f64)`, and a whole TRUNC range-check block on `(-2.7f64)`. When the operand is a const, print the converted literal. When a real divisor is a non-zero const, print `/` instead of `iec_div`.",
  },
  shapes3_12: {
    improvement: "The in-out binding dispatch prints as `(match self.derived.__inout_binding { 1 => self.derived.bump(&mut self.v), _ => panic!(..) });` as a statement. The parentheses plus `;` are what clippy::unnecessary_semicolon names. Forwarding an in-out prints `self.add_ten(&mut (*shared))` where `shared` is already `&mut i16`, so a plain `self.add_ten(shared)` is enough. The tag field is `pub __inout_binding: i32` (clippy pub_underscore_fields).",
  },
  shapes3_13: {
    improvement: "In set_reset_chained, the S=/R= chain temporary is a pub struct FIELD (`self.__chain_value_3 = self.c;`) rather than a local `let`, which adds a pub_underscore_fields lint and bloats state. A local `let c = self.c;` is enough because the value never lives across scans.",
  },
  shapes18_1: {
    improvement: "Per-call scratch in an FB or PROGRAM body (a discarded VAR_OUTPUT `__output_N`, a property-setter value `__property_N`, an in-out guard or index `__inout_guard_N`/`__inout_index_N`) becomes a persistent `pub` struct field. It gets initialised in new(), carried by Clone/PartialEq/Debug, and trips clippy::pub_underscore_fields. The same temp inside a METHOD is a `let mut` local (tempPlace's routineMode branch), so one construct is emitted two ways. A body could collect these as locals too: a `let mut __output_10 = 0i16;` at the top of call()/scan(), or declared at the statement. The value never outlives the statement that writes it.",
  },
  shapes18_2: {
    improvement: "A property write `inst.P := v` always goes through a temp: `let mut __property_0: i16 = 0i16; __property_0 = v; self.level_set(__property_0);`, or `self.__property_1 = 100i16; self.fb_upw.threshold_set(self.__property_1);`. You only need the temp when evaluating the value needs a `&mut` borrow that overlaps the receiver, e.g. `self.level_set(self.level_get() + 5)` where the getter takes `&mut self`. For a literal or a plain field read, `self.fb_upw.threshold_set(100i16)` compiles and does the same thing. The alternative is to pass the value straight in as the invoke input and bind a temp only when the value contains an invoke on the same instance.",
    alternatives: [
      "temp always, as today: simple, and every borrow shape compiles",
      "direct argument when the value has no invoke, `let` temp otherwise (my choice: most property writes are literal or field reads)",
    ],
    chosen: "direct argument when the value has no invoke, `let` temp otherwise",
    why: "most property writes are literal or field reads",
  },
  shapes18_3: {
    improvement: "Passing a lent instance or an in-out on to another call prints `&mut (*__lent_0)`, and a method call on an in-out string prints `len((*text).to::<255>())`. `__lent_0` is already a `&mut T`, so passing `__lent_0` reborrows implicitly (or `&mut *__lent_0` without the parentheses). Method calls auto-deref, so `text.to::<255>()` works. Fix: in the `&mut` argument path at :435, if the place is a bare borrowed root (inout/lent, empty path), emit the name alone. Also treat a following method call like a field step in deref().",
  },
  shapes18_4: {
    improvement: "castTo wraps a constant in a cast even though its value is known. Today: `2882343476u32 as u64`, `self.slots[(0i8 as i64) as usize]`, `self.mask.wrapping_shl(20i8 as u32)`, `rotate_right(4i8 as u32)`. When the operand is an IR const that fits the target type, print the literal in the target type instead: `2882343476u64`, `self.slots[0]`, `wrapping_shl(20)`. The value is identical: an in-range constant keeps its value through `as`, and a negative shift count can still go through the cast. Removes clippy cast_lossless/cast_possible_truncation/cast_sign_loss on these lines.",
  },
  shapes18_6: {
    improvement: "Comparing an INT to a literal widens both sides: `(i_value as i32) < 0i32`, `(path.used as i32) < 3i32`, `(self.n as i32) <= 12i32`. That is always correct, and the lowering comment explains why: a narrow compare against an out-of-range literal (`i < 40000`) would be wrong. When the constant fits the variable's own type, though, `i_value < 0` gives the same answer and reads the way you would write it.",
    alternatives: [
      "widen both sides always (today): one rule and never wrong, but costs a cast and clippy::cast_lossless on every narrow compare",
      "compare in the narrow type when the other side is a constant that fits it, widen otherwise (my choice: same answers, the common case of `x < 3` becomes idiomatic, and out-of-range literals keep the widened form)",
    ],
    chosen: "compare in the narrow type when the other side is a constant that fits it, widen otherwise",
    why: "same answers, the common case of `x < 3` becomes idiomatic, and out-of-range literals keep the widened form",
  },
  shapes18_7: {
    improvement: "INT division by a nonzero constant other than -1 prints as `((value as i32) / 10i32) as i16`. With a constant divisor d where d != 0 and d != -1, the quotient always fits the dividend's own width, so `value / 10i16` in i16 gives the same answer and cannot panic. The widening only matters for a variable divisor (MIN / -1 must wrap in SINT/INT and not trap, which is measured).",
    alternatives: [
      "widen, divide, narrow (today): uniform, and correct for the variable-divisor MIN/-1 case",
      "narrow division when the divisor is a constant other than 0 and -1 (my choice for constants, keep the widening for variables)",
    ],
    chosen: "narrow division when the divisor is a constant other than 0 and -1 (my choice for constants, keep the widening for variables)",
  },
  shapes18_8: {
    improvement: "An array of interface slots (and of pointers or references) is Copy, but `initOf` checks `array.element.kind === \"elementary\"`, so it prints `std::array::from_fn(|_| 0)`. Use `isCopy(array.element)` (already defined at :305) to pick `[0; N]`, and keep from_fn for structs and FB instances, which are not Copy.",
  },
  shapes18_9: {
    improvement: "Every VAR_INPUT is `mut` whether or not the body writes it (`configure(&mut self, mut i_width: i16, mut i_height: i16)` never assigns either one). The `#[allow(unused_mut)]` on every routine hides that. The IR already knows which slots a routine body assigns, so it can print `mut` only for those. That would let `unused_mut` come off the allow list.",
  },
  shapes18_10: {
    improvement: "The function-result variable is always declared with a default, assigned, and returned: `let mut inner: IecString<40> = IecString::<40>::lit(b\"\"); inner = IecString::<40>::lit(b\"FB_CP_named.Inner\").to(); inner`. This is faithful to ST, where the result can be read before it is set. When a body's first statement unconditionally assigns the result and nothing reads it earlier, the declaration could take that value directly, or the body could end in the expression. For strings it also saves building a throwaway empty IecString.",
    alternatives: [
      "default-then-assign (today): uniform, always matches ST's read-before-write semantics",
      "initialise at the first unconditional write when nothing reads the result before it (smaller, but needs a definite-assignment pass)",
    ],
  },
  shapes14_2: {
    improvement: "A constant that is cast or used as an index should be printed already typed or folded. `char_at(0i8 as i64)` becomes `char_at(0)`, and `values[((1i8 as i64) - 1i64) as usize]` becomes `values[0]`. Literals come out typed as the smallest type (SINT), then castTo adds `as i64`, and the lower-bound subtraction is done at run time.",
  },
  shapes14_3: {
    improvement: "Leave out the store's `.to()` when the value is already the target's IecStr<N>: a same-capacity with_char result, a literal already built at the target capacity, or a value that ends in `.to::<N>()`/`.narrow::<N>()`. Leave out `.to::<N>()` when source and target capacity are equal. Today `left = left.with_char(n as i64, 0u8).to();` and `self.left_two = left(...).to::<80>().to();` each copy the string twice.",
    alternatives: [
      "emitted today: always `.to()` on a string store. Always correct, because Rust infers the target N, and it covers a generic-capacity VAR_IN_OUT target",
      "skip `.to()` when rustType(value.type) === rustType(target.type). A string can only be typed-identical when its capacity matches. I would choose this: the type is already known at both ends",
    ],
    chosen: "skip `.to()` when rustType(value.type) === rustType(target.type). A string can only be typed-identical when its capacity matches",
    why: "the type is already known at both ends",
  },
  shapes14_4: {
    improvement: "When an add, sub or mul on a narrow integer is widened to i32 and then narrowed straight back to the operand's own type, the widening does nothing, because wrapping is modular. Print `len_internal = len_internal.wrapping_add(1);`, not `(len_internal as i32).wrapping_add(1i32) as u16`.",
    alternatives: [
      "emitted today: widen to i32, wrapping op, narrow. Faithful to CODESYS's register-width promotion, and needed for DIV and for comparisons",
      "x.wrapping_add(L) in the narrow type. Bit-identical for +,-,* whenever the result is stored back into a type no wider than the operands. I would choose this for add/sub/mul whose consumer is a same-width store, and keep the widening everywhere else",
    ],
    chosen: "x.wrapping_add(L) in the narrow type. Bit-identical for +,-,* whenever the result is stored back into a type no wider than the operands. I would choose this for add/sub/mul whose consumer is a same-width store, and keep the widening everywhere else",
  },
  shapes14_5: {
    improvement: "An INT or SINT division is widened to i32 so that MIN / -1 does not trap. That is measured: arithedge_int_div_min_by_minus_one gives -32768. `x.wrapping_div(y)` in the narrow type gives the same value and still panics on a zero divisor.",
    alternatives: [
      "emitted today: widen to i32, plain `/`, narrow. Correct: MIN/-1 fits in i32, and 0 panics like CODESYS",
      "i16::wrapping_div. Same values, and divide-by-zero still panics. I would use it only for widths below 32, because DINT/LINT must keep plain `/` to trap MIN/-1 as CODESYS does",
    ],
  },
  shapes14_6: {
    improvement: "Leave out the widening casts on a comparison whose two sides already have the same Rust type, or the same signedness with one side a literal that fits. `self.q = self.cv == 0;`, `helpissameignorecase = chartoupper(by1) == chartoupper(by2);`, `if self.x.drive.travelled > 10 {`.",
    alternatives: [
      "emitted today: both sides promoted to i32. Needed for mixed-sign pairs such as BYTE vs SINT or UDINT vs DINT (measured same_width_mixed_sign_order)",
      "compare in the common type when both sides are the same type. I would choose this: promotion cannot change the result of an ordering between two values of one type",
    ],
    chosen: "compare in the common type when both sides are the same type",
    why: "promotion cannot change the result of an ordering between two values of one type",
  },
  shapes14_7: {
    improvement: "WHILE and FOR print as `loop { if !(cond) { break; } body; step }`. `while cond { … }` / `for`-style is what a Rust engineer writes. The loop-form is kept because of CONTINUE-before-step. Also `negated` does not apply De Morgan's law: `!((i < n) & (i < last))` could be `(i >= n) | (i >= last)`.",
    alternatives: [
      "emitted today: loop + negated break. Correct for a CONTINUE that must still run the FOR step, and for the limit being re-evaluated every pass (measured callshape_for_limit_call: 4 limit reads for 3 passes)",
      "`while cond { body }` for WHILE with no CONTINUE, and a labelled block for the FOR step. I would choose while for WHILE only; FOR keeps loop+break because its limit is re-read each pass",
    ],
    chosen: "`while cond { body }` for WHILE with no CONTINUE, and a labelled block for the FOR step. I would choose while for WHILE only; FOR keeps loop+break because its limit is re-read each pass",
  },
  shapes14_8: {
    improvement: "A library routine that takes a string pointer is lowered once per argument capacity (`strcmpa_pby1_string80_pby2_string30` and `strcmpa_pby1_string80_pby2_string80` sit side by side). Each copy is ALSO generic over the capacity, so the bodies are identical. Key the cursor variant by width (STRING/WSTRING), offset and sharing only.",
  },
  shapes14_9: {
    improvement: "Passing on a caller's own `&mut` in-out prints `&mut (*__str_pstring)`, an explicit reborrow that clippy::borrow_deref_ref names. Pass `__str_pstring` itself.",
  },
  shapes14_10: {
    improvement: "Reading a character through a string cursor copies the WHOLE IecStr out of the block before calling char_at: `{ iec_deref(p); *__str_p }.char_at(i)`. A store also checks the pointer twice (guardLine and then the guarded load on the right-hand side). Print `{ iec_deref(p); __str_p.char_at(i) }`, and check once per store.",
  },
  shapes14_11: {
    improvement: "An unbound METHOD VAR_OUTPUT becomes a PERSISTENT struct field (`pub __output_2: i16` on the caller's FB), which is initialised, cloned and compared along with the rest of the state. The method resets its outputs on entry (`*extra = 0i16;`), so a call-local `let mut __out = 0i16; self.v.m(&mut __out)` is enough.",
  },
  shapes14_12: {
    improvement: "Hoisting inputs into `let __arg_k` exists to fix evaluation order between inputs. A FUNCTION call with a single input and no in-outs has no order to fix. Print `f_x3_double(f_x3_double(value))`.",
  },
  shapes14_13: {
    improvement: "`let c = if v < 0.0 { -((-v).round()) } else { v.round() };` is exactly `v.round()`, because Rust's round is already half-away-from-zero and symmetric.",
  },
  shapes14_14: {
    improvement: "Mark a parameter `mut` only when the body assigns it, and return the value directly when the result is assigned once at the end. That removes the blanket allow attribute.",
  },
  shapes14_15: {
    improvement: "An ARRAY[*] passes both bounds per dimension as extra i32 arguments, and an FB stores them as fields set before each call (`self.filler.__numbers_lower_1 = 1i32; self.filler.__numbers_upper_1 = 2i32;`). The upper bound is always lower + slice.len() - 1, so only the lower bound needs passing.",
    alternatives: [
      "emitted today: lower and upper both passed. Simple, and UPPER_BOUND is a plain read",
      "upper derived as `lower + grid.len() as i32 - 1` (and N for inner dims). I would choose this: one source of truth, so the bound and the slice cannot disagree",
    ],
    chosen: "upper derived as `lower + grid.len() as i32 - 1` (and N for inner dims)",
    why: "one source of truth, so the bound and the slice cannot disagree",
  },
  shapes14_16: {
    improvement: "`IecWString::<80>::lit(&[97u16, 98u16, 99u16])` needs no per-element suffix, since the slice type is inferred from lit's T: `&[97, 98, 99]`. An empty literal `IecString::<8>::lit(b\"\")` is `IecString::<8>::new()`.",
  },
  shapes14_17: {
    improvement: "Comparing a string with a literal builds a whole IecStr to compare against. `text.units() == b\"abc\"` (or at least drop the parens around `*text`) does the same with no construction.",
  },
  shapes14_18: {
    improvement: "Every LEN call copies its argument into a 256-byte STRING(255) by value. The library body only reads it, so taking the argument by reference and generic over N (like the cursor in-outs) avoids the copy.",
    alternatives: [
      "emitted today: a by-value STRING(255) input. Matches the declared input and truncates a longer string at 255, as the vendor's 255 limit does",
      "&IecStr<u8, N> generic, with the cut at 255 inside the body. Saves the copy, but changes the input-copy semantics a callee could observe if it wrote its input. Worth it only for bodies proven read-only",
    ],
  },
  shapes15_1: {
    improvement: "A string store is copied twice: the IR convert prints `.to::<80>()` and the assignment appends another `.to()` to the same capacity. The assignment should add `.to()` only when the value's capacity differs from the target's, or only for a generic (VAR_IN_OUT) target, which is the one case its comment justifies.",
    alternatives: [
      "today: `.to::<80>().to()`, a convert plus an unconditional assign copy",
      "drop the assign's `.to()` when the typed capacity already equals the target's (the one I would choose: same truncation, one copy)",
      "drop the IR convert and let the assign's inferred `.to()` truncate, which loses the explicit capacity in the text",
    ],
    chosen: "drop the assign's `.to()` when the typed capacity already equals the target's (the one I would choose: same truncation, one copy)",
  },
  shapes15_2: {
    improvement: "`s[i] := c` prints `x = x.with_char(i, c).to();`. That is a by-value copy of the whole string, a rebuild, and then a same-capacity `.to()` copy back. A `fn set_char(&mut self, i: i64, c: T)` in the prelude, printed as `x.set_char(i, c);`, is the idiomatic in-place form.",
    alternatives: [
      "today: `x = x.with_char(i, c).to()` (value in, value out, re-truncated)",
      "`x.set_char(i, c)` taking &mut self (the one I would choose: no copy, same panic contract)",
    ],
    chosen: "`x.set_char(i, c)` taking &mut self (the one I would choose: no copy, same panic contract)",
  },
  shapes15_3: {
    improvement: "A literal typed in its IEC type and then cast: `self.buf.char_at(4i8 as i64)`, `entries[(0i8 as i64) as usize]`, `values[((1i8 as i64) - 1i64) as usize]`. castTo should print a constant directly in the target type (`4i64`, or bare `4`), and a constant index minus a constant lower bound should fold to `[0]`.",
  },
  shapes15_4: {
    improvement: "`x := x * 3` on INT prints `x = (x as i32).wrapping_mul(3i32) as i16;`. When the result goes straight back into the narrow type, `+ - *` modulo 2^16 is the same computed in i16: `x = x.wrapping_mul(3);`. The widening matters only for comparisons, division and a wider destination.",
    alternatives: [
      "today: widen to i32, wrapping op, `as i16` (always correct and uniform, mirrors the interpreter's promotion)",
      "narrow-type `wrapping_*` when a whole add/sub/mul tree lands in the same width, which is correct because the ring is mod 2^n (the one I would choose, as an emit-time peephole that never applies to div/MOD/compare, since i16::MIN / -1 differs)",
    ],
    chosen: "narrow-type `wrapping_*` when a whole add/sub/mul tree lands in the same width, which is correct because the ring is mod 2^n (the one I would choose, as an emit-time peephole that never applies to div/MOD/compare, since i16::MIN / -1 differs)",
  },
  shapes15_5: {
    improvement: "`IF POS >= 1 AND LEN > 0` prints `((pos as i32) >= 1i32) & ((len as i32) > 0i32)`, and CTU prints `(self.cu & (!self.mu)) & ((self.cv as i32) < 65535i32)`. A comparison of a narrow variable with a literal that fits needs no widening (`pos >= 1`), and on side-effect-free operands `&&` is the idiomatic spelling.",
    alternatives: [
      "today: widen both sides and use non-short-circuit `&`/`|` everywhere (right when the right side calls something, as the 2026-09-15 review found)",
      "`&&`/`||` only when neither side holds an invoke, and compare in the narrow type when the literal fits (the one I would choose)",
    ],
    chosen: "`&&`/`||` only when neither side holds an invoke, and compare in the narrow type when the literal fits (the one I would choose)",
  },
  shapes15_6: {
    improvement: "`g: &mut Globals` is threaded into EVERY body once any global is used, with a blanket `#[allow(unused_variables)]`. In initseq_reads_global the FB's `call(&mut self, g)` never reads g. The emitter could compute transitive global use per POU and pass g only where it is reached.",
    alternatives: [
      "today: uniform calling convention, simple and never wrong",
      "per-POU transitive usage, which is leaner Rust but needs a call-graph pass (I would keep today's convention and drop only the allow where g IS used)",
    ],
  },
  shapes15_7: {
    improvement: "Every routine takes every input as `mut`, starts with `let mut f: i16 = 0i16; f = X; f`, and silences the result with a blanket allow. A param is `mut` only when the body assigns it or lends it `&mut`. A return slot assigned once on every path could be `let f = X; f`, or just the tail expression.",
  },
  shapes15_8: {
    improvement: "A lent `POINTER TO` input keeps its now-dead value parameter: `f_lang_ptrtwo(0, &mut self.first)` with `mut p: usize` never read, because lowering refuses any other use of p. The value parameter can be dropped when the pointer is lent.",
  },
  shapes15_9: {
    improvement: "`(*x)` and `&mut (*x)` are printed where auto-deref and implicit reborrow do the job: `(*str).char_at(..)` could be `str.char_at(..)`, `self.inner.call(&mut (*numbers))` could be `self.inner.call(numbers)`, and `((*x) as i32)` could be `(*x as i32)`.",
  },
  shapes15_10: {
    improvement: "`ref_.Size := 7` becomes `self.__property_4 = 7i16; { iec_deref(self.ref_); self.c.size_set(self.__property_4) };`. The staging temp is a PUBLIC STRUCT FIELD that persists on the FB. It exists for borrow reasons only when the value calls a getter on the same instance. For other values the setter can take the value directly, and otherwise a block-local `let` does the job without adding state to the struct.",
  },
  shapes15_11: {
    improvement: "An empty-string initializer prints `IecString::<255>::lit(b\"\")`. `IecString::<255>::new()` (or Default) says the same thing without the slice copy.",
  },
  shapes15_12: {
    improvement: "A WSTRING literal prints as `IecWString::<10>::lit(&[104u16, 101u16, ...]).to()`, one typed u16 per char, and is built at its own capacity and then copied. A prelude `IecWString::from_str(\"he\")` (encode_utf16), or building at the target capacity, reads as the source and drops the copy.",
  },
  shapes15_13: {
    improvement: "The same construct, an index minus its lower bound, is printed two ways: `[(i - 1i64) as usize]` for a fixed array and `[(u as i64).wrapping_sub(l as i64) as usize]` for ARRAY[*]. The ARRAY[*] bounds also travel as persistent FB fields that each hop re-copies (`self.inner.__numbers_lower_1 = self.__numbers_lower_1;`), where `numbers.len()` plus one lower-bound parameter would carry them. At minimum, pick one subtraction spelling.",
  },
  shapes15_14: {
    improvement: "Every LEN/LEFT/MID/... call copies its argument into a fresh IecString<255> (`len(self.hello.to::<255>())`), and LEN then lends that copy `&mut` to LEN_INTERNAL. A read-only STRING input could print as a generic `&IecStr<u8, N>`, as the VAR_IN_OUT CONSTANT form already does (shape 81253ce291), which removes the 256-byte copy per call.",
  },
  shapes15_15: {
    improvement: "A cursor store through a pointer prints `iec_deref(p);` on the line before it and then `{ iec_deref(p); *__str_p }` again inside the same expression, so the same null check runs two or three times per statement (StringUtils STRMIDA/STRREPLACEA). Guarding each pointer once per statement is enough.",
  },
  shapes8_1: {
    improvement: "f64::round already rounds half away from zero symmetrically, so `-((-v).round())` equals `v.round()` for every v < 0, including the -0.0 results. The branch is dead weight: `let c = v.round();`.",
  },
  shapes8_2: {
    improvement: "`RangeBounds::contains` is already false for NaN, so `c.is_nan() ||` is redundant: `if !(-9.2e18..1.8e19).contains(&c) { return i64::MIN; }`.",
  },
  shapes8_3: {
    improvement: "When both operands already have the destination's width and signedness, and the promoted result is stored straight back at that width, the i32 detour changes nothing for add/sub/mul (congruent mod 2^n), and/or/xor, and min/max. Division, shifts, comparisons and mixed signedness still need the widening.",
    alternatives: [
      "(a) today: `(self.b as i32).wrapping_add(100i32) as u8`. Always correct and mirrors the IR's promotion, but costs 2-3 casts per op and fires clippy cast_possible_truncation, cast_sign_loss and cast_lossless.",
      "(b) narrow peephole: `self.b.wrapping_add(100)` / `self.a & self.b` / `self.a.min(self.b)`, used when the convert(promoted) node is immediately narrowed to the operands' own type and the op is width-agnostic.",
      "(c) keep the i32 for signed-unsigned mixes (max_signed_unsigned needs it) and for div/shr/compare.",
      "I would choose (b) with (c)'s exclusions. It is what a Rust engineer writes and it removes most of the arith-tier cast lints, but it needs a lowering rule listing which ops are width-agnostic.",
    ],
    chosen: "I would choose (b) with (c)'s exclusions. It is what a Rust engineer writes and it removes most of the arith-tier cast lints, but it needs a lowering rule listing which ops are width-agnostic.",
  },
  shapes8_4: {
    improvement: "`.%W0` / `.%B0` shift by `0i16 as u32`, which is a dead shift plus a pointless cast: emit `self.d as u16`. For other offsets the count is a known in-range constant, so emit `(self.d >> 16) as u16` and `(self.d >> 3) & 1 != 0`. The `load` bit path in emit/rust/expr.ts already skips `>> 0`; partial access should follow it.",
  },
  shapes8_5: {
    improvement: "A literal count prints as `7i8 as u32`. Print the bare literal (`7`). When the count is a constant below the operand width, `>>`/`<<` state it directly.",
    alternatives: [
      "(a) today: `x.wrapping_shl(7i8 as u32)` for every count. Uniform, and correct for variable counts (x86 masks the count).",
      "(b) `x << 7` when the count is a constant in [0, width). Cannot panic, and is idiomatic.",
      "Choose (b) for constants, and keep wrapping_* with `as u32` only for variable counts.",
    ],
    chosen: "(b) for constants, and keep wrapping_* with `as u32` only for variable counts.",
  },
  shapes8_6: {
    improvement: "An all-literal MAX/MIN/LIMIT is not folded, even though lowering can fold through semantics/fold.ts. It is also computed in i64 and cast. The MUX arms could be typed at the result type: `match k { 0 => 10, 1 => 20, _ => 30 }`.",
    alternatives: [
      "(a) today: `1i64.max(5i64).max(3i64) as i16`",
      "(b) fold the constant: `self.three = 5;`",
      "(c) no folding, but type the literals in the destination type: `1i16.max(5).max(3)`",
      "Choose (b). The folding already exists for declaration initializers and is proven equal to runtime (constant-folding.ts).",
    ],
    chosen: "(b). The folding already exists for declaration initializers and is proven equal to runtime (constant-folding.ts).",
  },
  shapes8_7: {
    improvement: "When the divisor is a non-zero constant, the zero check is dead. Print `self.real7 / 2.0`, or fold a literal/literal quotient to `3.5f32`. The same applies to MOD by a non-zero constant: `x.wrapping_rem(3)` without the `let __mod_*` block.",
  },
  shapes8_8: {
    improvement: "For SQRT alone, f32::sqrt is correctly rounded, and so is f64 sqrt narrowed to f32, because 53 >= 2*24+2 makes double rounding harmless. The two are bit-identical, so `x.sqrt()` is exact and shorter. Trig, log and exp must stay on the f64 path.",
    alternatives: [
      "(a) today: `(x as f64).sqrt() as f32`. One rule for every math builtin.",
      "(b) `x.sqrt()` for a REAL argument and REAL result. Same bits.",
      "Choose (b) only if the emitter already special-cases per function. Otherwise the uniformity of (a) is defensible.",
    ],
    chosen: "(b) only if the emitter already special-cases per function. Otherwise the uniformity of (a) is defensible.",
  },
  shapes19_1: {
    improvement: "A write through a pointer prints `iec_deref(p);` on the line before, and then the RHS read through the same pointer is guarded again inside `{ iec_deref(p); *x }`. The statement guard dominates the read, so the inner guard is dead. The lowering also sets the pointer to the constant 1 on the line just before (`p1 = 1; iec_deref(p1);`), so both checks can be dropped when the tag is a known non-zero constant.",
  },
  shapes19_2: {
    improvement: "Each ANY variant is already monomorphised per argument type, so diSize is a compile-time constant. It is still passed as a runtime `mut x: i32` parameter and `match`ed, which leaves 3 dead arms per variant. Folding diSize to a const prunes them. An ANY whose pValue is never read (state_any_input_sizes, type_any_function_input) still takes `&mut arg`. It needs no reference at all, and the string variant needs no `<const N>` generic, because its name already fixes STRING(10).",
  },
  shapes19_3: {
    improvement: "A CONSTANT index is not folded: `self.values[((1i8 as i64) - 1i64) as usize]` should be `self.values[0]`, and xo_interface_array_dispatch prints `self.ops[((Li8 as i64) - Li64) as usize]`. For a runtime index, several correct forms exist (see alternatives).",
    alternatives: [
      "today: `[((i as i64) - L) as usize]`. It is correct for every integer index type, and the widening avoids overflow at i16::MIN - 1.",
      "`[(i as usize).wrapping_sub(L)]`: one cast fewer, same panic-on-out-of-range behaviour (a negative index wraps to a huge usize). I would choose this for L > 0 on 64-bit, and the plain `[i as usize]` it already uses for L = 0.",
      "constant index: fold to a literal usize at emit time. Always choose this, since rustc also rejects an out-of-range constant at compile time the same way.",
    ],
    chosen: "`[(i as usize).wrapping_sub(L)]`: one cast fewer, same panic-on-out-of-range behaviour (a negative index wraps to a huge usize)",
  },
  shapes19_4: {
    improvement: "MIN/MAX of two operands of the same type is widened to DINT and narrowed back: `(self.raw as i32).min(g.g_low as i32) as i16`. MIN/MAX of equal types cannot overflow, so `self.raw.min(g.g_low)` gives the identical result.",
    alternatives: [
      "today: widen to the promoted type, then `.min`, then cast back.",
      "same-type `.min`/`.max` when both operands (before promotion) share a type. I would choose this: zero casts, identical results. Keep the widening only for a mixed meet (USINT vs SINT).",
    ],
    chosen: "same-type `.min`/`.max` when both operands (before promotion) share a type",
    why: "zero casts, identical results. Keep the widening only for a mixed meet (USINT vs SINT).",
  },
  shapes19_5: {
    improvement: "MUX over untyped literals meets at LINT, so the result is `(match k { 0 => 0i64, …, _ => 4i64 }) as i16`. The literals could be typed at the destination (INT) and the outer cast dropped.",
  },
  shapes19_6: {
    improvement: "The dispatch is always wrapped in parentheses, even as a statement (`(match … { … });`). A lent instance used as a method receiver is printed `(*__lent_0).area()`, where method auto-deref makes `__lent_0.area()` correct: the `through` test covers a field or index step but not a method call.",
  },
  shapes19_7: {
    improvement: "A scalar VAR_IN_OUT CONSTANT is copied into a let and lent by reference: `{ let __copy_0 = self.plain_var; self.twice(&__copy_0) }` into `twice(&mut self, value: &i16)`. For a Copy scalar the parameter can take `value: i16` by value: `self.twice(self.plain_var)`. Aliasing is already refused (call-inout-alias), so by-value is equivalent.",
    alternatives: [
      "today: a copy in a block plus `&T`. It works for every type, including IecString.",
      "by value for Copy scalars and `&IecString` only for strings. I would choose this: no block and no let.",
    ],
    chosen: "by value for Copy scalars and `&IecString` only for strings",
    why: "no block and no let.",
  },
  shapes19_8: {
    improvement: "Once any PROGRAM is called, every routine takes `prg: &mut Programs`. So a call into a program's member does `std::mem::take(&mut prg.p); p.m.level_get(prg); prg.p = p`, a move-out and move-back of the whole program struct, even when the callee (level_get) never touches prg. Passing prg only to routines that reach a program would reduce these calls to `prg.p.gauge.level_get()`.",
  },
  shapes19_9: {
    improvement: "ptrparam_method emits the generic `read(&mut self, mut p: usize, __ptr_p: &mut i16)` beside its per-target specialisations `read_ptr_p_0` and `read_ptr_p_1`, and nothing calls the generic one. The specialisations still take the unused `mut p: usize` and are called with a literal `0`. Drop the dead generic and the unused parameter.",
  },
  shapes19_10: {
    improvement: "INT/SINT +, - and * widen to i32 and narrow back. Several emissions are correct here (see alternatives).",
    alternatives: [
      "today: `(a as i32).wrapping_add(b as i32) as i16`. It is correct, and it matches the vendor's DINT promotion when the value is consumed wider (a comparison, or a DINT destination).",
      "same-width `a.wrapping_add(b)` when the destination is the operand width. It is bit-identical for +, - and * modulo 2^16 and saves 3 casts. I would choose it only where the result is immediately stored at that width. Keep the widening for / and MOD (MIN / -1) and for comparisons.",
    ],
    chosen: "same-width `a.wrapping_add(b)` when the destination is the operand width. It is bit-identical for +, - and * modulo 2^16 and saves 3 casts. I would choose it only where the result is immediately stored at that width. Keep the widening for / and MOD (MIN / -1) and for comparisons.",
  },
  shapes19_11: {
    improvement: "MOD by a non-zero CONSTANT still emits the zero-divisor block `{ let __mod_l = …; let __mod_r = 1000u32; if __mod_r == 0 { 0 } else { __mod_l.wrapping_rem(__mod_r) } }`. With a literal divisor it is just `x % 1000` (or `wrapping_rem` for a -1 divisor).",
  },
  shapes20_1: {
    improvement: "An add/sub/mul/neg chain over INT/SINT/UINT/WORD operands that is narrowed straight back to the operand width is computed in i32 and cast back. Wrapping add, sub and mul give the same answer mod 2^n, so the widening cannot change the stored result. I probed INT -32768*3+1, TO_INT(BYTE 255)+TO_INT(WORD 65535) and SINT/INT edges: the interpreter and rustc agree, and the narrow form matches bit for bit. Peephole in the emitter: `(a as i32).wrapping_OP(b as i32) as i16`, where a and b are already i16 or are literals, becomes `a.wrapping_OP(b)`. Only for add/sub/mul/neg and AND/OR/XOR, never for div/mod/compare/shift, and only when the chain ends in a narrowing cast.",
    alternatives: [
      "(a) today: widen to DINT, wrap, then `as i16`. This mirrors IEC promotion literally and is always right.",
      "(b) narrow wrapping ops `a.wrapping_mul(3).wrapping_add(1)`. Same result for add/sub/mul chains that end in a narrowing store, with no casts.",
      "Choose (b), applied as an emitter peephole when the IR chain is closed under wrap-homomorphic ops and ends in a convert back to the operand width. Keep (a) wherever the intermediate escapes (compare, div, mod, shift, wider store).",
    ],
    chosen: "(b), applied as an emitter peephole when the IR chain is closed under wrap-homomorphic ops and ends in a convert back to the operand width. Keep (a) wherever the intermediate escapes (compare, div, mod, shift, wider store).",
  },
  shapes20_2: {
    improvement: "A comparison of an INT with an in-range literal is widened on both sides, which is 6 casts on one line. The comment's reason (an out-of-range literal) does not apply when the literal fits the operand type. Also, AND/OR over two side-effect-free comparisons prints the bitwise `&`/`|`, which is clippy::needless_bitwise_bool (1-3 per timer fixture). The eager form is only needed when a side of the expression holds a call.",
    alternatives: [
      "(a) today: widen both sides and use bitwise `&`. Correct for every input.",
      "(b) keep the compare narrow when the literal fits the variable's type, and print `&&`/`||` when neither side holds a call (no observable short-circuit).",
      "Choose (b). The eager `&` is the right default only for impure operands.",
    ],
    chosen: "(b). The eager `&` is the right default only for impure operands.",
  },
  shapes20_3: {
    improvement: "LIMIT/MAX/MIN on INT operands widen every argument to i32 and cast the result back. Integer max/min is width-independent, so `g.g_low.max(self.raw).min(g.g_high)` is the same. I probed LIMIT with the inverted bounds (hi,lo) and -32768: both backends give -5. SEL's arms are widened the same way inside its `if`.",
  },
  shapes20_4: {
    improvement: "When the divisor is a literal, the zero test is decided at emit time. For a nonzero unsigned literal, plain `%` cannot panic. For a signed literal other than 0 and -1, plain `%` cannot panic either. So `self.difftime % 1000u32` replaces the 3-binding block. 1522 also widens INT to i32 for a MOD whose result goes back to i16. Remainder never needs widening: wrapping_rem already covers MIN % -1. A literal -1 is printed as `1i32.wrapping_neg()`, so it is not recognised as a constant (see the next item).",
    alternatives: [
      "(a) today: a generic guarded block for every MOD.",
      "(b) `l % r` for a nonzero literal r other than -1; `l.wrapping_rem(r)` for a variable r that is proven nonzero; the guarded block otherwise.",
      "Choose (b).",
    ],
    chosen: "(b).",
  },
  shapes20_6: {
    improvement: "When the value is already a convert to the target's own capacity, the assign adds a second truncating copy. `insert(...).to::<80>().to()` into an IecString<80> is two 81-byte copies where one does. This occurs 101 times across 64 fixtures. Skip the trailing `.to()` when the value's type equals the target type, or drop the convert when its only consumer is the assign.",
  },
  shapes20_7: {
    improvement: "A VAR_IN_OUT CONSTANT bound to a LITERAL gets a `let` copy before the call. The copy exists to avoid E0503 when a `&mut` of the same place sits beside it. A literal is no place, and a temporary lives to the end of the statement, so `f_ioc_matches3(&IecString::<80>::lit(b\"abc\"))` is enough. Keep the copy only when the bound value is a place, as in `self.twice(&__copy_0)` of `self.plain_var`, where it is needed.",
  },
  shapes20_8: {
    improvement: "Hoisting exists to make order visible between SEVERAL inputs, or to read a program before it is moved out. It fires for a single input (`len(concat(..))`), which has no order to show. On a PROGRAM method it also hoists constants (`let __arg_0 = 10i16;`, `true`, `false`), which cannot read the program. Hoist only inputs that hold a call when there are two or more of them, and on a program method only inputs that read `prg`.",
  },
}
