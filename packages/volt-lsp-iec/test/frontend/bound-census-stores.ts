/**
 * THE STORES THE CENSUS TYPES (0.4) — what a store is (a target's type, every type its value may be checked as), and the
 * stores inside one expression: an operand into its operator, an argument into its parameter. One concern of
 * `bound-census.ts` (openspec lsp-same-standard 4.4); a file's declarations and statements are `bound-census-store-units.ts`.
 */
import { targetOf } from "../../src/frontend/symbols/index.js"
import {
  atomicOperand,
  durationScaleConversion,
  negativeLiteralComparisonTarget,
  selectionValueArguments,
  SHORT_CIRCUIT_OPERATORS,
  strictEnum,
  temporalArithmeticType,
  unparenthesised,
} from "../../src/frontend/types/index.js"
import {
  classifyConversion,
  inferExprType,
  type Type,
  elementaryRef,
  constEval,
  checkedMeetType,
  elementaryTypeRef,
  integerOfWidth,
  literalCheckType,
  literalErrorType,
  operandConversion,
  operandFamilyRule,
  parseConversionName,
  renderType,
  resolveCallee,
  resolveTypeExpr,
  unaryOperandConversion,
  UNKNOWN,
} from "../../src/frontend/types/index.js"
import { type Scope, rootOf, lookupMember } from "../../src/frontend/symbols/index.js"
import { type Expr, exprText, type TypeExpr } from "../../src/frontend/syntax/index.js"
import { bareConversionArgument, compilerExprText, stringLiteralMessageType } from "../../src/analysis/index.js"
import { valueExprs } from "./dumps-bound.js"
import { unparsedIn } from "./dumps-printer.js"
import type { Bound } from "./dumps.js"

export const COMPARISONS: ReadonlySet<string> = new Set(["=", "<>", "<", ">", "<=", ">="])

export const typeKey = (t: string): string => t.toUpperCase().replace(/\s+/g, "")

/** A store the front-end types: the target's type, and every type its value may be checked as. */
export interface Store {
  target: string
  value: Set<string>
  /** How the front-end converts the value's inferred type into the target's. */
  conversion: ReturnType<typeof classifyConversion>
  /** The two types as printed, for a finding. */
  printed: string
  /** A comparison operand's store: its two operands' types, `LEFT|RIGHT`. */
  compared?: string
  /** A store TwinCAT words with its two types swapped (a literal `REF=`). */
  reversedOnTwincat?: boolean
  /** A declaration's initializer whose WARNING the IDE says twice (`analysis` `initializerWarnedTwice`: in a FUNCTION_BLOCK,
   *  outside VAR CONSTANT — `ir_initializer_warning_*`): it explains two copies of a warning, one of a refusal. */
  warnedTwice?: boolean
}

/** The type an operation meets at, for the compiler's typed echo of a bare integer literal inside it (as `analysis/checks/
 *  types/unknown-source` `metType`). */
export const metIn = (scope: Scope) => (e: Expr): string | undefined => {
  const t = inferExprType(e, scope, rootOf(scope))
  return t.kind === "elementary" ? t.name : undefined
}

/** What `S=` and `R=` read and set. */
export const BOOL: Type = elementaryRef("BOOL")

/** An enum member's value folded in the project — what `strictEnum` reads its members by. */
export const enumerator = (project: Scope) => (e: Expr): bigint | undefined => {
  const v = constEval(e, project)
  return typeof v === "bigint" ? v : undefined
}

/** One bound file's stores, collected in the order the cross-check uses them up (`crossCheckBuildTypes`). */
export class StoreWalk {
  readonly out: Store[] = []
  /** a body that did not parse — on the vendor too — is typed by neither side (`dumps.ts` `unparsedIn`) */
  readonly unparsed: (e: { span: { start: number; end: number } }) => boolean

  constructor(
    readonly b: Bound,
    says: ReadonlySet<string> | undefined,
  ) {
    this.unparsed = unparsedIn(b.parsed.parseResult, says)
  }

  /** `named`: the target as the compiler names it where it is no `Type` — a bare conversion's parameter, `ANY`. */
  store(target: Type, value: Expr, scope: Scope, named?: string, compared?: string, reversedOnTwincat?: boolean, warnedTwice?: boolean): void {
    const b = this.b
    // a store into a `strict` enum is refused in its own words, "'x' is not a valid value for strict ENUM type …" — no
    // conversion message explains or is explained by it (`types/enums` `strictEnum`, task 4.5.1)
    if (strictEnum(b.project, target, enumerator(b.project)) !== undefined) return
    const inferred = inferExprType(value, scope, b.project)
    const as = new Set([typeKey(renderType(inferred))])
    for (const t of [literalErrorType(value, target), literalCheckType(value, target)])
      if (t !== undefined) as.add(typeKey(renderType(t)))
    // CODESYS names an expression it cannot type by its text: "Cannot convert type 'Unknown type: 'x'' to type 'INT'" —
    // as written, or as the compiler echoes it (a malformed address with its `?`: 'Unknown type: '%M?0.1'',
    // `lit_address_unsized_in_body`, frontend-conformance 2.2.7)
    if (inferred.kind === "unknown") {
      as.add(typeKey(`Unknown type: '${exprText(value)}'`))
      // …with an untyped integer inside it typed as the operation it stands in, as `unknown-source` echoes it:
      // 'F_C2_loop(depth := (depth - INT#1))' (`cc2_call_recursion`)
      as.add(typeKey(`Unknown type: '${compilerExprText(value, metIn(scope))}'`))
    }
    // …and a string LITERAL by its message form, length-tagged: "Cannot convert type 'STRING(INT#3)' to type 'INT'" —
    // the front-end's type is STRING, the length is the message's (`analysis/rules` `stringLiteralMessageType`;
    // `cc_string_escape_literal_into_int`, `lit_uchar_two_chars`, `lit_utf8_*_into_wstring`, frontend-conformance 2.2.6)
    const literal = stringLiteralMessageType(value)
    if (typeof literal === "string") as.add(typeKey(literal))
    // …and a CONSTANT outside a SUBRANGE target by its value: "Cannot convert type '20' to type 'INT (0..10)'" (rule DT3,
    // `analysis/checks/types/subrange`; `subrange_*`, `dt_subrange_*`)
    if (target.kind === "elementary" && target.subrange !== undefined) {
      const v = constEval(value, scope)
      if (typeof v === "bigint" && (v < target.subrange.lower || v > target.subrange.upper)) as.add(typeKey(String(v)))
    }
    this.out.push({
      target: typeKey(named ?? renderType(target)),
      value: as,
      conversion: classifyConversion(target, inferred),
      printed: `${renderType(inferred)} → ${named ?? renderType(target)}`,
      ...(compared !== undefined ? { compared } : {}),
      ...(reversedOnTwincat === true ? { reversedOnTwincat } : {}),
      ...(warnedTwice === true ? { warnedTwice } : {}),
    })
  }

  /** A conversion a RULE of the front-end names by its two types, with no value expression to type: an operator's operand
   *  family (`operandFamilyRule`, `unaryOperandConversion` — 'STRING' into 'ANY_NUM', 'REAL' into 'ANY_BIT'), an
   *  output binding's parameter into its variable. */
  pair(target: string, from: Type | string, conversion: ReturnType<typeof classifyConversion>): void {
    const fromName = typeof from === "string" ? from : renderType(from)
    this.out.push({ target: typeKey(target), value: new Set([typeKey(fromName)]), conversion, printed: `${fromName} → ${target}` })
  }

  /** Stores inside an expression: an operand converts to the type of its operator — for a comparison, whose BOOL is not
   *  what its operands convert to, to the two operands' checked meet — and an input argument to its parameter's type. */
  inner(e: Expr, scope: Scope, twice: boolean): void {
    for (const x of valueExprs(e)) {
      if (x.kind === "unary") this.unaryStores(x, scope, twice)
      else if (x.kind === "binary") {
        this.binaryOperandStores(x, scope, twice)
        this.binaryResultStores(x, scope, twice)
      } else if (x.kind === "call") {
        this.intrinsicCallStores(x, scope, twice)
        this.argumentStores(x, scope, twice)
      }
    }
  }

  private unaryStores(x: Extract<Expr, { kind: "unary" }>, scope: Scope, twice: boolean): void {
    const b = this.b
    this.store(inferExprType(x, scope, b.project), x.operand, scope, undefined, undefined, undefined, twice)
    // …except where the operator computes in no integer the operand could convert to: `NOT aReal`, `NOT aString` name
    // ANY_BIT (`types/arith/operators` `unaryOperandConversion`; `uop_not_real`, `unary_not_on_string`)
    if (x.op === "-" || x.op === "NOT") {
      const operand = inferExprType(x.operand, scope, b.project)
      if (operand.kind === "elementary" && unaryOperandConversion(x.op, operand.elem.family) === "ANY_BIT") this.pair("ANY_BIT", operand, "incompatible")
    }
  }

  private binaryOperandStores(x: Extract<Expr, { kind: "binary" }>, scope: Scope, twice: boolean): void {
    const b = this.b
    // an arithmetic operand of the wrong FAMILY converts into what the rule names — a BOOL into the number beside it, a
    // string into ANY_NUM or that number (`types/arith/operators` `operandFamilyRule`; `cc_string_plus_string`,
    // `cc_int_plus_string`, `string_arithmetic_rejected`)
    const [lt, rt] = [inferExprType(x.left, scope, b.project), inferExprType(x.right, scope, b.project)]
    const rule = lt.kind === "elementary" && rt.kind === "elementary" ? operandFamilyRule(x.op, lt.name, rt.name) : undefined
    // …but a BOOL operand and a scaled duration, which the operand stores into the result and the duration store
    // below already hold
    const heldBelow = rule?.kind === "convert" && (rule.from === "BOOL" || (lt.kind === "elementary" && rt.kind === "elementary" && durationScaleConversion(x.op, lt.name, rt.name) !== undefined))
    if (rule?.kind === "convert" && !heldBelow) this.pair(rule.to, rule.from, "incompatible")
    // a BITWISE operator computes in the UNSIGNED integer of its operands' width: a signed operand of a same-width pair
    // converts into it (`types/arith/operators` `operandConversion` "unsigned"; `cc_bitwise_byte_and_sint`: BYTE AND
    // SINT is "signed Type 'SINT' to unsigned Type 'USINT'")
    if (operandConversion(x.op) === "unsigned") {
      const sides = [x.left, x.right].map((side) => [side, inferExprType(side, scope, b.project)] as const)
      const [l, r] = sides.map(([, t]) => (t.kind === "elementary" && (t.elem.family === "int" || t.elem.family === "bitstring") ? t.elem : undefined))
      if (l !== undefined && r !== undefined && l.bits === r.bits && l.signed !== r.signed)
        for (const [side, t] of sides)
          if (t.kind === "elementary" && t.elem.signed && side.kind !== "literal") this.store(elementaryTypeRef(integerOfWidth(t.elem.bits, false)), side, scope, undefined, undefined, undefined, twice)
    }
    // an untyped NEGATIVE literal compared with an unsigned operand converts into the type the rule names (rule LT12,
    // `types/arith/operators` `negativeLiteralComparisonTarget`) — a parenthesised one too (`tr_6_negative_paren_beside_unsigned`)
    if (COMPARISONS.has(x.op))
      for (const [written, other] of [[x.left, x.right], [x.right, x.left]] as const) {
        const lit = unparenthesised(written)
        const value = constEval(lit, scope)
        const operand = inferExprType(other, scope, b.project)
        if (!isSignedUntypedNumber(lit) || typeof value !== "bigint" || operand.kind !== "elementary") continue
        const into = negativeLiteralComparisonTarget(operand.elem, value, b.project.dialect)
        if (into !== undefined) this.store({ kind: "elementary", name: into.name, elem: into }, lit, scope, undefined, undefined, undefined, twice)
      }
  }

  private binaryResultStores(x: Extract<Expr, { kind: "binary" }>, scope: Scope, twice: boolean): void {
    const b = this.b
    // date/time arithmetic converts no operand — a date and a duration stay as they are (`types/arith/temporal`, rule
    // AR17) — except a duration scaled by an integer (rule AR18, `durationScaleConversion`): into a WIDER integer the
    // duration converts ("Cannot convert type 'TIME' to type 'LINT'", `ar_time_scaled_by_wide_or_unsigned_int_type`), and
    // an integer no wider converts into the signed integer of the duration's width (CODESYS: "UDINT to DINT",
    // `ar_duration_scaled_by_same_width_unsigned_type`)
    const temporal = temporalArithmeticType(x.op, inferExprType(x.left, scope, b.project), inferExprType(x.right, scope, b.project))
    const [lt, rt] = [inferExprType(x.left, scope, b.project), inferExprType(x.right, scope, b.project)]
    const scaled = lt.kind === "elementary" && rt.kind === "elementary" ? durationScaleConversion(x.op, lt.name, rt.name) : undefined
    if (scaled !== undefined) this.store(elementaryRef(scaled.to), scaled.side === "left" ? x.left : x.right, scope, undefined, undefined, undefined, twice)
    if (temporal === undefined) {
      const result = COMPARISONS.has(x.op)
        ? checkedMeetType(inferExprType(x.left, scope, b.project), inferExprType(x.right, scope, b.project))
        : inferExprType(x, scope, b.project)
      if (result !== undefined) {
        const compared = COMPARISONS.has(x.op)
          ? `${typeKey(renderType(inferExprType(x.left, scope, b.project)))}|${typeKey(renderType(inferExprType(x.right, scope, b.project)))}`
          : undefined
        this.store(result, x.left, scope, undefined, compared, undefined, twice)
        this.store(result, x.right, scope, undefined, compared, undefined, twice)
      }
    }
    // AND_THEN / OR_ELSE over integers: the integer their operands meet in is refused as the condition, "Cannot convert
    // type 'UINT' to type 'BOOL'" (`types/arith/operators` `shortCircuitType`, rule CB5) — the operands' own stores
    // into that integer are the binary branch's above
    if (SHORT_CIRCUIT_OPERATORS.has(x.op) && inferExprType(x, scope, b.project).kind === "elementary") {
      const met = inferExprType(x, scope, b.project)
      if (met.kind === "elementary" && met.elem.family !== "bool") this.store(BOOL, x, scope, undefined, undefined, undefined, twice)
    }
  }

  private intrinsicCallStores(x: Extract<Expr, { kind: "call" }>, scope: Scope, twice: boolean): void {
    const b = this.b
    if (x.callee.kind !== "ident_expr") return
    // an ATOMIC intrinsic's operand (`builtins` `atomicOperand`, `calls/atomic-operands.ts`): TEST_AND_SET stores it into a
    // DWORD; __XADD and __COMPARE_AND_SWAP refuse what they do not take, into the type they name
    if (x.args[0]?.value !== undefined) {
      const atomic = atomicOperand(x.callee.name, b.project.dialect)
      const arg = x.args[0].value
      if (atomic?.store === true) this.store(atomic.type, arg, scope, undefined, undefined, undefined, twice)
      else if (atomic !== undefined && atomic.refuses(inferExprType(arg, scope, b.project))) this.pair(renderType(atomic.type), inferExprType(arg, scope, b.project), "incompatible")
    }
    // a CONVERSION's argument converts into its source type first (`analysis/rules` `conversionArgError`, rule CV2:
    // `REAL_TO_DINT(EXPT(…))` LREAL into REAL, `INT_TO_REAL(aReal)` REAL into INT — `cfold_expt`,
    // `conversion_int_to_real_wrong_source`)
    const from = parseConversionName(x.callee.name, targetOf(b.project))?.from
    const arg = x.args[0]?.value
    if (from !== undefined && arg !== undefined) this.store(elementaryTypeRef(from), arg, scope, undefined, undefined, undefined, twice)
  }

  private argumentStores(x: Extract<Expr, { kind: "call" }>, scope: Scope, twice: boolean): void {
    const b = this.b
    // a selection function's VALUE arguments convert into its result, their meet (`types/builtins` `selectionValueArguments`,
    // rules AR13/AR14) — the compiler's own name, unshadowed
    const values = x.callee.kind === "ident_expr" && resolveCallee(x, scope, b.project) === undefined ? selectionValueArguments(x.callee.name, x.args.map((a) => a.value)) : undefined
    const selected = values === undefined ? UNKNOWN : inferExprType(x, scope, b.project)
    if (selected.kind === "elementary") for (const v of values ?? []) if (v !== undefined) this.store(selected, v, scope, undefined, undefined, undefined, twice)
    // a BARE conversion converts its argument to ANY (`analysis/hole` `bareConversionArgument`, frontend-conformance 2.2b)
    const converted = bareConversionArgument(x)
    if (converted !== undefined) this.store(UNKNOWN, converted, scope, "ANY", undefined, undefined, twice)
    const callee = resolveCallee(x, scope, b.project)
    if (callee === undefined) return
    x.args.forEach((a, i) => {
      if (a.value === undefined) return
      // an OUTPUT binding `p => v` stores the output into the variable (`accepts_output_into_other_type`: "Cannot convert
      // type 'INT' to type 'STRING'")
      if (a.output) {
        const output = a.param === undefined ? undefined : outputType(callee, a.param.name, b)
        const into = inferExprType(a.value, scope, b.project)
        if (output !== undefined && into.kind !== "unknown") this.pair(renderType(into), output, classifyConversion(into, output))
        return
      }
      const param =
        a.param === undefined
          ? callee.positional[i]
          : callee.positional.find((p) => p.name.text.toLowerCase() === a.param!.name.toLowerCase())
      // a VAR_IN_OUT is BOUND, not converted — its own rule and message (`calls/inout-*`; `cc5_in_out_type_mismatch`)
      if (param !== undefined && !param.inOut)
        this.store(resolveTypeExpr(param.type, b.project, 0, b.project, callee.sym.uri), a.value, scope, undefined, undefined, undefined, twice)
    })
  }
}

/** The declared type of the OUTPUT `name` of a callee — a member of an FB instance's scope (its base chain's too), or a
 *  VAR_OUTPUT of a function/method's own declaration. */
export function outputType(callee: NonNullable<ReturnType<typeof resolveCallee>>, name: string, b: Bound): Type | undefined {
  const sym = callee.scope !== undefined ? lookupMember(callee.scope, name) : undefined
  const own = (callee.sym.ast as { varSections?: readonly { sectionKind: string; decls: readonly { names: readonly { text: string }[]; type: TypeExpr }[] }[] }).varSections
  const decl = own?.filter((sec) => sec.sectionKind === "VAR_OUTPUT").flatMap((sec) => sec.decls).find((d) => d.names.some((n) => n.text.toLowerCase() === name.toLowerCase()))
  if (sym?.typeExpr !== undefined) return resolveTypeExpr(sym.typeExpr, b.project, 0, sym.owner, sym.uri)
  return decl === undefined ? undefined : resolveTypeExpr(decl.type, b.project, 0, b.project, callee.sym.uri)
}

/** A `-`/`+` on an untyped integer or real literal. */
export function isSignedUntypedNumber(e: Expr): boolean {
  return e.kind === "unary" && (e.op === "-" || e.op === "+") && e.operand.kind === "literal" &&
    (e.operand.literalKind === "int" || e.operand.literalKind === "real")
}

/** A target the front-end cannot type, named as WRITTEN — `out : LDATE` on TwinCAT, which has no LDATE, is the target the
 *  vendor names "…to type 'LDATE'" (`xp_*_to_ldate`, task 4.5.3); undefined for a typed target or an unnamed one. */
export function unknownTarget(resolved: Type, written: TypeExpr): string | undefined {
  return resolved.kind === "unknown" && written.kind === "named_type" && written.qualifiers === undefined ? written.name.text : undefined
}
