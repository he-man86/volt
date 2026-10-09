/**
 * Through a pointer or reference: the place a dereference reaches.
 */

import type { Lowering } from "../core/lowering.js"
import type { IrExpr, IrSelect, IrStmt, Place } from "../../ir/index.js"
import { isSelfRef, type Span, type Statement } from "../../../frontend/syntax/index.js"
import { borrowedInOut } from "./borrowed.js"
import { ELEMENT_TAG_BIAS, pointerFrame, pointerKey, pointerTargets, refuseAfterStore } from "./state.js"
import { storageOf } from "../storage/layout.js"
import { sameStorage } from "../places/path.js"
import { elementaryRef, type Type } from "../../../frontend/types/index.js"
import { binaryOf, cast } from "../core/build.js"
import { assignTo, convert } from "../values/convert.js"
import { lowerPlace } from "../places/places.js"
import { lowerExpr } from "../expressions/expressions.js"
import { tagOfIndex } from "../core/tags.js"
import { holdsAddresses } from "./escape.js"
import { byteSize } from "../storage/bytes.js"

/**
 * A REFERENCE IS IMPLICITLY DEREFERENCED — `r.x` MEANS `r^.x`, and `r[1]` means `r^[1]`.
 *
 * That is the whole difference between `REFERENCE TO` and `POINTER TO` in IEC: a pointer needs a written `^`, a
 * reference never does. `lowerPlace` applied its field and index steps to the reference variable itself, which is
 * neither a struct nor an array — so `r.x` reported "member access is not lowered yet" and `r[1]` reported "an index on
 * something that is not a sized array". Both read as unbuilt machinery; in fact `pointeePlace` already resolves exactly
 * this (a REFERENCE records its target through `storePointer`, same as a pointer), and a scalar `a := r` already
 * worked. Only the step was missing.
 */
export function throughReference(lw: Lowering, place: Place | undefined, span: Span): Place | undefined {
  if (place === undefined || place.type.kind !== "reference") return place
  return pointeePlace(lw, place, undefined, span)
}

/** The place a pointer or reference points at, through `extra` more elements — its one target, guarded by it. */
export function pointeePlace(lw: Lowering, pointer: Place, extra: IrExpr | undefined, span: Span): Place | undefined {
  // FORM 2 FIRST: a `POINTER TO T` parameter this body only dereferences was declared as a hidden VAR_IN_OUT, and
  // `p^` IS that binding — there is no address to follow because the caller supplied a place, not a value. No guard
  // either: an in-out is bound by the call, so it cannot be null the way a stored address can.
  const borrowed = borrowedInOut(lw, pointer)
  if (borrowed !== undefined) {
    if (extra !== undefined) return lw.bail("pointer-index", "an index on a borrowed pointer parameter", span)
    return { ...borrowed, span }
  }
  // A POINTER THAT HOLDS ADDRESSES (design.md §3.3 step 4d): `p^` is the image at its value, `p[i]` i elements on — no
  // target to know, so no store has to come first, and an FB's pointer input a caller fills is read where it points
  if (holdsAddresses(lw, pointer)) return unsuppliedRoot(lw, pointer, span) ? undefined : imageDeref(lw, pointer, extra, span)
  const key = pointerKey(lw, pointer)
  const targets = key === undefined ? undefined : pointerTargets(lw).get(key)
  // ONE TARGET IS FORM 1 AND ERASES: the deref is that place, no tag is ever built, and that is the common case.
  // Several is form 3, and a PLACE cannot express it — the READ path builds an `IrSelect` before reaching here
  // (`selectThrough`), so anything still arriving with several targets is a use that has no select form yet: a
  // write, a call receiver, an `ADR` of the deref, an in-out bound to it.
  if (targets !== undefined && targets.length > 1)
    return lw.bail("pointer-targets", `${describePointer(lw, pointer)} names ${targets.length} variables, and this use of it selects no arm — only a READ does so far`, span)
  const target = targets?.[0]
  // THE MESSAGE NAMES THE POINTER AND WHERE IT LIVES. It named neither, which made the 177 POUs it blocks one
  // undifferentiated pile — and the sections are the whole question: a VAR_INPUT is design §9 form 2 (bind it to
  // the caller's place), a field or a local with several stores is form 3 (the tagged handle), and they are
  // different work. `--why pointer-order` could not tell them apart.
  if (target === undefined) {
    if (refuseAfterStore(lw, key, describePointer(lw, pointer), "dereferenced", span)) return undefined
    return unsuppliedInput(lw, pointer, span) ?? lw.bail("pointer-order", `${describePointer(lw, pointer)} dereferenced before any address was stored into it`, span)
  }
  if (target.scopedTo !== undefined && (target.scopedTo !== lw || !pointerFrame(lw).boundPointers.has(key!)))
    return lw.bail("pointer-outlives", "a pointer into a VAR_IN_OUT dereferenced outside the run of the body that stored it", span)
  if (target.element === undefined) {
    if (extra !== undefined) return lw.bail("pointer-index", "an index on a pointer to a single variable", span)
    // THE DEREFERENCE TAKES THE POINTER'S DECLARED TYPE. `ADR(x)` checks it where the address is taken, but an ANY input's
    // `pValue` (or a union member overlaying another pointer) reaches here at the ARGUMENT's type: a DINT read through a
    // POINTER TO REAL was converted as a number, where CODESYS reinterprets the bytes (`tr_17_any_pvalue_*`: 1065353216
    // is 1.0). That byte view is not modelled (transpile-review 17).
    const declared = pointer.type.kind === "pointer" || pointer.type.kind === "reference" ? storageOf(lw, pointer.type.target, span) : undefined
    if (declared !== undefined && !sameStorage(declared, target.base.type))
      return lw.bail("pointer-type", `${describePointer(lw, pointer)} dereferenced as another type than the variable it names`, span)
    return { ...target.base, guard: pointer, span }
  }
  const lint = elementaryRef("LINT")
  // the element the value names, back in the array's own index range: value - ELEMENT_TAG_BIAS + lower (+ extra)
  let index = binaryOf("add", cast({ kind: "load", place: pointer, type: pointer.type, span }, lint), { kind: "const", value: target.element.lower - ELEMENT_TAG_BIAS, type: lint, span }, lint, span)
  if (extra !== undefined) index = binaryOf("add", index, convert(extra, lint), lint, span)
  const step = { kind: "index" as const, index, lower: target.element.lower, length: target.element.length }
  return { ...target.base, path: [...target.base.path, step], type: target.element.type, guard: pointer, span }
}

/** `p^` (`p[extra]`) of a pointer that holds addresses: the image at its value, as the pointer's target type — guarded by
 *  the pointer, so NULL faults as a null dereference before the image is asked. */
function imageDeref(lw: Lowering, pointer: Place, extra: IrExpr | undefined, span: Span): Place {
  const type = storageOf(lw, (pointer.type as Extract<Type, { kind: "pointer" | "reference" }>).target, span)
  let at: IrExpr = { kind: "load", place: pointer, type: pointer.type, span }
  if (extra !== undefined) {
    const lint = elementaryRef("LINT")
    const size = byteSize(lw, type)!.size
    at = binaryOf("add", at, cast(binaryOf("mul", convert(extra, lint), { kind: "const", value: size, type: lint, span }, lint, span), pointer.type), pointer.type, span)
  }
  return { slot: 0, root: "image", at, path: [], type, span, guard: pointer }
}

/** THE POU'S OWN POINTER INPUT, which no caller fills (`unsuppliedInput`'s root case) — refused, true when refused. An FB's
 *  input a caller fills is no such thing for a pointer that holds addresses: it is read where it points. */
export function unsuppliedRoot(lw: Lowering, pointer: Place, span: Span): boolean {
  if (pointer.root !== undefined || lw.routineMode || lw.slots[pointer.slot]?.section !== "VAR_INPUT") return false
  if (lw.shared.root === "" || lw.displayName !== lw.shared.root) return false
  return unsuppliedInput(lw, pointer, span) === undefined
}

/**
 * A READ through a pointer or reference that names SEVERAL variables (form 3) — the select, or undefined when the
 * pointer has one target and form 1's erasure applies.
 *
 * The arms are every target recorded for the key, at the tag `storePointer` writes. `null` is no arm at all, so a
 * deref before any store faults exactly as `iec_deref` makes it fault for the single-target form.
 */
function pointerArms(lw: Lowering, pointer: Place, span: Span): { tag: bigint; place: Place }[] | undefined {
  const key = pointerKey(lw, pointer)
  const targets = key === undefined ? undefined : pointerTargets(lw).get(key)
  if (targets === undefined || targets.length < 2) return undefined
  // A target inside a VAR_IN_OUT is exact only while the body that bound it runs (`recordTarget`), and an arm is
  // selected wherever the tag is read — so the two do not combine yet.
  if (targets.some((t) => t.scopedTo !== undefined || t.element !== undefined || t.chars !== undefined)) {
    lw.bail("pointer-targets", "a pointer naming several variables, one of them an array element or inside a bound VAR_IN_OUT", span)
    return undefined
  }
  return targets.map((t, i) => ({ tag: BigInt(tagOfIndex(i)), place: t.base }))
}

export function selectThrough(lw: Lowering, pointer: Place, span: Span): IrExpr | undefined {
  const arms = pointerArms(lw, pointer, span)
  return arms && nullDeref(pointer, arms, arms[0]!.place.type, span)
}

/** The select itself — with no arm for a tag of 0, which is what makes a null dereference fault in both backends. */
function nullDeref(pointer: Place, arms: readonly { tag: bigint; place: Place }[], type: Type, span: Span): IrSelect {
  return { kind: "select", tag: { kind: "load", place: pointer, type: pointer.type, span }, arms, type, span }
}

/**
 * A pointer place as "<what it is> <name>" — the section is what decides which form of design §9 it needs, so a
 * refusal that omits it cannot be counted by shape. `--why pointer-order` returns one line per distinct message,
 * which is exactly the histogram this makes useful.
 */
export function describePointer(lw: Lowering, pointer: Place): string {
  if (pointer.root !== undefined) return `a ${pointer.root} pointer`
  const slot = lw.slots[pointer.slot]
  if (slot === undefined) return "a pointer"
  const where =
    slot.section === "VAR_INPUT"
      ? "the pointer input"
      : slot.section === "VAR_IN_OUT"
        ? "the pointer in-out"
        : slot.section === "VAR_OUTPUT"
          ? "the pointer output"
          : pointer.path.length > 0
            ? "the pointer field"
            : "the pointer variable"
  const name = pointer.path.reduce((n, a) => (a.kind === "field" ? `${n}.${a.name}` : n), slot.name)
  return `${where} ${name}`
}

/**
 * A POINTER INPUT NOBODY SUPPLIED, because this POU is the ROOT — the same shape as `fb-init-argument`, and the
 * same answer.
 *
 * A `POINTER TO T` in VAR_INPUT gets its value from the caller. The root has no caller: the harness asked for THIS
 * POU, so the input is whatever its declaration says, which for a pointer is nothing. Dereferencing it is not a
 * construct lowering fails to model — there is no address to model — so reporting `pointer-order` filed it under a
 * real blocker and inflated that blocker's count.
 *
 * Measured 2026-09-20 over the corpus: SEVEN POUs, not the two pointer-model.md §6 predicted — the two it names
 * (`Bools_To_Byte`, `Byte_To_Bools`) plus five more of the same shape. It also took `pointer-order` from 5 sole
 * to 3, which is what §6 wanted the work list to say: building the tagged handle unlocks three POUs, not five.
 *
 * THE MESSAGE DOES NOT SAY "the vendor does not run this either", though §6 does. That is true of the two §6
 * checked — `Bools_To_Byte` is declared once (`test_IW132` in `General.pou`) and never called — and it was NOT
 * checked for the other five. What is true of all seven is the harness fact: lowered as the ROOT, this input has
 * no caller. A message states what it knows.
 */
export function unsuppliedInput(lw: Lowering, pointer: Place, span: Span): undefined {
  // `lw.isRoot` is NOT the test, and using it found nothing. It is set on the harness lowering `lowerUnit`
  // makes, and for a FUNCTION_BLOCK that lowering only holds a frame that CALLS the FB — the body runs in the
  // nested lowering `calledLayout` builds, where `isRoot` is false. What identifies that body is that it
  // belongs to the POU the harness asked for, which `Shared.root` names.
  //
  // ROUTINEMODE IS EXCLUDED and the exclusion is load-bearing: a METHOD of the root FB also has VAR_INPUTs,
  // and those ARE supplied — by whoever calls the method. Only the POU's own entry body has inputs nobody fills.
  if (pointer.root !== undefined || lw.routineMode) return undefined
  const slot = lw.slots[pointer.slot]
  if (slot?.section !== "VAR_INPUT") return undefined
  // AN FB'S POINTER INPUT THAT A CALLER DOES FILL — form 3's foreign half, and a different fact from the root's.
  // The old message said "dereferenced before any address was stored into it", which is FALSE here: the caller
  // writes one, into this instance's field. What is missing is that the callee cannot REACH what it names. This
  // body is lowered once per FB TYPE, so a target in the caller's frame has to be LENT per call, the way
  // `interfaces/lend.ts` lends an instance, and the tag then picks which — `pointer-model.md` §5's "form 3 is the
  // interface mechanism with a place where the call is", whose lending half is not built.
  //
  // It cannot collapse into form 2's borrow either: `ptrparam_input_persists` measures the field KEEPING the
  // address across a call that omits the argument, so the address outlives the call by construction.
  if (lw.shared.root === "" || lw.displayName !== lw.shared.root)
    return lw.bail(
      "pointer-foreign",
      `${slot.name} is a pointer INPUT of ${lw.displayName}: an address a caller stores into it names a variable in the CALLER's frame, and reaching one needs it lent per call (form 3's foreign half)`,
      span,
    )
  return lw.bail(
    "pointer-root-input",
    `${slot.name} is a pointer INPUT of the POU being lowered, which has no caller to supply it — there is no address to follow`,
    span,
  )
}

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
export function storeThrough(lw: Lowering, s: Extract<Statement, { kind: "assign" }>): IrStmt | undefined | null {
  const t = s.target
  if (t.kind !== "deref" || isSelfRef(t)) return null
  const pointer = lowerPlace(lw, t.base)
  if (pointer === undefined || (pointer.type.kind !== "pointer" && pointer.type.kind !== "reference")) return null
  const arms = pointerArms(lw, pointer, s.span)
  if (arms === undefined) return null
  const written = arms[0]!.place.type
  // `p^ S= c` / `p^ R= c` LATCHES the arm's target — the whole right-hand side is the condition, as for a plain place
  // below. Storing the value instead wrote the condition through: `p^ R= TRUE` with p on a TRUE BOOL left it TRUE
  // (transpile-review 14, `tr_14_set_reset_through_multi_target_pointer`).
  const latch = s.op === "S=" || s.op === "R="
  const value = lowerExpr(lw, s.value, latch ? elementaryRef("BOOL") : written)
  if (value === undefined) return undefined
  const store = (place: (typeof arms)[number]["place"]): IrStmt =>
    latch
      ? {
          kind: "if",
          cond: value,
          then: [assignTo(place, { kind: "const", value: s.op === "S=", type: elementaryRef("BOOL"), span: s.span }, s.span)],
          else: [],
          span: s.span,
        }
      : assignTo(place, value, s.span)
  // THE ELSE ARM FAULTS. A tag no arm names is a null dereference, and a select with NO arms is exactly that in
  // both backends — read into a temp, so the fault happens where the store would have.
  return {
    kind: "switch",
    selector: { kind: "load", place: pointer, type: pointer.type, span: s.span },
    arms: arms.map((a) => ({
      labels: [{ lo: a.tag, hi: a.tag }],
      body: [store(a.place)],
      span: s.span,
    })),
    else: [{ kind: "eval", value: nullDeref(pointer, [], written, s.span), span: s.span }],
    span: s.span,
  }
}
