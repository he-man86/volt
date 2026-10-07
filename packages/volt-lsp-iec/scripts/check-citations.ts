#!/usr/bin/env bun
/**
 * The citation check (openspec transpile-restructure design.md §8; task 1.0.3), in `bun run lint`.
 *
 * Finds `path.ts:NNN` and `path.ts` citations and reports each whose file no longer exists, in:
 *   - `src/**` (comments — the whole text is scanned: a string naming a `.ts` file is a citation too),
 *   - `test/conformance/fixtures/**` (the fixtures' comments),
 *   - the authored NOTES and LEAN texts (`test/conformance/support/transpile-confidence.ts`, or `support/notes/` once
 *     task 1.8.3 splits it),
 *   - `docs/*.md`,
 *   - the open openspec changes' `tasks.md` (`openspec/changes/<name>/tasks.md`, not the archive).
 *
 * A citation resolves when some `.ts` file of the repository ends with the cited path at a `/` boundary (`ir/expr.ts`,
 * `lower/calls.ts`, `types/compat.ts` all name a file by its tail, relative to whichever root the text speaks from).
 * WARNING-ONLY until task 1.9.3 (then `--strict`, an error): a structure step re-points what it moves, and the count it
 * prints is the step's to keep from growing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const PACKAGE = resolve(import.meta.dir, "..")
const REPO = resolve(PACKAGE, "..", "..")
const SKIP_DIRS = new Set(["node_modules", "dist", "target", "bin", "obj", "test-corpus"])

const slash = (p: string): string => p.split("\\").join("/")

function walk(dir: string, keep: (name: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, keep, out)
    else if (keep(name)) out.push(p)
  }
  return out
}

/** `a/b.ts` or `b.ts`, optionally `:NNN` or `:NNN-MMM`; never inside a longer path, a URL or a glob (`*.test.ts`). */
const CITATION = /(?<![\w./*<>{}$-])((?:[\w-]+(?:\.[\w-]+)*\/)*[\w-]+(?:\.[\w-]+)*\.ts)\b(?::(\d+)(?:-\d+)?)?/g

export interface Citation {
  /** The citing file, relative to the repository. */
  source: string
  line: number
  /** The cited path as written (without the line). */
  cited: string
}

/** Every citation in `text`, with the line it is on. */
export function citationsIn(source: string, text: string): Citation[] {
  const out: Citation[] = []
  const lines = text.split("\n")
  for (let k = 0; k < lines.length; k++)
    for (const m of lines[k]!.matchAll(CITATION)) {
      const cited = m[1]!
      if (cited.endsWith(".d.ts")) continue
      out.push({ source, line: k + 1, cited })
    }
  return out
}

/** Does `cited` name one of `files` (repository-relative, `/`-separated) by its tail? */
export function resolves(cited: string, files: ReadonlySet<string>, tails: ReadonlySet<string>): boolean {
  const c = cited.replace(/^\.\//, "")
  return files.has(c) || tails.has(c)
}

/** Every tail (`c.ts`, `b/c.ts`, `a/b/c.ts`) of every path. */
export function tailsOf(files: Iterable<string>): Set<string> {
  const tails = new Set<string>()
  for (const f of files) {
    const parts = f.split("/")
    for (let k = 0; k < parts.length; k++) tails.add(parts.slice(k).join("/"))
  }
  return tails
}

/** The texts the check reads, repository-relative. */
export function citingFiles(pkg: string = PACKAGE, repo: string = REPO): string[] {
  const isTs = (n: string): boolean => n.endsWith(".ts")
  const files = [
    ...walk(join(pkg, "src"), isTs),
    ...walk(join(pkg, "test", "conformance", "fixtures"), isTs),
    ...walk(join(pkg, "test", "conformance", "support"), (n) => n === "transpile-confidence.ts"),
    ...walk(join(pkg, "test", "conformance", "support", "notes"), isTs),
    ...(existsSync(join(pkg, "docs"))
      ? readdirSync(join(pkg, "docs"))
          .filter((n) => n.endsWith(".md"))
          .map((n) => join(pkg, "docs", n))
      : []),
  ]
  const changes = join(repo, "openspec", "changes")
  if (existsSync(changes))
    for (const name of readdirSync(changes)) {
      const tasks = join(changes, name, "tasks.md")
      if (name !== "archive" && existsSync(tasks)) files.push(tasks)
    }
  return [...new Set(files.map((f) => slash(relative(repo, f))))].sort()
}

/** Every citation whose file does not exist. */
export function missingCitations(pkg: string = PACKAGE, repo: string = REPO): Citation[] {
  const all = new Set(walk(repo, (n) => n.endsWith(".ts")).map((f) => slash(relative(repo, f))))
  const tails = tailsOf(all)
  const out: Citation[] = []
  for (const source of citingFiles(pkg, repo))
    for (const c of citationsIn(source, readFileSync(join(repo, source), "utf8")))
      if (!resolves(c.cited, all, tails)) out.push(c)
  return out
}

if (import.meta.main) {
  const strict = process.argv.includes("--strict")
  const missing = missingCitations()
  if (missing.length === 0) {
    console.log("✓ citations: every cited .ts file exists")
  } else {
    const bySource = new Map<string, Citation[]>()
    for (const c of missing) bySource.set(c.source, [...(bySource.get(c.source) ?? []), c])
    const report = strict ? console.error : console.warn
    report(`${strict ? "✗" : "!"} citations: ${missing.length} citation(s) of a .ts file that does not exist`)
    for (const [source, list] of bySource) {
      report(`  ${source} (${list.length})`)
      if (process.argv.includes("--all") || strict) for (const c of list) report(`    :${c.line} ${c.cited}`)
    }
    if (!process.argv.includes("--all") && !strict) report("  (--all lists each citation)")
    if (strict) process.exit(1)
  }
}
