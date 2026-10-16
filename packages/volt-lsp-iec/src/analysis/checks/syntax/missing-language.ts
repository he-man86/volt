/**
 * A BODY THAT STATES NO LANGUAGE — no `IMPLEMENTATION` line opens it, so it is read by NEITHER reader, never ST by default
 * (spec: a missing language "is an LSP diagnostic … never guessed"). ONE finding names it, on the body's first line of
 * code (or the body itself when it holds none): the push's own refusal of the same file (`StReader.Unmarked`), seen here
 * first. Outside the registry, like `checks/network`: the composition (`pipeline/document.ts`) quiets every other finding
 * inside these bodies, and this finding follows the push, not the build's dead-code rule.
 */
import {
  allUnits,
  IMPLEMENTATION_KEYWORD,
  isTrivia,
  lookalikeLine,
  unitBodies,
  type BodySpan,
  type TopLevel,
} from "../../../frontend/syntax/index.js"
import { missingLanguageMessage } from "../../messages/syntax.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

/** The finding's slug. It has no compiler code, and the server gives it none on the wire. */
export const MISSING_LANGUAGE = "missing-language"

/** A body that states no language, with the item it belongs to as the push names it. */
interface UnstatedBody {
  body: BodySpan
  what: string
}

/** The bodies that state no language — no `IMPLEMENTATION` line opens them. */
export function unstatedBodies(units: readonly TopLevel[]): UnstatedBody[] {
  return allUnits(units).flatMap((u): UnstatedBody[] =>
    unitBodies(u)
      .filter((body) => body.implementation === undefined)
      .map((body) => ({
        body,
        what:
          u.kind === "property"
            ? `${u.name.text}'s ${body === u.getter?.body ? "getter" : "setter"}`
            : "name" in u
              ? u.name.text
              : u.kind,
      })),
  )
}

/** The finding for one unstated body. */
export function missingLanguage({ body, what }: UnstatedBody): DiagnosticItem {
  const first = body.tokens.find((t) => !isTrivia(t.kind) && t.kind !== "eof")
  return {
    severity: "error",
    span: first?.span ?? body.span,
    source: SOURCE,
    code: MISSING_LANGUAGE,
    message: missingLanguageMessage(what, IMPLEMENTATION_KEYWORD, lookalikeLine(body.tokens)),
  }
}
