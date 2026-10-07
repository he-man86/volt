/**
 * A VARIABLE PATH AS A RUST ACCESS — how a harness reads the emitted program where the interpreter reads it. Test support,
 * not the emitter: the emitter prints, and a harness reaching into what it printed is the conformance suite's concern.
 */
import type { IrPou } from "../../../src/transpile/ir/index.js"
import { namesVariable, parsePath } from "../../../src/transpile/ir/path.js"
import { fieldNames } from "../../../src/transpile/emit/rust/names.js"
import { peelArray, type Type } from "../../../src/frontend/types/index.js"

/**
 * A variable path as the IDE names it (`inst.q`, `arr[2].x`) → the Rust field access under a POU value, and the
 * variable's type — how a test reads the emitted program exactly where the interpreter's `get` reads. `global`: the path
 * reaches an FB's VAR_STAT through an instance, and `expr` is then under the `Globals` value.
 */
export function rustAccess(pou: IrPou, path: string): { expr: string; type: Type; global: boolean } {
  // the IDE's path grammar (`ir/path.ts`), the one the interpreter's `get` reads
  const parts = parsePath(path)
  const head = parts[0]
  const first = head?.kind === "name" ? head.name : undefined
  const names = (declared: string): boolean => first !== undefined && namesVariable(declared, first)
  const slot = pou.slots.findIndex((s) => names(s.name))
  // not the POU's own: a GVL variable, or the `__clock` a harness sets — a field of `Globals`, as the interpreter finds it
  const variables = pou.globals.filter((s) => s.section !== "program")
  const named = slot < 0 ? variables.findIndex((s) => names(s.name)) : -1
  if (slot < 0 && named < 0) throw new Error(`no variable ${path} in ${pou.name}`)
  let expr = named >= 0 ? fieldNames(variables)[named]! : fieldNames(pou.slots)[slot]!
  let type = named >= 0 ? variables[named]!.type : pou.slots[slot]!.type
  let global = named >= 0
  for (const part of parts.slice(1)) {
    if (part.kind === "name") {
      const typeName = type.kind === "struct" || type.kind === "function_block" ? type.name.toUpperCase() : undefined
      const layout = pou.layouts.find((l) => l.name.toUpperCase() === typeName)
      const i = layout?.fields.findIndex((f) => namesVariable(f.name, part.name)) ?? -1
      const shared = i < 0 ? layout?.statics?.find((s) => namesVariable(s.name, part.name)) : undefined
      if (shared !== undefined) {
        // an FB's VAR_STAT is a field of `Globals`, named as `emitRust` names the GVL variables
        const variables = pou.globals.filter((s) => s.section !== "program")
        expr = fieldNames(variables)[variables.indexOf(pou.globals[shared.global]!)]!
        type = pou.globals[shared.global]!.type
        global = true
        continue
      }
      if (layout === undefined || i < 0) throw new Error(`no variable ${path} in ${pou.name}`)
      expr += `.${fieldNames(layout.fields)[i]}`
      type = layout.fields[i]!.type
    } else {
      const array = peelArray(type)
      if (array === undefined) throw new Error(`${path} indexes a non-array`)
      expr += `[${part.index - array.lower}]`
      type = array.element
    }
  }
  return { expr, type, global }
}
