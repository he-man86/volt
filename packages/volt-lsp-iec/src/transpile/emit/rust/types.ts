/**
 * IR TYPES AS RUST TYPES — the one mapping, built on the front-end's type predicates (`types/predicates`): this file asks
 * them and defines none of its own (design.md P4).
 */
import { floatBits, holdsIntegerBits, isBit, isBoolValued, peelArray, stringKind, type Type } from "../../../frontend/types/index.js"
import { rustName } from "./names.js"

/** The family an elementary type is EMITTED as — its own, except a BIT, which is a "bitstring" of one bit that the
 *  Rust holds (and CODESYS reads) as a BOOL. The one place that decision is made: `rustType` and `convert` both
 *  ask here, so a type cannot be `bool` in one and a bitstring in the other (transpile-review task 31). */
export function emittedFamily(t: Type): string | undefined {
  if (t.kind !== "elementary") return undefined
  return isBit(t) ? "bool" : t.elem.family
}

/** IEC elementary type → Rust type, derived from the type's own facts (family · bits · signed). */
export function rustType(t: Type): string {
  // a struct or FB instance is its layout's struct, held by value; an array is a Rust array, one per dimension
  if (t.kind === "struct" || t.kind === "function_block") return rustName(t.name)
  const array = peelArray(t)
  if (array !== undefined) return `[${rustType(array.element)}; ${array.length}]`
  // a pointer or reference holds its one target's index, 0 when null (design §9 form 1)
  if (t.kind === "pointer" || t.kind === "reference") return "usize"
  // an interface holds the tag of the instance it names, 0 when null (design §22)
  if (t.kind === "interface") return "u64"
  if (t.kind !== "elementary") throw new Error(`no Rust mapping for a ${t.kind} type`)
  const { bits, signed } = t.elem
  if (isBoolValued(t)) return "bool"
  const float = floatBits(t)
  if (float !== undefined) return `f${float}`
  // A fixed-capacity string, generated into the output (`runtime/string.ts`) — not Rust `String`, which neither truncates
  // nor copies: `a := b` MOVED a String out of `self`, and no emitted program had ever held a string to find out.
  if (stringKind(t) !== undefined) {
    const s = stringType(t)
    return `${s.name}<${s.capacity}>`
  }
  // A duration or date is the integer it is measured to be: TIME/TOD a u32 of MILLISECONDS, DATE/DT a u32 of SECONDS,
  // LTIME/LDATE/LDT/LTOD a u64 of nanoseconds (design §16, §17). This used to print every one of them as an i64.
  if (holdsIntegerBits(t)) return `${signed ? "i" : "u"}${bits}`
  throw new Error(`no Rust mapping for ${t.name}`)
}

/**
 * A VAR_IN_OUT's Rust parameter type. An `ARRAY[*]` is a slice, and each open dimension inside it a const generic Rust
 * infers from the array every call lends — `grid : ARRAY[*, *] OF INT` is `&mut [[i16; N_GRID_2]]` (design §26).
 */
export function inoutType(slot: { type: Type; readOnly?: boolean }, name: string): { param: string; generics: string[] } {
  const t = slot.type
  const borrow = slot.readOnly === true ? "&" : "&mut "
  // A STRING VAR_IN_OUT binds a string of ANY capacity — `VAR_IN_OUT text : STRING` takes a STRING(12) (conformance
  // `xo4_inout_constant_chain`), and lowering has already given the sizeless one its 80, so the declared number cannot
  // be told from a bound one here. The parameter is generic over the capacity, which is what the interpreter does by
  // binding the caller's place. ponytail: a store into a SIZED string in-out then truncates at the CALLER's capacity,
  // not the callee's — unmeasured, and the interpreter has always done the same, so the two backends agree.
  if (stringKind(t) !== undefined) {
    const n = `N_${name.toUpperCase()}`
    return { param: `${name}: ${borrow}${stringType(t).name}<${n}>`, generics: [`const ${n}: usize`] }
  }
  if (t.kind !== "array" || t.bounds !== undefined) return { param: `${name}: ${borrow}${rustType(t)}`, generics: [] }
  const generics = t.dims.slice(1).map((_, d) => `N_${name.toUpperCase()}_${d + 2}`)
  const inner = generics.reduceRight((element, n) => `[${element}; ${n}]`, rustType(t.element))
  return { param: `${name}: ${borrow}[${inner}]`, generics: generics.map((n) => `const ${n}: usize`) }
}

/** `<const N: usize, …>` after a fn name, or nothing. */
export const genericList = (typed: readonly { generics: string[] }[]): string => {
  const all = typed.flatMap((t) => t.generics)
  return all.length === 0 ? "" : `<${all.join(", ")}>`
}

/** A string type's generated Rust type (`runtime/string.ts`) and capacity — the one place both are read off the type. */
export function stringType(t: Type): { name: "IecString" | "IecWString"; capacity: number } {
  if (t.kind !== "elementary" || t.length === undefined) throw new Error("no Rust mapping for a string type without a capacity")
  return { name: t.name === "WSTRING" ? "IecWString" : "IecString", capacity: t.length }
}

/** True for a STRING or WSTRING type — the operands that need `iec_max`/`iec_min` rather than `Ord`. */
export function isString(t: Type): boolean {
  return t.kind === "elementary" && (t.name === "STRING" || t.name === "WSTRING")
}

/** A string type's `IecString::<N>` / `IecWString::<N>` — the path its constructors are called through. */
export function stringPath(t: Type): string {
  const s = stringType(t)
  return `${s.name}::<${s.capacity}>`
}

/** A REAL (not an LREAL) — the width whose literals print as their shortest f32. */
export const isReal32 = (t: Type): boolean => floatBits(t) === 32

/** Whether the emitted Rust for this type is `Copy` — everything the printer emits except a DUT struct and an FB
 *  instance, both of which derive only `Clone`. An array is `Copy` exactly when its element is. */
export function isCopy(t: Type): boolean {
  if (t.kind === "array") return isCopy(t.element)
  return t.kind === "elementary" || t.kind === "pointer" || t.kind === "reference" || t.kind === "interface"
}
