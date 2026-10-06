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
import { walkStatements, type Expr } from "../../../frontend/syntax/index.js"
import { bodies, forEachDecl, targetOf } from "../../../frontend/symbols/index.js"
import { elementaryRef, inferExprType, pointerIntoElementary, renderType, resolveTypeExpr, type Type } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkPointerConversion(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.op !== undefined) return
      const rhs = inferExprType(s.value, scope, ctx.project)
      if (rhs.kind !== "pointer") return
      store(ctx, out, inferExprType(s.target, scope, ctx.project), rhs, s.target)
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
function store(ctx: CheckContext, out: DiagnosticItem[], lhs: Type, rhs: Type, at: Expr): void {
  // a REFERENCE target is written through, so the pointer converts into what it refers to — and the message names
  // the reference: `rf := p` is "Cannot convert type 'POINTER TO INT' to type 'REFERENCE TO INT'"
  // (`cv_pointer_assigned_to_reference`, CODESYS 2026-10-03) — and a declaration binding a REFERENCE to a pointer is
  // refused in the same words (`ptrsc_reference_initializer`, both vendors 2026-10-06)
  const written = lhs.kind === "reference" ? lhs.target : lhs
  if (written.kind !== "elementary") return
  const rule = pointerIntoElementary(written, targetOf(ctx.project), ctx.project.dialect)
  if (rule === "incompatible")
    out.push({
      severity: "error",
      span: at.span,
      source: SOURCE,
      code: "assignment-type-mismatch",
      message: ctx.messages.cannotConvert(renderType(rhs), renderType(lhs)),
    })
  else if (rule === "sign-change")
    out.push({
      severity: "warning",
      span: at.span,
      source: SOURCE,
      code: "sign-change-conversion",
      message: ctx.messages.signChange("unsigned", renderType(rhs), "signed", renderType(elementaryRef(written.name), { form: "compiler" })),
    })
}
