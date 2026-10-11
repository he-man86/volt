/**
 * IR TYPES AS RUST TYPES — the one mapping, built on the front-end's type predicates (`types/predicates`): this file asks
 * them and defines none of its own (design.md P4).
 */
import { floatBits, holdsIntegerBits, isBoolValued, peelArray, stringKind, type Type } from "../../../frontend/types/index.js"
import { rustName } from "./names.js"
import type { IrExpr, IrLayout, Place } from "../../ir/index.js"

/** The family an elementary type is EMITTED as — its own, except a BIT, which is a "bitstring" of one bit that the
 *  Rust holds (and CODESYS reads) as a BOOL. The one place that decision is made: `rustType` and `convert` both
 *  ask here, so a type cannot be `bool` in one and a bitstring in the other (transpile-review task 31) — and it asks
 *  the front-end's `isBoolValued`, the one BIT-is-BOOL rule (transpile-restructure 6.9). */
export function emittedFamily(t: Type): string | undefined {
  if (t.kind !== "elementary") return undefined
  return isBoolValued(t) ? "bool" : t.elem.family
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
 * infers from the array every call lends — `grid : ARRAY[*, *] OF INT` is `&mut [[i16; D_GRID_2]]` (design §26).
 */
/**
 * A VAR_IN_OUT CONSTANT of a scalar — an elementary type that is no string — is taken BY VALUE (lean 7.6.5): `value: i16`,
 * not `value: &i16`. The callee never writes it (lowering refuses a store), and a borrow of the caller's place could not
 * be held across any write to it — rustc refuses that — so the value at the call is every value the callee can read.
 */
export const byValue = (slot: { type: Type; readOnly?: boolean }): boolean =>
  slot.readOnly === true && slot.type.kind === "elementary" && stringKind(slot.type) === undefined

export function inoutType(slot: { type: Type; readOnly?: boolean }, name: string): { param: string; generics: string[] } {
  const t = slot.type
  if (byValue(slot)) return { param: `${name}: ${rustType(t)}`, generics: [] }
  const borrow = slot.readOnly === true ? "&" : "&mut "
  // A STRING VAR_IN_OUT binds a string of another capacity than it declares — a VAR_IN_OUT CONSTANT a narrower one
  // (`xo4_inout_constant_chain`: a STRING(12) into a sizeless one), any a wider one (`string_inout_wider_*`). The parameter
  // is generic over the capacity: N is the CALLER's, the buffer the interpreter binds. A routine bound wider is lowered for
  // that capacity (`lower/calls/string-inouts.ts`, transpile-restructure 8.2 step 8e) — its slot is the caller's type, its
  // reads convert to the declared one (`io.to::<10>()`) and its whole stores write within it (`store_within`), so the
  // declared capacity is in the IR wherever it matters, never read off this generic.
  if (stringKind(t) !== undefined) {
    const n = `N_${name.toUpperCase()}`
    return { param: `${name}: ${borrow}${stringType(t).name}<${n}>`, generics: [`const ${n}: usize`] }
  }
  if (t.kind !== "array" || t.bounds !== undefined) return { param: `${name}: ${borrow}${rustType(t)}`, generics: [] }
  // `D_` apart from a string's `N_`: as `N_<NAME>_<d>`, `grid : ARRAY[*, *]`'s second dimension was `N_GRID_2`, which a
  // STRING in-out named `grid_2` also declares (6.A.6). Within the arrays `<NAME>_<d>` cannot repeat — the field names
  // are distinct and the dimension is the digits after the last `_`.
  const generics = t.dims.slice(1).map((_, d) => `D_${name.toUpperCase()}_${d + 2}`)
  const inner = generics.reduceRight((element, n) => `[${element}; ${n}]`, rustType(t.element))
  return { param: `${name}: ${borrow}[${inner}]`, generics: generics.map((n) => `const ${n}: usize`) }
}

/**
 * WHETHER A STORE OF `value` INTO `target` IS THE PLAIN COPY `x = v`: not a string, or a string of one capacity on both
 * sides of which neither is a STRING VAR_IN_OUT — whose Rust capacity is the generic `N_*` (`inoutType`) whatever its
 * type's number says, so `*str` into an `IecString<255>` is E0308 even when the variant's in-out is a STRING(255). Any
 * other string store is `IecStr::store` (model 2).
 */
export function plainCopy(target: Pick<Place, "type" | "root">, value: IrExpr): boolean {
  if (stringKind(target.type) === undefined) return true
  const capacity = (t: Type): number | undefined => (t.kind === "elementary" ? t.length : undefined)
  return capacity(value.type) === capacity(target.type) && target.root !== "inout" && !(value.kind === "load" && value.place.root === "inout")
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

/** The layouts a struct's derives are read from — `values.ts` `Layouts`, by upper-cased name. */
type LayoutsOf = ReadonlyMap<string, { layout: IrLayout }>

/** The fields a layout's struct is built from — an FB's or a STRUCT's own. */
const fieldsOf = (layouts: LayoutsOf, t: Type): readonly { type: Type }[] | undefined =>
  t.kind === "struct" || t.kind === "function_block" ? layouts.get(t.name.toUpperCase())?.layout.fields : undefined

/** Whether the emitted Rust for this type is `Copy` — every scalar the printer emits, an array exactly when its element
 *  is, and a DUT STRUCT whose every field is (it derives `Copy`, lean 7.8.1: `structs.ts`). An FB instance never is: it
 *  is an instance with a body, copied only where the ST copies it, by `.clone()`. */
export function isCopy(t: Type, layouts: LayoutsOf): boolean {
  if (t.kind === "array") return isCopy(t.element, layouts)
  if (t.kind === "struct") return fieldsOf(layouts, t)?.every((f) => isCopy(f.type, layouts)) === true
  return t.kind === "elementary" || t.kind === "pointer" || t.kind === "reference" || t.kind === "interface"
}

/** Whether the emitted Rust for this type is `Eq` — no REAL/LREAL in it, to any depth (lean 7.8.1): a string's
 *  `IecStr` is (`runtime/string.ts`), a struct or FB whose every field is. */
export function isEq(t: Type, layouts: LayoutsOf): boolean {
  if (t.kind === "array") return isEq(t.element, layouts)
  const fields = fieldsOf(layouts, t)
  if (fields !== undefined) return fields.every((f) => isEq(f.type, layouts))
  return t.kind !== "elementary" || floatBits(t) === undefined
}
