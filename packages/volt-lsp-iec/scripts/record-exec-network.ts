/**
 * Execution recorder for NETWORK bodies (openspec network-text-lowering point 3) — the execution cases whose body is
 * plain-ST network text (`ExecCase.language`), merged into `test/conformance/recordings/codesys.run.json` in the shape
 * `record-exec.ts` writes. The headless runscript writes PLC_PRG as ST text; only the bridge makes a body a network, so
 * these run on a served CODESYS:
 *
 *   pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor codesys -Instance <name> -Run <run> -Wait
 *   VOLT_E2E_INSTANCE=<name> [RECORD_ONLY=a,b] bun run scripts/record-exec-network.ts
 *   pwsh packages/volt-cli/scripts/ide.ps1 down -Vendor codesys -Instance <name> -Run <run>
 *
 * Per case: the case's program pushed with its network body (the bridge writes the network), a driver PROGRAM that calls
 * it on its first `cycles` scans and never again (the counter gate `record-exec.py` writes into PLC_PRG), the driver
 * called from the main program, the application run in simulation by the IDE's run probe (`volt-cli`
 * `scripts/run_pipe_production.py`, the protocol `test/e2e/lib/codesys-run.ts` speaks), every path read with the online
 * read's `read_value` as `record-exec.py` reads it, and everything put back.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { ALL_TESTS } from "../test/conformance/fixtures/index.js"
import { isNetworkCase } from "../test/conformance/support/plc-prg.js"
import { runPaths } from "../test/conformance/support/run-paths.js"
import { call, landedInFull, pipeName } from "./bridge.js"

const ONLY = process.env.RECORD_ONLY ? new Set(process.env.RECORD_ONLY.split(",")) : undefined
const cases = ALL_TESTS.filter((t) => isNetworkCase(t) && !t.execSkip && (ONLY === undefined || ONLY.has(t.name)))
if (cases.length === 0) throw new Error("no network execution case to record")

const RUN = "VltE2E_ntrun"
const DRV = "VltE2E_ntdrv"

async function push(ops: unknown[]): Promise<void> {
  const refs = await call("refs")
  const r = await call("push", { expectedProjectVersion: refs.projectVersion, ops })
  if (!landedInFull(r)) throw new Error(`the push did not land: ${JSON.stringify(r.conflicts ?? r)}`)
}

async function source(path: string): Promise<{ sourceText: string; version: string }> {
  const f = await call("fetch", { knownItems: {}, onlyItems: [path] })
  const it = f.changed.find((i: { name: string }) => i.name === path)
  if (it === undefined) throw new Error(`'${path}' is not in its fetch`)
  return it
}

/** Build, run the application in simulation and read `paths` (`run_pipe_production.py`'s request files). */
async function runAndRead(paths: readonly string[]): Promise<Record<string, string>> {
  const folder = join(process.env.LOCALAPPDATA!, "volt-bridge", "codesys-run", pipeName().split(".").pop()!)
  mkdirSync(folder, { recursive: true })
  const id = randomUUID().replace(/-/g, "")
  writeFileSync(join(folder, `request.${id}.tmp`), [id, ...paths].join("\n") + "\n")
  renameSync(join(folder, `request.${id}.tmp`), join(folder, "request"))
  const done = join(folder, `${id}.json`)
  const error = join(folder, `${id}.error`)
  const deadline = Date.now() + 120_000
  while (!existsSync(done) && !existsSync(error)) {
    if (Date.now() > deadline) throw new Error(`the run probe in ${folder} did not answer — serve the IDE with ide.ps1`)
    await Bun.sleep(200)
  }
  try {
    if (existsSync(error)) throw new Error(`the run probe refused: ${readFileSync(error, "utf8")}`)
    return JSON.parse(readFileSync(done, "utf8"))
  } finally {
    for (const f of [done, error]) rmSync(f, { force: true })
  }
}

const refs = await call("refs")
const main = Object.keys(refs.items ?? {}).find((p) => /(^|\/)PLC_PRG\.pou$/i.test(p))
if (main === undefined) throw new Error("the served project has no PLC_PRG to call the driver from")
const folder = main.slice(0, main.lastIndexOf("/"))
const original = (await source(main)).sourceText
const recorded: Record<string, { cycles: string; values: Record<string, string> }> = {}
for (const t of cases) {
  const cycles = t.cycles ?? 1
  const paths = runPaths(t, ALL_TESTS)
  const program = `PROGRAM ${RUN}\nVAR\n${t.plcPrgVar ?? ""}\nEND_VAR\n${t.plcPrgBody}\nEND_PROGRAM\n`
  const driver = `PROGRAM ${DRV}\nVAR\n\tn : INT;\nEND_VAR\n%LANGUAGE ST\nIF n < ${cycles} THEN\n\tn := n + 1;\n\t${RUN}();\nEND_IF\nEND_PROGRAM\n`
  const calling = original.replace(/^%LANGUAGE ST$/m, `%LANGUAGE ST\n${DRV}();`)
  try {
    await push([
      { op: "set", name: `${folder}/${RUN}.pou`, sourceText: program, ifVersion: null },
      { op: "set", name: `${folder}/${DRV}.pou`, sourceText: driver, ifVersion: null },
      { op: "set", name: main, sourceText: calling, ifVersion: (await source(main)).version },
    ])
    const v = await runAndRead([`${DRV}.n`, ...paths.map((p) => `${RUN}.${p}`)])
    recorded[t.name] = { cycles: v[`${DRV}.n`]!, values: Object.fromEntries(paths.map((p) => [p, v[`${RUN}.${p}`]!])) }
    console.log(`${t.name}: ${JSON.stringify(recorded[t.name])}`)
  } finally {
    const now = await call("refs")
    await push([
      { op: "set", name: main, sourceText: original, ifVersion: now.items[main] },
      ...[RUN, DRV].flatMap((n) => (now.items[`${folder}/${n}.pou`] === undefined ? [] : [{ op: "deleteItem", name: `${folder}/${n}.pou`, ifVersion: now.items[`${folder}/${n}.pou`] }])),
    ])
  }
}

const file = join(import.meta.dir, "..", "test", "conformance", "recordings", "codesys.run.json")
const committed = JSON.parse(readFileSync(file, "utf8"))
for (const [name, rec] of Object.entries(recorded)) committed.tests[name] = rec
writeFileSync(file, JSON.stringify(committed, null, 2) + "\n")
console.log(`recorded ${Object.keys(recorded).length} network case(s) into codesys.run.json`)
