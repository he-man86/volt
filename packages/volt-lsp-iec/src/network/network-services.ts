/**
 * network text services (Layer F, F.2d) — the graphical branch of hover · definition · type-definition · completion.
 * Native by reuse: network-text operands are ST `Expr` (`network-text/exprs`), so cursor→symbol resolution runs the
 * SAME descent (`exprAtOffset`/`memberAtOffset`) and `resolveMemberChain`/`lookup` the ST services use, against the
 * network scope (POU + the network's `VAR_TEMP` wires). Results render through the ST cores (`symbolHover`,
 * `completionAtScope`, `locationOf`), so network text understanding matches ST — a wire hovers as its declaration.
 *
 * The server routes a position query to these when the offset is inside a graphical body (`inNetworkText`),
 * else to the ST services.
 */
import type { CompletionItem, Hover, Location, Range, TextEdit, WorkspaceEdit } from "vscode-languageserver-protocol"
import {
  type BodySpan,
  type Document,
  type Expr,
  exprAtOffset,
  graphicalBodies,
  spanContains,
  type IdentExpr,
  memberAtOffset,
  type Statement,
  tokenAtOffset,
  type TopLevel,
  unitBodies,
  walkAllExprs,
} from "../syntax/index.js"
import { lookup, lookupLocal, resolveBareEnumMember, type Scope, type Symbol } from "../symbols/index.js"
import { resolveMemberChain } from "../types/index.js"
import { lookupReference, renderReferenceHover } from "../reference/index.js"
import {
  completionAtScope,
  findReferences,
  locationOf,
  rangeFromSpan,
  resolveAt,
  symbolHover,
  toLocations,
  type Ref,
} from "../services/index.js"
import { analyzeNetworkText, networkNetworkAt, type NetworkTextAnalysis } from "./network-analyze.js"
import { statementTargets, walkValues, type NetworkTextStatement } from "../network-text/ast.js"
import { executeBoxes, statementExprs } from "../network-text/exprs.js"
import { NETWORK_TEXT_WORDS } from "../network-text/parser.js"

/** True when the offset falls inside a graphical (network text) body — the server's routing discriminator. */
export function inNetworkText(doc: Document, offset: number): boolean {
  return vgBodyAt(doc, offset) !== undefined
}

const GRAPHICAL_LANGUAGES: Record<string, string> = {
  CFC: "Continuous Function Chart",
  SFC: "Sequential Function Chart",
  IL: "Instruction List",
  FBD: "Function Block Diagram",
  LD: "Ladder Diagram",
}

/**
 * Hover for a READ-ONLY body's line (F.2e) — `IMPLEMENTATION CFC|SFC|IL`, or `IMPLEMENTATION LD|FBD UNSUPPORTED` for an
 * LD/FBD body network text cannot represent yet (`syntax/implementation-keyword`). Explains that the body is authored
 * in the IDE and has no editable text form here: the line is what a pull writes for it, and the body under it is empty
 * and read by neither parser. Read off the parse, so only a line the splitter took as a body's boundary answers — never
 * a look-alike in a comment.
 */
export function readOnlyBodyHover(doc: Document, offset: number): Hover | undefined {
  const visit = (units: readonly TopLevel[]): Hover | undefined => {
    for (const unit of units) {
      if (unit.kind === "namespace") {
        const inner = visit(unit.units)
        if (inner !== undefined) return inner
        continue
      }
      for (const body of unitBodies(unit)) {
        const line = body.implementation
        if (line === undefined || line.statement.kind !== "read-only" || !spanContains(line.span, offset)) continue
        const { language, unsupported } = line.statement
        const name = GRAPHICAL_LANGUAGES[language] ?? language
        const why = unsupported
          ? `This ${name} body holds a shape network text cannot represent yet, so it has no editable text form.`
          : `Volt does not read ${name}, so this body has no editable text form.`
        const value = [
          "```iecst",
          line.text,
          "```",
          "",
          `_Volt read-only body (${name})_`,
          "",
          `${why} It stays as it is in your IDE: to modify it, open the unit in CODESYS / TwinCAT.`,
        ].join("\n")
        return { contents: { kind: "markdown", value } }
      }
    }
    return undefined
  }
  return visit(doc.parseResult.units)
}

/**
 * Hover for a network-text operand/wire — a symbol's declaration or a built-in reference entry. A WIRE shows its
 * `VAR_TEMP` declaration (`g22 : BOOL`) and the value that produces it (`g22 := (a AND b);`): a wire stands for a
 * vendor Demux, a fan-out point on the drawing, and what it carries is the one thing its name does not say.
 */
export function networkHover(doc: Document, project: Scope, offset: number): Hover | undefined {
  const found = networkSymbolAt(doc, project, offset)
  if (found !== undefined) {
    const hover = symbolHover(found.sym)
    const def = found.analysis.wires.get(found.sym)?.definition
    if (def === undefined) return hover
    const producer = doc.source.slice(def.value.span.start, def.value.span.end)
    const value = (hover.contents as { value: string }).value
    return { contents: { kind: "markdown", value: `${value}\n\n\`\`\`iecst\n${def.wire.text} := ${producer};\n\`\`\`` } }
  }
  const tok = tokenAtOffset(doc.source, offset)
  if (tok !== undefined && (tok.kind === "identifier" || tok.kind === "keyword")) {
    const entry = lookupReference(tok.text)
    if (entry !== undefined) return { contents: { kind: "markdown", value: renderReferenceHover(entry) } }
  }
  return undefined
}

/** Go-to-definition for a network-text operand/wire reference. */
export function networkDefinition(doc: Document, project: Scope, offset: number): Location | undefined {
  const sym = networkResolveAt(doc, project, offset)
  return sym !== undefined ? locationOf(sym) : undefined
}

/** Go-to-type-definition: the declaration of the resolved symbol's TYPE. */
export function networkTypeDefinition(doc: Document, project: Scope, offset: number): Location | undefined {
  const te = networkResolveAt(doc, project, offset)?.typeExpr
  const name = te?.kind === "named_type" ? te.name.text : undefined
  if (name === undefined) return undefined
  const typeSym = lookup(project, name)?.symbol
  return typeSym !== undefined ? locationOf(typeSym) : undefined
}

/** Completion inside a network text network — POU vars + this network's wires + members + keywords. */
export function networkCompletion(doc: Document, project: Scope, offset: number): CompletionItem[] {
  const found = vgBodyAt(doc, offset)
  if (found === undefined) return []
  const analysis = analyzeNetworkText(found.unit, found.body, project, doc.uri)
  const scope = networkNetworkAt(analysis, offset)?.scope ?? analysis.pou
  return completionAtScope(scope, project, doc.source, offset)
}

// ─── cross-body references / rename (F.2d follow-on) ───────────────────────────
//
// A symbol can be used in BOTH ST and network text bodies, so references/rename must span both — a rename that
// missed a network-text operand would leave it pointing at the old name (data corruption). These compose the ST
// `findReferences` (declaration + ST body uses) with a walk over network-text operand networks, and resolve the
// cursor from whichever body kind it sits in. The server routes ALL references/rename here.

/** Resolve the symbol under the cursor whether it lands in an ST or a network-text body. */
export function resolveAnywhere(doc: Document, project: Scope, offset: number): Symbol | undefined {
  return inNetworkText(doc, offset) ? networkResolveAt(doc, project, offset) : resolveAt(doc, project, offset)
}

/** Every occurrence of `target` across ST bodies (via `findReferences`) AND network-text operand networks. */
export function allReferences(docs: Iterable<Document>, project: Scope, target: Symbol): Ref[] {
  const all = [...docs] // iterated twice (ST pass, then network text pass)
  const out = findReferences(all, project, target)
  for (const doc of all) {
    for (const body of graphicalBodies(doc.parseResult.units)) {
      const analysis = analyzeNetworkText(body.unit, body.body, project, doc.uri)
      for (const [network, scope] of analysis.networkScopes) {
        const stmts = operandStatements(network.statements)
        const memberNames = new Set<IdentExpr>()
        walkAllExprs(stmts, (e) => {
          if (e.kind === "member") memberNames.add(e.member)
        })
        walkAllExprs(stmts, (e) => {
          if (e.kind === "member") {
            if (resolveMemberChain(e, scope, project) === target)
              out.push({ uri: doc.uri, range: rangeFromSpan(e.member.span) })
          } else if (e.kind === "ident_expr" && !memberNames.has(e)) {
            const s = lookup(scope, e.name)?.symbol ?? resolveBareEnumMember(project, e.name)
            if (s === target) out.push({ uri: doc.uri, range: rangeFromSpan(e.span) })
          }
        })
      }
    }
  }
  return out
}

/** references (ST + network text) — the target resolved from either body kind. */
export function referencesAnywhere(
  docs: Iterable<Document>,
  project: Scope,
  doc: Document,
  offset: number,
  includeDeclaration = true,
): Location[] | undefined {
  const sym = resolveAnywhere(doc, project, offset)
  if (sym === undefined) return undefined
  const refs = allReferences(docs, project, sym)
  const kept = includeDeclaration
    ? refs
    : refs.filter(
        (r) =>
          !(r.uri === sym.uri && r.range.start.line === sym.span.startLine - 1 && r.range.start.character === sym.span.startCol),
      )
  return toLocations(kept)
}

/** documentHighlight (ST + network text) — every occurrence of the cursor's symbol IN this doc, incl. network-text operand uses. */
export function documentHighlightsAnywhere(doc: Document, project: Scope, offset: number): Range[] | undefined {
  const sym = resolveAnywhere(doc, project, offset)
  if (sym === undefined) return undefined
  return allReferences([doc], project, sym).map((r) => r.range)
}

/** prepareRename (ST + network text) — the editable range for a renameable cursor. */
export function prepareRenameAnywhere(doc: Document, project: Scope, offset: number): Range | undefined {
  if (resolveAnywhere(doc, project, offset) === undefined) return undefined
  const tok = tokenAtOffset(doc.source, offset)
  return tok !== undefined && (tok.kind === "identifier" || tok.kind === "keyword") ? rangeFromSpan(tok.span) : undefined
}

/**
 * rename (ST + network text) — one edit per occurrence across both body kinds. A new name that is a word of the network
 * text (`Execute`, `Parallel`, `R_EDGE` — legal IEC names on both vendors, DIALECT N18) is written between backticks
 * wherever the text reads a bare token — an operand, a target, a call head — because bare there it IS the construct:
 * `x := Execute;` opens an EXECUTE body the push refuses. Inside backticked text (verbatim ST), an EXECUTE box's ST
 * or a path it is plain, as in ST.
 */
export function renameAnywhere(
  docs: Iterable<Document>,
  project: Scope,
  doc: Document,
  offset: number,
  newName: string,
): WorkspaceEdit | undefined {
  const sym = resolveAnywhere(doc, project, offset)
  if (sym === undefined) return undefined
  const all = [...docs]
  const bare = NETWORK_TEXT_WORDS.has(newName.toUpperCase()) ? bareTokenRanges(all, project) : new Set<string>()
  const changes: Record<string, TextEdit[]> = {}
  for (const r of allReferences(all, project, sym))
    (changes[r.uri] ??= []).push({ range: r.range, newText: bare.has(rangeKey(r.uri, r.range)) ? `\`${newName}\`` : newName })
  return { changes }
}

/** Where the network text reads a whole bare token as a name: an operand, a target, a call head. */
function bareTokenRanges(docs: readonly Document[], project: Scope): Set<string> {
  const out = new Set<string>()
  for (const doc of docs)
    for (const { unit, body } of graphicalBodies(doc.parseResult.units))
      for (const network of analyzeNetworkText(unit, body, project, doc.uri).vg.networks)
        for (const s of network.statements) {
          const add = (span: Parameters<typeof rangeFromSpan>[0]): void => void out.add(rangeKey(doc.uri, rangeFromSpan(span)))
          for (const t of statementTargets(s)) if (!t.backticked && !t.unnamed) add(t.span)
          for (const v of walkValues(s)) {
            if (v.kind === "operand" && !v.backticked && !v.unnamed) add(v.span)
            if (v.kind === "call" && !v.backticked && v.unnamedType === undefined) add(v.head.span)
          }
        }
  return out
}

function rangeKey(uri: string, r: Range): string {
  return `${uri}#${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}`
}

// ─── resolution ──────────────────────────────────────────────────────────────

/** The symbol a network text cursor points at: a wire (at its declaration, its definition or a use) or a POU/global
 *  via the operand. */
export function networkResolveAt(doc: Document, project: Scope, offset: number): Symbol | undefined {
  return networkSymbolAt(doc, project, offset)?.sym
}

function networkSymbolAt(
  doc: Document,
  project: Scope,
  offset: number,
): { sym: Symbol; analysis: NetworkTextAnalysis } | undefined {
  const found = vgBodyAt(doc, offset)
  if (found === undefined) return undefined
  const analysis = analyzeNetworkText(found.unit, found.body, project, doc.uri)
  const here = networkNetworkAt(analysis, offset)
  if (here === undefined) return undefined
  const { network, scope } = here
  const hit = (sym: Symbol | undefined) => (sym !== undefined ? { sym, analysis } : undefined)

  // Cursor on a wire's name in the network's `VAR_TEMP` block → the wire symbol itself.
  for (const wire of network.wires)
    if (offset >= wire.name.span.start && offset < wire.name.span.end) return hit(lookupLocal(scope, wire.name.text)[0])

  // Operand path — wrap the network's operand Exprs as statements and reuse the ST descent.
  const stmts = operandStatements(network.statements)
  const member = memberAtOffset(stmts, offset)
  if (member !== undefined) {
    const sym = resolveMemberChain(member, scope, project)
    if (sym !== undefined) return hit(sym)
  }
  const expr = exprAtOffset(stmts, offset)
  if (expr?.kind === "ident_expr") return hit(lookup(scope, expr.name)?.symbol ?? resolveBareEnumMember(project, expr.name))
  return undefined
}

/** Wrap every network-text operand `Expr` as an `expr_stmt` so `exprAtOffset`/`memberAtOffset` descend it — a wire's
 *  definition target included, so a cursor on `g1` in `g1 := …;` finds the wire, and a rename of it edits that name. */
function operandStatements(statements: readonly NetworkTextStatement[]): Statement[] {
  const out: Statement[] = []
  const push = (e: Expr): void => {
    out.push({ kind: "expr_stmt", expr: e, span: e.span })
  }
  for (const s of statements) {
    if (s.kind === "wire_def") push({ kind: "ident_expr", name: s.wire.text, span: s.wire.span })
    for (const e of statementExprs(s)) push(e)
    for (const x of executeBoxes(s)) out.push(...x.statements)
  }
  return out
}

/** The graphical body (with its unit) containing the offset, or undefined. `spanContains` is the one home of
 *  "start inclusive, end exclusive, as a cursor sits" — this open-coded it, character for character. */
function vgBodyAt(doc: Document, offset: number): { unit: TopLevel; body: BodySpan } | undefined {
  for (const b of graphicalBodies(doc.parseResult.units)) if (spanContains(b.body.span, offset)) return b
  return undefined
}
