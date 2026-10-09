/**
 * THE IMAGE PASS (model 3, design.md §3.3 step 4d) — once the POU has lowered: every variable the escape pass found an
 * address of stored (`escape.ts`) is laid out in the program's byte image as CODESYS lays it out, every region allocated
 * statically, and every place that reaches one rewritten to an `image` place (`image-rewrite.ts`).
 *
 * - An FB TYPE whose data escaped stores each field of an image type at its measured offset (`storage/bytes.fieldBytes`:
 *   the header, one pointer per interface, then the fields in declaration order — 4.3) and holds its region's address
 *   in a hidden `__base` field; every instance the program holds statically — in the POU's frame, a GVL, a PROGRAM, an
 *   instance field, an array of them — gets its own region, its `__base` set by its initial value. Its other fields (a
 *   pointer, a STRING, an instance) stay in its struct, and a run of image fields ends at one: a walk across it faults.
 * - A variable of the POU's frame or a GVL is a region of its own: where a program places its variables is not
 *   measured (4.1).
 * Regions are 16 bytes apart, so a step off one lands on no variable and faults by name rather than reading the next.
 */
import type { IrImage, IrInit, IrLayout, IrSlot } from "../../ir/index.js"
import { ADDRESS, BASE_FIELD, IMAGE_BASE, instantiate, storeValue } from "../../semantics/index.js"
import type { Lowering } from "../core/lowering.js"
import { alignUp, byteSize, fieldBytes } from "../storage/bytes.js"
import { elementaryRef, peelArray, resolveNamedType, type Type } from "../../../frontend/types/index.js"
import { scopeUri } from "../../../frontend/symbols/index.js"
import { escapesOf, imageType } from "./escape.js"
import { baseOf } from "../core/chain.js"
import type { Span } from "../../../frontend/syntax/index.js"

/** The bytes between two regions, so no step of a few elements off one reaches another. */
const GAP = 16

/** The sections an instance stores a field in (`escape.ts`). */
const INSTANCE_FIELD: ReadonlySet<string> = new Set(["VAR", "VAR_INPUT", "VAR_OUTPUT"])

/**
 * The RUNS of an escaped FB type's image fields — `[start, end)` from the instance's start — and each image field's
 * offset. Measured (`storage/bytes.fieldBytes`: the header, an interface pointer each, the fields in declaration order —
 * 4.3) a run is the image fields laid side by side, which a walk crosses as CODESYS does. Where the layout is NOT
 * measured — a PROGRAM (where it places its variables, 4.1), a derived FB (where its base's part sits), an FB with a
 * VAR_IN_OUT or a METHOD's VAR_INST — every image field is a run of its own, 16 bytes apart: a dereference and an
 * equality need no offset (design.md §3.3 step 4d), and a walk, a difference or an order across two runs faults by
 * name instead of answering our layout. Shared with the whole-instance copy (`statements/assign.ts`), which moves
 * exactly these bytes.
 */
export function imageRuns(lw: Lowering, name: string): Runs | undefined {
  const layout = lw.layouts.get(name.toUpperCase())
  if (layout === undefined) return undefined
  const type = resolveNamedType(layout.name, lw.project, scopeUri(lw.scope))
  const unmeasured = new Set<string>()
  const unit = lw.bodies.get(name.toUpperCase())?.unit
  const bytes = type.kind === "function_block" && unit?.kind !== "program" ? fieldBytes(lw, type, unmeasured) : undefined
  // A DERIVED FB keeps its base's fields where the base has them — the base's body runs on it — and its own after
  const base = unit === undefined ? undefined : baseOf(unit)?.text
  const inherited = base === undefined ? undefined : imageRuns(lw, base)
  if (base !== undefined && inherited === undefined) return undefined
  const runs: [number, number][] = [...(inherited?.runs ?? []).map(([s, e]): [number, number] => [s, e])]
  const offsets = new Map<string, number>(inherited?.offsets ?? [])
  const baseFields = new Set((base === undefined ? [] : (lw.layouts.get(base.toUpperCase())?.fields ?? [])).map((f) => f.name.toUpperCase()))
  let open = false
  let alone = inherited?.size ?? 0
  for (const f of layout.fields.filter((x) => !baseFields.has(x.name.toUpperCase()))) {
    if (unmeasured.has(f.name.toUpperCase())) open = false
    const size = INSTANCE_FIELD.has(f.section) && imageType(lw, f.type) ? byteSize(lw, f.type) : undefined
    const measured = bytes?.offsets?.get(f.name.toUpperCase())
    if (bytes !== undefined && measured === undefined) continue
    if (size === undefined) {
      open = false
      continue
    }
    // unmeasured: each field alone, aligned, a gap past the one before
    const at = measured === undefined ? Number(alignUp(BigInt(alone === 0 ? 0 : alone + 16), size.align)) : Number(measured)
    alone = at + Number(size.size)
    offsets.set(f.name.toUpperCase(), Number(at))
    if (open && bytes !== undefined) runs.at(-1)![1] = Number(at) + Number(size.size)
    else runs.push([Number(at), Number(at) + Number(size.size)])
    open = true
  }
  return { runs, offsets, size: bytes === undefined ? alone : Number(bytes.size) }
}

/** An escaped FB type's image layout: its runs, each image field's offset, and the bytes an instance takes. */
export interface Runs {
  readonly runs: [number, number][]
  readonly offsets: Map<string, number>
  readonly size: number
}

/** The image being laid out: its regions, and the initial values written into it. */
class Layout {
  size = 0
  readonly regions: [number, number][] = []
  readonly writes: { at: number; type: Type; init: IrInit }[] = []
  /** `size` bytes aligned to `align`, a gap past the last region — the offset from `IMAGE_BASE`. */
  take(size: number, align: number): number {
    const at = Number(alignUp(BigInt(this.size === 0 ? 0 : this.size + GAP), BigInt(align)))
    this.size = at + size
    return at
  }
  image(layouts: ReadonlyMap<string, IrLayout>): IrImage {
    const bytes = new Uint8Array(this.size)
    const view = new DataView(bytes.buffer)
    for (const w of this.writes) storeValue(view, w.at, w.type, instantiate(w.type, w.init, layouts), layouts)
    const runs: [number, number[]][] = []
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0) continue
      const last = runs.at(-1)
      if (last !== undefined && last[0] + last[1].length === i) last[1].push(bytes[i]!)
      else runs.push([i, [bytes[i]!]])
    }
    return { size: this.size, bytes: runs, regions: this.regions }
  }
}

/** The POU's frame and globals, and every layout, laid out in the image — undefined when nothing escaped. Refusals go
 *  to `lw` (`layout-unmeasured`, `image-stack`). */
export function layOutImage(lw: Lowering, slots: IrSlot[], globals: IrSlot[], span: Span): IrImage | undefined {
  const escapes = escapesOf(lw)
  const types = [...escapes.types].filter((name) => lw.layouts.get(name)?.kind === "function_block")
  const own = (key: string): boolean => escapes.variables.has(key)
  const pou = `POU:${lw.shared.root.toUpperCase()}`
  if (types.length === 0 && !slots.some((s) => own(`${pou}.${s.name.toUpperCase()}`)) && !globals.some((s) => own(`GLOBAL.${s.name.toUpperCase()}`))) return undefined
  const runs = new Map<string, Runs>()
  for (const name of types) {
    const measured = measuredType(lw, name, span)
    if (measured === undefined) return undefined
    runs.set(name, measured)
  }
  const layout = new Layout()
  const variable = (s: IrSlot): IrSlot => {
    const bytes = byteSize(lw, s.type)!
    const at = layout.take(Number(bytes.size), Number(bytes.align))
    layout.regions.push([at, at + Number(bytes.size)])
    layout.writes.push({ at, type: s.type, init: s.init })
    return { ...s, image: Number(IMAGE_BASE) + at }
  }
  slots.forEach((s, i) => (slots[i] = own(`${pou}.${s.name.toUpperCase()}`) ? variable(s) : s))
  globals.forEach((s, i) => (globals[i] = s.section !== "program" && own(`GLOBAL.${s.name.toUpperCase()}`) ? variable(s) : s))
  const place = (s: IrSlot): IrSlot => ({ ...s, init: instancesIn(lw, runs, layout, s.type, s.init) ?? s.init })
  slots.forEach((s, i) => (slots[i] = place(s)))
  globals.forEach((s, i) => (globals[i] = place(s)))
  for (const name of types) withBase(lw, name)
  return layout.image(lw.layouts)
}

/** An escaped FB type, measured and marked: each image field's offset, the hidden `__base` — or refused, undefined. */
function measuredType(lw: Lowering, name: string, span: Span): Runs | undefined {
  const layout = lw.layouts.get(name)!
  const measured = imageRuns(lw, name)
  if (measured === undefined) return lw.bail("layout-unmeasured", `${layout.name}'s data has its address stored, and it has no layout to lay out`, span)
  lw.layouts.set(name, { ...layout, fields: layout.fields.map((f) => (measured.offsets.has(f.name.toUpperCase()) ? { ...f, image: measured.offsets.get(f.name.toUpperCase())! } : f)) })
  return measured
}

/** The hidden `__base` an escaped FB type's instance holds its region's address in — added once every field is laid. */
function withBase(lw: Lowering, name: string): void {
  const layout = lw.layouts.get(name)!
  if (layout.fields.some((f) => f.name === BASE_FIELD)) return
  lw.layouts.set(name, { ...layout, fields: [...layout.fields, { name: BASE_FIELD, type: ADDRESS, section: "temp", init: 0n }] })
}

/**
 * Every instance of an escaped FB type `t`'s value holds — itself, a field's, an element's — given a region of its own,
 * its image fields' initial values written there, and its `__base` set: the value's new initial value, or undefined when
 * it holds none. An image field's initial value leaves the struct's: the struct does not hold it.
 */
function instancesIn(lw: Lowering, runs: ReadonlyMap<string, Runs>, layout: Layout, t: Type, init: IrInit): IrInit | undefined {
  const array = peelArray(t)
  if (array !== undefined) {
    if (typeof init !== "object" || !("elements" in init)) throw new Error("an array whose initial value states no elements")
    const at = (k: number): IrInit => (k < init.elements.length ? init.elements[k]! : init.rest)
    const placed = Array.from({ length: array.length }, (_, k) => instancesIn(lw, runs, layout, array.element, at(k)))
    return placed.every((p) => p === undefined) ? undefined : { elements: placed.map((p, k) => p ?? at(k)), rest: init.rest }
  }
  if (t.kind !== "function_block" && t.kind !== "struct") return undefined
  const fields = lw.layouts.get(t.name.toUpperCase())?.fields ?? []
  const named = typeof init === "object" && "fields" in init ? init.fields : {}
  const own = t.kind === "function_block" ? runs.get(t.name.toUpperCase()) : undefined
  const out: Record<string, IrInit> = {}
  let changed = own !== undefined
  let base = 0
  if (own !== undefined) {
    base = layout.take(own.size, 8)
    for (const [s, e] of own.runs) layout.regions.push([base + s, base + e])
    out[BASE_FIELD.toUpperCase()] = BigInt(Number(IMAGE_BASE) + base)
  }
  for (const f of fields) {
    const key = f.name.toUpperCase()
    const value = named[key] ?? f.init
    if (own !== undefined && f.image !== undefined) {
      layout.writes.push({ at: base + f.image, type: f.type, init: value })
      continue
    }
    const inner = instancesIn(lw, runs, layout, f.type, value)
    if (inner !== undefined) changed = true
    if (inner !== undefined || named[key] !== undefined) out[key] = inner ?? named[key]!
  }
  return changed ? { fields: out } : undefined
}

/** `ARRAY[0..n-1] OF BYTE` — the bytes of a run, as a whole-instance copy moves them (`statements/assign.ts`). */
export const byteRun = (n: number): Type => ({ kind: "array", element: elementaryRef("BYTE"), bounds: [{ lower: 0n, upper: BigInt(n - 1) }], dims: [{} as never] }) as Type
