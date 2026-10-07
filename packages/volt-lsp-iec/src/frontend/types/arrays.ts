/**
 * HOW AN ARRAY TYPE IS WALKED — one dimension at a time (openspec transpile-restructure design.md §6 need 3). The one
 * way the transpiler's lowering and both backends step into an array type.
 */
import type { Type } from "./type.js"

/** An array's FIRST dimension — its element (the remaining dimensions, if any), lower bound and length — or undefined
 *  for anything else, or an array whose bounds do not fold. */
export function peelArray(t: Type): { element: Type; lower: bigint; length: number } | undefined {
  if (t.kind !== "array" || t.bounds === undefined || t.bounds.length === 0) return undefined
  const [dim, ...rest] = t.bounds
  const element: Type = rest.length === 0 ? t.element : { ...t, bounds: rest, dims: t.dims.slice(1) }
  return { element, lower: dim!.lower, length: Number(dim!.upper - dim!.lower + 1n) }
}

/** What one index step into `t` reaches — a sized array's element (`peelArray`), or an `ARRAY[*]`'s, its remaining open
 *  dimensions first. Undefined for anything that is not an array. */
export function elementOf(t: Type): Type | undefined {
  if (t.kind !== "array") return undefined
  if (t.bounds !== undefined) return peelArray(t)?.element
  return t.dims.length > 1 ? { ...t, dims: t.dims.slice(1) } : t.element
}
