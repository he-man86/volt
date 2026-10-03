// Refusal census (openspec bridge-refusal-review): every place packages/volt-cli/src refuses, one TSV row per site.
// Read-only.
//
//   bun packages/volt-cli/scripts/refusal-census.ts                    # the working tree
//   bun packages/volt-cli/scripts/refusal-census.ts --rev 0d1ae8aff0   # the tree at a commit (git show)
//
// A site is a `throw` (rethrows skipped), or a refusal that is not a throw: a network-text diagnostic
// (`Diag(ConflictCodes.X, …)` / `new NetworkTextDiagnostic(ConflictCodes.X, …)`), a conflict row built with a code
// (`Code = …Codes.X`), or a coded exception handed on without being thrown (`ConflictFor(op, new BridgeException(…))`).
//
// Columns: file (relative to src/), line, form (throw | diag | conflict | coded), exception (`new X` / helper), code
// (BridgeErrorCodes / ConflictCodes member or literal), message (the expression's string literals, joined,
// whitespace collapsed, 220 chars). Not a classifier: the category of each site lives in the proposal's table.
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const src = join(import.meta.dir, "..", "src")
const repo = join(import.meta.dir, "..", "..", "..")
const revIndex = process.argv.indexOf("--rev")
const rev = revIndex > 0 ? process.argv[revIndex + 1] : undefined

function files(): { path: string; text: string }[] {
  if (rev) {
    return execFileSync("git", ["ls-tree", "-r", "--name-only", rev, "packages/volt-cli/src"], { cwd: repo })
      .toString()
      .split("\n")
      .filter((f) => f.endsWith(".cs") && !/\/(bin|obj)\//.test(f))
      .map((f) => ({
        path: f.replace("packages/volt-cli/src/", ""),
        text: execFileSync("git", ["show", `${rev}:${f}`], { cwd: repo, maxBuffer: 1 << 26 }).toString(),
      }))
  }
  const out: { path: string; text: string }[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "bin" || name === "obj") continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith(".cs")) out.push({ path: relative(src, p).replaceAll("\\", "/"), text: readFileSync(p, "utf8") })
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

const rows: string[] = ["file\tline\tform\texception\tcode\tmessage"]
for (const { path, text } of files()) {
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
    const form = word === "throw" ? "throw" : word.startsWith("Code") ? "conflict" : word.startsWith("new") ? "coded" : "diag"
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
        : (expr.match(/^new\s+([\w.]+)/)?.[1] ?? expr.match(/^([\w.]+)\s*\(/)?.[1] ?? expr.split(/\s/)[0].slice(0, 40))
    const codes = [
      ...expr.matchAll(/(?:BridgeErrorCodes|ConflictCodes)\.(\w+)|"((?:NETWORK|STALE|ITEM)_[A-Z_]+|[A-Z]{3,}_[A-Z_]{3,})"/g),
    ].map((c) => c[1] ?? c[2])
    const message = [...(form === "conflict" ? (context.match(/Reason\s*=([^\n]*(?:\n[^\n=]*){0,3})/)?.[1] ?? "") : context).matchAll(/\$?@?"((?:[^"\\]|\\.)*)"/g)]
      .map((s) => s[1])
      .filter((s) => !/^[A-Z_]+$/.test(s))
      .join(" ")
      .replace(/\s+/g, " ")
      .slice(0, 220)
    rows.push([path, lineOf(pos), form, exception, [...new Set(codes)].join(","), message].join("\t"))
  }
}
console.log(rows.join("\n"))

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
