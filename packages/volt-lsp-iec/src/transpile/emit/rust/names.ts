/**
 * THE NAMES THE EMITTED RUST USES — a POU's struct name, a slot's field, a routine's fn, the `g`/`prg` parameters every
 * generated body takes, and the reserved `__` temporaries. Each is decided here once, so a definition and every use of it
 * read the same answer.
 */
import type { IrPou, IrRoutine, IrStmt } from "../../ir/index.js"
import { isPlace, someNode } from "../../ir/walk.js"
import { RUNTIME_ITEMS } from "./runtime/index.js"

/** Which of the two global structs a program reaches: `Globals` (as `g`) and `Programs` (as `prg`). */
export interface GlobalsUse {
  readonly usesGlobals: boolean
  readonly usesPrograms: boolean
  readonly usesImage?: boolean
}

/**
 * EVERY PURPOSE A PRINTER TEMPORARY IS NAMED FOR — the INTERNAL temp list of `index.ts`'s surface doc is this table, so
 * a new temporary is a new row here (`tmp` takes nothing else). The lowering's own temps are `__<purpose>_<slot>`
 * fields and locals (`lower/core/temps.ts`).
 */
export const TEMP_PURPOSES = {
  arg: "a call's input, hoisted when the inputs are taken in a stated order (`__arg_<k>`)",
  back: "a call's result, held while its in-out copies are written back",
  copy: "a copied in-out argument, written back after the call (`__copy_<i>`)",
  lent: "a lent place a routine takes as a parameter (`__lent_<i>`)",
  program: "a PROGRAM instance moved out of `prg` for the call into it",
  result: "the value of a call into a moved-out PROGRAM",
  mod_l: "MOD's left operand, read once",
  mod_r: "MOD's right operand, read once and tested for 0",
  rot: "ROL/ROR's operand, read once",
  bit_v: "the value stored into a bit, read once",
  bit_w: "the integer a bit is stored into",
  guard: "a harness's loop guard counter (`__guard_<n>`)",
  mem: "the byte image (`image.ts`)",
  a: "an image address, read once",
  v: "a value stored into the image, read once",
  w: "the image word a bit is stored into",
  k: "an array index while an image array is loaded or stored (`__k_<depth>`)",
  e: "an array element while an image array is stored (`__e_<depth>`)",
  array: "an array initial value built from a repeat and a store per stated element (`values.ts` `initOf`)",
} as const

/** One purpose of `TEMP_PURPOSES`. */
type TempPurpose = keyof typeof TEMP_PURPOSES

/**
 * A generated temporary: `__<purpose>`, or `__<purpose>_<n>` for a numbered one (`__arg_0`, `__copy_1`, `__lent_0`,
 * `__guard_3`). The reserved prefix is what keeps it apart from every name a user declares — no ST identifier starts
 * with two underscores — which a routine's parameters and VAR_TEMPs need, as Rust locals in the same scope.
 */
export function tmp(purpose: TempPurpose, n?: number | bigint): string {
  return n === undefined ? `__${purpose}` : `__${purpose}_${n}`
}

/** A POU's or DUT's Rust struct name: the ST name as written, so a reader finds `FB_Conveyor` under its own name
 *  (the structs carry `#[allow(non_camel_case_types)]`). */
export function rustName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_")
}

/**
 * ST names are PascalCase/mixed; Rust fields are snake_case. Mechanical, and stable across runs.
 *
 * A HIDDEN name — the clock `__clock`, a cursor's `__str_P` — keeps its leading double underscore. No ST identifier can
 * have one, so no variable a user declares can snake to the same field; collapsed to one underscore, `__clock` became
 * `_clock`, and a GVL variable of that (legal) name stopped every program that calls TIME() from emitting.
 */
export function snake(name: string): string {
  const snaked = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase()
  return name.startsWith("__") ? `_${snaked}` : snaked
}

/** Rust's keywords (strict and reserved, 2021) — a field named one does not compile. */
const RUST_KEYWORDS: ReadonlySet<string> = new Set(
  (
    "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub " +
    "ref return self static struct super trait true type unsafe use where while abstract become box do final macro " +
    "override priv try typeof unsized virtual yield"
  ).split(" "),
)

/**
 * Each slot's Rust field name, in frame order: snake_case, a Rust keyword suffixed `_`, and unique within the POU. The
 * bare `snake` was the field name, so a variable named `loop` emitted `pub loop: i16` and `aB` beside `a_b` emitted
 * two `a_b` fields — neither compiles, and no oracle case held such a name (transpiler review 2026-09-14).
 */
export function fieldNames(slots: IrPou["slots"], reserved: readonly string[] = [], internal = false): string[] {
  const used = new Set<string>(reserved)
  return slots.map((slot) => {
    const snaked = snake(slot.name)
    const base = RUST_KEYWORDS.has(snaked) ? `${snaked}_` : snaked
    // A CONTRACT NAME IS NOT RENUMBERED. The dedupe below numbers by FRAME POSITION, so the FIRST slot with a given
    // snake name keeps it and later ones take `_2`, `_3` — which means declaring a new VAR ahead of an existing one
    // would rename the EXISTING one's Rust field, and a harness written against `p.my_val` breaks on an ST edit that
    // has nothing to do with it. A field is part of the emitted surface (`emit/rust/index.ts`), so it cannot move
    // under a user like that.
    //
    // Two distinct ST names snaking to one Rust name is genuinely ambiguous, and it does not happen: ZERO of the 784
    // POUs the fixtures build take a suffix. So it is refused rather than silently resolved — a loud stop on a shape
    // nobody writes beats a quiet rename on a shape everybody does.
    if (!internal && used.has(base))
      throw new Error(`emit: ${slot.name} and another variable both become the Rust field \`${base}\`, which the emitted surface cannot distinguish`)
    let name = base
    for (let n = 2; used.has(name); n++) name = `${base}_${n}`
    used.add(name)
    return name
  })
}

/** `g` and `prg` before a generated call's arguments, as far as the program has them. */
export function globalsArgs(uses: GlobalsUse): string[] {
  return [...(uses.usesGlobals ? ["g"] : []), ...(uses.usesPrograms ? ["prg"] : []), ...(uses.usesImage === true ? ["__mem"] : [])]
}

/**
 * WHAT EACH GENERATED BODY REACHES (lean 7.7.5): `g`, `prg` and `__mem` are handed only to the bodies that use them —
 * their own places (a GVL variable, a PROGRAM instance, a byte in the image) or a call of a body that does, to any
 * depth — not to every body because the program has them. Keyed by routine key, and `layout:<NAME>` for an FB's or a
 * called PROGRAM's body; each within the program's own (`program`).
 */
export function reachOf(pou: IrPou, program: GlobalsUse): ReadonlyMap<string, GlobalsUse> {
  const bodies = new Map<string, readonly IrStmt[]>([
    ...pou.routines.map((r) => [r.key, r.body] as const),
    ...pou.layouts.flatMap((l) => (l.body === undefined ? [] : [[`layout:${l.name.toUpperCase()}`, l.body] as const])),
  ])
  const direct = new Map<string, { usesGlobals: boolean; usesPrograms: boolean; usesImage: boolean; calls: Set<string> }>()
  for (const [key, body] of bodies) {
    const use = { usesGlobals: false, usesPrograms: false, usesImage: false, calls: new Set<string>() }
    someNode(body, (n) => {
      if (isPlace(n)) {
        if (n.root === "global") {
          if (pou.globals[n.slot]?.section === "program") use.usesPrograms = true
          else use.usesGlobals = true
        }
        if (n.root === "image") use.usesImage = true
      } else if (n.kind === "invoke") use.calls.add(n.routine)
      else if (n.kind === "call") use.calls.add(`layout:${n.fb.toUpperCase()}`)
      return false
    })
    direct.set(key, use)
  }
  // to a fixed point: a body reaches what every body it calls reaches
  for (let changed = true; changed; ) {
    changed = false
    for (const use of direct.values())
      for (const callee of use.calls) {
        const of = direct.get(callee)
        if (of === undefined) continue
        for (const k of ["usesGlobals", "usesPrograms", "usesImage"] as const)
          if (of[k] && !use[k]) {
            use[k] = true
            changed = true
          }
      }
  }
  return new Map(
    [...direct].map(([key, u]) => [key, { usesGlobals: u.usesGlobals && program.usesGlobals, usesPrograms: u.usesPrograms && program.usesPrograms, usesImage: u.usesImage && program.usesImage === true }]),
  )
}

/** The parameters every generated body declares for them — the same list as `globalsArgs`, typed. */
export function globalsParams(uses: GlobalsUse): string[] {
  return [...(uses.usesGlobals ? ["g: &mut Globals"] : []), ...(uses.usesPrograms ? ["prg: &mut Programs"] : []), ...(uses.usesImage === true ? ["__mem: &mut Mem"] : [])]
}

/**
 * Names an inherent `&mut self` fn cannot take: the ones the emitter generates itself (`new`, `call`, `scan`), and
 * every trait method in scope on the emitted struct that takes `self` or `&self`. Rust's method lookup tries `T` and
 * `&T` before `&mut T`, so such a trait method WINS over a user METHOD of the same name: `b.clone()` is the derived
 * Clone (E0308 with a result; without one it compiles and silently runs the clone — transpile-review 29). The struct
 * derives Clone, and the prelude's blanket impls add ToOwned (`to_owned`, `clone_into`), Into and TryInto. The
 * derived PartialEq's `eq`/`ne` would collide too, but EQ and NE are standard functions no METHOD can be named.
 */
const RESERVED_FN_NAMES: ReadonlySet<string> = new Set(["new", "call", "scan", "clone", "to_owned", "clone_into", "into", "try_into"])

/** A routine's Rust fn name BEFORE deduping: snake_case, with a keyword or a reserved name suffixed `_` — and a FUNCTION's,
 *  a free fn beside the runtime's, suffixed when it names a runtime item: a user FUNCTION `iec_div` printed a second
 *  `fn iec_div` beside the zero-divisor check (E0428; 7.1.5, was appendix 6.A.7). */
function baseFnName(routine: IrRoutine): string {
  const snaked = snake(routine.name.slice(routine.name.lastIndexOf(".") + 1))
  const reserved = RUST_KEYWORDS.has(snaked) || RESERVED_FN_NAMES.has(snaked) || (routine.kind === "function" && RUNTIME_ITEMS.has(snaked))
  return reserved ? `${snaked}_` : snaked
}

/**
 * EVERY ROUTINE'S Rust fn name, deduped across the whole POU — one map, computed once, so the definition and
 * every call site read the SAME answer.
 *
 * `snake` is not injective and ST member names do not have to differ by more than punctuation: a METHOD `DoIt`
 * and a METHOD `Do_It` in one FB are two distinct members that both snake to `do_it`, and the emitter printed
 * TWO `pub fn do_it` into one impl block — E0592, with zero lowering diagnostics, on ST CODESYS compiles. It
 * could not have been fixed inside the old per-routine function, which sees one routine and cannot know what
 * else claimed the name.
 *
 * Deduped in ROUTINE ORDER (`pou.routines`, which is declaration order), because a suffix that moves when an
 * unrelated member is added is the `fieldNames` hazard one file over — a rename nobody asked for, in generated
 * code somebody may be reading.
 */
export function routineFnNames(routines: readonly IrRoutine[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  // scoped per impl block: two FBs may each have a `do_it` and never collide
  const used = new Map<string, Set<string>>()
  for (const routine of routines) {
    const scope = routine.fb?.toUpperCase() ?? (routine.kind === "function" ? "(functions)" : "(program)")
    const taken = used.get(scope) ?? new Set<string>()
    used.set(scope, taken)
    const base = baseFnName(routine)
    let name = base
    for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
    taken.add(name)
    out.set(routine.key, name)
  }
  return out
}
