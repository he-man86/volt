#!/usr/bin/env bun
/**
 * Snapshot of every test in the suites a move touches, as `status  describe › title` — the gate for moving tests between
 * files (unify-conformance-suite §5; gate T of openspec transpile-restructure design.md §8). A move keeps every title, so a
 * snapshot taken before it and one taken after must be equal; the file a test lives in is deliberately not part of a line.
 *
 *   bun scripts/suite-snapshot.ts <out.txt> [--dirs a,b]              # write a snapshot
 *   bun scripts/suite-snapshot.ts --compare <before.txt> [--dirs a,b]  # take one now and fail on any difference
 *
 * The suites are `--dirs` (comma-separated, relative to the package), or `DEFAULT_DIRS`: the conformance suite, the
 * transpiler's colocated tests, the front-end's (`src/frontend/{types,symbols,syntax}` — where frontend-conformance put
 * what transpile-restructure's tasks call `src/types`, `src/symbols`, `src/syntax`) and the library tests. A directory the
 * tree does not have is skipped, so the command stays the same before and after a move that creates or empties one; a
 * `--dirs` entry that does not exist is refused by name (a typo would otherwise snapshot nothing and compare equal).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const PKG = join(import.meta.dir, "..")

export const DEFAULT_DIRS = [
  "test/conformance",
  "test/exec",
  "src/transpile",
  "src/frontend/types",
  "src/frontend/symbols",
  "src/frontend/syntax",
  "test/libraries",
] as const

/** The suite directories a run covers: `--dirs`, each required to exist, or the default set as far as the tree has it. */
export function suiteDirs(dirsOption: string | undefined, exists: (dir: string) => boolean): string[] {
  if (dirsOption === undefined) return DEFAULT_DIRS.filter(exists)
  const dirs = dirsOption
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d !== "")
  if (dirs.length === 0) throw new Error("--dirs names no directory")
  const missing = dirs.filter((d) => !exists(d))
  if (missing.length > 0) throw new Error(`--dirs: no such directory: ${missing.join(", ")}`)
  return dirs
}

/** `status<TAB>describe › title` per test case of a bun JUnit report, sorted. */
export function junitLines(xml: string): string[] {
  const decode = (s: string): string =>
    s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
  const lines: string[] = []
  for (const m of xml.matchAll(/<testcase name="([^"]*)" classname="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const body = m[4] ?? ""
    const status = /<failure/.test(body) ? "fail" : /<skipped/.test(body) ? "skip" : "pass"
    lines.push(`${status}\t${decode(m[2]!)} › ${decode(m[1]!)}`)
  }
  return lines.sort()
}

/** The lines lost and gained between two snapshots, as a multiset (a title may legitimately repeat). */
export function compareLines(before: readonly string[], after: readonly string[]): string[] {
  const count = (xs: readonly string[]): Map<string, number> => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())
  const [b, a] = [count(before), count(after)]
  const lost = [...b].filter(([k, n]) => (a.get(k) ?? 0) < n).map(([k]) => `- ${k}`)
  const gained = [...a].filter(([k, n]) => (b.get(k) ?? 0) < n).map(([k]) => `+ ${k}`)
  return [...lost, ...gained]
}

function snapshot(dirs: readonly string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "volt-suite-snapshot-"))
  const xml = join(dir, "junit.xml")
  Bun.spawnSync(["bun", "test", ...dirs, "--reporter=junit", `--reporter-outfile=${xml}`], {
    cwd: PKG,
    stdout: "ignore",
    stderr: "ignore",
  })
  if (!existsSync(xml)) throw new Error("bun test wrote no JUnit report")
  const lines = junitLines(readFileSync(xml, "utf8"))
  rmSync(dir, { recursive: true, force: true })
  if (lines.length === 0) throw new Error("the JUnit report held no test cases")
  return lines
}

function main(): void {
  const argv = process.argv.slice(2)
  const i = argv.indexOf("--dirs")
  const dirsOption = i < 0 ? undefined : argv[i + 1]
  if (i >= 0 && dirsOption === undefined) throw new Error("--dirs takes a comma-separated list")
  const args = i < 0 ? argv : [...argv.slice(0, i), ...argv.slice(i + 2)]
  const dirs = suiteDirs(dirsOption, (d) => existsSync(join(PKG, d)))
  if (args[0] === "--compare" && args[1] !== undefined) {
    const before = readFileSync(args[1], "utf8").split(/\r?\n/).filter((l) => l !== "")
    const after = snapshot(dirs)
    const differ = compareLines(before, after)
    console.log(`before ${before.length} tests, after ${after.length} (${dirs.join(", ")})`)
    if (differ.length === 0) {
      console.log("✓ identical")
    } else {
      console.log(differ.join("\n"))
      process.exit(1)
    }
  } else if (args[0] !== undefined && args[0] !== "--compare") {
    const lines = snapshot(dirs)
    writeFileSync(args[0], `${lines.join("\n")}\n`)
    const by = lines.reduce<Record<string, number>>((m, l) => ((m[l.split("\t")[0]!] = (m[l.split("\t")[0]!] ?? 0) + 1), m), {})
    console.log(`wrote ${lines.length} tests from ${dirs.join(", ")} to ${args[0]}: ${JSON.stringify(by)}`)
  } else {
    console.error("usage: bun scripts/suite-snapshot.ts <out.txt> | --compare <before.txt>  [--dirs a,b]")
    process.exit(2)
  }
}

if (import.meta.main) main()
