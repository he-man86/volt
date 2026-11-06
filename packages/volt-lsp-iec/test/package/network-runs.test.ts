/**
 * WHAT A NETWORK FORM RUNS AS (openspec ide-model-mapping 5.3): one row per network-only form, its text a measured map
 * state's `pull` (`volt-cli/test/fixtures/nwl-schema/*-states.3.5.21.40.json`, a state CODESYS 3.5.21.40 built and ran),
 * its ST what the lowering (`transpile/lower/network`) makes of that text. Generated, never written by hand: this test
 * writes `src/services/shared/network-runs.generated.ts` (the hover's and completion's text) and the "What it runs as"
 * table of `volt-cli/docs/network-text.html`, and fails when either drifts. Regenerate with
 * `VOLT_WRITE_DOCS=1 bun test test/package/network-runs.test.ts`.
 */
import { expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { allUnits, isPlainStNetworkBody, parseSource, unitBodies } from "../../src/frontend/syntax/index.js"
import { networkScope, scopeForUnit } from "../../src/frontend/symbols/index.js"
import { prepareProject, TRANSPILE_PARSE } from "../../src/transpile/lower/project/prepare.js"
import { EXEC_ORACLE_DIALECT, execBodyStatements } from "../../src/transpile/lower/conditions.js"
import { lowerNetworks } from "../../src/transpile/lower/network/network.js"
import { printStatements } from "../../src/services/formatting/print.js"

const FIXTURES = join(import.meta.dir, "../../../volt-cli/test/fixtures/nwl-schema")
const GENERATED = join(import.meta.dir, "../../src/services/shared/network-runs.generated.ts")
const PAGE = join(import.meta.dir, "../../../volt-cli/docs/network-text.html")
const WRITING = process.env.VOLT_WRITE_DOCS === "1"

/** Each form and the measured state that shows it: `<map>#<id>`. */
const FORMS: readonly (readonly [form: string, state: string])[] = [
  ["Q", "assign-states#0001"],
  ["Q_SET", "assign-states#0029"],
  ["Q_RESET", "assign-states#0031"],
  ["Q_INVERTED", "assign-states#0027"],
  ["ASSIGN", "assign-states#0251"],
  ["series coils", "assign-states#0245"],
  ["coil in a rung", "assign-states#0247"],
  ["JMP", "assign-states#0097"],
  ["RETURN", "assign-states#0117"],
  ["RAIL", "assign-states#0299"],
  ["contacts", "box-states#0395"],
  ["BRANCH", "class-states#0109"],
  ["BRANCH_SHORTCIRCUIT", "class-states#0110"],
  ["EXECUTE", "class-states#0575"],
  ["OPERAND", "assign-states#0443"],
  ["COMMENT", "assign-states#0459"],
  ["INVERT", "assign-states#0007"],
  ["INVERT on an INT", "assign-states#0200"],
  ["RISING", "assign-states#0003"],
  ["FALLING", "assign-states#0005"],
  ["stacked marks", "assign-states#0367"],
  ["wire", "class-states#0129"],
  ["DISABLED", "class-states#0003"],
]

interface MapFile {
  holder: string
  callees: Record<string, { kind: "Function" | "FunctionBlock" | "Program"; declaration: string }>
  states: { id: string; language: string; pull: string; stored?: unknown[]; measured: { build: string[]; run: string | null } }[]
}

const END = { Function: "END_FUNCTION", FunctionBlock: "END_FUNCTION_BLOCK", Program: "END_PROGRAM" } as const
const maps = new Map<string, MapFile>()
const mapOf = (name: string): MapFile => {
  let m = maps.get(name)
  if (m === undefined) maps.set(name, (m = JSON.parse(readFileSync(join(FIXTURES, `${name}.3.5.21.40.json`), "utf8")) as MapFile))
  return m
}

/** A state's body as the text holds it: its pull's lines, a `%NETWORK` before each network the state stores. */
function bodyOf(state: MapFile["states"][number]): string {
  const lines = state.pull.split(" / ")
  if (lines[0]!.startsWith("%LANGUAGE")) return lines.join("\n")
  // a pull without its `%` lines: one network per stored tree, a label opening the network it stands in
  const out = [`%LANGUAGE ${state.language}`]
  let networks = 0
  lines.forEach((l, i) => {
    if (i === 0 || !lines[i - 1]!.endsWith(":")) {
      out.push("%NETWORK")
      networks++
    }
    out.push(l)
  })
  // a box map's state is one box in one network
  const stored = state.stored?.length ?? 1
  if (networks !== stored) throw new Error(`${state.id}: ${networks} networks in its pull, ${stored} stored`)
  return out.join("\n")
}

/** The ST `body` (a PROGRAM of `map`'s holder) runs as: the lowering's statements, its hidden variables declared. */
function runsAs(map: MapFile, body: string): string {
  const callees = Object.values(map.callees).map((c) => `${c.declaration}%LANGUAGE ST\n${END[c.kind]}\n`)
  const source = `${map.holder.replace("%s", "P")}${body}\nEND_PROGRAM\n${callees.join("")}`
  const parseResult = parseSource(source, TRANSPILE_PARSE, EXEC_ORACLE_DIALECT)
  if (parseResult.errors.length > 0) throw new Error(`${body}: ${parseResult.errors[0]!.message}`)
  const { project } = prepareProject([{ uri: "runs://P", parseResult, source }], [])
  const unit = allUnits(parseResult.units).find((u) => "name" in u && u.name?.text === "P")!
  const net = unitBodies(unit).find(isPlainStNetworkBody)
  if (net === undefined) throw new Error(`${body}: no network body`)
  const parsed = execBodyStatements(project, unit, net)
  if (!parsed.ok) throw new Error(`${body}: ${parsed.firstError}`)
  const unitScope = scopeForUnit(project, unit)!
  const lowered = lowerNetworks(net, parsed.statements, networkScope(unitScope.children.find((c) => c.span === net.span) ?? unitScope, net), project, "__nw")
  const decls = lowered.hidden.map((h) => {
    if ("fb" in h) return `${h.name} : ${h.fb};`
    if (h.type.kind !== "elementary") throw new Error(`${body}: hidden ${h.name} is a ${h.type.kind}`)
    return `${h.name} : ${h.type.name};`
  })
  const st = printStatements(lowered.statements, 0).replace(/\t/g, "    ")
  return decls.length === 0 ? st : `VAR ${decls.join(" ")} END_VAR\n${st}`
}

const rows = FORMS.map(([form, at]) => {
  const [file, id] = at.split("#") as [string, string]
  const map = mapOf(file)
  const state = map.states.find((s) => s.id === id)
  if (state === undefined) throw new Error(`${at}: no such state`)
  // run, and built with no error (a warning is no refusal)
  if (!state.measured.run || state.measured.build.some((m) => / Error /.test(m))) throw new Error(`${at}: no measured run`)
  const text = bodyOf(state)
  return { form, state: at, run: state.measured.run, text: text.split("\n").filter((l) => !/^%(LANGUAGE|NETWORK$)/.test(l)).join("\n"), runsAs: runsAs(map, text) }
})

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const START = "<!-- GENERATED runs: test/package/network-runs.test.ts in volt-lsp-iec, VOLT_WRITE_DOCS=1 regenerates -->"
const STOP = "<!-- /GENERATED runs -->"

function generatedModule(): string {
  return (
    "// GENERATED by test/package/network-runs.test.ts — do not edit. Regenerate: VOLT_WRITE_DOCS=1 bun test test/package/network-runs.test.ts\n" +
    "/** What each network-only form runs as: a measured state's text (`state`, its `run`) and the ST the lowering makes of it. */\n" +
    `export const NETWORK_RUNS = ${JSON.stringify(rows, null, 2)} as const\n`
  )
}

function generatedTable(): string {
  const tr = rows.map(
    (r) => `  <tr><td class="name"><pre>${esc(r.text)}</pre></td><td><pre class="st">${esc(r.runsAs)}</pre></td><td>${esc(r.state)}</td></tr>`,
  )
  return [START, "<table>", "  <tr><th>text</th><th>runs as</th><th>run</th></tr>", ...tr, "</table>", STOP].join("\n")
}

function gate(now: string, generated: string, write: (s: string) => void): void {
  if (WRITING) write(generated)
  else expect(now.replace(/\r\n/g, "\n")).toBe(generated)
}

test("the hover's runs are the lowering's, of measured states", () => {
  gate(readFileSync(GENERATED, "utf8"), generatedModule(), (s) => writeFileSync(GENERATED, s))
})

test("network-text.html's 'What it runs as' is the generated table", () => {
  const page = readFileSync(PAGE, "utf8").replace(/\r\n/g, "\n")
  const a = page.indexOf(START)
  const b = page.indexOf(STOP)
  expect(a).toBeGreaterThan(-1)
  expect(b).toBeGreaterThan(a)
  gate(page.slice(a, b + STOP.length), generatedTable(), (s) => writeFileSync(PAGE, page.slice(0, a) + s + page.slice(b + STOP.length)))
})
