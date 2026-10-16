/**
 * THE BOUND DUMPS (0.3 / 0.4) — over a bound project, every name site's resolution, every expression's type and every
 * constant fold, one line each. One concern of `dumps.ts` (openspec lsp-same-standard 4.4).
 */
import { join, relative, isAbsolute } from "node:path"
import { bodyConditionWorld } from "../../src/frontend/symbols/index.js"
import { type BareName, isSfcStepBase, resolveBareName, resolveGlobalName } from "../../src/frontend/types/index.js"
import {
  type Expr,
  allUnits,
  unitBodies,
  isStBody,
  bodyStatements,
  sourceStatements,
} from "../../src/frontend/syntax/index.js"
import { type Scope, scopeForUnit, type Symbol, lookupMember } from "../../src/frontend/symbols/index.js"
import {
  resolveMemberChain,
  type CalleeInfo,
  resolveCallee,
  renderType,
  inferExprType,
  type ConstValue,
  constEval,
  constancyOf,
} from "../../src/frontend/types/index.js"
import { declExprs, statementExprs } from "./dumps-printer.js"
import { type Bound, at } from "./dumps.js"

/** Where an expression sits and the scope it resolves against — `undefined` when its unit binds no scope. */
export interface Site {
  where: "decl" | "body"
  expr: Expr
  scope: Scope | undefined
}

/**
 * Every maximal expression of a bound file with its scope: a declaration's resolves in its unit's scope, a body's in the
 * body's own (a property accessor's is a child of the unit's, keyed by span — as `symbols/scoped-bodies.ts` does). Namespace
 * members are entered, since they are code; a unit whose scope does not resolve still yields its sites, scope-less, so
 * the dump shows what the front-end cannot place rather than leaving it out.
 */
export function sites(b: Bound): Site[] {
  const out: Site[] = []
  for (const unit of allUnits(b.parsed.parseResult.units)) {
    // an ALIAS declares no scope of its own (`symbols` `scopeForUnit`): its initializer resolves where the alias does, in
    // the project as its own file sees it (rule DT1; `types/resolve` resolves the alias there)
    const alias = unit.kind === "type_decl" && unit.body.kind === "alias"
    const unitScope = scopeForUnit(b.project, unit) ?? (alias ? b.project : undefined)
    for (const expr of declExprs(unit)) out.push({ where: "decl", expr, scope: unitScope })
    for (const body of unitBodies(unit)) {
      if (!isStBody(body)) continue
      const scope = unitScope?.children.find((c) => c.span === body.span) ?? unitScope
      for (const expr of statementExprs(bodyStatements(body, bodyConditionWorld(b.project, unit, body)).statements)) out.push({ where: "body", expr, scope })
    }
  }
  return out
}

/**
 * The expressions `sites` cannot hold because a conditional pragma there asks what the world does not (a device fact,
 * a project compile define): written in a branch of an undecided chain (`BodyParse.refused`), so neither typed nor
 * resolved — COVERAGE the census does not have, counted so a fall in its UNKNOWNs is never read as an improvement
 * (frontend-conformance 2.7 review: the corpus UNKNOWN ceilings had been lowered on this shrunken denominator).
 */
export function undecidedExprCount(b: Bound): number {
  let n = 0
  for (const unit of allUnits(b.parsed.parseResult.units))
    for (const body of unitBodies(unit)) {
      if (!isStBody(body)) continue
      const compiled = bodyStatements(body, bodyConditionWorld(b.project, unit, body))
      if (compiled.refused === undefined) continue
      n += [...statementExprs(sourceStatements(body).statements)].length - [...statementExprs(compiled.statements)].length
    }
  return n
}

const PACKAGE_DIR = join(import.meta.dir, "..", "..")

/** A uri as a dump spells it: relative to the package when it is a path under it, else as written. */
export function uriId(uri: string): string {
  if (uri === "") return "(no uri)"
  if (uri.startsWith("file:")) return uri
  const r = relative(PACKAGE_DIR, uri)
  return (r.startsWith("..") || isAbsolute(r) ? uri : r).split("\\").join("/")
}

const describe = (s: Symbol): string => `${s.kind} ${s.owner.name}.${s.name} ${uriId(s.uri)}:${s.span.startLine}`

/** The dump's word for each compiler-provided name (`types/builtins` `builtinName`). */
const BUILTIN_WORD = { "system-operator": "system", conversion: "conversion", implicit: "implicit", operator: "builtin", type: "builtin" } as const

/**
 * What a BARE name binds to — the search order's answer (`types/names` `resolveBareName`, rule Y23), in the dump's words:
 * a declaration (a library namespace's included), a bare enum member, a device instance, a compiler-provided name,
 * NONE — `NONE ambiguous: …` for a member two enums declare (rule EN3).
 */
export function resolveBare(name: string, scope: Scope | undefined): string {
  if (scope === undefined) return "NOSCOPE"
  return bareWord(resolveBareName(scope, name))
}

function bareWord(answer: BareName): string {
  switch (answer.kind) {
    case "declared":
    case "library-namespace":
      return describe(answer.symbol)
    case "enum-member":
      return `enum-member ${describe(answer.symbol)}`
    case "device":
      return "device"
    case "builtin":
      return BUILTIN_WORD[answer.builtin]
    case "ambiguous":
      // it names nothing, as both vendors say ("Identifier not defined" beside "Ambiguous use of name"): NONE, with why
      return `NONE ambiguous: ${answer.candidates.map(describe).join(" | ")}`
    case "none":
      return "NONE"
  }
}

/**
 * EVERY IDENTIFIER OCCURRENCE → ITS DECLARATION (0.3). One line per occurrence, in walk order:
 *
 *   `<at> <name> -> <binding>`         a bare name (`resolveBare`)
 *   `<at> .<member> -> <binding>`      a member name, through `resolveMemberChain`; `%X0`/`%W1` partial access and a bit
 *                                      number (`x.3`) are named as such and are not looked up
 *   `<at> <param> := -> <binding>`     a named argument's parameter, through the callee `resolveCallee` finds
 *   `<at> (global) <name> -> <binding>` a `.name` (the global-namespace operator, rule E33), in the project scope only
 *
 * A STEP of an SFC chart read with a member (`S_Boot.x`, `PRG.S_Boot.x`) binds no declaration — the chart is not in the text
 * — and is `sfc-step`, the front-end's bet (`types/infer/sfc-step`, DIALECT D40); its member is SFCStepType's.
 */
export function resolutionDump(b: Bound): string[] {
  const out: string[] = []
  const member = (e: Extract<Expr, { kind: "member" }>, scope: Scope | undefined): string => {
    const name = e.member.name
    if (name.startsWith("%")) return "partial-access"
    if (/^\d+$/.test(name)) return "bit"
    if (scope === undefined) return "NOSCOPE"
    const sym = resolveMemberChain(e, scope, b.project)
    return sym === undefined ? "NONE" : describe(sym)
  }
  const param = (name: string, callee: CalleeInfo | undefined, scope: Scope | undefined): string => {
    if (scope === undefined) return "NOSCOPE"
    if (callee === undefined) return "NO-CALLEE"
    if (callee.paramNames.has(name.toLowerCase())) return `param ${callee.sym.name}.${name}`
    const sym = callee.scope === undefined ? undefined : lookupMember(callee.scope, name)
    return sym === undefined ? "NONE" : describe(sym)
  }
  const walk = (e: Expr, scope: Scope | undefined): void => {
    switch (e.kind) {
      case "ident_expr":
        out.push(`${at(e.span)} ${e.name} -> ${resolveBare(e.name, scope)}`)
        return
      case "literal":
        return
      case "member":
        if (scope !== undefined && isSfcStepBase(e, scope, b.project)) {
          if (e.base.kind === "ident_expr") out.push(`${at(e.base.span)} ${e.base.name} -> sfc-step`)
          else if (e.base.kind === "member") {
            walk(e.base.base, scope)
            out.push(`${at(e.base.member.span)} .${e.base.member.name} -> sfc-step`)
          }
        } else walk(e.base, scope)
        out.push(`${at(e.member.span)} .${e.member.name} -> ${member(e, scope)}`)
        return
      case "call": {
        walk(e.callee, scope)
        const callee = scope === undefined ? undefined : resolveCallee(e, scope, b.project)
        for (const a of e.args) {
          if (a.param !== undefined)
            out.push(
              `${at(a.param.span)} ${a.param.name} ${a.output ? "=>" : ":="} -> ${param(a.param.name, callee, scope)}`,
            )
          if (a.value !== undefined) walk(a.value, scope)
        }
        return
      }
      case "binary":
        walk(e.left, scope)
        walk(e.right, scope)
        return
      case "unary":
        walk(e.operand, scope)
        return
      case "index":
        walk(e.base, scope)
        for (const i of e.indices) walk(i, scope)
        return
      case "deref":
        walk(e.base, scope)
        return
      case "paren":
        walk(e.inner, scope)
        return
      case "assign_expr":
        walk(e.target, scope)
        walk(e.value, scope)
        return
      // `.name`, the global-namespace operator (rule E33): the name in the project scope only
      case "global_expr": {
        out.push(`${at(e.name.span)} (global) ${e.name.name} -> ${scope === undefined ? "NOSCOPE" : bareWord(resolveGlobalName(b.project, e.name.name))}`)
        return
      }
    }
  }
  for (const s of sites(b)) walk(s.expr, s.scope)
  return out
}

/** The immediate VALUE children of an expression: every child but a member's name, a callee (the call carries the
 *  type; what a method is reached through — `a` in `a.m()` — is a value) and a named argument's parameter. */
export function valueChildren(e: Expr): Expr[] {
  switch (e.kind) {
    case "member":
    case "deref":
      return [e.base]
    case "call":
      return [
        ...(e.callee.kind === "member" ? [e.callee.base] : []),
        ...e.args.flatMap((a) => (a.value === undefined ? [] : [a.value])),
      ]
    case "binary":
      return [e.left, e.right]
    case "unary":
      return [e.operand]
    case "index":
      return [e.base, ...e.indices]
    case "paren":
      return [e.inner]
    case "assign_expr":
      return [e.target, e.value]
    default:
      return []
  }
}

/** Every value position of an expression tree, pre-order. */
export function valueExprs(e: Expr): Expr[] {
  const out: Expr[] = [e]
  for (const c of valueChildren(e)) out.push(...valueExprs(c))
  return out
}

/** EVERY EXPRESSION → ITS INFERRED TYPE (0.4): `<at> <kind> <type>`, `?` for UNKNOWN, `NOSCOPE` where nothing binds. */
export function typeDump(b: Bound): string[] {
  return typeRows(b).map((r) => r.line)
}

/** `typeDump`, each line with the expression it was printed from — for a measure that asks more of the expression. */
export function typeRows(b: Bound): { expr: Expr; scope: Scope | undefined; line: string }[] {
  const out: { expr: Expr; scope: Scope | undefined; line: string }[] = []
  for (const s of sites(b)) {
    const values = valueExprs(s.expr)
    // a STEP of an SFC chart read with a member is an SFCStepType, which its own expression cannot say: no declaration in the
    // text types it, the member access is what evidences it (`types/infer/sfc-step`, DIALECT D40)
    const steps = new Set<Expr>()
    if (s.scope !== undefined) for (const e of values) if (e.kind === "member" && isSfcStepBase(e, s.scope, b.project)) steps.add(e.base)
    for (const e of values)
      out.push({
        expr: e,
        scope: s.scope,
        line: `${at(e.span)} ${e.kind} ${s.scope === undefined ? "NOSCOPE" : steps.has(e) ? "SFCStepType" : renderType(inferExprType(e, s.scope, b.project))}`,
      })
  }
  return out
}

/** A `constEval` value as a dump spells it: an integer bare, a real with an `r`, `∅` for no value. */
export function foldText(v: ConstValue): string {
  return v === undefined
    ? "∅"
    : typeof v === "bigint"
      ? `${v}`
      : typeof v === "boolean"
        ? v
          ? "TRUE"
          : "FALSE"
        : `${v}r`
}

/**
 * EVERY CONSTANT EXPRESSION → ITS `constEval` VALUE (0.4): each maximal expression a declaration holds (initializers,
 * bounds, lengths, enum values — `∅` where it does not fold), and each maximal sub-expression of a body that
 * `constancyOf` calls constant and that is more than a literal. `<at> <decl|body> <value>`.
 */
export function foldDump(b: Bound): string[] {
  const out: string[] = []
  for (const s of sites(b)) {
    const scope = s.scope
    if (scope === undefined) {
      out.push(`${at(s.expr.span)} ${s.where} NOSCOPE`)
      continue
    }
    if (s.where === "decl") {
      out.push(`${at(s.expr.span)} decl ${foldText(constEval(s.expr, scope))}`)
      continue
    }
    const visit = (e: Expr): void => {
      if (e.kind !== "literal" && constancyOf(e, scope) === "constant")
        out.push(`${at(e.span)} body ${foldText(constEval(e, scope))}`)
      else for (const c of valueChildren(e)) visit(c)
    }
    visit(s.expr)
  }
  return out
}
