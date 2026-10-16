/**
 * THE RUNNER — a lowered POU prepared for execution: its frame and globals allocated and seeded, its init run, and the
 * harness's view of it — a scan, and a variable read or written by the path the IDE names it with.
 */
import type { Access, IrLayout, IrPou, Place } from "../ir/index.js"
import { elementaryRef, peelArray, type Type } from "../../frontend/types/index.js"
import type { Span } from "../../frontend/syntax/index.js"
import { instantiate, Memory, NaNBits, storeAs, toImage, type Val, visible } from "../semantics/index.js"
import { namesVariable, parsePath } from "../ir/path.js"
import type { Located } from "./frame.js"
import { Machine } from "./machine.js"

/** How a harness runs a POU. */
interface RunOptions {
  /** Throw `LoopGuardError` when one loop enters its body more than this many times. Unset: no bound. */
  readonly loopGuard?: number
}

export interface Runner {
  /** Live slot values, in frame order. */
  readonly frame: readonly Val[]
  /** A variable by its path from the POU, as the IDE names it: `count`, `inst.q`, `arr[2].x`. */
  get(path: string): Val
  set(path: string, value: Val): void
  /** Run one scan cycle. */
  scan(): void
}

/** A path is not source: the places it builds have no span. */
const NO_SPAN: Span = { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }
/** The type a path's literal index is read in — wide enough for every array bound. */
const INDEX_TYPE = elementaryRef("LINT")

/** A variable path as a PLACE, and the cell it lands in on the POU's machine — `inst.q` is the slot `inst`, then its field
 *  `Q`; `arr[2]` one index step (the dimension's lower bound subtracted, the bounds checked, by `Frame.locate`). Shared by
 *  `get` and `set`, so a test reads exactly where the program writes. */
function resolvePath(pou: IrPou, machine: Machine, layouts: ReadonlyMap<string, IrLayout>, path: string): ({ at: Located } | { image: Place }) & { type: Type } {
  // the IDE's path grammar (`ir/path.ts`): a quoted name unquoted, `a[1, 2]` one index segment per dimension
  const parts = parsePath(path)
  const head = parts[0]
  const first = head?.kind === "name" ? head.name : undefined
  const slot = first === undefined ? -1 : pou.slots.findIndex((s) => namesVariable(s.name, first))
  // not the POU's own: a global by its name — a GVL variable, or the `__clock` a harness sets before a scan
  const global = slot < 0 && first !== undefined ? pou.globals.findIndex((s) => s.section !== "program" && namesVariable(s.name, first)) : -1
  if (slot < 0 && global < 0) throw new Error(`no variable ${path} in ${pou.name}`)
  let root: Place["root"] = global >= 0 ? "global" : undefined
  let at = global >= 0 ? global : slot
  let rootSlot = global >= 0 ? pou.globals[global]! : pou.slots[slot]!
  let steps: Access[] = []
  let type: Type = global >= 0 ? pou.globals[global]!.type : pou.slots[slot]!.type
  for (const part of parts.slice(1)) {
    if (part.kind === "name") {
      const layout = type.kind === "struct" || type.kind === "function_block" ? layouts.get(type.name.toUpperCase()) : undefined
      const field = layout?.fields.find((f) => namesVariable(f.name, part.name))
      // an FB's VAR_STAT, named through an instance, is the one global every instance shares
      const shared = field === undefined ? layout?.statics?.find((s) => namesVariable(s.name, part.name)) : undefined
      if (shared !== undefined) {
        root = "global"
        at = shared.global
        rootSlot = pou.globals[shared.global]!
        steps = []
        type = pou.globals[shared.global]!.type
        continue
      }
      if (field === undefined) throw new Error(`no variable ${path} in ${pou.name}`)
      steps.push({ kind: "field", name: field.name })
      type = field.type
    } else {
      const array = peelArray(type)
      if (array === undefined) throw new Error(`${path} indexes a non-array`)
      const index = { kind: "const" as const, value: part.index, type: INDEX_TYPE, span: NO_SPAN }
      steps.push({ kind: "index", index, lower: array.lower, length: array.length })
      type = array.element
    }
  }
  const place: Place = { slot: at, path: steps, type, span: NO_SPAN, ...(root === undefined ? {} : { root }) }
  // a variable the image holds, or a field of an instance whose data it holds, is read where the program writes it
  const imaged = toImage(place, { type: rootSlot.type, ...(rootSlot.image === undefined ? {} : { address: rootSlot.image }) }, layouts)
  return imaged.root === "image" ? { image: imaged, type } : { at: machine.locate(place), type }
}

/** A value as the IDE shows it: a string is what stands before its terminator, not the buffer behind it
 *  (`semantics/string.ts`). A NaN stays its bits (`NaNBits`): the IDE shows any NaN as `REAL#NaN`, and a harness that
 *  compares two backends compares the bits. */
function shown(v: Val): Val {
  if (typeof v === "string") return visible(v)
  if (v instanceof NaNBits) return v
  if (Array.isArray(v)) return v.map(shown)
  if (typeof v === "object" && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shown(x)]))
  return v
}

/** Prepare a lowered POU for execution: allocate its frame, seed it from the slots' initial values. */
export function run(pou: IrPou, options: RunOptions = {}): Runner {
  const layouts = new Map(pou.layouts.map((l) => [l.name.toUpperCase(), l]))
  const frame = pou.slots.map((s) => instantiate(s.type, s.init, layouts))
  const routines = new Map(pou.routines.map((r) => [r.key, r]))
  const globals = pou.globals.map((s) => instantiate(s.type, s.init, layouts))
  // the scan's locals — the POU's VAR_TEMP (7.6.4) — start over at their initial values on every scan
  const locals: Val[] = []
  const machine = new Machine(frame as unknown as Record<number, Val>, pou.slots.map((_, i) => i), [], layouts, routines, globals, new Memory(pou.image), options.loopGuard, locals)
  if (pou.init !== undefined) machine.block(pou.init)

  return {
    frame,
    get: (path) => {
      const found = resolvePath(pou, machine, layouts, path)
      if ("image" in found) return shown(machine.read(found.image))
      const { container, key } = found.at
      return shown((container as Record<string | number, Val>)[key]!)
    },
    // stored as the variable's type holds it, like every write the program makes — a test cannot plant a value the PLC couldn't
    set: (path, value) => {
      const found = resolvePath(pou, machine, layouts, path)
      if ("image" in found) return machine.write(found.image, value)
      const { at, type } = found
      ;(at.container as Record<string | number, Val>)[at.key] = storeAs(value, type)
    },
    scan: () => {
      locals.splice(0, locals.length, ...(pou.locals ?? []).map((s) => instantiate(s.type, s.init, layouts)))
      machine.block(pou.body)
    },
  }
}
