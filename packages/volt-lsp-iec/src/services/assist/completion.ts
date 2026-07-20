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
import { findChildScope, lookup, type Scope, type Symbol, type SymbolKind } from "../../symbols/index.js"
import { resolveTypeExpr, type Type } from "../../types/index.js"
import { KNOWN_ATTRIBUTE_NAMES, pragmaHelp } from "../../reference/index.js"
import { humanKind, scopeAtOffset, type Document } from "../shared/index.js"

export function completion(doc: Document, project: Scope, offset: number): CompletionItem[] {
  const attrs = attributeCompletions(doc.source, offset)
  if (attrs !== undefined) return attrs
  return completionAtScope(scopeAtOffset(doc, project, offset), project, doc.source, offset)
}

/** Inside `{attribute '<partial>'}` → the known attribute names (the `unknown-attribute` catalog as an oracle). */
function attributeCompletions(src: string, offset: number): CompletionItem[] | undefined {
  const open = src.lastIndexOf("{", offset - 1)
  if (open === -1 || !/^\{\s*attribute\s+'[^'}]*$/i.test(src.slice(open, offset))) return undefined
  return KNOWN_ATTRIBUTE_NAMES.map((name) => ({
    label: name,
    kind: CompletionItemKind.EnumMember,
    ...(pragmaHelp(name) !== undefined ? { detail: pragmaHelp(name) } : {}),
  }))
}

/**
 * Completion against an explicit resolution scope — the shared core of ST and VG completion. `base.|`
 * offers members of `base`'s type; otherwise every symbol visible from `scope` + common keywords.
 */
export function completionAtScope(scope: Scope, project: Scope, source: string, offset: number): CompletionItem[] {
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
  if (sym?.typeExpr !== undefined) memberScope = scopeOfType(resolveTypeExpr(sym.typeExpr, project))
  memberScope ??= findChildScope(project, base) // static: an enum/namespace/type/FB name
  if (memberScope === undefined) return []

  const items: CompletionItem[] = []
  const seen = new Set<string>()
  for (let s: Scope | undefined = memberScope; s !== undefined; s = s.baseScope) {
    for (const list of s.symbols.values()) {
      for (const m of list) if (addOnce(seen, m.name)) items.push(item(m))
    }
  }
  return items
}

function scopeOfType(t: Type): Scope | undefined {
  return t.kind === "enum" || t.kind === "struct" || t.kind === "function_block" || t.kind === "interface" ? t.scope : undefined
}

function scopeCompletions(scope: Scope): CompletionItem[] {
  const items: CompletionItem[] = []
  const seen = new Set<string>()
  for (let s: Scope | undefined = scope; s !== undefined; s = s.parent) {
    for (let b: Scope | undefined = s; b !== undefined; b = b.baseScope) {
      for (const list of b.symbols.values()) {
        for (const m of list) if (addOnce(seen, m.name)) items.push(item(m))
      }
    }
  }
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
  return { label: sym.name, kind: completionKind(sym.kind), detail: humanKind(sym.kind) }
}

function completionKind(kind: SymbolKind): CompletionItemKind {
  switch (kind) {
    case "function_block":
    case "program":
      return CompletionItemKind.Class
    case "function":
      return CompletionItemKind.Function
    case "method":
    case "action":
    case "interface_method":
      return CompletionItemKind.Method
    case "property":
    case "interface_property":
      return CompletionItemKind.Property
    case "interface":
      return CompletionItemKind.Interface
    case "type":
      return CompletionItemKind.Struct
    case "enum_value":
      return CompletionItemKind.EnumMember
    case "struct_field":
      return CompletionItemKind.Field
    default:
      return CompletionItemKind.Variable
  }
}
