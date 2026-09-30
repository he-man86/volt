#!/usr/bin/env bun
/**
 * THE FRONT-END PATH CODEMOD — `src/{syntax,symbols,types}` moved under `src/frontend/` (openspec frontend-conformance
 * design.md "Where the tree lives", task 1.12). Committed and RE-RUNNABLE (design.md P10, Gate T): a commit that lands
 * after the move with an old path — a transpile fix written against `../syntax/index.js` — is fixed by running this
 * again, not by hand.
 *
 *   bun scripts/codemod-frontend-paths.ts          rewrite, and list every file it changed
 *   bun scripts/codemod-frontend-paths.ts --check  change nothing; exit 1 when a file still needs rewriting
 *
 * Every relative specifier (`import … from "…"`, `export … from "…"`, `import("…")`) in `src/`, `test/`, `scripts/` and
 * `libraries/` is resolved. One that names an existing file is left alone. One that does not is resolved again as the
 * file WOULD have read it before the move — from its old folder, when the file itself moved — and, when that lands in
 * `src/syntax|symbols|types/…`, pointed at `src/frontend/<same>/…`. A specifier that resolves nowhere either way is
 * reported and left when it pointed into a moved layer: this script moves paths, it does not guess them.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

const PKG = resolve(import.meta.dir, "..")
const SRC = join(PKG, "src")
const MOVED = ["syntax", "symbols", "types"]
const ROOTS = ["src", "test", "scripts", "libraries"]
const check = process.argv.includes("--check")

const slash = (p: string): string => p.split("\\").join("/")

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith(".ts")) out.push(p)
  }
  return out
}

/** Does a specifier's target exist (`x.js` names `x.ts`)? */
const exists = (target: string): boolean =>
  existsSync(target) || existsSync(target.replace(/\.js$/, ".ts")) || existsSync(join(target, "index.ts"))

/** Where a moved file lived before the move: `src/frontend/<layer>/…` → `src/<layer>/…`; others where they are. */
function oldPath(file: string): string {
  const rel = slash(relative(SRC, file))
  const m = /^frontend\/(syntax|symbols|types)\/(.*)$/.exec(rel)
  return m === null ? file : join(SRC, m[1]!, m[2]!)
}

/** A path under `src/<moved layer>/…`, as it is now: under `src/frontend/`. */
function newPath(target: string): string | undefined {
  const rel = slash(relative(SRC, target))
  const layer = rel.split("/")[0]!
  return MOVED.includes(layer) && !rel.startsWith("..") ? join(SRC, "frontend", rel) : undefined
}

const SPEC = /((?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\bfrom\s*)?|import\(\s*)(["'])(\.{1,2}\/[^"']+)\2/g

const changed: string[] = []
const unresolved: string[] = []
for (const root of ROOTS)
  for (const file of walk(join(PKG, root))) {
    const text = readFileSync(file, "utf8")
    const next = text.replace(SPEC, (whole, head: string, quote: string, spec: string) => {
      if (exists(resolve(dirname(file), spec))) return whole
      const before = resolve(dirname(oldPath(file)), spec)
      const moved = newPath(before)
      // not a path into a moved layer (a specifier inside a string of code, a file that is simply missing): not ours
      const now = moved ?? (oldPath(file) !== file && exists(before) ? before : undefined)
      if (now === undefined) return whole
      if (!exists(now)) {
        unresolved.push(`${slash(relative(PKG, file))}: ${spec}`)
        return whole
      }
      let rewritten = slash(relative(dirname(file), now))
      if (!rewritten.startsWith(".")) rewritten = `./${rewritten}`
      return `${head}${quote}${rewritten}${quote}`
    })
    if (next !== text) {
      changed.push(slash(relative(PKG, file)))
      if (!check) writeFileSync(file, next)
    }
  }

for (const f of changed) console.log(`${check ? "needs rewriting" : "rewrote"} ${f}`)
for (const u of unresolved) console.error(`unresolved (left as written): ${u}`)
console.log(`${changed.length} file(s) ${check ? "to rewrite" : "rewritten"}, ${unresolved.length} unresolved`)
if (unresolved.length > 0 || (check && changed.length > 0)) process.exit(1)
