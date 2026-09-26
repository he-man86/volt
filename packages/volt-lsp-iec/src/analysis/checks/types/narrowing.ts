/**
 * implicit-conversion (D.2 · types/). The WARNINGs both compilers emit that a plain assignment otherwise
 * doesn't: an implicit lossy narrowing ("possible loss of information", e.g. `LREAL`→`REAL`) and a same-width
 * signed↔unsigned crossing ("change of sign", e.g. `WORD`→`INT`). Both derive from the ONE `classifyConversion`
 * relation, through the shared rules in `analysis/rules` — this check only walks the places they apply.
 */
import { stmtExprs, walkExpr, walkStatements, type Expr } from "../../../syntax/index.js"
import { bodies, forEachDecl, type Scope } from "../../../symbols/index.js"
import {

  checkedMeetType,
  elementaryTypeRef,
  inferExprType,
  integerOfWidth,
  isIntegerType,
  literalCheckType,
  resolveTypeExpr,
  type ElementaryType,
  type Type,
} from "../../../types/index.js"
import type { Messages } from "../../messages.js"
import type { CheckContext } from "../../diagnostics.js"
import { pushForDeclaration, type DiagnosticItem } from "../../diagnostic-item.js"
import { checkableType, conversionArgError, conversionWarning, narrowingPairError } from "../../rules.js"

export function checkNarrowingConversion(ctx: CheckContext, out: DiagnosticItem[]): void {
  // A declaration's untyped integer literal the target cannot hold warns like an assignment (gap 13): `value : INT :=
  // 40000` is "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT'" (conformance `overflow_int_above_max`).
  for (const { decl, section, unit, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.init === undefined || decl.init.kind === "aggregate_init") continue
    const lhs = resolveTypeExpr(decl.type, ctx.project, 0, ctx.project, ctx.uri)
    // …and an initializer that is not a literal converts too. `rv : REAL := SQRT(16.0)` is an LREAL going into a
    // REAL and CODESYS warns about it twice (`cfold_sqrt`, `cfold_expt`); this only ever asked
    // `literalCheckType`, so any initializer with a shape — a call, a member read, an expression — was silent.
    const src = literalCheckType(decl.init, lhs) ?? checkableType(decl.init, scope, ctx.project)
    const diag = src === undefined ? undefined : conversionWarning(lhs, src, decl.init, ctx.messages)
    if (diag !== undefined) pushForDeclaration(out, unit, section, diag)
    // …and the conversions INSIDE the initializer, which are the body arm's question asked in the other place.
    // `i : DINT := REAL_TO_DINT(EXPT(2, 10))` converts nothing at the STORE — it is a DINT going into a DINT —
    // and everything at the ARGUMENT: `EXPT` answers LREAL and `REAL_TO_DINT` wants a REAL (`cfold_expt`,
    // `cfold_sqrt`). Only the store was asked here, so an initializer with a shape inside it was silent.
    walkExpr(decl.init, (x) => {
      const one = conversionArgError(x, scope, ctx.project, ctx.messages) ?? negationOperandWarning(x, scope, ctx.project, ctx.messages)
      for (const d of one !== undefined ? [one] : operandSignWarnings(x, scope, ctx.project, ctx.messages))
        pushForDeclaration(out, unit, section, d)
    })
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
          const one =
            conversionArgError(x, scope, ctx.project, ctx.messages) ??
            negationOperandWarning(x, scope, ctx.project, ctx.messages)
          if (one !== undefined) out.push(one)
          // …and a BITWISE operator can put a conversion on BOTH of its operands, so this one answers with a list.
          else out.push(...operandSignWarnings(x, scope, ctx.project, ctx.messages))
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
function operandSignWarnings(x: Expr, scope: Scope, project: Scope, messages: Messages): DiagnosticItem[] {
  if (x.kind === "unary" && x.op === "NOT") {
    const t = integral(inferExprType(x.operand, scope, project))
    const w = t?.signed === true ? conversionWarning(unsignedOfWidth(t.bits), elementaryTypeRef(t), x.operand, messages) : undefined
    return w === undefined ? [] : [w]
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
  if (rule === undefined || pair === undefined) return []
  const [left, right] = pair
  // ARITHMETIC MEETS ITS OPERANDS AND CONVERTS BOTH INTO THE MEET, and a conversion that loses information or
  // crosses sign warns wherever it happens. `aUlint MOD aSint` meets at LINT and the ULINT operand warns
  // (`meet_ulint_mod_sint`); `aLint + aReal` meets at REAL and the LINT operand warns about the mantissa
  // (`meet_lint_plus_real`). Neither pair is the SAME WIDTH, which is all this check used to look at — so it
  // saw a family of conversions it had no rule to name.
  if (rule === "signed") {
    const meetWarnings = meetOperandWarnings(left, right, scope, project, messages)
    if (meetWarnings !== undefined) return meetWarnings
  }
  const lt = inferExprType(left, scope, project)
  const rt = inferExprType(right, scope, project)
  const l = integral(literalCheckType(left, rt) ?? (isIntLiteral(left) ? rt : lt))
  const r = integral(literalCheckType(right, lt) ?? (isIntLiteral(right) ? lt : rt))
  if (l === undefined || r === undefined || l.bits !== r.bits) return []
  // A BITWISE OPERATOR COMPUTES IN THE UNSIGNED INTEGER OF THE WIDTH, so EVERY signed operand converts on the way
  // in — two warnings for `aLint AND bLint`, at two spans on one line, and then a third from the assignment when
  // the result goes back into a signed destination (`bit_{and,or,xor}_{sint,int,dint,lint}`, three each on CODESYS).
  // An untyped literal takes the other operand's type and is not one of the conversions: `sn AND 255` warns ONCE
  // (`cc_bitwise_sint_and_literal`).
  if (rule === "unsigned") {
    const each = ([t, at]: readonly [typeof l, Expr]): DiagnosticItem | undefined =>
      t.signed && !isIntLiteral(at) ? conversionWarning(unsignedOfWidth(t.bits), elementaryTypeRef(t), at, messages) : undefined
    return [each([l, left]), each([r, right])].filter((d): d is DiagnosticItem => d !== undefined)
  }
  if (l.signed === r.signed) return []
  if (rule === "signed-wide" && l.bits < 32 && project.dialect !== "twincat") return []
  const [signed, unsigned, unsignedAt] = l.signed ? [l, r, right] : [r, l, left]
  const w = conversionWarning(elementaryTypeRef(signed), elementaryTypeRef(unsigned), unsignedAt, messages)
  return w === undefined ? [] : [w]
}

/**
 * Both operands converted into their MEET, or undefined when the pair has no measured meet (the vendor never
 * answered for it, and silence is what that earns). An untyped integer literal takes the other operand's type
 * and converts nowhere, which is why `sn AND 255` warns once rather than twice.
 */
function meetOperandWarnings(
  left: Expr,
  right: Expr,
  scope: Scope,
  project: Scope,
  messages: Messages,
): DiagnosticItem[] | undefined {
  const lt = inferExprType(left, scope, project)
  const rt = inferExprType(right, scope, project)
  if (lt.kind !== "elementary" || rt.kind !== "elementary") return undefined
  const meet = checkedMeetType(lt, rt)
  if (meet === undefined || meet.kind !== "elementary") return undefined
  const each = (t: Type, at: Expr): DiagnosticItem | undefined =>
    isIntLiteral(at) ? undefined : conversionWarning(meet, t, at, messages)
  return [each(lt, left), each(rt, right)].filter((d): d is DiagnosticItem => d !== undefined)
}

/** The operand as an integer, with `signed` made total — `isIntegerType` owns WHICH types those are (it is the
 *  rule that excludes BIT), so a change to that policy reaches here instead of stopping at a restatement. */
function integral(t: Type): (ElementaryType & { signed: boolean }) | undefined {
  const e = t.kind === "elementary" ? t.elem : undefined
  return e !== undefined && isIntegerType(e.name) ? { ...e, signed: e.signed === true } : undefined
}

const ARITHMETIC: ReadonlySet<string> = new Set(["+", "-", "*", "/", "MOD"])
const BITWISE: ReadonlySet<string> = new Set(["AND", "OR", "XOR"])
const COMPARISON: ReadonlySet<string> = new Set(["=", "<>", "<", ">", "<=", ">="])

// the ladder is `types/arith`'s; this was a second copy of it, written with `===` where the one home uses `<=`
const unsignedOfWidth = (bits: number): Type => elementaryTypeRef(integerOfWidth(bits, false))

const isIntLiteral = (e: Expr): boolean =>
  (e.kind === "literal" && e.literalKind === "int") || (e.kind === "unary" && e.op === "-" && e.operand.kind === "literal" && e.operand.literalKind === "int")

function negationOperandWarning(x: Expr, scope: Scope, project: Scope, messages: Messages): DiagnosticItem | undefined {
  if (x.kind !== "unary" || x.op !== "-") return undefined
  return conversionWarning(inferExprType(x, scope, project), inferExprType(x.operand, scope, project), x.operand, messages)
}
