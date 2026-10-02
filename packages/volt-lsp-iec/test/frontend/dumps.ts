/**
 * THE FRONT-END, WRITTEN DOWN — the dump builders the phase-0 measurements and snapshot F share (openspec
 * `frontend-conformance`, design.md §5). Each builder takes one parsed source (and, from 0.3 on, the bound project it
 * lives in) and returns plain text lines, so a measurement can count them and a snapshot can compare them byte for byte.
 *
 *   parseErrors      every error the two parse passes record (declarations; each ST statement body), worded as the
 *                    LSP words them for the vendor — the only parse errors a client ever sees (0.1)
 *   printFindings    what is not a fixed point of the printer: the formatter over the whole document, and `exprText`
 *                    over every expression (0.2)
 *   resolutionDump   every identifier occurrence → the declaration it binds to, or NONE (0.3)
 *   typeDump         every expression → its inferred type (0.4)
 *   foldDump         every initializer and every constant expression → its `constEval` value (0.4)
 *
 * Lines carry `line:col` (1-based line, 0-based column, as spans do) and never an absolute path, so a dump taken in a
 * temporary worktree compares equal to one taken here.
 */
import { isAbsolute, join, relative } from "node:path"
import { messagesFor, parseErrorMessage, vendorReportsParseError } from "../../src/analysis/index.js"
import { bodyConditionWorld, lookupMember, type Scope, scopeForUnit, type Symbol } from "../../src/frontend/symbols/index.js"
import {
  constancyOf,
  constEval,
  inferExprType,
  renderType,
  resolveCallee,
  resolveBareName,
  resolveGlobalName,
  resolveMemberChain,
  type BareName,
  type CalleeInfo,
  type ConstValue,
} from "../../src/frontend/types/index.js"
import {
  allUnits,
  exprText,
  isStBody,
  isTrivia,
  lex,
  parseDocument,
  parseExprFromTokens,
  bodyStatements,
  sourceStatements,
  stmtExprs,
  unitBodies,
  walkStatements,
  type Dialect,
  type Expr,
  type ParseError,
  type ParseResult,
  type Span,
  type StatementList,
  type TopLevel,
  type TypeExpr,
} from "../../src/frontend/syntax/index.js"
import { formatDocument } from "../../src/services/index.js"

export const at = (s: Span): string => `${s.startLine}:${s.startCol}`

/** A source parsed as the LSP parses it. */
export interface Parsed {
  id: string
  uri: string
  source: string
  dialect: Dialect
  parseResult: ParseResult
}

/** Parsed ONCE per file object and dialect: the corpus's files and each fixture's own item and PLC_PRG are the same
 *  objects to every measurement (`sources.ts` reads them once), and the printer census, the parse census and the bound
 *  census each parsed them again (2026-10-02). A parse is read-only to every caller — the replay rebinds one too. */
export function parse(file: { id: string; uri: string; source: string }, dialect: Dialect): Parsed {
  let byDialect = parses.get(file)
  if (byDialect === undefined) parses.set(file, (byDialect = new Map()))
  let parsed = byDialect.get(dialect)
  if (parsed === undefined)
    byDialect.set(dialect, (parsed = { ...file, dialect, parseResult: parseDocument(file.uri, file.source, { networkText: true }, dialect) }))
  return parsed
}
const parses = new WeakMap<object, Map<Dialect, Parsed>>()

// ─── 0.1 parse errors ────────────────────────────────────────────────────────────────────────────────────────

export interface ParseErrorRow {
  /** `decl` — the top-level parse; `body` — an ST statement body. */
  pass: "decl" | "body"
  at: string
  message: string
}

/**
 * Every parse error a client would see for the bound file `b` on `vendor`: both passes, the vendor's wording of "Unexpected token",
 * and without the ones that vendor's compiler does not report (`vendorReportsParseError`) — the same stream
 * `checks/syntax/parse-errors.ts` drains. On TwinCAT a message said twice on one LINE is seen once, because
 * `computeSemanticDiagnostics` folds TwinCAT's output per line (`dedupePerLine`: TwinCAT never says the same thing twice
 * on one line) — so a refused `LDATE#2024-01-01`, whose cascade pairs `'-'` twice, is counted as TwinCAT records it
 * (task 2.2.6, when the cascade moved from `refused-name` into the parser).
 *
 * A body is parsed in the world the analysis gives it (`bodyConditionWorld`: the project's names, its vendor, its
 * measured environment — the recording projects' for a fixture), so a chain on the project's names (`defined (pou: …)`,
 * `hasattribute`, …) is decided here as it is for the user and its syntax errors are counted (frontend-conformance 2.7
 * review: a world without the names refused the chain and lost the errors the user is shown).
 */
export function parseErrors(b: Bound, vendor: Dialect): ParseErrorRow[] {
  const p = b.parsed
  const messages = messagesFor(vendor)
  const row = (pass: ParseErrorRow["pass"], e: ParseError): ParseErrorRow => ({
    pass,
    at: at(e.span),
    message: parseErrorMessage(e, messages),
  })
  const out: ParseErrorRow[] = []
  for (const e of p.parseResult.errors) if (vendorReportsParseError(e, vendor)) out.push(row("decl", e))
  for (const unit of p.parseResult.units)
    for (const body of unitBodies(unit)) {
      if (!isStBody(body)) continue
      for (const e of bodyStatements(body, bodyConditionWorld(b.project, unit, body)).errors) if (vendorReportsParseError(e, vendor)) out.push(row("body", e))
    }
  if (vendor !== "twincat") return out
  const seen = new Set<string>()
  return out.filter((r) => {
    const key = `${r.at.split(":")[0]}\u0000${r.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ─── 0.2 the printer ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * A span/token-free, key-sorted string key of an AST, with each body's parsed statements embedded — the equivalence
 * `corpus.test.ts` holds the formatter to (its `astKey`, repeated here because a test file exports nothing).
 */
export function astKey(value: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm)
    if (x !== null && typeof x === "object") {
      const obj = x as Record<string, unknown>
      if (obj.kind === "body") {
        const line = (obj as { implementation?: { statement: unknown; folder?: string; leading?: string } })
          .implementation
        return {
          kind: "body",
          implementation:
            line === undefined
              ? null
              : norm({
                  statement: line.statement,
                  folder: line.folder ?? null,
                  leading: line.leading?.replace(/\r\n/g, "\n") ?? null,
                }),
          st: norm(sourceStatements(obj as never).statements), // as written: every conditional branch
        }
      }
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(obj).sort()) {
        if (k === "span" || k === "tokens") continue
        out[k] = norm(obj[k])
      }
      return out
    }
    return typeof x === "bigint" ? `#${x}` : x
  }
  return JSON.stringify(norm(value))
}

export type PrintFindingKind =
  | "format-reparse-errors"
  | "format-ast-changed"
  | "format-not-idempotent"
  | "expr-reprint-fails"
  | "expr-not-fixed"

export interface PrintFinding {
  kind: PrintFindingKind
  at: string
  detail: string
}

/** The MAXIMAL expressions of `units` — every one a declaration holds (`declExprs`) and every one an ST statement holds
 *  directly — with nothing resolved. A sub-expression is printed as part of the expression that holds it. */
export function* topExprs(units: readonly TopLevel[]): Generator<Expr> {
  for (const unit of allUnits(units)) {
    yield* declExprs(unit)
    for (const body of unitBodies(unit)) if (isStBody(body)) yield* statementExprs(bodyStatements(body).statements)
  }
}

const EXPR_KINDS: ReadonlySet<string> = new Set([
  "ident_expr",
  "literal",
  "binary",
  "unary",
  "member",
  "index",
  "deref",
  "call",
  "paren",
  "assign_expr",
])

/**
 * Every maximal expression a unit's DECLARATIONS hold, in source order: initializers (inside aggregates too), array
 * bounds, string lengths, subrange bounds, FB_Init arguments, enum values and defaults, alias and field initializers.
 * Found by walking the node, not by listing fields, so a declaration form nobody listed is not silently left out. A
 * body (`kind: "body"`) is not a declaration and is not entered; a call argument's parameter NAME is not an expression.
 * A `__VECTOR`'s `dims` are the parser's index range for its count (`0..count-1`), not source: its count AS WRITTEN
 * (`ArrayType.vector.size`) is the expression the declaration holds.
 */
export function declExprs(unit: TopLevel): Expr[] {
  const out: Expr[] = []
  const visit = (x: unknown, key: string): void => {
    if (x === null || typeof x !== "object" || key === "span" || key === "tokens" || key === "param") return
    if (Array.isArray(x)) {
      for (const item of x) visit(item, "")
      return
    }
    const node = x as { kind?: unknown }
    if (node.kind === "body") return
    const vector = node.kind === "array_type" ? (x as Extract<TypeExpr, { kind: "array_type" }>) : undefined
    if (vector?.vector !== undefined) {
      visit(vector.vector.size, "size")
      visit(vector.element, "element")
      return
    }
    if (typeof node.kind === "string" && EXPR_KINDS.has(node.kind)) {
      out.push(x as Expr)
      return
    }
    for (const [k, v] of Object.entries(x)) visit(v, k)
  }
  for (const [k, v] of Object.entries(unit)) if (k !== "units") visit(v, k)
  return out.sort((a, b) => a.span.start - b.span.start)
}

/** The expressions each statement of `list` holds directly, nested blocks included, in walk order. */
function statementExprs(list: StatementList): Expr[] {
  const out: Expr[] = []
  walkStatements(list, (s) => out.push(...stmtExprs(s)))
  return out
}

const exprTokens = (text: string, dialect: Dialect) =>
  lex(text, dialect).filter((t) => !isTrivia(t.kind) && t.kind !== "eof")

/**
 * What is not a fixed point of the printer in `p`:
 *
 *   the FORMATTER — `format(x)`, re-parsed as the same source object (its uri), must carry no parse error `x` does not
 *   already carry (a source's own error, faithfully reproduced, is not the printer's), must parse to the same AST
 *   (`astKey`), and `format(format(x))` must equal `format(x)`;
 *   `exprText` — every expression's text must re-parse as an expression and print back to the same text.
 */
export function printFindings(p: Parsed): PrintFinding[] {
  const out: PrintFinding[] = []
  const once = formatDocument({ uri: p.uri, source: p.source, parseResult: p.parseResult })
  // Re-parsed as the SAME source object (the uri decides how `.struct`/`.gvl`/… are read), as the LSP would read it.
  const reparsed = parseDocument(p.uri, once, { networkText: true }, p.dialect)
  // Only an error the formatter INTRODUCED is its failure: one the original already has, reproduced, is the source's.
  const own = new Map<string, number>()
  for (const e of p.parseResult.errors) own.set(e.message, (own.get(e.message) ?? 0) + 1)
  const introduced = reparsed.errors.filter((e) => {
    const left = own.get(e.message) ?? 0
    if (left === 0) return true
    own.set(e.message, left - 1)
    return false
  })
  if (introduced.length > 0)
    out.push({ kind: "format-reparse-errors", at: at(introduced[0].span), detail: introduced[0].message })
  else if (astKey(p.parseResult.units) !== astKey(reparsed.units))
    out.push({
      kind: "format-ast-changed",
      at: "-",
      detail: firstDifference(astKey(p.parseResult.units), astKey(reparsed.units)),
    })
  const twice = formatDocument({ uri: p.uri, source: once, parseResult: reparsed })
  if (twice !== once) out.push({ kind: "format-not-idempotent", at: "-", detail: firstDifference(once, twice) })

  const refused = refusedIn(p.parseResult)
  for (const e of topExprs(p.parseResult.units)) {
    // An expression the parser itself refused has no text to hold to a fixed point: its reprint re-meets the source's own
    // error — the rule the formatter above already follows, for the second printer (0.1 measures the refusal).
    if (refused(e)) continue
    const text = exprText(e)
    // …in the grammar of its place: an inline assignment printed bare (`IF x := b THEN`, rule E26) is an expression where
    // a condition, a selector, a bound or an index stands, and nowhere else
    const again = parseExprFromTokens(exprTokens(text, p.dialect), e.kind === "assign_expr")
    if (again === undefined) out.push({ kind: "expr-reprint-fails", at: at(e.span), detail: text })
    else if (exprText(again) !== text)
      out.push({ kind: "expr-not-fixed", at: at(e.span), detail: `${text} → ${exprText(again)}` })
  }
  return out
}

/**
 * Does an expression HOLD one of its source's own parse errors — does an error, declaration or body, any vendor, start
 * inside its span? Such an expression is a refusal (`n := __CURRENTTASK;`, `__DELETE n` — the parser's recovery node,
 * carrying the vendor's words at its own token): what it prints to or is typed as is no question about the printer or
 * the types. The parse census (0.1) is where a refusal is measured.
 */
export function refusedIn(parseResult: ParseResult): (e: Expr) => boolean {
  const starts: number[] = [...parseResult.errors.map((e) => e.span.start)]
  for (const unit of allUnits(parseResult.units))
    for (const body of unitBodies(unit)) if (isStBody(body)) starts.push(...bodyStatements(body).errors.map((e) => e.span.start))
  return (e) => starts.some((s) => s >= e.span.start && s < e.span.end)
}

/**
 * Does an expression stand in an ST BODY THAT DID NOT PARSE — one whose statement parse holds an error? The vendor
 * resolves and types nothing in such a body: an undefined name in the statement after a refusal is not reported
 * (`expr_member_named_keyword_beside_undefined`, both vendors, frontend-conformance 2.5), and the LSP analyses no such
 * body either (`symbols` `bodies`). So what its names bind to and its expressions are typed as is no question for 0.3 or
 * 0.4 — the parse census (0.1) is where such a body is measured.
 *
 * …as long as the VENDOR refused it too: a body counts only when every parse error the LSP gives in it is a message the
 * vendor recorded (`vendorSays`, lower case, so TwinCAT's capitals compare). A false-positive parse error leaves the body
 * measured by 0.3 and 0.4 — it is no reason the vendor resolved nothing there. The corpora build: they pass an empty
 * set. A fixture the vendor never BUILT (its push was refused, `pushRefuses`: no build recording) passes `undefined` —
 * nothing was resolved there either, and the LSP's own parse is all there is to go by.
 */
export function unparsedIn(parseResult: ParseResult, vendorSays: ReadonlySet<string> | undefined): (e: { span: { start: number; end: number } }) => boolean {
  const spans: { start: number; end: number }[] = []
  for (const unit of allUnits(parseResult.units))
    for (const body of unitBodies(unit)) {
      if (!isStBody(body)) continue
      const { errors } = bodyStatements(body)
      if (errors.length > 0 && errors.every((e) => vendorSays?.has(e.message.toLowerCase()) ?? true)) spans.push(body.span)
    }
  return (e) => spans.some((s) => e.span.start >= s.start && e.span.end <= s.end)
}

/** The first place two texts differ, with a little context either side — enough to read a finding, not the file. */
export function firstDifference(a: string, b: string): string {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  const clip = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 20), i + 40))
  return `@${i}: ${clip(a)} vs ${clip(b)}`
}

// ─── 0.3 / 0.4 the bound dumps ───────────────────────────────────────────────────────────────────────────────

/** A parsed source, bound: the project it lives in (its library manifests and device instances bound too). */
export interface Bound {
  parsed: Parsed
  project: Scope
}

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
    const unitScope = scopeForUnit(b.project, unit)
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
 * a declaration (a library namespace's included), a bare enum member, a device instance, a compiler-provided name, NONE.
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
        walk(e.base, scope)
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
  for (const s of sites(b))
    for (const e of valueExprs(s.expr))
      out.push({
        expr: e,
        scope: s.scope,
        line: `${at(e.span)} ${e.kind} ${s.scope === undefined ? "NOSCOPE" : renderType(inferExprType(e, s.scope, b.project))}`,
      })
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
