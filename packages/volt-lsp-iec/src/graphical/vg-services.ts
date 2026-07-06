/**
 * VG services (Layer F, F.2d) — the graphical branch of hover · definition · type-definition · completion.
 * Native by reuse: VG operands are ST `Expr`, so cursor→symbol resolution runs the SAME descent
 * (`exprAtOffset`/`memberAtOffset`) and `resolveMemberChain`/`lookup` the ST services use, against the
 * network scope (POU + inferred `LET` wires). Results render through the ST cores (`symbolHover`,
 * `completionAtScope`, `locationOf`), so VG understanding matches ST — including a wire's inferred type.
 *
 * The server routes a position query to these when the offset is inside a graphical body (`inVgBody`),
 * else to the ST services.
 */
import type { CompletionItem, Hover, Location } from "vscode-languageserver-protocol"
import {
  exprAtOffset,
  isGraphicalBody,
  memberAtOffset,
  unitBodies,
  type BodySpan,
  type Expr,
  type Statement,
  type TopLevel,
} from "../syntax/index.js"
import { lookup, lookupLocal, resolveBareEnumMember, type Scope, type Symbol } from "../symbols/index.js"
import { resolveMemberChain } from "../types/index.js"
import { lookupReference, renderReferenceHover } from "../reference/index.js"
import {
  completionAtScope,
  locationOf,
  symbolHover,
  tokenAtOffset,
  type Document,
} from "../services/index.js"
import { analyzeVgBody, vgNetworkAt, wireDefs } from "./vg-analyze.js"
import type { VgStatement } from "./text/ast.js"

/** True when the offset falls inside a graphical (VG) body — the server's routing discriminator. */
export function inVgBody(doc: Document, offset: number): boolean {
  return vgBodyAt(doc, offset) !== undefined
}

const GRAPHICAL_LANGUAGES: Record<string, string> = {
  CFC: "Continuous Function Chart",
  SFC: "Sequential Function Chart",
  FBD: "Function Block Diagram",
  LD: "Ladder Diagram",
}

/**
 * Hover for a `(* @volt-graphical: <LANG> *)` marker (F.2e) — the informational comment a read-only
 * CFC/SFC body materializes as (spec §E). Explains that the body is authored in the IDE and not editable
 * as text. The marker is a comment, so it is otherwise not analyzed as VG or ST.
 */
export function vgMarkerHover(doc: Document, offset: number): Hover | undefined {
  const marker = /\(\* @volt-graphical: (\w+) \*\)/g
  for (const m of doc.source.matchAll(marker)) {
    const start = m.index
    if (offset >= start && offset < start + m[0].length) {
      const lang = m[1]!
      const name = GRAPHICAL_LANGUAGES[lang] ?? lang
      const value = [
        "```iecst",
        `(* @volt-graphical: ${lang} *)`,
        "```",
        "",
        `_Volt graphical body (${name})_`,
        "",
        `This ${name} body is authored in your IDE and has no editable text form. To modify it, open the unit in CODESYS / TwinCAT.`,
      ].join("\n")
      return { contents: { kind: "markdown", value } }
    }
  }
  return undefined
}

/** Hover for a VG operand/wire — a symbol declaration (wire type inferred) or a built-in reference entry. */
export function vgHover(doc: Document, project: Scope, offset: number): Hover | undefined {
  const sym = vgResolveAt(doc, project, offset)
  if (sym !== undefined) return symbolHover(sym)
  const tok = tokenAtOffset(doc.source, offset)
  if (tok !== undefined && (tok.kind === "identifier" || tok.kind === "keyword")) {
    const entry = lookupReference(tok.text)
    if (entry !== undefined) return { contents: { kind: "markdown", value: renderReferenceHover(entry) } }
  }
  return undefined
}

/** Go-to-definition for a VG operand/wire reference. */
export function vgDefinition(doc: Document, project: Scope, offset: number): Location | undefined {
  const sym = vgResolveAt(doc, project, offset)
  return sym !== undefined ? locationOf(sym) : undefined
}

/** Go-to-type-definition: the declaration of the resolved symbol's TYPE. */
export function vgTypeDefinition(doc: Document, project: Scope, offset: number): Location | undefined {
  const te = vgResolveAt(doc, project, offset)?.typeExpr
  const name = te?.kind === "named_type" ? te.name.text : undefined
  if (name === undefined) return undefined
  const typeSym = lookup(project, name)?.symbol
  return typeSym !== undefined ? locationOf(typeSym) : undefined
}

/** Completion inside a VG network — POU vars + this network's wires + members + keywords. */
export function vgCompletion(doc: Document, project: Scope, offset: number): CompletionItem[] {
  const found = vgBodyAt(doc, offset)
  if (found === undefined) return []
  const analysis = analyzeVgBody(found.unit, found.body, project, doc.uri)
  const scope = vgNetworkAt(analysis, offset)?.scope ?? analysis.pou
  return completionAtScope(scope, project, doc.source, offset)
}

// ─── resolution ──────────────────────────────────────────────────────────────

/** The symbol a VG cursor points at: a `LET` wire (at its def or a use) or a POU/global via the operand. */
export function vgResolveAt(doc: Document, project: Scope, offset: number): Symbol | undefined {
  const found = vgBodyAt(doc, offset)
  if (found === undefined) return undefined
  const analysis = analyzeVgBody(found.unit, found.body, project, doc.uri)
  const here = vgNetworkAt(analysis, offset)
  if (here === undefined) return undefined
  const { network, scope } = here

  // Cursor on a `LET` wire's DEFINING name → the wire symbol itself.
  for (const wire of wireDefs(network.statements)) {
    if (offset >= wire.name.span.start && offset < wire.name.span.end) return lookupLocal(scope, wire.name.text)[0]
  }

  // Operand path — wrap the network's operand Exprs as statements and reuse the ST descent.
  const stmts = operandStatements(network.statements)
  const member = memberAtOffset(stmts, offset)
  if (member !== undefined) {
    const sym = resolveMemberChain(member, scope, project)
    if (sym !== undefined) return sym
  }
  const expr = exprAtOffset(stmts, offset)
  if (expr?.kind === "ident_expr") {
    return lookup(scope, expr.name)?.symbol ?? resolveBareEnumMember(project, expr.name)
  }
  return undefined
}

/** Wrap every VG operand `Expr` as an `expr_stmt` so `exprAtOffset`/`memberAtOffset` descend it. */
function operandStatements(statements: readonly VgStatement[]): Statement[] {
  const out: Statement[] = []
  const push = (e?: Expr): void => {
    if (e !== undefined) out.push({ kind: "expr_stmt", expr: e, span: e.span })
  }
  const walk = (stmts: readonly VgStatement[]): void => {
    for (const s of stmts) {
      switch (s.kind) {
        case "sink":
          push(s.target)
          push(s.value)
          break
        case "wire_def":
          push(s.producer)
          break
        case "fb_call":
          push(s.call)
          break
        case "en_eno_if":
          push(s.en)
          walk(s.body)
          break
        case "jump":
        case "return":
          push(s.condition)
          break
        case "execute":
          out.push(...s.statements)
          break
      }
    }
  }
  walk(statements)
  return out
}

/** The graphical body (with its unit) containing the offset, or undefined. */
function vgBodyAt(doc: Document, offset: number): { unit: TopLevel; body: BodySpan } | undefined {
  for (const unit of doc.parseResult.units) {
    for (const body of unitBodies(unit)) {
      if (isGraphicalBody(body) && offset >= body.span.start && offset < body.span.end) return { unit, body }
    }
  }
  return undefined
}
