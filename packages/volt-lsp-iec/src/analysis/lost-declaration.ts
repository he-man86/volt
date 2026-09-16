/**
 * lost-declaration — what follows when the COMPILER never saw a declaration the LSP's parser did. CODESYS drops the
 * whole declaration in several situations the LSP recovers from, and then answers `Identifier 'x' not defined` at
 * every use; `checks/types/unknown-source` carries the hole on from there, so one dropped name is typically four or
 * five errors. Three checks share this (each with its own recording):
 *
 *   - a VAR_EXTERNAL the project has no VAR_GLOBAL for  (`cc2_constant_and_external`)
 *   - a `VAR NON_RETAIN` section, which CODESYS has no  (`var_non_retain`)
 *   - an `AT` clause whose operand is not an address    (`cc5_at_address_not_direct`)
 */
import { stmtExprs, walkExpr, walkStatements } from "../syntax/index.js"
import { bodies } from "../symbols/index.js"
import type { CheckContext } from "./diagnostics.js"
import { SOURCE, type DiagnosticItem } from "./diagnostic-item.js"

/** Report every use of a name the compiler never declared. `lost` holds LOWER-CASE names (IEC is case-insensitive). */
export function reportLostUses(ctx: CheckContext, out: DiagnosticItem[], lost: ReadonlySet<string>): void {
  if (lost.size === 0) return
  for (const { statements } of bodies(ctx.parseResult.units, ctx.project))
    walkStatements(statements, (s) => {
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          if (x.kind !== "ident_expr" || !lost.has(x.name.toLowerCase())) return
          out.push({
            severity: "error",
            span: x.span,
            source: SOURCE,
            code: "unresolved-identifier",
            message: ctx.messages.undefinedIdentifier(x.name),
          })
        })
    })
}
