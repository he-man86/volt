/**
 * A slot's initial value: a scalar folded at its type, an aggregate, an alias's initializer, an array's element
 * defaults — and which initializer the init step runs instead.
 */

import type {
  AggregateElement,
  AggregateInit,
  Expr,
  Initializer,
  Span,
  TypeDecl,
  TypeExpr,
} from "../../../frontend/syntax/index.js"
import { type Lowering, zeroInit } from "../core/lowering.js"
import { elemOf, enumDefault, inlineEnumDefault, peelArray, type Type, typeZero } from "../../../frontend/types/index.js"
import { fieldIn, type IrInit, type IrValue } from "../../ir/index.js"
import { calendarOf, durationOf, stringLiteralText, TEMPORAL_LITERAL_KINDS, typedRealOf } from "../values/literals.js"
import { foldConstant, foldsToConstant } from "../values/fold.js"
import { exprHoldsCall } from "../core/ast-walk.js"
import { declaredTypeChain } from "../core/chain.js"
import { constantValue, NaNBits } from "../../semantics/index.js"
import { lowerExpr } from "../expressions/expressions.js"
import { stored, valueAs } from "../values/convert.js"
import { enumeratorValue } from "../values/enums.js"
import { lookup } from "../../../frontend/symbols/index.js"
import { unionsOf } from "../storage/unions.js"
import { refusedRotateInInitializer } from "../builtins/value-functions.js"

/**
 * An initializer the INIT STEP can run — an ordinary expression, not an aggregate.
 *
 * An aggregate (`(a := 1, b := 2)`, `[1, 2, 3]`) is a structured initial VALUE, applied where the slot is declared;
 * it has its own path and its own refusals. Everything else is an expression, and `scalarInit` has already tried
 * to fold it — so reaching here means it needs the frame, which is exactly what the init step has.
 */
export function runnableInit(init: Initializer): init is Expr {
  return init.kind !== "aggregate_init"
}

/**
 * A scalar initial value, folded and stored at the slot's type — undefined, reported, when it does not fold.
 * The folded value takes the SLOT's type: `x : REAL := 7 / 2` folds to the integer 3 and is stored as REAL 3 (left as-is,
 * a REAL slot started life holding a bigint). `constEval` folds only numbers and booleans — a duration or date literal
 * came back undefined, so every `t : TIME := T#1S` slot silently started at 0: they fold here, in their type's unit. Nor
 * does it fold strings: every `s : STRING := 'abc'` started empty (conformance `string_*`). An initializer that does not
 * fold is REPORTED — it used to be dropped, so the slot silently started at its default.
 */
export function scalarInit(lw: Lowering, e: Expr, type: Type, asConstant = false): IrValue | undefined {
  const temporal = e.kind === "literal" ? (durationOf(e) ?? calendarOf(e) ?? typedRealOf(e)) : undefined
  // same rule as `lowerExpr`: a temporal literal that did not convert is reported, not passed to the string path
  if (temporal === undefined && e.kind === "literal" && TEMPORAL_LITERAL_KINDS.has(e.literalKind))
    return lw.bail("bad-literal", `${e.literalKind} literal outside the representable range: ${e.text}`, e.span)
  const text = e.kind === "literal" && typeof e.value === "string" ? stringLiteralText(lw, e) : undefined
  if (text === null) return undefined
  if (refusedRotateInInitializer(lw, e, type)) return undefined
  // a CONSTANT's slot holds its unrounded fold, stored at its own type: `DChain : LREAL := C01` (C01 : REAL := 0.1) is 0.1
  // folded in its declared type's context: an untyped literal under the NOT or shift it is takes it (`constEval`)
  const folded = temporal?.value ?? text ?? foldConstant(lw, e, asConstant, elemOf(type)) ?? foldedCall(lw, e, type)
  if (folded === undefined) return lw.bail("init-not-constant", "an initial value that is not a compile-time constant", e.span)
  // a fold that is a NaN is its bits (`semantics/nan.ts`), which no IR constant holds — and what CODESYS's own fold stores
  // for one is unmeasured (transpile-restructure 8.2)
  if (folded instanceof NaNBits || (typeof folded === "number" && Number.isNaN(folded))) return lw.bail("init-nan", "an initial value that folds to a NaN, whose bits CODESYS's fold is unmeasured for", e.span)
  // A SCALAR CONSTANT ON A COMPOSITE is refused by CODESYS (`litc_array_init_one`, `litc_struct_init_one`,
  // `litc_fb_init_one`) — and here it was dropped in silence: the array's backends printed its zeros, the struct its
  // `new()`. Once an array's `IrInit` must state its elements (transpile-restructure 5.3), the drop is a refusal.
  if (peelArray(type) !== undefined || type.kind === "struct" || type.kind === "function_block")
    return lw.bail("init-composite-scalar", `a scalar initial value on ${type.kind === "array" ? "an array" : `a ${type.kind.replace("_", " ")}`}`, e.span)
  // The DECLARATION half of the same rule the assignment path states: a STRING does not implicitly become a number.
  // `cc_init_string_into_int` is `i : INT := '''abc'''`, which CODESYS rejects, and which reached the emitter as a
  // sizeless string and threw there.
  if (typeof folded === "string" && elemOf(type)?.family !== undefined && elemOf(type)!.family !== "string")
    return lw.bail("assign-string", `a STRING initial value on a ${type.kind === "elementary" ? type.name : type.kind}`, e.span)
  return stored(valueAs(folded, type), type)
}

/**
 * The DYNAMIC elements and fields of an aggregate initializer (`[k, 0 + F(k), g]`, `(a := k, c := F(g))`), collected by
 * `aggregateInit` when the caller has an init step or a per-run reset to run them in: each the place it assigns (`base`
 * indexed or dotted) and its expression, in element order — the aggregate's static part keeps the element at its type's
 * zero (transpile-restructure 5.5; `var_temp_dynamic_aggregate_init`, M5.1.7: each re-evaluated per call).
 */
export interface DynamicLeaves {
  /** each element's place as a function of the variable's (one declaration may name several variables) */
  readonly leaves: { at: (variable: Expr) => Expr; expr: Expr; span: Span }[]
}

/**
 * An aggregate initializer as the initial value it is (conformance `array_initializers`, `init_struct_by_field`,
 * `init_array_of_structs`, `init_fb_instance_inputs`): an array's elements in order — `n(v)` repeated, a
 * multi-dimensional array filled row by row, every element left out at its type's own initial value; a struct's or FB
 * instance's fields by name, every field left out at its TYPE's initial value. `STRUCT(…)` is `(…)`. Any other shape — a
 * positional element in a struct form, more elements than the array holds, an unparsed element — is refused. Given
 * `dynamic`, an element that is not a constant is collected there (`DynamicLeaves`) rather than refused — except one
 * inside a repeat `n(…)`, whose evaluation count is not recorded.
 */
export function aggregateInit(
  lw: Lowering,
  init: AggregateInit,
  type: Type,
  written?: TypeExpr,
  dynamic?: DynamicLeaves,
  at: (variable: Expr) => Expr = (variable) => variable,
): IrInit | undefined {
  const refuse = (why: string): undefined => lw.bail("aggregate-init", `an aggregate initializer ${why}`, init.span)
  // `target`: the place this element is, for a dynamic one to assign; `repeated`: it came out of `n(…)`
  // `writtenOf`: the element's or field's declared type, which says what storage erased (an enum is its integer there)
  const element = (e: AggregateElement, of: Type, place: (variable: Expr) => Expr, repeated = false, writtenOf?: TypeExpr): IrInit | undefined => {
    if (e.kind === "value" && dynamic !== undefined && !foldsToConstant(lw, e.expr)) {
      if (repeated) return refuse("repeating an element that is not a constant — how often it is evaluated is not recorded")
      dynamic.leaves.push({ at: place, expr: e.expr, span: e.span })
      return zeroInit(of)
    }
    if (e.kind === "value") return scalarInit(lw, e.expr, of)
    if (e.kind !== "nested") return refuse(`with a ${e.kind} element where a value belongs`)
    // a nested aggregate inside a repeat holding a dynamic leaf is the same unrecorded count (gate 5c: `[2([F(), 7])]`
    // called F once per repetition)
    const before = dynamic?.leaves.length ?? 0
    const nested = aggregateInit(lw, e.init, of, writtenOf, dynamic, place)
    if (nested !== undefined && repeated && (dynamic?.leaves.length ?? 0) > before)
      return refuse("repeating an element that is not a constant — how often it is evaluated is not recorded")
    return nested
  }
  if (init.form === "array") {
    if (type.kind !== "array" || type.bounds === undefined) return refuse("in array form for something that is not a sized array")
    const elementWritten = arrayWritten(lw, written)?.element
    // every dimension of this one array type, row by row; an ARRAY OF ARRAY's element takes a nested `[…]` of its own
    const bounds = type.bounds
    const lengths = bounds.map((b) => Number(b.upper - b.lower + 1n))
    const capacity = lengths.reduce((n, length) => n * length, 1)
    const leaves: { e: AggregateElement; repeated: boolean }[] = []
    for (const e of init.elements) {
      if (e.kind !== "repeat") {
        leaves.push({ e, repeated: false })
        continue
      }
      const count = foldConstant(lw, e.count)
      if (typeof count !== "bigint" || count < 0n) return refuse("with a repeat count that does not fold")
      // checked BEFORE the leaves are built: `[100000000000(1)]` built every one of them first (6.A.15)
      if (BigInt(leaves.length) + count > BigInt(capacity)) return refuse("with more elements than the array holds")
      for (let i = 0n; i < count; i++) leaves.push({ e: e.value, repeated: true })
    }
    if (leaves.length > capacity) return refuse("with more elements than the array holds")
    const values: IrInit[] = []
    for (const [offset, leaf] of leaves.entries()) {
      const value = element(leaf.e, type.element, (variable) => elementAt(bounds, offset, at(variable), init.span), leaf.repeated, elementWritten)
      if (value === undefined) return undefined
      values.push(value)
    }
    // THE TAIL: every element the initializer leaves out starts at its element type's start WITHOUT an alias's `:=` — an
    // alias of INT 0 (`array_element_type_default` r_alias_part2), an enum its default (`array_element_enum_partial_tail`:
    // 3, not 0), a struct its fields
    const full = values.length === capacity
    const tail = full ? zeroInit(type.element) : tailStart(lw, type.element, init.span, elementWritten)
    return tail === undefined ? undefined : compact(values, lengths, tail)
  }
  if (init.form === "struct") {
    const layout = type.kind === "struct" || type.kind === "function_block" ? lw.layouts.get(type.name.toUpperCase()) : undefined
    if (layout === undefined) return refuse("in struct form for something that is not a struct or FB instance")
    if (unionsOf(lw).has(layout.name.toUpperCase())) return refuse("of a UNION, which is not measured")
    const fields: Record<string, IrInit> = {}
    for (const e of init.elements) {
      if (e.kind !== "field") return refuse("with an element that names no field")
      const field = fieldIn(layout.fields, e.name)
      if (field === undefined) return refuse(`naming ${e.name}, which is no field of ${layout.name}`)
      const place = (variable: Expr): Expr => ({ kind: "member", base: at(variable), member: { kind: "ident_expr", name: field.name, span: e.span }, span: e.span })
      const value = element(e.value, field.type, place, false, fieldWritten(lw, layout.name, field.name))
      if (value === undefined) return undefined
      fields[field.name.toUpperCase()] = value
    }
    return { fields }
  }
  return refuse("of a shape lowering does not recognise")
}

/** The element at `offset` of an array laid out row by row, as the index expression a dynamic one assigns: `arr[i, j]`. */
function elementAt(bounds: readonly { lower: bigint; upper: bigint }[], offset: number, array: Expr, span: Span): Expr {
  const lengths = bounds.map((b) => Number(b.upper - b.lower + 1n))
  const indices: Expr[] = bounds.map((b, d) => {
    const stride = lengths.slice(d + 1).reduce((n, length) => n * length, 1)
    const i = b.lower + BigInt(Math.floor(offset / stride) % lengths[d]!)
    return { kind: "literal", literalKind: "int", text: `${i}`, value: i, span }
  })
  return { kind: "index", base: array, indices, span }
}

/** The stated `values` (row by row) of an array of `lengths`, compact: the rows and elements stated, every one after them
 *  at `rest` — `tail` for an element, a row of tails for a row. */
function compact(values: readonly IrInit[], lengths: readonly number[], tail: IrInit): IrInit {
  const restAt = (level: number): IrInit => (level === lengths.length ? tail : { elements: [], rest: restAt(level + 1) })
  const nest = (level: number, offset: number): IrInit => {
    if (level === lengths.length) return values[offset]!
    const stride = lengths.slice(level + 1).reduce((n, length) => n * length, 1)
    const stated: IrInit[] = []
    for (let i = 0; i < lengths[level]! && offset + i * stride < values.length; i++) stated.push(nest(level + 1, offset + i * stride))
    return { elements: stated, rest: restAt(level + 1) }
  }
  return nest(0, 0)
}

/**
 * AN ARRAY'S ELEMENTS START AT THEIR ELEMENT TYPE'S DEFAULT, not the family zero: an enum's (`enumDefault`), an alias's
 * own `:=`, an initialized alias-of-array's for each element (conformance `array_element_type_default`: `ARRAY OF E` with
 * `E : (A := 3, B := 4)` is 3, `ARRAY OF MyInt` with `MyInt : INT := 5` is 5 — transpile-review 25). Only for an array
 * declared WITHOUT an initializer: a partial `[7]`'s tail is `aggregateInit`'s (`tailStart`). Compact — `rest` is every
 * element's start. Undefined when the element's default is its zero, so the slot keeps `zeroInit`.
 */
export function elementDefaults(lw: Lowering, written: TypeExpr, type: Type): IrInit | undefined {
  if (written.kind !== "array_type" || type.kind !== "array" || type.bounds === undefined) return undefined
  const element = type.element
  const alias = aliasInit(lw, written.element)
  const enumStart = enumDefault(lw.project, lw.resolve(written.element), enumeratorValue(lw)) ?? inlineEnumDefault(written.element, enumeratorValue(lw))
  const one =
    written.element.kind === "array_type"
      ? elementDefaults(lw, written.element, element)
      : alias !== undefined
        ? lw.inFile(alias.uri, () =>
            alias.init.kind === "aggregate_init" ? aggregateInit(lw, alias.init, element, arrayWritten(lw, written.element)) : scalarInit(lw, alias.init, element),
          )
        : enumStart === undefined
          ? undefined
          : stored(enumStart, element)
  if (one === undefined || one === typeZero(element)) return undefined
  const fill = (level: number): IrInit => (level === type.bounds!.length ? one : { elements: [], rest: fill(level + 1) })
  return fill(0)
}

/**
 * The start of an element a partial array initializer leaves out — its element type's, WITHOUT an alias's `:=`: an enum
 * at its default (`array_element_enum_partial_tail`: 3, `E : (A := 3, B := 4)`), an alias of INT at 0
 * (`array_element_type_default` r_alias_part2), a struct or FB at its own fields, an array's elements likewise. Storage
 * erases an enum to its integer, so the element's DECLARED type (`written`) says which it is; an elementary element
 * whose declaration is not at hand is refused, by name, rather than started at a zero that may be an enum's wrong value.
 */
function tailStart(lw: Lowering, t: Type, span: Span, written: TypeExpr | undefined): IrInit | undefined {
  const array = peelArray(t)
  if (array !== undefined) {
    // one dimension peeled: a multi-dimensional array keeps its declaration, a last dimension hands on its element's
    const declared = arrayWritten(lw, written)
    const next = t.kind === "array" && t.bounds!.length > 1 ? declared : declared?.element
    const rest = tailStart(lw, array.element, span, next)
    return rest === undefined ? undefined : { elements: [], rest }
  }
  if (t.kind === "struct" || t.kind === "function_block") return { fields: {} }
  if (written === undefined)
    return lw.bail("aggregate-init", "a partial array initializer whose element's declared type is not at hand — whether its tail is an enum's default", span)
  const start = enumDefault(lw.project, lw.resolve(written), enumeratorValue(lw)) ?? inlineEnumDefault(written, enumeratorValue(lw))
  return start === undefined ? typeZero(t) : stored(start, t)
}

/** A declared type as the ARRAY declaration it is — through named aliases of an array (`TYPE MyArr : ARRAY… OF E`). */
function arrayWritten(lw: Lowering, written: TypeExpr | undefined): Extract<TypeExpr, { kind: "array_type" }> | undefined {
  for (let t = written, hops = 0; t !== undefined && hops < 16; hops++) {
    if (t.kind === "array_type") return t
    if (t.kind !== "named_type") return undefined
    const sym = lookup(lw.scope, t.name.text)?.symbol
    const body = sym?.kind === "type" ? (sym.ast as TypeDecl).body : undefined
    t = body?.kind === "alias" ? body.target : undefined
  }
  return undefined
}

/** The type a field of the struct or FB `layoutName` is DECLARED with — its own declaration or a base's. */
function fieldWritten(lw: Lowering, layoutName: string, field: string): TypeExpr | undefined {
  for (const unit of declaredTypeChain(lw, layoutName)) {
    const decls =
      unit.kind === "function_block" || unit.kind === "program" ? unit.varSections.flatMap((sec) => sec.decls)
      : unit.kind === "type_decl" && unit.body.kind === "struct" ? unit.body.fields
      : []
    const decl = decls.find((d) => d.names.some((n) => n.text.toUpperCase() === field.toUpperCase()))
    if (decl !== undefined) return decl.type
  }
  return undefined
}

/** The initializer the variable's alias type carries — the direct alias's own `:=` only: an alias OF an initialized alias
 *  without one of its own starts at 0, not at the inner alias's (`array_element_alias_of_alias`: `Plain : Base` with
 *  `Base : INT := 5` is 0, as a variable and as an element; `Own : Base := 6` is 6) — with the file it is written in, where
 *  a refusal of it points (`Lowering.inFile`). */
export function aliasInit(lw: Lowering, t: TypeExpr): { init: Initializer; uri: string } | undefined {
  if (t.kind !== "named_type") return undefined
  const sym = lookup(lw.scope, t.name.text)?.symbol
  const body = sym?.kind === "type" ? (sym.ast as TypeDecl).body : undefined
  return body?.kind === "alias" && body.init !== undefined ? { init: body.init, uri: sym!.uri } : undefined
}

/**
 * AN INITIAL VALUE THAT IS A CALL — the shape the corpus writes 1084 times and the highest-reach refusal there was.
 *
 * `constEval` folds a literal, a name, an enum member, a unary and a binary, and returns undefined for a CALL. Five
 * real projects write `ANY_TO_DINT(16#80000000)`, `(SHL(UINT_TO_DWORD(x), 16) OR 16#1)`, `SIZEOF(T)` and their
 * neighbours in a declaration, so `init-not-constant` stopped 200 of the 304 POUs that have a body.
 *
 * Measured before implementing (`declarations/constant-folding.ts`, 29 probes): CODESYS folds EVERY one of them —
 * the conversions, the shifts and rotates, MIN/MAX/LIMIT/SEL/MUX, ABS, TRUNC, EXPT, SQRT, SIZEOF, nested and
 * parenthesised — and folds them to exactly what the same expression computes at RUN TIME. `ANY_TO_DINT(16#80000000)`
 * is -2147483648, `INT_TO_BYTE(300)` is 44, `REAL_TO_DINT(3.0E9)` is -1294967296, `REAL_TO_INT(2.5)` is 3.
 *
 * So the value is not folded a second way here: the expression is LOWERED, and `semantics/fold.ts` answers it with
 * the same three switches the interpreter runs. A tree that needs storage — a name, a call to a user FUNCTION, a
 * dereference — is not constant and is rejected there rather than guessed at.
 *
 * WHAT STAYS REFUSED, AND IS NOT A CONSTANT AT ALL. Two more probes show CODESYS's initializers are an
 * initialisation SEQUENCE rather than a fold: `other : INT := -7; i : INT := ABS(other);` gives i = 7, the same
 * pair written the other way round gives 0, and a user FUNCTION reading a global returns 42 for a global that
 * starts at 41 — so they run in DECLARATION ORDER, after the globals, with arbitrary code. Modelling that is a
 * different change; this one takes the half that really is constant.
 *
 * HERE, not in `values/fold.ts` (design.md §2.4 put it there): it lowers the expression (`lowerExpr`), and `values/` is a
 * leaf that imports no `expressions/` (rule 4b, transpile-restructure 6.B.6). Its one caller is `scalarInit`.
 */
function foldedCall(lw: Lowering, e: Expr, type: Type): IrValue | NaNBits | undefined {
  if (!exprHoldsCall(e)) return undefined
  const lowered = lowerExpr(lw, e, type)
  return lowered === undefined ? undefined : (constantValue(lowered) as IrValue | NaNBits | undefined)
}
