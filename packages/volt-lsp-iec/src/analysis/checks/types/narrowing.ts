/**
 * implicit-conversion (D.2 · types/). The WARNINGs both compilers emit that a plain assignment otherwise
 * doesn't: an implicit lossy narrowing ("possible loss of information", e.g. `LREAL`→`REAL`) and a same-width
 * signed↔unsigned crossing ("change of sign", e.g. `WORD`→`INT`). Both derive from the ONE `classifyConversion`
 * relation, through the shared rules in `analysis/rules` — this check only walks the places they apply.
 */
import { stmtExprs, walkExpr, walkStatements, type Expr } from "../../../frontend/syntax/index.js"
import { bodies, forEachDecl, type Scope } from "../../../frontend/symbols/index.js"
import { checkedMeetType, comparisonConverts, durationScaleConversion, type ElementaryType, elementaryRef, elementaryTypeRef, inferExprType, integerLiteralType, integerOfWidth, isDuration, isIntegerType, isIntLiteral, literalCheckType, literalContextConversion, negativeLiteralComparisonTarget, operandConversion, literalOperandType, notResultType, resolveTypeExpr, selectionValueArguments, type Type, untypedNumberValue } from "../../../frontend/types/index.js"
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
      // A CASE LABEL AND A FOR BOUND CONVERT INTO THE SELECTOR'S / THE COUNTER'S TYPE, as a store into it does: `200:`
      // under a SINT selector and `FOR si := 1 TO 200` over a SINT counter are both "unsigned Type 'USINT' to signed Type
      // 'SINT'" (rule LT12, `lt_literal_case_label_out_of_range`, `lt_literal_for_bounds_out_of_range`, both vendors
      // 2026-10-03). Only an untyped literal is measured — the label and the TO bound — and only same-width unsigned into
      // a signed type (`literalContextConversion`).
      if (s.kind === "case") {
        const selector = inferExprType(s.selector, scope, ctx.project)
        for (const label of s.arms.flatMap((a) => a.labels))
          for (const v of label.upper === undefined ? [label.value] : [label.value, label.upper]) {
            const diag = literalStore(selector, v, ctx.messages)
            if (diag !== undefined) out.push(diag)
          }
      }
      if (s.kind === "for") {
        const diag = literalStore(inferExprType(s.controlVar, scope, ctx.project), s.to, ctx.messages)
        if (diag !== undefined) out.push(diag)
      }
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
 * MIN, MAX, LIMIT, SEL and MUX convert every VALUE argument into their meet (`ar_*_mixed_types`). The shifts convert
 * nothing — `SHL(aSint, n)` is a SINT with no warning (`ar_shl_sint_type`); EXPT and the other generic functions are
 * unmeasured and stay silent — probe before adding one.
 */
function operandSignWarnings(x: Expr, scope: Scope, project: Scope, messages: Messages): DiagnosticItem[] {
  if (x.kind === "unary" && x.op === "NOT") {
    // the operand converts into NOT's result (`arith/operators` `notResultType`, the one NOT rule): a signed integer into
    // the unsigned one of its width warns; every other operand converts into its own kind and stays silent here
    const operand = inferExprType(x.operand, scope, project)
    const w = integral(operand) === undefined ? undefined : conversionWarning(notResultType(operand), operand, x.operand, messages)
    return w === undefined ? [] : [w]
  }
  let rule: "signed" | "unsigned" | "signed-wide" | undefined
  let pair: readonly [Expr, Expr] | undefined
  if (x.kind === "binary") {
    const scaled = durationScaleWarnings(x.op, x.left, x.right, scope, project, messages)
    if (scaled !== undefined) return scaled
    rule = operandConversion(x.op)
    pair = [x.left, x.right]
  } else if (x.kind === "call" && x.callee.kind === "ident_expr") {
    // MIN, MAX, LIMIT, SEL and MUX convert every VALUE argument into their meet (`builtins` `selectionValueArguments`)
    const values = selectionValueArguments(x.callee.name, x.args.map((a) => a.value))
    if (values !== undefined && values.length === 2 && values.every((v) => v !== undefined)) [rule, pair] = ["signed", [values[0]!, values[1]!]]
    else if (values !== undefined && values.length > 2) return meetAllWarnings(values, scope, project, messages) ?? []
  }
  if (rule === undefined || pair === undefined) return []
  const [left, right] = pair
  if (rule === "signed-wide") {
    const negative = negativeLiteralComparison(left, right, scope, project, messages)
    if (negative !== undefined) return negative
  }
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
  // (`cc_bitwise_sint_and_literal`). A NEGATIVE one converts from its OWN type, the smallest signed integer holding it:
  // `si AND -1` and `i XOR -1` convert the SINT literal into USINT / UINT beside the operand's own conversion
  // (`ar_bitwise_literal_unsigned_or_negative`, both vendors 2026-10-03; TwinCAT's one copy per line makes `si AND -1` one
  // warning there). A negative literal beyond the operand's signed width was not asked: `l.bits !== r.bits` above.
  if (rule === "unsigned") {
    const each = ([t, at]: readonly [typeof l, Expr]): DiagnosticItem | undefined => {
      if (!isIntLiteral(at)) return t.signed ? conversionWarning(unsignedOfWidth(t.bits), elementaryTypeRef(t), at, messages) : undefined
      const v = negatedValue(at)
      const own = v !== undefined && v < 0n ? integerLiteralType(v) : undefined
      return own === undefined ? undefined : conversionWarning(unsignedOfWidth(t.bits), elementaryTypeRef(own), at, messages)
    }
    return [each([l, left]), each([r, right])].filter((d): d is DiagnosticItem => d !== undefined)
  }
  if (l.signed === r.signed) return []
  // An untyped literal beside a narrower variable converts nothing on EITHER vendor: `si = 200` is silent on TwinCAT too,
  // where two narrow VARIABLES of a signedness each convert (`lt_literal_in_comparison`, 2026-10-03).
  const literal = isIntLiteral(left) || isIntLiteral(right)
  if (rule === "signed-wide" && !comparisonConverts(l.bits, literal ? "codesys" : project.dialect)) return []
  const [signed, unsigned, unsignedAt] = l.signed ? [l, r, right] : [r, l, left]
  const w = conversionWarning(elementaryTypeRef(signed), elementaryTypeRef(unsigned), unsignedAt, messages)
  return w === undefined ? [] : [w]
}

/**
 * A duration scaled by an integer (`arith/temporal` `durationScaleConversion`, rule AR18): the warning its one operand
 * conversion earns, or undefined when the pair is no such scaling. The duration refused into a WIDER integer is an error,
 * `binary-op-type-mismatch`'s; an integer no wider converts into the signed integer of the duration's width, which CODESYS
 * warns for a same-width unsigned one ("UDINT to DINT", "ULINT to LINT") and TwinCAT does not
 * (`ar_duration_scaled_by_same_width_unsigned_type`, `ar_duration_scaled_stores`, 2026-10-03).
 */
function durationScaleWarnings(op: string, left: Expr, right: Expr, scope: Scope, project: Scope, messages: Messages): DiagnosticItem[] | undefined {
  const [lt, rt] = [inferExprType(left, scope, project), inferExprType(right, scope, project)]
  if (lt.kind !== "elementary" || rt.kind !== "elementary") return undefined
  const c = durationScaleConversion(op, lt.name, rt.name)
  if (c === undefined) return undefined
  if (isDuration(c.from) || project.dialect !== "codesys") return []
  const w = conversionWarning(elementaryRef(c.to), elementaryRef(c.from), c.side === "left" ? left : right, messages)
  return w === undefined ? [] : [w]
}

/**
 * An untyped NEGATIVE literal compared with an UNSIGNED variable converts the LITERAL, into the type
 * `negativeLiteralComparisonTarget` names (rule LT12): its narrowest type converting, with the warning that conversion
 * earns. Undefined when the pair is no comparison of one literal and one other operand.
 */
function negativeLiteralComparison(left: Expr, right: Expr, scope: Scope, project: Scope, messages: Messages): DiagnosticItem[] | undefined {
  const [literal, other] = isIntLiteral(left) && !isIntLiteral(right) ? [left, right] : isIntLiteral(right) && !isIntLiteral(left) ? [right, left] : []
  if (literal === undefined || other === undefined) return undefined
  const value = negatedValue(literal)
  const operand = integral(inferExprType(other, scope, project))
  if (value === undefined || value >= 0n || operand === undefined || operand.signed) return undefined
  const own = integerLiteralType(value)
  const into = negativeLiteralComparisonTarget(operand, value, project.dialect)
  if (own === undefined || into === undefined) return []
  const w = conversionWarning(elementaryTypeRef(into), elementaryTypeRef(own), literal, messages)
  return w === undefined ? [] : [w]
}

/** An untyped integer literal's value, its sign applied — undefined for anything else. */
function negatedValue(e: Expr): bigint | undefined {
  const lit = e.kind === "unary" && e.op === "-" ? e.operand : e
  if (lit.kind !== "literal" || lit.literalKind !== "int" || typeof lit.value !== "bigint") return undefined
  return lit === e ? lit.value : -lit.value
}

/** An untyped literal converted into `target` (a CASE label, a FOR bound): the warning its conversion earns, if any —
 *  only in the shape `literalContextConversion` names as measured. */
function literalStore(target: Type, value: Expr, messages: Messages): DiagnosticItem | undefined {
  const src = literalContextConversion(value, target)
  return src === undefined ? undefined : conversionWarning(target, src, value, messages)
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
  let lt = inferExprType(left, scope, project)
  let rt = inferExprType(right, scope, project)
  // an untyped number takes its type from the other operand (`arith/checked` `literalOperandType`): `aSint + 200` meets
  // at INT and converts nothing that warns (`ar_int_literal_operand_types`)
  const [lv, rv] = [untypedNumberValue(left), untypedNumberValue(right)]
  if (lv !== undefined && rv === undefined) lt = literalOperandType(lv, rt) ?? lt
  else if (rv !== undefined && lv === undefined) rt = literalOperandType(rv, lt) ?? rt
  if (lt.kind !== "elementary" || rt.kind !== "elementary") return undefined
  const meet = checkedMeetType(lt, rt)
  if (meet === undefined || meet.kind !== "elementary") return undefined
  const each = (t: Type, at: Expr): DiagnosticItem | undefined =>
    untypedNumberValue(at) !== undefined ? undefined : conversionWarning(meet, t, at, messages)
  return [each(lt, left), each(rt, right)].filter((d): d is DiagnosticItem => d !== undefined)
}

/** The operand as an integer, with `signed` made total — `isIntegerType` owns WHICH types those are (it is the
 *  rule that excludes BIT), so a change to that policy reaches here instead of stopping at a restatement. */
function integral(t: Type): (ElementaryType & { signed: boolean }) | undefined {
  const e = t.kind === "elementary" ? t.elem : undefined
  return e !== undefined && isIntegerType(e.name) ? { ...e, signed: e.signed === true } : undefined
}


// the ladder is `types/arith/`'s; this was a second copy of it, written with `===` where the one home uses `<=`
const unsignedOfWidth = (bits: number): Type => elementaryTypeRef(integerOfWidth(bits, false))


function negationOperandWarning(x: Expr, scope: Scope, project: Scope, messages: Messages): DiagnosticItem | undefined {
  if (x.kind !== "unary" || x.op !== "-") return undefined
  return conversionWarning(inferExprType(x, scope, project), inferExprType(x.operand, scope, project), x.operand, messages)
}

/** `meetOperandWarnings` over three or more value arguments (LIMIT, an extended MIN/MAX/MUX): each converted into the
 *  meet of all, or undefined when one has no elementary type or the meet is unmeasured. */
function meetAllWarnings(values: readonly (Expr | undefined)[], scope: Scope, project: Scope, messages: Messages): DiagnosticItem[] | undefined {
  const typed = values.map((v) => (v === undefined ? undefined : ([v, inferExprType(v, scope, project)] as const)))
  if (typed.some((p) => p === undefined || p[1].kind !== "elementary")) return undefined
  const pairs = typed as readonly (readonly [Expr, Type])[]
  const meet = pairs.map((p) => p[1]).reduce<Type | undefined>((acc, t) => (acc === undefined ? undefined : checkedMeetType(acc, t)), pairs[0]![1])
  if (meet === undefined || meet.kind !== "elementary") return undefined
  return pairs.flatMap(([at, t]) => {
    const w = isIntLiteral(at) ? undefined : conversionWarning(meet, t, at, messages)
    return w === undefined ? [] : [w]
  })
}
