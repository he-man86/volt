#!/usr/bin/env bun
/**
 * The citation check (openspec transpile-restructure design.md §8; task 1.0.3), in `bun run lint`.
 *
 * Finds `path.ts:NNN` and `path.ts` citations and reports each whose file no longer exists, in:
 *   - `src/**` (comments — the whole text is scanned: a string naming a `.ts` file is a citation too),
 *   - `test/conformance/fixtures/**` (the fixtures' comments),
 *   - the authored NOTES and LEAN texts (`test/conformance/support/notes/`),
 *   - `docs/*.md`,
 *   - the open openspec changes' `tasks.md` (`openspec/changes/<name>/tasks.md`, not the archive) — outside a TICKED task,
 *     whose lines are the record of what it did (`recordLines`).
 *
 * A citation resolves when some `.ts` file of the repository ends with the cited path at a `/` boundary (`ir/expr.ts`,
 * `lower/calls.ts`, `types/compat.ts` all name a file by its tail, relative to whichever root the text speaks from).
 * A file an open task will CREATE resolves while it is planned (`PLANNED`, each named with its task), cited by its folder
 * and name (`semantics/memory.ts`), never by its bare name. An ERROR in
 * `bun run lint` (`--strict`) since task 1.9.3: a step that moves or deletes a file re-points every citation of it.
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

/**
 * The lines of a `tasks.md` that are a TICKED task's — its `- [x]` line and the indented lines under it. They are the
 * record of what the task did, written when the files it names existed: re-pointing "`emit.ts` deleted" at the file the
 * code went to would make the record say something false. An open task's lines are where the work is still to be done,
 * and are read like any other text.
 */
export function recordLines(lines: readonly string[]): Set<number> {
  const out = new Set<number>()
  let inRecord = false
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]!
    if (/^- \[x\] /.test(line)) inRecord = true
    else if (line.trim() !== "" && !/^\s/.test(line)) inRecord = false
    if (inRecord) out.add(k)
  }
  return out
}

/** Every citation in `text`, with the line it is on — in a `tasks.md`, outside its ticked tasks (`recordLines`). */
export function citationsIn(source: string, text: string): Citation[] {
  const out: Citation[] = []
  const lines = text.split("\n")
  const record = source.endsWith("tasks.md") ? recordLines(lines) : new Set<number>()
  for (let k = 0; k < lines.length; k++) {
    if (record.has(k)) continue
    for (const m of lines[k]!.matchAll(CITATION)) {
      const cited = m[1]!
      if (cited.endsWith(".d.ts")) continue
      out.push({ source, line: k + 1, cited })
    }
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

/**
 * THE FILES AN OPEN TASK WILL CREATE, repository-relative, each with the task that creates it. An open task names a file it
 * is to write ("`semantics/string.ts` new model plus `string.cases.ts`") before it exists; that is a plan, not a stale
 * citation. Named one by one, never inferred from the text; an entry whose file exists is stale and fails the check
 * (`stalePlanned`), so the list only holds what is still to come.
 */
export const PLANNED: Readonly<Record<string, string>> = {
  "packages/volt-lsp-iec/src/transpile/semantics/memory.ts": "transpile-restructure 4.4 (if model 3 chooses the byte arena)",
  "packages/volt-lsp-iec/src/transpile/semantics/builtins.test.ts": "transpile-restructure 6.7",
  "packages/volt-lsp-iec/src/transpile/emit/rust/precedence.ts": "transpile-restructure 7.3.8",
  "packages/volt-lsp-iec/src/network-text/index.ts": "lsp-package-structure (the network seam)",
  "packages/volt-cli/scripts/vendor-facts.ts": "vendor-fact-probe 2.3",
  "packages/volt-cli/scripts/vendor-facts.table.ts": "vendor-fact-probe 2.1",
}

/** Each planned file that already exists — its task wrote it, so its entry goes. */
export function stalePlanned(repo: string = REPO, planned: Readonly<Record<string, string>> = PLANNED): string[] {
  return Object.entries(planned)
    .filter(([path]) => existsSync(join(repo, path)))
    .map(([path, task]) => `${path} (${task}) exists — remove it from PLANNED`)
}

/** Every citation whose file neither exists nor is planned (`PLANNED`). */
export function missingCitations(pkg: string = PACKAGE, repo: string = REPO, planned: Readonly<Record<string, string>> = PLANNED): Citation[] {
  const existing = walk(repo, (n) => n.endsWith(".ts")).map((f) => slash(relative(repo, f)))
  const all = new Set([...existing, ...Object.keys(planned)])
  // a planned file resolves by a tail WITH its folder (`semantics/memory.ts`), never its bare name: a bare `memory.ts`
  // anywhere would otherwise resolve against a file that does not exist
  const tails = new Set([...tailsOf(existing), ...[...tailsOf(Object.keys(planned))].filter((t) => t.includes("/"))])
  const out: Citation[] = []
  for (const source of citingFiles(pkg, repo))
    for (const c of citationsIn(source, readFileSync(join(repo, source), "utf8")))
      if (!resolves(c.cited, all, tails)) out.push(c)
  return out
}

if (import.meta.main) {
  const strict = process.argv.includes("--strict")
  const stale = stalePlanned()
  for (const line of stale) console.error(`✗ citations: ${line}`)
  const missing = missingCitations()
  if (missing.length === 0) {
    console.log(`✓ citations: every cited .ts file exists (${Object.keys(PLANNED).length - stale.length} planned)`)
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
  }
  if (stale.length > 0 || (strict && missing.length > 0)) process.exit(1)
}
