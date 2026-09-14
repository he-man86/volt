/**
 * implicit-conversion (D.2 · types/). The WARNINGs both compilers emit that a plain assignment otherwise
 * doesn't: an implicit lossy narrowing ("possible loss of information", e.g. `LREAL`→`REAL`) and a same-width
 * signed↔unsigned crossing ("change of sign", e.g. `WORD`→`INT`). Both derive from the ONE `classifyConversion`
 * relation — this check only maps the returned kind to a severity + per-vendor wording, it does not re-decide.
 * The vendor-specific capitalization ("Possible"/"possible") comes from `messages`, not an `if` here.
 */
import { stmtExprs, walkExpr, walkStatements, type Expr } from "../../../syntax/index.js"
import { bodies, forEachDecl, type Scope } from "../../../symbols/index.js"
import {
  elementaryTypeRef,
  inferExprType,
  literalCheckType,
  parseConversionName,
  resolveTypeExpr,
  UNKNOWN,
} from "../../../types/index.js"
import type { Messages } from "../../messages.js"
import type { CheckContext } from "../../diagnostics.js"
import { checkableType, conversionWarning, type DiagnosticItem } from "../_shared.js"

export function checkNarrowingConversion(ctx: CheckContext, out: DiagnosticItem[]): void {
  // A declaration's untyped integer literal the target cannot hold warns like an assignment (gap 13): `value : INT :=
  // 40000` is "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT'" (conformance `overflow_int_above_max`).
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.init === undefined || decl.init.kind === "aggregate_init") continue
    const lhs = resolveTypeExpr(decl.type, ctx.project)
    const literal = literalCheckType(decl.init, lhs)
    const diag = literal === undefined ? undefined : conversionWarning(lhs, literal, decl.init, ctx.messages)
    if (diag !== undefined) out.push(diag)
  }
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind === "assign" && s.op === undefined) {
        const diag = narrowingPairError(s.target, s.value, scope, ctx.project, ctx.messages)
        if (diag !== undefined) out.push(diag)
      }
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          const diag = conversionArgError(x, scope, ctx.project, ctx.messages) ?? negationOperandWarning(x, scope, ctx.project, ctx.messages)
          if (diag !== undefined) out.push(diag)
        })
    })
  }
}

/**
 * The implicit-conversion WARNING for a conversion-function ARGUMENT, or undefined. `<SRC>_TO_<DST>(arg)`
 * converts `arg` to `<SRC>` first, so an `arg` that narrows/sign-changes into `<SRC>` warns exactly as the
 * assignment `<SRC>Var := arg` would — the class the assignment-only check missed (both the textual
 * `REAL_TO_DINT(EXPT(…))` and the graphical `UINT_TO_WORD(…)` corpus cases). Exported so the network-text sink check
 * runs it over graphical operands too.
 */
export function conversionArgError(
  x: Expr,
  scope: Scope,
  project: Scope,
  messages: Messages,
): DiagnosticItem | undefined {
  if (x.kind !== "call" || x.callee.kind !== "ident_expr") return undefined
  // The `<SRC>` before `_TO_` is the type the argument converts TO before the cast — where CODESYS emits the same
  // C0195/C0197 an assignment would (`UINT_TO_WORD(anINT)` warns "change of sign", `REAL_TO_DINT(anLREAL)` "loss").
  const srcElem = parseConversionName(x.callee.name)?.from
  if (srcElem === undefined) return undefined // not a conversion, or `TO_STRING` (no explicit source)
  const arg = x.args[0]?.value
  if (arg === undefined) return undefined
  return conversionWarning(elementaryTypeRef(srcElem), inferExprType(arg, scope, project), arg, messages)
}

/**
 * The "change of sign" a unary minus puts on an UNSIGNED operand: it negates the value as the signed type of its
 * width, so `-uint` converts UINT → INT first. Measured live (conformance `cc_neg_uint_into_int`, `cc_neg_word_*`,
 * `cc_neg_udint_*`): CODESYS warns "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT' : Possible
 * change of sign" on the operand. An 8-bit unsigned operand widens into INT and stays silent, as recorded — the same
 * `classifyConversion` answer, so no special case.
 */
function negationOperandWarning(x: Expr, scope: Scope, project: Scope, messages: Messages): DiagnosticItem | undefined {
  if (x.kind !== "unary" || x.op !== "-") return undefined
  return conversionWarning(inferExprType(x, scope, project), inferExprType(x.operand, scope, project), x.operand, messages)
}

/**
 * The implicit-conversion WARNING for one `target := value` pair, or undefined. The ONE home for the rule —
 * the ST assign check and the network-text sink check both call it, so wording stays byte-identical per vendor. Emits for
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
  const lhs = inferExprType(target, scope, project)
  // an untyped integer literal the target cannot hold converts as its literal type (gap 13): `si := 128` warns USINT→SINT
  const rhs = literalCheckType(value, lhs) ?? checkableType(value, scope, project) ?? UNKNOWN
  return conversionWarning(lhs, rhs, target, messages)
}
