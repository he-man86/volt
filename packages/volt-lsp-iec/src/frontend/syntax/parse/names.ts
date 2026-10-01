/**
 * NAMES AS THE PARSER READS THEM — one reader per shape a name takes (openspec frontend-conformance design.md §3.2):
 * an identifier node from its token, a dotted (qualified) name, the rest of a comma-separated name list, and the
 * modifier words before a name. Each caller builds its own node shape from what these read.
 */
import type { Identifier } from "../ast/nodes.js"
import type { Token } from "../lex/tokens.js"
import { ACCESS_MODIFIERS, MEMBER_MODIFIERS, type Keyword } from "../lex/vocabulary.js"
import { vendorTokenText } from "./errors.js"
import { joinSpans } from "../span.js"
import type { Cursor } from "./cursor.js"

/** Convert an identifier token into an Identifier AST node. */
export function identFromToken(tok: Token): Identifier {
  return { kind: "identifier", text: tok.text, span: tok.span }
}

/** An identifier the grammar requires here (`expectIdent`, which reports a missing one), as a node. */
export function readIdent(c: Cursor): Identifier | undefined {
  const t = c.expectIdent()
  return t === undefined ? undefined : identFromToken(t)
}

/**
 * The parts of a dotted name that opens with `first` (already consumed): `first` and each identifier behind a `.`.
 * What a `.` WITHOUT an identifier behind it means differs by position, so the caller says:
 *
 *   `report`   the dot is consumed and "expected identifier after '.'" reported (a type name);
 *   `consume`  the dot is consumed silently (a declared name);
 *   `leave`    the dot is left for whatever follows (an interface's base) — a part is read only when an identifier
 *              stands behind the dot.
 */
export function readQualifiedName(c: Cursor, first: Token, dangling: "report" | "consume" | "leave"): Token[] {
  const parts = [first]
  for (;;) {
    if (dangling === "leave") {
      if (!(c.peek().kind === "punct" && c.peek().text === "." && c.peek(1).kind === "identifier")) break
      c.consume() // .
      parts.push(c.consume())
      continue
    }
    if (c.eatPunct(".") === undefined) break
    const part = c.eatIdent()
    if (part === undefined) {
      if (dangling === "report") c.pushError("expected identifier after '.'", c.peek().span)
      break
    }
    parts.push(part)
  }
  return parts
}

/** A dotted name as ONE identifier node: its parts joined with `.`, spanning them all (the first part alone as is). */
export function joinedName(parts: readonly Token[]): Identifier {
  if (parts.length === 1) return identFromToken(parts[0]!)
  return { kind: "identifier", text: parts.map((p) => p.text).join("."), span: joinSpans(parts[0]!.span, parts.at(-1)!.span) }
}

/**
 * The rest of a comma-separated name list — each name `readOne` reads behind a `,`, up to the first it cannot read.
 * The first name is the caller's: what a missing first name means differs by list.
 */
export function readNameList<T>(c: Cursor, readOne: () => T | undefined): T[] {
  const out: T[] = []
  while (c.eatPunct(",") !== undefined) {
    const more = readOne()
    if (more === undefined) break
    out.push(more)
  }
  return out
}

/**
 * The modifier words before a name, as written and in order. Greedy by default — every keyword of `allowed` in a row
 * (a property's, an interface member's). With `isModifier`, a word is a modifier only when that says so of the token
 * after it — so `FUNCTION_BLOCK PUBLIC Final` names the FB `Final`: the header's lookahead.
 */
export function readModifiers(c: Cursor, allowed: readonly Keyword[], isModifier?: (after: Token) => boolean): Token[] {
  const out: Token[] = []
  for (;;) {
    const here = c.peek()
    if (here.kind !== "keyword" || here.keyword === undefined || !allowed.includes(here.keyword)) break
    if (isModifier !== undefined && !isModifier(c.peek(1))) break
    const mod = c.eatAnyKeyword(...allowed)
    if (mod === undefined) break
    out.push(mod)
  }
  return out
}

/**
 * A NAME IN A UNIT HEADER — a base (`EXTENDS`) or an interface (`IMPLEMENTS`), possibly qualified (`Standard.TON`,
 * `__SYSTEM.IQueryInterface`), as ONE dotted identifier: the one shape every header's names take (U7; a dot with no name
 * behind it is left for what follows). Where none stands, both vendors want an IDENTIFIER whatever the token is — a
 * keyword included: "Identifier expected instead of 'VAR'" (`unit_fb_implements_trailing_comma`, 2026-10-01), not the
 * "Unexpected token" a keyword gets where a declaration's name stands (`nameExpected`).
 */
export function readHeaderName(c: Cursor): Identifier | undefined {
  const head = c.eatIdent()
  if (head === undefined) {
    const t = c.peek()
    c.pushError(`Identifier expected instead of ${vendorTokenText(t)}`, t.span)
    return undefined
  }
  return joinedName(readQualifiedName(c, head, "leave"))
}

/** A header's comma-separated name list (`IMPLEMENTS A, B`, an interface's `EXTENDS A, B`): each a `readHeaderName`. */
export function readHeaderNames(c: Cursor): Identifier[] {
  const first = readHeaderName(c)
  return first === undefined ? [] : [first, ...readNameList(c, () => readHeaderName(c))]
}

/**
 * The access modifier written AFTER another modifier, if one is — refused on every unit kind, because an access
 * modifier stands only first: `PUBLIC FINAL` builds and `FINAL PUBLIC` does not, nor does `PUBLIC PRIVATE`, where
 * `FINAL FINAL` does (`unit_method_final_private_order`, `_two_access`, `_modifier_twice`, `unit_fb_final_public_order`,
 * `unit_property_modifiers_reordered`; both vendors 2026-10-01). What the vendor says about it differs by unit kind,
 * so the caller words it.
 */
export function refusedAccessModifier(mods: readonly Token[]): Token | undefined {
  return mods.find((m, i) => i > 0 && isAccessModifier(m))
}

/**
 * The modifier a PROPERTY refuses, if one is — a PROPERTY (on an FB or an INTERFACE) takes an access modifier first and
 * then ONE of FINAL/ABSTRACT: any modifier after FINAL or ABSTRACT is refused, where a METHOD builds `FINAL FINAL` and
 * calls `ABSTRACT FINAL` a semantic error (`unit_property_abstract_final`, `unit_property_final_twice`,
 * `unit_interface_property_abstract_final`, CODESYS 2026-10-01) — and so is an access modifier after another, as on
 * every unit kind.
 */
export function refusedPropertyModifier(mods: readonly Token[]): Token | undefined {
  return mods.find((m, i) => i > 0 && (isAccessModifier(m) || !isAccessModifier(mods[i - 1]!)))
}

const isAccessModifier = (m: Token): boolean => m.keyword !== undefined && ACCESS_MODIFIERS.includes(m.keyword)

/**
 * A PROPERTY's modifiers, on a function block or an interface, kept as written. An access modifier stands only first
 * and nothing follows FINAL or ABSTRACT (`refusedPropertyModifier`): `PROPERTY FINAL PUBLIC P` is "Unexpected token
 * 'PUBLIC' found" on both vendors (`unit_property_modifiers_reordered`, 2026-10-01) — a property's words for it, not a
 * method's — then the `;` the vendor wants in place of the name: "';' expected instead of 'P'".
 */
export function readPropertyModifiers(c: Cursor): Keyword[] {
  const written = readModifiers(c, MEMBER_MODIFIERS)
  const refused = refusedPropertyModifier(written)
  if (refused !== undefined) {
    c.pushError(`Unexpected token '${refused.text}' found`, refused.span, refused.text)
    c.pushError(`';' expected instead of ${vendorTokenText(c.peek())}`, c.peek().span)
  }
  return written.map((m) => m.keyword!)
}
