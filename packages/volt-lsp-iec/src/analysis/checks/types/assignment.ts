/**
 * assignment-type-mismatch (D.2 · types/). For each `target := value;` and each declaration's initial value, flag when
 * the compiler would refuse the implicit conversion. The rule is `rules.assignmentPairError`/`storeConversionError`,
 * shared with the network-text sink check; conservative — a side that isn't elementary or enum skips, so a
 * struct/FB/composite/library type never false-positives.
 */
import { renderTypeExpr, walkStatements } from "../../../syntax/index.js"
import { bodies, forEachDecl, lookup } from "../../../symbols/index.js"
import { isAssignable, literalErrorType, renderType, resolveTypeExpr } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"
import { assignmentPairError, checkable, checkableType, storeConversionError } from "../../rules.js"

/** The target kinds that take an aggregate initializer and refuse a scalar literal. */
const COMPOSITE: ReadonlySet<string> = new Set(["struct", "function_block"])

export function checkAssignmentTypes(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.op !== undefined) return // S=/R=/REF= have different rules
      const diag = assignmentPairError(s.target, s.value, scope, ctx.project, ctx.messages)
      if (diag !== undefined) out.push(diag)
    })
  }
  // A declaration's initial value converts like an assignment — the same rule, recorded for every literal shape
  // (conformance `cc_init_*`: `i : INT := TRUE` is "Cannot convert type 'BOOL' to type 'INT'", `si : SINT := INT#5` INT to
  // SINT, `si : SINT := 100 + 100` silent). Initializers were never type-checked at all (gap 14).
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.init === undefined || decl.init.kind === "aggregate_init") continue
    const resolved = resolveTypeExpr(decl.type, ctx.project)
    // A REFERENCE DECLARATION BINDS, and the compiler type-checks what it binds TO. This check skipped it: a
    // reference is not `checkable` and not in COMPOSITE, so `ref_ : REFERENCE TO INT REF= aString` and
    // `REF= somethingUndeclared` both passed in silence while CODESYS refuses them (`refdecl_target_wrong_type`,
    // `refdecl_target_undeclared` — "Cannot convert type 'STRING' to type 'REFERENCE TO INT'"). The TARGET is
    // what converts, and the message names the REFERENCE type, which is what `renderTypeExpr` prints.
    if (resolved.kind === "reference") {
      const target = checkable(resolved.target)
      const rhs = target === undefined ? undefined : checkableType(decl.init, scope, ctx.project)
      // A NAME THAT RESOLVES TO NOTHING types as `undefined`, which is indistinguishable here from "a type this
      // check does not model" — so it is asked of the SCOPE instead. CODESYS answers the undeclared case with two
      // messages ("Identifier 'nope' not defined", then the conversion); this emits the conversion half, in the
      // shape `struct-init.ts` already uses for the same situation (`refdecl_target_undeclared`).
      if (target !== undefined && rhs === undefined && decl.init.kind === "ident_expr" && lookup(scope, decl.init.name) === undefined) {
        out.push({
          severity: "error",
          span: decl.init.span,
          source: SOURCE,
          code: "assignment-type-mismatch",
          message: ctx.messages.cannotConvert(ctx.messages.unknownType(decl.init.name), renderTypeExpr(decl.type)),
        })
        continue
      }
      if (target !== undefined && rhs !== undefined && !isAssignable(target, rhs))
        out.push({
          severity: "error",
          span: decl.init.span,
          source: SOURCE,
          code: "assignment-type-mismatch",
          message: ctx.messages.cannotConvert(renderType(rhs), renderTypeExpr(decl.type)),
        })
      continue
    }
    const lhs = checkable(resolved)
    if (lhs === undefined) {
      // A composite target takes an AGGREGATE initializer (skipped above) and refuses a scalar LITERAL, which the
      // compiler types to say so: `wrongWay : DUT_C3_point := 7` is "Cannot convert type 'SINT' to type
      // 'DUT_C3_point'" (conformance `cc3_unexpected_struct_init`, `cc3_input_defaults`). `classifyConversion` calls
      // every composite pair compatible on purpose — that conservative default is what kept this silent — so the
      // literal is typed here rather than by widening a relation the whole analysis leans on.
      if (decl.init.kind !== "literal" || !COMPOSITE.has(resolved.kind)) continue
      const rhs = literalErrorType(decl.init, resolved)
      if (rhs === undefined) continue
      out.push({
        severity: "error",
        span: decl.init.span,
        source: SOURCE,
        code: "assignment-type-mismatch",
        message: ctx.messages.cannotConvert(renderType(rhs), renderType(resolved)),
      })
      continue
    }
    const diag = storeConversionError(lhs, decl.init, decl.init.span, scope, ctx.project, ctx.messages)
    if (diag !== undefined) out.push(diag)
  }
}
