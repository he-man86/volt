/**
 * NAMES AS THE PARSER READS THEM — one reader per shape a name takes (openspec frontend-conformance design.md §3.2):
 * an identifier node from its token, a dotted (qualified) name, the rest of a comma-separated name list, and the
 * modifier words before a name. Each caller builds its own node shape from what these read.
 */
import type { Identifier } from "../ast/nodes.js"
import type { Token } from "../lex/tokens.js"
import type { Keyword } from "../lex/vocabulary.js"
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
