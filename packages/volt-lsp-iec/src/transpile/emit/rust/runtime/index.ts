/**
 * THE RUNTIME REGISTRY — every Rust helper the emitted code may call, by id, with the helpers it brings along (`deps`) and
 * the text the module appends. `runtime/<model>.ts` mirrors `semantics/<model>.ts`; the twin harness
 * (`test/conformance/runtime-twins.test.ts`) runs the shared case tables against both.
 *
 * Phase 1 reproduces the emitter's gating exactly (design.md §2.6): the `string` blob — the string type, MAX/MIN over a
 * string, the formatters and the parsers, in that order — goes IN FRONT of a program whose code names `IecStr` or
 * `IecWString`; every other helper is appended after the code when the code calls it (`usedBy`), in `INLINE` order. Lean 1
 * (task 7.1.2) replaces the sniffing with `use(id)` and the dependency closure.
 */
import { IEC_DIV, IEC_FMAX, IEC_FMIN, IEC_LOG, IEC_MAX_MIN, IEC_POW, IEC_R2I32, IEC_R2I64 } from "./numeric.js"
import { PARSE } from "./parse.js"
import { IEC_DEREF } from "./pointer.js"
import { IEC_STR } from "./string.js"
import { TEXT } from "./text.js"

type RuntimeId =
  | "string"
  | "iec_max_min"
  | "text"
  | "parse"
  | "iec_deref"
  | "iec_r2i64"
  | "iec_r2i32"
  | "iec_fmax"
  | "iec_fmin"
  | "iec_log"
  | "iec_pow"
  | "iec_div"

interface RuntimeHelper {
  readonly id: RuntimeId
  /** The helpers its text is followed by, in order — the string blob's three riders. */
  readonly deps: readonly RuntimeId[]
  /** Its own Rust items, each line as printed, ending in a newline. */
  readonly rust: string
  /** The texts whose presence in the printed code appends it (phase 1's gating). */
  readonly usedBy: readonly string[]
}

const HELPERS: Readonly<Record<RuntimeId, RuntimeHelper>> = {
  string: { id: "string", deps: ["iec_max_min", "text", "parse"], rust: IEC_STR, usedBy: ["IecStr", "IecWString"] },
  iec_max_min: { id: "iec_max_min", deps: [], rust: IEC_MAX_MIN, usedBy: [] },
  text: { id: "text", deps: [], rust: TEXT, usedBy: [] },
  parse: { id: "parse", deps: [], rust: PARSE, usedBy: [] },
  iec_deref: { id: "iec_deref", deps: [], rust: IEC_DEREF, usedBy: ["iec_deref("] },
  iec_r2i64: { id: "iec_r2i64", deps: [], rust: IEC_R2I64, usedBy: ["iec_r2i64("] },
  iec_r2i32: { id: "iec_r2i32", deps: [], rust: IEC_R2I32, usedBy: ["iec_r2i32("] },
  iec_fmax: { id: "iec_fmax", deps: [], rust: IEC_FMAX, usedBy: ["iec_fmax("] },
  iec_fmin: { id: "iec_fmin", deps: [], rust: IEC_FMIN, usedBy: ["iec_fmin("] },
  iec_log: { id: "iec_log", deps: [], rust: IEC_LOG, usedBy: ["iec_log("] },
  iec_pow: { id: "iec_pow", deps: [], rust: IEC_POW, usedBy: ["iec_pow("] },
  iec_div: { id: "iec_div", deps: [], rust: IEC_DIV, usedBy: ["iec_div("] },
}

/** The helpers appended AFTER the code, each when the code calls it — in this order, each one asked of the code as it stands
 *  after the ones before it were appended. */
export const INLINE: readonly RuntimeId[] = ["iec_deref", "iec_r2i64", "iec_r2i32", "iec_fmax", "iec_fmin", "iec_log", "iec_pow", "iec_div"]

/** A helper's text followed by its deps' — `runtimeText("string")` is the blob a string program starts with. */
export function runtimeText(id: RuntimeId): string {
  const helper = HELPERS[id]
  return helper.rust + helper.deps.map(runtimeText).join("")
}

/** Whether `code` calls the helper (phase 1's sniffing). */
export function usedIn(id: RuntimeId, code: string): boolean {
  return HELPERS[id].usedBy.some((text) => code.includes(text))
}
