/**
 * implicit-conversion (D.2 · types/). The WARNINGs both compilers emit that a plain assignment otherwise
 * doesn't: an implicit lossy narrowing ("possible loss of information", e.g. `LREAL`→`REAL`) and a same-width
 * signed↔unsigned crossing ("change of sign", e.g. `WORD`→`INT`). Both derive from the ONE `classifyConversion`
 * relation — this check only maps the returned kind to a severity + per-vendor wording, it does not re-decide.
 * The vendor-specific capitalization ("Possible"/"possible") comes from `messages`, not an `if` here.
 */
import { stmtExprs, walkExpr, walkStatements, type Expr } from "../../../syntax/index.js"
import { bodies, type Scope } from "../../../symbols/index.js"
import { classifyConversion, elementaryType, elementaryTypeRef, inferExprType, type Type } from "../../../types/index.js"
import type { Messages } from "../../messages.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkNarrowingConversion(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind === "assign" && s.op === undefined) {
        const diag = narrowingPairError(s.target, s.value, scope, ctx.project, ctx.messages)
        if (diag !== undefined) out.push(diag)
      }
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          const diag = conversionArgError(x, scope, ctx.project, ctx.messages)
          if (diag !== undefined) out.push(diag)
        })
    })
  }
}

/** The elementary SOURCE type of a conversion call `<SRC>_TO_<DST>` (`UINT_TO_WORD` → UINT), or undefined for a
 *  non-typed conversion (`TO_STRING`) or a non-elementary source. The `<SRC>` before `_TO_` names the type the
 *  argument is implicitly converted TO before the cast — where CODESYS emits the same C0195/C0197 an assignment
 *  would (the sole reason `UINT_TO_WORD(anINT)` warns "change of sign" and `REAL_TO_DINT(anLREAL)` warns "loss"). */
const CONVERSION_SOURCE_RE = /^([A-Za-z][A-Za-z0-9]*)_TO_[A-Za-z]/i

/**
 * The implicit-conversion WARNING for a conversion-function ARGUMENT, or undefined. `<SRC>_TO_<DST>(arg)`
 * converts `arg` to `<SRC>` first, so an `arg` that narrows/sign-changes into `<SRC>` warns exactly as the
 * assignment `<SRC>Var := arg` would — the class the assignment-only check missed (both the textual
 * `REAL_TO_DINT(EXPT(…))` and the graphical `UINT_TO_WORD(…)` corpus cases). Exported so the VG sink check
 * runs it over graphical operands too.
 */
export function conversionArgError(
  x: Expr,
  scope: Scope,
  project: Scope,
  messages: Messages,
): DiagnosticItem | undefined {
  if (x.kind !== "call" || x.callee.kind !== "ident_expr") return undefined
  const m = CONVERSION_SOURCE_RE.exec(x.callee.name)
  if (m === null) return undefined
  const srcElem = elementaryType(m[1]!)
  if (srcElem === undefined) return undefined // e.g. TO_STRING (no explicit source) or non-elementary
  const arg = x.args[0]?.value
  if (arg === undefined) return undefined
  return conversionWarning(elementaryTypeRef(srcElem), inferExprType(arg, scope, project), arg, messages)
}

/**
 * The implicit-conversion WARNING for one `target := value` pair, or undefined. The ONE home for the rule —
 * the ST assign check and the VG sink check both call it, so wording stays byte-identical per vendor. Emits for
 * `classifyConversion === "narrow"` (loss) and `=== "sign-change"` (sign); the ERROR kinds are the assignment /
 * conversion-source checks' job. Kept as one function so a site yields exactly one diagnostic.
 */
export function narrowingPairError(
  target: Expr,
  value: Expr,
  scope: Scope,
  project: Scope,
  messages: Messages,
): DiagnosticItem | undefined {
  return conversionWarning(
    inferExprType(target, scope, project),
    inferExprType(value, scope, project),
    target,
    messages,
  )
}

/** Map a source→value conversion to its narrowing/sign-change warning on `at`, or undefined. The ONE mapping —
 *  both the assignment pair and the conversion-arg check funnel through it, so wording stays byte-identical. */
function conversionWarning(lhs: Type, rhs: Type, at: Expr, messages: Messages): DiagnosticItem | undefined {
  const kind = classifyConversion(lhs, rhs)
  if (kind === "narrow") return warn(at, "narrowing-conversion", messages.narrowing(name(rhs), name(lhs)))
  if (kind === "sign-change")
    return warn(at, "sign-change-conversion", messages.signChange(sign(rhs), name(rhs), sign(lhs), name(lhs)))
  return undefined
}

const warn = (target: Expr, code: string, message: string): DiagnosticItem => ({
  severity: "warning",
  span: target.span,
  source: SOURCE,
  code,
  message,
})

function name(t: Type): string {
  return t.kind === "elementary" ? t.name : ""
}
function sign(t: Type): string {
  return t.kind === "elementary" && elementaryType(t.name)?.signed ? "signed" : "unsigned"
}
