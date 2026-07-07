/** Compare a fresh `.new.json` recording against the committed one — signal only (message+severity+buildSuccess). */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const vendor = process.argv[2] ?? "codesys"
const dir = join(import.meta.dir, "..", "test", "conformance", "recordings")
const load = (f: string): any => JSON.parse(readFileSync(join(dir, f), "utf8"))
const old = load(`expected-${vendor}.json`)
const neu = load(`expected-${vendor}.new.json`)

const sig = (rec: any): string =>
  rec === undefined
    ? "<absent>"
    : `${rec.buildSuccess} | ${(rec.diagnostics ?? []).map((d: any) => `[${d.severity}] ${d.message}`).sort().join(" ~ ")}`

const names = new Set<string>([...Object.keys(old.tests), ...Object.keys(neu.tests)])
let same = 0
const diffs: string[] = []
for (const n of names) {
  const a = sig(old.tests[n])
  const b = sig(neu.tests[n])
  if (a === b) same++
  else diffs.push(`\n● ${n}\n   OLD: ${a}\n   NEW: ${b}`)
}
console.log(`vendor=${vendor}  identical=${same}/${names.size}  differing=${diffs.length}`)
console.log(diffs.join("\n"))
