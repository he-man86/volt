#!/usr/bin/env bun
/**
 * The size ratchet, in `bun run lint`. Started for `src/transpile` (openspec transpile-restructure design.md P5, §8);
 * holds the whole package since openspec lsp-same-standard (design.md §5, task 1.1):
 *
 *   - every `.ts` file under `src/` and `test/` stays within its limit: a test file (`*.test.ts`) 600 lines, any other
 *     file 400; `test/conformance/fixtures/map.generated.ts` is exempt BY NAME (written by `rate:fixtures`, held by
 *     `map.test.ts`) — no folder is exempt, and no inline comment exempts a file;
 *   - every function outside a `*.test.ts` stays within 80 lines;
 *   - the files and functions over on the day the ratchet widened are CEILINGS at their size then (`CEILINGS`,
 *     `FUNCTION_CEILINGS`): one may not grow; a listed one that no longer exists or has come within its limit is a stale
 *     entry that fails until removed; one under its ceiling is reported with the number to lower the ceiling to (not a
 *     failure: the step that shrinks it lowers its entry). The lists only shrink — a new entry is not how a file or a
 *     function gets past its limit. Network text is marked "LD/FBD change": its ceilings stay until that change splits it.
 *
 * A line is a line of the file as an editor numbers them (`wc -l` for a file that ends in a newline).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const PACKAGE = resolve(import.meta.dir, "..")
/** The trees the ratchet covers, relative to the package. */
export const ROOTS: readonly string[] = ["src", "test"]
/** The one file exempt from the limit, by name. */
export const EXEMPT: ReadonlySet<string> = new Set(["test/conformance/fixtures/map.generated.ts"])
export const FILE_LIMIT = 400
export const TEST_LIMIT = 600
export const FUNCTION_LIMIT = 80

/**
 * The file ceilings, package-relative. Measured 2026-10-12 at fddcde2a6e (openspec lsp-same-standard design.md §1.1):
 * 19 `src/` files over 400, 3 colocated tests over 600, 4 `test/` suites over 600, 30 `test/` support and fixture-data
 * files over 400. Each later step of that change deleted its own entries; since task 4.5 only the network-text ones
 * ("LD/FBD change") remain, handed to the LD/FBD coverage change.
 */
export const CEILINGS: Readonly<Record<string, number>> = {
  "src/analysis/checks/network/network-analysis.ts": 521, // LD/FBD change
  "src/frontend/syntax/network/lexer.ts": 414, // LD/FBD change
  "src/frontend/syntax/network/parser.ts": 1367, // LD/FBD change
  "src/services/network/network.test.ts": 1213, // LD/FBD change
}

/**
 * The function ceilings, keyed `<package-relative file>#<name>` (`(anonymous)` for an unnamed arrow) — no line number,
 * which moves on every edit. Same day as `CEILINGS` (design.md §1.2): 31 then; since task 4.5 only the network-text three
 * ("LD/FBD change") remain, handed to the LD/FBD coverage change.
 */
export const FUNCTION_CEILINGS: Readonly<Record<string, number>> = {
  "src/frontend/syntax/network/lexer.ts#next": 95, // LD/FBD change
  "src/frontend/syntax/network/parser.ts#parseCall": 88, // LD/FBD change
}

const slash = (p: string): string => p.split("\\").join("/")

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "node_modules") continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith(".ts")) out.push(p)
  }
  return out
}

/** The line count an editor shows: a final newline does not start a line. */
export function lineCount(text: string): number {
  if (text.length === 0) return 0
  const lines = text.split("\n").length
  return text.endsWith("\n") ? lines - 1 : lines
}

export interface LongFunction {
  file: string
  name: string
  line: number
  lines: number
}

const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "yield", "await"])

/**
 * `text` with every comment, string, template text and regular-expression literal blanked to spaces (newlines kept), so
 * a brace or a paren left in it is code. (The package's TypeScript is the native 7.x compiler, which has no JS API.)
 */
export function codeOnly(text: string): string {
  const out = text.split("")
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "
  }
  /** The brace depth at each open `${`: the `}` that returns to it resumes the template. */
  const substitutions: number[] = []
  let depth = 0
  let prev = "" // the last significant code character: a `/` after an operator starts a regex, after a value divides
  let prevWord = ""
  const n = text.length
  /** A template's text from `from` (after a backtick or a substitution's `}`): the index to resume code at. */
  const templateText = (from: number): number => {
    let j = from
    while (j < n) {
      const c = text[j]!
      if (c === "\\") j += 2
      else if (c === "`") {
        blank(from, j)
        prev = "`"
        return j + 1
      } else if (c === "$" && text[j + 1] === "{") {
        blank(from, j)
        substitutions.push(depth)
        depth += 1
        prev = "{"
        return j + 2
      } else j += 1
    }
    blank(from, n)
    return n
  }
  let i = 0
  while (i < n) {
    const c = text[i]!
    const d = text[i + 1]
    if (c === "/" && d === "/") {
      const e = text.indexOf("\n", i)
      const stop = e < 0 ? n : e
      blank(i, stop)
      i = stop
    } else if (c === "/" && d === "*") {
      const e = text.indexOf("*/", i + 2)
      const stop = e < 0 ? n : e + 2
      blank(i, stop)
      i = stop
    } else if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1
      blank(i + 1, j)
      i = j + 1
      prev = c
    } else if (c === "`") {
      i = templateText(i + 1)
    } else if (c === "/" && (prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev) || REGEX_AFTER_WORD.has(prevWord))) {
      let j = i + 1
      let inClass = false
      while (j < n && text[j] !== "\n") {
        const r = text[j]!
        if (r === "\\") j += 2
        else if (r === "[") (inClass = true), (j += 1)
        else if (r === "]") (inClass = false), (j += 1)
        else if (r === "/" && !inClass) break
        else j += 1
      }
      blank(i + 1, j)
      i = j + 1
      while (i < n && /[a-z]/.test(text[i]!)) i += 1
      prev = "/"
      prevWord = ""
    } else if (/\s/.test(c)) {
      i += 1
    } else if (/[\w$]/.test(c)) {
      let j = i
      while (j < n && /[\w$]/.test(text[j]!)) j += 1
      prevWord = text.slice(i, j)
      prev = "a"
      i = j
    } else {
      prevWord = ""
      prev = c
      if (c === "{") depth += 1
      else if (c === "}") {
        depth -= 1
        if (substitutions.length > 0 && substitutions[substitutions.length - 1] === depth) {
          substitutions.pop()
          i = templateText(i + 1)
          continue
        }
      }
      i += 1
    }
  }
  return out.join("")
}

const NOT_A_METHOD = new Set(["if", "for", "while", "switch", "catch", "function", "return", "with", "typeof", "new", "await"])

/** Every function (declaration, method, accessor, arrow or expression) in `text` longer than `limit` lines. */
export function longFunctions(file: string, text: string, limit = FUNCTION_LIMIT): LongFunction[] {
  const code = codeOnly(text)
  const lineAt: number[] = []
  let line = 0
  for (let k = 0; k < code.length; k++) {
    lineAt.push(line)
    if (code[k] === "\n") line += 1
  }
  const match = (open: number, o: string, c: string): number => {
    let d = 0
    for (let k = open; k < code.length; k++) {
      if (code[k] === o) d += 1
      else if (code[k] === c && --d === 0) return k
    }
    return -1
  }
  const skipWs = (k: number): number => {
    while (k < code.length && /\s/.test(code[k]!)) k += 1
    return k
  }
  /** After a parameter list's `)`: skip a return type, and answer the body's `{` (or -1: not a function). */
  const bodyAfter = (close: number): number => {
    let k = skipWs(close + 1)
    if (code[k] !== ":") return code[k] === "{" ? k : -1
    let expectType = true
    k += 1
    while (k < code.length) {
      k = skipWs(k)
      const c = code[k]
      // …or a `}` — the block around a SIGNATURE closing (an interface's member): no function header meets one before its body
      if (c === undefined || c === ";" || c === "}" || (c === "=" && code[k + 1] !== ">")) return -1
      if (c === "{") {
        if (!expectType) return k
        const close2 = match(k, "{", "}")
        if (close2 < 0) return -1
        k = close2 + 1
        expectType = false
      } else if (c === "(" || c === "[" || c === "<") {
        const close2 = match(k, c, c === "(" ? ")" : c === "[" ? "]" : ">")
        if (close2 < 0) return -1
        k = close2 + 1
        expectType = false
      } else if (c === "|" || c === "&" || c === "," || c === ":" || c === "?") {
        expectType = true
        k += 1
      } else if (c === "=" && code[k + 1] === ">") {
        expectType = true
        k += 2
      } else {
        expectType = false
        k += 1
      }
    }
    return -1
  }
  const found = new Map<number, LongFunction>() // keyed by the body's `{`
  const add = (headAt: number, body: number, name: string): void => {
    if (body < 0 || found.has(body)) return
    const end = match(body, "{", "}")
    if (end < 0) return
    const lines = lineAt[end]! - lineAt[headAt]! + 1
    if (lines > limit) found.set(body, { file, name, line: lineAt[headAt]! + 1, lines })
  }
  // `function name(…)` and `function (…)`
  for (const m of code.matchAll(/\bfunction\b\s*\*?\s*([\w$]*)\s*(<[^>(]*>)?\s*\(/g)) {
    const open = m.index + m[0].length - 1
    const close = match(open, "(", ")")
    if (close >= 0) add(m.index, bodyAfter(close), m[1] || "(anonymous)")
  }
  // methods, accessors and constructors: `name(…) {` at the start of a member
  const member =
    /(^|[;{}\n])[ \t]*(?:(?:public|private|protected|static|async|readonly|override|get|set)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*(<[^>(]*>)?\s*\(/g
  for (const m of code.matchAll(member)) {
    if (NOT_A_METHOD.has(m[2]!)) continue
    const open = m.index + m[0].length - 1
    const close = match(open, "(", ")")
    if (close >= 0) add(m.index + m[1]!.length, bodyAfter(close), m[2]!)
  }
  // arrows with a block body: `(…) => {` and `x => {`
  for (const m of code.matchAll(/=>\s*\{/g)) {
    const body = m.index + m[0].length - 1
    let k = m.index - 1
    while (k >= 0 && /\s/.test(code[k]!)) k -= 1
    let head = m.index
    if (code[k] === ")") {
      let d = 0
      for (let j = k; j >= 0; j--) {
        if (code[j] === ")") d += 1
        else if (code[j] === "(" && --d === 0) {
          head = j
          break
        }
      }
    } else if (k >= 0 && /[\w$]/.test(code[k]!)) {
      while (k > 0 && /[\w$]/.test(code[k - 1]!)) k -= 1
      head = k
    }
    const before = code.slice(Math.max(0, head - 200), head)
    const named = /([A-Za-z_$][\w$]*)\s*(?::[^=]*)?[=:]\s*(?:async\s*)?$/.exec(before)
    add(head, body, named?.[1] ?? "(anonymous)")
  }
  return [...found.values()].sort((a, b) => a.line - b.line)
}

export interface SizeReport {
  /** Failures: a file or function over its limit with no ceiling, over its ceiling, or a stale ceiling. */
  errors: string[]
  /** A listed file or function under its ceiling: the number to lower it to. */
  lower: string[]
}

/** One shrink-only list against what was measured (`over`: every key over its limit in the tree, with its size). */
function ratchet(
  over: ReadonlyMap<string, { size: number; limit: number }>,
  ceilings: Readonly<Record<string, number>>,
  label: (key: string) => string,
  errors: string[],
  lower: string[],
): void {
  for (const key of [...over.keys()].sort()) {
    const { size, limit } = over.get(key)!
    const ceiling = ceilings[key]
    if (ceiling === undefined) errors.push(`${label(key)}: ${size} lines is over the ${limit}-line limit (new — split it)`)
    else if (size > ceiling) errors.push(`${label(key)}: ${size} lines is over its ceiling of ${ceiling} (the ceilings only fall)`)
    else if (size < ceiling) lower.push(`${label(key)}: ${size} lines — lower its ceiling from ${ceiling} to ${size}`)
  }
  for (const key of Object.keys(ceilings).sort())
    if (!over.has(key)) errors.push(`${label(key)}: listed with a ceiling but within its limit or gone — remove its ceiling`)
}

/**
 * The ratchet over `pkg`'s `src/` and `test/` against the file and the function ceilings (all three overridable, so the
 * tests plant a scratch tree).
 */
export function sizeReport(
  pkg: string = PACKAGE,
  ceilings: Readonly<Record<string, number>> = CEILINGS,
  functionCeilings: Readonly<Record<string, number>> = FUNCTION_CEILINGS,
): SizeReport {
  const errors: string[] = []
  const lower: string[] = []
  const files = new Map<string, { size: number; limit: number }>()
  const functions = new Map<string, { size: number; limit: number }>()
  for (const root of ROOTS)
    for (const file of walk(join(pkg, root)).sort()) {
      const rel = slash(relative(pkg, file))
      if (EXEMPT.has(rel)) continue
      const text = readFileSync(file, "utf8")
      const isTest = rel.endsWith(".test.ts")
      const limit = isTest ? TEST_LIMIT : FILE_LIMIT
      const lines = lineCount(text)
      if (lines > limit) files.set(rel, { size: lines, limit })
      if (isTest) continue
      for (const f of longFunctions(rel, text)) {
        const key = `${rel}#${f.name}`
        if (functions.has(key)) errors.push(`function ${key}: two functions over ${FUNCTION_LIMIT} lines share this key — name one`)
        functions.set(key, { size: Math.max(f.lines, functions.get(key)?.size ?? 0), limit: FUNCTION_LIMIT })
      }
    }
  ratchet(files, ceilings, (k) => k, errors, lower)
  ratchet(functions, functionCeilings, (k) => `function ${k}`, errors, lower)
  return { errors, lower }
}

if (import.meta.main) {
  const { errors, lower } = sizeReport()
  for (const l of lower) console.warn(`! size: ${l}`)
  if (errors.length > 0) {
    console.error(`✗ size: ${errors.length} violation(s)`)
    for (const e of errors) console.error(`  ${e}`)
    process.exit(1)
  }
  console.log(
    `✓ size: every src/ and test/ file within ${FILE_LIMIT} lines (tests ${TEST_LIMIT}) and every function within ` +
      `${FUNCTION_LIMIT}, or its ceiling (${Object.keys(CEILINGS).length} files, ${Object.keys(FUNCTION_CEILINGS).length} functions listed)`,
  )
}
