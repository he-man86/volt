// Refusal census (openspec bridge-refusal-review): every place packages/volt-cli/src refuses, one TSV row per site.
// Read-only.
//
//   bun packages/volt-cli/scripts/refusal-census.ts                    # the working tree
//   bun packages/volt-cli/scripts/refusal-census.ts --rev 0d1ae8aff0   # the tree at a commit (git show)
//   bun packages/volt-cli/scripts/refusal-census.ts --against 2d4a1a46f2   # sites gone / new since a commit
//
// `--against` compares by site, not by line: a site is its file, form, exception, code, message and the refusing
// expression with its whitespace removed (two `throw Err(code, msg)` whose code and message are both variables still
// differ by what they pass). A refusal moved or re-wrapped within its file is neither gone nor new; one moved to
// another file (or a renamed file) unchanged is listed as `moved`, not as gone plus new. Identical expressions in one
// file are a multiset: deleting one of two is a gone row. bridge-refusal-review's baseline is 2d4a1a46f2 (step 0);
// each step reports its refusals gone and new against it, and 6.3 classifies every new one.
//
// A site is a `throw` (rethrows skipped), or a refusal that is not a throw: a network-text diagnostic
// (`Diag(ConflictCodes.X, …)` / `new NetworkTextDiagnostic(ConflictCodes.X, …)`), a conflict row built with a code
// (`Code = …Codes.X`), or a coded exception handed on without being thrown (`ConflictFor(op, new BridgeException(…))`).
//
// Columns: file (relative to src/), line, form (throw | diag | conflict | coded), exception (`new X` / helper), code
// (BridgeErrorCodes / ConflictCodes member or literal), message (the expression's string literals, joined,
// whitespace collapsed, 220 chars), expression (the refusing expression, whitespace collapsed). Not a classifier: the category of each site lives in the proposal's table.
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const src = join(import.meta.dir, "..", "src")
const repo = join(import.meta.dir, "..", "..", "..")
function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i < 0) return undefined
  const v = process.argv[i + 1]
  if (!v || v.startsWith("--")) throw new Error(`${flag} needs a commit`)
  return v
}
function files(commit: string | undefined): { path: string; text: string }[] {
  if (commit) {
    return execFileSync("git", ["ls-tree", "-r", "--name-only", commit, "packages/volt-cli/src"], { cwd: repo })
      .toString()
      .split("\n")
      .filter((f) => f.endsWith(".cs") && !/\/(bin|obj)\//.test(f))
      .map((f) => ({
        path: f.replace("packages/volt-cli/src/", ""),
        text: execFileSync("git", ["show", `${commit}:${f}`], { cwd: repo, maxBuffer: 1 << 26 }).toString(),
      }))
  }
  const out: { path: string; text: string }[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "bin" || name === "obj") continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith(".cs"))
        out.push({ path: relative(src, p).replaceAll("\\", "/"), text: readFileSync(p, "utf8") })
    }
  }
  walk(src)
  return out
}

/** The expression from `start` to its `;` (or closing bracket) at depth 0, skipping string/char literals. */
function expressionAt(text: string, start: number): string {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'") {
      const verbatim = text[i - 1] === "@" || (text[i - 1] === "$" && text[i - 2] === "@")
      i++
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\" && !verbatim) i++
        i++
      }
      continue
    }
    if (c === "(" || c === "{" || c === "[") depth++
    else if (c === ")" || c === "}" || c === "]") depth--
    if ((c === ";" || c === ",") && depth <= 0) return text.slice(start, i)
    if (depth < 0) return text.slice(start, i)
  }
  return text.slice(start)
}

const pattern =
  /\bthrow\b|\b(?:Diag|NetworkTextDiagnostic)\s*\(\s*ConflictCodes\.|\bCode\s*=\s*(?=[^;]{0,120}(?:BridgeErrorCodes|ConflictCodes)\.)|\bnew BridgeException\s*\(/g

const header = "file\tline\tform\texception\tcode\tmessage\texpression"

/** One TSV row per refusal site in the tree at `commit` (the working tree when undefined). */
function census(commit: string | undefined): string[] {
  return censusOf(files(commit))
}

/** One TSV row per refusal site in `sources` (path relative to src/, C# text). */
export function censusOf(sources: { path: string; text: string }[]): string[] {
  const rows: string[] = []
  for (const { path, text } of sources) {
    const lineStarts = [0]
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1)
    const lineOf = (pos: number) => {
      let lo = 0
      let hi = lineStarts.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (lineStarts[mid] <= pos) lo = mid
        else hi = mid - 1
      }
      return lo + 1
    }
    let thrownUntil = -1
    for (const m of text.matchAll(pattern)) {
      const pos = m.index!
      const before = text.slice(lineStarts[lineOf(pos) - 1], pos)
      if (before.includes("//") || /^\s*\*/.test(before)) continue
      const word = m[0]
      const form =
        word === "throw" ? "throw" : word.startsWith("Code") ? "conflict" : word.startsWith("new") ? "coded" : "diag"
      if (form === "coded" && pos < thrownUntil) continue // the BridgeException a throw just counted
      // A throw's expression runs to its `;`; the others to the end of their argument (`,` at depth 0 for a Code =).
      const skip = form === "throw" ? 5 : form === "conflict" ? word.length : 0
      let expr = form === "throw" ? throwExpression(text, pos + skip) : expressionAt(text, pos + skip)
      expr = expr.trim()
      if (form === "throw") {
        if (expr === "" || /^[a-z_][A-Za-z0-9_]*$/.test(expr)) continue // rethrow
        thrownUntil = pos + 5 + expr.length + 2
      }
      // A conflict row's message is its Reason: read the object initializer around the Code.
      const context = form === "conflict" ? text.slice(Math.max(0, pos - 300), pos + 300) : expr
      const exception =
        form === "conflict"
          ? "PushConflict"
          : (expr.match(/^new\s+([\w.]+)/)?.[1] ??
            expr.match(/^([\w.]+)\s*\(/)?.[1] ??
            expr.split(/\s/)[0].slice(0, 40))
      const codes = [
        ...expr.matchAll(
          /(?:BridgeErrorCodes|ConflictCodes)\.(\w+)|"((?:NETWORK|STALE|ITEM)_[A-Z_]+|[A-Z]{3,}_[A-Z_]{3,})"/g,
        ),
      ].map((c) => c[1] ?? c[2])
      const message = [
        ...(form === "conflict"
          ? (context.match(/Reason\s*=([^\n]*(?:\n[^\n=]*){0,3})/)?.[1] ?? "")
          : context
        ).matchAll(/\$?@?"((?:[^"\\]|\\.)*)"/g),
      ]
        .map((s) => s[1])
        .filter((s) => !/^[A-Z_]+$/.test(s))
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 220)
      const expression = expr.replace(/\s+/g, " ")
      rows.push([path, lineOf(pos), form, exception, [...new Set(codes)].join(","), message, expression].join("\t"))
    }
  }
  return rows
}

/** A site without its line (and, for a move between files, without its file): the expression column loses its
 *  whitespace, so re-wrapping a refusal does not change it. */
function siteKey(row: string, withFile: boolean): string {
  const cols = row.split("\t")
  cols[6] = cols[6].replace(/\s+/g, "")
  return cols.filter((_, i) => i !== 1 && (withFile || i !== 0)).join("\t")
}

function tally(rows: string[], key: (row: string) => string): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r])
  return m
}

/** Rows of `x` beyond what `y` holds under the same key — a multiset, so two identical refusals count twice. */
function surplus(x: string[], y: string[], key: (row: string) => string): string[] {
  const ty = tally(y, key)
  return [...tally(x, key)].flatMap(([k, rows]) => rows.slice(ty.get(k)?.length ?? 0))
}

/** The sites gone from `before`, new in `now`, and moved unchanged to another file. A move within a file is none. */
export function compare(
  before: string[],
  now: string[],
): { gone: string[]; added: string[]; moved: { from: string; to: string }[] } {
  const inFile = (r: string) => siteKey(r, true)
  const anyFile = (r: string) => siteKey(r, false)
  const pool = tally(surplus(now, before, inFile), anyFile)
  const gone: string[] = []
  const moved: { from: string; to: string }[] = []
  for (const g of surplus(before, now, inFile)) {
    const to = pool.get(anyFile(g))?.shift()
    if (to) moved.push({ from: g, to })
    else gone.push(g)
  }
  return { gone, added: [...pool.values()].flat(), moved }
}

if (import.meta.main) {
  const rev = arg("--rev")
  const against = arg("--against")
  if (rev && against)
    throw new Error("--rev and --against are exclusive: --against compares the working tree with a commit")
  if (against) {
    const before = census(against)
    const now = census(undefined)
    const { gone, added, moved } = compare(before, now)
    console.log(
      `# against ${against}: ${before.length} sites then, ${now.length} now; ` +
        `${gone.length} gone, ${added.length} new, ${moved.length} moved to another file`,
    )
    console.log(["change", header, "from"].join("\t"))
    for (const r of gone) console.log(`gone\t${r}\t`)
    for (const r of added) console.log(`new\t${r}\t`)
    for (const m of moved) console.log(`moved\t${m.to}\t${m.from.split("\t").slice(0, 2).join(":")}`)
  } else {
    console.log([header, ...census(rev)].join("\n"))
  }
}

/** A throw's expression: to its `;` at depth 0 (commas inside a throw are arguments, not the end). */
function throwExpression(text: string, start: number): string {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'") {
      const verbatim = text[i - 1] === "@" || (text[i - 1] === "$" && text[i - 2] === "@")
      i++
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\" && !verbatim) i++
        i++
      }
      continue
    }
    if (c === "(" || c === "{" || c === "[") depth++
    else if (c === ")" || c === "}" || c === "]") depth--
    if (c === ";" && depth <= 0) return text.slice(start, i)
    if (depth < 0 || (c === "," && depth === 0)) return text.slice(start, i)
  }
  return text.slice(start)
}
