/**
 * The globals as places: a GVL variable, a called PROGRAM's instance, a GVL-qualified name.
 */

import { Lowering } from "../core/lowering.js"
import { newShared, sharedState } from "../core/shared.js"
import { storageRefusal } from "../entry/checks.js"
import { type Expr, sameName, type Span, type TopLevel, type VarDecl, type VarSection } from "../../../frontend/syntax/index.js"
import type { IrUnlowered, Place } from "../../ir/index.js"
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
  // A GVL instance is called moved out of `Globals` the same way (`calls/fb-call.ts`), so every global a body reaches is
  // recorded.
  const known = lw.shared.globals.byName.get(upper)
  if (known !== undefined) {
    touchedOf(lw).add(known)
    return place(known)
  }
  let sym = lookup(lw.scope, name)?.symbol
  if (sym?.varSection === "VAR_EXTERNAL") sym = lookup(lw.project, name)?.symbol
  // a GVL variable named like its own list (`listVariableShadows`): the bare name is the variable
  if (sym?.kind === "gvl_block") sym = lw.project.symbols.get(upper.toLowerCase())?.find((s) => s.kind === "gvl_var") ?? sym
  if (sym === undefined || libraryOf(sym) !== undefined) return undefined
  if (sym.kind === "gvl_var") {
    const slot = listVariable(lw, sym, sym.ast as VarDecl)
    if (slot !== undefined) touchedOf(lw).add(slot)
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
 * EVERY VAR_GLOBAL OF EVERY LIST IS THE APPLICATION'S STORAGE, referenced or not (openspec `runner-unused-globals`): CODESYS
 * holds and monitors each declared global, so the runner reads and writes each (`<list>.<name>`, `ir/path.ts`
 * `pathRoot`) — an FB instance with its whole layout. Declared before the body, in list and declaration order. A
 * library's lists stay unmodelled (`globalPlace`).
 *
 * A DECLARATION THAT DOES NOT LOWER IS NAMED, NOT DROPPED. Each is first lowered ALONE (`refusalOf`, its own shared state,
 * so nothing it half-built or memoized reaches this POU): one that refuses there is declared nowhere, and the POU carries
 * it with that refusal (`IrPou.unlowered`) — the runner refuses its path by name. The POU's run does not read it, so the
 * POU still lowers; a body that does reach it declares it on this lowering and is refused with it, as before.
 */
export function declareLists(lw: Lowering): void {
  for (const block of listsOf(lw)) {
    const gvl = block.ast as Extract<TopLevel, { kind: "global_var_list" }>
    for (const decl of gvl.varSections.filter((s) => s.sectionKind === "VAR_GLOBAL").flatMap((s) => s.decls))
      for (const sym of listSymbols(lw, decl)) {
        const refused = refusalOf(lw, sym, decl)
        if (refused === undefined) listVariable(lw, sym, decl)
        else unloweredOf(lw).push({ name: sym.name, list: gvlName(sym.uri)!, ...(sym.qualifiedOnly === true ? { qualifiedOnly: true } : {}), ...refused })
      }
  }
}

/** The project's own lists, once per prepared project (as `refusalOf`'s answers): a project bound on a library base holds
 *  every library's symbols, which every lowering of it — every POU, every escape pass — walked again. */
function listsOf(lw: Lowering): readonly Symbol[] {
  let lists = projectLists.get(lw.shared.attributes)
  if (lists === undefined) {
    lists = [...lw.project.symbols.values()].flat().filter((s) => s.kind === "gvl_block" && libraryOf(s) === undefined)
    projectLists.set(lw.shared.attributes, lists)
  }
  return lists
}
const projectLists = new WeakMap<object, readonly Symbol[]>()

/** The GVL variables `declareLists` could not hold, per POU lowering. */
const unloweredOf = sharedState((): IrUnlowered[] => [])

/** `IrPou.unlowered`: those still without a slot once the POU lowered — none, when the field is left out. */
export function unloweredGlobals(lw: Lowering): { unlowered?: readonly IrUnlowered[] } {
  const slotless = unloweredOf(lw).filter((u) => !lw.globals.some((g) => g.list === u.list && sameName(g.name, u.name)))
  return slotless.length === 0 ? {} : { unlowered: slotless }
}

/**
 * The first refusal of one list variable's declaration lowered alone — in a lowering of its own, sharing nothing and
 * belonging to no POU — or of the storage it made, which no backend could hold (`storageRefusal`). Asked once per
 * prepared project: the answer depends on the project alone, and every POU of it (and every escape pass) asks again. A
 * project is prepared anew for every `lowerSource`, so a variable is never answered for from another project's files.
 */
function refusalOf(lw: Lowering, sym: Symbol, decl: VarDecl): Refusal | undefined {
  let answers = aloneAnswers.get(lw.shared.attributes)
  if (answers === undefined) aloneAnswers.set(lw.shared.attributes, (answers = new Map()))
  if (answers.has(sym)) return answers.get(sym)
  const alone = new Lowering(lw.project, lw.project, newShared(lw.shared.attributes, "", lw.shared.libraryUnits), sym.uri)
  listVariable(alone, sym, decl)
  const routines = [...alone.routines.values()].flatMap((r) => (r.state === "lowered" ? [r.routine] : []))
  const first = alone.diagnostics[0]
  const storage = first === undefined ? storageRefusal(alone, [...alone.layouts.values()], routines) : undefined
  // the declaration's own slot always has its origin (`Lowering.slot`, in the list's file); a field's, its type's
  const answer: Refusal | undefined =
    first !== undefined
      ? { code: first.code, message: first.message, uri: first.uri, span: first.span }
      : storage === undefined
        ? undefined
        : { code: storage.code, message: storage.message, uri: storage.at!.uri, span: storage.at!.span }
  answers.set(sym, answer)
  return answer
}

/** `refusalOf`'s answers, per prepared project — keyed by its attribute lookup, which each preparation makes anew. */
const aloneAnswers = new WeakMap<object, Map<Symbol, Refusal | undefined>>()

/** What `IrPou.unlowered` says of a variable besides its name: the refusal, in its file. */
type Refusal = Pick<IrUnlowered, "code" | "message" | "uri" | "span">

/** The `gvl_var` symbols a list's declaration binds, one per name (none for a declaration the binder dropped). */
const listSymbols = (lw: Lowering, decl: VarDecl): Symbol[] =>
  decl.names.flatMap((n) => lw.project.symbols.get(n.text.toLowerCase())?.filter((s) => s.kind === "gvl_var" && s.ast === decl && sameName(s.name, n.text)) ?? [])

/**
 * A list's variable's global slot, declared once (`declareLists`). It is keyed by its bare name — one global however it is
 * reached — unless the list is `qualified_only` or another list declares the same name, when it is keyed `<list>.<name>`.
 * The same name in two plain lists is TWO variables (`tr_a17_two_lists_one_name_both_qualified`: GVL_a.g 3, GVL_b.g 5, and
 * writing one leaves the other) — keyed by the bare name, they shared one slot (6.A.17). Bare, such a name is ambiguous and
 * CODESYS refuses it (`ambg_*`). Every such slot carries its list (`IrSlot.list`) and whether it is `qualified_only` — the
 * runner's path, and the emitter's field name where two lists share one (`globalFieldNames`).
 */
function listVariable(lw: Lowering, sym: Symbol, decl: VarDecl): number | undefined {
  const shared = (lw.project.symbols.get(sym.name.toLowerCase()) ?? []).some((s) => s.kind === "gvl_var" && s.uri !== sym.uri && libraryOf(s) === undefined)
  const list = gvlName(sym.uri)!
  const prefix = sym.qualifiedOnly === true || shared ? `${list}.` : ""
  const key = `${prefix}${sym.name}`.toUpperCase()
  if (lw.shared.globals.byName.has(key)) return lw.shared.globals.byName.get(key)
  // one name at a time: `a, b : INT` where only `a` is shared keys the two apart
  const one = { ...decl, names: decl.names.filter((n) => sameName(n.text, sym.name)) }
  declareGlobals(lw, lw.project, { sectionKind: "VAR", decls: [one] } as unknown as VarSection, prefix, sym.uri)
  const slot = lw.shared.globals.byName.get(key)
  if (slot !== undefined) Object.assign(lw.shared.globals.slots[slot]!, { list }, sym.qualifiedOnly === true ? { qualifiedOnly: true } : {})
  return slot
}

/**
 * Whether `e` is `<list>.<name>` — a global named through its list, a place of its own (`qualifiedGlobal`), never a
 * member of a variable `<list>`: what a place, a call statement and a method call all ask before lowering the base.
 */
export function namesListMember(lw: Lowering, e: Expr): e is Extract<Expr, { kind: "member" }> & { base: Extract<Expr, { kind: "ident_expr" }> } {
  return (
    e.kind === "member" &&
    e.base.kind === "ident_expr" &&
    !lw.holds(e.base.name) &&
    lookup(lw.scope, e.base.name)?.symbol.kind === "gvl_block" &&
    !listVariableShadows(lw, e.base.name, e.member.name)
  )
}

/**
 * `GVL_Name.var` — a global named through its list (conformance `fbcall_gvl_qualified`), the one way to a variable of a
 * `qualified_only` list; a plain list's variable is the same global its bare name reaches.
 */
export function qualifiedGlobal(lw: Lowering, list: string, name: string, span: Span): Place | undefined {
  const block = lookup(lw.scope, list)?.symbol
  if (block === undefined || libraryOf(block) !== undefined) return lw.bail("place-not-local", `${list} is a library's global list, which lowering leaves unmodelled`, span)
  const gvl = block.ast as Extract<TopLevel, { kind: "global_var_list" }>
  const decl = gvl.varSections.flatMap((s) => s.decls).find((d) => d.names.some((n) => n.text.toUpperCase() === name.toUpperCase()))
  const sym = decl === undefined ? undefined : listSymbols(lw, decl).find((s) => sameName(s.name, name))
  if (sym === undefined) return lw.bail("gvl-member-unknown", `${list}.${name} names no variable of that list`, span)
  const slot = listVariable(lw, sym, decl!)
  if (slot !== undefined) touchedOf(lw).add(slot)
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
