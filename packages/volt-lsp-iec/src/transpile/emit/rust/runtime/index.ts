/**
 * THE RUNTIME REGISTRY — every Rust helper the emitted code may call, by id, with the helpers its text calls (`deps`) and
 * the text the module prints. `runtime/<model>.ts` mirrors `semantics/<model>.ts`; the twin harness
 * (`test/conformance/runtime-twins.test.ts`) runs the shared case tables against both.
 *
 * ON DEMAND (lean 1, task 7.1.2): the printer records each helper it prints a call of (`use` in `printer.ts`), and the module
 * prints the dependency closure of what was recorded (`closure`) — nothing the program does not call. The STRING family
 * (`FRONT`: the string type, MAX/MIN over a string, the formatters, the parsers) is printed IN FRONT of the code, in
 * registry order, as the string prelude always was; every other helper after the code, in `BACK` order.
 */
import { IEC_DIV, IEC_FMAX, IEC_FMIN, IEC_LOG, IEC_MAX, IEC_MIN, IEC_POW, IEC_R2I32, IEC_R2I64 } from "./numeric.js"
import { IEC_PARSE_INT, IEC_PARSE_REAL } from "./parse.js"
import { IEC_DEREF, IEC_IX, MEM, MEM_AT, MEM_LD, MEM_LD_BOOL, MEM_ORDER, MEM_REGION, MEM_ST } from "./pointer.js"
import { IEC_STR } from "./string.js"
import {
  IEC_CIVIL,
  IEC_DATE_TEXT,
  IEC_DT_TEXT,
  IEC_LCLOCK,
  IEC_LDATE_TEXT,
  IEC_LDT_TEXT,
  IEC_LREAL_TEXT,
  IEC_LTIME_TEXT,
  IEC_LTOD_TEXT,
  IEC_TIME_TEXT,
  IEC_TOD_TEXT,
} from "./text.js"

/** Every helper, in the order the module prints it: the front ones first, then the back ones. */
const HELPERS = {
  // ── FRONT: the string family ──
  string: { deps: [], rust: IEC_STR },
  iec_max: { deps: [], rust: IEC_MAX },
  iec_min: { deps: [], rust: IEC_MIN },
  iec_lreal_text: { deps: [], rust: IEC_LREAL_TEXT },
  iec_time_text: { deps: [], rust: IEC_TIME_TEXT },
  iec_ltime_text: { deps: [], rust: IEC_LTIME_TEXT },
  iec_civil: { deps: [], rust: IEC_CIVIL },
  iec_date_text: { deps: ["iec_civil"], rust: IEC_DATE_TEXT },
  iec_dt_text: { deps: ["iec_civil"], rust: IEC_DT_TEXT },
  iec_tod_text: { deps: [], rust: IEC_TOD_TEXT },
  iec_lclock: { deps: [], rust: IEC_LCLOCK },
  iec_ldt_text: { deps: ["iec_civil", "iec_lclock"], rust: IEC_LDT_TEXT },
  iec_ldate_text: { deps: ["iec_civil"], rust: IEC_LDATE_TEXT },
  iec_ltod_text: { deps: ["iec_lclock"], rust: IEC_LTOD_TEXT },
  iec_parse_real: { deps: [], rust: IEC_PARSE_REAL },
  iec_parse_int: { deps: [], rust: IEC_PARSE_INT },
  // ── BACK ──
  iec_deref: { deps: [], rust: IEC_DEREF },
  iec_r2i64: { deps: [], rust: IEC_R2I64 },
  iec_r2i32: { deps: [], rust: IEC_R2I32 },
  iec_fmax: { deps: [], rust: IEC_FMAX },
  iec_fmin: { deps: [], rust: IEC_FMIN },
  iec_log: { deps: [], rust: IEC_LOG },
  iec_pow: { deps: [], rust: IEC_POW },
  iec_div: { deps: [], rust: IEC_DIV },
  mem: { deps: ["mem_ld", "mem_st"], rust: MEM },
  mem_region: { deps: [], rust: MEM_REGION },
  mem_at: { deps: ["mem_region"], rust: MEM_AT },
  mem_ld: { deps: ["mem_at"], rust: MEM_LD },
  mem_ld_bool: { deps: ["mem_ld"], rust: MEM_LD_BOOL },
  mem_st: { deps: ["mem_at"], rust: MEM_ST },
  mem_order: { deps: ["mem_region"], rust: MEM_ORDER },
  iec_ix: { deps: [], rust: IEC_IX },
} as const satisfies Record<string, { deps: readonly string[]; rust: string }>

/** One registry helper. */
export type RuntimeId = keyof typeof HELPERS

const ORDER = Object.keys(HELPERS) as RuntimeId[]
/** The string family, printed in front of the code (the string prelude), in registry order. */
export const FRONT: readonly RuntimeId[] = ORDER.slice(0, ORDER.indexOf("iec_deref"))
/** Every other helper, printed after the code, in registry order. */
export const BACK: readonly RuntimeId[] = ORDER.slice(ORDER.indexOf("iec_deref"))

/** `ids` and every helper they reach through `deps`, in registry order. */
export function closure(ids: Iterable<RuntimeId>): RuntimeId[] {
  const reached = new Set<RuntimeId>()
  const reach = (id: RuntimeId): void => {
    if (reached.has(id)) return
    reached.add(id)
    for (const dep of HELPERS[id].deps) reach(dep)
  }
  for (const id of ids) reach(id)
  return ORDER.filter((id) => reached.has(id))
}

/** The text of `ids`' closure, each helper's whole Rust items in registry order — what the module prints for them. */
export function runtimeText(...ids: RuntimeId[]): string {
  return closure(ids)
    .map((id) => HELPERS[id].rust)
    .join("")
}

/** One helper's own Rust items, without what it calls. */
export const helperText = (id: RuntimeId): string => HELPERS[id].rust

/** The ids the registry knows a helper's text of — every name `runtimeText` and `use` take. */
export const RUNTIME_IDS: readonly RuntimeId[] = ORDER

/**
 * How many lines at the start of `code` are the front runtime it was printed with: the FRONT helpers' texts, each once,
 * in registry order — the string prelude a shape or a size leaves out (test support reads it; the emitter never does).
 */
export function frontLines(code: string): number {
  let at = 0
  for (const id of FRONT) if (code.startsWith(HELPERS[id].rust, at)) at += HELPERS[id].rust.length
  return code.slice(0, at).split("\n").length - 1
}

/** `code` without the registry text it was printed with, wherever printed — what the map's `size` counts (7.1.4). */
export function withoutRuntime(code: string): string {
  return ORDER.reduce((rest, id) => rest.replace(HELPERS[id].rust, ""), code)
}

/** Every top-level Rust item name the registry can print (`fn iec_div`, `struct Mem`, `type IecString`, `const IMAGE_BASE`,
 *  …) — names a user FUNCTION's free fn cannot take beside them (`names.ts` `baseFnName`, 7.1.5). */
export const RUNTIME_ITEMS: ReadonlySet<string> = new Set(
  RUNTIME_IDS.flatMap((id) => [...HELPERS[id].rust.matchAll(/^(?:pub )?(?:fn|struct|type|const|enum|trait) (\w+)/gm)].map((m) => m[1]!)),
)
