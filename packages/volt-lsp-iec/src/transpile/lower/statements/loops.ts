/**
 * The three loops as one IR shape — FOR, WHILE, REPEAT — and EXIT / CONTINUE.
 */

import type { Lowering } from "../core/lowering.js"
import type { Statement, StatementList } from "../../../frontend/syntax/index.js"
import type { IrExpr, IrStmt, IrValue } from "../../ir/index.js"
import { lowerBlock } from "./statements.js"
import { lowerPlace } from "../places/places.js"
import { guardWrite } from "../places/access-guards.js"
import { lowerExpr } from "../expressions/expressions.js"
import { beside, convert, stored } from "../values/convert.js"
import { foldConstant } from "../values/fold.js"
import { classifyConversion, elementaryRef, elemOf } from "../../../frontend/types/index.js"
import { holdsCall } from "../../ir/walk.js"
import { meet } from "../values/promote.js"

/** A loop's body: an EXIT or CONTINUE in it has a loop to leave. */
function loopBody(lw: Lowering, list: StatementList): IrStmt[] {
  lw.loops++
  try {
    return lowerBlock(lw, list)
  } finally {
    lw.loops--
  }
}

/**
 * FOR → the one loop shape.
 *
 * THE LIMIT AND THE STEP ARE RE-READ ON EVERY PASS, not evaluated once before the first. This doc block said the
 * opposite — "IEC evaluates the limit and the step ONCE, before the first iteration, so both go into temp slots" —
 * which is what the code did until it was measured, and it was wrong: `callshape_for_bounds_changed_in_body` sets the
 * limit to 4 and the step to 3 inside the body and CODESYS runs 2 passes, ending at 7. A temp taken once cannot
 * produce that. A PROPERTY read or METHOD call in the limit therefore runs on every test too
 * (`callshape_for_limit_call`: 4 runs for 3 passes, the shape the corpus's `fbModuleManager.baseModulesCount` has).
 *
 * What IS refused, below, is the case where the number of runs is not recorded: a call in the STEP, or a call in a
 * limit that a runtime step tests on both arms.
 */
export function lowerFor(lw: Lowering, s: Extract<Statement, { kind: "for" }>): IrStmt | undefined {
  const control = lowerPlace(lw, s.controlVar)
  if (control === undefined || guardWrite(lw, control, s.controlVar.span, ["union", "constant"]) === undefined) return undefined
  const from = lowerExpr(lw, s.from, control.type)
  // The LIMIT is not lowered in the counter's type: a literal the counter cannot hold is compared as it is — `FOR small :=
  // 1 TO 200` on a SINT runs until something EXITs, as `TO (100 + 100)` does (`tr_36_for_literal_limit_beyond_counter`).
  // Narrowed, it was -56 and the loop ran zero passes. A limit that fits takes the counter's type (`beside`).
  const lowered = lowerExpr(lw, s.to)
  if (from === undefined || lowered === undefined) return undefined
  const to = beside(lowered, control.type)

  const by = s.by === undefined ? undefined : lowerExpr(lw, s.by, control.type)
  if (s.by !== undefined && by === undefined) return undefined
  // The limit and the step are read on EVERY pass (conformance `callshape_for_bounds_changed_in_body`: a body that sets the
  // limit to 4 and the step to 3 after the first pass runs 2 passes, ending at 7). The limit was taken into a temp once —
  // unrecorded, and wrong. A PROPERTY read or METHOD call in the limit runs on every test too (`callshape_for_limit_call`:
  // 4 runs for 3 passes, the corpus's `fbModuleManager.baseModulesCount`). One in the step, or in a limit a runtime step
  // tests on two arms, would run a number of times no recording shows: refused below.
  const step: IrValue | undefined = s.by === undefined ? 1n : foldConstant(lw, s.by)
  // A step whose type does not convert into the counter's is a build error — "Cannot convert type 'INT' to type 'BYTE'"
  // for a runtime INT step on a BYTE counter, '... to type 'SINT'' for BY 300 on a SINT (`tr_35_for_byte_runtime_int_step`,
  // `tr_35_for_sint_step_300`). A negative literal on an unsigned counter converts (a change of sign): BY -1 on a BYTE.
  // A literal adopts the counter's type whatever its value, so a folded step is asked by VALUE: it fits the counter, or
  // it is a negative one on an unsigned counter that the signed type of that width holds. A runtime step is asked by its
  // TYPE only when it is a variable, the measured shape: an expression of untyped literals (`SEL(b, 2, -2)`) meets as
  // LINT here, and CODESYS compiles it on an INT counter (`callshape_for_runtime_step`).
  const counter = elemOf(control.type)
  const foldedFits = (v: bigint): boolean =>
    stored(v, control.type) === v || (counter !== undefined && !counter.signed && v < 0n && BigInt.asIntN(counter.bits, v) === v)
  if (by !== undefined && ((by.kind === "load" && classifyConversion(control.type, by.type) === "incompatible") || (typeof step === "bigint" && !foldedFits(step))))
    return lw.bail("for-step-type", "a FOR step whose type does not convert into the counter's", s.by!.span)
  // A step that does not fold makes the loop's DIRECTION runtime: the test takes the limit from below for a step of 0 or
  // more and from above for a negative one (conformance `callshape_for_runtime_step`). It was refused (`for-step-runtime`)
  // — guessing `<=` would run a negative step zero times.
  //
  // A folded step is held at the counter's width (BY -1 on a BYTE adds 255, which wraps it down) while the DIRECTION stays
  // the signed literal's: CODESYS counts a BYTE down from 5 to 0 and a UINT from 10 to 0 BY -2 (`tr_35_for_*_step_*`).
  const stepExpr: IrExpr = step === undefined ? convert(by!, control.type) : { kind: "const", value: stored(step, control.type), type: control.type, span: s.by?.span ?? s.span }
  const bool = elementaryRef("BOOL")
  // THE TEST MEETS THE PAIR IN THE COMMON TYPE, like every other comparison.
  //
  // This was `convert(to, to.type)` — a no-op — so the limit kept its own type and the counter kept its own,
  // and the emitted test compared them AS THEY WERE: `FOR i := 1 TO hi` with `i : INT` and `hi : DINT` printed
  // `self.i <= self.hi`, which is `i16 <= i32` and which rustc rejects with E0308. Zero diagnostics, on ordinary
  // ST that CODESYS compiles.
  //
  // the meet (`values/promote.ts`, `for-compare`: `commonType`) rather than `control.type`, and the difference is not cosmetic: narrowing the LIMIT into the
  // counter's type would wrap a limit the counter cannot hold (a DINT 100000 into an INT is -31072, and the loop
  // would run zero times instead of until the counter wraps). Promoting is what `commonType` already encodes for
  // binary operands, measured — the signed type at equal width, the wider rank otherwise.
  const compareIn = meet(lw, [{ kind: "load", place: control, type: control.type, span: s.controlVar.span }, to], { kind: "for-compare" }, s.span)!.type
  const current: IrExpr = convert({ kind: "load", place: control, type: control.type, span: s.controlVar.span }, compareIn)
  const limit = convert(to, compareIn)
  const binary = (op: "le" | "ge" | "lt" | "and" | "or", left: IrExpr, right: IrExpr): IrExpr => ({ kind: "binary", op, left, right, type: bool, span: s.span })
  const zero: IrExpr = { kind: "const", value: 0n, type: control.type, span: s.span }
  // an unsigned control variable's step cannot be negative: its loop only counts up (and `0u16 <= step` is a rustc lint)
  const unsigned = control.type.kind === "elementary" && !control.type.elem.signed
  const cond =
    step !== undefined || unsigned
      ? binary(step === undefined || Number(step) >= 0 ? "le" : "ge", current, limit)
      : binary("or", binary("and", binary("ge", stepExpr, zero), binary("le", current, limit)), binary("and", binary("lt", stepExpr, zero), binary("ge", current, limit)))

  if ((by !== undefined && holdsCall(by)) || (holdsCall(to) && step === undefined && !unsigned))
    return lw.bail("for-bound-call", "a FOR step holding a call, or a limit holding one tested on both arms of a runtime step — how often it runs is not recorded", s.span)

  return {
    kind: "loop",
    init: [{ kind: "assign", target: control, value: convert(from, control.type), span: s.from.span }],
    test: { cond, atEnd: false },
    body: loopBody(lw, s.body),
    // The step adds in the COUNTER's type: `current` is the counter widened for the test, and adding a step of the
    // counter's type to it printed `(self.u as i32).wrapping_add(1u16)` — E0308 (transpile-review 13).
    step: [{ kind: "assign", target: control, value: { kind: "binary", op: "add", left: { kind: "load", place: control, type: control.type, span: s.controlVar.span }, right: stepExpr, type: control.type, span: s.span }, span: s.span }],
    span: s.span,
  }
}

/** WHILE: the loop shape, its test at the top. */
export function lowerWhile(lw: Lowering, s: Extract<Statement, { kind: "while" }>): IrStmt | undefined {
  const cond = lowerExpr(lw, s.cond, elementaryRef("BOOL"))
  return cond && { kind: "loop", init: [], test: { cond, atEnd: false }, body: loopBody(lw, s.body), step: [], span: s.span }
}

/** REPEAT runs until its condition holds; the IR's test is "keep going", so it is negated here, and tested at the end. */
export function lowerRepeat(lw: Lowering, s: Extract<Statement, { kind: "repeat" }>): IrStmt | undefined {
  const until = lowerExpr(lw, s.until, elementaryRef("BOOL"))
  if (until === undefined) return undefined
  const cond: IrExpr = { kind: "unary", op: "not", operand: until, type: until.type, span: until.span }
  return { kind: "loop", init: [], test: { cond, atEnd: true }, body: loopBody(lw, s.body), step: [], span: s.span }
}

/** EXIT / CONTINUE. CODESYS refuses both outside a loop — "No enclosing loop of which to exit" (`cc2_exit_outside_loop`);
 *  lowered, they were a Rust E0268 and an interpreter that stopped the body (transpile-review 39). */
export function lowerExit(lw: Lowering, s: Extract<Statement, { kind: "exit" | "continue" }>): IrStmt | undefined {
  if (lw.loops === 0) return lw.bail("exit-outside-loop", `${s.kind.toUpperCase()} outside any loop`, s.span)
  return { kind: s.kind === "exit" ? "break" : "continue", span: s.span }
}
