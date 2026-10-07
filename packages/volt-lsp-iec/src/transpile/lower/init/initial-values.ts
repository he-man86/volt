/**
 * A slot's initial value: a scalar folded at its type, an aggregate, an alias's initializer, an array's element
 * defaults — and which initializer the init step runs instead.
 */

import type {
  AggregateElement,
  AggregateInit,
  Expr,
  Initializer,
  TypeDecl,
  TypeExpr,
} from "../../../frontend/syntax/index.js"
import type { Lowering } from "../lowering.js"
import { elemOf, enumDefault, inlineEnumDefault, type Type, typeZero } from "../../../frontend/types/index.js"
import type { IrInit, IrValue } from "../../ir/index.js"
import { calendarOf, durationOf, stringLiteralText, TEMPORAL_LITERAL_KINDS, typedRealOf } from "../values/literals.js"
import { foldConstant, foldedCall } from "../values/fold.js"
import { stored, valueAs } from "../values/convert.js"
import { enumeratorValue } from "../values/enums.js"
import { lookup } from "../../../frontend/symbols/index.js"

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
  // a CONSTANT's slot holds its unrounded fold, stored at its own type: `DChain : LREAL := C01` (C01 : REAL := 0.1) is 0.1
  const folded = temporal?.value ?? text ?? foldConstant(lw, e, asConstant) ?? foldedCall(lw, e, type)
  if (folded === undefined) return lw.bail("init-not-constant", "an initial value that is not a compile-time constant", e.span)
  // The DECLARATION half of the same rule the assignment path states: a STRING does not implicitly become a number.
  // `cc_init_string_into_int` is `i : INT := '''abc'''`, which CODESYS rejects, and which reached the emitter as a
  // sizeless string and threw there.
  if (typeof folded === "string" && elemOf(type)?.family !== undefined && elemOf(type)!.family !== "string")
    return lw.bail("assign-string", `a STRING initial value on a ${type.kind === "elementary" ? type.name : type.kind}`, e.span)
  return stored(valueAs(folded, type), type)
}

/**
 * An aggregate initializer as the initial value it is (conformance `array_initializers`, `init_struct_by_field`,
 * `init_array_of_structs`, `init_fb_instance_inputs`): an array's elements in order — `n(v)` repeated, a
 * multi-dimensional array filled row by row, every element left out at its type's own initial value; a struct's or FB
 * instance's fields by name, every field left out at its TYPE's initial value. `STRUCT(…)` is `(…)`. Any other shape — a
 * positional element in a struct form, more elements than the array holds, an unparsed element — is refused.
 */
export function aggregateInit(lw: Lowering, init: AggregateInit, type: Type): IrInit | undefined {
  const refuse = (why: string): undefined => lw.bail("aggregate-init", `an aggregate initializer ${why}`, init.span)
  const element = (e: AggregateElement, of: Type): IrInit | undefined =>
    e.kind === "value" ? scalarInit(lw, e.expr, of) : e.kind === "nested" ? aggregateInit(lw, e.init, of) : refuse(`with a ${e.kind} element where a value belongs`)
  if (init.form === "array") {
    if (type.kind !== "array" || type.bounds === undefined) return refuse("in array form for something that is not a sized array")
    const leaves: AggregateElement[] = []
    for (const e of init.elements) {
      if (e.kind !== "repeat") {
        leaves.push(e)
        continue
      }
      const count = foldConstant(lw, e.count)
      if (typeof count !== "bigint" || count < 0n) return refuse("with a repeat count that does not fold")
      for (let i = 0n; i < count; i++) leaves.push(e.value)
    }
    // every dimension of this one array type, row by row; an ARRAY OF ARRAY's element takes a nested `[…]` of its own
    const lengths = type.bounds.map((b) => Number(b.upper - b.lower + 1n))
    if (leaves.length > lengths.reduce((n, length) => n * length, 1)) return refuse("with more elements than the array holds")
    const values: (IrInit | undefined)[] = []
    for (const leaf of leaves) {
      const value = element(leaf, type.element)
      if (value === undefined) return undefined
      values.push(value)
    }
    const nest = (level: number, offset: number): IrInit | undefined => {
      if (level === lengths.length) return values[offset]
      const stride = lengths.slice(level + 1).reduce((n, length) => n * length, 1)
      return { elements: Array.from({ length: lengths[level]! }, (_, i) => nest(level + 1, offset + i * stride)) }
    }
    return nest(0, 0)
  }
  if (init.form === "struct") {
    const layout = type.kind === "struct" || type.kind === "function_block" ? lw.layouts.get(type.name.toUpperCase()) : undefined
    if (layout === undefined) return refuse("in struct form for something that is not a struct or FB instance")
    if (lw.shared.unions.has(layout.name.toUpperCase())) return refuse("of a UNION, which is not measured")
    const fields: Record<string, IrInit> = {}
    for (const e of init.elements) {
      if (e.kind !== "field") return refuse("with an element that names no field")
      const field = layout.fields.find((f) => f.name.toUpperCase() === e.name.toUpperCase())
      if (field === undefined) return refuse(`naming ${e.name}, which is no field of ${layout.name}`)
      const value = element(e.value, field.type)
      if (value === undefined) return undefined
      fields[field.name.toUpperCase()] = value
    }
    return { fields }
  }
  return refuse("of a shape lowering does not recognise")
}

/**
 * AN ARRAY'S ELEMENTS START AT THEIR ELEMENT TYPE'S DEFAULT, not the family zero: an enum's (`enumDefault`), an alias's
 * own `:=`, an initialized alias-of-array's for each element (conformance `array_element_type_default`: `ARRAY OF E` with
 * `E : (A := 3, B := 4)` is 3, `ARRAY OF MyInt` with `MyInt : INT := 5` is 5 — transpile-review 25). Only for an array
 * declared WITHOUT an initializer: a partial `[7]`'s tail stays 0 (`r_alias_part2`), which `aggregateInit` already does.
 * Undefined when the element's default is its zero, so the slot keeps `typeZero`.
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
        ? alias.kind === "aggregate_init"
          ? aggregateInit(lw, alias, element)
          : scalarInit(lw, alias, element)
        : enumStart === undefined
          ? undefined
          : stored(enumStart, element)
  if (one === undefined || one === typeZero(element)) return undefined
  const lengths = type.bounds.map((b) => Number(b.upper - b.lower + 1n))
  const fill = (level: number): IrInit => (level === lengths.length ? one : { elements: Array.from({ length: lengths[level]! }, () => fill(level + 1)) })
  return fill(0)
}

/** The initializer the variable's alias type carries. ponytail: an alias OF an alias is unmeasured, so only the
 *  direct alias's own `:=` is taken — measure a chain before walking it. */
export function aliasInit(lw: Lowering, t: TypeExpr): Initializer | undefined {
  if (t.kind !== "named_type") return undefined
  const sym = lookup(lw.scope, t.name.text)?.symbol
  const body = sym?.kind === "type" ? (sym.ast as TypeDecl).body : undefined
  return body?.kind === "alias" ? body.init : undefined
}
