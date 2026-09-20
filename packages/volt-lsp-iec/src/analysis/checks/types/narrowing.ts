/**
 * implicit-conversion (D.2 · types/). The WARNINGs both compilers emit that a plain assignment otherwise
 * doesn't: an implicit lossy narrowing ("possible loss of information", e.g. `LREAL`→`REAL`) and a same-width
 * signed↔unsigned crossing ("change of sign", e.g. `WORD`→`INT`). Both derive from the ONE `classifyConversion`
 * relation, through the shared rules in `analysis/rules` — this check only walks the places they apply.
 */
import { stmtExprs, walkExpr, walkStatements, type Expr } from "../../../syntax/index.js"
import { bodies, forEachDecl, type Scope } from "../../../symbols/index.js"
import {
  elementaryType,
  elementaryTypeRef,
  inferExprType,
  literalCheckType,
  resolveTypeExpr,
  type ElementaryType,
  type Type,
} from "../../../types/index.js"
import type { Messages } from "../../messages.js"
import type { CheckContext } from "../../diagnostics.js"
import { pushForDeclaration, type DiagnosticItem } from "../../diagnostic-item.js"
import { conversionArgError, conversionWarning, narrowingPairError } from "../../rules.js"

export function checkNarrowingConversion(ctx: CheckContext, out: DiagnosticItem[]): void {
  // A declaration's untyped integer literal the target cannot hold warns like an assignment (gap 13): `value : INT :=
  // 40000` is "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT'" (conformance `overflow_int_above_max`).
  for (const { decl, section, unit } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.init === undefined || decl.init.kind === "aggregate_init") continue
    const lhs = resolveTypeExpr(decl.type, ctx.project)
    const literal = literalCheckType(decl.init, lhs)
    const diag = literal === undefined ? undefined : conversionWarning(lhs, literal, decl.init, ctx.messages)
    if (diag !== undefined) pushForDeclaration(out, unit, section, diag)
  }
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind === "assign") {
        // `a := b := c` stores c into b, then b into a — each `:=` link is its own store (conformance
        // `assign_chained_plain`: `outL := midR := srcL` warns LREAL → REAL once, for `midR := srcL`). Only the outer pair
        // was checked, so the inner narrowing went unreported.
        const places = [s.target, ...(s.chained ?? [])]
        const ops = [s.op, ...(s.chainOps ?? [])]
        places.forEach((place, i) => {
          if (ops[i] !== undefined) return
          const diag = narrowingPairError(place, places[i + 1] ?? s.value, scope, ctx.project, ctx.messages)
          if (diag !== undefined) out.push(diag)
        })
      }
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          const diag =
            conversionArgError(x, scope, ctx.project, ctx.messages) ??
            negationOperandWarning(x, scope, ctx.project, ctx.messages) ??
            operandSignWarning(x, scope, ctx.project, ctx.messages)
          if (diag !== undefined) out.push(diag)
        })
    })
  }
}

/**
 * The "change of sign" a unary minus puts on an UNSIGNED operand: it negates the value as the signed type of its
 * width, so `-uint` converts UINT → INT first. Measured live (conformance `cc_neg_uint_into_int`, `cc_neg_word_*`,
 * `cc_neg_udint_*`): CODESYS warns "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT' : Possible
 * change of sign" on the operand. An 8-bit unsigned operand widens into INT and stays silent, as recorded — the same
 * `classifyConversion` answer, so no special case.
 */
/**
 * The "change of sign" an operation puts on one operand of a same-width signed/unsigned pair (a bit string counts as
 * unsigned). Measured on CODESYS SP21 (conformance `cc_add_*`, `cc_max_*`, `cc_bitwise_*`, `cc_not_*`, `cc_compare_*`,
 * `same_width_*`, `signed_unsigned_comparison`):
 *   - arithmetic (`+ - * / MOD`) and MAX/MIN meet in the SIGNED operand's type: the unsigned operand warns (`WORD + INT`
 *     is "unsigned Type 'WORD' to signed Type 'INT'");
 *   - AND, OR, XOR and NOT meet in the UNSIGNED integer of the width: the signed operand warns (`BYTE AND SINT` and
 *     `NOT sint` are "signed Type 'SINT' to unsigned Type 'USINT'");
 *   - the six comparisons warn like arithmetic, but only at 32 and 64 bits — narrower operands promote and stay silent.
 * An untyped integer literal takes the other operand's type when it fits it (`un XOR 1` is silent, `sn AND 255` warns).
 * ponytail: the shifts, EXPT and the other generic functions are unmeasured and stay silent — probe before adding one.
 */
function operandSignWarning(x: Expr, scope: Scope, project: Scope, messages: Messages): DiagnosticItem | undefined {
  if (x.kind === "unary" && x.op === "NOT") {
    const t = integral(inferExprType(x.operand, scope, project))
    return t?.signed === true ? conversionWarning(unsignedOfWidth(t.bits), elementaryTypeRef(t), x.operand, messages) : undefined
  }
  let rule: "signed" | "unsigned" | "signed-wide" | undefined
  let pair: readonly [Expr, Expr] | undefined
  if (x.kind === "binary") {
    rule = ARITHMETIC.has(x.op) ? "signed" : BITWISE.has(x.op) ? "unsigned" : COMPARISON.has(x.op) ? "signed-wide" : undefined
    pair = [x.left, x.right]
  } else if (x.kind === "call" && x.callee.kind === "ident_expr" && /^(MAX|MIN)$/i.test(x.callee.name) && x.args.length === 2) {
    const [a, b] = [x.args[0]!.value, x.args[1]!.value]
    if (a !== undefined && b !== undefined) [rule, pair] = ["signed", [a, b]]
  }
  if (rule === undefined || pair === undefined) return undefined
  const [left, right] = pair
  const lt = inferExprType(left, scope, project)
  const rt = inferExprType(right, scope, project)
  const l = integral(literalCheckType(left, rt) ?? (isIntLiteral(left) ? rt : lt))
  const r = integral(literalCheckType(right, lt) ?? (isIntLiteral(right) ? lt : rt))
  if (l === undefined || r === undefined || l.bits !== r.bits || l.signed === r.signed) return undefined
  // THE 32-BIT FLOOR IS CODESYS'S. Both vendors warn about a sign crossing in a comparison at DINT/UDINT and
  // LINT/ULINT; at SINT/USINT and INT/UINT only TwinCAT does — all 24 `cmp_sign_*` cells, six operators at four
  // widths, on both recordings (2026-09-20).
  if (rule === "signed-wide" && l.bits < 32 && project.dialect !== "twincat") return undefined
  const [signed, unsigned, signedAt, unsignedAt] = l.signed ? [l, r, left, right] : [r, l, right, left]
  if (rule === "unsigned") return conversionWarning(unsignedOfWidth(signed.bits), elementaryTypeRef(signed), signedAt, messages)
  return conversionWarning(elementaryTypeRef(signed), elementaryTypeRef(unsigned), unsignedAt, messages)
}

function integral(t: Type): (ElementaryType & { signed: boolean }) | undefined {
  const e = t.kind === "elementary" ? t.elem : undefined
  return e !== undefined && e.rank !== undefined && (e.family === "int" || e.family === "bitstring") ? { ...e, signed: e.signed === true } : undefined
}

const ARITHMETIC: ReadonlySet<string> = new Set(["+", "-", "*", "/", "MOD"])
const BITWISE: ReadonlySet<string> = new Set(["AND", "OR", "XOR"])
const COMPARISON: ReadonlySet<string> = new Set(["=", "<>", "<", ">", "<=", ">="])

const unsignedOfWidth = (bits: number): Type =>
  elementaryTypeRef(elementaryType(bits === 8 ? "USINT" : bits === 16 ? "UINT" : bits === 32 ? "UDINT" : "ULINT")!)

const isIntLiteral = (e: Expr): boolean =>
  (e.kind === "literal" && e.literalKind === "int") || (e.kind === "unary" && e.op === "-" && e.operand.kind === "literal" && e.operand.literalKind === "int")

function negationOperandWarning(x: Expr, scope: Scope, project: Scope, messages: Messages): DiagnosticItem | undefined {
  if (x.kind !== "unary" || x.op !== "-") return undefined
  return conversionWarning(inferExprType(x, scope, project), inferExprType(x.operand, scope, project), x.operand, messages)
}
