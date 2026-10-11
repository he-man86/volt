/**
 * THE BOOL BYTES the escape pass answers (transpile-restructure 8.2, gate 8c; `raw-bool.ts` is what lowering does with
 * them): which BOOLs are held as their byte, which POINTERs TO BOOL read a byte, and which pointers hold the address of a
 * BOOL no key names — closed over what one lowering saw (`escape.ts` `Seen`), to one fixed point.
 */
import { elemOf, isBit, type Type } from "../../../frontend/types/index.js"

/** A BOOL as declared — not a BIT, which is one bit of its neighbours' bytes. */
export const isPlainBool = (t: Type): boolean => elemOf(t)?.name === "BOOL" && !isBit(t)

/** Whether a pointer's (or a reference's) target is a plain BOOL. */
export const viewsBool = (t: Type): boolean => (t.kind === "pointer" || t.kind === "reference") && isPlainBool(t.target)

/** The key under which a BOOL flow names what the POINTER TO BOOL `pointerKey` reads (`raw-bool.ts` `carried`): raw
 *  exactly when that pointer is a byte view. */
export const viewKey = (pointerKey: string): string => `VIEW:${pointerKey}`

/** What one lowering saw that `boolBytes` reads (`escape.ts` `Seen` names each). */
interface BoolsSeen {
  readonly boolSeeds: ReadonlySet<string>
  readonly boolFlows: readonly (readonly [string, readonly string[]])[]
  readonly boolAddresses: readonly (readonly [string, string | null])[]
  readonly byteViews: ReadonlySet<string>
  readonly boolPointers: ReadonlyMap<string, boolean>
  readonly copies: readonly (readonly [string, string])[]
}

/** `boolBytes`'s answer, three of `escape.Escapes`' sets. */
interface BoolBytes {
  readonly rawBools: ReadonlySet<string>
  readonly byteViews: ReadonlySet<string>
  readonly unkeyedBools: ReadonlySet<string>
}

/**
 * THE BOOL BYTES (`raw-bool.ts`), to one fixed point. Which BOOL addresses each pointer holds (an address flows along a
 * copy, from → to); a BOOL whose address reaches a pointer of another target type is raw (`bool_pointer_copied_to_byte_pointer`
 * through a copy); a POINTER TO BOOL is a BYTE VIEW when it was given what is no plain BOOL's byte, holds a raw BOOL's
 * address, or is a copy of a pointer of another target type or of a byte view (`bool_pointer_over_bytes`,
 * `byte_pointer_copied_to_bool_pointer`) — and what it reads (`viewKey`) is raw; every BOOL a flow fills from a raw one is raw.
 */
export function boolBytes(seen: BoolsSeen): BoolBytes {
  const { boolSeeds: seeds, boolFlows: flows, boolAddresses: addresses, byteViews, boolPointers, copies } = seen
  const holds = new Map<string, Set<string | null>>()
  const hold = (pointer: string, bool: string | null): boolean => {
    const set = holds.get(pointer) ?? holds.set(pointer, new Set()).get(pointer)!
    if (set.has(bool)) return false
    set.add(bool)
    return true
  }
  for (const [pointer, bool] of addresses) hold(pointer, bool)
  for (let grew = true; grew; ) {
    grew = false
    for (const [to, from] of copies) for (const bool of [...(holds.get(from) ?? [])]) grew = hold(to, bool) || grew
  }
  const raw = new Set(seeds)
  for (const [pointer, bools] of holds) if (boolPointers.get(pointer) === false) for (const b of bools) if (b !== null) raw.add(b)
  const views = new Set<string>()
  const isView = (pointer: string): boolean =>
    byteViews.has(pointer) ||
    [...(holds.get(pointer) ?? [])].some((b) => b !== null && raw.has(b)) ||
    copies.some(([to, from]) => to === pointer && (boolPointers.get(from) === false || views.has(from)))
  for (let grew = true; grew; ) {
    grew = false
    for (const [pointer, bool] of boolPointers)
      if (bool && !views.has(pointer) && isView(pointer)) {
        views.add(pointer)
        raw.add(viewKey(pointer))
        grew = true
      }
    for (const [to, from] of flows)
      if (!raw.has(to) && from.some((f) => raw.has(f))) {
        raw.add(to)
        grew = true
      }
  }
  const unkeyed = [...holds].flatMap(([pointer, bools]) => (bools.has(null) ? [pointer] : []))
  return { rawBools: raw, byteViews: views, unkeyedBools: new Set(unkeyed) }
}
