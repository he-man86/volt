/**
 * Which exported names in `src/` nobody imports — the scanner `consolidate-lsp-structure` C8 asked for and
 * closed without ("a sweep for exports only tests use needs a dead-export scanner; none is installed").
 *
 *   bun run scripts/dead-exports.ts                     the two lists
 *   bun run scripts/dead-exports.ts --all               …and every export with its importer counts
 *   bun run scripts/dead-exports.ts --scope <dir>       the NOBODY list of the exports declared under <dir>
 *   bun run scripts/dead-exports.ts --gate              the `bun run lint` gate: NOBODY over src/
 *
 * `--scope` and `--gate` (openspec transpile-restructure design.md §8, task 1.0.4; lsp-same-standard design.md §5, task
 * 1.1) leave out (a) the members of every exported union (`Expr`, `Type`, `IrExpr` …: a node interface is used by the
 * union declared beside it, by design) and (b) the names the transpile barrel re-exports on purpose (its design.md
 * §2.1.1 — `ir/`'s types among them), each by (name, declaring file), never by bare name. "No finding" means that
 * filtered list is empty. `--gate` fails on any NOBODY export.
 *
 * It answers TWO different questions and keeps them apart, because only one of them is about dead code:
 *
 *   NOBODY            no file outside its own mentions the name. Usually NOT dead: a union member
 *                     (`IrLoad`, `UnaryExpr`) is used by the union declared beside it, so what is redundant
 *                     is the `export`, not the type. Read before deleting.
 *   TESTS/SCRIPTS     product code imports it, tests or scripts do. Also usually fine — `emitRust` and the
 *                     server harness have no other caller by design — but it is where a rule that outlived
 *                     its use hides, so it is worth a look when the list grows.
 *
 * DELIBERATELY TEXTUAL, not a type-aware graph. A name is "used" when it appears as a word in another file,
 * which over-counts (a mention in a comment reads as a use) and never under-counts. That direction is the safe
 * one for a tool whose output is a deletion list: it will miss something dead before it accuses something live.
 * The 92-name NOBODY list it printed on 2026-09-21 was almost entirely union members, and the two real finds —
 * `detectVendor` and `installCorpus`, 465 lines with no caller in a private package — were already known.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOTS = ["src", "test", "scripts"]
const walk = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith(".ts")) out.push(p.split("\\").join("/"))
  }
  return out
}
const isTest = (f: string): boolean => f.includes(".test.") || f.startsWith("test/")
const isScript = (f: string): boolean => f.startsWith("scripts/")
/** The gates and their planted tests: a name there is a scratch tree's word, not a use — counting it would let a gate
 *  keep real exports alive (`dead-exports.test.ts` plants `IfStatement`, a real AST export). */
const NOT_A_USE: ReadonlySet<string> = new Set([
  "scripts/dead-exports.ts",
  "scripts/dead-exports.test.ts",
  "scripts/check-size.ts",
  "scripts/check-size.test.ts",
])

/** `export function|const|class|interface|type|enum <name>` — the declaration forms; `export {…}` re-exports
 *  are deliberately not counted, since a barrel naming something is not a USE of it. */
const EXPORT = /^export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)/gm
/** An exported type or interface (what `ir/`'s barrel carries as "its types"). */
const EXPORT_TYPE = /^export\s+(?:interface|type)\s+(\w+)/gm

export interface Row {
  name: string
  file: string
  src: number
  test: number
  script: number
}

/** Every export declared in `src/` (not in a test), with how many other files of each kind mention it. */
export function exportRows(texts: ReadonlyMap<string, string>): Row[] {
  const rows: Row[] = []
  // each file's words once (`\bname\b` for a word `name` is exactly membership here) — a regex per export per file
  // took 8 s over the package
  const words = new Map([...texts].map(([f, text]) => [f, new Set(text.match(/\w+/g))]))
  for (const [file, body] of texts) {
    if (!file.startsWith("src/") || isTest(file)) continue
    for (const m of body.matchAll(EXPORT)) {
      const name = m[1]!
      const row: Row = { name, file, src: 0, test: 0, script: 0 }
      for (const [other] of texts) {
        if (other === file || NOT_A_USE.has(other) || !words.get(other)!.has(name)) continue
        if (isScript(other)) row.script += 1
        else if (isTest(other)) row.test += 1
        else row.src += 1
      }
      rows.push(row)
    }
  }
  return rows
}

/** The transpile barrel's deliberate surface (design.md §2.1.1), besides `ir/`'s types. */
export const TRANSPILE_SURFACE: readonly string[] = [
  "lowerSource",
  "lowerPrepared",
  "lowerUnit",
  "prepareProject",
  "libraryBase",
  "LibraryBase",
  "LibraryFile",
  "ParsedFile",
  "LoweredPou",
  "LowerDiagnostic",
  "LOWER_CODES",
  "LOWER_CODE_PREFIXES",
  "lowerCodeKind",
  "CLOCK",
  "run",
  "Runner",
  "emitRust",
  "Emitted",
  "rustType",
  "load",
  "lowerAndEmit",
  "IrValue",
]

/** An exclusion's key: the export's name AND its declaring file, so a name excluded in one file is still asked in any other. */
const keyOf = (name: string, file: string): string => `${name} ${file}`

/**
 * The members of every exported UNION in `src/` (`Expr`, `Statement`, `Type`, `IrExpr`, the network-text unions …), as
 * `<name> <file>`: the names a `export type X = A | B …` declaration lists that are exported from the same file. They
 * are used by the union beside them by design; what is redundant is their `export`, not the type (lsp-same-standard
 * design.md §5, generalising the transpile scope's IR rule). Read from the declarations, never a hand list.
 */
export function unionMembers(texts: ReadonlyMap<string, string>): Set<string> {
  const members = new Set<string>()
  for (const [file, body] of texts) {
    if (!file.startsWith("src/") || isTest(file)) continue
    const exported = new Set([...body.matchAll(EXPORT)].map((m) => m[1]!))
    for (const m of body.matchAll(/^export\s+type\s+\w+\s*(?:<[^=]*>)?\s*=([^;]*?)(?=\n\s*\n|\nexport\s|\n\s*\/[/*]|$(?![\s\S]))/gm)) {
      if (!m[1]!.includes("|")) continue
      for (const id of m[1]!.matchAll(/\b([A-Za-z_]\w*)\b/g)) if (exported.has(id[1]!)) members.add(keyOf(id[1]!, file))
    }
  }
  return members
}

/**
 * The exports the NOBODY gate leaves out, in any scope, as `<name> <file>`: each union's members in the union's file, the
 * transpile barrel's deliberate surface where it is declared under `src/transpile/`, and `ir/`'s types in their `ir/`
 * files (transpile-restructure design.md §2.1.1). Never a bare name: the same name declared elsewhere is still asked.
 */
export function exclusions(texts: ReadonlyMap<string, string>): Set<string> {
  const out = unionMembers(texts)
  const surface = new Set(TRANSPILE_SURFACE)
  for (const [file, body] of texts) {
    if (!file.startsWith("src/transpile/") || isTest(file)) continue
    for (const m of body.matchAll(EXPORT)) if (surface.has(m[1]!)) out.add(keyOf(m[1]!, file))
    if (file.startsWith("src/transpile/ir/")) for (const m of body.matchAll(EXPORT_TYPE)) out.add(keyOf(m[1]!, file))
  }
  return out
}

/** The NOBODY list of the exports declared under `scope` (a directory relative to the package), less the exclusions. */
export function nobodyIn(texts: ReadonlyMap<string, string>, scope: string): Row[] {
  const dir = scope.replace(/\/+$/, "") + "/"
  const excluded = exclusions(texts)
  return exportRows(texts).filter(
    (r) => r.file.startsWith(dir) && r.src === 0 && r.test === 0 && r.script === 0 && !excluded.has(keyOf(r.name, r.file)),
  )
}

/** The gate: every NOBODY export of `src/`, as `<name> <file>`. Any one fails — there is no allowlist and no inline ignore. */
export function deadExports(texts: ReadonlyMap<string, string>): string[] {
  return nobodyIn(texts, "src").map((r) => `${r.name} ${r.file}`)
}

const show = (title: string, list: Row[]): void => {
  console.log(`\n${title} (${list.length})`)
  for (const r of list)
    console.log(`  ${r.name.padEnd(34)} ${r.file}${r.src + r.test + r.script > 0 ? `  (test ${r.test}, script ${r.script})` : ""}`)
}

/** Every `.ts` text of the package (`src`, `test`, `scripts`), keyed by its package-relative path; run from the package. */
export const packageTexts = (): Map<string, string> => new Map(ROOTS.flatMap((r) => walk(r)).map((f) => [f, readFileSync(f, "utf8")]))

if (import.meta.main) {
  const texts = packageTexts()
  const at = process.argv.indexOf("--scope")
  if (process.argv.includes("--gate")) {
    const dead = deadExports(texts)
    if (dead.length > 0) {
      console.error(`✗ dead exports: ${dead.length} export(s) nobody imports — delete the export`)
      for (const u of dead) console.error(`  ${u}`)
      process.exit(1)
    }
    console.log(`✓ dead exports: src/ exports nothing nobody imports`)
  } else if (at >= 0) {
    const scope = process.argv[at + 1]?.split("\\").join("/")
    if (scope === undefined || !existsSync(scope)) throw new Error(`--scope needs an existing directory, got ${scope}`)
    const list = nobodyIn(texts, scope)
    show(`NOBODY under ${scope} — the IR union members and the deliberate barrel surface left out`, list)
    if (list.length === 0) console.log("  no finding")
  } else {
    const rows = exportRows(texts)
    const nobody = rows.filter((r) => r.src === 0 && r.test === 0 && r.script === 0)
    const notProduct = rows.filter((r) => r.src === 0 && (r.test > 0 || r.script > 0))
    console.log(`${rows.length} exported names across ${rows.length === 0 ? 0 : new Set(rows.map((r) => r.file)).size} files in src/`)
    show("NOBODY — read before deleting; most are union members used by the union beside them", nobody)
    show("TESTS/SCRIPTS ONLY — no product caller", notProduct)
    if (process.argv.includes("--all")) show("EVERY export", rows)
  }
}
