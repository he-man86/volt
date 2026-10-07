#!/usr/bin/env bun
/**
 * SNAPSHOT S — THE TRANSPILER'S WHOLE OUTPUT, BEFORE AND AFTER A RESTRUCTURE STEP (openspec transpile-restructure
 * design.md §8, task 0.3). What a fixture's snapshot holds is defined in `test/conformance/support/snapshot.ts`: the
 * canonical IR (`ir`), the emitted Rust and source map (`rust`), both backends' values on the declared and the edge
 * inputs (`outputs`), and the edge verdict (`edge`).
 *
 *   bun run snapshot:transpile write [--baseline] [--layers ir,rust,outputs,edge]
 *   bun run snapshot:transpile check [--layers ir,rust,outputs,edge]     # S; S-out is --layers outputs,edge
 *
 * `write --baseline` stores the snapshot `check` compares against (`test/conformance/.snapshot/baseline/`); `write`
 * alone and `check` store the working tree's (`.snapshot/current/`). `check` prints the FIRST difference per fixture
 * (its layer, line, and both lines) and exits 1 on any. Only the layers asked for are computed: `ir` and `rust` need no
 * compiler; `outputs` and `edge` build every lowered fixture through the rustc cache (`support/rustc-cache.ts`).
 *
 * `VOLT_FIXTURES=<a,b>` narrows a run to those fixtures (the inner loop; `support/selection.ts`) — a check then compares
 * only them. A step's gate runs it whole. The files are gitignored: a snapshot is a measurement of one tree, not a
 * source.
 */
// the environment the suite and `rate:fixtures` rate under (LD and FBD network text ON) — before anything reaches the LSP
import "../test/network-text-on.js"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { ALL_TESTS } from "../test/conformance/fixtures/index.js"
import { selectFixtures } from "../test/conformance/support/selection.js"
import {
  compareSnapshots,
  LAYERS,
  parseLayers,
  snapshotFixture,
  type FixtureSnapshot,
  type Layer,
} from "../test/conformance/support/snapshot.js"

const PKG = join(import.meta.dir, "..")
const ROOT = join(PKG, "test", "conformance", ".snapshot")
const args = process.argv.slice(2)
const option = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i < 0 ? undefined : args[i + 1]
}
const layersOption = option("--layers")
const layers: readonly Layer[] = layersOption === undefined ? LAYERS : parseLayers(layersOption)

/** Take the working tree's snapshot of the selected fixtures, one lane per core (the Rust builds overlap). */
async function take(): Promise<{ snap: Map<string, FixtureSnapshot>; names: ReadonlySet<string>; seconds: number }> {
  const started = performance.now()
  const selection = selectFixtures(ALL_TESTS)
  const dir = mkdtempSync(join(tmpdir(), "volt-transpile-snapshot-"))
  const snap = new Map<string, FixtureSnapshot>()
  const failed: string[] = []
  const lanes = Math.max(1, navigator.hardwareConcurrency - 1)
  let next = 0
  try {
    await Promise.all(
      Array.from({ length: Math.min(lanes, selection.selected.length) }, async () => {
        for (let i = next++; i < selection.selected.length; i = next++) {
          const t = selection.selected[i]!
          try {
            snap.set(t.name, await snapshotFixture(t, ALL_TESTS, layers, dir))
          } catch (e) {
            // a harness fault (a hang, a stale cache entry) is no snapshot: refused by name, never written as one
            failed.push(`${t.name}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
      }),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  if (failed.length > 0) throw new Error(`the snapshot of ${failed.length} fixture(s) failed:\n  ${failed.sort().join("\n  ")}`)
  return { snap, names: new Set(selection.selected.map((t) => t.name)), seconds: Math.round((performance.now() - started) / 1000) }
}

/** One `<layer>.jsonl` per layer, a `[name, text]` line per fixture in name order (a case-insensitive file system
 *  cannot hold one file per fixture: two names may differ only in case). */
function store(set: string, snap: ReadonlyMap<string, FixtureSnapshot>, seconds: number): string {
  const dir = join(ROOT, set)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const names = [...snap.keys()].sort()
  for (const layer of layers) {
    const lines = names.flatMap((n) => (snap.get(n)![layer] === undefined ? [] : [JSON.stringify([n, snap.get(n)![layer]])]))
    writeFileSync(join(dir, `${layer}.jsonl`), `${lines.join("\n")}\n`)
  }
  writeFileSync(join(dir, "done"), `${names.length} fixtures, layers ${layers.join(",")}, ${seconds} s\n`)
  return relative(PKG, dir)
}

/** A stored set, the layers asked for — refusing one that lacks a layer (a baseline written with fewer layers). */
function load(set: string): Map<string, FixtureSnapshot> {
  const dir = join(ROOT, set)
  if (!existsSync(join(dir, "done"))) throw new Error(`no snapshot '${set}' — run \`bun run snapshot:transpile write${set === "baseline" ? " --baseline" : ""}\` first`)
  const out = new Map<string, FixtureSnapshot>()
  for (const layer of layers) {
    const file = join(dir, `${layer}.jsonl`)
    if (!existsSync(file)) throw new Error(`the '${set}' snapshot has no '${layer}' layer — write it with that layer`)
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line === "") continue
      const [name, text] = JSON.parse(line) as [string, string]
      out.set(name, { ...out.get(name), [layer]: text })
    }
  }
  return out
}

async function main(): Promise<void> {
  const [verb] = args
  if (verb === "write") {
    const { snap, seconds } = await take()
    const where = store(args.includes("--baseline") ? "baseline" : "current", snap, seconds)
    console.log(`wrote ${snap.size} fixtures (layers ${layers.join(",")}) to ${where} in ${seconds} s`)
    return
  }
  if (verb === "check") {
    const baseline = load("baseline")
    const { snap, names, seconds } = await take()
    store("current", snap, seconds)
    // a fixture the baseline holds but this run did not select (VOLT_FIXTURES) is not compared
    const before = new Map([...baseline].filter(([n]) => names.has(n)))
    const differ = compareSnapshots(before, snap, layers)
    console.log(`transpile snapshot vs baseline (layers ${layers.join(",")}): ${snap.size} fixtures, ${seconds} s`)
    if (differ.length === 0) {
      console.log("✓ identical")
      return
    }
    console.log(`✗ ${differ.length} fixture(s) differ:`)
    for (const d of differ.slice(0, 200)) console.log(`  ${d}`)
    if (differ.length > 200) console.log(`  … and ${differ.length - 200} more`)
    process.exit(1)
  }
  console.error("usage: bun run snapshot:transpile write [--baseline] | check  [--layers ir,rust,outputs,edge]")
  process.exit(2)
}

await main()
