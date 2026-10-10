/**
 * THE INITIALISATION SEQUENCE — a declaration whose initial value RUNS rather than folding.
 *
 * Measured on SP21 (`declarations/init-sequence.ts`, `declarations/constant-folding.ts`). A CODESYS initializer is
 * not a constant expression that happens to allow names; it is a statement that runs:
 *
 *   ONCE, before the first scan   `startedAt : INT := counter` is 0 after three scans that bump `counter` to 3
 *   after the globals            a function reading a global that starts at 41 returns 42
 *   in DECLARATION ORDER         `i : INT := ABS(other)` is 7 with `other` declared before it and 0 after
 *   any expression               `ADR(x)`, `THIS`, a struct member, a global, a call to a user FUNCTION
 *
 * `storage/declare.ts` queues the ones that do not fold (`InitFrame.pendingInits`); this turns them into statements. Order
 * is what makes the values right, so nothing here has a rule about it: they come out in the order they were
 * declared, and a slot whose own initializer has not run yet still holds its default.
 *
 * Built EARLY — while the layout is, before any body lowers — because a body may dereference a pointer this step
 * fills, and `pointer-order` only allows that once the store is known (`pointerTargets`).
 */

import type { Lowering } from "../core/lowering.js"
import type { IrExpr, IrStmt, Place } from "../../ir/index.js"
import { findPlace, initReadChildren } from "../../ir/walk.js"
import { insideInstance } from "../places/path.js"
import { lowerStmt } from "../statements/statements.js"
import { initFrame, type PendingInit } from "./state.js"
import { type Expr, selfRefKind } from "../../../frontend/syntax/index.js"
import { BUILTIN_OPERATOR_NAMES, type Type } from "../../../frontend/types/index.js"
import { adrOperand } from "../pointers/address.js"

/**
 * `lw.pendingInits`, lowered as the assignments they are — or undefined when one of them cannot be.
 *
 * Built through `lowerStmt` rather than as a bare expression, so everything an assignment knows applies: `ADR(x)`
 * into a pointer, `REF=`, a string's capacity. Lowering the value alone refused `p : POINTER TO INT := ADR(x)` as
 * `expr-call`, and that is the shape the corpus writes 180 times.
 */
export function buildInitSequence(lw: Lowering): IrStmt[] | undefined {
  const frame = initFrame(lw)
  if (frame.initSequence !== undefined) return frame.initSequence.statements
  frame.initSequence = { statements: undefined }
  const out: IrStmt[] = []
  const bySlot: { slot: number; statements: IrStmt[] }[] = []
  for (const pending of initFrame(lw).pendingInits) {
    const assigned = lowerPendingInit(lw, pending)
    if (assigned === undefined) return undefined
    const values = assigned.flatMap((a) => (a.kind === "assign" ? [a.value] : []))

    // A VAR_TEMP IS A LOCAL OF THE BODY'S RUN (7.6.4) and the init step runs before any run, so there is none to read:
    // what CODESYS answers for `x : INT := tempVar` is not recorded. Refused by name (0 in the fixtures and the corpora).
    const local = values.reduce<string | undefined>((f, v) => f ?? reads(v, (p) => (p.root === "local" ? (lw.localSlots[p.slot]?.name ?? "a VAR_TEMP") : undefined)), undefined)
    if (local !== undefined)
      return lw.bail("init-reads-later", `${pending.name.text}'s initial value reads the VAR_TEMP ${local}, which only a run of the body holds — the init step runs before any`, pending.span)

    // A LATER DECLARATION HAS NOT BEEN INITIALIZED YET, and neither has a CONSTANT one: the whole sequence runs in
    // order, so `i : INT := ABS(other); other : INT := -7;` is 0 on SP21 (`cfold_non_constant_argument`). The init step's
    // position rule makes that so for a scalar or an aggregate (`position.ts`: the later constant is a statement after
    // this one). A later INSTANCE's or struct's fields are folded per TYPE, so what this would see of them is not
    // recorded: refused — read by name or through THIS, or its address (or THIS, or itself by name) handed to a call
    // (design.md §3.4).
    const later =
      values.reduce<string | undefined>((f, v) => f ?? reads(v, laterInstance(lw, pending.slot)), undefined) ??
      lendsLaterInstance(lw, pending) ??
      handed(lw, pending)[0] ??
      derefsLaterInstance(lw, pending, values)
    if (later !== undefined)
      return lw.bail(
        "init-reads-later",
        `${pending.name.text}'s initial value reaches ${later}, an instance declared after it whose fields are not initialized yet`,
        pending.span,
      )

    // AN FB INSTANCE'S FIELD, whose own FB_Init runs at ITS declaration's position — `seen : INT := holder.started`
    // is 5 with `holder` declared first and 0 with it declared last (`initseq_after_fb_init`,
    // `initseq_fb_init_declared_last`). The init step interleaves these statements with the FB_Inits by declaration
    // (transpile-review 23), which answers that — except for an instance declared with a STRUCTURED initializer, applied
    // after its FB_Init (`fb_init_and_structured_initializer`), where what a sibling reads of it is not recorded (§3.4).
    const instance =
      values.reduce<string | undefined>((f, v) => f ?? reads(v, insideInstance(lw)), undefined) ??
      handedPlaces(lw, pending).reduce<string | undefined>((f, p) => f ?? insideInstance(lw)(p), undefined)
    if (instance !== undefined)
      return lw.bail(
        "init-reads-instance",
        `${pending.name.text}'s initial value reads ${instance}, an instance declared with a structured initializer applied after its FB_Init`,
        pending.span,
      )
    out.push(...assigned)
    bySlot.push({ slot: pending.slot, statements: assigned })
  }
  initFrame(lw).initSequence = { statements: out, bySlot }
  return out
}

/** One queued initializer, lowered as the assignment it is — also a per-run local's, on every run (`localInits`). */
export function lowerPendingInit(lw: Lowering, pending: PendingInit): IrStmt[] | undefined {
  const lowered = lowerStmt(lw, {
    kind: "assign",
    // an aggregate's dynamic element or field assigns its own place (`arr[1] :=`, `rec.c :=`), the rest the variable
    target: pending.target ?? { kind: "ident_expr", name: pending.name.text, span: pending.name.span },
    value: pending.expr,
    // `REF=` from the DECLARATION, carried through `pendingInits` — `bindReference` is what records the
    // reference`s target, and an assign with no `op` is a store through a reference nothing bound.
    ...(pending.op !== undefined ? { op: pending.op } : {}),
    span: pending.span,
  })
  return lowered === undefined ? undefined : Array.isArray(lowered) ? lowered : [lowered]
}

/**
 * The first place the expression READS for which `onPlace` gives a name — or undefined. Every expression that can
 * hold a read is walked: a call's inputs, its freezes, its in-out bindings, its lent places and the instance it runs on,
 * a select's tag and arms, and the index expressions inside a place (`arr[k]` reads `k` too). Each of those was a hole,
 * and each let a guard through. The walk is `ir/walk.ts`'s `initReadChildren` — `childrenOf` with no skip (task 5.9).
 *
 * `ADR(x)` is deliberately NOT a read of `x`: it takes an ADDRESS, which is the same whenever it is taken, and the
 * corpus writes it 180 times.
 */
export function reads(e: IrExpr, onPlace: (place: Place) => string | undefined): string | undefined {
  return findPlace(e, onPlace, initReadChildren)
}

/** The frame slot a place of this frame is in — its own, or the field `THIS^.f` names — or undefined for other storage. */
function frameSlotOf(lw: Lowering, place: Place): number | undefined {
  if (place.root === undefined) return place.slot
  const first = place.path[0]
  return place.root === "this" && first?.kind === "field" ? lw.byName.get(first.name.toUpperCase()) : undefined
}

/** Whether a slot of `type` holds a struct or an FB instance — whose fields are folded per type (`position.ts`). */
function holdsFolded(type: Type): boolean {
  return type.kind === "array" ? holdsFolded(type.element) : type.kind === "struct" || type.kind === "function_block"
}

/** A place in a STRUCT or INSTANCE slot of this frame at `slot` or later — what an initializer may not reach yet. */
const laterInstance =
  (lw: Lowering, slot: number) =>
  (place: Place): string | undefined => {
    const at = frameSlotOf(lw, place)
    const target = at === undefined ? undefined : lw.slots[at]
    return at !== undefined && at >= slot && target !== undefined && holdsFolded(target.type) ? target.name : undefined
  }

/** The struct or instance slot an initializer of the frame aims a pointer or reference at — `ADR(cfg)`, `ADR(cfg.n)`,
 *  `REF= cfg` — at `slot` or later, when the initializer `values` read through a dereference: what it reaches there is
 *  the later instance's type-folded fields (gate 5c: `p : POINTER TO T_P := ADR(cfg); i : INT := p^.n; cfg : T_P;`
 *  answered 4). Which pointer is read is not followed — any dereference while such an address is taken. */
function derefsLaterInstance(lw: Lowering, pending: PendingInit, values: readonly IrExpr[]): string | undefined {
  if (!values.some((v) => reads(v, (place) => (place.guard !== undefined ? "deref" : undefined)) !== undefined)) return undefined
  for (const other of initFrame(lw).pendingInits) {
    const operand = other.op === "REF=" ? other.expr : addressTaken(other.expr)
    const name = operand === undefined ? undefined : rootName(operand)
    const at = name === undefined ? undefined : lw.byName.get(name.toUpperCase())
    if (at !== undefined && at >= pending.slot && holdsFolded(lw.slots[at]!.type)) return `${lw.slots[at]!.name} (through a pointer)`
  }
  return undefined
}

/** The operand of the first `ADR(…)` anywhere in an initializer expression. */
function addressTaken(node: unknown): Expr | undefined {
  if (node === null || typeof node !== "object") return undefined
  if (Array.isArray(node)) return node.reduce<Expr | undefined>((f, n) => f ?? addressTaken(n), undefined)
  const e = node as Expr
  const operand = e.kind === "call" ? adrOperand(e) : undefined
  if (operand !== undefined) return operand
  return Object.entries(node).reduce<Expr | undefined>((f, [key, child]) => f ?? (key === "span" ? undefined : addressTaken(child)), undefined)
}

/** The variable a member, index or dereference chain starts at. */
function rootName(e: Expr): string | undefined {
  if (e.kind === "ident_expr") return e.name
  if (e.kind === "paren") return rootName(e.inner)
  return e.kind === "member" || e.kind === "index" || e.kind === "deref" ? rootName(e.base) : undefined
}

/**
 * The frame slots an initializer hands a call BY NAME (`F_Get(itf := inst)`). As an INTERFACE the instance lowers to a
 * tag, and its place is lent to the callee only after the guards ran (`interfaces/lend.ts`), so `reads` never meets it
 * (gate 5d: a later instance with a structured initializer answered its structured value). Judged here by name: a later
 * one as `init-reads-later`, one declared with a structured initializer as `init-reads-instance`.
 */
function handedSlots(lw: Lowering, pending: PendingInit): number[] {
  const out: number[] = []
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return
    if (Array.isArray(node)) return node.forEach(walk)
    const e = node as Expr
    // an operator (`ADR(x)`, `SIZEOF(x)`) takes no instance as an interface; `lendsLaterInstance` judges an address
    if (e.kind === "call" && !(e.callee.kind === "ident_expr" && BUILTIN_OPERATOR_NAMES.has(e.callee.name.toUpperCase())))
      for (const arg of e.args) {
        let value = arg.value
        while (value?.kind === "paren") value = value.inner
        const at = value?.kind === "ident_expr" ? lw.byName.get(value.name.toUpperCase()) : undefined
        if (at !== undefined) out.push(at)
      }
    for (const [key, child] of Object.entries(node)) if (key !== "span") walk(child)
  }
  walk(pending.expr)
  return out
}

/** `handedSlots`' later struct or instance slots, by name. */
function handed(lw: Lowering, pending: PendingInit): string[] {
  return handedSlots(lw, pending).flatMap((at) => (at >= pending.slot && holdsFolded(lw.slots[at]!.type) ? [lw.slots[at]!.name] : []))
}

/** `handedSlots` as the places they are, for `insideInstance`. */
function handedPlaces(lw: Lowering, pending: PendingInit): Place[] {
  return handedSlots(lw, pending).map((at) => ({ slot: at, path: [], type: lw.slots[at]!.type, span: pending.span }))
}

/** A later struct or instance slot whose ADDRESS the initializer hands to a call — `F(ADR(later))`, or `F(THIS)` while
 *  the frame holds one — where the callee may read it. */
function lendsLaterInstance(lw: Lowering, pending: PendingInit): string | undefined {
  const later = lw.slots.slice(pending.slot).find((s) => holdsFolded(s.type))
  if (later === undefined) return undefined
  let found: string | undefined
  const seen = new WeakSet<object>()
  const walk = (node: unknown, inCall: boolean): void => {
    if (found !== undefined || node === null || typeof node !== "object" || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) return node.forEach((n) => walk(n, inCall))
    const e = node as Expr
    // `THIS^.n` reads `n`, which `reads` judges; only a bare THIS lends the instance
    if (e.kind === "deref" && e.base.kind === "ident_expr" && selfRefKind(e.base.name) === "THIS") return
    if (inCall && e.kind === "ident_expr" && selfRefKind(e.name) === "THIS") found = `${later.name} (through THIS)`
    const operand = inCall && e.kind === "call" ? undefined : adrOperand(e)
    if (inCall && operand !== undefined) {
      const name = operand.kind === "ident_expr" ? operand.name.toUpperCase() : undefined
      const at = name === undefined ? undefined : lw.byName.get(name)
      if (at !== undefined && at >= pending.slot && holdsFolded(lw.slots[at]!.type)) found = lw.slots[at]!.name
    }
    for (const [key, child] of Object.entries(node)) if (key !== "span") walk(child, inCall || e.kind === "call")
  }
  walk(pending.expr, false)
  return found
}
