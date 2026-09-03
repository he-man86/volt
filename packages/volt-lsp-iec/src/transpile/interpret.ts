/**
 * ST tree-walking interpreter — headless execution of a POU's scan logic.
 *
 * The point of the transpiler epic is *running* PLC logic off the IDE, not emitting Rust. Walking the AST we
 * already have gets there with no toolchain, no build step and no FFI, and it doubles as the semantic
 * reference an emitter is checked against later.
 *
 * Anything it cannot run throws `Unsupported` — an untestable POU is flagged, never silently wrong.
 *
 * ponytail: interpreter, not a compiler. Emit Rust (beside this file) only when scan-cycle count makes the
 * walk measurably too slow, or when the goal changes from "test it" to "ship it".
 */
import {
  parseSource,
  parseStatements,
  type Expr,
  type Statement,
  type StatementList,
  type TopLevel,
  type TypeExpr,
  type VarSection,
} from "../syntax/index.js"

export class Unsupported extends Error {}

/** A runtime value. Ints stay `bigint` (so `/` truncates like IEC does); REAL is `number`. */
export type Val = bigint | number | boolean | string

// ponytail: no INT/DINT width, so no wrap-around or overflow. Add a per-var width when a test needs it.
const K = (s: string) => s.toUpperCase()

// ─── expressions ─────────────────────────────────────────────────────────────

function num(v: Val): bigint | number {
  if (typeof v === "bigint" || typeof v === "number") return v
  throw new Unsupported(`expected a number, got ${typeof v}`)
}

function arith(op: string, a: Val, b: Val): Val {
  const l = num(a)
  const r = num(b)
  if (typeof l === "bigint" && typeof r === "bigint") {
    if ((op === "/" || op === "MOD") && r === 0n) throw new Error("division by zero")
    switch (op) {
      case "+":
        return l + r
      case "-":
        return l - r
      case "*":
        return l * r
      case "/":
        return l / r
      case "MOD":
        return l % r
      case "**":
        return l ** r
    }
  }
  const x = Number(l)
  const y = Number(r)
  switch (op) {
    case "+":
      return x + y
    case "-":
      return x - y
    case "*":
      return x * y
    case "/":
      return x / y
    case "MOD":
      return x % y
    case "**":
      return x ** y
  }
  throw new Unsupported(`operator ${op}`)
}

function eq(a: Val, b: Val): boolean {
  if (typeof a === "bigint" || typeof b === "bigint") {
    if (typeof a === "boolean" || typeof b === "boolean" || typeof a === "string" || typeof b === "string")
      return (a as unknown) === (b as unknown)
    return Number(a) === Number(b)
  }
  return a === b
}

function ord(op: string, a: Val, b: Val): boolean {
  const l = typeof a === "string" ? a : Number(num(a))
  const r = typeof b === "string" ? b : Number(num(b))
  switch (op) {
    case "<":
      return l < r
    case ">":
      return l > r
    case "<=":
      return l <= r
    case ">=":
      return l >= r
  }
  throw new Unsupported(`operator ${op}`)
}

function bool(v: Val): boolean {
  if (typeof v === "boolean") return v
  throw new Unsupported(`expected BOOL, got ${typeof v}`)
}

/** AND/OR/XOR — boolean on BOOLs, bitwise on ints (both are legal IEC). */
function logic(op: string, a: Val, b: Val): Val {
  if (typeof a === "bigint" && typeof b === "bigint") return op === "AND" ? a & b : op === "OR" ? a | b : a ^ b
  const l = bool(a)
  const r = bool(b)
  return op === "AND" ? l && r : op === "OR" ? l || r : l !== r
}

function evalExpr(e: Expr, env: Map<string, Val>): Val {
  switch (e.kind) {
    case "literal": {
      const v = e.value
      if (v === undefined) throw new Unsupported(`malformed literal ${e.text}`)
      if (typeof v === "object") return v.ns // duration → nanoseconds
      return v
    }
    case "ident_expr": {
      const v = env.get(K(e.name))
      if (v === undefined) throw new Unsupported(`unknown identifier ${e.name}`)
      return v
    }
    case "paren":
      return evalExpr(e.inner, env)
    case "unary":
      if (e.op === "NOT") {
        const v = evalExpr(e.operand, env)
        return typeof v === "bigint" ? ~v : !bool(v)
      }
      if (e.op === "-") return arith("-", 0n, evalExpr(e.operand, env))
      if (e.op === "+") return evalExpr(e.operand, env)
      throw new Unsupported(`unary ${e.op}`)
    case "binary": {
      const op = e.op
      if (op === "AND_THEN") return bool(evalExpr(e.left, env)) && bool(evalExpr(e.right, env))
      if (op === "OR_ELSE") return bool(evalExpr(e.left, env)) || bool(evalExpr(e.right, env))
      const l = evalExpr(e.left, env)
      const r = evalExpr(e.right, env)
      if (op === "=") return eq(l, r)
      if (op === "<>") return !eq(l, r)
      if (op === "<" || op === ">" || op === "<=" || op === ">=") return ord(op, l, r)
      if (op === "AND" || op === "&") return logic("AND", l, r)
      if (op === "OR") return logic("OR", l, r)
      if (op === "XOR") return logic("XOR", l, r)
      return arith(op, l, r)
    }
    default:
      throw new Unsupported(`expression ${e.kind}`)
  }
}

// ─── statements ──────────────────────────────────────────────────────────────

type Signal = "none" | "exit" | "continue" | "return"

const MAX_ITERATIONS = 1_000_000 // ponytail: a runaway loop is a bug in the POU; fail loud instead of hanging.

function assign(target: Expr, v: Val, env: Map<string, Val>): void {
  if (target.kind !== "ident_expr") throw new Unsupported(`assignment target ${target.kind}`)
  env.set(K(target.name), v)
}

function execList(list: StatementList, env: Map<string, Val>): Signal {
  for (const s of list) {
    const sig = exec(s, env)
    if (sig !== "none") return sig
  }
  return "none"
}

function exec(s: Statement, env: Map<string, Val>): Signal {
  switch (s.kind) {
    case "empty":
      return "none"
    case "assign":
      if (s.op !== undefined) throw new Unsupported(`assignment ${s.op}`)
      assign(s.target, evalExpr(s.value, env), env)
      return "none"
    case "if": {
      for (const b of s.branches) if (bool(evalExpr(b.cond, env))) return execList(b.body, env)
      return s.elseBody ? execList(s.elseBody, env) : "none"
    }
    case "case": {
      const sel = evalExpr(s.selector, env)
      for (const arm of s.arms)
        for (const lbl of arm.labels) {
          const lo = evalExpr(lbl.value, env)
          const hit =
            lbl.upper === undefined ? eq(sel, lo) : ord(">=", sel, lo) && ord("<=", sel, evalExpr(lbl.upper, env))
          if (hit) return execList(arm.body, env)
        }
      return s.elseBody ? execList(s.elseBody, env) : "none"
    }
    case "for": {
      const to = evalExpr(s.to, env)
      const by = s.by === undefined ? 1n : evalExpr(s.by, env)
      const up = Number(num(by)) >= 0
      assign(s.controlVar, evalExpr(s.from, env), env)
      for (let n = 0; ; n++) {
        if (n > MAX_ITERATIONS) throw new Error("FOR exceeded the iteration cap")
        if (!ord(up ? "<=" : ">=", evalExpr(s.controlVar, env), to)) break
        const sig = execList(s.body, env)
        if (sig === "exit") break
        if (sig === "return") return sig
        assign(s.controlVar, arith("+", evalExpr(s.controlVar, env), by), env)
      }
      return "none"
    }
    case "while":
      for (let n = 0; bool(evalExpr(s.cond, env)); n++) {
        if (n > MAX_ITERATIONS) throw new Error("WHILE exceeded the iteration cap")
        const sig = execList(s.body, env)
        if (sig === "exit") break
        if (sig === "return") return sig
      }
      return "none"
    case "repeat":
      for (let n = 0; ; n++) {
        if (n > MAX_ITERATIONS) throw new Error("REPEAT exceeded the iteration cap")
        const sig = execList(s.body, env)
        if (sig === "exit") break
        if (sig === "return") return sig
        if (bool(evalExpr(s.until, env))) break
      }
      return "none"
    case "exit":
      return "exit"
    case "continue":
      return "continue"
    case "return":
      return "return"
    default:
      throw new Unsupported(`statement ${s.kind}`)
  }
}

// ─── declarations ────────────────────────────────────────────────────────────

function defaultValue(t: TypeExpr): Val {
  if (t.kind === "string_type") return ""
  if (t.kind !== "named_type") throw new Unsupported(`variable of type ${t.kind}`)
  const n = K(t.name.text)
  if (n === "BOOL") return false
  if (n === "REAL" || n === "LREAL") return 0
  if (n === "STRING" || n === "WSTRING") return ""
  return 0n // every integer / time / bit-string type
}

function declareVars(sections: readonly VarSection[], env: Map<string, Val>): void {
  for (const sec of sections)
    for (const d of sec.decls) {
      if (d.init?.kind === "aggregate_init") throw new Unsupported("aggregate initializer")
      const init = d.init === undefined ? undefined : evalExpr(d.init, env)
      for (const name of d.names) env.set(K(name.text), init ?? defaultValue(d.type))
    }
}

// ─── the POU ─────────────────────────────────────────────────────────────────

export interface Pou {
  /** Live variable state, keyed by UPPERCASE name (ST is case-insensitive). */
  readonly vars: Map<string, Val>
  get(name: string): Val
  set(name: string, value: Val): void
  /** Run one scan cycle. */
  scan(): void
}

/** Parse `source` and prepare its PROGRAM/FUNCTION_BLOCK for execution. `name` picks one of several units. */
export function load(source: string, name?: string): Pou {
  const { units, errors } = parseSource(source)
  if (errors.length > 0) throw new Error(`parse error: ${errors[0]!.message}`)
  const runnable = (u: TopLevel) => u.kind === "program" || u.kind === "function_block"
  const unit = units.find((u) => runnable(u) && (name === undefined || K(u.name.text) === K(name)))
  if (unit === undefined || !(unit.kind === "program" || unit.kind === "function_block"))
    throw new Error(`no runnable POU${name === undefined ? "" : ` named ${name}`}`)

  const vars = new Map<string, Val>()
  declareVars(unit.varSections, vars)
  const parsed = parseStatements(unit.body)
  if (!parsed.ok) throw new Error(`body parse error: ${parsed.firstError}`)

  return {
    vars,
    get: (n) => {
      const v = vars.get(K(n))
      if (v === undefined) throw new Error(`no variable ${n}`)
      return v
    },
    set: (n, value) => {
      if (!vars.has(K(n))) throw new Error(`no variable ${n}`)
      vars.set(K(n), value)
    },
    // ponytail: VAR_TEMP is not re-initialized per scan. Add it when a POU under test relies on that.
    scan: () => void execList(parsed.statements, vars),
  }
}
