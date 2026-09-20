/**
 * POINTER and REFERENCE (design §9 form 1): each variable's one target, the value naming it, and dereference.
 */
import type { Expr, Span, Statement } from "../../syntax/index.js"
import { elementaryRef, type Type } from "../../types/index.js"
import { type IrExpr, type IrStmt, peelArray, type Place } from "../ir/index.js"
import type { Lowering, PointerTarget } from "./lowering.js"
import { binaryOf, cast, convert } from "./convert.js"
import { storageOf } from "./storage.js"
import { lowerPlace, refuseOpenArray } from "./places.js"
import { byteSize } from "./bytes.js"
import { lowerExpr } from "./expressions.js"
import { refuseUnionWrite, unionOf } from "./unions.js"

/** Where a pointer or reference variable lives, as a key every body that reaches it agrees on — undefined for one this
 *  does not track (a field of another instance, an element, a VAR_IN_OUT). */
export function pointerKey(lw: Lowering, p: Place): string | undefined {
  // Every member of a union of pointers overlays the same value, so they are ONE pointer with one target: `u.p1_Byte`
  // stored and `u.p2_Int^` read back name the same thing (conformance `state_any_int_pointer_increment`).
  const union = unionOf(lw, p)
  if (union !== undefined) return p.path.length === union.union.path.length + 1 ? pointerKey(lw, union.union) : undefined
  const field = p.path[0]
  if (p.root === "this" && p.path.length === 1 && field?.kind === "field") return `${lw.frameContext}.${field.name.toUpperCase()}`
  if (p.path.length > 0 || p.guard !== undefined) return undefined
  if (p.root === undefined) return `${lw.frameContext}.${lw.slots[p.slot]!.name.toUpperCase()}`
  if (p.root === "local") return `${lw.routineContext}.${lw.localSlots[p.slot]!.name.toUpperCase()}`
  if (p.root === "global") return `GLOBAL.${lw.shared.globals.slots[p.slot]!.name.toUpperCase()}`
  return undefined
}

/** Record `target` as the pointer's one target — refused when another was recorded, or when the pointer outlives it. */
export function recordTarget(lw: Lowering, key: string, target: PointerTarget, span: Span): boolean {
  // An FB body's own field pointing into its VAR_IN_OUT (conformance `mem_adr_of_inout_member`) names the variable the
  // caller bound for THIS call — exact wherever the body stored it on this run. Read anywhere else (a method, the caller,
  // this body before the store) it would follow the next binding where CODESYS follows the stale address, which is
  // unmeasured: `pointeePlace` refuses those.
  const scoped = target.base.root === "inout" && lw.frameContext.startsWith("FB:") && !lw.routineMode && key.startsWith(`${lw.frameContext}.`)
  if (scoped) target = { ...target, scopedTo: lw }
  const outlives = !key.startsWith("ROUTINE:") && (target.base.root === "local" || (target.base.root === "inout" && !scoped))
  if (outlives || (key.startsWith("GLOBAL.") && target.base.root !== "global")) {
    lw.bail("pointer-outlives", "a pointer that outlives the variable it points at", span)
    return false
  }
  const known = lw.shared.pointers.get(key)
  if (known === undefined) {
    lw.shared.pointers.set(key, target)
    return true
  }
  if (sameTarget(known, target)) return true
  lw.bail("pointer-targets", "a pointer that points at more than one variable — the handle form is not built yet", span)
  return false
}

/** `ADR(x)` or the right side of `REF=` — the pointer's value (1, or element index + 1) and its target. */
export function addressOf(lw: Lowering, x: Expr, pointerType: Type, span: Span): { value: IrExpr; target: PointerTarget } | undefined {
  if (pointerType.kind !== "pointer" && pointerType.kind !== "reference") return lw.bail("pointer-shape", "an address stored into something that is not a pointer", span)
  const place = lowerPlace(lw, x)
  // TAKING AN ADDRESS IS A READ. The shared refusal's default message says "a write into a UNION member", which is
  // not what `ADR(u.member)` or `REF= u.member` does — and a message that describes the wrong operation sends the
  // reader looking for an assignment that is not there.
  if (place === undefined || refuseUnionWrite(lw, place, span, "the address of a UNION member, whose overlay a pointer would not follow"))
    return undefined
  if (place.guard !== undefined || place.path.some((s) => s.kind === "bit"))
    return lw.bail("pointer-shape", "the address of a dereference or a bit", span)
  const last = place.path.at(-1)
  // The target is kept as a place and replayed at every dereference, so an index in it would be read again then — after
  // `p := ADR(arr[i].x); i := 3`, `p^` followed i to arr[3] where the address was taken at arr[1] (transpiler review
  // 2026-09-15). Only the LAST index is captured, as the element the value holds; a runtime index before it is refused.
  const before = last?.kind === "index" ? place.path.slice(0, -1) : place.path
  if (before.some((s) => s.kind === "index" && s.index.kind !== "const"))
    return lw.bail("pointer-runtime-index", "the address of a place with a runtime index before its last step", span)
  // A POINTER TO BYTE over an INT acted on the whole INT: a dereference takes its target's type. Only an address of the
  // pointer's own target type is modelled — a byte walk over another type is the unmeasured byte view (design §9).
  const declared = storageOf(lw, pointerType.target)
  if (last?.kind !== "index") {
    if (!sameStorage(declared, place.type)) return lw.bail("pointer-type", "the address of a variable of another type than the pointer's", span)
    return { value: { kind: "const", value: 1n, type: pointerType, span }, target: { base: place } }
  }
  if (x.kind !== "index" || x.indices.length !== 1) return lw.bail("pointer-shape", "the address of an element of a multi-dimensional array", span)
  const base = lowerPlace(lw, x.base)
  const array = base === undefined ? undefined : peelArray(base.type)
  if (base === undefined) return undefined
  // an `ARRAY[*]` in-out's element: its lower bound is the call's, not a constant — unmodelled. It returned undefined with
  // no diagnostic, and the whole store vanished (review of batch 3b).
  if (array === undefined) return lw.bail("pointer-shape", "the address of an element of an ARRAY[*]", span)
  if (!sameStorage(declared, array.element)) return lw.bail("pointer-type", "the address of an element of another type than the pointer's", span)
  const lint = elementaryRef("LINT")
  const offset = binaryOf("sub", convert(last.index, lint), { kind: "const", value: array.lower - 1n, type: lint, span }, lint, span)
  return { value: cast(offset, pointerType), target: { base, element: { lower: array.lower, length: array.length, type: array.element } } }
}

/** A value stored into a pointer: `0`, `ADR(x)`, another pointer, or one stepped by whole elements (`p + SIZEOF(T)`). */
export function pointerValue(lw: Lowering, e: Expr, pointerType: Type): { value: IrExpr; target?: PointerTarget } | undefined {
  if (e.kind === "paren") return pointerValue(lw, e.inner, pointerType)
  if (e.kind === "literal" && e.value === 0n) return { value: { kind: "const", value: 0n, type: pointerType, span: e.span } }
  const adr = e.kind === "call" && e.callee.kind === "ident_expr" && e.callee.name.toUpperCase() === "ADR" && e.args.length === 1 ? e.args[0]!.value : undefined
  if (adr !== undefined) return addressOf(lw, adr, pointerType, e.span)
  // `anyArg.pValue` — the address of the variable the call passed. An ANY input is a hidden VAR_IN_OUT bound to it, per
  // call site (`calls.ts`), so the "address" is that parameter: one target, form 1, and the write lands in the caller's
  // own variable at its own width (conformance `state_any_int_pointer_increment`).
  if (e.kind === "member" && e.base.kind === "ident_expr" && lw.anyInputs.has(e.base.name.toUpperCase()) && e.member.name.toUpperCase() === "PVALUE") {
    const slot = lw.anyTargets.get(e.base.name.toUpperCase())
    if (slot === undefined) return lw.bail("any-input", `${e.base.name}.pValue, whose argument this call site does not name as a variable`, e.span)
    const base: Place = { slot, path: [], type: lw.inoutSlots[slot]!.type, span: e.span, root: "inout" }
    return { value: { kind: "const", value: 1n, type: pointerType, span: e.span }, target: { base } }
  }
  const stepped = e.kind === "binary" && (e.op === "+" || e.op === "-") ? e : undefined
  const operand = stepped?.left ?? e
  if (operand.kind !== "ident_expr" && operand.kind !== "member" && operand.kind !== "index")
    return lw.bail("pointer-value", "a pointer value this does not model", e.span)
  const source = lowerPlace(lw, operand)
  if (source === undefined) return undefined
  const key = source.type.kind === "pointer" ? pointerKey(lw, source) : undefined
  const target = key === undefined ? undefined : lw.shared.pointers.get(key)
  // the COPY path reaches it first: the corpus writes `start1 := adr_bit0_Of_Byte` and only then `start1^`, so a
  // guard on the dereference alone never sees the input (see `unsuppliedInput`)
  if (target === undefined)
    return unsuppliedInput(lw, source, e.span) ?? lw.bail("pointer-order", `${describePointer(lw, source)} copied before any address was stored into it`, e.span)
  const loaded: IrExpr = { kind: "load", place: source, type: source.type, span: operand.span }
  if (stepped === undefined) return { value: convert(loaded, pointerType), target }
  // measured: `p + SIZEOF(T)` is the next element (conformance `mem_pointer_index_struct_array`) — a step of whole elements
  const bytes = lowerExpr(lw, stepped.right)
  const size = target.element === undefined ? undefined : byteSize(lw, target.element.type)?.size
  if (bytes === undefined) return undefined
  // `size === 0n` is guarded SEPARATELY from `undefined`, and it is reachable: `byteSize` answers 0 for a
  // struct with no laid-out fields (`fieldBytes` starts at offset 0, align 1, so `alignUp(0n, 1n)` is 0) and for
  // an array of length 0 (`element.size * 0n`). `% 0n` and `/ 0n` both throw RangeError on BigInt, so
  // `p + 4` over an `ARRAY[0..2] OF <empty struct>` came out of lowering as "0 is an invalid divisor value" —
  // a throw where the contract promises a coded diagnostic.
  if (size === 0n)
    return lw.bail("pointer-step", "a pointer stepped over an element type that occupies no bytes", e.span)
  // WHAT THE STEP IS WAITING ON, named exactly — the two cases are different work and this said the same thing
  // about both. A pointer whose target is an ARRAY ELEMENT can be stepped, and a step that is not a whole
  // multiple of the element is the message below. A pointer to a SINGLE variable has no element to step: walking
  // it needs the byte-addressable view design.md §9 names as its edge, and saying "not whole elements of its
  // array" about it names an array that does not exist. Measured (pointer-model.md §3): 88 stepped uses in the
  // corpus, almost all of them two FBs walking a byte's bits (`adr_bit0_Of_Byte + 1 … + 7`) — every one of those
  // is this case, not the other, and reading the old message would send a reader to look for the array.
  if (target.element === undefined || size === undefined)
    return lw.bail(
      "pointer-step",
      "a pointer to a single variable stepped by bytes, which needs the byte-addressable view (design §9)",
      e.span,
    )
  if (bytes.kind !== "const" || typeof bytes.value !== "bigint" || bytes.value % size !== 0n)
    return lw.bail("pointer-step", "a pointer stepped by something other than whole elements of its array", e.span)
  const step: IrExpr = { kind: "const", value: bytes.value / size, type: pointerType, span: stepped.right.span }
  return { value: binaryOf(stepped.op === "+" ? "add" : "sub", loaded, step, pointerType, e.span), target }
}

/**
 * A pointer place as "<what it is> <name>" — the section is what decides which form of design §9 it needs, so a
 * refusal that omits it cannot be counted by shape. `--why pointer-order` returns one line per distinct message,
 * which is exactly the histogram this makes useful.
 */
function describePointer(lw: Lowering, pointer: Place): string {
  if (pointer.root !== undefined) return `a ${pointer.root} pointer`
  const slot = lw.frame[pointer.slot]
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
 * checked — `Bools_To_Byte` is declared once (`test_IW132` in `General.prg`) and never called — and it was NOT
 * checked for the other five. What is true of all seven is the harness fact: lowered as the ROOT, this input has
 * no caller. A message states what it knows.
 */
function unsuppliedInput(lw: Lowering, pointer: Place, span: Span): undefined {
  // `lw.isRoot` is NOT the test, and using it found nothing. It is set on the harness lowering `lowerUnit`
  // makes, and for a FUNCTION_BLOCK that lowering only holds a frame that CALLS the FB — the body runs in the
  // nested lowering `calledLayout` builds, where `isRoot` is false. What identifies that body is that it
  // belongs to the POU the harness asked for, which `Shared.root` names.
  //
  // ROUTINEMODE IS EXCLUDED and the exclusion is load-bearing: a METHOD of the root FB also has VAR_INPUTs,
  // and those ARE supplied — by whoever calls the method. Only the POU's own entry body has inputs nobody fills.
  if (pointer.root !== undefined || lw.routineMode) return undefined
  if (lw.shared.root === "" || lw.displayName !== lw.shared.root) return undefined
  const slot = lw.frame[pointer.slot]
  if (slot?.section !== "VAR_INPUT") return undefined
  return lw.bail(
    "pointer-root-input",
    `${slot.name} is a pointer INPUT of the POU being lowered, which has no caller to supply it — there is no address to follow`,
    span,
  )
}
/** The place a pointer or reference points at, through `extra` more elements — its one target, guarded by it. */
export function pointeePlace(lw: Lowering, pointer: Place, extra: IrExpr | undefined, span: Span): Place | undefined {
  const key = pointerKey(lw, pointer)
  const target = key === undefined ? undefined : lw.shared.pointers.get(key)
  // THE MESSAGE NAMES THE POINTER AND WHERE IT LIVES. It named neither, which made the 177 POUs it blocks one
  // undifferentiated pile — and the sections are the whole question: a VAR_INPUT is design §9 form 2 (bind it to
  // the caller's place), a field or a local with several stores is form 3 (the tagged handle), and they are
  // different work. `--why pointer-order` could not tell them apart.
  if (target === undefined) return unsuppliedInput(lw, pointer, span) ?? lw.bail("pointer-order", `${describePointer(lw, pointer)} dereferenced before any address was stored into it`, span)
  if (target.scopedTo !== undefined && (target.scopedTo !== lw || !lw.boundPointers.has(key!)))
    return lw.bail("pointer-outlives", "a pointer into a VAR_IN_OUT dereferenced outside the run of the body that stored it", span)
  if (target.element === undefined) {
    if (extra !== undefined) return lw.bail("pointer-index", "an index on a pointer to a single variable", span)
    return { ...target.base, guard: pointer, span }
  }
  const lint = elementaryRef("LINT")
  // the element the value names, back in the array's own index range: value - 1 + lower (+ extra)
  let index = binaryOf("add", cast({ kind: "load", place: pointer, type: pointer.type, span }, lint), { kind: "const", value: target.element.lower - 1n, type: lint, span }, lint, span)
  if (extra !== undefined) index = binaryOf("add", index, convert(extra, lint), lint, span)
  const step = { kind: "index" as const, index, lower: target.element.lower, length: target.element.length }
  return { ...target.base, path: [...target.base.path, step], type: target.element.type, guard: pointer, span }
}

/** `p := <pointer value>` — its target recorded for every body that dereferences `p`. */
export function storePointer(lw: Lowering, target: Place, value: Expr, span: Span): IrStmt | undefined {
  const key = pointerKey(lw, target)
  if (key === undefined) return lw.bail("pointer-place", "a pointer stored somewhere this does not track", span)
  const stored = pointerValue(lw, value, target.type)
  if (stored === undefined) return undefined
  if (stored.target !== undefined && !recordTarget(lw, key, stored.target, span)) return undefined
  if (lw.conditional === 0) lw.boundPointers.add(key)
  return { kind: "assign", target, value: stored.value, span }
}

/** `r REF= x` — the reference's one target, and its value set (conformance `type_reference_to_int`, `op_sys_isvalidref`). */
export function bindReference(lw: Lowering, s: Extract<Statement, { kind: "assign" }>): IrStmt | undefined {
  const target = lowerPlace(lw, s.target)
  if (target === undefined) return undefined
  const key = target.type.kind === "reference" ? pointerKey(lw, target) : undefined
  if (key === undefined) return lw.bail("assign-op", "REF= into something that is not a tracked reference", s.span)
  const address = addressOf(lw, s.value, target.type, s.span)
  if (address === undefined || !recordTarget(lw, key, address.target, s.span)) return undefined
  if (lw.conditional === 0) lw.boundPointers.add(key)
  return { kind: "assign", target, value: address.value, span: s.span }
}

/**
 * A place WRITTEN through: a REFERENCE writes its target, as a read reads it; anything else is itself. Only a plain `:=`
 * went through a reference — an FB output (`inst(q => r)`), a VAR_IN_OUT binding, `S=`/`R=` and a chain link wrote the
 * reference's own slot, overwriting its stored index instead of the variable (transpiler review 2026-09-15).
 */
export function through(lw: Lowering, place: Place, span: Span): Place | undefined {
  // an interface's instances are recorded only by a plain `:=` (`storeInterface`)
  if (place.type.kind === "interface") return lw.bail("interface-store", "an interface stored by anything but a plain `:=`", span)
  const written = place.type.kind === "reference" ? pointeePlace(lw, place, undefined, span) : place
  return written === undefined || refuseUnionWrite(lw, written, span) || refuseConstantWrite(lw, written, span) ? undefined : written
}

/**
 * A store into a VAR_IN_OUT CONSTANT — "'value' is no valid assignment target" (conformance `inout_const_write_5`, a `:=`):
 * refused however it is written — a store, a latch, a chain link, an output, a FOR variable, an input stored into a lent
 * instance, a store through a pointer or reference to it (its address may be taken, `inout_const_adr_11`, and read).
 * Only the `:=` is recorded; the rest are refused as the stores they are, not claimed as the compiler's.
 */
export function refuseConstantWrite(lw: Lowering, place: Place, span: Span): boolean {
  const slot = place.root === "inout" ? lw.inoutSlots[place.slot] : undefined
  if (slot?.constant !== true) return false
  lw.bail("inout-constant-write", `'${slot.name}' is a VAR_IN_OUT CONSTANT — no valid assignment target`, span)
  return true
}

/** A place read as a value: a REFERENCE reads its target; a POINTER's own value is refused — it is not a real address
 *  here, and only another pointer, a comparison with 0 and __ISVALIDREF (which lower it themselves) may use it. */
export function loadValue(lw: Lowering, place: Place, span: Span): IrExpr | undefined {
  if (refuseOpenArray(lw, place, span)) return undefined
  if (place.type.kind === "reference") {
    const target = pointeePlace(lw, place, undefined, span)
    return target && { kind: "load", place: target, type: target.type, span }
  }
  if (place.type.kind === "pointer") return lw.bail("pointer-value", "a pointer's value used as a number", span)
  if (place.type.kind === "interface")
    return lw.bail("interface-value", "an interface used other than to call through it, store it, or compare it with 0", span)
  return { kind: "load", place, type: place.type, span }
}

/** Two stored types that are the same: one elementary type (and capacity), one struct or FB, or arrays of the same bounds
 *  over the same element. */
export function sameStorage(a: Type, b: Type): boolean {
  if (a.kind === "elementary" && b.kind === "elementary") return a.elem.name === b.elem.name && a.length === b.length
  if ((a.kind === "struct" || a.kind === "function_block") && a.kind === b.kind) return a.name.toUpperCase() === b.name.toUpperCase()
  const [x, y] = [peelArray(a), peelArray(b)]
  return x !== undefined && y !== undefined && x.lower === y.lower && x.length === y.length && sameStorage(x.element, y.element)
}

/** Two pointer targets naming the same variable (or the same array) — through fields and constant indices only. */
export function sameTarget(a: PointerTarget, b: PointerTarget): boolean {
  if (a.base.slot !== b.base.slot || a.base.root !== b.base.root || (a.element === undefined) !== (b.element === undefined)) return false
  if (a.base.path.length !== b.base.path.length) return false
  return a.base.path.every((step, i) => {
    const other = b.base.path[i]!
    if (step.kind === "field") return other.kind === "field" && other.name.toUpperCase() === step.name.toUpperCase()
    if (step.kind === "index")
      return other.kind === "index" && step.index.kind === "const" && other.index.kind === "const" && step.index.value === other.index.value
    return false
  })
}
