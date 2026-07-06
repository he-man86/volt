/**
 * unresolved-identifier (D.2 · names/). A bare identifier reference whose name resolves in NO reachable
 * scope → error `Identifier '<name>' not defined` (byte-identical on both compilers). Mirrors what the
 * IDE rejects; a compiler-parity check, so it runs always. The resolution rules (and the whole skip surface)
 * live in `identifier-resolution` — shared verbatim with the VG `vg-undeclared-identifier` check.
 *
 * Bodies with a conditional-compile pragma (`{IF}`/`{ELSIF}`/`{ELSE}`/`{END_IF}`) are SKIPPED whole: the
 * compilers strip dead branches before analysis but we have no preprocessor, so checking would
 * false-positive on stripped-branch references.
 *
 * ponytail: bare-reference resolution only. Member access (`a.b`) is DEFERRED — it needs the member's owning
 * type scope and is the highest-FP surface (library-typed bases, methods vs symbols); add it as a separately
 * gated follow-on once bare resolution holds 0-FP on the corpus.
 */
import { parseStatements, stmtExprs, walkStatements, type BodySpan } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { findScopeForUnit, getBody, SOURCE, type DiagnosticItem } from "../_shared.js"
import { unresolvedInExprs } from "./_identifier-resolution.js"

/** `{IF ...}` / `{ELSIF ...}` / `{ELSE}` / `{END_IF}` — permissive on inner leading whitespace. */
const CONDITIONAL_PRAGMA_RE = /^\{\s*(?:IF|ELSIF|ELSE|END_IF)\b/i

export function checkUnresolvedIdentifiers(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    const body = getBody(unit)
    if (body === undefined) continue
    const scope = findScopeForUnit(ctx.project, unit)
    if (scope === undefined) continue
    if (bodyHasConditionalPragma(body)) continue
    const parsed = parseStatements(body)
    if (!parsed.ok) continue

    walkStatements(parsed.statements, (stmt) => {
      for (const ref of unresolvedInExprs(stmtExprs(stmt), scope, ctx.project, ctx.references)) {
        out.push({
          severity: "error",
          span: ref.span,
          source: SOURCE,
          code: "unresolved-identifier",
          message: ctx.messages.undefinedIdentifier(ref.name),
        })
      }
    })
  }
}

/** True when the body carries a conditional-compile directive (gates the whole-body skip). */
function bodyHasConditionalPragma(body: BodySpan): boolean {
  return body.tokens.some((t) => t.kind === "pragma" && CONDITIONAL_PRAGMA_RE.test(t.text))
}
