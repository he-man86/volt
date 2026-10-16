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
 * IMPORT-BASED, not a type-aware graph: a name is "used" when another file IMPORTS it (`importedNames`), from any
 * module — a name imported elsewhere under the same spelling still counts, the safe direction for a deletion list.
 * It counted any word mention until 2026-10-16, and a name cited in a comment or written in ST fixture text kept its
 * dead `export` alive (28 of them, found by an import scan), as did a barrel's `export { … } from` line.
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
const EXPORT = /^export\s+(?:async\s+)?(?:abstract\s+)?(?:function\*?|const\s+enum|const|let|class|interface|type|enum)\s+(\w+)/gm
/** An exported type or interface (what `ir/`'s barrel carries as "its types"). */
const EXPORT_TYPE = /^export\s+(?:interface|type)\s+(\w+)/gm

export interface Row {
  name: string
  file: string
  src: number
  test: number
  script: number
}

/** The names in a `{ a, type B, c as d }` list, each by the name it is imported AS FROM its module (`a`, `B`, `c`). */
const listNames = (list: string): string[] =>
  list
    .split(",")
    .map((s) => s.trim().replace(/^type\s+/, "").split(/\s*(?:\bas\b|:)\s*/)[0]!.trim())
    .filter((n) => /^\w+$/.test(n))

/**
 * Every name `text` takes from another module — what counts as a USE: an `import { … } from` (multi-line too), a
 * destructured `await import(…)` / `require(…)`, a `import(…).Name` type query, and `ns.Name` through an
 * `import * as ns`. Not a use: a mention in a comment or in fixture text, and an `export { … } from` line — a barrel
 * naming a name passes it on; the files that import it through the barrel are its uses.
 */
export function importedNames(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/^\s*import\s+(?:type\s+)?(?:\w+\s*,\s*)?\{([^}]*)\}\s*from\s/gm)) for (const n of listNames(m[1]!)) out.add(n)
  for (const m of text.matchAll(/\{([^{}]*)\}\s*=\s*(?:await\s+import|require)\(/g)) for (const n of listNames(m[1]!)) out.add(n)
  for (const m of text.matchAll(/\bimport\([^)]*\)\.(\w+)/g)) out.add(m[1]!)
  for (const ns of text.matchAll(/^\s*import\s+\*\s+as\s+(\w+)\s+from\s/gm))
    for (const m of text.matchAll(new RegExp(`\\b${ns[1]}\\.(\\w+)`, "g"))) out.add(m[1]!)
  return out
}

/** Every export declared in `src/` (not in a test), with how many other files of each kind import it. */
export function exportRows(texts: ReadonlyMap<string, string>): Row[] {
  const rows: Row[] = []
  const imports = new Map([...texts].map(([f, text]) => [f, importedNames(text)]))
  for (const [file, body] of texts) {
    if (!file.startsWith("src/") || isTest(file)) continue
    for (const m of body.matchAll(EXPORT)) {
      const name = m[1]!
      const row: Row = { name, file, src: 0, test: 0, script: 0 }
      for (const [other] of texts) {
        if (other === file || NOT_A_USE.has(other) || !imports.get(other)!.has(name)) continue
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
