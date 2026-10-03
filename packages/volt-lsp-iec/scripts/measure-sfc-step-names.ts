/**
 * openspec lsp-sfc-step-names 3.1 — MEASURE: the field case (PLCAssist 2026-09-30, `PRG0_Main.prg`, an SFC program whose
 * ST reads its step `S_Boot`) answers clean, and what a typo of a step's name answers now that the chart is not in the
 * text (DIALECT D40). Prints every error per case; changes nothing. Run: bun run scripts/measure-sfc-step-names.ts
 */
import { parseSource } from "../src/frontend/syntax/index.js"
import { build } from "../src/frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../src/analysis/index.js"

function errors(files: Record<string, string>): string[] {
  const inputs = Object.entries(files).map(([uri, source]) => ({ uri, source, parseResult: parseSource(source, { networkText: true }) }))
  const project = build.buildSymbolTable(inputs, [], "codesys")
  return inputs.flatMap((f) =>
    computeSemanticDiagnostics({ parseResult: f.parseResult, source: f.source, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.severity === "error")
      .map((d) => `${f.uri}:${d.span.startLine} ${d.code}: ${d.message}`),
  )
}

const sfc = (action: string): string =>
  "PROGRAM PRG0_Main\nVAR\n\tbx : BOOL;\n\ttOk : BOOL;\nEND_VAR\nIMPLEMENTATION SFC UNSUPPORTED\nEND_PROGRAM\n\n" +
  `ACTION A_Boot\n${action}\nEND_ACTION\n`
const st = (body: string): string =>
  `PROGRAM PRG_Other\nVAR\n\tbx : BOOL;\n\ttOk : BOOL;\nEND_VAR\nIMPLEMENTATION ST\n${body}\nEND_PROGRAM\n`

const cases: [string, Record<string, string>][] = [
  ["field: S_Boot.x/.t/._x/._t in the SFC program's action, PRG0_Main.S_Boot.x/.t from an ST program", {
    "PRG0_Main.prg": sfc("bx := S_Boot.x;\ntOk := S_Boot.t >= T#2S;\nbx := S_Boot._x;\ntOk := S_Boot._t > T#0MS;"),
    "PRG_Other.prg": st("bx := PRG0_Main.S_Boot.x;\ntOk := PRG0_Main.S_Boot.t > T#0MS;"),
  }],
  // the field diagnostic's exact shape: `PRG0_Main.S_Boot` SELF-qualified, at a line of PRG0_Main.prg itself
  // (fixtures `sfc_step_qualified_self` / `_qualified_self_typo`, S3)
  ["field shape: PRG0_Main.S_Boot.x/.t SELF-qualified in the SFC program's own action", {
    "PRG0_Main.prg": sfc("bx := PRG0_Main.S_Boot.x;\ntOk := PRG0_Main.S_Boot.t > T#1S;"),
  }],
  ["typo PRG0_Main.S_Bot.x SELF-qualified in the SFC program's own action", { "PRG0_Main.prg": sfc("bx := PRG0_Main.S_Bot.x;") }],
  // a pull from before the IMPLEMENTATION line (2026-09-28): nothing in the text says the body is SFC, so there is no bet
  ["no IMPLEMENTATION SFC line (a pre-2026-09-28 pull): S_Boot.x and PRG0_Main.S_Boot.x in the program's action", {
    "PRG0_Main.prg": sfc("bx := S_Boot.x;\nbx := PRG0_Main.S_Boot.x;").replace("IMPLEMENTATION SFC UNSUPPORTED\n", ""),
  }],
  ["typo S_Bot.x inside the SFC program", { "PRG0_Main.prg": sfc("bx := S_Bot.x;") }],
  ["typo PRG0_Main.S_Bot.x from outside", { "PRG0_Main.prg": sfc(""), "PRG_Other.prg": st("bx := PRG0_Main.S_Bot.x;") }],
  ["typo S_Bot.y (a member no step has) inside", { "PRG0_Main.prg": sfc("bx := S_Bot.y;") }],
  ["typo S_Bot read bare inside", { "PRG0_Main.prg": sfc("bx := S_Bot;") }],
  ["typo S_Boot.x in an ST program (no SFC POU)", { "PRG_Other.prg": st("bx := S_Boot.x;") }],
]
for (const [name, files] of cases) {
  const e = errors(files)
  console.log(`${e.length} error(s) — ${name}`)
  for (const line of e) console.log(`    ${line}`)
}

// The six corpora's SFC POUs (`IMPLEMENTATION SFC` anywhere under test-corpus), each diagnosed ALONE — a one-file project
// with no libraries, NOT the corpus run's answer: it shows only that the POU's own text raises nothing. That no OTHER code
// reads a step of one is a grep (`VltFixtureSfc.` over test-corpus), not this diagnosis.
const { readdirSync, readFileSync, statSync } = await import("node:fs")
const { join } = await import("node:path")
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]))
const sfcFiles = walk("test-corpus").filter((f) => /\.(pou|prg|fb|fun|TcPOU)$/i.test(f) && readFileSync(f, "utf8").includes("IMPLEMENTATION SFC"))
console.log(`${sfcFiles.length} SFC POU(s) in the corpora`)
for (const f of sfcFiles) console.log(`    ${errors({ [f]: readFileSync(f, "utf8") }).length} error(s), diagnosed alone — ${f}`)
