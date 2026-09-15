/**
 * Places — where a name, a field, an element or a bit lives: in the frame, a local, a VAR_IN_OUT, or the globals.
 */
import { type Expr, isSelfRef, type Span, type TopLevel, type VarDecl, type VarSection } from "../../syntax/index.js"
import { libraryOf, lookup } from "../../symbols/index.js"
import { elementaryRef, resolveNamedType } from "../../types/index.js"
import { defaultValueOf, elementOf, type IrExpr, peelArray, type Place } from "../ir/index.js"
import { boundName, Lowering, openDims } from "./lowering.js"
import { binaryOf, convert } from "./convert.js"
import { declareVars, storageOf } from "./storage.js"
import { pointeePlace } from "./pointers.js"
import { lowerExpr } from "./expressions.js"

/**
 * A name no local, field or parameter holds: a GVL variable, or a called PROGRAM's instance — the application's
 * storage, one of each (design §9). A POU's VAR_EXTERNAL names the global it declares. Undefined for anything else,
 * which the caller reports; a library's globals stay unmodelled.
 */
export function globalPlace(lw: Lowering, name: string, span: Span): Place | undefined {
  const upper = name.toUpperCase()
  const place = (slot: number): Place => ({ slot, path: [], type: lw.shared.globals.slots[slot]!.type, span, root: "global" })
  // A PROGRAM's instance is the application's, reached from any body (conformance `state_program_called_from_fb`: the one
  // instance PLC_PRG calls). Rust holds the instances apart from the GVL variables (`Programs`, `Globals`), and each body
  // that reaches one records it (`touched`) — a program runs moved out of `Programs`, so it must not reach itself.
  const known = lw.shared.globals.byName.get(upper)
  if (known !== undefined) {
    if (lw.shared.globals.slots[known]!.section === "program") lw.touched.add(known)
    return place(known)
  }
  let sym = lookup(lw.scope, name)?.symbol
  if (sym?.varSection === "VAR_EXTERNAL") sym = lookup(lw.project, name)?.symbol
  // a GVL variable named like its own list (`listVariableShadows`): the bare name is the variable
  if (sym?.kind === "gvl_block") sym = lw.project.symbols.get(upper.toLowerCase())?.find((s) => s.kind === "gvl_var") ?? sym
  if (sym === undefined || libraryOf(sym) !== undefined) return undefined
  if (sym.kind === "gvl_var") declareGlobal(lw, sym.ast as VarDecl, "")
  else if (sym.kind === "program" && sym.name.toUpperCase() !== lw.shared.root.toUpperCase()) {
    const type = storageOf(lw, resolveNamedType(sym.name, lw.project))
    lw.shared.globals.byName.set(upper, lw.shared.globals.slots.length)
    lw.shared.globals.slots.push({ name: sym.name, type, section: "program", init: defaultValueOf(type) })
    lw.touched.add(lw.shared.globals.slots.length - 1)
  } else return undefined
  const slot = lw.shared.globals.byName.get(upper)
  return slot === undefined ? undefined : place(slot)
}

/** A GVL declaration's variables made the application's storage, each keyed by `prefix` and its name. */
function declareGlobal(lw: Lowering, decl: VarDecl, prefix: string): void {
  const gvl = new Lowering(lw.project, lw.project, lw.shared)
  gvl.globalMode = true
  gvl.globalPrefix = prefix
  declareVars(gvl, [{ sectionKind: "VAR", decls: [decl] } as unknown as VarSection])
  lw.diagnostics.push(...gvl.diagnostics)
}

/**
 * `GVL_Name.var` — a global named through its list (conformance `fbcall_gvl_qualified`), the one way to a variable of a
 * `qualified_only` list; a plain list's variable is the same global its bare name reaches.
 */
function qualifiedGlobal(lw: Lowering, list: string, name: string, span: Span): Place | undefined {
  const block = lookup(lw.scope, list)?.symbol
  if (block === undefined || libraryOf(block) !== undefined) return lw.bail("place-not-local", `${list} is a library's global list, which lowering leaves unmodelled`, span)
  const gvl = block.ast as Extract<TopLevel, { kind: "global_var_list" }>
  const decl = gvl.varSections.flatMap((s) => s.decls).find((d) => d.names.some((n) => n.text.toUpperCase() === name.toUpperCase()))
  const sym = decl === undefined ? undefined : lw.project.symbols.get(name.toLowerCase())?.find((s) => s.kind === "gvl_var" && s.ast === decl)
  if (sym === undefined) return lw.bail("place-not-local", `${list}.${name} names no variable of that list`, span)
  const key = `${sym.qualifiedOnly ? `${block.name}.` : ""}${name}`.toUpperCase()
  if (!lw.shared.globals.byName.has(key)) declareGlobal(lw, decl!, sym.qualifiedOnly ? `${block.name}.` : "")
  const slot = lw.shared.globals.byName.get(key)
  return slot === undefined ? undefined : { slot, path: [], type: lw.shared.globals.slots[slot]!.type, span, root: "global" }
}

/**
 * `Mach1_Alarms.Alm001` where `Mach1_Alarms.gvl` declares a variable `Mach1_Alarms` (lenze-mid): the list declares no
 * `Alm001`, so the name can only be the variable and `.Alm001` its field — the one reading that compiles, as the project
 * does in CODESYS. It resolved to the list and was refused ("names no variable of that list", 100 corpus hits).
 */
function listVariableShadows(lw: Lowering, list: string, member: string): boolean {
  const gvl = lookup(lw.scope, list)?.symbol.ast as Extract<TopLevel, { kind: "global_var_list" }> | undefined
  const declares = gvl?.varSections.some((s) => s.decls.some((d) => d.names.some((n) => n.text.toUpperCase() === member.toUpperCase()))) ?? false
  return !declares && (lw.project.symbols.get(list.toLowerCase())?.some((s) => s.kind === "gvl_var") ?? false)
}

/**
 * One bound of one dimension of an array place — LOWER_BOUND/UPPER_BOUND. A sized array's folds; an `ARRAY[*]` in-out's
 * is the hidden bound its call was handed (design §26). DINT, as measured (`callshape_array_star_bound_width`,
 * `callshape_bounds_of_sized_array`). Undefined where neither is known.
 */
export function boundOf(lw: Lowering, place: Place, which: "lower" | "upper", dim: number): IrExpr | undefined {
  const type = elementaryRef("DINT")
  if (place.type.kind !== "array") return undefined
  if (place.type.bounds !== undefined) {
    const bound = place.type.bounds[dim - 1]
    return bound === undefined ? undefined : { kind: "const", value: which === "lower" ? bound.lower : bound.upper, type, span: place.span }
  }
  if (place.root !== "inout" || place.path.length > 0 || dim < 1 || dim > place.type.dims.length) return undefined
  // an FB's in-out reached from its METHOD would read the instance's fields — the bounds of the body's current binding, a
  // model no recording shows (review of batch 3b)
  if (lw.inoutSlots[place.slot]!.ofInstance === true) return undefined
  const key = boundName(lw.inoutSlots[place.slot]!.name, which, dim).toUpperCase()
  const local = lw.localByName.get(key)
  const field = lw.byName.get(key)
  const at: Place | undefined =
    local !== undefined ? { slot: local, path: [], type, span: place.span, root: "local" } : field !== undefined ? { slot: field, path: [], type, span: place.span } : undefined
  return at && { kind: "load", place: at, type, span: place.span }
}

/**
 * An `ARRAY[*]` read or stored as a whole value — refused: it is only ever indexed, bound to another in-out, or read by
 * LOWER_BOUND/UPPER_BOUND in what is recorded. `tmp := numbers` printed a slice clone rustc rejects, and a store swapped
 * the caller's array for one of another length under the old bounds (review of batch 3b).
 */
export function refuseOpenArray(lw: Lowering, place: Place, span: Span): boolean {
  if (openDims(place.type) === 0) return false
  lw.bail("open-array-value", "an ARRAY[*] used as a whole value, not indexed or bound to an in-out", span)
  return true
}

export function lowerPlace(lw: Lowering, e: Expr, notAMember = "place-shape"): Place | undefined {
  if (e.kind === "member") {
    if (/^\d+$/.test(e.member.name)) return bitPlace(lw, e, notAMember)
    if (e.base.kind === "ident_expr" && !lw.holds(e.base.name) && lookup(lw.scope, e.base.name)?.symbol.kind === "gvl_block" && !listVariableShadows(lw, e.base.name, e.member.name))
      return qualifiedGlobal(lw, e.base.name, e.member.name, e.span)
    // a struct's field or an instance's variable: one `field` step on the base place (design §9)
    const base = lowerPlace(lw, e.base, notAMember)
    if (base === undefined) return undefined
    const layout = base.type.kind === "struct" || base.type.kind === "function_block" ? lw.layouts.get(base.type.name.toUpperCase()) : undefined
    const field = layout?.fields.find((f) => f.name.toUpperCase() === e.member.name.toUpperCase())
    if (field === undefined) return lw.bail(notAMember, "member access is not lowered yet", e.span)
    return { ...base, path: [...base.path, { kind: "field", name: field.name }], type: field.type, span: e.span }
  }
  if (e.kind === "index") {
    // one `index` step per dimension, each carrying the bounds a backend normalises by
    let place = lowerPlace(lw, e.base, notAMember)
    // `p[i]` on a pointer: i elements past the one it points at (conformance `mem_pointer_index_struct_array`)
    if (place !== undefined && place.type.kind === "pointer") {
      if (e.indices.length !== 1) return lw.bail("pointer-index", "a pointer indexed in more than one dimension", e.span)
      const extra = lowerExpr(lw, e.indices[0]!)
      return extra && pointeePlace(lw, place, extra, e.span)
    }
    for (const written of e.indices) {
      if (place === undefined) return undefined
      const array = peelArray(place.type)
      // an `ARRAY[*]` in-out's dimension: indexed from the lower bound its call was handed (design §26)
      const open =
        array === undefined && place.type.kind === "array" && place.root === "inout" && place.path.every((s) => s.kind === "index")
          ? boundOf(lw, { ...place, path: [], type: lw.inoutSlots[place.slot]!.type }, "lower", place.path.length + 1)
          : undefined
      if (array === undefined && open === undefined) return lw.bail("place-shape", "an index on something that is not a sized array", e.span)
      const index = lowerExpr(lw, written)
      if (index === undefined) return undefined
      if (open !== undefined) {
        const wide = elementaryRef("LINT")
        const offset = binaryOf("sub", convert(index, wide), convert(open, wide), wide, written.span)
        place = { ...place, path: [...place.path, { kind: "index", index: offset, lower: 0n }], type: elementOf(place.type)!, span: e.span }
        continue
      }
      place = { ...place, path: [...place.path, { kind: "index", index, lower: array!.lower, length: array!.length }], type: array!.element, span: e.span }
    }
    return place
  }
  // `THIS^` — the instance the body runs on (conformance `keyword_this_dereference`, `use_self_method_call`). `SUPER^` is
  // no place of its own: `SUPER^()` and `SUPER^.M()` are calls, lowered in `calls.ts`.
  if (e.kind === "deref" && isSelfRef(e) && e.base.kind === "ident_expr" && e.base.name.toUpperCase() === "THIS" && lw.selfType !== undefined) {
    // a PROGRAM lowered as its one instance has a self type too, but CODESYS refuses THIS there (`fbcall_this_in_program`)
    if (lw.selfType.kind === "function_block" && lw.bodies.get(lw.selfType.name.toUpperCase())?.unit.kind === "program")
      return lw.bail("this-in-program", "THIS in a PROGRAM, which CODESYS does not compile", e.span)
    return { slot: 0, path: [], type: lw.selfType, span: e.span, root: "this" }
  }
  if (e.kind === "deref" && !isSelfRef(e)) {
    const pointer = lowerPlace(lw, e.base, notAMember)
    if (pointer === undefined) return undefined
    if (pointer.type.kind !== "pointer") return lw.bail("place-shape", "a dereference of something that is not a pointer", e.span)
    return pointeePlace(lw, pointer, undefined, e.span)
  }
  if (e.kind !== "ident_expr")
    return lw.bail("place-shape", `${e.kind} is not a lowerable storage location yet`, e.span)
  // an ANY input is read only as `.diSize`; its value, `pValue` and `typeClass` are not measured
  if (lw.anyInputs.has(e.name.toUpperCase())) return lw.bail("any-input", `${e.name} is an ANY input, used other than as .diSize`, e.span)
  // a routine's own local (its result, inputs and VAR) shadows the instance's field of the same name
  const local = lw.localByName.get(e.name.toUpperCase())
  if (local !== undefined) return { slot: local, path: [], type: lw.localSlots[local]!.type, span: e.span, root: "local" }
  // a METHOD's VAR_STAT: one global, named for the method that declares it (conformance `state_var_stat_two_instances`)
  const stat = lw.statics.get(e.name.toUpperCase())
  if (stat !== undefined) return { slot: stat, path: [], type: lw.shared.globals.slots[stat]!.type, span: e.span, root: "global" }
  const slot = lw.byName.get(e.name.toUpperCase())
  const inout = lw.inoutByName.get(e.name.toUpperCase())
  if (slot === undefined && inout !== undefined)
    return { slot: inout, path: [], type: lw.inoutSlots[inout]!.type, span: e.span, root: "inout" }
  if (slot === undefined) {
    const global = globalPlace(lw, e.name, e.span)
    if (global !== undefined) return global
    // `symbols/` decides what the name IS — a GVL, an enum member, a library global — so the report names
    // the real reason rather than "unknown identifier".
    const found = lookup(lw.scope, e.name)?.symbol
    const what = found === undefined ? "does not resolve" : `is a ${found.kind}, which has no frame slot yet`
    return lw.bail("place-not-local", `${e.name} ${what}`, e.span)
  }
  return { slot, path: [], type: lw.slots[slot]!.type, span: e.span }
}

/**
 * `x.3` on a local integer — one bit of one slot, readable and writable (design §14): two's complement, so
 * `im1.15` with `im1 : INT := -1` is TRUE and `i0.15 := TRUE` makes -32768. Any other dotted name is a struct or
 * instance member, which waits on the memory model (§9) — it keeps the counted code the caller passes, so the
 * coverage report's categories do not shift under it.
 */
export function bitPlace(lw: Lowering, e: Extract<Expr, { kind: "member" }>, notABit: string): Place | undefined {
  const index = Number(e.member.name)
  const base = lowerPlace(lw, e.base, notABit)
  if (base === undefined) return undefined
  // A bit of something that is not an integer says what it is instead: `slice.0` with `slice : REFERENCE TO BYTE`
  // (pro2193 MapperInputs.fb) is aliasing — phase 4 — and a `bit-index` there sent the reader to the wrong phase.
  if (base.type.kind !== "elementary") return lw.bail(`bit-on-${base.type.kind}`, `bit ${index} of a ${base.type.kind}`, e.span)
  const t = base.type.elem
  if (t.rank === undefined || (t.family !== "int" && t.family !== "bitstring") || index >= t.bits)
    return lw.bail("bit-index", `bit ${index} of a ${t.name}`, e.span)
  return { ...base, path: [...base.path, { kind: "bit", index, of: base.type }], type: elementaryRef("BOOL"), span: e.span }
}
