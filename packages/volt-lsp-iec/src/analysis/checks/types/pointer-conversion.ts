/**
 * pointer-conversion (types/). A pointer value implicitly stored into an elementary target that cannot hold it — an
 * assignment (`w := ptr`) or a declaration's initial value (`dw : DWORD := ADR(x)`, `ptrsc_initializer_into_dword`). Which
 * target can is `types/compat` `pointerIntoElementary`: the TARGET's pointer width, one rule on both vendors but for a
 * REAL (silent on CODESYS, refused on TwinCAT). A refusal is an ERROR, "Cannot convert type 'POINTER TO INT' to type
 * 'DWORD'"; a signed integer at the pointer's width is the change-of-sign warning instead (`ptrsc_into_lint`).
 *
 * NOT C0033. This was the configurable warning C0033 ("Type … is possibly not convertible …"), raised to an error by "both
 * recording projects' settings" — measured 2026-10-06 (analysis-conformance 3.1): neither project's settings raise a
 * warning to an error, and the wording C0033 documents appears in no recording. The message is the compiler's ordinary
 * conversion error (C0032, `assignment-type-mismatch`), and it is not configurable.
 *
 * Zero-FP: only a KNOWN pointer source into a KNOWN elementary target fires; pointer→pointer (the legal case) and any
 * undecidable side are skipped.
 */
import { walkStatements, type Assignment, type Expr } from "../../../frontend/syntax/index.js"
import { bodies, forEachDecl, targetOf } from "../../../frontend/symbols/index.js"
import { elementaryRef, inferExprType, isSameType, pointerIntoElementary, renderType, resolveTypeExpr, type Type } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { emit, type DiagnosticItem, type Fix } from "../../shared/diagnostic-item.js"
import { fixOf, replaceText } from "../../shared/fixes.js"

export function checkPointerConversion(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.op !== undefined) return
      const rhs = inferExprType(s.value, scope, ctx.project)
      if (rhs.kind !== "pointer") return
      const lhs = inferExprType(s.target, scope, ctx.project)
      store(ctx, out, lhs, rhs, s.target, referenceBind(ctx, s, lhs, rhs))
    })
  }
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.init === undefined || decl.init.kind === "aggregate_init") continue
    const rhs = inferExprType(decl.init, scope, ctx.project)
    if (rhs.kind !== "pointer") continue
    store(ctx, out, resolveTypeExpr(decl.type, ctx.project, 0, ctx.project, ctx.uri), rhs, decl.init)
  }
}

/** One store of the pointer `rhs` into `lhs`, reported on `at`. */
function store(ctx: CheckContext, out: DiagnosticItem[], lhs: Type, rhs: Type, at: Expr, fix?: Fix): void {
  // a REFERENCE target is written through, so the pointer converts into what it refers to — and the message names
  // the reference: `rf := p` is "Cannot convert type 'POINTER TO INT' to type 'REFERENCE TO INT'"
  // (`cv_pointer_assigned_to_reference`, CODESYS 2026-10-03) — and a declaration binding a REFERENCE to a pointer is
  // refused in the same words (`ptrsc_reference_initializer`, both vendors 2026-10-06)
  const written = lhs.kind === "reference" ? lhs.target : lhs
  if (written.kind !== "elementary") return
  const rule = pointerIntoElementary(written, targetOf(ctx.project), ctx.project.dialect)
  if (rule === "incompatible")
    emit(
      out,
      at.span,
      "assignment-type-mismatch",
      ctx.messages.cannotConvert(renderType(rhs), renderType(lhs)),
      "error",
      [fix],
    )
  else if (rule === "sign-change")
    emit(
      out,
      at.span,
      "sign-change-conversion",
      ctx.messages.signChange("unsigned", renderType(rhs), "signed", renderType(elementaryRef(written.name), { form: "compiler" })),
      "warning",
    )
}

/**
 * `rf := p` where `rf` is a REFERENCE TO T and `p` a POINTER TO T: "Bind with 'rf REF= p^'" — the reference bound to what
 * the pointer points to (design.md §4 F1, `qf_c0032_ref`, recorded building on both vendors). Only on an unchained `:=`
 * whose value is a name or a member (a `^` after it dereferences exactly that value). Not preferred: `rf := p^` — the
 * pointee copied into what `rf` already refers to — builds too and means something else.
 */
function referenceBind(ctx: CheckContext, s: Assignment, lhs: Type, rhs: Type): Fix | undefined {
  if ((s.chained?.length ?? 0) > 0 || (s.value.kind !== "ident_expr" && s.value.kind !== "member")) return undefined
  if (lhs.kind !== "reference" || rhs.kind !== "pointer" || !isSameType(lhs.target, rhs.target)) return undefined
  const between = ctx.source.slice(s.target.span.end, s.value.span.start)
  const op = between.indexOf(":=")
  if (op < 0) return undefined
  const target = ctx.source.slice(s.target.span.start, s.target.span.end)
  const value = ctx.source.slice(s.value.span.start, s.value.span.end)
  return fixOf(`Bind with '${target} REF= ${value}^'`, [
    replaceText(ctx.source, s.target.span.end + op, s.value.span.end, `REF=${between.slice(op + 2)}${value}^`),
  ])
}
