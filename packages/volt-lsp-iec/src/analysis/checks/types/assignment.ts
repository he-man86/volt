/**
 * assignment-type-mismatch (D.2 · types/). For each `target := value;` and each declaration's initial value, flag when
 * the compiler would refuse the implicit conversion. The rule is `rules.assignmentPairError`/`storeConversionError`,
 * shared with the network-text sink check; conservative — a side that isn't elementary or enum skips, so a
 * struct/FB/composite/library type never false-positives.
 */
import { walkStatements, type Assignment, type Expr } from "../../../frontend/syntax/index.js"
import { bodies, forEachDecl, type Scope } from "../../../frontend/symbols/index.js"
import { elementaryRef, inferExprType, literalErrorType, renderType, resolveTypeExpr, type Type } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, withFixes, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { nameResolves } from "../../shared/resolution.js"
import { assignmentPairError, checkable, checkableType, conversionWrap, storeConversionError } from "../../shared/rules.js"

/** What `S=` and `R=` set and read. */
const BOOL = elementaryRef("BOOL")

/** The target kinds that take an aggregate initializer and refuse a scalar literal — a STRUCT, a function block and an
 *  ARRAY (`litc_array_*`, both vendors 2026-10-06). */
const COMPOSITE: ReadonlySet<string> = new Set(["struct", "function_block", "array"])

/** A plain `:=` store, link by link — see the chain note inside. */
function checkPlainStore(ctx: CheckContext, s: Assignment, scope: Scope, out: DiagnosticItem[]): void {
  // A CHAIN IS A STORE PER LINK: `a := b := c` stores `c` into `b` and `b` into `a`, and each link is refused for its
  // own pair — `viaWide : SINT := wide : DINT := narrowFrom : INT` is "Cannot convert type 'DINT' to type 'SINT'", and
  // `a : INT := b : TIME := c : INT` is refused twice (`qf_c0032_chain_outer`, `_chain_both`, both vendors 2026-10-12).
  // This compared the OUTER target with the FINAL value, which named the wrong pair and missed a refused inner link.
  // A `S=`/`R=` link inside the chain is not a store this rule judges (`assign_chained_mixed`).
  const places = [s.target, ...(s.chained ?? [])]
  const ops = s.chainOps ?? []
  places.forEach((place, i) => {
    if (i > 0 && ops[i - 1] !== undefined) return
    const value = places[i + 1] ?? s.value
    const pair = assignmentPairError(place, value, scope, ctx.project, ctx.messages)
    // the store's fix: wrap the value in `TO_<target>(…)` (design.md §4 F1) — not preferred, an error's value may be the
    // wrong variable; the rule is shared with network text, whose findings get no fix, so the ST statement attaches it.
    // Only the INNERMOST link stores a value: an outer link's value is the next target, which `TO_<T>(b) := c` cannot be.
    if (pair !== undefined)
      out.push(i === places.length - 1 ? withFixes(pair, [conversionWrap(place, value, scope, ctx.project, ctx.source, false)]) : pair)
    else if (i === places.length - 1) {
      const diag = compositeLiteral(ctx, place, value, scope)
      if (diag !== undefined) out.push(diag)
    }
  })
}

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
      checkPlainStore(ctx, s, scope, out)
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
      // an UNDECLARED target is a hole, reported once by `unknown-source` beside "Identifier … not defined" — this said it
      // too, and CODESYS says it once (`refdecl_target_undeclared`, analysis-conformance 3.2.3)
      if (decl.init.kind === "ident_expr" && !nameResolves(decl.init.name, scope)) continue
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
      // a composite target refuses a scalar literal (`compositeLiteralInto`); an aggregate initializer is skipped above
      const diag = compositeLiteralInto(ctx, resolved, decl.init)
      if (diag !== undefined) out.push(diag)
      continue
    }
    const diag = storeConversionError(lhs, decl.init, decl.init.span, scope, ctx.project, ctx.messages, "initial value")
    if (diag !== undefined) out.push(diag)
  }
}

/** A scalar literal stored by a STATEMENT into a composite target (`rec := 1`, `litc_struct_assign_*`), as an initial value is. */
function compositeLiteral(ctx: CheckContext, target: Expr, value: Expr, scope: Scope): DiagnosticItem | undefined {
  return compositeLiteralInto(ctx, inferExprType(target, scope, ctx.project), value)
}

/**
 * A composite target takes an AGGREGATE initializer and refuses a scalar LITERAL, which the compiler types to say so:
 * `wrongWay : DUT_C3_point := 7` is "Cannot convert type 'SINT' to type 'DUT_C3_point'" (conformance
 * `cc3_unexpected_struct_init`, `cc3_input_defaults`), `rec := 1` names a BIT (`literal` `literalErrorType`). `classifyConversion`
 * calls every composite pair compatible on purpose — that conservative default is what kept this silent — so the literal
 * is typed here rather than by widening a relation the whole analysis leans on. A POU read by its NAME is unmeasured.
 */
function compositeLiteralInto(ctx: CheckContext, target: Type, value: Expr): DiagnosticItem | undefined {
  if (!COMPOSITE.has(target.kind) || (target.kind === "function_block" && target.byName === true)) return undefined
  const rhs = literalErrorType(value, target)
  if (rhs === undefined) return undefined
  return { severity: "error", span: value.span, source: SOURCE, code: "assignment-type-mismatch", message: ctx.messages.cannotConvert(renderType(rhs), renderType(target)) }
}
