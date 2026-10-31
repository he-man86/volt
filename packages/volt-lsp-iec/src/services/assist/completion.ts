/**
 * completion (Layer E · E.3 · assist). Two modes:
 *   - MEMBER `base.|` — offers the members of `base`'s type (FB/struct/enum/interface), walking the
 *     EXTENDS chain. `base` is resolved through scope lookup or as a static type/enum/namespace name.
 *   - SCOPE — offers every symbol visible from the cursor (local scope → parents → EXTENDS → globals),
 *     plus the common ST keywords.
 * ponytail: member detection handles a single-identifier base (`inst.|`); a deep chain (`a.b.|`) falls
 * back to scope completion. Upgrade to full-chain resolution when a case needs it.
 */
import { CompletionItemKind, type CompletionItem } from "vscode-languageserver-protocol"
import { bodiesAt, dialectOf, findChildScope, lookup, type Scope, type Symbol, visibleNames } from "../../frontend/symbols/index.js"
import { memberScopeOf, resolveTypeExpr } from "../../frontend/types/index.js"
import { SYMBOL_KINDS, scopeAtOffset } from "../shared/index.js"
import { attributeNames, type Dialect, isPlainStNetworkBody, plainStText, UNNAMED } from "../../frontend/syntax/index.js"
import { pragmaHelp } from "./builtin-hover.js"
import type { Document } from "../shared/index.js"

export function completion(doc: Document, project: Scope, offset: number): CompletionItem[] {
  const attrs = attributeCompletions(doc.source, offset, dialectOf(project))
  if (attrs !== undefined) return attrs
  const items = completionAtScope(scopeAtOffset(doc, project, offset), project, doc.source, offset)
  const hidden = outOfNetwork(doc, project, offset)
  return hidden.size === 0 ? items : items.filter((i) => !hidden.has(i.label.toLowerCase()))
}

/**
 * The names a network body's scope holds that the network at `offset` must not offer: every OTHER network's wires (one
 * scope holds the whole body's wires, so rename and references see one symbol per wire — `network-scope.ts` — but a
 * wire is its own network's) and `???`, the IDE's unnamed operand, no variable. Lower-cased.
 */
function outOfNetwork(doc: Document, project: Scope, offset: number): Set<string> {
  const hidden = new Set<string>()
  for (const { body } of bodiesAt(doc.parseResult.units, project, offset)) {
    if (!isPlainStNetworkBody(body)) return hidden
    hidden.add(UNNAMED)
    const networks = plainStText(body).networks
    const here = networks.find((n) => n.span.start <= offset && offset <= n.span.end)
    const own = new Set(here?.wires.map((w) => w.name.toLowerCase()))
    for (const n of networks) for (const w of n.wires) if (!own.has(w.name.toLowerCase())) hidden.add(w.name.toLowerCase())
    return hidden
  }
  return hidden
}

/** Inside `{attribute '<partial>'}` → the DIALECT's attribute names (the `unknown-attribute` catalog as an
 *  oracle — so a CODESYS project is never offered a `Tc*` name its own compiler warns about). */
function attributeCompletions(src: string, offset: number, dialect: Dialect): CompletionItem[] | undefined {
  const open = src.lastIndexOf("{", offset - 1)
  if (open === -1 || !/^\{\s*attribute\s+'[^'}]*$/i.test(src.slice(open, offset))) return undefined
  return attributeNames(dialect).map((name) => {
    const detail = pragmaHelp(name, dialect)
    return { label: name, kind: CompletionItemKind.EnumMember, ...(detail !== undefined ? { detail } : {}) }
  })
}

/**
 * Completion against an explicit resolution scope — the shared core of ST and network text completion. `base.|`
 * offers members of `base`'s type; otherwise every symbol visible from `scope` + common keywords.
 */
function completionAtScope(scope: Scope, project: Scope, source: string, offset: number): CompletionItem[] {
  const base = memberBaseAt(source, offset)
  if (base !== undefined) {
    const members = memberCompletions(base, scope, project)
    if (members.length > 0) return members
  }
  return scopeCompletions(scope)
}

/** The single-identifier base of a `base.<partial>` at the cursor, or undefined. */
function memberBaseAt(src: string, offset: number): string | undefined {
  let i = offset
  while (i > 0 && isIdentChar(src[i - 1])) i -= 1 // skip the partial member being typed
  if (i === 0 || src[i - 1] !== ".") return undefined
  let k = i - 1
  while (k > 0 && isIdentChar(src[k - 1])) k -= 1
  const base = src.slice(k, i - 1)
  return base.length > 0 ? base : undefined
}

function isIdentChar(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c)
}

function memberCompletions(base: string, scope: Scope, project: Scope): CompletionItem[] {
  const sym = lookup(scope, base)?.symbol
  // GVL-qualified `GvlName.field`: a GVL block has no child scope — its vars live flat on the project scope,
  // tagged by the block's uri (incl. qualified_only vars, which REQUIRE this qualified form).
  if (sym?.kind === "gvl_block") {
    const items: CompletionItem[] = []
    const seen = new Set<string>()
    for (const list of project.symbols.values())
      for (const m of list) if (m.kind === "gvl_var" && m.uri === sym.uri && addOnce(seen, m.name)) items.push(item(m))
    return items
  }
  let memberScope: Scope | undefined
  if (sym?.typeExpr !== undefined) memberScope = memberScopeOf(resolveTypeExpr(sym.typeExpr, project))
  memberScope ??= findChildScope(project, base) // static: an enum/namespace/type/FB name
  if (memberScope === undefined) return []

  const items: CompletionItem[] = []
  const seen = new Set<string>()
  for (const m of visibleNames(memberScope, false)) if (addOnce(seen, m.name)) items.push(item(m))
  return items
}

function scopeCompletions(scope: Scope): CompletionItem[] {
  const items: CompletionItem[] = []
  const seen = new Set<string>()
  for (const m of visibleNames(scope, true)) if (addOnce(seen, m.name)) items.push(item(m))
  for (const kw of KEYWORDS) if (addOnce(seen, kw)) items.push({ label: kw, kind: CompletionItemKind.Keyword })
  return items
}

const KEYWORDS = [
  "IF",
  "THEN",
  "ELSIF",
  "ELSE",
  "END_IF",
  "CASE",
  "OF",
  "END_CASE",
  "FOR",
  "TO",
  "BY",
  "DO",
  "END_FOR",
  "WHILE",
  "END_WHILE",
  "REPEAT",
  "UNTIL",
  "END_REPEAT",
  "RETURN",
  "EXIT",
  "CONTINUE",
  "TRUE",
  "FALSE",
  "AND",
  "OR",
  "XOR",
  "NOT",
  "MOD",
]

function addOnce(seen: Set<string>, name: string): boolean {
  const key = name.toLowerCase()
  if (seen.has(key)) return false
  seen.add(key)
  return true
}

function item(sym: Symbol): CompletionItem {
  return { label: sym.name, kind: SYMBOL_KINDS[sym.kind].completion, detail: SYMBOL_KINDS[sym.kind].human }
}
