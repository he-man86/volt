/**
 * Conversion-matrix oracle (complete-type-checking C.2/C.3). Validates `classifyConversion` against the LIVE
 * compiler for EVERY elementary numeric pair — proves the classification is oracle-calibrated, not invented.
 *
 *   VOLT_VENDOR=codesys bun run scripts/conversion-matrix.ts     # CODESYS
 *   VOLT_VENDOR=twincat bun run scripts/conversion-matrix.ts     # TwinCAT
 *
 * Packs all N×N `dst := src` assignments into ONE FB, INSTANTIATES it in PLC_PRG (unreferenced POUs aren't
 * compiled), builds ONCE, and matches each compiler diagnostic back to its pair by the type names in the
 * message (the bridge reports line 0 for build diagnostics, so line-mapping is impossible). Diffs the
 * compiler's severity against what `classifyConversion` predicts; prints every disagreement. Restores after.
 */
import { classifyConversion, type ConversionKind, type Type } from "../src/frontend/types/index.js"
import { call, landedInFull, VENDOR } from "./bridge.js"
import { fileOf, inFolder, mainProgram } from "../../volt-cli/test/e2e/lib/main-program.js"

if (process.argv.includes("--explicit")) {
  const { explicitConversionPairs } = await import("../test/frontend/conversion-pairs.js")
  const { pairs, covered, missing } = explicitConversionPairs()
  console.log(
    `explicit conversions: ${pairs.length} pairs, ${covered.length} called by a recorded fixture, ${missing.length} by none`,
  )
  for (const m of missing) console.log(`  ${m}`)
  process.exit(0)
}

const TYPES = [
  "SINT",
  "USINT",
  "BYTE",
  "INT",
  "UINT",
  "WORD",
  "DINT",
  "UDINT",
  "DWORD",
  "LINT",
  "ULINT",
  "LWORD",
  "REAL",
  "LREAL",
]
const elem = (name: string): Type => ({ kind: "elementary", name }) as Type
const predicted = (kind: ConversionKind): "none" | "warning" | "error" =>
  kind === "incompatible" ? "error" : kind === "narrow" || kind === "sign-change" ? "warning" : "none"

const version = async (name: string): Promise<string | null> => (await call("refs")).items[name] ?? null
async function pushOps(ops: unknown[]): Promise<void> {
  const r = await call("push", { expectedProjectVersion: (await call("refs")).projectVersion, ops })
  if (!landedInFull(r)) console.warn("  push did not land in full:", JSON.stringify(r.conflicts ?? r).slice(0, 200))
}

const decls = TYPES.map((t) => `  v_${t} : ${t};`).join("\n")
const assigns = TYPES.flatMap((dst) => TYPES.map((src) => `  v_${dst} := v_${src};`)).join("\n")
const source = `FUNCTION_BLOCK ConvMatrix\nVAR\n${decls}\nEND_VAR\n${assigns}\nEND_FUNCTION_BLOCK\n`

const refs0 = await call("refs")
// The wire names an item by its PATH (openspec multi-application-tree): the main program where it sits, ConvMatrix beside it.
const main = mainProgram(refs0)
const plcName = main.path
const plcItem0 = (await call("fetch", { knownItems: {}, onlyItems: [plcName] })).changed?.find((i: any) => i.name === plcName)
if (plcItem0 === undefined) throw new Error(`fetch did not return ${plcName}`)
const plcOriginal: string = plcItem0.sourceText
const prg = fileOf(plcName).replace(".pou", "")
const convMatrix = inFolder(main.folder, "ConvMatrix.pou")

await pushOps([{ op: "set", name: convMatrix, sourceText: source, ifVersion: null }])
await pushOps([
  {
    op: "set",
    name: plcName,
    sourceText: `PROGRAM ${prg}\nVAR\n  inst : ConvMatrix;\nEND_VAR\ninst();\nEND_PROGRAM\n`,
    ifVersion: await version(plcName),
  },
])
const r = await call("build", { buildType: "incremental" })

// Match each diagnostic back to its (src → dst) pair by the type names in the message. The compiler reports
// line 0, so the message text is the only key. Both wordings name src FIRST, dst SECOND.
const ERR = /Cannot convert type '(\w+)' to type '(\w+)'/
const SIGN = /from (?:un)?signed Type '(\w+)' to (?:un)?signed Type '(\w+)'/
const NARROW = /Implicit conversion from '(\w+)' to '(\w+)'/
const ideSev = new Map<string, "warning" | "error">()
for (const d of r.diagnostics ?? []) {
  if (d.severity !== "error" && d.severity !== "warning") continue
  const m = ERR.exec(d.message) ?? SIGN.exec(d.message) ?? NARROW.exec(d.message)
  if (!m) continue
  const key = `${m[1]}->${m[2]}`
  // error wins over warning if both somehow present for a pair
  if (d.severity === "error" || !ideSev.has(key)) ideSev.set(key, d.severity)
}

let agree = 0
const disagreements: string[] = []
for (const dst of TYPES)
  for (const src of TYPES) {
    const kind = classifyConversion(elem(dst), elem(src))
    const want = predicted(kind)
    const ide = ideSev.get(`${src}->${dst}`) ?? "none"
    if (want === ide) agree++
    else
      disagreements.push(
        `${src.padEnd(6)}→ ${dst.padEnd(6)} classify=${kind.padEnd(12)} predict=${want.padEnd(8)} IDE=${ide}`,
      )
  }

console.log(`\nconversion matrix: ${agree}/${TYPES.length * TYPES.length} agree with the live compiler (${VENDOR})`)
console.log(
  `(build success=${r.success}, ${(r.diagnostics ?? []).filter((d: any) => d.severity === "error" || d.severity === "warning").length} error+warning diagnostics matched)`,
)
if (disagreements.length) {
  console.log(`\n${disagreements.length} DISAGREEMENTS (classify predicts ≠ compiler):`)
  for (const d of disagreements) console.log("  " + d)
} else console.log("classifyConversion is severity-identical to the compiler over the full numeric matrix. ✓")

await pushOps([
  { op: "set", name: plcName, sourceText: plcOriginal, ifVersion: await version(plcName) },
])
await pushOps([{ op: "deleteItem", name: convMatrix, ifVersion: await version(convMatrix) }])
