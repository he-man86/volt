/**
 * THE CENSUS'S FOLD CROSS-CHECK (0.4) — a variable a CODESYS run recorded that no body names still holds its initializer,
 * so where the initializer reads nothing the init step runs, the value its declaration folds to must be the recorded one.
 * One concern of `bound-census.ts` (openspec lsp-same-standard 4.4).
 */
import { declaredValue } from "../../src/frontend/types/index.js"
import {
  type Expr,
  decodeStringLiteral,
  elementaryType,
  type Scope,
  resolveMemberChain,
  type Symbol,
  lookup,
  rootOf,
} from "../../src/index.js"
import { tally } from "../baseline/baseline.js"
import { RUN, plcScope, pathExpr } from "./bound-census-runs.js"
import type { BoundCensus } from "./bound-census-untyped.js"
import { valueExprs, sites } from "./dumps-bound.js"
import type { Bound } from "./dumps.js"
import type { FixtureSources } from "./sources.js"

// ─── folds ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Every name a body of `files` mentions — a variable, a member, a parameter — lower-cased. */
function namesInBodies(files: readonly Bound[]): Set<string> {
  const out = new Set<string>()
  const add = (e: Expr): void => {
    switch (e.kind) {
      case "ident_expr":
        out.add(e.name.toLowerCase())
        return
      case "member":
        out.add(e.member.name.toLowerCase())
        return add(e.base)
      case "call":
        for (const a of e.args) if (a.param !== undefined) out.add(a.param.name.toLowerCase())
        break
    }
    for (const x of valueExprs(e).slice(1)) add(x)
    if (e.kind === "call") add(e.callee)
  }
  for (const b of files) for (const s of sites(b)) if (s.where === "body") add(s.expr)
  return out
}

/** A recorded value against a fold, or undefined when the value's type is not one a fold can be compared with. A string is
 *  printed as its literal (`'a$Tb'`, a WSTRING `"hel"`) and compared decoded. */
function sameValue(recorded: string, folded: bigint | number | boolean | string): boolean | undefined {
  const quoted = /^('|")(.*)\1$/s.exec(recorded)
  if (quoted !== null) return typeof folded === "string" ? decodeStringLiteral(quoted[2]!, quoted[1] === '"') === folded : undefined
  if (typeof folded === "string") return undefined
  const m = /^([A-Za-z_]+)#(.*)$/.exec(recorded)
  if (recorded === "TRUE" || recorded === "FALSE") {
    const b = typeof folded === "bigint" ? folded !== 0n : folded
    return b === (recorded === "TRUE")
  }
  if (m === null) return undefined
  const facts = elementaryType(m[1])
  if (facts === undefined) return undefined
  const text = m[2]
  if (facts.family === "int" || facts.family === "bitstring") {
    const based = /^(2|8|16)#([0-9A-Fa-f_]+)$/.exec(text)
    const digits = (based === null ? text : based[2]).replace(/_/g, "")
    const radix = based === null ? "" : based[1] === "2" ? "0b" : based[1] === "8" ? "0o" : "0x"
    const v = BigInt(`${radix}${digits}`)
    return typeof folded === "bigint"
      ? folded === v
      : typeof folded === "number"
        ? BigInt(Math.trunc(folded)) === v && Number.isInteger(folded)
        : undefined
  }
  if (facts.family === "real") {
    const r = Number(text)
    const v = typeof folded === "bigint" ? Number(folded) : typeof folded === "number" ? folded : undefined
    if (v === undefined) return undefined
    return facts.bits === 32 ? Math.fround(v) === Math.fround(r) : v === r
  }
  return undefined
}

/** Is every step before the last a declared variable with no initializer of its own (and no FB_Init arguments)? */
function throughPlainDeclarations(expr: Expr, scope: Scope, project: Scope): boolean {
  if (expr.kind === "ident_expr") return true
  if (expr.kind !== "member") return false
  const base = resolveMemberChain(expr.base, scope, project)?.ast
  if (base === undefined || base.kind !== "var_decl" || base.init !== undefined) return false
  if (base.type.kind === "named_type" && base.type.initArgs !== undefined) return false
  return throughPlainDeclarations(expr.base, scope, project)
}

export function crossCheckFolds(f: FixtureSources, plc: Bound, files: readonly Bound[], c: BoundCensus): void {
  const values = RUN[f.test.name]?.values
  if (values === undefined) return
  const scope = plcScope(plc)
  if (scope === undefined) return
  const named = namesInBodies(files)
  for (const [path, value] of Object.entries(values)) {
    tally(c.folds, "run: recorded values")
    const skip = (why: string): void => tally(c.folds, `run: not asked, ${why}`)
    const expr = pathExpr(path)
    if (expr === undefined) {
      skip("the path does not read as an expression")
      continue
    }
    const sym: Symbol | undefined = resolveMemberChain(expr, scope, plc.project)
    const decl = sym?.ast
    if (sym === undefined || decl === undefined) {
      skip("the path resolves to no declaration")
      continue
    }
    if (decl.kind !== "var_decl" || decl.init === undefined || decl.init.kind === "aggregate_init") {
      skip("the declaration holds no scalar initializer")
      continue
    }
    if (named.has(sym.name.toLowerCase())) {
      skip("a body names the variable")
      continue
    }
    // a value reached through a declaration that initializes it — `inst : FB(x := 1)`, `a : ARRAY… := [...]`, an
    // indexed element — is that declaration's, not the member's own initializer
    if (!throughPlainDeclarations(expr, scope, plc.project)) {
      skip("reached through an initializing declaration")
      continue
    }
    // NOT `constancyOf`: that is the fold's own verdict, and a filter by the code under test hid every initializer it called
    // undecidable (a built-in it does not fold, `LEN('abc')`) as "not asked" instead of "does not fold" (step 4d review)
    // `__POSITION()`'s text ('Line 5 (Decl)', `sysop_position_value`) is the IDE's line in its own object, which no fold
    // here computes
    if (decl.init.kind === "call" && decl.init.callee.kind === "ident_expr" && decl.init.callee.name.toUpperCase() === "__POSITION") {
      skip("__POSITION's text — niche: accepted loss (0 occurrences in the corpora)")
      continue
    }
    // A non-ASCII character TYPED into a STRING literal: which byte(s) CODESYS stores for it is not measured (the
    // transpiler's own `string-non-ascii` refuses it too), so no fold here can state the value. 0 STRING initializers in
    // the six corpora hold one (counted 2026-10-04); `ufeff_in_string` is the one recorded (bridge-refusal-review 7.4).
    if (decl.init.kind === "literal" && decl.init.literalKind === "string" && /[^\x00-\x7f]/.test(String(decl.init.value))) {
      skip("a non-ASCII character in a STRING literal, its stored bytes not measured — niche: accepted loss (0 occurrences in the corpora)")
      continue
    }
    if (readsRuntime(decl.init, sym.owner)) {
      skip("the initializer reads a variable, an element or a project function")
      continue
    }
    tally(c.folds, "run: recorded values still holding their initializer")
    const folded = declaredValue(sym)
    if (folded === undefined) {
      tally(c.folds, "run: initializer does not fold")
      // CODESYS has a value, the front-end none — a disagreement as much as a wrong value
      c.foldDisagreements.push(`${f.test.name}: ${path} is ${value}, the initializer does not fold`)
      continue
    }
    // a recorded ENUM value (`E.Run`) names a member, not a number: the only number for it here is the fold under test's
    // own (`E.B` folded is what `e : E := E.B` folds to), so a systematic error in member folding would still "match" —
    // not comparable until a recording gives the member's number independently (step 4d review 2)
    const same = sameValue(value, folded)
    if (same === undefined) tally(c.folds, "run: value not comparable with a fold")
    else if (same) tally(c.folds, "run: fold equals the recorded value")
    else
      c.foldDisagreements.push(
        `${f.test.name}: ${path} is ${value}, the initializer folds to ${typeof folded === "bigint" ? `${folded}` : String(folded)}`,
      )
  }
}

/** The symbol kinds that hold a value an initializer can read. */
const VALUE_KINDS: ReadonlySet<string> = new Set(["var", "gvl_var", "struct_field", "method_param"])

/**
 * Does an initializer read something only the init step can — a variable (not a CONSTANT), an element, a dereference, or a
 * call of a function the project declares? Asked of the AST and name resolution, never of the fold: what is left is what a
 * fold must answer, and one it does not is a finding.
 */
function readsRuntime(e: Expr, scope: Scope): boolean {
  const value = (sym: Symbol | undefined): boolean => sym !== undefined && sym.constant !== true && VALUE_KINDS.has(sym.kind)
  switch (e.kind) {
    case "literal":
      return false
    case "paren":
      return readsRuntime(e.inner, scope)
    case "unary":
      return readsRuntime(e.operand, scope)
    case "binary":
      return readsRuntime(e.left, scope) || readsRuntime(e.right, scope)
    case "ident_expr":
      return value(lookup(scope, e.name)?.symbol)
    case "member":
      return value(resolveMemberChain(e, scope, rootOf(scope)))
    case "call":
      return (
        (e.callee.kind === "ident_expr" && lookup(scope, e.callee.name) !== undefined) ||
        e.args.some((a) => a.value !== undefined && readsRuntime(a.value, scope))
      )
    default:
      return true
  }
}
