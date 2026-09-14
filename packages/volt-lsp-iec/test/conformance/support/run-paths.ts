/**
 * The variable paths a run records for a fixture, relative to PLC_PRG — the ONE list the simulator recorder reads and the
 * transpiler replay compares (unify-conformance-suite design §2).
 *
 * Every PLC_PRG variable is expanded to its leaves: an instance of an FB the fixture (or a fixture it depends on) declares
 * becomes its members, its base FB's first (`inst.x`); a struct its fields; an array its elements when the bounds fold (at
 * most `MAX_ELEMENTS`), so every path names one elementary value — a composite cannot be read online ("Invalid pointer
 * size.", measured). Left out, each for a reason:
 *   - VAR_TEMP (gone after the call), VAR_IN_OUT and VAR_EXTERNAL (aliases of storage recorded elsewhere);
 *   - a type no fixture declares (a library FB such as TON): its members are not in the source, and a guess would record
 *     the wrong list;
 *   - a SUBRANGE value (`INT(0..100)`, or a DUT that is one): the online read refuses it, "Type 'Subrange' is not a
 *     literal type." (measured 2026-09-14, `type_dut_subrange`, `subrange_init_in_range`).
 */
import { buildSymbolTable } from "../../../src/symbols/index.js"
import { parseSource, type TopLevel, type TypeExpr, type VarSection, type VarSectionKind } from "../../../src/syntax/index.js"
import { constEval, elementaryType } from "../../../src/types/index.js"
import type { LanguageTest } from "../types.js"
import { withDependencies } from "./fixture-units.js"
import { plcPrgSource } from "./plc-prg.js"

const READABLE: ReadonlySet<VarSectionKind> = new Set(["VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_STAT", "VAR_INST"])
const MAX_ELEMENTS = 16
const MAX_DEPTH = 4

export function runPaths(t: LanguageTest, all: readonly LanguageTest[]): string[] {
  const fixtures = withDependencies(t, all)
  const parsedFixtures = fixtures.map((f) => ({ uri: f.name, source: f.source, parseResult: parseSource(f.source) }))
  const plc = parseSource(plcPrgSource(t))
  const project = buildSymbolTable([...parsedFixtures, { uri: "plc_prg", parseResult: plc, source: plcPrgSource(t) }])
  const declared = new Map<string, TopLevel>()
  for (const p of parsedFixtures)
    for (const u of p.parseResult.units)
      if (u.kind !== "method" && u.kind !== "action" && u.kind !== "property" && "name" in u && u.name !== undefined)
        declared.set(u.name.text.toUpperCase(), u)
  const program = plc.units[0]
  if (program === undefined || !("varSections" in program)) return []
  const out: string[] = []
  expandSections(program.varSections, "", 0)
  return out

  function expandSections(sections: readonly VarSection[], prefix: string, depth: number): void {
    for (const section of sections) {
      if (!READABLE.has(section.sectionKind)) continue
      for (const decl of section.decls) for (const name of decl.names) expand(decl.type, `${prefix}${name.text}`, depth)
    }
  }

  function expandFb(unit: Extract<TopLevel, { kind: "function_block" }>, prefix: string, depth: number): void {
    const base = unit.extends === undefined ? undefined : declared.get(unit.extends.text.toUpperCase())
    if (base?.kind === "function_block" && depth <= MAX_DEPTH) expandFb(base, prefix, depth + 1)
    expandSections(unit.varSections, prefix, depth + 1)
  }

  function expand(type: TypeExpr, path: string, depth: number): void {
    if (depth > MAX_DEPTH) return
    switch (type.kind) {
      case "string_type":
        out.push(path)
        return
      case "named_type": {
        if (type.subrange !== undefined) return
        if (elementaryType(type.name.text) !== undefined) return void out.push(path)
        const unit = declared.get(type.name.text.toUpperCase())
        if (unit?.kind === "function_block") return expandFb(unit, `${path}.`, depth)
        if (unit?.kind === "type_decl") {
          if (unit.body.kind === "struct") {
            // a derived struct holds its base's fields too (`TYPE D EXTENDS B : STRUCT`)
            if (unit.body.extends !== undefined) expand({ ...type, name: unit.body.extends }, path, depth + 1)
            for (const f of unit.body.fields) for (const n of f.names) expand(f.type, `${path}.${n.text}`, depth + 1)
          } else if (unit.body.kind === "enum") out.push(path)
          else if (unit.body.kind === "alias") expand(unit.body.target, path, depth)
        }
        return
      }
      case "array_type": {
        if (type.dims.length !== 1) return
        const dim = type.dims[0]!
        if (dim.lower === undefined || dim.upper === undefined) return
        const lo = constEval(dim.lower, project)
        const hi = constEval(dim.upper, project)
        if (typeof lo !== "bigint" || typeof hi !== "bigint" || hi - lo + 1n > BigInt(MAX_ELEMENTS)) return
        for (let i = lo; i <= hi; i++) expand(type.element, `${path}[${i}]`, depth + 1)
        return
      }
      default:
        return // a pointer or reference aliases storage recorded elsewhere; an inline enum is left out with it
    }
  }
}
