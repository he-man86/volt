#!/usr/bin/env bun
/**
 * The size ratchet (openspec transpile-restructure design.md P5, §8; task 1.0.2), in `bun run lint`.
 *
 *   - a `src/transpile/**` file stays at 400 lines or less, a test file at 600 or less;
 *   - the files that were over on the day the ratchet started are CEILINGS at their line count then: one may not grow,
 *     and a listed file that no longer exists, or has come under its limit, is a stale entry that fails until removed —
 *     the list only shrinks (it is empty at task 1.9.4);
 *   - a file under its ceiling is reported with the number to lower the ceiling to (not a failure: the step that shrinks
 *     a file lowers its entry);
 *   - functions longer than 80 lines are printed as a WARNING list (it must be empty at 1.9.4).
 *
 * A line is a line of the file as an editor numbers them (`wc -l` for a file that ends in a newline).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const PACKAGE = resolve(import.meta.dir, "..")
/** The tree the ratchet covers, relative to the package. */
export const SCOPE = "src/transpile"
export const FILE_LIMIT = 400
export const TEST_LIMIT = 600
export const FUNCTION_LIMIT = 80

/**
 * The ceilings, relative to `src/transpile/`. Measured 2026-10-07 (at fd0865a913): design.md's twelve of 2026-09-29, at
 * their line counts today, plus two that grew past 400 since — `lower/statements.ts` and `interp/interp.ts`.
 */
export const CEILINGS: Readonly<Record<string, number>> = {
  "lower/calls.ts": 1657,
  "lower/lower.ts": 857,
  "lower/storage.ts": 655,
  "lower/pointers.ts": 542,
  "lower/builtins.ts": 490,
  "lower/interfaces.ts": 480,
  "lower/statements.ts": 437,
  "lower/lower.test.ts": 2645,
  "emit/rust/emit.test.ts": 969,
}

const slash = (p: string): string => p.split("\\").join("/")

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
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
      if (c === undefined || c === ";" || (c === "=" && code[k + 1] !== ">")) return -1
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
  /** Failures: a file over its limit with no ceiling, a file over its ceiling, a stale ceiling. */
  errors: string[]
  /** A listed file under its ceiling: the number to lower it to. */
  lower: string[]
  /** Functions over the limit (warning). */
  functions: LongFunction[]
}

/** The ratchet over `pkg`'s `src/transpile/` against `ceilings` (both overridable so the tests plant a scratch tree). */
export function sizeReport(pkg: string = PACKAGE, ceilings: Readonly<Record<string, number>> = CEILINGS): SizeReport {
  const root = join(pkg, SCOPE)
  const errors: string[] = []
  const lower: string[] = []
  const functions: LongFunction[] = []
  const seen = new Set<string>()
  for (const file of walk(root).sort()) {
    const rel = slash(relative(root, file))
    const text = readFileSync(file, "utf8")
    const lines = lineCount(text)
    const limit = rel.endsWith(".test.ts") ? TEST_LIMIT : FILE_LIMIT
    const ceiling = ceilings[rel]
    if (ceiling !== undefined) {
      seen.add(rel)
      if (lines <= limit) errors.push(`${SCOPE}/${rel}: ${lines} lines is within the ${limit}-line limit — remove its ceiling`)
      else if (lines > ceiling) errors.push(`${SCOPE}/${rel}: ${lines} lines is over its ceiling of ${ceiling} (the ceilings only fall)`)
      else if (lines < ceiling) lower.push(`${SCOPE}/${rel}: ${lines} lines — lower its ceiling from ${ceiling} to ${lines}`)
    } else if (lines > limit) {
      errors.push(`${SCOPE}/${rel}: ${lines} lines is over the ${limit}-line limit (a new oversize file)`)
    }
    if (!rel.endsWith(".test.ts")) functions.push(...longFunctions(`${SCOPE}/${rel}`, text))
  }
  for (const rel of Object.keys(ceilings).sort())
    if (!seen.has(rel)) errors.push(`${SCOPE}/${rel}: listed with a ceiling but does not exist — remove its ceiling`)
  return { errors, lower, functions }
}

if (import.meta.main) {
  const { errors, lower, functions } = sizeReport()
  if (functions.length > 0) {
    console.warn(`! size: ${functions.length} function(s) over ${FUNCTION_LIMIT} lines (split before 1.9.4):`)
    for (const f of [...functions].sort((a, b) => b.lines - a.lines))
      console.warn(`  ${String(f.lines).padStart(4)}  ${f.file}:${f.line} ${f.name}`)
  }
  for (const l of lower) console.warn(`! size: ${l}`)
  if (errors.length > 0) {
    console.error(`✗ size: ${errors.length} violation(s)`)
    for (const e of errors) console.error(`  ${e}`)
    process.exit(1)
  }
  console.log(
    `✓ size: every ${SCOPE} file within ${FILE_LIMIT} lines (tests ${TEST_LIMIT}) or its ceiling (${Object.keys(CEILINGS).length} listed)`,
  )
}
