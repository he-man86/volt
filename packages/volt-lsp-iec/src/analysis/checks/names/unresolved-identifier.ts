/**
 * unresolved-identifier (D.2 · names/). A bare identifier reference whose name resolves in NO reachable
 * scope → error `Identifier '<name>' not defined` (byte-identical on both compilers). Mirrors what the
 * IDE rejects; a compiler-parity check, so it runs always. The resolution rules (and the whole skip surface)
 * live in `identifier-resolution` — shared verbatim with the network-text `network-undeclared-identifier` check.
 *
 * Emits two codes: `unresolved-identifier` (a bare name — `undefinedIdentifier`) and `unknown-member`
 * (`a.b` where `b` is not on `a`'s type — `unresolvedMembers`/`notAMember`). Member access is conservative:
 * only a PROJECT (non-library) struct/FB/enum base with a fully-resolved EXTENDS chain is checked, so
 * library-typed and namespace-qualified refs never false-positive (see `_identifier-resolution`).
 *
 * Bodies with a conditional-compile pragma (`{IF}`/`{ELSIF}`/`{ELSE}`/`{END_IF}`) are SKIPPED whole: the
 * compilers strip dead branches before analysis but we have no preprocessor, so checking would
 * false-positive on stripped-branch references.
 */
import { stmtExprs, walkStatements, type BodySpan } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"
import { unresolvedInExprs, unresolvedMembers } from "./_identifier-resolution.js"

/** `{IF ...}` / `{ELSIF ...}` / `{ELSE}` / `{END_IF}` — permissive on inner leading whitespace. */
const CONDITIONAL_PRAGMA_RE = /^\{\s*(?:IF|ELSIF|ELSE|END_IF)\b/i

export function checkUnresolvedIdentifiers(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { body, scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    if (bodyHasConditionalPragma(body)) continue
    walkStatements(statements, (stmt) => {
      const exprs = stmtExprs(stmt)
      for (const ref of unresolvedInExprs(exprs, scope, ctx.project, ctx.references)) {
        out.push({
          severity: "error",
          span: ref.span,
          source: SOURCE,
          code: "unresolved-identifier",
          message: ctx.messages.undefinedIdentifier(ref.name),
        })
      }
      for (const ref of unresolvedMembers(exprs, scope, ctx.project)) {
        out.push({
          severity: "error",
          span: ref.span,
          source: SOURCE,
          code: "unknown-member",
          message: ctx.messages.notAMember(ref.member, ref.typeName),
        })
      }
    })
  }
}

/** True when the body carries a conditional-compile directive (gates the whole-body skip). */
function bodyHasConditionalPragma(body: BodySpan): boolean {
  return body.tokens.some((t) => t.kind === "pragma" && CONDITIONAL_PRAGMA_RE.test(t.text))
}
