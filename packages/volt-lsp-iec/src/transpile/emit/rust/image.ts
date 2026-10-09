/**
 * THE BYTE IMAGE AS RUST (model 3, design.md §3.3 step 4d) — an `image` place's address, a load and a store through
 * `Mem` (`runtime/pointer.ts`), and the program's own `Mem::new()` built from the image lowering laid out. Every value
 * moves as its little-endian bytes, so a REAL read over a DINT's bytes keeps every bit, as CODESYS keeps them.
 */
import type { IrImage, IrPou, Place } from "../../ir/index.js"
import { isBoolValued, peelArray, type Type } from "../../../frontend/types/index.js"
import { castTo } from "./convert.js"
import { expr, unparen } from "./expr.js"
import { rustName, tmp } from "./names.js"
import type { Printer } from "./printer.js"
import { rustType } from "./types.js"

/** The `Mem` every generated body is handed when the program has an image. */
export const MEM = tmp("mem")

/** The byte address an `image` place reaches: its `at`, then each index step checked and scaled (`iec_ix`). */
export function imageAddress(p: Printer, at: Place, slots: IrPou["slots"]): string {
  let text = unparen(expr(p, at.at!, slots))
  for (const step of at.path) {
    if (step.kind !== "index") continue
    const index = unparen(castTo(expr(p, step.index, slots), step.index.type, "i64"))
    text = `iec_ix(${text}, ${index}, ${step.lower}i64, ${step.length}, ${step.size})`
  }
  return text
}

/** The bytes of a type the image holds. */
function sizeOf(p: Printer, t: Type): number {
  if (t.kind === "struct") return p.layouts.get(t.name.toUpperCase())!.layout.size!
  const array = peelArray(t)
  if (array !== undefined) return sizeOf(p, array.element) * array.length
  if (isBoolValued(t)) return 1
  return t.kind === "elementary" ? t.elem.bits / 8 : 0
}

/** `k` elements of `size` bytes — `k` alone for a byte (`k * 1` is `clippy::identity_op`). */
const scaled = (k: string, size: number): string => (size === 1 ? k : `${k} * ${size}`)

/** A value of `t` read from the address `a` (a Rust expression read once per use — callers bind it first). */
function loadAt(p: Printer, t: Type, a: string, depth: number): string {
  // a BOOL is any byte but 0 — read by `ld_bool`, so `NOT` over it prints `!` and no comparison (`clippy::nonminimal_bool`)
  if (isBoolValued(t)) return `${MEM}.ld_bool(${a})`
  if (t.kind === "elementary") return `${rustType(t)}::from_le_bytes(${MEM}.ld(${a}))`
  const array = peelArray(t)
  if (array !== undefined) {
    const k = tmp("k", depth)
    return `std::array::from_fn::<${rustType(array.element)}, ${array.length}, _>(|${k}| ${loadAt(p, array.element, `${a} + ${scaled(k, sizeOf(p, array.element))}`, depth + 1)})`
  }
  const entry = p.layouts.get(t.kind === "struct" ? t.name.toUpperCase() : "")!
  const fields = entry.layout.fields.map((f, i) => `${entry.fields[i]}: ${loadAt(p, f.type, `${a} + ${f.image!}`, depth)}`)
  return `${rustName(entry.layout.name)} { ${fields.join(", ")} }`
}

/** Statements storing the value `v` of `t` at the address `a`. */
function storeAt(p: Printer, t: Type, a: string, v: string, depth: number): string {
  if (isBoolValued(t)) return `${MEM}.st(${a}, [u8::from(${v})]);`
  if (t.kind === "elementary") return `${MEM}.st(${a}, ${v}.to_le_bytes());`
  const array = peelArray(t)
  if (array !== undefined) {
    const [k, e] = [tmp("k", depth), tmp("e", depth)]
    return `for (${k}, ${e}) in ${v}.into_iter().enumerate() { ${storeAt(p, array.element, `${a} + ${scaled(k, sizeOf(p, array.element))}`, e, depth + 1)} }`
  }
  const entry = p.layouts.get(t.kind === "struct" ? t.name.toUpperCase() : "")!
  return entry.layout.fields.map((f, i) => storeAt(p, f.type, `${a} + ${f.image!}`, `${v}.${entry.fields[i]}`, depth)).join(" ")
}

/** A read of an `image` place: its value — or, through a trailing bit, that bit of its integer. */
export function loadImage(p: Printer, at: Place, slots: IrPou["slots"]): string {
  const bit = at.path.at(-1)
  const address = imageAddress(p, at, slots)
  if (bit?.kind === "bit") {
    const word = `${rustType(bit.of)}::from_le_bytes(${MEM}.ld(${address}))`
    return `((${bit.index === 0 ? word : `(${word} >> ${bit.index})`} & 1) != 0)`
  }
  if (at.type.kind === "elementary") return loadAt(p, at.type, address, 0)
  return `{ let ${tmp("a")} = ${address}; ${loadAt(p, at.type, tmp("a"), 0)} }`
}

/** A store of `value` into an `image` place, as one statement: the value first, then the address, as a plain store
 *  evaluates them — a trailing bit set or cleared in its integer. */
export function storeImage(p: Printer, at: Place, value: string, slots: IrPou["slots"]): string {
  const [v, a] = [tmp("v"), tmp("a")]
  const bit = at.path.at(-1)
  const head = `let ${v} = ${unparen(value)}; let ${a} = ${imageAddress(p, at, slots)};`
  if (bit?.kind === "bit") {
    const one = `(1${rustType(bit.of)} << ${bit.index})`
    const w = tmp("w")
    return `{ ${head} let ${w} = ${rustType(bit.of)}::from_le_bytes(${MEM}.ld(${a})); ${storeAt(p, bit.of, a, `(if ${v} { ${w} | ${one} } else { ${w} & !${one} })`, 0)} }`
  }
  return `{ ${head} ${storeAt(p, at.type, a, v, 0)} }`
}

/** The program's own `Mem::new()`: the image lowering laid out — its size, its initial bytes, its regions. */
export function memNew(image: IrImage): string[] {
  const bytes = image.bytes.map(([at, run]) => `(${at}, &[${run.join(", ")}])`).join(", ")
  const regions = image.regions.map(([s, e]) => `(${s}, ${e})`).join(", ")
  return [
    "impl Mem {",
    "    #[must_use]",
    "    pub fn new() -> Self {",
    `        Self::image(${image.size}, &[${bytes}], &[${regions}])`,
    "    }",
    "}",
    "",
    "impl Default for Mem {",
    "    fn default() -> Self {",
    "        Self::new()",
    "    }",
    "}",
  ]
}
