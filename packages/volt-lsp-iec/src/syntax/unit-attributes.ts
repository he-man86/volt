/**
 * The `{attribute '…'}` names in force on each POU of a parsed file. The AST keeps no pragmas, so this reads the LEXER's
 * `pragma` tokens — a commented-out attribute is a comment, not a pragma, and is correctly ignored (as the binder's
 * `qualified_only` detection does). A pragma belongs to the unit it sits in or the unit that follows it; a METHOD's,
 * ACTION's or PROPERTY's attributes fold into the POU before it, the one-item-per-file layout the binder parents them by.
 */
import type { ParseResult, TopLevel } from "./ast.js"
import { lex } from "./lexer.js"

/** The `{attribute '…'}` names on each METHOD, ACTION and PROPERTY itself — the ones `unitAttributes` folds into their POU,
 *  for a consumer that must know WHICH member carries one (a `call_after_global_init_slot` method). */
export function memberAttributes(parseResult: ParseResult, source: string): Map<TopLevel, Set<string>> {
  const members = new Set<TopLevel>(parseResult.units.filter((u) => u.kind === "method" || u.kind === "action" || u.kind === "property"))
  const out = new Map<TopLevel, Set<string>>()
  for (const token of lex(source)) {
    if (token.kind !== "pragma") continue
    const name = /^\{\s*attribute\s+'([^']+)'/i.exec(token.text)?.[1]
    const unit = name === undefined ? undefined : parseResult.units.find((u) => u.span.end >= token.span.end)
    if (unit === undefined || !members.has(unit)) continue
    const names = out.get(unit) ?? new Set<string>()
    names.add(name!.toLowerCase())
    out.set(unit, names)
  }
  return out
}

export function unitAttributes(parseResult: ParseResult, source: string): Map<TopLevel, Set<string>> {
  const units = parseResult.units
  const ownerOf = new Map<TopLevel, TopLevel>()
  let owner: TopLevel | undefined
  for (const unit of units) {
    if (unit.kind === "method" || unit.kind === "action" || unit.kind === "property") {
      if (owner !== undefined) ownerOf.set(unit, owner)
    } else owner = unit
  }
  const out = new Map<TopLevel, Set<string>>()
  for (const token of lex(source)) {
    if (token.kind !== "pragma") continue
    const name = /^\{\s*attribute\s+'([^']+)'/i.exec(token.text)?.[1]
    // a unit's span stops before its END_ keyword, so the first unit ending at or after the pragma holds or follows it
    const unit = name === undefined ? undefined : units.find((u) => u.span.end >= token.span.end)
    if (unit === undefined) continue
    const pou = ownerOf.get(unit) ?? unit
    const names = out.get(pou) ?? new Set<string>()
    names.add(name!.toLowerCase())
    out.set(pou, names)
  }
  return out
}
