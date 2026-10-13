/**
 * LOWERING'S CALL PARAMETER VIEW AGAINST THE FRONT-END'S (transpile-restructure 1.7.18, 6.B.4). For every call of
 * every lowered fixture whose callee the front-end resolves (`types/infer/callee.resolveCallee`), each POSITIONAL argument
 * is bound twice: by lowering (`lower/calls/parameters.positionalBinding` over `positionalParameters` of the callee's own
 * sections — the rule `invoke.ts` binds by) and by the front-end (`positional[i]`). The two must name the same parameter
 * (and agree it is an in-out), or both bind none (past the parameters) — with no exception: the one difference 1.7.18
 * wrote down (an argument past a VAR_OUTPUT, which lowering refused and the front-end bound to the next input) was
 * recorded (`tr_b4_positional_past_output`: the output is skipped) and both bind by the front-end's `isPositionalSection`
 * now (6.B.4). Every fixture is compared: a fixture that throws or whose GVLs do not parse fails the test by name, never
 * drops out of the comparison.
 */
import { expect, test } from "bun:test"
import { type CallExpr, isStBody, parseSource, type TopLevel, type VarSection } from "../../src/frontend/syntax/index.js"
import { build, scopeForUnit } from "../../src/frontend/symbols/index.js"
import { resolveCallee } from "../../src/frontend/types/index.js"
import { lowerSource } from "../../src/transpile/index.js"
import { positionalBinding, positionalParameters } from "../../src/transpile/lower/calls/parameters.js"
import { execBodyStatements } from "../../src/transpile/lower/conditions.js"
import { readFiles, TRANSPILE_PARSE } from "../../src/transpile/lower/project/prepare.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { assembleFixture } from "./support/fixture-units.js"
import { PROJECT_BASE } from "./support/project-libraries.js"

/** Every call expression in an AST subtree (a test walk: the AST has no child table). */
function callsOf(node: unknown, out: CallExpr[] = []): CallExpr[] {
  if (node === null || typeof node !== "object") return out
  if (Array.isArray(node)) {
    for (const child of node) callsOf(child, out)
    return out
  }
  if ((node as { kind?: string }).kind === "call") out.push(node as CallExpr)
  for (const [key, child] of Object.entries(node)) if (key !== "span") callsOf(child, out)
  return out
}

test("lowering binds every positional argument as resolveCallee does", () => {
  const counts = { fixtures: 0, calls: 0, unresolved: 0, instance: 0, direct: 0, positional: 0 }
  const unread: string[] = []
  const other: string[] = []
  const project = PROJECT_BASE.prepared.project
  for (const t of ALL_TESTS) {
    const { source, gvls } = assembleFixture(t, ALL_TESTS)
    if (lowerSource(source, "PLC_PRG", gvls, undefined, PROJECT_BASE).pou === undefined) continue
    const parseResult = parseSource(source, TRANSPILE_PARSE, "codesys")
    const read = readFiles(gvls)
    if ("unparsed" in read) {
      unread.push(t.name) // lowering read them; this comparison must too
      continue
    }
    const own = [{ uri: "transpile://source", parseResult, source }, ...read.files]
    for (const f of own) build.bindFile(project, f)
    build.relink(project, PROJECT_BASE.manifests)
    try {
      counts.fixtures += 1
      for (const unit of parseResult.units as TopLevel[]) {
        const scope = scopeForUnit(project, unit) ?? project
        // a body is parsed when lowering reads it (`execBodyStatements`), its declarations with the unit
        const pou = unit.kind === "program" || unit.kind === "function_block" || unit.kind === "function" || unit.kind === "method" || unit.kind === "action"
        const body = pou && isStBody(unit.body) ? execBodyStatements(project, unit, unit.body) : undefined
        for (const call of callsOf([unit, body?.ok === true ? body.statements : []])) {
          counts.calls += 1
          const info = resolveCallee(call, scope, project)
          if (info === undefined) {
            counts.unresolved += 1
            continue
          }
          const sections = (info.sym.ast as { varSections?: readonly VarSection[] }).varSections
          if (info.scope !== undefined || sections === undefined) {
            counts.instance += 1 // an FB instance call: lowering binds no argument by position (`call-positional`)
            continue
          }
          counts.direct += 1
          const declared = positionalParameters(sections)
          for (const [position, arg] of call.args.entries()) {
            if (arg.param !== undefined || arg.output) continue
            counts.positional += 1
            const lowering = positionalBinding(declared, position)
            const front = info.positional[position]
            const l = lowering === "past-parameters" ? "none" : `${lowering.name.toUpperCase()}${lowering.sectionKind === "VAR_IN_OUT" ? "&" : ""}`
            const f = front === undefined ? "none" : `${front.name.text.toUpperCase()}${front.inOut ? "&" : ""}`
            if (l !== f) other.push(`${t.name}: ${info.sym.name} argument ${position + 1} lowering ${l} front-end ${f}`)
          }
        }
      }
    } finally {
      for (const f of own) build.unbindFile(project, f.uri)
      build.relink(project, PROJECT_BASE.manifests)
    }
  }
  console.log(`  [call-parameters] ${JSON.stringify(counts)}`)
  expect(unread).toEqual([])
  expect(other).toEqual([])
  expect(counts.fixtures).toBeGreaterThan(3000)
  // A BUDGET PROPORTIONAL TO THE WORK, as `map.test.ts` and `source-map.test.ts` have: this ran on bun's 5s default, a
  // default and not a decision, and lowers every fixture. Measured 2026-10-13 over 5850 fixtures (3626 lowered): ~5.0s
  // alone — lowering 2.6s, assembling 0.8s, parse 0.3s, bind 0.3s, unbind 0.2s, the rest the comparison — so it failed as
  // a timeout under full-suite load (5.1s, 5.7s), reading as a hang rather than as "there are more fixtures now".
  // Checked for the quadratic first: each phase is linear (assembling ~0.13ms and lowering ~0.44ms per fixture). 3ms a
  // fixture is ~3x the measured cost, so a real hang still fails.
}, Math.max(30_000, ALL_TESTS.length * 3))
