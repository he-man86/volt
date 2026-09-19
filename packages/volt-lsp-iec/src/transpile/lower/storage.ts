/**
 * What a variable is stored as: a type's storage and its layout, and the declarations that make a frame's slots.
 */
import type { AggregateElement, AggregateInit, Expr, Initializer, Span, TypeDecl, TypeExpr, VarDecl, VarSection } from "../../syntax/index.js"
import { lookup } from "../../symbols/index.js"
import { DEFAULT_STRING_LENGTH, elemOf, elementaryRef, resolveNamedType, type Type } from "../../types/index.js"
import { defaultValueOf, elementOf, type IrExpr, type IrInit, type IrStmt, type IrValue, type Place } from "../ir/index.js"
import { baseOf, boundName, Lowering, openDims, ZERO_SPAN } from "./lowering.js"
import { stored, valueAs } from "./convert.js"
import { calendarOf, durationOf, enumDefault, enumStorage, inlineEnumDefault, foldConstant, stringLiteralText, TEMPORAL_LITERAL_KINDS, typedRealOf } from "./constants.js"
import { overlayBytes } from "./unions.js"

/**
 * The FB variable sections that get a FRAME SLOT. VAR_IN_OUT does not: it aliases the caller's variable. Nor does
 * VAR_STAT, which is shared by every instance (`declareStatics`). VAR_TEMP does, and is started over on each run
 * (`tempResets`).
 *
 * A FRAME SLOT IS NOT THE SAME AS A BYTE IN THE INSTANCE, and this said "an instance's storage", which reads as if it
 * were. `bytes.ts` skips VAR_TEMP and VAR_STAT when it lays an instance out, and says the opposite in its own words —
 * the two files were read as contradicting each other. They do not: a temp lives in the frame so the body can use it,
 * and is absent from the layout SIZEOF reports. **What CODESYS answers for SIZEOF of an FB holding a VAR_TEMP is not
 * measured** — `mem_sizeof_fb_with_temp` and `mem_sizeof_fb_with_stat` record it against a baseline that has neither.
 */
export const INSTANCE_STORAGE: ReadonlySet<string> = new Set(["VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_TEMP"])

/** A slot's string type with its capacity stated: a sizeless STRING or WSTRING holds `DEFAULT_STRING_LENGTH`. */
export function withStringCapacity(t: Type): Type {
  if (t.kind !== "elementary" || t.length !== undefined || (t.name !== "STRING" && t.name !== "WSTRING")) return t
  return { ...t, length: DEFAULT_STRING_LENGTH }
}

/**
 * The type a variable is STORED as: a sizeless string with its capacity, a struct or FB under its DECLARED name (ST is
 * case-insensitive and Rust is not, so `fb_x : fb_conveyor` and `FB_Conveyor` must be one struct), an array of
 * those. Building it builds the layout of every composite type it reaches, dependencies first.
 */
export function storageOf(lw: Lowering, t: Type): Type {
  if (t.kind === "array") return { ...t, element: storageOf(lw, t.element) }
  if (t.kind === "enum") return enumStorage(lw, t)
  if (t.kind !== "struct" && t.kind !== "function_block") return withStringCapacity(t)
  const sym = lookup(lw.project, t.name)?.symbol
  const name = sym?.name ?? t.name
  const key = name.toUpperCase()
  // A TYPE THAT CONTAINS ITSELF HAS NO SIZE, and saying so beats running out of stack. `FUNCTION_BLOCK FB_R VAR r :
  // FB_R; END_VAR` — or any longer cycle through a struct — sent `storageOf` and `buildLayout` into each other until
  // the process died with a RangeError, where the rule for this component is that invalid input ends in a
  // LowerDiagnostic and never a throw. CODESYS rejects the shape too, so nothing is lost by refusing it; what was
  // lost was the difference between "refused" and "crashed". The corpus has no self-referential type, which is why
  // `TOTALITY` never saw it — found by aiming at `calls.ts`'s uncovered refusals (0.7).
  if (lw.shared.building.has(key)) {
    lw.bail("layout-recursive", `${name} contains itself, so it has no size`, sym?.span ?? ZERO_SPAN)
    return { ...t, name }
  }
  if (!lw.layouts.has(key)) {
    lw.shared.building.add(key)
    try {
      buildLayout(lw, { ...t, name }, sym)
    } finally {
      lw.shared.building.delete(key)
    }
  }
  return { ...t, name }
}

/** A struct's fields or an FB instance's storage, lowered in the type's own scope — a base type's fields first. */
export function buildLayout(lw: Lowering, t: Extract<Type, { kind: "struct" | "function_block" }>, sym: ReturnType<typeof lookup> extends infer R ? (R extends { symbol: infer S } ? S : never) | undefined : never): void {
  const nested = new Lowering(t.scope ?? lw.project, lw.project, lw.shared)
  nested.selfType = t
  nested.codeOwner = t.scope
  nested.frameContext = `FB:${t.name.toUpperCase()}`
  const statics: { name: string; global: number }[] = []
  const base = (name: string | undefined): void => {
    if (name === undefined) return
    const baseType = storageOf(lw, resolveNamedType(name, lw.project))
    const layout = baseType.kind === "struct" || baseType.kind === "function_block" ? lw.layouts.get(baseType.name.toUpperCase()) : undefined
    if (layout === undefined) return void lw.bail("layout-base", `the base type ${name} of ${t.name} has no layout`, sym?.span ?? ZERO_SPAN)
    nested.inherit(layout.fields)
    for (const shared of layout.statics ?? []) {
      nested.statics.set(shared.name.toUpperCase(), shared.global)
      statics.push(shared)
    }
  }
  const ast = sym?.ast
  if (t.kind === "struct" && ast?.kind === "type_decl" && ast.body.kind === "struct") {
    base(ast.body.extends?.text)
    declareVars(nested, [{ sectionKind: "VAR", decls: ast.body.fields } as unknown as VarSection])
  } else if (t.kind === "struct" && ast?.kind === "type_decl" && ast.body.kind === "union") {
    // A struct of its members, kept overlaid by the store (`unions.ts`) — either every member's bytes are measured, or
    // EVERY member is a pointer, which is one integer in this model (design §9 form 1), so the overlay is a plain copy.
    // A union of pointers is how an ANY input's `pValue` is read at the width its `diSize` selects (conformance
    // `state_any_int_pointer_increment`).
    declareVars(nested, [{ sectionKind: "VAR", decls: ast.body.fields } as unknown as VarSection])
    const pointers = nested.frame.length > 0 && nested.frame.every((f) => f.type.kind === "pointer")
    if (ast.body.fields.some((f) => f.init !== undefined) || !(pointers || nested.frame.every((f) => overlayBytes(f.type) !== undefined))) {
      lw.bail("layout-union", `${t.name} has a member whose overlaid bytes are not measured, or an initial value`, sym?.span ?? ZERO_SPAN)
      return
    }
    lw.shared.unions.add(t.name.toUpperCase())
  } else if (t.kind === "function_block" && (ast?.kind === "function_block" || ast?.kind === "program")) {
    // The compiler acts on these whether or not the FB is ever called, and `lowerUnit`'s init step models them: an
    // `instance-path` STRING holds the instance's path from the project tree, and a `call_after_global_init_slot` method
    // runs once per instance before the first scan; `call_after_init`'s and `call_after_online_change_slot`'s did not run
    // at all in a started application (measured).
    base(baseOf(ast)?.text)
    declareVars(nested, ast.varSections.filter((s) => INSTANCE_STORAGE.has(s.sectionKind)))
    // an `ARRAY[*]` in-out's bounds are the instance's: each call stores them, and the body reads them there
    declareOpenBounds(nested, ast.varSections.filter((s) => s.sectionKind === "VAR_IN_OUT"), "VAR")
    for (const section of ast.varSections.filter((s) => s.sectionKind === "VAR_STAT")) declareStatics(lw, nested, t.name, section, statics)
    nested.displayName = ast.name.text
    lw.bodies.set(t.name.toUpperCase(), { lowering: nested, unit: ast, state: "pending", ...(sym?.uri === undefined ? {} : { uri: sym.uri }) })
  } else {
    lw.bail(`layout-${t.kind}`, `${t.name} has no declaration lowering can lay out`, sym?.span ?? ZERO_SPAN)
    return
  }
  lw.diagnostics.push(...nested.diagnostics)
  // the live frame: temps the FB's body adds when a call lowers it are fields of the instance too
  lw.layouts.set(t.name.toUpperCase(), { name: t.name, kind: t.kind, fields: nested.frame, ...(statics.length > 0 ? { statics } : {}) })
}

/**
 * An FB body's VAR_STAT: ONE variable every instance shares — measured, two instances each counting twice read 4
 * (conformance `life_fb_var_stat_instances`) — so a global named for the FB, as a METHOD's VAR_STAT is named for the
 * method. It was laid out as a field of each instance (review 2026-09-15). The body, its methods and derived FBs reach it
 * by its own name (`Lowering.statics`).
 */
function declareStatics(lw: Lowering, nested: Lowering, fb: string, section: VarSection, statics: { name: string; global: number }[]): void {
  const key = (name: string) => `__${fb}_${name}`.toUpperCase()
  const names = section.decls.flatMap((d) => d.names.map((n) => n.text))
  if (!names.every((n) => lw.shared.globals.byName.has(key(n)))) {
    const global = new Lowering(nested.scope, lw.project, lw.shared)
    global.globalMode = true
    declareVars(global, [{ ...section, decls: section.decls.map((d) => ({ ...d, names: d.names.map((n) => ({ ...n, text: `__${fb}_${n.text}` })) })) }])
    nested.diagnostics.push(...global.diagnostics)
  }
  for (const name of names) {
    const index = lw.shared.globals.byName.get(key(name))
    if (index === undefined) continue
    nested.statics.set(name.toUpperCase(), index)
    statics.push({ name, global: index })
  }
}

/**
 * A body's VAR_TEMP started over at its initial value — the first statements of every run (conformance
 * `life_fb_var_temp_calls`, `life_program_var_temp_runs`: 1 and 6 after two runs, not 2 and 7). A PROGRAM's kept its value
 * across scans, and an FB's was refused as unmeasured (review 2026-09-15). The variables stay slots of the frame; a
 * temp that is not elementary is refused — resetting one is not built.
 */
export function tempResets(lw: Lowering, sections: readonly VarSection[], span: Span): IrStmt[] | undefined {
  const resets: IrStmt[] = []
  for (const decl of sections.filter((s) => s.sectionKind === "VAR_TEMP").flatMap((s) => s.decls))
    for (const name of decl.names) {
      const index = lw.byName.get(name.text.toUpperCase())
      if (index === undefined) continue // refused where it was declared
      const slot = lw.slots[index]!
      // A COMPOSITE RESETS TOO, to a fresh value of its type. Measured: an ARRAY in VAR_TEMP counts 1 after three
      // scans where the same ARRAY in VAR counts 3, and a STRING the same (`decl_temp_array_counts`,
      // `decl_temp_string_counts`) — so a composite behaves exactly as a scalar does and was refused only because
      // an `IrConst` cannot carry an aggregate initializer. `IrFresh` can.
      const value: IrExpr =
        slot.type.kind === "elementary"
          ? { kind: "const", value: slot.init as IrValue, type: slot.type, span }
          : { kind: "fresh", init: slot.init, type: slot.type, span }
      resets.push({ kind: "assign", target: { slot: index, path: [], type: slot.type, span }, value, span })
    }
  return resets
}

export function declareVars(lw: Lowering, sections: readonly VarSection[]): void {
  // a VAR_EXTERNAL declares no storage: its name is the global's (`globalPlace`) — a slot here would be a local copy
  for (const sec of sections.filter((s) => s.sectionKind !== "VAR_EXTERNAL"))
    for (const written of sec.decls) {
      if (written.at !== undefined && !bindAddress(lw, written)) continue
      const type = storageOf(lw, lw.resolve(written.type))
      // A variable with no initializer of its own starts at its ALIAS type's: `TYPE T : INT := 42;` makes `x : T` 42
      // (conformance `type_dut_alias_with_init`, 43 after `x := x + 1`). It started at 0 — `resolve` sees through the
      // alias to INT and the alias's initializer went with it.
      const decl = { ...written, init: written.init ?? aliasInit(lw, written.type) }
      // ONLY a variable that takes the TYPE's default asks where that default is, and for an ENUM that is not always
      // zero — `enumDefault` carries the measured rule. A variable WITH an initializer never asks; neither does
      // folding a VALUE of the same enum, which is a constant its declaration states.
      const enumStart =
        decl.init === undefined ? (enumDefault(lw, lw.resolve(written.type)) ?? inlineEnumDefault(lw, written.type)) : undefined
      const init =
        decl.init === undefined
          ? enumStart === undefined
            ? undefined
            : stored(enumStart, type)
          : decl.init.kind === "aggregate_init"
            ? aggregateInit(lw, decl.init, type)
            : scalarInit(lw, decl.init, type)
      if (decl.init !== undefined && init === undefined) continue
      for (const name of decl.names) {
        // A NAME DECLARED TWICE IS INVALID INPUT, and must end in a diagnostic here rather than a throw later.
        // CODESYS rejects it outright — "A local variable named 'iCounter' is already defined", "Duplicate definition
        // of variable 'shared' in function block" (`duplicate_declaration`, `cc2_duplicate_inherited_variable`) — but
        // lowering accepted it and left the two slots to the EMITTER, which either renamed one silently or, since the
        // emitted surface became a contract, threw. Neither is this component's rule: invalid input ends in a
        // LowerDiagnostic. An INHERITED name is the same fact one scope up, which is why the check reads the frame
        // rather than the section.
        if (lw.declared(name.text))
          lw.bail("var-duplicate", `${name.text} is declared more than once`, decl.span)
        else lw.slot(name, type, sec.sectionKind, init)
      }
    }
}

/**
 * THE ONE SPELLING OF A DIRECT ADDRESS — `%` area, width, index, and a bit only on an `X`. Undefined for anything else,
 * which each caller reports in its own words.
 *
 * The regex and that shape rule were written out twice, and the overlap bookkeeping below a third time in its own
 * shape, so the rule for what an address IS lived in three places that could drift apart while every test still passed.
 */
function parseAddress(text: string): RegExpExecArray | undefined {
  const m = /^%([IQM])([XBWDL])(\d+)(?:\.(\d+))?$/i.exec(text)
  return m === null || (m[2]!.toUpperCase() === "X") !== (m[4] !== undefined) ? undefined : m
}

/** The name an address would alias, or undefined when it is free — the one overlap rule, under both interpretations. */
/**
 * TWO ADDRESSES THAT OVERLAP ARE ONE STORAGE, and the vendor aliases them. This refuses the overlap instead, which
 * is a REACH gap and not a wrong answer — the whole model is measured now (`declarations/addresses.ts`, 2026-09-19)
 * and waiting for a byte-addressable marker area to hold it:
 *
 *   %MW4 := 16#1234   ->   %MB8 is 16#34 and %MB9 is 16#12      LITTLE-ENDIAN
 *   %MD16 := 16#12345678 -> %MW32 is 16#5678                    and the numbering is in UNITS, not bytes:
 *                                                               word 4 IS bytes 8-9, dword 16 IS words 32-33
 *   %MB12 := 1        ->   %MX12.0 is TRUE                      bit 0 is the least significant
 *   %MB12 := 128      ->   %MX12.7 is TRUE
 *   two WORDs at %MW2 ->   writing one shows in the other
 *
 * Implementing it means each area becoming a byte array with every addressed variable a VIEW into it (offset,
 * width, little-endian) rather than a slot of its own — a new storage kind in the IR and in both backends. Six
 * fixtures sit at `not-lowered` until then, which is the honest rating: the vendor runs them and we refuse.
 */
function addressClash(lw: Lowering, m: RegExpExecArray): string | undefined {
  const { area, bits } = addressBits(m)
  return lw.shared.addressed.find((x) => x.area === area && x.bits[0] < bits[1] && bits[0] < x.bits[1])?.name
}

/** That address, recorded as taken by `name`. */
function claimAddress(lw: Lowering, m: RegExpExecArray, name: string, owner: string): void {
  const { area, bits } = addressBits(m)
  lw.shared.addressed.push({ area, bits, name, owner })
}

/**
 * A DIRECT ADDRESS written as an EXPRESSION — `x := %IB8`, `%MW30 := %MW30 + 1` — which the corpus does 8 times and no
 * variable names. It is the same plain storage an `AT` variable is (conformance `ca_direct_address_expression`: `%MW30`
 * written 258 reads back 258, then 259; an input image reads 0, since nothing drives one in the simulator), so it gets
 * one APPLICATION-WIDE slot per address: the process image is not a frame's. Two mentions of one address are one slot;
 * two addresses that would overlap are refused, as two `AT` variables on overlapping addresses already are.
 */
export function addressPlace(lw: Lowering, text: string, span: Span): Place | undefined {
  const m = parseAddress(text)
  if (m === undefined) return lw.bail("var-at", `${text}: an address that is incomplete, or of a shape not modelled`, span)
  const key = text.toUpperCase()
  const known = lw.shared.globals.byName.get(key)
  const width = m[2]!.toUpperCase() as "X" | "B" | "W" | "D" | "L"
  const type = elementaryRef({ X: "BOOL", B: "BYTE", W: "WORD", D: "DWORD", L: "LWORD" }[width])
  if (known !== undefined) return { slot: known, path: [], type, span, root: "global" }
  if (!reserveAddress(lw, text, m, key, span)) return undefined
  lw.shared.globals.byName.set(key, lw.shared.globals.slots.length)
  lw.shared.globals.slots.push({ name: key, type, section: "VAR", init: defaultValueOf(type) })
  return { slot: lw.shared.globals.slots.length - 1, path: [], type, span, root: "global" }
}

/**
 * The bits an address covers, MEASURED: the simulator addresses a word by its WORD index, not its byte — `%QW5` and
 * `%QW6` written 16#1111 and 16#2222 read back as themselves, and `%QW2` beside `%QB2` leaves the byte at 0
 * (conformance `ca_adjacent_word_addresses`). Both were refused as overlaps while this tried the byte interpretation
 * too, which is the pattern every real project writes — the corpus has `%IW5` next to `%IW6` and `%QW2` next to `%QB2`.
 * ponytail: a project that turns BYTE addressing on is not modelled, and nothing Volt reads says which one it is.
 */
export function addressBits(m: RegExpExecArray): { area: string; bits: [number, number] } {
  const n = Number(m[3])
  const width = { X: 0, B: 1, W: 2, D: 4, L: 8 }[m[2]!.toUpperCase() as "X" | "B" | "W" | "D" | "L"]
  const bit = n * 8 + Number(m[4] ?? 0)
  return { area: m[1]!.toUpperCase(), bits: width === 0 ? [bit, bit + 1] : [n * width * 8, (n + 1) * width * 8] }
}

/** The overlap bookkeeping `bindAddress` keeps, for an address with no variable on it. */
function reserveAddress(lw: Lowering, text: string, m: RegExpExecArray, name: string, span: Span): boolean {
  const clash = addressClash(lw, m)
  if (clash !== undefined) {
    lw.bail("var-at", `${text} overlaps ${clash} — the vendor aliases them and this has no byte-addressable area to do it in`, span)
    return false
  }
  claimAddress(lw, m, name, "GLOBAL")
  return true
}

/**
 * `AT %I…/%Q…/%M…` (conformance `operand_hw_address_marker`): in the simulator an address is plain storage — nothing drives
 * an input, a marker reads back what was written — so the variable stays an ordinary slot, the process image a transpiled
 * test writes and reads. What plain storage cannot hold is the ALIASING an address brings (review 2026-09-15), so that is
 * refused: two variables whose addresses overlap — under byte addressing and under word addressing alike, as which one
 * the project uses is not read — several names on one address, an incomplete `%I*` (mapped elsewhere), an address in a
 * METHOD or FUNCTION. An FB field's address shared by the FB's several instances is refused once the POU has lowered.
 */
function bindAddress(lw: Lowering, decl: VarDecl): boolean {
  const text = decl.at!.tokens.map((t) => t.text).join("")
  const refuse = (why: string): boolean => {
    lw.bail("var-at", `${decl.names.map((n) => n.text).join(", ")} AT ${text}: ${why}`, decl.span)
    return false
  }
  const m = parseAddress(text)
  if (m === undefined) return refuse("an address that is incomplete, or of a shape not modelled")
  if (lw.routineMode) return refuse("an address inside a METHOD or FUNCTION")
  if (decl.names.length > 1) return refuse("several variables on one address")
  const clash = addressClash(lw, m)
  if (clash !== undefined) return refuse(`it overlaps ${clash} — the vendor aliases them and this has no byte-addressable area to do it in`)
  claimAddress(lw, m, decl.names[0]!.text, lw.globalMode ? "GLOBAL" : lw.frameContext)
  return true
}

/**
 * A scalar initial value, folded and stored at the slot's type — undefined, reported, when it does not fold.
 * The folded value takes the SLOT's type: `x : REAL := 7 / 2` folds to the integer 3 and is stored as REAL 3 (left as-is,
 * a REAL slot started life holding a bigint). `constEval` folds only numbers and booleans — a duration or date literal
 * came back undefined, so every `t : TIME := T#1S` slot silently started at 0: they fold here, in their type's unit. Nor
 * does it fold strings: every `s : STRING := 'abc'` started empty (conformance `string_*`). An initializer that does not
 * fold is REPORTED — it used to be dropped, so the slot silently started at its default.
 */
function scalarInit(lw: Lowering, e: Expr, type: Type): IrValue | undefined {
  const temporal = e.kind === "literal" ? (durationOf(e) ?? calendarOf(e) ?? typedRealOf(e)) : undefined
  // same rule as `lowerExpr`: a temporal literal that did not convert is reported, not passed to the string path
  if (temporal === undefined && e.kind === "literal" && TEMPORAL_LITERAL_KINDS.has(e.literalKind))
    return lw.bail("bad-literal", `${e.literalKind} literal outside the representable range: ${e.text}`, e.span)
  const text = e.kind === "literal" && typeof e.value === "string" ? stringLiteralText(lw, e) : undefined
  if (text === null) return undefined
  const folded = temporal?.value ?? text ?? foldConstant(lw, e)
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
function aggregateInit(lw: Lowering, init: AggregateInit, type: Type): IrInit | undefined {
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

/** An FB body's VAR_IN_OUT parameters — not storage: each names the caller's variable for the call. */
export function declareInOuts(lw: Lowering, sections: readonly VarSection[]): void {
  for (const sec of sections)
    for (const decl of sec.decls) {
      const type = storageOf(lw, lw.resolve(decl.type))
      for (const name of decl.names) {
        lw.inoutByName.set(name.text.toUpperCase(), lw.inoutSlots.length)
        const constant = sec.constant === true ? { constant: true, ...(holdsInstance(lw, type) ? {} : { readOnly: true }) } : {}
        lw.inoutSlots.push({ name: name.text, type, section: "VAR_IN_OUT", init: defaultValueOf(type), ...constant })
      }
    }
}

/**
 * An `ARRAY[*]` VAR_IN_OUT's bounds, two per dimension — hidden slots its caller fills with the bounds of the array it
 * binds: a routine's as inputs, an FB's as fields of the instance (design §26). DINT, as measured
 * (`callshape_array_star_bound_width`: `UPPER_BOUND(values, 1) * 40000` wraps at 70002).
 */
export function declareOpenBounds(lw: Lowering, sections: readonly VarSection[], section: "VAR_INPUT" | "VAR"): void {
  for (const decl of sections.flatMap((s) => s.decls))
    for (const name of decl.names)
      for (let dim = 1; dim <= openDims(lw.resolve(decl.type)); dim++)
        for (const which of ["lower", "upper"] as const) lw.slot({ kind: "identifier", text: boundName(name.text, which, dim), span: name.span }, elementaryRef("DINT"), section)
}

/** Whether a value of `t` holds an FB instance — it is one, or an element or a field at any depth is. */
export function holdsInstance(lw: Lowering, t: Type): boolean {
  // an `ARRAY[*]` of instances holds them too
  const element = elementOf(t)
  if (element !== undefined) return holdsInstance(lw, element)
  if (t.kind === "function_block") return true
  return t.kind === "struct" && (lw.layouts.get(t.name.toUpperCase())?.fields ?? []).some((f) => holdsInstance(lw, f.type))
}

/** The initializer the variable's alias type carries. ponytail: an alias OF an alias is unmeasured, so only the
 *  direct alias's own `:=` is taken — measure a chain before walking it. */
export function aliasInit(lw: Lowering, t: TypeExpr): Initializer | undefined {
  if (t.kind !== "named_type") return undefined
  const sym = lookup(lw.scope, t.name.text)?.symbol
  const body = sym?.kind === "type" ? (sym.ast as TypeDecl).body : undefined
  return body?.kind === "alias" ? body.init : undefined
}
