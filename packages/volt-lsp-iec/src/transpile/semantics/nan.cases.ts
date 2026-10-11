/**
 * THE NaN TABLE (transpile-restructure 8.2, design.md §7.2 Decision step 8c; `cases.ts`): every cell CODESYS recorded for
 * `nan_payload_ops`, `nan_payload_ops_lreal` and `nan_payload_select_trig` (record:exec 2026-10-11) but the four that
 * mix a REAL with an LREAL in one expression (a conversion, then an operation: the fixtures' replays hold those). Each
 * cell is one operation over operands given as their BITS — a NaN signalling, quiet with a payload, negative, or none —
 * and the bits it answered, read through a pointer. `nan.test.ts` runs them through `semantics/` (the operations the
 * interpreter runs, over `NaNBits`); the twin harness (`test/conformance/runtime-twins.test.ts`) through rustc, each as the
 * emitter prints it, and holds every cell and its NaN operand to `codesys.run.json`.
 */
import type { Case } from "./cases.js"

/** An operation a cell asks: an operator, a function, a conversion (`widen` REAL → LREAL, `narrow` LREAL → REAL), a copy, or
 *  a select (SEL and MUX pick their second argument: the fixture's `SEL(TRUE, …)` and `MUX(1, …)`). */
type NaNOp =
  | "add" | "sub" | "mul" | "div" | "neg" | "abs" | "copy" | "widen" | "narrow" | "expt"
  | "sqrt" | "ln" | "log" | "exp" | "sin" | "cos" | "tan" | "asin" | "acos" | "atan"
  | "max" | "min" | "limit" | "sel" | "mux"

export interface NaNInput {
  readonly op: NaNOp
  /** The type the operation answers in — its operands' too, but `widen`'s (a REAL) and `narrow`'s (an LREAL). */
  readonly type: "REAL" | "LREAL"
  /** The operands' bits, in source order. */
  readonly args: readonly bigint[]
}

// the operands, by the fixtures' names: a signalling NaN, a quiet one with a payload, the negative default one, a negative
// signalling one with a payload, infinity, and the plain values beside them
const S = 0x7fa00000n
const P = 0x7fc12345n
const N = 0xffc00000n
const NS = 0xff812345n
const INF = 0x7f800000n
const ONE = 0x3f800000n
const TWO = 0x40000000n
const ZERO = 0n
const MINUS_ONE = 0xbf800000n
const S64 = 0x7ff4000000000000n
const P64 = 0x7ff8000000012345n
const N64 = 0xfff8000000000000n
const HI = 0x7ff8123400000000n
const HIS = 0x7ff1234500000000n
const INF64 = 0x7ff0000000000000n
const ONE64 = 0x3ff0000000000000n
const TWO64 = 0x4000000000000000n
const MINUS_ONE64 = 0xbff0000000000000n

/** One recorded cell: `<instance>.w<name>` of `fixture`, from the operand `<instance>.<input>` (the NaN it ran on). */
const cell =
  (fixture: string, instance: string) =>
  (name: string, op: NaNOp, type: NaNInput["type"], args: readonly bigint[], expected: bigint, input: string): Case<NaNInput, bigint> => ({
    name: `${fixture} ${name}`,
    input: { op, type, args },
    expected,
    recording: { fixture, variable: `${instance}.w${name}`, input: `${instance}.${input}` },
  })

const real = cell("nan_payload_ops", "inst_nan")
const lreal = cell("nan_payload_ops_lreal", "inst_nan_l")
const sel = cell("nan_payload_select_trig", "inst_nan_sel")

/** The recorded NaN cells, by the rule they show. */
export const NAN_CASES: Readonly<Record<string, readonly Case<NaNInput, bigint>[]>> = {
  "an operation answers its first NaN operand, quieted — its sign and payload kept, the source's operand order": [
    real("AddSOne", "add", "REAL", [S, ONE], 0x7fe00000n, "dS"),
    real("AddOneS", "add", "REAL", [ONE, S], 0x7fe00000n, "dS"),
    real("SubSOne", "sub", "REAL", [S, ONE], 0x7fe00000n, "dS"),
    real("SubOneS", "sub", "REAL", [ONE, S], 0x7fe00000n, "dS"),
    real("MulSOne", "mul", "REAL", [S, ONE], 0x7fe00000n, "dS"),
    real("MulOneS", "mul", "REAL", [ONE, S], 0x7fe00000n, "dS"),
    real("DivSOne", "div", "REAL", [S, ONE], 0x7fe00000n, "dS"),
    real("DivOneS", "div", "REAL", [ONE, S], 0x7fe00000n, "dS"),
    real("AddPOne", "add", "REAL", [P, ONE], P, "dP"),
    real("AddOneP", "add", "REAL", [ONE, P], P, "dP"),
    real("AddNOne", "add", "REAL", [N, ONE], N, "dN"),
    real("AddOneNS", "add", "REAL", [ONE, NS], 0xffc12345n, "dNS"),
    real("AddSP", "add", "REAL", [S, P], 0x7fe00000n, "dS"),
    real("AddPS", "add", "REAL", [P, S], P, "dP"),
    real("AddPN", "add", "REAL", [P, N], P, "dP"),
    real("AddNP", "add", "REAL", [N, P], N, "dN"),
    real("MulNSP", "mul", "REAL", [NS, P], 0xffc12345n, "dNS"),
    real("MulPNS", "mul", "REAL", [P, NS], P, "dP"),
    real("SubPS", "sub", "REAL", [P, S], P, "dP"),
    real("SubSP", "sub", "REAL", [S, P], 0x7fe00000n, "dS"),
    lreal("AddSOne", "add", "LREAL", [S64, ONE64], 0x7ffc000000000000n, "qS"),
    lreal("AddOneS", "add", "LREAL", [ONE64, S64], 0x7ffc000000000000n, "qS"),
    lreal("SubOneS", "sub", "LREAL", [ONE64, S64], 0x7ffc000000000000n, "qS"),
    lreal("MulOneP", "mul", "LREAL", [ONE64, P64], P64, "qP"),
    lreal("AddSP", "add", "LREAL", [S64, P64], 0x7ffc000000000000n, "qS"),
    lreal("AddPS", "add", "LREAL", [P64, S64], P64, "qP"),
    lreal("AddPN", "add", "LREAL", [P64, N64], P64, "qP"),
    lreal("AddNP", "add", "LREAL", [N64, P64], N64, "qN"),
    sel("ExptSTwo", "expt", "REAL", [S, TWO], 0x7fe00000n, "dS"),
    real("ExptPTwo", "expt", "REAL", [P, TWO], P, "dP"),
    real("ExptTwoP", "expt", "REAL", [TWO, P], P, "dP"),
  ],
  "NEG keeps a NaN's sign, ABS clears it — both quiet it": [
    real("NegS", "neg", "REAL", [S], 0x7fe00000n, "dS"),
    real("NegP", "neg", "REAL", [P], P, "dP"),
    real("NegN", "neg", "REAL", [N], N, "dN"),
    lreal("NegP", "neg", "LREAL", [P64], P64, "qP"),
    real("AbsN", "abs", "REAL", [N], 0x7fc00000n, "dN"),
    real("AbsNS", "abs", "REAL", [NS], P, "dNS"),
    sel("AbsS", "abs", "REAL", [S], 0x7fe00000n, "dS"),
    lreal("AbsN", "abs", "LREAL", [N64], 0x7ff8000000000000n, "qN"),
    sel("LAbsS", "abs", "LREAL", [S64], 0x7ffc000000000000n, "qS"),
  ],
  "a function of a NaN answers it quieted — SQRT, LN, LOG, EXP and the x87 trigonometry alike": [
    real("SqrtS", "sqrt", "REAL", [S], 0x7fe00000n, "dS"),
    real("SqrtP", "sqrt", "REAL", [P], P, "dP"),
    real("SqrtN", "sqrt", "REAL", [N], N, "dN"),
    real("LnP", "ln", "REAL", [P], P, "dP"),
    real("LogP", "log", "REAL", [P], P, "dP"),
    real("ExpP", "exp", "REAL", [P], P, "dP"),
    lreal("SqrtS", "sqrt", "LREAL", [S64], 0x7ffc000000000000n, "qS"),
    lreal("SqrtP", "sqrt", "LREAL", [P64], P64, "qP"),
    lreal("LnP", "ln", "LREAL", [P64], P64, "qP"),
    lreal("ExpP", "exp", "LREAL", [P64], P64, "qP"),
    sel("SinP", "sin", "REAL", [P], P, "dP"),
    sel("CosP", "cos", "REAL", [P], P, "dP"),
    sel("TanP", "tan", "REAL", [P], P, "dP"),
    sel("AsinP", "asin", "REAL", [P], P, "dP"),
    sel("AcosP", "acos", "REAL", [P], P, "dP"),
    sel("AtanP", "atan", "REAL", [P], P, "dP"),
    sel("SinS", "sin", "REAL", [S], 0x7fe00000n, "dS"),
    sel("LSinP", "sin", "LREAL", [P64], P64, "qP"),
    sel("LAtanP", "atan", "LREAL", [P64], P64, "qP"),
  ],
  "a NaN made from operands that are none is the default one, sign set; EXPT(NaN, 0) is 1": [
    real("LnMinusOne", "ln", "REAL", [MINUS_ONE], N, "one"),
    real("AsinTwo", "asin", "REAL", [TWO], N, "two"),
    real("InfMinusInf", "sub", "REAL", [INF, INF], N, "dInf"),
    real("InfTimesZero", "mul", "REAL", [INF, ZERO], N, "dInf"),
    lreal("LnMinusOne", "ln", "LREAL", [MINUS_ONE64], N64, "one"),
    lreal("AsinTwo", "asin", "LREAL", [TWO64], N64, "two"),
    lreal("InfMinusInf", "sub", "LREAL", [INF64, INF64], N64, "qInf"),
    sel("ExptPZero", "expt", "REAL", [P, ZERO], ONE, "dP"),
  ],
  "REAL ↔ LREAL quiets a NaN and moves its payload: REAL's 23 bits are the top of LREAL's 52": [
    lreal("FromFS", "widen", "LREAL", [S], 0x7ffc000000000000n, "dS"),
    lreal("FromFP", "widen", "LREAL", [P], 0x7ff82468a0000000n, "dP"),
    lreal("FromFN", "widen", "LREAL", [N], N64, "dN"),
    lreal("FromFNS", "widen", "LREAL", [NS], 0xfff82468a0000000n, "dNS"),
    lreal("ToS", "narrow", "REAL", [S64], 0x7fe00000n, "qS"),
    lreal("ToP", "narrow", "REAL", [P64], 0x7fc00000n, "qP"),
    lreal("ToHi", "narrow", "REAL", [HI], 0x7fc091a0n, "qHi"),
    lreal("ToHiS", "narrow", "REAL", [HIS], 0x7fc91a28n, "qHiS"),
    lreal("ToN", "narrow", "REAL", [N64], N, "qN"),
  ],
  "a copy and the selects carry a NaN as it is, a signalling one unquieted": [
    real("CopyS", "copy", "REAL", [S], S, "dS"),
    real("CopyNS", "copy", "REAL", [NS], NS, "dNS"),
    lreal("CopyS", "copy", "LREAL", [S64], S64, "qS"),
    sel("MaxOneS", "max", "REAL", [ONE, S], S, "dS"),
    sel("MaxSOne", "max", "REAL", [S, ONE], ONE, "dS"),
    sel("MinOneS", "min", "REAL", [ONE, S], S, "dS"),
    sel("LimitZeroOneS", "limit", "REAL", [ZERO, ONE, S], S, "dS"),
    sel("SelS", "sel", "REAL", [ONE, S], S, "dS"),
    sel("MuxS", "mux", "REAL", [ONE, S], S, "dS"),
    sel("LMaxOneS", "max", "LREAL", [ONE64, S64], S64, "qS"),
    sel("LSelS", "sel", "LREAL", [ONE64, S64], S64, "qS"),
  ],
}
