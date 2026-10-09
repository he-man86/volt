/**
 * THE BYTE IMAGE (model 3, design.md §3.3 step 4d) — what a DATA pointer points into: one little-endian buffer per
 * program, holding every variable whose address the program stores, laid out as CODESYS lays it out. A pointer's value
 * is a byte address in it (`IMAGE_BASE` up; 0 is NULL), and a load or a store through one reads or writes the bytes, so
 * a pointer stepped past an array reads the variable declared after it (`pointer_step_past_end`) and a POINTER TO BYTE
 * walks a struct's padding (`pointer_byte_walk_struct_padding`).
 *
 * Lowering allocates every REGION statically (`lower/pointers/image.ts`); the image only checks that an access stays
 * inside one — an access outside every region, or the order of two addresses in different regions, is our layout's
 * answer and never the vendor's, so both fault by name. The Rust runtime's `Mem` (`emit/rust/runtime/pointer.ts`) is
 * this file's twin, held to the same cases (`memory.cases.ts`).
 */
import type { Access, IrExpr, IrImage, IrLayout, Place } from "../ir/index.js"
import { indexOutOfBounds } from "../ir/faults.js"
import { elementaryRef, floatBits, isBit, peelArray, type Type } from "../../frontend/types/index.js"
import { IecFault, LoweringBug } from "./faults.js"
import type { Val } from "./value.js"

/** Where the image starts. NULL is 0 and every address is at least this, so a step below an array's first element
 *  (`tr_44_pointer_step_below_first_element`: `ADR(arr[0]) - SIZEOF(INT) = 0` is FALSE) never reaches NULL. */
export const IMAGE_BASE = 1n << 32n

/** THE ONE RULE for an elementary type's bytes (`storage/bytes.ts` asks it too): a BOOL one byte, an integer, REAL,
 *  duration or date its width — undefined for a BIT (packed with its neighbours) and a string (no image access). */
export function elementarySize(t: Type): number | undefined {
  if (t.kind !== "elementary" || isBit(t)) return undefined
  const { family, bits } = t.elem
  if (family === "bool") return 1
  return ["int", "bitstring", "real", "time", "date"].includes(family) && bits >= 8 ? bits / 8 : undefined
}

/** A type's bytes in the image: an elementary one's, an array's elements, a struct's measured size (`IrLayout.size`). */
export function imageSize(t: Type, layouts: ReadonlyMap<string, IrLayout>): number | undefined {
  const own = elementarySize(t)
  if (own !== undefined) return own
  const array = peelArray(t)
  if (array !== undefined) {
    const element = imageSize(array.element, layouts)
    return element === undefined ? undefined : element * array.length
  }
  return t.kind === "struct" ? layouts.get(t.name.toUpperCase())?.size : undefined
}

/** An elementary value stored at `at`, little-endian. */
function storeElementary(view: DataView, at: number, t: Type, v: Val): void {
  const size = elementarySize(t)!
  if (t.kind === "elementary" && t.elem.family === "bool") return view.setUint8(at, v === true ? 1 : 0)
  const float = floatBits(t)
  if (float === 32) return view.setFloat32(at, v as number, true)
  if (float === 64) return view.setFloat64(at, v as number, true)
  let bits = BigInt.asUintN(size * 8, v as bigint)
  for (let k = 0; k < size; k++, bits >>= 8n) view.setUint8(at + k, Number(bits & 0xffn))
}

/** An elementary value loaded from `at`, little-endian, as its type holds it. */
function loadElementary(view: DataView, at: number, t: Type): Val {
  const size = elementarySize(t)!
  if (t.kind === "elementary" && t.elem.family === "bool") return view.getUint8(at) !== 0
  const float = floatBits(t)
  if (float === 32) return view.getFloat32(at, true)
  if (float === 64) return view.getFloat64(at, true)
  let bits = 0n
  for (let k = size - 1; k >= 0; k--) bits = (bits << 8n) | BigInt(view.getUint8(at + k))
  return t.kind === "elementary" && t.elem.signed ? BigInt.asIntN(size * 8, bits) : bits
}

/** A value of `t` written at `at` — an elementary one, an array element by element, a struct field by field. */
export function storeValue(view: DataView, at: number, t: Type, v: Val, layouts: ReadonlyMap<string, IrLayout>): void {
  if (elementarySize(t) !== undefined) return storeElementary(view, at, t, v)
  const array = peelArray(t)
  if (array !== undefined) {
    const size = imageSize(array.element, layouts)!
    return (v as Val[]).forEach((e, k) => storeValue(view, at + k * size, array.element, e, layouts))
  }
  for (const f of structFields(t, layouts)) storeValue(view, at + f.image!, f.type, (v as Record<string, Val>)[f.name.toUpperCase()]!, layouts)
}

/** A value of `t` read from `at`. */
export function loadValue(view: DataView, at: number, t: Type, layouts: ReadonlyMap<string, IrLayout>): Val {
  if (elementarySize(t) !== undefined) return loadElementary(view, at, t)
  const array = peelArray(t)
  if (array !== undefined) {
    const size = imageSize(array.element, layouts)!
    return Array.from({ length: array.length }, (_, k) => loadValue(view, at + k * size, array.element, layouts))
  }
  return Object.fromEntries(structFields(t, layouts).map((f) => [f.name.toUpperCase(), loadValue(view, at + f.image!, f.type, layouts)]))
}

/** A struct's fields with their offsets — every one of them, or the struct is no image type (a lowering bug). */
function structFields(t: Type, layouts: ReadonlyMap<string, IrLayout>): IrLayout["fields"] {
  const layout = t.kind === "struct" ? layouts.get(t.name.toUpperCase()) : undefined
  if (layout?.size === undefined || layout.fields.some((f) => f.image === undefined)) throw new LoweringBug(`no image layout for ${JSON.stringify(t)}`)
  return layout.fields
}

/** An index step taken on an address: the bounds checked as an element place checks them, then `(i - lower) · size`. */
export function indexAddress(address: bigint, index: bigint, lower: bigint, length: number | undefined, size: number): bigint {
  const k = index - lower
  if (k < 0n || (length !== undefined && k >= BigInt(length))) throw new RangeError(indexOutOfBounds(Number(index)))
  return address + k * BigInt(size)
}

/** The image a program runs on: its bytes, and the region each byte belongs to (0 for none). */
export class Memory {
  readonly bytes: Uint8Array
  readonly view: DataView
  private readonly region: Uint32Array

  constructor(image: IrImage | undefined) {
    this.bytes = new Uint8Array(image?.size ?? 0)
    this.view = new DataView(this.bytes.buffer)
    this.region = new Uint32Array(image?.size ?? 0)
    for (const [at, run] of image?.bytes ?? []) this.bytes.set(run, at)
    image?.regions.forEach(([start, end], i) => this.region.fill(i + 1, start, end))
  }

  /** The offset of `size` bytes at `address` — inside one region, or the access faults by name. */
  offset(address: bigint, size: number): number {
    if (address === 0n) throw new IecFault("null-dereference")
    const at = address - IMAGE_BASE
    if (at < 0n || at + BigInt(size) > BigInt(this.bytes.length)) throw new IecFault("address-outside-image")
    const i = Number(at)
    const region = this.region[i]!
    if (region === 0 || this.region[i + size - 1] !== region) throw new IecFault("address-outside-image")
    return i
  }

  load(address: bigint, t: Type, layouts: ReadonlyMap<string, IrLayout>): Val {
    return loadValue(this.view, this.offset(address, sizeOrBug(t, layouts)), t, layouts)
  }

  store(address: bigint, t: Type, v: Val, layouts: ReadonlyMap<string, IrLayout>): void {
    storeValue(this.view, this.offset(address, sizeOrBug(t, layouts)), t, v, layouts)
  }

  /** Two addresses ORDERED (-1, 0, 1) — only inside one region, whose one-past-the-end address belongs to it (the end
   *  pointer of `WHILE p < pEnd`, review 4d): across two, the order is our layout's, not the vendor's. */
  order(a: bigint, b: bigint): bigint {
    const region = (x: bigint): number => {
      const at = x - IMAGE_BASE
      return at < 0n || at >= BigInt(this.bytes.length) ? 0 : this.region[Number(at)]!
    }
    // an address is in the region it falls in, and in the one whose last byte is just below it
    const regions = (x: bigint): number[] => [region(x), region(x - 1n)].filter((r) => r !== 0)
    const ofB = regions(b)
    if (!regions(a).some((r) => ofB.includes(r))) throw new IecFault("address-across-frames")
    return a < b ? -1n : a > b ? 1n : 0n
  }
}

function sizeOrBug(t: Type, layouts: ReadonlyMap<string, IrLayout>): number {
  const size = imageSize(t, layouts)
  if (size === undefined) throw new LoweringBug(`an image access of a type with no image size (${JSON.stringify(t)})`)
  return size
}

// ─── a place in the image ────────────────────────────────────────────────────────────────────────────────────

/** The type an image address is computed in — a pointer's, so it prints and runs as every other pointer value. */
export const ADDRESS: Type = { kind: "pointer", target: elementaryRef("BYTE") } as Type

/** `at + bytes`, folded when both are constants. */
export function offsetBy(at: IrExpr, bytes: number): IrExpr {
  if (bytes === 0) return at
  if (at.kind === "const" && typeof at.value === "bigint") return { ...at, value: at.value + BigInt(bytes) }
  return { kind: "binary", op: "add", left: at, right: { kind: "const", value: BigInt(bytes), type: ADDRESS, span: at.span }, type: ADDRESS, span: at.span }
}

/**
 * One more step on an `image` place, folded (design.md §3.3 step 4d): a struct field adds its offset to `at`, an array
 * index stays a step carrying its element's `size`, a bit stays the trailing step. `on` is the type the step is taken on.
 */
export function imageStep(place: Place, step: Access, on: Type, layouts: ReadonlyMap<string, IrLayout>): Place {
  if (step.kind === "field") {
    const field = on.kind === "struct" ? layouts.get(on.name.toUpperCase())?.fields.find((f) => f.name.toUpperCase() === step.name.toUpperCase()) : undefined
    if (field?.image === undefined) throw new LoweringBug(`no image offset for ${step.name}`)
    // a field after an index adds to `at` all the same: every step's bytes are a sum
    return { ...place, at: offsetBy(place.at!, field.image) }
  }
  if (step.kind === "index") {
    const element = peelArray(on)?.element
    const size = element === undefined ? undefined : imageSize(element, layouts)
    if (size === undefined) throw new LoweringBug("an index into the image of an array with no image size")
    return { ...place, path: [...place.path, { ...step, size }] }
  }
  return { ...place, path: [...place.path, step] }
}

/** Where a place's root lands in the image, if it does: an image slot's address, or nothing (its fields may). */
export interface ImageRoot {
  readonly type: Type
  readonly address?: number
}

/**
 * THE ONE REWRITE of a place into the image: a place whose root slot, or a field of an instance along its path, lives in
 * the image (`IrSlot.image`) becomes an `image` place — `at` the slot's address, or the instance's `__base` plus the
 * field's offset — and every step after that is folded (`imageStep`). Any other place comes back as it was. Lowering's
 * image pass, the interpreter's runner and the Rust harness's path reader all ask this, so a path reads the bytes the
 * program writes.
 */
export function toImage(place: Place, root: ImageRoot, layouts: ReadonlyMap<string, IrLayout>): Place {
  if (place.root === "image") return place
  let type: Type | undefined = root.type
  let image: Place | undefined =
    root.address === undefined ? undefined : { slot: 0, root: "image", at: { kind: "const", value: BigInt(root.address), type: ADDRESS, span: place.span }, path: [], type: place.type, span: place.span }
  for (const [i, step] of place.path.entries()) {
    if (type === undefined) throw new LoweringBug("a place whose type was lost along its path")
    if (image !== undefined) image = imageStep(image, step, type, layouts)
    else if (step.kind === "field" && type.kind === "function_block") {
      const field = layouts.get(type.name.toUpperCase())?.fields.find((f) => f.name.toUpperCase() === step.name.toUpperCase())
      if (field?.image !== undefined) {
        const base: Place = { ...place, path: [...place.path.slice(0, i), { kind: "field", name: BASE_FIELD }], type: ADDRESS, guard: undefined }
        if (place.guard === undefined) delete base.guard
        image = { slot: 0, root: "image", at: offsetBy({ kind: "load", place: base, type: ADDRESS, span: place.span }, field.image), path: [], type: place.type, span: place.span }
      }
    }
    type = stepType(type, step, layouts)
  }
  if (image === undefined) return place
  return { ...image, type: place.type, ...(place.guard === undefined ? {} : { guard: place.guard }) }
}

/** The hidden field an instance of an FB whose data lives in the image holds its region's address in. */
export const BASE_FIELD = "__base"

function stepType(t: Type, step: Access, layouts: ReadonlyMap<string, IrLayout>): Type | undefined {
  if (step.kind === "field")
    return t.kind === "struct" || t.kind === "function_block" ? layouts.get(t.name.toUpperCase())?.fields.find((f) => f.name.toUpperCase() === step.name.toUpperCase())?.type : undefined
  if (step.kind === "index") return peelArray(t)?.element
  return undefined
}
