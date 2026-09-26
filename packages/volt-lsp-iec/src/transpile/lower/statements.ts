/**
 * Statements → IR: assignment and its chains and latches, IF, CASE, the three loops, and call statements.
 */
import { isSelfRef, type Span, type Statement, type StatementList } from "../../syntax/index.js"
import { elementaryRef, commonType, elemOf, type Type } from "../../types/index.js"
import type { IrArm, IrExpr, IrStmt, IrValue } from "../ir/index.js"
import { holdsCall } from "../ir/index.js"
import type { Lowering } from "./lowering.js"
import { convert } from "./convert.js"
import { foldConstant } from "./constants.js"
import { lowerAccess, lowerPlace, refuseOpenArray } from "./places.js"
import { bindReference, nullDeref, pointerArms, pointeePlace, refuseConstantWrite, storePointer, through } from "./pointers.js"
import { lowerExpr } from "./expressions.js"
import { lowerCallStatement, lowerPropertySet } from "./calls.js"
import { refuseUnionWrite, unionCopies } from "./unions.js"
import { lowerQueryInterface, queryCondition, storeInterface } from "./interfaces.js"

/**
 * A STORE THROUGH A POINTER OR REFERENCE NAMING SEVERAL VARIABLES (form 3) — the write half of `selectThrough`.
 *
 * `null` when this is not that shape, so the caller goes on to the ordinary place; `undefined` when it is and was
 * refused. The arms are the key's targets at the tag `storePointer` writes, and the else arm FAULTS, because a tag
 * no arm names is the null dereference the single-target form raises through `iec_deref`.
 *
 * ONLY A BARE `p^ :=` so far. A path after the dereference — `p^.field`, `p^[i]` — would have to be appended to
 * every arm's place, which is the same walk `lowerPlace` does and not one this can reuse yet; it keeps the message
 * `pointeePlace` gives.
 */
function storeThrough(lw: Lowering, s: Extract<Statement, { kind: "assign" }>): IrStmt | undefined | null {
  const t = s.target
  if (t.kind !== "deref" || isSelfRef(t)) return null
  const pointer = lowerPlace(lw, t.base)
  if (pointer === undefined || (pointer.type.kind !== "pointer" && pointer.type.kind !== "reference")) return null
  const arms = pointerArms(lw, pointer, s.span)
  if (arms === undefined) return null
  const written = arms[0]!.place.type
  const value = lowerExpr(lw, s.value, written)
  if (value === undefined) return undefined
  // THE ELSE ARM FAULTS. A tag no arm names is a null dereference, and a select with NO arms is exactly that in
  // both backends — read into a temp, so the fault happens where the store would have.
  return {
    kind: "switch",
    selector: { kind: "load", place: pointer, type: pointer.type, span: s.span },
    arms: arms.map((a) => ({
      labels: [{ lo: a.tag, hi: a.tag }],
      body: [{ kind: "assign" as const, target: a.place, value: convert(value, a.place.type), span: s.span }],
      span: s.span,
    })),
    else: [{ kind: "eval", value: nullDeref(pointer, [], written, s.span), span: s.span }],
    span: s.span,
  }
}

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

/** A STRING value stored into anything but a string — `n := '12'`, or `s[0] := 'X'` into a character — which CODESYS
 *  refuses (see the assignment below); true when refused. */
function refuseImplicitString(lw: Lowering, value: IrExpr, target: Type, span: Span): boolean {
  const targetFamily = elemOf(target)?.family
  if (elemOf(value.type)?.family !== "string" || targetFamily === undefined || targetFamily === "string") return false
  lw.bail("assign-string", `a STRING stored into a ${target.kind === "elementary" ? target.name : target.kind}, which is not a conversion the vendor makes implicitly`, span)
  return true
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
      // FORM 3's WRITE. A pointer naming several variables has no single place to store into, so the assignment is
      // an `IrSwitch` on its tag with one arm per target — the statement counterpart of the read's `IrSelect`, and
      // no new IR. Measured: `ptrhandle_write_either_target` picks its target in an IF and the 99 lands in b.
      const scattered = storeThrough(lw, s)
      if (scattered !== null) return scattered
      const indexed = (s.target.kind === "index" || (s.target.kind === "deref" && !isSelfRef(s.target))) && s.op === undefined ? lowerAccess(lw, s.target) : { place: lowerPlace(lw, s.target) }
      if (indexed === undefined) return undefined
      // `s[i] := c` or a cursor's `p^ := c` — the string stored back with one character changed (`setchar`)
      if ("char" in indexed) {
        const { place: text, index, unit } = indexed.char
        const c = lowerExpr(lw, s.value, unit)
        if (c === undefined || refuseImplicitString(lw, c, unit, s.span) || refuseConstantWrite(lw, text, s.span)) return undefined
        const load: IrExpr = { kind: "load", place: text, type: text.type, span: s.span }
        const value: IrExpr = { kind: "builtin", name: "setchar", args: [load, index, convert(c, unit)], type: text.type, span: s.span }
        return { kind: "assign", target: text, value, span: s.span }
      }
      const target = indexed.place
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
      if (target.type.kind === "pointer") {
        const stored = storePointer(lw, target, s.value, s.span)
        // a pointer stored into one member of a union of pointers overlays the others (`unions.ts`)
        const overlaid = stored === undefined ? undefined : unionCopies(lw, target, s.span)
        return stored === undefined || overlaid === undefined ? undefined : [stored, ...overlaid]
      }
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
      // A STRING DOES NOT IMPLICITLY BECOME A NUMBER. CODESYS rejects `i := 'a$Tb'` outright — "Cannot convert type
      // 'STRING(INT#4)' to type 'INT'" (`literal_string_to_int_assignment`, `cc_init_string_into_int`,
      // `cc_string_escape_literal_into_int`) — but this lowered it, and the EMITTER then threw ("no Rust mapping for a
      // string type without a capacity") while the interpreter parsed leading digits. Invalid input has to end in a
      // diagnostic here; an emitter throw is not one, and two backends disagreeing about invalid input is worse.
      //
      // Only the IMPLICIT store is refused. `STRING_TO_INT('123')` is an explicit conversion and stays, which is the
      // whole difference CODESYS draws.
      if (refuseImplicitString(lw, value, target.type, s.span)) return undefined
      const store: IrStmt = { kind: "assign", target, value: convert(value, target.type), span: s.span }
      // a UNION member's store, then its bytes into the members it overlays
      const copies = unionCopies(lw, target, s.span)
      return copies && [store, ...copies]
    }
    case "if": {
      // ELSIF is an ELSE holding one nested IF — one shape for the backend, not a branch list. A condition that is a
      // `__QUERYINTERFACE` query puts the query just before the IF that tests it (`queryCondition`).
      const build = (i: number): IrStmt[] | undefined => {
        const branch = s.branches[i]
        if (branch === undefined) return undefined
        const query = queryCondition(lw, branch.cond)
        if (query === undefined) return undefined
        const cond = query === null ? lowerExpr(lw, branch.cond, elementaryRef("BOOL")) : query.cond
        if (cond === undefined) return undefined
        const rest = build(i + 1)
        const otherwise = rest !== undefined ? rest : s.elseBody ? lowerBlock(lw, s.elseBody) : []
        return [...(query?.before ?? []), { kind: "if", cond, then: lowerBlock(lw, branch.body), else: otherwise, span: branch.span }]
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
    // `__TRY` IS MEASURED AND NOT YET LOWERED, which is a different thing from unmeasured — the model is complete
    // and written down here so whoever builds it is not asked to guess. Measured on SP21
    // (`semantics/try-catch.ts`, 2026-09-19), and it CHANGES THE FAULT MODEL for the code inside the block:
    //
    //   no fault              the body runs, the catch is skipped, __FINALLY runs, and so does what follows __ENDTRY
    //   a divide by zero      the catch RUNS, its operand receives 258, the faulting statement did not complete,
    //                         and THE SCAN FINISHES — outside a __TRY the same division ends the application
    //   LN of a run-time 0    the same, with 338
    //   __FINALLY             runs either way
    //   nested                the INNER block catches; the outer never sees it
    //
    // `__CATCH`'s operand is an EXISTING variable of `__SYSTEM.ExceptionCode` that receives the code — pro2193
    // declares `ARRAY[0..50] OF __SYSTEM.ExceptionCode` for exactly this and wraps every top-level call in one.
    //
    // What it needs: an IR statement carrying the three blocks and the catch place, a `try` in the interpreter, and
    // a Rust form — the emitter's faults are `panic!`, so `catch_unwind` or a `Result`-shaped rewrite is the open
    // design question. Six corpus POUs are blocked by this, three of them by nothing else.
    //
    // AND IT IS BLOCKED ON THE FRONTEND FIRST, measured 2026-09-24: `__SYSTEM.ExceptionCode` — the type every
    // `__CATCH` operand is declared with — does not resolve, so `ec` is `type-unknown` before lowering reaches the
    // statement at all. The eight fixtures give its VALUES (258, 338) and that `ANY_TO_DWORD` takes it; they do not
    // give its base type or its enumerators. Inferring DWORD from two observed values is a guess of exactly the
    // kind `refused` exists to prevent, so the type has to be READ from a live CODESYS before any of this is built.
    default:
      return lw.bail(`stmt-${s.kind}`, `${s.kind} is not lowered yet`, s.span)
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
  // THE TEST MEETS THE PAIR IN THE COMMON TYPE, like every other comparison.
  //
  // This was `convert(to, to.type)` — a no-op — so the limit kept its own type and the counter kept its own,
  // and the emitted test compared them AS THEY WERE: `FOR i := 1 TO hi` with `i : INT` and `hi : DINT` printed
  // `self.i <= self.hi`, which is `i16 <= i32` and which rustc rejects with E0308. Zero diagnostics, on ordinary
  // ST that CODESYS compiles.
  //
  // `commonType` rather than `control.type`, and the difference is not cosmetic: narrowing the LIMIT into the
  // counter's type would wrap a limit the counter cannot hold (a DINT 100000 into an INT is -31072, and the loop
  // would run zero times instead of until the counter wraps). Promoting is what `commonType` already encodes for
  // binary operands, measured — the signed type at equal width, the wider rank otherwise.
  const compareIn = commonType(control.type, to.type)
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
