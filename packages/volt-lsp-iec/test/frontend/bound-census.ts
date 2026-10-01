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
import { lookup, scopeForUnit, type Scope, type Symbol } from "../../src/frontend/symbols/index.js"
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
  UNKNOWN,
  type Type,
} from "../../src/frontend/types/index.js"
import { tally } from "./baseline.js"
import { boundCorpus, boundLibrary, withBoundFixture } from "./bound.js"
import { KNOWN_DIVERGENCES } from "../conformance/support/divergences.js"
import { at, foldDump, refusedIn, resolutionDump, sites, typeRows, valueChildren, valueExprs, type Bound } from "./dumps.js"
import { corpusProjects, fixtureSources, isLibraryManagerFile, type FixtureSources } from "./sources.js"
import type { Dialect } from "../../src/frontend/syntax/index.js"
import { compilerExprText } from "../../src/analysis/expr-echo.js"
import { bareConversionArgument } from "../../src/analysis/hole.js"
import { stringLiteralMessageType } from "../../src/analysis/index.js"

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
  /**
   * `vendor` — a fixture's, measured against that vendor's build: `known` when `support/divergences.ts` already pins the
   * fixture as disagreeing with that build (the suite replays it as an expected failure and fails the day it agrees), so
   * its resolution and types are held there, once, and only counted here; `notDefined`, the names that build reports
   * "Identifier 'x' not defined" — a bare name that binds to NONE, or is typed UNKNOWN, there AGREES with the oracle
   * (0.3 asks whether the LSP says "not defined" exactly where the vendor does), so it is counted, not a finding;
   * `unknownTypes`, every text that build names "Unknown type: '<text>'" (alone or inside a "Cannot convert") — an
   * expression typed UNKNOWN whose compiler echo is one of them is untyped on the vendor too: the build says so of THAT
   * expression (`ABS(%M?0.1)`, `(INT#0 - E#V)`, frontend-conformance 2.2b), so it is counted, not an UNKNOWN.
   */
  const summarize = (
    group: string,
    b: Bound,
    pin: string | undefined,
    vendor: { known: boolean; notDefined: ReadonlySet<string>; unknownTypes: ReadonlySet<string> } = { known: false, notDefined: new Set(), unknownTypes: new Set() },
  ): void => {
    if (vendor.known) {
      tally(c.resolution, `${group}: files of a known divergence (support/divergences.ts), not measured`)
      tally(c.types, `${group}: files of a known divergence (support/divergences.ts), not measured`)
    }
    const agreed = new Set<string>()
    const refused = refusedIn(b.parsed.parseResult)
    // Where a bare name stands inside a REFUSED expression — the statement the parser resumed at after a refused token
    // (`NS;` in `t := T#5NS;`, `ExprStatement.resumed`) holds the vendor's error at its own name. Neither side resolves
    // it: the vendor resolves nothing in a body it could not parse and says only "no effect", the LSP analyses no such
    // body. So NONE there is no disagreement to ask 0.3 about — counted, as 0.4 counts it untyped (frontend-conformance 2.2).
    const refusedNames = new Set<string>()
    if (!vendor.known)
      for (const { expr, line } of typeRows(b))
        if (expr.kind === "ident_expr" && refused(expr)) refusedNames.add(line.slice(0, line.indexOf(" ")))
    // A member read off a name the vendor reports undefined (`Gvl.accD` with `Gvl` "not defined",
    // `decl_var_access_used`) starts where its root does, as 0.4 already counts it. The root is the AST's
    // (`memberShapes`), never the dump's previous line: a call's arguments and an index's subscripts are written between a
    // member and its base, so `arr[undefIdx].nope`'s `.nope` follows `undefIdx` and belongs to `arr`.
    const shapes = memberShapes(sites(b).map((s) => s.expr))
    const lines = vendor.known
      ? []
      : resolutionDump(b).map((line) => {
          const [lhs, binding] = line.split(" -> ") as [string, string]
          const where = lhs.slice(0, lhs.indexOf(" "))
          const name = lhs.slice(lhs.indexOf(" ") + 1)
          const shape = name.startsWith(".") ? "member" : / (:=|=>)$/.test(name) ? "parameter" : "bare name"
          const verdict = binding === "NONE" || binding === "NOSCOPE" || binding === "NO-CALLEE" ? binding : "resolved"
          return { line, where, name, shape, verdict }
        })
    for (const { where, name, shape, verdict } of lines)
      if (verdict === "NONE" && shape === "bare name" && vendor.notDefined.has(name.toLowerCase())) agreed.add(where)
    for (const { line, where, name, shape, verdict } of lines) {
      if (verdict === "NONE" && shape === "member" && agreed.has(shapes.rootOf.get(where) ?? "")) {
        tally(c.resolution, `${group}: member NONE, on a name not defined on the vendor too`)
        continue
      }
      if (verdict === "NONE" && shape === "bare name" && agreed.has(where)) {
        tally(c.resolution, `${group}: bare name NONE, not defined on the vendor too`)
        continue
      }
      if (verdict === "NONE" && shape === "bare name" && refusedNames.has(where)) {
        tally(c.resolution, `${group}: bare name NONE, a refused expression`)
        continue
      }
      tally(c.resolution, `${group}: ${shape} ${verdict}`)
      if (pin !== undefined && verdict !== "resolved") c.fixtureUnresolved.push(`${pin}${b.parsed.id} ${line}`)
    }
    if (!vendor.known)
      for (const { expr, scope, line } of typeRows(b)) {
        const [where, kind, ...rest] = line.split(" ")
        const type = rest.join(" ")
        tally(c.types, `${group}: expressions`)
        if (type !== "?" && type !== "NOSCOPE") continue
        // a refused expression (`dumps.ts` `refusedIn`) has no type to ask for; an undefined name the vendor also
        // reports undefined has none either, nor does an index, member or dereference BUILT on it (`vec4[0]` over an
        // undefined `vec4` starts where `vec4` does); and a call to a POU that returns nothing has no value — each
        // counted, none an UNKNOWN. Where a value belongs (`x := m.NoRet();`) the vendor says the same: "Cannot convert
        // type 'Unknown type: 'm.NoRet()'' to type 'INT'" (`refuse_method_no_result`), and the LSP agrees.
        if (refused(expr)) tally(c.types, `${group}: ${kind} untyped, a refused expression`)
        else if (ON_ITS_ROOT_NAME.has(kind!) && agreed.has(where!))
          tally(c.types, `${group}: ${kind} UNKNOWN, not defined on the vendor too`)
        else if (type === "?" && returnsNothing(expr, scope, b)) tally(c.types, `${group}: call with no return value`)
        // a GVL's NAME qualifying its variable (`GVL.g`) is no value on either side — it names where `g` is, and has no
        // type to ask for (`use_gvl_field_access`, `decl_at_after_type_in_gvl`, frontend-conformance 2.3)
        else if (type === "?" && shapes.qualifiers.has(where!) && namesAGvl(expr, scope)) tally(c.types, `${group}: ident_expr untyped, a GVL's name qualifying its variable`)
        // what the vendor reports unknown too is that agreement before it is anything else: the SIZEOF/ADR split below
        // is the LSP's own reason, and ahead of this it took agreements out of their measure
        else if (type === "?" && vendor.unknownTypes.has(compilerExprText(expr)))
          tally(c.types, `${group}: ${kind} UNKNOWN, unknown on the vendor too`)
        else if (type === "?" && operandTyped(expr, scope, b) === false) tally(c.types, `${group}: call UNKNOWN, on an untyped operand`)
        else if (type === "?" && operandTyped(expr, scope, b) === true)
          tally(c.types, `${group}: call UNKNOWN, SIZEOF or ADR (no result type yet, task 4.3.4)`)
        else tally(c.types, `${group}: ${kind} ${type === "?" ? "UNKNOWN" : "NOSCOPE"}`)
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
        const known = KNOWN_DIVERGENCES[vendor].has(f.test.name)
        const notDefined = new Set(
          ((vendor === "codesys" ? f.codesys : f.twincat)?.diagnostics ?? []).flatMap((d) => {
            const m = /^Identifier '(.+)' not defined$/.exec(d.message)
            return m === null ? [] : [m[1].toLowerCase()]
          }),
        )
        const unknownTypes = new Set(
          ((vendor === "codesys" ? f.codesys : f.twincat)?.diagnostics ?? []).flatMap((d) =>
            [...d.message.matchAll(/Unknown type: '(.+?)''? to type|^Unknown type: '(.+)'$/g)].map((m) => m[1] ?? m[2]),
          ),
        )
        summarize(`fixtures ${vendor}`, own, `${vendor} `, { known, notDefined, unknownTypes })
        summarize(`fixtures ${vendor}`, plc, `${vendor} `, { known, notDefined, unknownTypes })
        if (!known) crossCheckBuildTypes(f, vendor, [own, plc], c)
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
  /** `named`: the target as the compiler names it where it is no `Type` — a bare conversion's parameter, `ANY`. */
  const store = (target: Type, value: Expr, scope: Scope, named?: string): void => {
    const inferred = inferExprType(value, scope, b.project)
    const as = new Set([typeKey(renderType(inferred))])
    for (const t of [literalErrorType(value, target), literalCheckType(value, target)])
      if (t !== undefined) as.add(typeKey(renderType(t)))
    // CODESYS names an expression it cannot type by its text: "Cannot convert type 'Unknown type: 'x'' to type 'INT'" —
    // as written, or as the compiler echoes it (a malformed address with its `?`: 'Unknown type: '%M?0.1'',
    // `lit_address_unsized_in_body`, frontend-conformance 2.2.7)
    if (inferred.kind === "unknown") {
      as.add(typeKey(`Unknown type: '${exprText(value)}'`))
      as.add(typeKey(`Unknown type: '${compilerExprText(value)}'`))
    }
    // …and a string LITERAL by its message form, length-tagged: "Cannot convert type 'STRING(INT#3)' to type 'INT'" —
    // the front-end's type is STRING, the length is the message's (`analysis/rules` `stringLiteralMessageType`;
    // `cc_string_escape_literal_into_int`, `lit_uchar_two_chars`, `lit_utf8_*_into_wstring`, frontend-conformance 2.2.6)
    const literal = stringLiteralMessageType(value)
    if (typeof literal === "string") as.add(typeKey(literal))
    out.push({
      target: typeKey(named ?? renderType(target)),
      value: as,
      conversion: classifyConversion(target, inferred),
      printed: `${renderType(inferred)} → ${named ?? renderType(target)}`,
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
      // a BARE conversion converts its argument to ANY (`analysis/hole` `bareConversionArgument`, frontend-conformance 2.2b)
      const converted = bareConversionArgument(x)
      if (converted !== undefined) store(UNKNOWN, converted, scope, "ANY")
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
          for (const decl of section.decls) {
            if (decl.init !== undefined && decl.init.kind !== "aggregate_init" && decl.initOp === undefined)
              store(resolveTypeExpr(decl.type, b.project, 0, scope), decl.init, scope)
            // a REFUSED initializer still stores the value the compiler kept — the placeholder where the malformed
            // literal stood (`RefusedInit.value`): "Cannot convert type 'Unknown type: '!!!'ERROR'!!!'' to type 'TIME'"
            // (`cc_time_microsecond_literal`, `lit_init_*`, frontend-conformance 2.2a)
            const refused = decl.refusedInit?.value
            if (refused !== undefined) store(resolveTypeExpr(decl.type, b.project, 0, scope), refused, scope)
          }
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

/** A run-recording path as an expression — the run recording is CODESYS's, so lexed as CODESYS. */
const pathExpr = (path: string): Expr | undefined =>
  parseExprFromTokens(lex(path, "codesys").filter((t) => !isTrivia(t.kind) && t.kind !== "eof"))

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

/** The expression kinds that start with — and are built on — the name at their root. */
const ON_ITS_ROOT_NAME: ReadonlySet<string> = new Set(["ident_expr", "index", "member", "deref"])

/**
 * The shape of every member in `exprs`, asked of the AST: `rootOf` maps a member name's position (`.m` in `a[i].m`) to
 * the position of the bare name its chain starts at — through members, indices, dereferences, a call's callee and
 * parentheses, never an argument or a subscript — and `qualifiers` holds the position of every bare name that is a
 * member's base (`GVL` in `GVL.g`, `GVL.f()`). Positions as the dumps write them (`at`).
 */
export function memberShapes(exprs: readonly Expr[]): { rootOf: Map<string, string>; qualifiers: Set<string> } {
  const rootOf = new Map<string, string>()
  const qualifiers = new Set<string>()
  const visit = (e: Expr): void => {
    if (e.kind === "member") {
      const root = rootName(e)
      if (root !== undefined) rootOf.set(at(e.member.span), at(root.span))
      if (e.base.kind === "ident_expr") qualifiers.add(at(e.base.span))
    }
    // a callee is no value (`valueChildren`), but a member called (`GVL.f()`) is a member all the same
    const args = e.kind === "call" ? e.args.flatMap((a) => (a.value === undefined ? [] : [a.value])) : []
    for (const child of e.kind === "call" ? [e.callee, ...args] : valueChildren(e)) visit(child)
  }
  exprs.forEach(visit)
  return { rootOf, qualifiers }
}

/** The bare name an access chain starts at, or undefined when it starts at no name (a literal, a parenthesised sum). */
function rootName(e: Expr): Extract<Expr, { kind: "ident_expr" }> | undefined {
  for (;;) {
    if (e.kind === "ident_expr") return e
    if (e.kind === "member" || e.kind === "index" || e.kind === "deref") e = e.base
    else if (e.kind === "call") e = e.callee
    else if (e.kind === "paren") e = e.inner
    else return undefined
  }
}

/** Whether `expr` is a bare name that binds to a GVL — the list itself, not one of its variables. */
function namesAGvl(expr: Expr, scope: Scope | undefined): boolean {
  return expr.kind === "ident_expr" && scope !== undefined && lookup(scope, expr.name)?.symbol.kind === "gvl_block"
}

/** The operators whose result type is made from their operand: SIZEOF's from its size, ADR's from its type. */
const TYPED_BY_THEIR_OPERAND: ReadonlySet<string> = new Set(["SIZEOF", "ADR"])

/**
 * A call of `TYPED_BY_THEIR_OPERAND`, by its operand — undefined for any other expression. The front-end has no result
 * type for either operator yet (built-ins, task 4.3.4), so each is UNKNOWN; the census tells the two reasons apart:
 *
 *   false  every operand has no type — a value inferred UNKNOWN, or a name that resolves to no type
 *          (`SIZEOF(OpcUa_Boolean)` over a library the corpus does not materialize): no rule for the operator could type
 *          it, and the operand is counted where it stands — its UNKNOWN is the operand's, as an index or member built on
 *          an undefined root is the root's;
 *   true   an operand has a type, and the operator's rule is what is missing — counted apart, for 4.3.4 to close.
 *
 * Told apart since frontend-conformance 2.3: `[SIZEOF(T)]` in an array initializer was misread as a repeat count NAMED
 * SIZEOF (an `ident_expr` UNKNOWN) and is the call it is now (`parse/initializer`) — 112 corpus library declarations.
 */
function operandTyped(expr: Expr, scope: Scope | undefined, b: Bound): boolean | undefined {
  if (expr.kind !== "call" || expr.callee.kind !== "ident_expr" || scope === undefined) return undefined
  if (!TYPED_BY_THEIR_OPERAND.has(expr.callee.name.toUpperCase())) return undefined
  const operands = expr.args.flatMap((a) => (a.value === undefined ? [] : [a.value]))
  if (operands.length === 0) return undefined
  const untyped = (v: Expr): boolean =>
    inferExprType(v, scope, b.project).kind === "unknown" &&
    (v.kind !== "ident_expr" ||
      resolveTypeExpr({ kind: "named_type", name: { kind: "identifier", text: v.name, span: v.span }, span: v.span }, scope, 0, b.project).kind === "unknown")
  return !operands.every(untyped)
}

/** The POUs a call can name whose declaration states no return type. */
const MAY_RETURN_NOTHING: ReadonlySet<string> = new Set(["function", "method", "action", "program"])

/**
 * A call whose callee is a function, method, action or program declared with no return type: it has no value. A
 * return type WRITTEN and refused by the parser (`METHOD M : final`, `FUNCTION F : __VECTOR[4] OF REAL` on TwinCAT) is
 * no such declaration: its calls stay UNKNOWN (`returnTypeRefused`).
 */
function returnsNothing(expr: Expr, scope: Scope | undefined, b: Bound): boolean {
  if (expr.kind !== "call" || scope === undefined) return false
  const callee = resolveMemberChain(expr.callee, scope, b.project)
  if (callee === undefined || !MAY_RETURN_NOTHING.has(callee.kind) || callee.typeExpr !== undefined) return false
  return !("returnTypeRefused" in callee.ast && callee.ast.returnTypeRefused === true)
}
