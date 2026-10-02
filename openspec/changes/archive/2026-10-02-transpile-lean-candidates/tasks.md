# Tasks — lean candidates (UNVERIFIED; apply only after transpile-review-2026-09-29)

For every group, before touching the emitter:

- Snapshot the corpus's program outputs (fixtures.test.ts plus the review's differential harness).
- Make the change.
- Prove the outputs are byte-identical.
- Record the lint and size delta.

Stop and report any group whose outputs change.

## 1. Prelude on demand
- [ ] 1.1 Split `STRING_PRELUDE` (`emit/rust/prelude.ts`) into keyed snippets: IecStr core, each `iec_*_text`, `iec_parse_int/real`, `iec_max/min`.
- [ ] 1.2 Include a snippet only when the POU references it, the way `emit.ts` already gates `iec_div`, `iec_deref` and `iec_r2i32`.
- [ ] 1.3 Drop `dead_code` from the ALLOWED list if it is no longer needed. Measure: dead_code is 5627 today.

## 2. Fold constants in lowering
Everything folds through `ir/evaluate.ts` + `fit`, so both backends see one constant.
- [ ] 2.1 Fold negation of a constant to a typed literal (`-128i8`, not `128i32.wrapping_neg() as i8`).
- [ ] 2.2 Print an all-constant integer or real expression as its folded literal (after review tasks 5-7).
- [ ] 2.3 Print a constant array index as a usize literal (`[4]`), with the lower bound subtracted at emit time. Fold a constant ADR tag and constant cursor or pointer offsets.
- [ ] 2.4 Print a constant shift or rotate count as a bare literal. Skip `>> 0` in partial access `.%B0`/`.%W0`.
- [ ] 2.5 For MOD or real `/` by a nonzero constant other than -1, print plain `%` / `/`, without the guard block or `iec_div`.
- [ ] 2.6 Fold MAX, MIN, LIMIT, SEL and MUX when all arguments are constant, and TRUNC of a constant. Type literal arms at the result type.

## 3. Narrow arithmetic and comparisons (emitter peephole)
- [ ] 3.1 For `convert(T, add|sub|mul|neg|and|or|xor|min|max(convert(DINT, a:T), …))` where every operand is T, print `a.wrapping_op(b)` in T. This is bit-identical mod 2^n.
- [ ] 3.2 Compare in the operands' own type when both have the same type, or when a literal fits the other operand's type.
- [ ] 3.3 Treat ABS of an unsigned operand as the identity.
- [ ] 3.4 Print lossless widenings as `T::from(x)` and keep `as` for truncating or reinterpreting casts.
- [ ] 3.5 Keep promotion for DIV (MIN/-1 is measured), mixed-sign meets, shifts, and stores into a wider destination.

## 4. String copies (after review task 34)
- [ ] 4.1 Append `.to()` in `assign` only when the value's capacity differs from the target's, or the target is generic.
- [ ] 4.2 Build literal and `format!` results straight at the target capacity.
- [ ] 4.3 Add an in-place `set_char(&mut self, i, c)` to the prelude and use it for `s[i] := c` statements.
- [ ] 4.4 Read through a cursor by borrowing (`__str_p.char_at(i)` under one guard). Emit one `iec_deref` per statement.
- [ ] 4.5 Key cursor and ANY variants by width, not capacity: the emitted fn is already const-generic, so identical copies disappear.
- [ ] 4.6 Consider a LEN_INTERNAL primitive (`units().len()`), and read-only Standard string inputs as `&IecStr<N>` with the 255-character cut applied as a view.

## 5. Loop shape (after review task 27)
- [ ] 5.1 If a guard survives, make it structural (`for _ in 0..CAP` plus a panic after the loop) or harness-only.
- [ ] 5.2 Drop the extra body block when there is no CONTINUE. Drop the label when there is no labelled EXIT. For WHILE, use `continue 'loop`.
- [ ] 5.3 Print ELSIF as `else if`.
- [ ] 5.4 Use `&&`/`||` when neither operand holds a call. Negate the loop test with De Morgan.

## 6. Temporaries as locals
- [ ] 6.1 In body mode, make `tempPlace` produce a statement-scoped `let` (`lower/lowering.ts:259`) instead of a struct field. This covers chain, property, output, inout_guard and inout_index temps.
- [ ] 6.2 Pass a property-setter value directly when it holds no invoke on the same instance.
- [ ] 6.3 Evaluate: VAR_TEMP as Rust locals (the routine path already supports local-rooted places).

## 7. Routine signatures
- [ ] 7.1 Mark an input `mut` only when the body stores to it. Drop the blanket allows. Return the result expression directly when it is assigned once at the end.
- [ ] 7.2 Make `new()` a `const fn` where possible, and mark it `#[must_use]`, or allow the lints once per file.
- [ ] 7.3 Pass `prg` and `g` only to routines that reach them. Call program members directly, without `std::mem::take`, when the callee does not reach Programs.
- [ ] 7.4 Drop the dead value parameter of a form-2 lent pointer. Drop ARRAY[*] upper bounds, which are derived from `len()`. Fold a constant ANY diSize into its variant and prune dead arms.

## 8. Derives and aggregate syntax
- [ ] 8.1 Derive `Eq`, and `Copy` for all-Copy structs. Drop `.clone()` on Copy struct stores.
- [ ] 8.2 Use struct-update syntax for aggregate initializers. Use a repeat expression for arrays of Copy elements. Use `[d; N]` plus stores for a partial initializer.
- [ ] 8.3 Implement union member sync with `to_le_bytes`/`from_le_bytes` (needs an IR reinterpret node with an interpreter twin).
- [ ] 8.4 Print a constant bit store as `|=` / `&= !`.
- [ ] 8.5 Remove `(*x)`, `&mut (*x)` and the parentheses around a statement-level `match`.

## 9. Prelude helpers
- [ ] 9.1 In `iec_r2i64/32`, use `let c = v.round();` and merge the NaN and ≥2^63 returns.
- [ ] 9.2 Move TRUNC into an `iec_trunc_i32` helper.
- [ ] 9.3 Write `iec_deref` as `assert_ne!`.
- [ ] 9.4 Have `iec_*_text` write into an `IecStr` with no String allocation.

## 10. Transpiler source cleanup
- [ ] 10.1 Replace the five EXTENDS walks in `lower/lower.ts` and `calls.ts` with one `chainUnits` helper. Merge `holdsFbInit` and `reaches` into one walk.
- [ ] 10.2 Merge const-eval's `foldBigInt` and `foldNumber` into one typed fold (after review tasks 2-4). Share the ident resolver between `constancyOf` and `fold`.
- [ ] 10.3 Export one `convertValue` from `ir/evaluate.ts` and use it from `interp.ts`.
- [ ] 10.4 Remove the orphan doc comments and empty section banners: `calls.ts:63-65/364-368/949`, `lowering.ts:176-178/364-368`, `values.ts:106/309-313`, `ir.ts:41/252-254`, `storage.ts:300-301`, `infer.ts:258`, `interfaces.ts:85-100`. Also move the comment misplaced at `emit.ts:1250`.
