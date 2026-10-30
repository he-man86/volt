/**
 * THE RUNNER — a lowered POU prepared for execution: its frame and globals allocated and seeded, its init run, and the
 * harness's view of it — a scan, and a variable read or written by the path the IDE names it with.
 */
import type { Access, IrLayout, IrPou, Place } from "../ir/index.js"
import { elementaryRef, peelArray, type Type } from "../../frontend/types/index.js"
import type { Span } from "../../frontend/syntax/index.js"
import { instantiate, Memory, NaNBits, storeAs, toImage, type Val, visible } from "../semantics/index.js"
import { namesVariable, pathRoot } from "../ir/path.js"
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
  /** A variable by its path from the POU, as the IDE names it: `count`, `inst.q`, `arr[2].x`, `GVL.g` — every global of
   *  every list by `<list>.<name>`, its bare name where that names one variable (`ir/path.ts` `pathRoot`). */
  get(path: string): Val
  /** Write a variable by its path — refused with a `RunnerValueError`, nothing written, when its declared type does not
   *  hold the value (`set-value.ts`). */
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
  // the IDE's path grammar and where it starts (`ir/path.ts`): the POU's own variable, a GVL variable by `<list>.<name>`
  // (or its bare name where that is unambiguous), or the `__clock` a harness sets before a scan
  const start = pathRoot(pou, path)
  let root: Place["root"] = start.global ? "global" : undefined
  let at = start.slot
  let rootSlot = start.global ? pou.globals[at]! : pou.slots[at]!
  let steps: Access[] = []
  let type: Type = rootSlot.type
  for (const part of start.rest) {
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
    // only a value the variable's declared type holds, or a `RunnerValueError` and nothing written (`set-value.ts`) — a
    // harness cannot plant a value the PLC couldn't hold; then stored as the type holds it, like every write the program makes
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
