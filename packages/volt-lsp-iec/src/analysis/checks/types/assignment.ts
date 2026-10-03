/**
 * assignment-type-mismatch (D.2 · types/). For each `target := value;` and each declaration's initial value, flag when
 * the compiler would refuse the implicit conversion. The rule is `rules.assignmentPairError`/`storeConversionError`,
 * shared with the network-text sink check; conservative — a side that isn't elementary or enum skips, so a
 * struct/FB/composite/library type never false-positives.
 */
import { walkStatements } from "../../../frontend/syntax/index.js"
import { bodies, forEachDecl, hasUnresolvedBase } from "../../../frontend/symbols/index.js"
import { elementaryRef, literalErrorType, renderType, resolveTypeExpr } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"
import { nameResolves } from "../../resolution.js"
import { assignmentPairError, checkable, checkableType, storeConversionError } from "../../rules.js"

/** What `S=` and `R=` set and read. */
const BOOL = elementaryRef("BOOL")

/** The target kinds that take an aggregate initializer and refuse a scalar literal. */
const COMPOSITE: ReadonlySet<string> = new Set(["struct", "function_block"])

export function checkAssignmentTypes(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign") return
      // `S=` / `R=` SET OR RESET A BOOL FROM A BOOL: an INT target is "Cannot convert type 'INT' to type 'BOOL'", and so is
      // an INT operand (`stmt_s_eq_non_bool_target`, `stmt_s_eq_non_bool_value`, both vendors 2026-10-02) — each side
      // converted to BOOL by the one store rule. REF= is `reference-assign`'s.
      if (s.op === "S=" || s.op === "R=") {
        for (const side of [s.target, s.value]) {
          const diag = storeConversionError(BOOL, side, side.span, scope, ctx.project, ctx.messages, "assignment")
          if (diag !== undefined) out.push(diag)
        }
        return
      }
      if (s.op !== undefined) return
      const diag = assignmentPairError(s.target, s.value, scope, ctx.project, ctx.messages)
      if (diag !== undefined) out.push(diag)
    })
  }
  // A declaration's initial value converts like an assignment — the same rule, recorded for every literal shape
  // (conformance `cc_init_*`: `i : INT := TRUE` is "Cannot convert type 'BOOL' to type 'INT'", `si : SINT := INT#5` INT to
  // SINT, `si : SINT := 100 + 100` silent). Initializers were never type-checked at all (gap 14).
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.init === undefined || decl.init.kind === "aggregate_init") continue
    const resolved = resolveTypeExpr(decl.type, ctx.project, 0, ctx.project, ctx.uri)
    // A REFERENCE DECLARATION BINDS, and the compiler type-checks what it binds TO. This check skipped it: a
    // reference is neither `checkable` nor in COMPOSITE, so `ref_ : REFERENCE TO INT REF= aString` and
    // `REF= somethingUndeclared` both passed in silence while CODESYS refuses them (`refdecl_target_wrong_type`,
    // `refdecl_target_undeclared`). The message names the REFERENCE type, which is what the recordings show.
    //
    // THE RULE IS EXACT TYPE, NOT ASSIGNABILITY, and it is not re-derived here: `checks/types/reference-assign.ts`
    // measured it for the STATEMENT form (`cc3_reference_assign`, `cc6_reference_assign_literal`) and a
    // declaration bind is the same operation. The first cut used `isAssignable`, which made the check
    // inconsistent with itself — it flagged `REF= aDint` and stayed silent on `REF= aSint`, though CODESYS
    // refuses both.
    //
    // AND RESOLUTION IS ASKED OF THE SHARED ORACLE. A bare `lookup` said "undeclared" for every name the oracle
    // exists to excuse — a member inherited from an EXTENDS base that did not materialize, `SUPER`, a library
    // namespace, a device instance, a bare enum member — each of which would have been a false positive on real
    // code that the corpus happens not to contain in this shape.
    if (resolved.kind === "reference") {
      const referenced = resolved.target
      if (decl.init.kind === "ident_expr" && !nameResolves(decl.init.name, scope)) {
        if (hasUnresolvedBase(scope)) continue // the base could declare it; `resolution.ts` skips for the same reason
        out.push({
          severity: "error",
          span: decl.init.span,
          source: SOURCE,
          code: "assignment-type-mismatch",
          message: ctx.messages.cannotConvert(ctx.messages.unknownType(decl.init.name), renderType(resolved, { form: "compiler" })),
        })
        continue
      }
      const rhs = checkableType(decl.init, scope, ctx.project)
      // EXACT: the referenced type must BE the reference's own. `checkable` on both sides keeps the conservative
      // default — a composite or library type on either side skips, as everywhere else in this file.
      if (rhs !== undefined && checkable(referenced) !== undefined && renderType(referenced, { form: "compiler" }) !== renderType(rhs, { form: "compiler" }))
        out.push({
          severity: "error",
          span: decl.init.span,
          source: SOURCE,
          code: "assignment-type-mismatch",
          message: ctx.messages.cannotConvert(renderType(rhs, { form: "compiler" }), renderType(resolved, { form: "compiler" })),
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
    const diag = storeConversionError(lhs, decl.init, decl.init.span, scope, ctx.project, ctx.messages, "initial value")
    if (diag !== undefined) out.push(diag)
  }
}
