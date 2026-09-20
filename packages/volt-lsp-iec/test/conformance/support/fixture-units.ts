/**
 * A fixture's source as the objects CODESYS holds it in — one POU/DUT per top-level unit, its methods, actions and
 * properties as that POU's children, and every object's text split into the declaration and implementation parts the
 * scripting API writes separately. The simulator recorder loads a fixture through this, so the program it runs is the
 * one the bridge builds (unify-conformance-suite §2).
 *
 * The slices come from the parser's spans. A unit's span stops before its END_ keyword, and a pragma written above a
 * member (`{attribute 'call_after_init'}` above a METHOD) sits in the gap BEFORE the unit — it belongs to that unit, so
 * the gap's pragmas are kept.
 *
 * A fixture can use what ANOTHER fixture declares — `FB_LANG_oop_extends_simple EXTENDS FB_LANG_oop_base`, a struct field
 * of another DUT, a VAR_EXTERNAL of another fixture's global — exactly as the replay's cross-fixture project lets it.
 * `withDependencies` names those fixtures, so a run loads them first and the transpiler lowers from the same source.
 */
import {
  parseSource,
  type ParseResult,
  type Span,
  type TopLevel,
  type TypeExpr,
  type VarSection,
} from "../../../src/syntax/index.js"
import type { LanguageTest } from "../types.js"
import { plcPrgSource } from "./plc-prg.js"

export interface LoadAccessor {
  declaration: string
  implementation: string
}
export interface LoadMember {
  kind: "method" | "action" | "property"
  name: string
  declaration: string
  implementation: string
  get?: LoadAccessor
  set?: LoadAccessor
}
export interface LoadUnit {
  kind: "dut" | "function_block" | "program" | "function" | "gvl" | "interface"
  name: string
  declaration: string
  implementation: string
  members: LoadMember[]
}

export function fixtureUnits(t: LanguageTest): LoadUnit[] {
  const source = t.source
  const { units } = parseSource(source)
  const out: LoadUnit[] = []
  let previousEnd = 0
  for (const unit of units) {
    const pragmas = pragmasBefore(source, previousEnd, unit.span.start)
    previousEnd = unit.span.end
    const member = asMember(source, unit, pragmas)
    if (member !== undefined) {
      const owner = out.at(-1)
      if (owner === undefined) throw new Error(`${t.name}: a ${unit.kind} with no POU before it`)
      owner.members.push(member)
      continue
    }
    out.push(asUnit(t, source, unit, pragmas))
  }
  return out
}

/**
 * The fixtures `t` needs in the project, dependencies first, `t` last: every other fixture declaring a type, base FB,
 * interface or global that `t` (or its PLC_PRG) references but does not declare itself — transitively. Resolved by name,
 * as CODESYS resolves it; a name no fixture declares is left to the compiler.
 */
export function withDependencies(t: LanguageTest, all: readonly LanguageTest[]): LanguageTest[] {
  const declaredBy = declarationIndex(all)
  const order: LanguageTest[] = []
  const visiting = new Set<string>()
  const visit = (f: LanguageTest): void => {
    if (visiting.has(f.name)) return
    visiting.add(f.name)
    const own = declaredNames(parsed(f))
    for (const name of referencedNames(f)) {
      if (own.has(name)) continue
      const dependency = declaredBy.get(name)
      if (dependency !== undefined && dependency.name !== f.name) visit(dependency)
    }
    order.push(f)
  }
  visit(t)
  return order
}

// ─── dependency resolution ────────────────────────────────────────────────────

const parseCache = new Map<string, ParseResult>()
function parsed(t: LanguageTest): ParseResult {
  let result = parseCache.get(t.name)
  if (result === undefined) {
    result = parseSource(t.source)
    parseCache.set(t.name, result)
  }
  return result
}

let indexFor: readonly LanguageTest[] | undefined
let index: Map<string, LanguageTest> | undefined
function declarationIndex(all: readonly LanguageTest[]): Map<string, LanguageTest> {
  if (index !== undefined && indexFor === all) return index
  index = new Map()
  for (const f of all) for (const name of declaredNames(parsed(f))) if (!index.has(name)) index.set(name, f)
  indexFor = all
  return index
}

/** Upper-cased names a fixture declares at the top: its POUs, DUTs and interfaces, and its globals' variables. */
function declaredNames(p: ParseResult): Set<string> {
  const names = new Set<string>()
  for (const u of p.units) {
    if (u.kind === "global_var_list") for (const s of u.varSections) for (const d of s.decls) for (const n of d.names) names.add(n.text.toUpperCase())
    else if (u.kind !== "program" && u.kind !== "method" && u.kind !== "action" && u.kind !== "property" && "name" in u && u.name !== undefined)
      names.add(u.name.text.toUpperCase())
  }
  return names
}

/** Upper-cased names a fixture refers to in its declarations and its PLC_PRG's: types, bases, interfaces, externals. */
function referencedNames(t: LanguageTest): Set<string> {
  const names = new Set<string>()
  const typeNames = (type: TypeExpr | undefined): void => {
    if (type === undefined) return
    if (type.kind === "named_type") names.add(type.name.text.toUpperCase())
    else if (type.kind === "array_type") typeNames(type.element)
    else if (type.kind === "pointer_type" || type.kind === "reference_type") typeNames(type.target)
  }
  const sections = (list: readonly VarSection[] | undefined): void => {
    for (const s of list ?? [])
      for (const d of s.decls) {
        typeNames(d.type)
        if (s.sectionKind === "VAR_EXTERNAL") for (const n of d.names) names.add(n.text.toUpperCase())
      }
  }
  const units = [...parsed(t).units, ...parseSource(plcPrgSource(t)).units]
  for (const u of units) {
    if (u.kind === "function_block") {
      if (u.extends !== undefined) names.add(u.extends.text.toUpperCase())
      for (const i of u.implements ?? []) names.add(i.text.toUpperCase())
    }
    if (u.kind === "interface") for (const e of u.extends ?? []) names.add(e.text.toUpperCase())
    if (u.kind === "type_decl") {
      if (u.body.kind === "struct") {
        if (u.body.extends !== undefined) names.add(u.body.extends.text.toUpperCase())
        for (const f of u.body.fields) typeNames(f.type)
      }
      else if (u.body.kind === "alias") typeNames(u.body.target)
    }
    if ("varSections" in u) sections(u.varSections)
    if (u.kind === "function" || u.kind === "method") typeNames(u.returnType)
    if (u.kind === "property") {
      typeNames(u.dataType)
      sections(u.getter?.varSections)
      sections(u.setter?.varSections)
    }
  }
  return names
}

// ─── the split ────────────────────────────────────────────────────────────────

function asUnit(t: LanguageTest, source: string, unit: TopLevel, pragmas: string): LoadUnit {
  switch (unit.kind) {
    case "function_block":
    case "program":
    case "function":
      return {
        kind: unit.kind,
        name: unit.name.text,
        declaration: pragmas + source.slice(unit.span.start, unit.body.span.start).trimEnd() + "\n",
        implementation: bodyText(source, unit.body.span),
        members: [],
      }
    case "type_decl":
      return { kind: "dut", name: unit.name.text, declaration: pragmas + withEnd(source, unit.span), implementation: "", members: [] }
    case "interface": {
      // An interface object holds only its header; each METHOD/PROPERTY prototype is a child object. Written whole, the
      // declaration was refused ("Unexpected token 'END_INTERFACE' found").
      const members = [...unit.methods, ...unit.properties].sort((a, b) => a.span.start - b.span.start)
      const header = source.slice(unit.span.start, members[0]?.span.start ?? unit.span.end).replace(/\s*END_INTERFACE\s*$/i, "")
      return {
        kind: "interface",
        name: unit.name.text,
        declaration: pragmas + header.trim() + "\n",
        implementation: "",
        members: members.map((m): LoadMember => {
          if (m.kind === "interface_method") return { kind: "method", name: m.name.text, declaration: bodyText(source, m.span), implementation: "" }
          // Only the accessors the text names: giving an unnamed one both made CODESYS demand `__SETVALUE` of a GET-only
          // implementation the bridge build had accepted (`interface_with_property`).
          const none: LoadAccessor = { declaration: "", implementation: "" }
          return {
            kind: "property",
            name: m.name.text,
            declaration: `PROPERTY ${m.name.text} : ${source.slice(m.dataType.span.start, m.dataType.span.end)}\n`,
            implementation: "",
            ...(m.hasGetter ? { get: none } : {}),
            ...(m.hasSetter ? { set: none } : {}),
          }
        }),
      }
    }
    case "global_var_list": {
      // A GVL has no name in its text; the fixture's pouName is the object's name — or, for a fixture holding SEVERAL
      // lists, the matching entry of `gvlNames`, since two objects cannot share one name on the wire.
      const lists = parseSource(source).units.filter((u) => u.kind === "global_var_list")
      const at = lists.findIndex((u) => u.span.start === unit.span.start)
      return { kind: "gvl", name: t.gvlNames?.[at] ?? t.pouName, declaration: pragmas + withEnd(source, unit.span), implementation: "", members: [] }
    }
    default:
      throw new Error(`${t.name}: no CODESYS object for a top-level ${unit.kind}`)
  }
}

function asMember(source: string, unit: TopLevel, pragmas: string): LoadMember | undefined {
  if (unit.kind === "method")
    return {
      kind: "method",
      name: unit.name.text,
      declaration: pragmas + source.slice(unit.span.start, unit.body.span.start).trimEnd() + "\n",
      implementation: bodyText(source, unit.body.span),
    }
  if (unit.kind === "action") return { kind: "action", name: unit.name.text, declaration: pragmas, implementation: bodyText(source, unit.body.span) }
  if (unit.kind === "property") {
    const first = unit.getter?.span.start ?? unit.setter?.span.start ?? unit.span.end
    const accessor = (a: typeof unit.getter): LoadAccessor | undefined =>
      a === undefined ? undefined : { declaration: varSectionsText(source, a.varSections), implementation: bodyText(source, a.body.span) }
    return {
      kind: "property",
      name: unit.name.text,
      declaration: pragmas + source.slice(unit.span.start, first).trimEnd() + "\n",
      implementation: "",
      ...(unit.getter === undefined ? {} : { get: accessor(unit.getter) }),
      ...(unit.setter === undefined ? {} : { set: accessor(unit.setter) }),
    }
  }
  return undefined
}

/**
 * A body's statements, without the keyword that CLOSES its unit when the span happens to include it. Only a unit
 * terminator is stripped: stripping any trailing `END_…` cut the `END_FOR` off a method whose body ends in a loop, and
 * seven fixtures stopped compiling in the simulator ("Unexpected End-of-file found: 'END_FOR' expected").
 */
function bodyText(source: string, span: Span): string {
  return (
    source
      .slice(span.start, span.end)
      .replace(/\s*\bEND_(FUNCTION_BLOCK|PROGRAM|FUNCTION|METHOD|ACTION|GET|SET|PROPERTY)\b\s*$/i, "")
      .trim() + "\n"
  )
}

/** A declaration-only unit's whole text, its END_ keyword included (the span stops before it). */
function withEnd(source: string, span: Span): string {
  const end = /^\s*END_\w+;?/i.exec(source.slice(span.end))
  return source.slice(span.start, span.end + (end?.[0].length ?? 0)).trim() + "\n"
}

function varSectionsText(source: string, sections: readonly VarSection[]): string {
  if (sections.length === 0) return ""
  return source.slice(sections[0]!.span.start, sections.at(-1)!.span.end).trim() + "\n"
}

/** The pragma lines in the gap before a unit — after the previous unit's END_ keyword. */
function pragmasBefore(source: string, from: number, to: number): string {
  const gap = source.slice(from, to).replace(/^\s*END_\w+;?/i, "")
  const found = gap.match(/\{[^}]*\}/g)
  return found === null ? "" : found.join("\n") + "\n"
}

/**
 * A FIXTURE AS ONE PROGRAM: the ST every gate lowers, and the libraries it lowers against.
 *
 * Six files spelled these three lines out themselves — `backends`, `transpile`, `corpus`,
 * `ir-coverage`, `source-map` and `evidence` — byte for byte, which is the shape a rule takes just before the
 * copies start to differ. They are load-bearing lines: a gate that assembles a fixture differently is measuring a
 * different program than the gate beside it, and every conclusion drawn by comparing their numbers would be wrong.
 *
 * A GVL is not concatenated into the source. It is lowered as a LIBRARY FILE, because a `VAR_GLOBAL` block belongs
 * to its own object on the wire and `lowerSource` reads globals from the files it is handed, not from the main text.
 * `plcPrgSource` goes last: it is what makes the fixture's POU reachable, and CODESYS only compiles what the
 * application reaches.
 */
export function assembleFixture(
  t: LanguageTest,
  all: readonly LanguageTest[],
): { source: string; gvls: { uri: string; source: string }[] } {
  const fixtures = withDependencies(t, all).filter((f) => f.source !== "")
  return {
    source: [...fixtures.filter((f) => f.kind !== "gvl").map((f) => f.source), plcPrgSource(t)].join("\n"),
    gvls: fixtures.filter((f) => f.kind === "gvl").map((f) => ({ uri: `${f.pouName}.gvl`, source: f.source })),
  }
}
