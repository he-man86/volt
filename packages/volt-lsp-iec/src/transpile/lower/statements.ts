/**
 * Statements → IR: assignment and its chains and latches, IF, CASE, the three loops, and call statements.
 */
import type { Statement, StatementList } from "../../syntax/index.js"
import { elementaryRef } from "../../types/index.js"
import type { IrArm, IrExpr, IrStmt, IrValue } from "../ir/index.js"
import { holdsCall } from "../ir/index.js"
import type { Lowering } from "./lowering.js"
import { convert } from "./convert.js"
import { foldConstant } from "./constants.js"
import { lowerPlace, refuseOpenArray } from "./places.js"
import { bindReference, pointeePlace, refuseConstantWrite, storePointer, through } from "./pointers.js"
import { lowerExpr } from "./expressions.js"
import { lowerCallStatement, lowerPropertySet } from "./calls.js"
import { refuseUnionWrite, unionCopies } from "./unions.js"
import { lowerQueryInterface, storeInterface } from "./interfaces.js"

export function lowerBlock(lw: Lowering, list: StatementList): IrStmt[] {
  const out: IrStmt[] = []
  for (const s of list) {
    // a statement inside another runs only sometimes — a pointer it stores is not stored for what follows (`recordTarget`)
    const nests = s.kind === "if" || s.kind === "case" || s.kind === "for" || s.kind === "while" || s.kind === "repeat"
    if (nests) lw.conditional++
    const lowered = lowerStmt(lw, s)
    if (nests) lw.conditional--
    if (Array.isArray(lowered)) out.push(...lowered)
    else if (lowered !== undefined) out.push(lowered)
  }
  return out
}

/**
 * An assignment CHAIN — `a := b := c`, `a S= b R= c`, `a := b S= c`. One rule fits every chain measured
 * (conformance `set_reset_chained*`, `assign_chained_*`): the VALUE flows right to left, converted to each link's
 * type as it passes; a `:=` link stores it, and an `S=`/`R=` link latches its target on it and passes it on UNCHANGED.
 *   - `a S= b R= c` with b FALSE, c TRUE SETS `a` — it latches on `c`, not on the old or new `b`;
 *   - `plain := latch S= cond` with cond FALSE makes `plain` FALSE even though `latch` stays TRUE;
 *   - `sint := dint := int` does not compile, "Cannot convert type 'DINT' to type 'SINT'" — `sint` receives the value
 *     as converted THROUGH the DINT link, not the INT source.
 * The value is evaluated ONCE, into a temp, so a call in it cannot run twice.
 */
export function lowerChain(lw: Lowering, s: Extract<Statement, { kind: "assign" }>): IrStmt[] | undefined {
  const targets = [s.target, ...(s.chained ?? [])]
  const ops = [s.op, ...(s.chainOps ?? [])] // ops[i] is the operator after targets[i]
  if (ops.includes("REF=")) return lw.bail("assign-op", "REF= in an assignment chain", s.span)
  const value = lowerExpr(lw, s.value)
  if (value === undefined) return undefined
  const held = lw.tempPlace("chain_value", value.type, s.value.span)
  const out: IrStmt[] = [{ kind: "assign", target: held, value, span: s.value.span }]
  let flowing: IrExpr = { kind: "load", place: held, type: value.type, span: s.value.span }
  for (let i = targets.length - 1; i >= 0; i--) {
    const written = lowerPlace(lw, targets[i]!)
    const target = written === undefined || refuseOpenArray(lw, written, targets[i]!.span) ? undefined : through(lw, written, targets[i]!.span)
    if (target === undefined) return undefined
    const op = ops[i]
    if (op === undefined) {
      flowing = convert(flowing, target.type) // a `:=` link converts the value on its way through
      out.push({ kind: "assign", target, value: flowing, span: s.span })
      continue
    }
    // a latch acts on the value and passes it on unchanged
    const latch: IrExpr = { kind: "const", value: op === "S=", type: elementaryRef("BOOL"), span: s.span }
    const set: IrStmt = { kind: "assign", target, value: convert(latch, target.type), span: s.span }
    out.push({ kind: "if", cond: convert(flowing, elementaryRef("BOOL")), then: [set], else: [], span: s.span })
  }
  return out
}

export function lowerStmt(lw: Lowering, s: Statement): IrStmt | IrStmt[] | undefined {
  switch (s.kind) {
    case "empty":
      return undefined
    case "assign": {
      // a PROPERTY's setter (conformance `state_property_get_set`)
      const property = lowerPropertySet(lw, s)
      if (property !== null) return property
      const query = lowerQueryInterface(lw, s)
      if (query !== null) return query
      if (s.chained !== undefined) return lowerChain(lw, s)
      if (s.op === "REF=") return bindReference(lw, s)
      const target = lowerPlace(lw, s.target)
      // an `ARRAY[*]` is never stored whole (it is still BOUND whole to an in-out, which `through` checks, so not there)
      if (target === undefined || refuseOpenArray(lw, target, s.span) || refuseConstantWrite(lw, target, s.span)) return undefined
      if (s.op === "S=" || s.op === "R=") {
        // A LATCH, not an assignment: `x S= c` sets x only when c is TRUE and otherwise leaves it — `latched := TRUE;
        // latched S= FALSE` stays TRUE — and `R=` clears the same way. The whole right-hand side is the condition:
        // `x S= (i > 5) AND flag` (conformance `set_reset_*`). So it lowers to the IF it is; no backend sees an `S=`.
        const cond = lowerExpr(lw, s.value, elementaryRef("BOOL"))
        if (cond === undefined) return undefined
        const latch: IrExpr = { kind: "const", value: s.op === "S=", type: elementaryRef("BOOL"), span: s.span }
        const latched = through(lw, target, s.span)
        if (latched === undefined) return undefined
        const set: IrStmt = { kind: "assign", target: latched, value: convert(latch, latched.type), span: s.span }
        return { kind: "if", cond, then: [set], else: [], span: s.span }
      }
      if (target.type.kind === "pointer") return storePointer(lw, target, s.value, s.span)
      if (target.type.kind === "interface") return storeInterface(lw, target, s.value, s.span)
      if (target.type.kind === "reference") {
        // a write through a reference is a write to its target
        const pointee = pointeePlace(lw, target, undefined, s.span)
        if (pointee === undefined || refuseConstantWrite(lw, pointee, s.span)) return undefined
        const written = lowerExpr(lw, s.value, pointee.type)
        return written && { kind: "assign", target: pointee, value: convert(written, pointee.type), span: s.span }
      }
      const value = lowerExpr(lw, s.value, target.type)
      if (value === undefined) return undefined
      const store: IrStmt = { kind: "assign", target, value: convert(value, target.type), span: s.span }
      // a UNION member's store, then its bytes into the members it overlays
      const copies = unionCopies(lw, target, s.span)
      return copies && [store, ...copies]
    }
    case "if": {
      // ELSIF is an ELSE holding one nested IF — one shape for the backend, not a branch list.
      const build = (i: number): IrStmt | undefined => {
        const branch = s.branches[i]
        if (branch === undefined) return undefined
        const cond = lowerExpr(lw, branch.cond, elementaryRef("BOOL"))
        if (cond === undefined) return undefined
        const rest = build(i + 1)
        const otherwise = rest !== undefined ? [rest] : s.elseBody ? lowerBlock(lw, s.elseBody) : []
        return { kind: "if", cond, then: lowerBlock(lw, branch.body), else: otherwise, span: branch.span }
      }
      return build(0)
    }
    case "case": {
      const selector = lowerExpr(lw, s.selector)
      if (selector === undefined) return undefined
      const arms: IrArm[] = []
      for (const arm of s.arms) {
        const labels: { lo: IrValue; hi: IrValue }[] = []
        for (const label of arm.labels) {
          const lo = foldConstant(lw, label.value)
          const hi = label.upper === undefined ? lo : foldConstant(lw, label.upper)
          if (lo === undefined || hi === undefined) {
            lw.bail("case-label", "a CASE label that is not a compile-time constant", label.span)
            return undefined
          }
          labels.push({ lo, hi })
        }
        arms.push({ labels, body: lowerBlock(lw, arm.body), span: arm.span })
      }
      return {
        kind: "switch",
        selector,
        arms,
        else: s.elseBody ? lowerBlock(lw, s.elseBody) : [],
        span: s.span,
      }
    }
    case "for":
      return lowerFor(lw, s)
    case "while": {
      const cond = lowerExpr(lw, s.cond, elementaryRef("BOOL"))
      return cond && { kind: "loop", init: [], test: { cond, atEnd: false }, body: lowerBlock(lw, s.body), step: [], span: s.span }
    }
    case "repeat": {
      // REPEAT runs until its condition holds; the IR's test is "keep going", so it is negated here.
      const until = lowerExpr(lw, s.until, elementaryRef("BOOL"))
      if (until === undefined) return undefined
      const cond: IrExpr = { kind: "unary", op: "not", operand: until, type: until.type, span: until.span }
      return { kind: "loop", init: [], test: { cond, atEnd: true }, body: lowerBlock(lw, s.body), step: [], span: s.span }
    }
    case "call_stmt":
      return lowerCallStatement(lw, s.call)
    case "exit":
      return { kind: "break", span: s.span }
    case "continue":
      return { kind: "continue", span: s.span }
    case "return":
      return { kind: "return", span: s.span }
    default:
      return lw.bail(`stmt-${s.kind}`, `${s.kind} is not lowered yet`, s.span)
  }
}

/**
 * FOR → the one loop shape. IEC evaluates the limit and the step ONCE, before the first iteration, so both
 * go into temp slots; re-reading them each pass would be a different program.
 */
export function lowerFor(lw: Lowering, s: Extract<Statement, { kind: "for" }>): IrStmt | undefined {
  const control = lowerPlace(lw, s.controlVar)
  if (control === undefined || refuseUnionWrite(lw, control, s.controlVar.span) || refuseConstantWrite(lw, control, s.controlVar.span)) return undefined
  const from = lowerExpr(lw, s.from, control.type)
  const to = lowerExpr(lw, s.to, control.type)
  if (from === undefined || to === undefined) return undefined

  const by = s.by === undefined ? undefined : lowerExpr(lw, s.by, control.type)
  if (s.by !== undefined && by === undefined) return undefined
  // The limit and the step are read on EVERY pass (conformance `callshape_for_bounds_changed_in_body`: a body that sets the
  // limit to 4 and the step to 3 after the first pass runs 2 passes, ending at 7). The limit was taken into a temp once —
  // unrecorded, and wrong. A PROPERTY read or METHOD call in the limit runs on every test too (`callshape_for_limit_call`:
  // 4 runs for 3 passes, the corpus's `fbModuleManager.baseModulesCount`). One in the step, or in a limit a runtime step
  // tests on two arms, would run a number of times no recording shows: refused below.
  const step: IrValue | undefined = s.by === undefined ? 1n : foldConstant(lw, s.by)
  // A step that does not fold makes the loop's DIRECTION runtime: the test takes the limit from below for a step of 0 or
  // more and from above for a negative one (conformance `callshape_for_runtime_step`). It was refused (`for-step-runtime`)
  // — guessing `<=` would run a negative step zero times.
  const stepExpr: IrExpr = step === undefined ? convert(by!, control.type) : { kind: "const", value: step, type: control.type, span: s.by?.span ?? s.span }
  const bool = elementaryRef("BOOL")
  const current: IrExpr = { kind: "load", place: control, type: control.type, span: s.controlVar.span }
  const limit = convert(to, to.type)
  const binary = (op: "le" | "ge" | "lt" | "and" | "or", left: IrExpr, right: IrExpr): IrExpr => ({ kind: "binary", op, left, right, type: bool, span: s.span })
  const zero: IrExpr = { kind: "const", value: 0n, type: control.type, span: s.span }
  // an unsigned control variable's step cannot be negative: its loop only counts up (and `0u16 <= step` is a rustc lint)
  const unsigned = control.type.kind === "elementary" && !control.type.elem.signed
  const cond =
    step !== undefined || unsigned
      ? binary(step === undefined || Number(step) >= 0 ? "le" : "ge", current, limit)
      : binary("or", binary("and", binary("ge", stepExpr, zero), binary("le", current, limit)), binary("and", binary("lt", stepExpr, zero), binary("ge", current, limit)))

  if (holdsCall(by) || (holdsCall(to) && step === undefined && !unsigned))
    return lw.bail("for-bound-call", "a FOR step holding a call, or a limit holding one tested on both arms of a runtime step — how often it runs is not recorded", s.span)

  return {
    kind: "loop",
    init: [{ kind: "assign", target: control, value: convert(from, control.type), span: s.from.span }],
    test: { cond, atEnd: false },
    body: lowerBlock(lw, s.body),
    step: [{ kind: "assign", target: control, value: { kind: "binary", op: "add", left: current, right: stepExpr, type: control.type, span: s.span }, span: s.span }],
    span: s.span,
  }
}

// ─── type helpers (facts come from `types/elementary`, never from a second table) ─────────────────────────
