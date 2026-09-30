/**
 * THE COMPILER'S BUILT-IN RESULT TYPES — the one home of "what type does this built-in hand back" (openspec
 * frontend-conformance design.md P3 "1.6 in full", §3.2). Two kinds of answer:
 *
 *   FIXED    a built-in whose result does not depend on its arguments — `BUILTIN_RESULT`, data. The reference catalog
 *            (`reference/reference.ts`) reads its hover text's return type from here; there is no second table;
 *   RULES    a built-in whose result is a function of its arguments' types — the one-argument math functions, EXPT,
 *            TwinCAT's `__XADD`, and `__POSITION` named bare. Inference (`infer.ts`) infers the arguments and asks here.
 *
 * A conversion's result (`INT_TO_REAL`, `TO_REAL`) is derived, not listed: `parseConversionName` names it.
 */
import { CODESYS_ONLY_KEYWORDS, type Dialect } from "../syntax/index.js"
import { isAssignable } from "./compat.js"
import { elementaryType } from "./elementary.js"
import { elementaryRef, elementaryTypeRef, elemOf, UNKNOWN, type Type } from "./type.js"
import { parseConversionName } from "./conversion-name.js"
import { REAL_LITERAL_TYPE } from "./literal.js"

/**
 * FIXED RESULT TYPES, measured. Without one each of these inferred UNKNOWN, which is assignable to anything, so nothing
 * downstream could see a wrong destination.
 *
 *   `__POSITION`          a STRING, and the CALL form is the only one that works: `here := __POSITION();` into a DINT is
 *                         "Cannot convert type 'STRING(INT#23)' to type 'DINT'" (`sysop_position_call_form`). The length
 *                         is the position text's own and cannot be known offline, so the plain STRING is what is claimed.
 *   `__COMPARE_AND_SWAP`  BOOL (`calls/atomic-operands.ts`, 2026-09-19).
 *   `__XADD`              DINT whatever the operand was: `__XADD(anInt, 5)` into an INT is "Cannot convert type 'DINT'
 *                         to type 'INT'" — on CODESYS (TwinCAT's is `twincatXaddResultType`).
 *   `TEST_AND_SET`        a DWORD, and the operand does not change it: `TEST_AND_SET(aBool)` into a BOOL is still "Cannot
 *                         convert type 'DWORD' to type 'BOOL'". The one fixture that
 *                         recorded this read as an OPERAND rule and is not one.
 *
 * EXPT has no fixed result — it is REAL when BOTH arguments are REAL, LREAL otherwise (`exptResultType`).
 */
export const BUILTIN_RESULT: ReadonlyMap<string, string> = new Map([
  ["__POSITION", "STRING"],
  ["__COMPARE_AND_SWAP", "BOOL"],
  ["__XADD", "DINT"],
  ["TEST_AND_SET", "DWORD"],
])

/**
 * A call to built-in `name` — a conversion `<X>_TO_<Y>`/`TO_<Y>` yields elementary `<Y>`; an operator with a FIXED
 * result yields that — or undefined. An operator the project's dialect does not have models NOTHING: on TwinCAT
 * `__POSITION()` is a call to a name nothing declares, not a STRING (`syntax/lex/vocabulary.ts`).
 */
export function builtinCallResult(name: string, dialect: Dialect | undefined): Type | undefined {
  const upper = name.toUpperCase()
  const known = dialect === "twincat" && CODESYS_ONLY_KEYWORDS.has(upper) ? undefined : BUILTIN_RESULT.get(upper)
  const modeled = parseConversionName(name)?.to.name ?? known
  if (modeled === undefined) return undefined
  const elem = elementaryType(modeled)
  return elem === undefined ? undefined : elementaryTypeRef(elem)
}

/**
 * `__POSITION` HAS A VALUE WITHOUT ITS PARENTHESES. Every other intrinsic named bare is a reference to a function and
 * has no type; this one is the source position, and CODESYS types it even where the statement around it is broken —
 * `here : DINT := __POSITION;` answers "Cannot convert type 'STRING(INT#13)' to type 'DINT'" (`sysop_position_initializer`).
 * The LENGTH is the position text's own and cannot be known offline. …on CODESYS. TwinCAT has no `__POSITION` at all
 * and answers "Identifier '__POSITION' not defined", so there the name is an ordinary identifier that resolves nowhere.
 */
export function bareBuiltinType(name: string, dialect: Dialect | undefined): Type | undefined {
  return name.toUpperCase() === "__POSITION" && dialect !== "twincat" ? elementaryRef("STRING") : undefined
}

/** The one-argument math functions whose result IS their argument's real type (measured — `mathResultType`). */
export const MATH_ARG_TYPED: ReadonlySet<string> = new Set(["SQRT", "LN", "LOG", "EXP", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN"])

/**
 * A ONE-ARGUMENT MATH FUNCTION HANDS BACK THE REAL IT WAS GIVEN. All ten, both ways (`mathret_*`, 2026-09-21):
 * `rv : REAL := SQRT(aReal)` is silent and `SQRT(anLreal)` warns about the mantissa, and the same for LN, LOG, EXP, SIN,
 * COS, TAN, ASIN, ACOS and ATAN. EXPT is the same rule with two arguments (`exptResultType`).
 *
 * ANYTHING THAT IS NOT A REAL COMES BACK LREAL. An untyped real literal has no standalone type here — it takes one from
 * its context, and its context in a call is the function, which reads it as the default: `SQRT(16.0)` is an LREAL, which
 * is why `rv : REAL := SQRT(16.0)` warns (`cfold_sqrt`, `cfold_expt`). An INTEGER argument: measured 2026-09-21 on both
 * live IDEs, all ten functions with an INT argument (`mathret_*_int`) — every one is "Implicit conversion from 'LREAL'
 * to 'REAL'". So the rule is the argument's own REAL type, or LREAL.
 *
 * `arg` is the argument's inferred type; `argIsLiteral` whether it is written as a literal. Undefined when neither
 * decides (an unknown non-literal argument).
 */
export function mathResultType(arg: Type, argIsLiteral: boolean): Type | undefined {
  if (arg.kind === "elementary" && arg.elem.family === "real") return arg
  if (arg.kind !== "unknown" || argIsLiteral) return elementaryRef(REAL_LITERAL_TYPE)
  return undefined
}

/**
 * EXPT's type: REAL only when BOTH arguments are REAL, LREAL otherwise. Measured twice — by conformance (`cc_expt_*`:
 * `real := EXPT(real, real)` is silent, EXPT(INT, INT), EXPT(REAL, INT) and EXPT(LREAL, REAL) into a REAL warn LREAL →
 * REAL) and by execution (conformance `expt_types`, `expt_mixed_width`: EXPT(REAL 3.0, INT 20) is 3486784401, which
 * float32 cannot hold).
 */
export function exptResultType(base: Type, exponent: Type): Type {
  const real32 = (t: Type): boolean => elemOf(t)?.family === "real" && elemOf(t)?.bits === 32
  return real32(base) && real32(exponent) ? elementaryRef("REAL") : elementaryRef("LREAL")
}

/**
 * What EXPT's two arguments are, for its CHECKED type: REAL, NOT REAL, an integer literal (no width, but never a REAL),
 * or unknown (a REAL literal can take either width).
 */
export type ExptArgument = "real" | "not-real" | "int-literal" | "unknown"

/**
 * EXPT's checked type — `exptResultType` once both arguments are known. An unknown argument keeps it UNKNOWN. An
 * integer LITERAL counts as not-REAL: `REAL_TO_DINT(EXPT(10, n))` warns LREAL → REAL in a real project (build
 * conformance). A REAL beside an integer literal was not measured — silence rather than a guessed type.
 */
export function exptCheckedType(kinds: readonly ExptArgument[]): Type {
  if (kinds.length !== 2 || kinds.includes("unknown")) return UNKNOWN
  if (kinds.includes("real") && kinds.includes("int-literal")) return UNKNOWN
  const asType = (k: string): Type => elementaryRef(k === "real" ? "REAL" : "LINT")
  return exptResultType(asType(kinds[0]!), asType(kinds[1]!))
}

/**
 * TWINCAT'S `__XADD` HANDS BACK WHAT IT WAS GIVEN, where CODESYS's is always a DINT. The same six operand types that
 * pinned the ARGUMENT also pin the result: `res : INT := __XADD(anInt, 1)` builds clean on TwinCAT and is "Cannot
 * convert type 'DINT' to type 'INT'" on CODESYS, and a DWORD operand warns about a sign change on CODESYS alone
 * (`atomic_xadd_int`, `atomic_xadd_dword`, both recordings 2026-09-20). …and an operand it REFUSES yields no usable
 * result: `__XADD(pDint, 1)` is one error about the pointer on TwinCAT (`atomic_xadd_pointer`), not that error plus a
 * conversion complaint about what it returned. `first` is the first argument's inferred type.
 */
export function twincatXaddResultType(first: Type): Type {
  return first.kind === "elementary" && isAssignable(elementaryRef("DINT"), first) ? first : UNKNOWN
}
