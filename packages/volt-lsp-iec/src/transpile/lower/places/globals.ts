/**
 * The globals as places: a GVL variable, a called PROGRAM's instance, a GVL-qualified name.
 */

import type { Lowering } from "../core/lowering.js"
import type { Span, TopLevel, VarDecl, VarSection } from "../../../frontend/syntax/index.js"
import type { Place } from "../../ir/index.js"
import { gvlName, lookup, type Symbol } from "../../../frontend/symbols/index.js"
import { libraryOf } from "../../../frontend/library/index.js"
import { storageOf } from "../storage/layout.js"
import { resolveNamedType, typeZero } from "../../../frontend/types/index.js"
import { declareGlobals } from "../storage/declare.js"
import { touchedOf } from "../calls/reentrancy.js"

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
    if (lw.shared.globals.slots[known]!.section === "program") touchedOf(lw).add(known)
    return place(known)
  }
  let sym = lookup(lw.scope, name)?.symbol
  if (sym?.varSection === "VAR_EXTERNAL") sym = lookup(lw.project, name)?.symbol
  // a GVL variable named like its own list (`listVariableShadows`): the bare name is the variable
  if (sym?.kind === "gvl_block") sym = lw.project.symbols.get(upper.toLowerCase())?.find((s) => s.kind === "gvl_var") ?? sym
  if (sym === undefined || libraryOf(sym) !== undefined) return undefined
  if (sym.kind === "gvl_var") {
    const slot = listVariable(lw, sym, sym.ast as VarDecl, sym.name)
    return slot === undefined ? undefined : place(slot)
  }
  if (sym.kind === "program" && sym.name.toUpperCase() !== lw.shared.root.toUpperCase()) {
    const type = storageOf(lw, resolveNamedType(sym.name, lw.project, sym.uri), sym.span)
    lw.shared.globals.byName.set(upper, lw.shared.globals.slots.length)
    lw.shared.globals.slots.push({ name: sym.name, type, section: "program", init: typeZero(type) })
    touchedOf(lw).add(lw.shared.globals.slots.length - 1)
  } else return undefined
  const slot = lw.shared.globals.byName.get(upper)
  return slot === undefined ? undefined : place(slot)
}

/**
 * A list's variable's global slot, declared on first reach. It is keyed by its bare name — one global however it is reached
 * — unless the list is `qualified_only` or another list declares the same name, when it is keyed `<list>.<name>`. The same
 * name in two plain lists is TWO variables (`tr_a17_two_lists_one_name_both_qualified`: GVL_a.g 3, GVL_b.g 5, and writing
 * one leaves the other) — keyed by the bare name, they shared one slot (6.A.17). Bare, such a name is ambiguous and CODESYS
 * refuses it (`ambg_*`). Such a slot carries its list (`IrSlot.list`), so the emitter names the two Rust fields apart by
 * their lists, not by which one a body reached first (6Aa+6Ae gate review).
 */
function listVariable(lw: Lowering, sym: Symbol, decl: VarDecl, name: string): number | undefined {
  const shared = (lw.project.symbols.get(sym.name.toLowerCase()) ?? []).some((s) => s.kind === "gvl_var" && s.uri !== sym.uri && libraryOf(s) === undefined)
  const prefix = sym.qualifiedOnly === true || shared ? `${gvlName(sym.uri)}.` : ""
  const key = `${prefix}${name}`.toUpperCase()
  if (!lw.shared.globals.byName.has(key)) declareGlobal(lw, decl, prefix)
  const slot = lw.shared.globals.byName.get(key)
  if (slot !== undefined && shared) lw.shared.globals.slots[slot]!.list = gvlName(sym.uri)
  return slot
}

/** A GVL declaration's variables made the application's storage, each keyed by `prefix` and its name. */
const declareGlobal = (lw: Lowering, decl: VarDecl, prefix: string): void =>
  void declareGlobals(lw, lw.project, { sectionKind: "VAR", decls: [decl] } as unknown as VarSection, prefix)

/**
 * `GVL_Name.var` — a global named through its list (conformance `fbcall_gvl_qualified`), the one way to a variable of a
 * `qualified_only` list; a plain list's variable is the same global its bare name reaches.
 */
export function qualifiedGlobal(lw: Lowering, list: string, name: string, span: Span): Place | undefined {
  const block = lookup(lw.scope, list)?.symbol
  if (block === undefined || libraryOf(block) !== undefined) return lw.bail("place-not-local", `${list} is a library's global list, which lowering leaves unmodelled`, span)
  const gvl = block.ast as Extract<TopLevel, { kind: "global_var_list" }>
  const decl = gvl.varSections.flatMap((s) => s.decls).find((d) => d.names.some((n) => n.text.toUpperCase() === name.toUpperCase()))
  const sym = decl === undefined ? undefined : lw.project.symbols.get(name.toLowerCase())?.find((s) => s.kind === "gvl_var" && s.ast === decl)
  if (sym === undefined) return lw.bail("place-not-local", `${list}.${name} names no variable of that list`, span)
  const slot = listVariable(lw, sym, decl!, name)
  return slot === undefined ? undefined : { slot, path: [], type: lw.shared.globals.slots[slot]!.type, span, root: "global" }
}

/**
 * `Mach1_Alarms.Alm001` where `Mach1_Alarms.gvl` declares a variable `Mach1_Alarms` (lenze-mid): the list declares no
 * `Alm001`, so the name can only be the variable and `.Alm001` its field — the one reading that compiles, as the project
 * does in CODESYS. It resolved to the list and was refused ("names no variable of that list", 100 corpus hits).
 */
export function listVariableShadows(lw: Lowering, list: string, member: string): boolean {
  const gvl = lookup(lw.scope, list)?.symbol.ast as Extract<TopLevel, { kind: "global_var_list" }> | undefined
  const declares = gvl?.varSections.some((s) => s.decls.some((d) => d.names.some((n) => n.text.toUpperCase() === member.toUpperCase()))) ?? false
  return !declares && (lw.project.symbols.get(list.toLowerCase())?.some((s) => s.kind === "gvl_var") ?? false)
}
