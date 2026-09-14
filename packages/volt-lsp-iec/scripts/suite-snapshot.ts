#!/usr/bin/env bun
/**
 * Snapshot of every conformance/execution test as `status  describe › title` — the gate for moving tests between files
 * (unify-conformance-suite §5). A move keeps every title, so a snapshot taken before it and one taken after must be equal;
 * the file a test lives in is deliberately not part of a line.
 *
 *   bun scripts/suite-snapshot.ts <out.txt>              # write a snapshot
 *   bun scripts/suite-snapshot.ts --compare <before.txt>  # take one now and fail on any difference
 *
 * The suites are whatever `SUITE_DIRS` names — it lists the test tree before AND after the move, so the command stays the
 * same across it.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SUITE_DIRS = ["test/conformance", "test/exec"].filter((d) => existsSync(join(import.meta.dir, "..", d)))

function snapshot(): string[] {
  const dir = mkdtempSync(join(tmpdir(), "volt-suite-snapshot-"))
  const xml = join(dir, "junit.xml")
  Bun.spawnSync(["bun", "test", ...SUITE_DIRS, "--reporter=junit", `--reporter-outfile=${xml}`], {
    cwd: join(import.meta.dir, ".."),
    stdout: "ignore",
    stderr: "ignore",
  })
  if (!existsSync(xml)) throw new Error("bun test wrote no JUnit report")
  const text = readFileSync(xml, "utf8")
  rmSync(dir, { recursive: true, force: true })
  const decode = (s: string): string =>
    s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
  const lines: string[] = []
  for (const m of text.matchAll(/<testcase name="([^"]*)" classname="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const body = m[4] ?? ""
    const status = /<failure/.test(body) ? "fail" : /<skipped/.test(body) ? "skip" : "pass"
    lines.push(`${status}\t${decode(m[2]!)} › ${decode(m[1]!)}`)
  }
  if (lines.length === 0) throw new Error("the JUnit report held no test cases")
  return lines.sort()
}

const args = process.argv.slice(2)
if (args[0] === "--compare") {
  const before = readFileSync(args[1]!, "utf8").split(/\r?\n/).filter((l) => l !== "")
  const after = snapshot()
  const count = (xs: string[]): Map<string, number> => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())
  const [b, a] = [count(before), count(after)]
  const lost = [...b].filter(([k, n]) => (a.get(k) ?? 0) < n).map(([k]) => `- ${k}`)
  const gained = [...a].filter(([k, n]) => (b.get(k) ?? 0) < n).map(([k]) => `+ ${k}`)
  console.log(`before ${before.length} tests, after ${after.length}`)
  if (lost.length + gained.length === 0) {
    console.log("✓ identical")
  } else {
    console.log([...lost, ...gained].join("\n"))
    process.exit(1)
  }
} else if (args[0] !== undefined) {
  const lines = snapshot()
  writeFileSync(args[0], `${lines.join("\n")}\n`)
  const by = lines.reduce<Record<string, number>>((m, l) => ((m[l.split("\t")[0]!] = (m[l.split("\t")[0]!] ?? 0) + 1), m), {})
  console.log(`wrote ${lines.length} tests to ${args[0]}: ${JSON.stringify(by)}`)
} else {
  console.error("usage: bun scripts/suite-snapshot.ts <out.txt> | --compare <before.txt>")
  process.exit(2)
}
