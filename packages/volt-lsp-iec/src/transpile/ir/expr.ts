/**
 * THE IR'S EXPRESSIONS — a place (a slot plus a path, design §9) and every expression node, with the evaluation contract
 * of each builtin. See `ir/index.ts` for the two decisions behind the IR.
 */
import type { Span } from "../../frontend/syntax/index.js"
import type { Type } from "../../frontend/types/index.js"
import type { IrInit, IrValue } from "./program.js"
import type { FaultKind } from "./faults.js"

// ─── places ──────────────────────────────────────────────────────────────────

/**
 * One step from a slot toward a sub-location (design §9 — the application is one tree of owned values, so a place is a
 * root slot plus a path, never an address):
 *   - `field` — a struct's field or an FB instance's variable, by its ST name (`IrLayout.fields`);
 *   - `index` — ONE array dimension: the index expression, the dimension's lower bound and its length, so a backend
 *     normalises `arr[i]` to `i - lower` without deciding anything;
 *   - `bit`   — `x.3` on an integer (design §14), the last step; `of` is that integer's type, which a write stores at.
 */
export type Access =
  | { kind: "field"; name: string }
  /** `length` is absent on an `ARRAY[*]` in-out's dimension: its index is already offset by the bound the call was
   *  handed (`lower` 0), and the array it was bound to knows its own length. `size` is set under an `image` root
   *  only: the element's byte size, the step the checked index moves the address by (`Place.at`). */
  | { kind: "index"; index: IrExpr; lower: bigint; length?: number; size?: number }
  | { kind: "bit"; index: number; of: Type }

/** A resolved storage location: a slot in the frame, plus a path into it. */
export interface Place {
  /** An index into the frame — the POU's slots, or the instance's fields in an FB, METHOD or ACTION body — or, per `root`,
   *  into the body's VAR_IN_OUT parameters or its routine's per-call locals. */
  slot: number
  path: readonly Access[]
  type: Type
  span: Span
  /** `inout`: a VAR_IN_OUT parameter — the caller's variable, bound for the call (design §9 form 2, a `&mut`).
   *  `local`: a METHOD's, ACTION's or FUNCTION's local, which starts over on every call.
   *  `global`: the application's storage — a GVL variable, or a called PROGRAM's one instance (`IrPou.globals`).
   *  `this`: the instance an FB, METHOD or ACTION body runs on — `THIS^` (`slot` is unused).
   *  `lent`: an FB instance of another frame, lent to this body for the call by its caller (`IrRoutine.lent`,
   *  `IrLayout.lent`) — how a call through an interface reaches the instance its tag names (design §24). */
  root?: "inout" | "local" | "global" | "this" | "lent" | "image"
  /**
   * `image` roots only: the BYTE ADDRESS the place starts at, in the program's little-endian image (design.md §3.3 step
   * 4d, `semantics/memory.ts`) — a variable whose address a program stores, or a data pointer's target. Its `path` then
   * holds only `index` steps, each with its element's `size` (checked against its bounds, then `(i - lower) · size`
   * added to `at`), and a trailing `bit`; every field step is already folded into `at`. `slot` is unused.
   */
  at?: IrExpr
  /**
   * A DEREFERENCE: this place is a pointer's or reference's one target (design §9 form 1), reached through `guard`, the
   * pointer variable — which holds 0 when null, so a backend faults before the access (the interpreter throws, Rust
   * panics), as a null dereference stops the CODESYS application.
   */
  guard?: Place
}

// ─── expressions ─────────────────────────────────────────────────────────────

/** Arithmetic/comparison/logic operators, already resolved to ONE meaning per node. */
export type IrBinOp =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "mod"
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "and"
  | "or"
  | "xor"
  /** Short-circuit forms — distinct nodes, because a backend must not fold them into the eager ones. */
  | "and_then"
  | "or_else"

export type IrUnOp = "neg" | "not"

export type IrExpr = IrConst | IrFresh | IrLoad | IrBinary | IrUnary | IrConvert | IrBuiltin | IrInvoke | IrDispatch | IrSelect | IrAddress | IrCount | IrReinterpret

/**
 * A VALUE'S BYTES READ AT ANOTHER TYPE (lean 7.8.4) — what a UNION member holds once another member was stored: `value`'s
 * little-endian bytes laid from offset 0 over `over`'s (the member's own value, given only where it is the LONGER of the
 * two, so its bytes past `value`'s stay), read at `type`. `value`'s and `type`'s kinds are an integer, a bit string, a REAL
 * or LREAL, or a one-dimensional array of them (`lower/storage/unions.ts` `overlayBytes`). The interpreter computes it over
 * a scratch image (`semantics/memory.ts` `reinterpret`), the Rust through `to_le_bytes` / `from_le_bytes`.
 */
export interface IrReinterpret {
  kind: "reinterpret"
  value: IrExpr
  over?: IrExpr
  type: Type
  span: Span
}

/**
 * THE ELEMENT COUNT OF ONE DIMENSION OF AN `ARRAY[*]` IN-OUT (lean 7.7.8) — read off the array the call bound, so an open
 * dimension's UPPER_BOUND is `lower + count - 1` and only its LOWER bound travels with the call (design §26): the bound
 * and the array cannot disagree. `array` is the in-out itself (no path), `dim` counts from 1, `type` is DINT.
 */
export interface IrCount {
  kind: "count"
  array: Place
  dim: number
  type: Type
  span: Span
}

/**
 * `ADR(x)` OF A VARIABLE IN THE IMAGE — the byte address an `image` place starts at: its `at`, plus each index step's
 * checked `(i - lower) · size`, exactly the address a load or store of the place would reach, read without the access
 * (design.md §3.3 step 4d). `type` is the pointer's. Lowering builds it over the variable's own place; the image pass
 * (`lower/pointers/image.ts`) rewrites that place to its `image` form, so a backend only ever sees an `image` place here.
 */
export interface IrAddress {
  kind: "address"
  place: Place
  type: Type
  span: Span
}

/**
 * A READ THROUGH A POINTER OR REFERENCE THAT MAY NAME SEVERAL VARIABLES (design §9 form 3, `pointer-model.md`).
 *
 * `IrDispatch` with a PLACE where the call is, and it is the same mechanism for the same reason: the variable holds a
 * TAG rather than an address — 0 for none, else the tag lowering gave each target — and the read selects the arm the
 * tag names. A value no arm names faults, exactly as dereferencing a null pointer stops the CODESYS application.
 *
 * Form 1 stays the common case and is an ERASURE of this: one target and no null means the tag can never be anything
 * else, so the deref lowers to that place directly and no tag is ever built. This node appears only where a pointer
 * genuinely has more than one target (`refuse_pointer_two_targets`: `p := ADR(a); p := ADR(b); seen := p^` reads 2).
 *
 * A WRITE through the same pointer needs no node of its own — it is an `IrSwitch` on the tag whose arms each assign
 * to one target, which is a statement the IR already has.
 */
export interface IrSelect {
  kind: "select"
  tag: IrExpr
  arms: readonly { tag: bigint; place: Place }[]
  type: Type
  span: Span
}

/**
 * A call through an interface variable (design §22): the variable holds which instance it names — 0 for none, else the
 * tag lowering gave that instance — and each arm is the METHOD or PROPERTY accessor invoked on one instance it may name.
 * A value no arm names faults, as a call through a null interface stops the CODESYS application. The same node carries
 * a METHOD reaching its FB's VAR_IN_OUT from outside the FB's run (`lower/calls/last-binding.ts`), where the tag is the
 * binding the instance was last called with and none is an in-out no call bound yet — so `fault` names which stop it is.
 */
export interface IrDispatch {
  kind: "dispatch"
  tag: IrExpr
  arms: readonly { tag: bigint; call: IrInvoke }[]
  /** The fault a tag no arm names stops with: a null interface, or an in-out no call bound (transpile-restructure 6.A.28). */
  fault: Extract<FaultKind, "no-instance" | "unbound-inout">
  type: Type
  span: Span
}

/**
 * A METHOD, ACTION or FUNCTION invocation. Its locals start over on every call — measured for a METHOD's and a
 * FUNCTION's VAR (conformance `fbcall_method_locals`, `fbcall_function_locals`) — so its inputs are VALUES handed in, not
 * assignments in the caller's frame. `type` is the routine's result; a call without one only appears in an `eval`.
 */
export interface IrInvoke {
  kind: "invoke"
  /** The routine's `key` in `IrPou.routines`. */
  routine: string
  /** The instance a METHOD or ACTION runs on; absent for a FUNCTION. */
  instance?: Place
  /** One value per VAR_INPUT, in declaration order, already converted to it. */
  inputs: readonly IrExpr[]
  /** The order the inputs are evaluated in: as WRITTEN in the call (conformance `callshape_argument_order`: a reversed call
   *  runs its right argument first). Absent, declaration order. A freeze among them is an in-out's index taken where the
   *  in-out is written (`IrFreeze`). */
  order?: readonly (number | IrFreeze)[]
  /** The VAR_IN_OUT arguments, in declaration order. */
  inouts: readonly IrBinding[]
  /** The instances lent to the routine (`IrRoutine.lent`), in its order — filled once the POU has lowered. */
  lent?: readonly Place[]
  type: Type
  span: Span
}

/**
 * A VAR_IN_OUT's runtime index, stored into `temp` at the position its argument is written — CODESYS binds an in-out
 * where it is written (conformance `callshape_inout_binding_order`: 101 before a call that moves the index), so a call
 * in a later argument cannot move it. The binding indexes by `temp`.
 */
export interface IrFreeze {
  kind: "freeze"
  temp: Place
  value: IrExpr
}

/**
 * What a VAR_IN_OUT is bound to for a call: the caller's place (a `&mut`, or a `&` for a VAR_IN_OUT CONSTANT) — or, for a
 * VAR_IN_OUT CONSTANT only, a COPY of a value lent for the call (a `&{ value }` in Rust): a literal with no place of its
 * own, or a variable the call already holds mutably, where the callee provably changes nothing while it reads it.
 */
export type IrBinding = Place | IrCopy

export interface IrCopy {
  kind: "copy"
  value: IrExpr
  /** The parameter's type — the copy is stored as it. */
  type: Type
  /** A copy lent `&mut` and written back to this place after the call: an FB's own field lent to its own METHOD, which
   *  would otherwise be two `&mut` of one instance — exact because the callee reaches the field only through it. */
  back?: Place
  /** A copy lent `&mut` whose value nothing reads after the call: an unconnected VAR_OUTPUT (`bindUnconnectedOutputs`). */
  discarded?: true
  span: Span
}

/**
 * **ARGUMENTS ARE EVALUATED IN WRITTEN ORDER, EACH ONCE — EXCEPT SEL AND MUX, WHICH EVALUATE THEIR SELECTOR AND THEN
 * ONLY THE INPUT IT SELECTS.** Measured on CODESYS (transpile-review-2026-09-29 task 41, recorded):
 * `MUX(0, Inc(a), Inc(b))` leaves a = 1, b = 0 (`tr_41_mux_side_effects`); `SEL(FALSE, Inc(a2), Inc(b2))` leaves
 * a2 = 1, b2 = 0 (`tr_41_sel_side_effects`); `LIMIT(Add1(x), Dbl(x), 1000)` from x = 1 leaves x = 4 — MN before IN
 * (`tr_41_limit_evaluation_order`). This used to say "every argument, eagerly", unmeasured, on the premise that a
 * call in an expression was refused; the interpreter obeyed it for MUX while the emitted `match` did not, and the
 * emitted LIMIT read IN first. `selectedArg` (`semantics/builtins.ts`) is the one statement of which input is selected.
 */
export type IrBuiltinName =
  | "max"
  | "min"
  | "limit"
  | "sel"
  /** TRUNC/TRUNC_INT: toward zero, into the node's DINT/INT `type` — the one conversion that does not round, so it cannot
   *  be a `convert`. */
  | "trunc"
  | "abs"
  | "expt"
  /** `(value, count)`, value already promoted; the count is masked to the width's bits (design §14). */
  | "shl"
  | "shr"
  /** `(value, count)` in the value's OWN width — or in the node's `bits` when set — the count taken modulo that width. */
  | "rol"
  | "ror"
  /** `(K, IN0, …)`: inputs already met; an out-of-range K — negative included — picks the LAST input. */
  | "mux"
  | IrMathName
  /** `(s, i)`: `s[i]`, the character at 0-based `i` as the node's BYTE (a WSTRING's WORD); 0 at `i` = its length. */
  | "char"
  /** `(s, i, c)`: `s` with `s[i] := c` — the node's type is the string's. See `semantics/string.ts` `setChar` for the model. */
  | "setchar"
  /** `(s)`: the units of `s` before its first 0, as the node's UINT — `Standard.LEN_INTERNAL`, the one count every Standard
   *  string function takes (`lower/builtins/length.ts`; `semantics/string.ts` `lengthOf`). */
  | "length"
  /** `(a, b)`: two image addresses ORDERED — -1, 0 or 1 as a DINT — once both lie in one region of the image; two regions'
   *  order is our layout's, never the vendor's, so it faults (`address-across-frames`, design.md §3.3 step 4d). */
  | "address_order"

/** The one-argument math functions: the argument is already converted to the node's `type` (design §12). */
export type IrMathName = "sqrt" | "ln" | "log" | "exp" | "sin" | "cos" | "tan" | "asin" | "acos" | "atan"

/**
 * A built-in value function, with every argument already converted to `type` by lowering — so a backend picks
 * nothing, not even a comparison type. Argument order is the IEC one: `max`/`min` take 1+ operands, `limit` is
 * `(MN, IN, MX)`, and `sel` is `(G, IN0, IN1)` with a BOOL selector that is the one argument NOT of `type`.
 */
export interface IrBuiltin {
  kind: "builtin"
  name: IrBuiltinName
  args: readonly IrExpr[]
  type: Type
  /** `rol`/`ror` only: rotate the LOW `bits` of the (promoted, wider) value and keep the bits above as they are — an
   *  expression operand rotates in its checked width while its promoted register rides along (conformance
   *  `rotate_of_expression`: `ROL(BYTE 16#81 + BYTE 16#80, 1)` into a WORD is 16#102). Absent: the node's own width. */
  bits?: number
  span: Span
}

export interface IrConst {
  kind: "const"
  value: IrValue
  type: Type
  span: Span
}
/**
 * A FRESH VALUE OF A COMPOSITE TYPE — what a struct or array is set to where the init step's position rule makes its
 * initial value a statement (`lower/init/position.ts`: a constant after the frame's first statement).
 *
 * It was born for the VAR_TEMP reset at the top of every run (an ARRAY in VAR_TEMP counts 1 after three scans where the
 * same ARRAY in VAR counts 3, `declarations/section-semantics.ts`); a VAR_TEMP is a per-run local now (transpile-restructure
 * 7.6.4), whose fresh start the backends make themselves, and the position rule is what still needs the node.
 *
 * Both backends already had the function: `instantiate` in the interpreter and `initOf` in the emitter. `init` is the
 * COMPLETE static `IrInit` (design.md §3.4).
 */
export interface IrFresh {
  kind: "fresh"
  init: IrInit
  type: Type
  span: Span
}
export interface IrLoad {
  kind: "load"
  place: Place
  type: Type
  span: Span
}
export interface IrBinary {
  kind: "binary"
  op: IrBinOp
  left: IrExpr
  right: IrExpr
  type: Type
  span: Span
  /** A `div` or `mod` whose divisor is a constant proven harmless: not 0 (and, for MOD, not -1) — no zero check is
   *  needed, so the Rust prints plain `/` and `%` (lowering decides it, `lower/values/fold.ts`; the interpreter computes
   *  the same either way). */
  nonzeroDivisor?: true
  /** A `mul` lowering proved cannot leave its type — a 32-bit tick count scaled up in ULINT (`lower/builtins/conversions.ts`
   *  `tickConversion`, 7.3.10) — so the Rust prints plain `*`, not `wrapping_mul` (the interpreter computes the same either
   *  way). */
  noWrap?: true
}
export interface IrUnary {
  kind: "unary"
  op: IrUnOp
  operand: IrExpr
  type: Type
  span: Span
}
/**
 * A type conversion — implicit (lowering inserts every one; a backend never widens on its own) or explicit
 * (`X_TO_Y`, `TO_Y`). ONE meaning for both, measured on CODESYS (design §11): REAL → integer rounds half away from
 * zero, every integer result wraps to its width, BOOL → numeric is 1/0, numeric → BOOL is "not zero", → REAL is
 * float32. An implicit REAL → integer never reaches here from valid code — it does not compile.
 */
export interface IrConvert {
  kind: "convert"
  value: IrExpr
  type: Type
  span: Span
}
