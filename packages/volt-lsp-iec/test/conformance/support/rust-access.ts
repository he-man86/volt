/**
 * A VARIABLE PATH AS A RUST ACCESS — how a harness reads the emitted program where the interpreter reads it. Test support,
 * not the emitter: the emitter prints, and a harness reaching into what it printed is the conformance suite's concern.
 */
import type { Access, IrExpr, IrPou, Place } from "../../../src/transpile/ir/index.js"
import { namesVariable, pathRoot } from "../../../src/transpile/ir/path.js"
import { fieldNames, globalFieldNames } from "../../../src/transpile/emit/rust/names.js"
import { rustType } from "../../../src/transpile/emit/rust/types.js"
import { toImage } from "../../../src/transpile/semantics/memory.js"
import { elementaryRef, isBoolValued, peelArray, type Type } from "../../../src/frontend/types/index.js"

/** The harness's names for the values a generated `scan` is handed (`transpile-replay.test.ts`, `backends.test.ts`). */
const ROOTS = { pou: "p", globals: "g", image: "mem" } as const

/** How a harness reaches one variable of the emitted program: an expression that reads it, and a statement that writes
 *  a Rust value into it — each over the harness's own `p`, `g` and `mem`. */
export interface RustAccess {
  readonly type: Type
  readonly read: string
  write(value: string): string
  /** A BOOL held as its byte (`IrSlot.rawBool`): `type` is its BYTE, and it SHOWS as the BOOL it is declared — 0 FALSE,
   *  1 TRUE (transpile-restructure 8.2). */
  readonly rawBool?: true
}

const NO_SPAN = { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }

/**
 * A variable path as the IDE names it (`inst.q`, `arr[2].x`) → how to read and write it in the emitted Rust, and the
 * variable's type — how a test reads the emitted program exactly where the interpreter's `get` reads. An FB's VAR_STAT
 * reached through an instance is a field of `Globals`; a variable the byte image holds (`IrSlot.image`), or a field of an
 * instance whose data it holds, is its bytes in `Mem` — found by the one rewrite the interpreter's runner asks too.
 */
export function rustAccess(pou: IrPou, path: string): RustAccess {
  const { place, rootType, address, global, rawBool } = placeOf(pou, path)
  const layouts = new Map(pou.layouts.map((l) => [l.name.toUpperCase(), l]))
  const image = toImage(place, { type: rootType, ...(address === undefined ? {} : { address }) }, layouts)
  const type = place.type
  if (image.root !== "image") {
    const text = `${global ? ROOTS.globals : ROOTS.pou}.${fieldPath(pou, place, rootType)}`
    return { type, read: text, write: (value) => `${text} = ${value};`, ...rawBool }
  }
  if (type.kind !== "elementary") throw new Error(`${path} is a composite the image holds — read its elements`)
  const at = `${addressText(pou, image.at!)} + ${image.path.reduce((n, s) => n + (s.kind === "index" ? (Number((s.index as { value: bigint }).value) - Number(s.lower)) * s.size! : 0), 0)}`
  const read = isBoolValued(type) ? `(${ROOTS.image}.ld::<1>(${at})[0] != 0)` : `${rustType(type)}::from_le_bytes(${ROOTS.image}.ld(${at}))`
  // a seed's `as _` names its type here: the bytes stored are the variable's own width
  const typed = (value: string): string => `(${value.endsWith(" as _") ? value.slice(0, -5) : `(${value})`} as ${rustType(type)})`
  const write = (value: string): string =>
    isBoolValued(type) ? `${ROOTS.image}.st(${at}, [u8::from(${value})]);` : `${ROOTS.image}.st(${at}, ${typed(value)}.to_le_bytes());`
  return { type, read, write, ...rawBool }
}

/** A path as the place it names, under the POU's frame or the application's globals. */
function placeOf(pou: IrPou, path: string): { place: Place; rootType: Type; address?: number; global: boolean; rawBool: { rawBool?: true } } {
  // the IDE's path grammar and where it starts (`ir/path.ts` `pathRoot`), the one rule the interpreter's `get` reads: a
  // GVL variable, or the `__clock` a harness sets, is a field of `Globals`
  const start = pathRoot(pou, path)
  let root = start.global ? pou.globals[start.slot]! : pou.slots[start.slot]!
  let at = start.slot
  let inGlobals = start.global
  let type = root.type
  let steps: Access[] = []
  // the slot or field the path names whole — whether it is a BOOL held as its byte
  let whole: { rawBool?: true } | undefined = root
  for (const part of start.rest) {
    if (part.kind === "name") {
      const named = type.kind === "struct" || type.kind === "function_block" ? type.name.toUpperCase() : undefined
      const layout = pou.layouts.find((l) => l.name.toUpperCase() === named)
      const field = layout?.fields.find((f) => namesVariable(f.name, part.name))
      // an FB's VAR_STAT, named through an instance, is the one global every instance shares
      const shared = field === undefined ? layout?.statics?.find((s) => namesVariable(s.name, part.name)) : undefined
      if (shared !== undefined) {
        root = pou.globals[shared.global]!
        at = shared.global
        inGlobals = true
        steps = []
        type = root.type
        whole = root
        continue
      }
      if (field === undefined) throw new Error(`no variable ${path} in ${pou.name}`)
      steps.push({ kind: "field", name: field.name })
      type = field.type
      whole = field
    } else {
      const array = peelArray(type)
      if (array === undefined) throw new Error(`${path} indexes a non-array`)
      steps.push({ kind: "index", index: { kind: "const", value: part.index, type: elementaryRef("LINT"), span: NO_SPAN }, lower: array.lower, length: array.length })
      type = array.element
      whole = undefined
    }
  }
  const place: Place = { slot: at, path: steps, type, span: NO_SPAN, ...(inGlobals ? { root: "global" as const } : {}) }
  const rawBool = whole?.rawBool === true ? { rawBool: true as const } : {}
  return { place, rootType: root.type, ...(root.image === undefined ? {} : { address: root.image }), global: inGlobals, rawBool }
}

/** A place's struct path under its root — `inst.arr[2].x` as the emitter names the fields. */
function fieldPath(pou: IrPou, place: Place, rootType: Type): string {
  const slots = place.root === "global" ? pou.globals.filter((s) => s.section !== "program") : pou.slots
  const own = place.root === "global" ? slots.indexOf(pou.globals[place.slot]!) : place.slot
  let text = (place.root === "global" ? globalFieldNames(slots) : fieldNames(slots))[own]!
  let type = rootType
  for (const step of place.path) {
    if (step.kind === "field") {
      const named = type.kind === "struct" || type.kind === "function_block" ? type.name.toUpperCase() : undefined
      const layout = pou.layouts.find((l) => l.name.toUpperCase() === named)!
      const i = layout.fields.findIndex((f) => f.name.toUpperCase() === step.name.toUpperCase())
      text += `.${fieldNames(layout.fields)[i]}`
      type = layout.fields[i]!.type
    } else if (step.kind === "index") {
      const array = peelArray(type)!
      text += `[${Number((step.index as { value: bigint }).value - array.lower)}]`
      type = array.element
    }
  }
  return text
}

/** An image address as the harness reaches it: a constant, or an instance's `__base` field plus its offsets. */
function addressText(pou: IrPou, at: IrExpr): string {
  if (at.kind === "const") return String(at.value)
  if (at.kind === "binary" && at.op === "add") return `${addressText(pou, at.left)} + ${addressText(pou, at.right)}`
  if (at.kind === "load") {
    const root = at.place.root === "global" ? pou.globals[at.place.slot]! : pou.slots[at.place.slot]!
    return `${at.place.root === "global" ? ROOTS.globals : ROOTS.pou}.${fieldPath(pou, at.place, root.type)}`
  }
  throw new Error(`an image address the harness cannot read (${at.kind})`)
}
