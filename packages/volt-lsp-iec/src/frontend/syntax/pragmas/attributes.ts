/**
 * ATTRIBUTES IN THE AST — the `{attribute '…'}` pragmas of a parse, attached ONCE to the node each belongs to
 * (`attachAttributes`, run by the parser): a VAR section's (or a STRUCT's) pragma to the declaration that follows it, any
 * other to the unit it sits in or the unit that follows it. A commented-out attribute is a comment, not a pragma, and is
 * not one (`prag_attribute_commented_out`, `prag_attribute_block_commented_out`: no warning on either vendor).
 *
 * Measured (frontend-conformance 2.7.2, both vendors 2026-10-02): an attribute on a METHOD is the METHOD's —
 * `{attribute 'obsolete'}` there warns at its call (`prag_attribute_on_method`); the lexer ends a pragma at its first
 * `}`, quotes or not (`prag_attribute_brace_in_value`).
 *
 * The readers below fold or pick from the AST; none re-lexes.
 */
import type { Attribute, ParseResult, TopLevel, VarDecl } from "../ast/nodes.js"
import type { Token } from "../lex/tokens.js"

/** The ATTRIBUTES THE FRONT-END ANSWERS BY (design.md §4 2.7): resolution (`qualified_only`), typing (`strict`,
 *  `to_string`) and constancy (`const_replaced`, `const_non_replaced`). Every other attribute is a consumer's. */
export const FRONTEND_ATTRIBUTES = ["qualified_only", "strict", "to_string", "const_replaced", "const_non_replaced"] as const
export type FrontendAttribute = (typeof FRONTEND_ATTRIBUTES)[number]

/** Does `node` carry the front-end attribute `name`? */
export function hasFrontendAttribute(node: { attributes?: readonly Attribute[] }, name: FrontendAttribute): boolean {
  return node.attributes?.some((a) => a.name.toLowerCase() === name) ?? false
}

/** `text` (a whole pragma token) read as an attribute's name and value — undefined for any other pragma. The one
 *  reading of an attribute: the analysis checks ask this, the parser attaches `parseAttribute`'s. */
export function readAttribute(text: string): { name: string; value?: string } | undefined {
  // the word in lower case only: `{ATTRIBUTE '…'}` is no attribute (`prag_rule_unknown_attribute_upper_case`,
  // analysis-conformance 3.10 — CODESYS does not warn about the unknown name it would carry), as every pragma word is
  const m = /^\{\s*attribute\s+'([^']*)'/.exec(text)
  if (m === null) return undefined
  const quoted = /:=\s*'([^']*)'/.exec(text)?.[1]
  // `:= readwrite` — an unquoted value is the empty string to the compiler (`cc4_attribute_value_string`)
  const value = quoted ?? (/'[^']*'\s*:=/.test(text) ? "" : undefined)
  return value === undefined ? { name: m[1]! } : { name: m[1]!, value }
}

/** `text` read as an attribute at `span` — the AST's node. */
function parseAttribute(text: string, span: Attribute["span"]): Attribute | undefined {
  const a = readAttribute(text)
  return a === undefined ? undefined : { ...a, text, span }
}

type Attributed = { attributes?: readonly Attribute[] }

function add(node: Attributed, attribute: Attribute): void {
  ;(node as { attributes?: Attribute[] }).attributes = [...(node.attributes ?? []), attribute]
}

/** The declaration lists of a unit an attribute inside them belongs to: its VAR sections, a STRUCT's or UNION's fields. */
function declarationLists(unit: TopLevel): { span: Attribute["span"]; decls: readonly VarDecl[] }[] {
  if ("varSections" in unit) return unit.varSections
  if (unit.kind === "type_decl" && (unit.body.kind === "struct" || unit.body.kind === "union")) return [{ span: unit.body.span, decls: unit.body.fields }]
  return []
}

/** Attach every attribute pragma of `tokens` to the node of `units` it belongs to. Run once, by the parser. */
export function attachAttributes(units: readonly TopLevel[], tokens: readonly Token[]): void {
  for (const token of tokens) {
    if (token.kind !== "pragma") continue
    const attribute = parseAttribute(token.text, token.span)
    if (attribute === undefined || attribute.name.length === 0) continue
    // a unit's span stops before its END_ keyword, so the first unit ending at or after the pragma holds or follows it
    const unit = units.find((u) => u.span.end >= token.span.end)
    if (unit === undefined) continue
    // one written as a STATEMENT, in a body, belongs to nothing — CODESYS says nothing of an unknown name there
    // (`prag_rule_unknown_attribute_in_body`, analysis-conformance 3.10), and the printer re-wrote it above the unit
    if (bodySpans(unit).some((b) => b.start <= token.span.start && token.span.end <= b.end)) continue
    const list = declarationLists(unit).find((s) => s.span.start <= token.span.start && token.span.end <= s.span.end)
    const decl = list?.decls.find((d) => d.span.start >= token.span.end)
    add(decl ?? unit, attribute)
  }
}

/** The spans of a unit's own bodies — its statement part, a property's accessors' (read from the AST: `format/bodies`
 *  `unitBodies` is a layer above this one). */
function bodySpans(unit: TopLevel): Attribute["span"][] {
  if (unit.kind === "property") return [unit.getter?.body.span, unit.setter?.body.span].filter((s) => s !== undefined)
  if (unit.kind === "function_block" || unit.kind === "program" || unit.kind === "function" || unit.kind === "method" || unit.kind === "action")
    return [unit.body.span]
  return []
}

/** The name, and — when the attribute carries one — `name=value` beside it, so a consumer that needs the VALUE has it
 *  while every `.has(name)` check keeps answering. `{attribute 'pack_mode' := '1'}` gives `pack_mode` and `pack_mode=1`. */
function namesOf(attributes: readonly Attribute[], into = new Set<string>()): Set<string> {
  for (const a of attributes) {
    into.add(a.name.toLowerCase())
    if (a.value !== undefined && a.value.length > 0) into.add(`${a.name.toLowerCase()}=${a.value.toLowerCase()}`)
  }
  return into
}

/** The attribute names on each variable declaration (`{attribute 'instance-path'}` above `sPath : STRING(255);`). */
export function declarationAttributes(parseResult: ParseResult): Map<VarDecl, Set<string>> {
  const out = new Map<VarDecl, Set<string>>()
  for (const unit of parseResult.units)
    for (const list of declarationLists(unit))
      for (const decl of list.decls) if (decl.attributes !== undefined) out.set(decl, namesOf(decl.attributes))
  return out
}

const MEMBER_KINDS = new Set(["method", "action", "property"])

/** The attribute names on each METHOD, ACTION and PROPERTY itself — the ones `unitAttributes` folds into their POU, for
 *  a consumer that must know WHICH member carries one (a `call_after_global_init_slot` method). */
export function memberAttributes(parseResult: ParseResult): Map<TopLevel, Set<string>> {
  const out = new Map<TopLevel, Set<string>>()
  for (const unit of parseResult.units) if (MEMBER_KINDS.has(unit.kind) && unit.attributes !== undefined) out.set(unit, namesOf(unit.attributes))
  return out
}

/** The attribute names in force on each POU: its own, its members' (the one-item-per-file layout the binder parents them
 *  by) and its declarations'. */
export function unitAttributes(parseResult: ParseResult): Map<TopLevel, Set<string>> {
  const out = new Map<TopLevel, Set<string>>()
  let owner: TopLevel | undefined
  for (const unit of parseResult.units) {
    if (!MEMBER_KINDS.has(unit.kind)) owner = unit
    const pou = MEMBER_KINDS.has(unit.kind) ? owner : unit
    if (pou === undefined) continue
    const own = [...(unit.attributes ?? []), ...declarationLists(unit).flatMap((l) => l.decls.flatMap((d) => d.attributes ?? []))]
    if (own.length === 0) continue
    out.set(pou, namesOf(own, out.get(pou)))
  }
  return out
}
