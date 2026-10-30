/**
 * THE PRINTER DUMP (0.2) — every expression and declaration printed and re-parsed, the AST before and after compared by
 * key: what the printer changes, drops or cannot print. One concern of `dumps.ts` (openspec lsp-same-standard 4.4).
 */
import {
  sourceStatements,
  type TopLevel,
  type Expr,
  allUnits,
  unitBodies,
  bodyStatements,
  type TypeExpr,
  type StatementList,
  walkStatements,
  stmtExprs,
  type Dialect,
  lex,
  isTrivia,
  parseDocument,
  exprText,
  parseExprFromTokens,
  type ParseResult,
} from "../../src/frontend/syntax/index.js"
import { measuredStBody } from "./st-bodies.js"
import { formatDocument } from "../../src/services/index.js"
import { type Parsed, at } from "./dumps.js"

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
        const line = (obj as { noSlot?: unknown; languageLine?: { statement: unknown; folder?: string; leading?: string } })
          .languageLine
        return {
          kind: "body",
          noSlot: norm((obj as { noSlot?: unknown }).noSlot ?? null),
          languageLine:
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
    for (const body of unitBodies(unit)) if (measuredStBody(body)) yield* statementExprs(bodyStatements(body).statements)
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
export function statementExprs(list: StatementList): Expr[] {
  const out: Expr[] = []
  walkStatements(list, (s) => out.push(...stmtExprs(s)))
  return out
}

const exprTokens = (text: string, dialect: Dialect, unicodeIdentifiers: boolean) =>
  lex(text, dialect, unicodeIdentifiers).filter((t) => !isTrivia(t.kind) && t.kind !== "eof")

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
  // Re-parsed as the SAME source object (the uri decides how `.dut`/`.gvl`/… are read), as the LSP would read it.
  const reparsed = parseDocument(p.uri, once, { networkText: true, unicodeIdentifiers: p.parseResult.unicodeIdentifiers }, p.dialect)
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
    const again = parseExprFromTokens(exprTokens(text, p.dialect, p.parseResult.unicodeIdentifiers), e.kind === "assign_expr")
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
    for (const body of unitBodies(unit)) if (measuredStBody(body)) starts.push(...bodyStatements(body).errors.map((e) => e.span.start))
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
      if (!measuredStBody(body)) continue
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
