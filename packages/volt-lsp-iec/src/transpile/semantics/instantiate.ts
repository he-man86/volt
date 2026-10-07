/** A FRESH VALUE OF A TYPE — what a slot, a field or an element starts at. */
import type { IrInit, IrLayout, IrValue } from "../ir/index.js"
import { peelArray, type Type, typeZero } from "../../frontend/types/index.js"
import type { Val } from "./value.js"
import { fit } from "./store.js"

/** A fresh value of a type: an elementary one at `init`, a struct or FB instance at its fields' initial values, an array
 *  of fresh elements — the interpreter's counterpart of the emitter's `new()`. */
export function instantiate(type: Type, init: IrInit, layouts: ReadonlyMap<string, IrLayout>): Val {
  if (type.kind === "struct" || type.kind === "function_block") {
    const layout = layouts.get(type.name.toUpperCase())
    if (layout === undefined) throw new Error(`no layout for ${type.name}`)
    // the TYPE's own field values, with the fields an aggregate initializer names set over them
    const named = typeof init === "object" && "fields" in init ? init.fields : {}
    return Object.fromEntries(layout.fields.map((f) => [f.name.toUpperCase(), instantiate(f.type, named[f.name.toUpperCase()] ?? f.init, layouts)]))
  }
  const array = peelArray(type)
  // every element starts at its OWN type's zero — a BOOL array's is FALSE, not the array slot's placeholder — unless an
  // aggregate initializer gave it one
  const elements = typeof init === "object" && "elements" in init ? init.elements : []
  if (array !== undefined) return Array.from({ length: array.length }, (_, i) => instantiate(array.element, elements[i] ?? typeZero(array.element), layouts))
  return fit(init as IrValue, type)
}
