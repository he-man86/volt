/**
 * ONE WALK OF EVERYTHING BOUND, EVERY BOUND QUESTION ASKED OF IT — the measurements behind 0.3 (resolution) and 0.4
 * (types, folds), computed once per process and read by `resolution-dump.test.ts`, `type-dump.test.ts` and
 * `fold-dump.test.ts` (test/README.md: one walk per input).
 *
 * Each group is summarized as counts, and what a recording can decide is cross-checked against it:
 *
 *   types   a build message that names a type — "Cannot convert type 'X' to type 'Y'", the two sign-change
 *           warnings, the loss-of-information warning — is explained by a store (an assignment, an initializer, a call
 *           argument, an operand) whose target the front-end types Y and whose value it types X, each store explaining
 *           ONE copy of a message (the recordings carry no position, so the count is all there is to hold); the other
 *           way, every store the front-end types as not implicitly convertible (`classifyConversion` "incompatible")
 *           must be matched by a recorded "Cannot convert" for it; and every path a CODESYS run recorded, read as an
 *           expression in PLC_PRG, must infer the type its value is printed as;
 *   folds   a variable a run recorded that no body of its fixture names still holds its initializer, so `constEval` of
 *           that initializer must equal the recorded value — every recorded value this cannot be asked of is counted by
 *           why, so the values the check sees plus the ones it does not add up to every recorded value.
 *
 * Fixtures are bound and measured once per vendor, each against that vendor's build recording; the run recording is
 * CODESYS's alone, so the run cross-checks (types and folds) are CODESYS-bound.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  allUnits,
  isStBody,
  lex,
  isTrivia,
  parseExprFromTokens,
  parseStatements,
  unitBodies,
  walkStatements,
  exprText,
  type Expr,
  type TopLevel,
} from "../../src/frontend/syntax/index.js"
import { scopeForUnit, type Scope, type Symbol } from "../../src/frontend/symbols/index.js"
import {
  checkedMeetType,
  classifyConversion,
  constEval,
  elementaryType,
  inferExprType,
  literalCheckType,
  literalErrorType,
  renderType,
  resolveCallee,
  resolveMemberChain,
  resolveTypeExpr,
  type Type,
} from "../../src/frontend/types/index.js"
import { tally } from "./baseline.js"
import { boundCorpus, boundLibrary, withBoundFixture } from "./bound.js"
import { foldDump, resolutionDump, sites, typeDump, valueExprs, type Bound } from "./dumps.js"
import { corpusProjects, fixtureSources, isLibraryManagerFile, type FixtureSources } from "./sources.js"
import type { Dialect } from "../../src/frontend/syntax/index.js"

export interface BoundCensus {
  resolution: Record<string, number>
  /** Every fixture occurrence that binds to nothing — few enough to pin one by one. */
  fixtureUnresolved: string[]
  types: Record<string, number>
  typeDisagreements: string[]
  folds: Record<string, number>
  foldDisagreements: string[]
}

const RUN = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "conformance", "recordings", "codesys.run.json"), "utf8"),
).tests as Record<string, { values?: Record<string, string> }>

let cached: BoundCensus | undefined

export function boundCensus(): BoundCensus {
  if (cached !== undefined) return cached
  const c: BoundCensus = {
    resolution: {},
    fixtureUnresolved: [],
    types: {},
    typeDisagreements: [],
    folds: {},
    foldDisagreements: [],
  }
  const summarize = (group: string, b: Bound, pin: string | undefined): void => {
    for (const line of resolutionDump(b)) {
      const [lhs, binding] = line.split(" -> ") as [string, string]
      const name = lhs.slice(lhs.indexOf(" ") + 1)
      const shape = name.startsWith(".") ? "member" : / (:=|=>)$/.test(name) ? "parameter" : "bare name"
      const verdict = binding === "NONE" || binding === "NOSCOPE" || binding === "NO-CALLEE" ? binding : "resolved"
      tally(c.resolution, `${group}: ${shape} ${verdict}`)
      if (pin !== undefined && verdict !== "resolved") c.fixtureUnresolved.push(`${pin}${b.parsed.id} ${line}`)
    }
    for (const line of typeDump(b)) {
      const [, kind, ...rest] = line.split(" ")
      const type = rest.join(" ")
      tally(c.types, `${group}: expressions`)
      if (type === "?" || type === "NOSCOPE")
        tally(c.types, `${group}: ${kind} ${type === "?" ? "UNKNOWN" : "NOSCOPE"}`)
    }
    for (const line of foldDump(b)) {
      const [, where, value] = line.split(" ")
      tally(
        c.folds,
        `${group}: ${where} ${value === "∅" ? "does not fold" : value === "NOSCOPE" ? "NOSCOPE" : "folds"}`,
      )
    }
  }

  for (const project of corpusProjects())
    for (const b of boundCorpus(project))
      summarize(isLibraryManagerFile(b.parsed.id) ? "corpus Library Manager" : "corpus", b, undefined)

  for (const vendor of ["codesys", "twincat"] as const)
    for (const f of fixtureSources())
      withBoundFixture(f, vendor, (own, plc, deps) => {
        summarize(`fixtures ${vendor}`, own, `${vendor} `)
        summarize(`fixtures ${vendor}`, plc, `${vendor} `)
        crossCheckBuildTypes(f, vendor, [own, plc], c)
        if (vendor === "codesys") {
          crossCheckRunTypes(f, plc, c)
          crossCheckFolds(f, plc, [own, plc, ...deps], c)
        }
      })

  for (const b of boundLibrary()) summarize("library", b, "")
  cached = c
  return c
}

// ─── types ───────────────────────────────────────────────────────────────────────────────────────────────────

const TYPE_MESSAGES: readonly RegExp[] = [
  /^Cannot convert type '(.+)' to type '(.+)'$/,
  /^Implicit conversion from (?:un)?signed Type '(.+)' to (?:un)?signed Type '(.+)' : Possible change of sign$/,
  /^Implicit conversion from '(.+)' to '(.+)': Possible loss of information$/,
]

const COMPARISONS: ReadonlySet<string> = new Set(["=", "<>", "<", ">", "<=", ">="])

const typeKey = (t: string): string => t.toUpperCase().replace(/\s+/g, "")

/** A store the front-end types: the target's type, and every type its value may be checked as. */
interface Store {
  target: string
  value: Set<string>
  /** How the front-end converts the value's inferred type into the target's. */
  conversion: ReturnType<typeof classifyConversion>
  /** The two types as printed, for a finding. */
  printed: string
}

function storesOf(b: Bound): Store[] {
  const out: Store[] = []
  const store = (target: Type, value: Expr, scope: Scope): void => {
    const inferred = inferExprType(value, scope, b.project)
    const as = new Set([typeKey(renderType(inferred))])
    for (const t of [literalErrorType(value, target), literalCheckType(value, target)])
      if (t !== undefined) as.add(typeKey(renderType(t)))
    // CODESYS names an expression it cannot type by its text: "Cannot convert type 'Unknown type: 'x'' to type 'INT'"
    if (inferred.kind === "unknown") as.add(typeKey(`Unknown type: '${exprText(value)}'`))
    out.push({
      target: typeKey(renderType(target)),
      value: as,
      conversion: classifyConversion(target, inferred),
      printed: `${renderType(inferred)} → ${renderType(target)}`,
    })
  }
  /** Stores inside an expression: an operand converts to the type of its operator — for a comparison, whose BOOL is not
   *  what its operands convert to, to the two operands' checked meet — and an input argument to its parameter's type. */
  const inner = (e: Expr, scope: Scope): void => {
    for (const x of valueExprs(e)) {
      if (x.kind === "unary") store(inferExprType(x, scope, b.project), x.operand, scope)
      if (x.kind === "binary") {
        const result = COMPARISONS.has(x.op)
          ? checkedMeetType(inferExprType(x.left, scope, b.project), inferExprType(x.right, scope, b.project))
          : inferExprType(x, scope, b.project)
        if (result !== undefined) {
          store(result, x.left, scope)
          store(result, x.right, scope)
        }
      }
      if (x.kind !== "call") continue
      const callee = resolveCallee(x, scope, b.project)
      if (callee === undefined) continue
      x.args.forEach((a, i) => {
        if (a.value === undefined || a.output) return
        const param =
          a.param === undefined
            ? callee.positional[i]
            : callee.positional.find((p) => p.name.text.toLowerCase() === a.param!.name.toLowerCase())
        if (param !== undefined)
          store(resolveTypeExpr(param.type, b.project, 0, b.project, callee.sym.uri), a.value, scope)
      })
    }
  }
  const visit = (units: readonly TopLevel[]): void => {
    for (const unit of allUnits(units)) {
      const scope = scopeForUnit(b.project, unit)
      if (scope === undefined) continue
      if ("varSections" in unit)
        for (const section of unit.varSections)
          for (const decl of section.decls)
            if (decl.init !== undefined && decl.init.kind !== "aggregate_init" && decl.initOp === undefined)
              store(resolveTypeExpr(decl.type, b.project, 0, scope), decl.init, scope)
      for (const body of unitBodies(unit)) {
        if (!isStBody(body)) continue
        const bodyScope = scope.children.find((s) => s.span === body.span) ?? scope
        walkStatements(parseStatements(body).statements, (s) => {
          if (s.kind === "assign" && s.op === undefined && s.chained === undefined)
            store(inferExprType(s.target, bodyScope, b.project), s.value, bodyScope)
        })
      }
    }
  }
  visit(b.parsed.parseResult.units)
  for (const s of sites(b)) if (s.scope !== undefined) inner(s.expr, s.scope)
  return out
}

/** The type a recorded run value is printed as, or undefined when its text does not say. */
function recordedType(value: string): string | undefined {
  const prefixed = /^([A-Za-z_]+)#/.exec(value)
  if (prefixed !== null) return prefixed[1]
  if (value.startsWith("'")) return "STRING"
  if (value.startsWith('"')) return "WSTRING"
  if (value === "TRUE" || value === "FALSE") return "BOOL"
  const enumValue = /^([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z_][A-Za-z0-9_]*$/.exec(value)
  return enumValue === null ? undefined : enumValue[1]
}

/** Does an inferred type print as the recorded one? A string's capacity is not in a printed value; a BIT reads as a BOOL;
 *  an inline enum is `(implicit)` to the front-end and `Implicit_Enum__<POU>` to CODESYS. */
function sameType(recorded: string, inferred: string): boolean {
  const r = typeKey(recorded)
  const i = typeKey(inferred).replace(/\(\d+\)$/, "")
  if (r === "BOOL") return i === "BOOL" || i === "BIT"
  if (r.startsWith("IMPLICIT_ENUM__")) return i === "(IMPLICIT)"
  return r === i
}

const pathExpr = (path: string): Expr | undefined =>
  parseExprFromTokens(lex(path).filter((t) => !isTrivia(t.kind) && t.kind !== "eof"))

function plcScope(plc: Bound): Scope | undefined {
  const unit = plc.parsed.parseResult.units[0]
  return unit === undefined ? undefined : scopeForUnit(plc.project, unit)
}

function crossCheckBuildTypes(f: FixtureSources, vendor: Dialect, files: readonly Bound[], c: BoundCensus): void {
  const build = vendor === "codesys" ? f.codesys : f.twincat
  if (build === undefined) return
  const name = f.test.name
  const key = (what: string): string => `build ${vendor}: ${what}`
  const stores = files.flatMap(storesOf)
  // each store explains ONE copy of a message: it is used up by the message it explains
  const unused = new Set(stores)
  const refused = new Set<Store>()
  for (const d of build.diagnostics) {
    const m = TYPE_MESSAGES.map((r) => r.exec(d.message)).find((x) => x !== null)
    if (m === undefined || m === null) continue
    tally(c.types, key("type messages recorded"))
    const [x, y] = [typeKey(m[1]), typeKey(m[2])]
    const by = [...unused].find((s) => s.target === y && s.value.has(x))
    if (by !== undefined) {
      unused.delete(by)
      if (m[0].startsWith("Cannot convert")) refused.add(by)
      tally(c.types, key("explained by the inferred types"))
    } else
      c.typeDisagreements.push(
        `${vendor} ${name}: build says ${JSON.stringify(d.message)} — ${
          stores.some((s) => s.target === y && s.value.has(x)) ? "once more than" : "no"
        } store the front-end types ${m[1]} → ${m[2]}`,
      )
  }
  // the other way: a store the front-end calls not implicitly convertible must be one the vendor refused
  for (const s of stores) {
    if (s.conversion !== "incompatible") continue
    tally(c.types, key("stores typed not implicitly convertible"))
    if (refused.has(s)) tally(c.types, key("stores typed not implicitly convertible, refused"))
    else
      c.typeDisagreements.push(
        `${vendor} ${name}: the front-end types a store ${s.printed}, not implicitly convertible — no recorded refusal is left for it`,
      )
  }
}

function crossCheckRunTypes(f: FixtureSources, plc: Bound, c: BoundCensus): void {
  const name = f.test.name
  const values = RUN[name]?.values
  if (values === undefined) return
  const scope = plcScope(plc)
  for (const [path, value] of Object.entries(values)) {
    tally(c.types, "run: recorded values")
    const recorded = recordedType(value)
    if (recorded === undefined) {
      tally(c.types, "run: value names no type")
      continue
    }
    const expr = pathExpr(path)
    if (expr === undefined || scope === undefined) {
      c.typeDisagreements.push(`${name}: run path ${path} cannot be read in PLC_PRG`)
      continue
    }
    const inferred = renderType(inferExprType(expr, scope, plc.project))
    if (inferred === "?") {
      tally(c.types, "run: path inferred UNKNOWN")
      c.typeDisagreements.push(`${name}: run path ${path} is ${recorded}, inferred UNKNOWN`)
    } else if (sameType(recorded, inferred)) tally(c.types, "run: path inferred as recorded")
    else c.typeDisagreements.push(`${name}: run path ${path} is ${recorded}, inferred ${inferred}`)
  }
}

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

/** A recorded value against a fold, or undefined when the value's type is not one a fold can be compared with. */
function sameValue(recorded: string, folded: bigint | number | boolean): boolean | undefined {
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

function crossCheckFolds(f: FixtureSources, plc: Bound, files: readonly Bound[], c: BoundCensus): void {
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
    tally(c.folds, "run: recorded values still holding their initializer")
    const folded = constEval(decl.init, sym.owner)
    if (folded === undefined) {
      tally(c.folds, "run: initializer does not fold")
      // CODESYS has a value, the front-end none — a disagreement as much as a wrong value
      c.foldDisagreements.push(`${f.test.name}: ${path} is ${value}, the initializer does not fold`)
      continue
    }
    const same = sameValue(value, folded)
    if (same === undefined) tally(c.folds, "run: value not comparable with a fold")
    else if (same) tally(c.folds, "run: fold equals the recorded value")
    else
      c.foldDisagreements.push(
        `${f.test.name}: ${path} is ${value}, the initializer folds to ${typeof folded === "bigint" ? `${folded}` : String(folded)}`,
      )
  }
}
