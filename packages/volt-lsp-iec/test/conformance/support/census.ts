/**
 * THE TOPIC TREE, DERIVED FROM THE LANGUAGE — the one definition, shared by the report and the gate.
 *
 * A CELL is one question: `(topic, subtopic, case)`, e.g. `operators / unary minus / operand is LWORD`. Its axes come
 * from somewhere that is not the fixture set — the elementary-type table, the operator table, the vendor's own
 * reference — so **a cell nobody thought of still has a node**, which is the whole point. Grouping the fixtures we
 * happen to have would reproduce exactly the blind spots this exists to find.
 *
 * Each entry names the slugs it expects. The families that fill them generate their slugs from the same axes, so a
 * cell and its fixture cannot drift apart without one of them going missing — and `census.test.ts` says which.
 *
 * `PLANNED` is the other half, and the more honest one: topics whose cells are NOT enumerated yet. They are listed
 * by name so the report can say how much of the language is still unmeasured, instead of a green tick meaning
 * "nobody has written a cell for that".
 */
import { ELEMENTARY_TYPES } from "../../../src/types/elementary.js"
import type { LanguageTest } from "../types.js"

export interface Cell {
  topic: string
  subtopic: string
  /** The fixture slug that answers it. */
  slug: string
}

const lower = (s: string): string => s.toLowerCase()

/** Every primitive the VENDOR lists, including the three platform-portable ones. */
const PRIMITIVES = [...ELEMENTARY_TYPES.keys()]
/** Every type with an exact integer range — the ones an edge means something for. */
const RANGED = [...ELEMENTARY_TYPES.values()].filter((t) => t.range !== undefined)
/** Arithmetic types: ranged, minus the two that hold a single bit. */
const INTEGERS = RANGED.filter((t) => t.name !== "BOOL" && t.name !== "BIT")
/** The destinations a real converts into. */
const REAL_DESTS = INTEGERS

/** The operand pairs the meet is asked of — kept here so the cell list and `operators/mixed-type.ts` cannot drift. */
const MEET_PAIRS: readonly [string, string][] = [
  ["SINT", "USINT"], ["INT", "UINT"], ["DINT", "UDINT"], ["LINT", "ULINT"],
  ["USINT", "SINT"], ["UINT", "INT"], ["UDINT", "DINT"], ["ULINT", "LINT"],
  ["BYTE", "SINT"], ["WORD", "INT"], ["DWORD", "DINT"], ["LWORD", "LINT"],
  ["BYTE", "USINT"], ["WORD", "UINT"],
  ["SINT", "DINT"], ["DINT", "SINT"], ["INT", "LINT"], ["USINT", "LINT"], ["ULINT", "SINT"],
  ["INT", "REAL"], ["REAL", "INT"], ["DINT", "LREAL"], ["LINT", "REAL"], ["ULINT", "LREAL"],
  ["REAL", "LREAL"], ["LREAL", "REAL"],
  ["BYTE", "WORD"], ["WORD", "DWORD"], ["BYTE", "LWORD"], ["BYTE", "BYTE"],
  ["BYTE", "DINT"], ["DWORD", "SINT"], ["DWORD", "USINT"], ["DWORD", "REAL"], ["BOOL", "INT"],
]

function cells(topic: string, subtopic: string, slugs: readonly string[]): Cell[] {
  return slugs.map((slug) => ({ topic, subtopic, slug }))
}

export const CELLS: readonly Cell[] = [
  // ── types ────────────────────────────────────────────────────────────────────────────────────
  ...cells(
    "types",
    "the value with no initializer",
    PRIMITIVES.map((p) => `prim_default_${lower(p).replace(/^__/, "x_")}`),
  ),
  ...cells(
    "types",
    "initialized at and past each edge",
    RANGED.flatMap((t) => ["at_min", "at_max", "below_min", "above_max"].map((e) => `bound_${lower(t.name)}_${e}`)),
  ),
  ...cells(
    "types",
    "the platform-portable integers",
    ["xint", "uxint", "xword"].flatMap((t) =>
      ["into_string", "into_dint", "into_lint", "sizeof", "meet_dint", "at_max"].map((k) => `plat_${t}_${k}`),
    ),
  ),

  // ── operators ────────────────────────────────────────────────────────────────────────────────
  ...cells(
    "operators",
    "unary minus, per operand type",
    ["sint", "usint", "int", "uint", "dint", "udint", "lint", "ulint", "byte", "word", "dword", "lword", "real", "lreal", "ltime", "date", "tod", "dt", "wstring", "string_into_int", "time_into_string"].map(
      (t) => `uop_neg_${t}`,
    ),
  ),
  ...cells(
    "operators",
    "NOT, per operand type",
    ["bool", "byte", "word", "dword", "lword", "sint", "int", "dint", "udint", "lint", "real", "time", "date", "wstring"].map(
      (t) => `uop_not_${t}`,
    ),
  ),
  ...cells(
    "operators",
    "over the edge at run time, per integer type",
    INTEGERS.flatMap((t) => {
      const base = ["add_over", "sub_under", "mul_over", "div_by_zero", "mod_by_zero"]
      return [...base, ...(t.signed === true ? ["div_min_by_minus_one"] : [])].map((k) => `arithedge_${lower(t.name)}_${k}`)
    }),
  ),
  ...cells(
    "operators",
    "comparison across signedness, all six operators",
    ["sint", "int", "dint", "lint"].flatMap((t) => ["eq", "ne", "lt", "gt", "le", "ge"].map((op) => `cmp_sign_${t}_${op}`)),
  ),
  ...cells(
    "operators",
    "comparison against a NaN and an infinity",
    ["nan_self", "nan_number", "inf_number"].flatMap((k) => ["eq", "ne", "lt", "gt", "le", "ge"].map((op) => `cmp_${k}_${op}`)),
  ),
  ...cells(
    "operators",
    "AND / OR / XOR, per type",
    ["byte", "word", "dword", "lword", "sint", "int", "dint", "lint", "usint", "uint", "udint", "ulint", "bool"].flatMap(
      (t) => ["and", "or", "xor"].map((op) => `bit_${op}_${t}`),
    ),
  ),
  ...cells(
    "operators",
    "the four shifts, at and past the width",
    ([["byte", 8], ["word", 16], ["dword", 32], ["lword", 64]] as [string, number][]).flatMap(([t, w]) =>
      ["shl", "shr", "rol", "ror"].flatMap((op) => [0, 1, w - 1, w, w + 1].map((c) => `bit_${op}_${t}_${c}`)),
    ),
  ),

  ...cells(
    "operators",
    "the meet of two different operand types, all five arithmetic operators",
    MEET_PAIRS.flatMap(([l, r]) =>
      ["plus", "minus", "times", "div", "mod"].map((op) => `meet_${lower(l)}_${op}_${lower(r)}`),
    ),
  ),

  // ── conversions ──────────────────────────────────────────────────────────────────────────────
  ...cells(
    "conversions",
    "REAL and LREAL into every integer type, out of range",
    ["real", "lreal"].flatMap((r) =>
      REAL_DESTS.flatMap((d) =>
        ["above_max", "below_min", "nan", "pos_inf", "neg_inf"].map((k) => `r2i_${r}_to_${lower(d.name)}_${k}`),
      ),
    ),
  ),
  ...cells(
    "conversions",
    "every ordered pair of integer types, carrying a value the destination may not hold",
    INTEGERS.flatMap((src) =>
      INTEGERS.filter((d) => d.name !== src.name).flatMap((dst) => {
        const base = [`i2i_${lower(src.name)}_to_${lower(dst.name)}_from_max`]
        return src.range!.min < 0n ? [...base, `i2i_${lower(src.name)}_to_${lower(dst.name)}_from_min`] : base
      }),
    ),
  ),
  ...cells(
    "conversions",
    "every integer type into both floating widths, where the mantissa runs out",
    INTEGERS.flatMap((src) =>
      ["real", "lreal"].flatMap((r) =>
        (src.range!.min < 0n ? ["max", "min"] : ["max"]).map((e) => `i2r_${lower(src.name)}_to_${r}_${e}`),
      ),
    ),
  ),
  ...cells(
    "conversions",
    "which way a conversion rounds, and that TRUNC does not",
    ["real", "lreal"].flatMap((r) =>
      ["half_pos_0", "half_pos_1", "half_pos_2", "half_pos_3", "half_neg_0", "half_neg_1", "half_neg_2", "half_neg_3", "below_half", "above_half", "neg_below_half", "neg_above_half"].flatMap(
        (v) => [`round_${r}_to_int_${v}`, `round_${r}_trunc_${v}`],
      ),
    ),
  ),
  ...cells(
    "conversions",
    "the magnitude ladder that settles where wrapping stops",
    ["int", "dint", "lint"].flatMap((d) =>
      Array.from({ length: 12 }, (_, i) => i).flatMap((i) => [
        `r2ilad_${d}_pos_${String(i).padStart(2, "0")}`,
        `r2ilad_${d}_neg_${String(i).padStart(2, "0")}`,
      ]),
    ),
  ),
]

/**
 * Topics whose cells are NOT enumerated above. Listed so the report can say how much of the language is still
 * unmeasured — a topic missing from BOTH lists is the failure mode this whole file exists to prevent.
 *
 * `openspec/changes/fixture-census/operations.md` is the long form, with why each one matters.
 */
export const PLANNED: readonly string[] = [
  "conversions / TIME, DATE and STRING across families",
  "declarations / VAR section x type category x initializer form",
  "declarations / RETAIN, PERSISTENT, CONSTANT and direct addresses",
  "calls / callee kind x argument form",
  "selection / MIN, MAX, LIMIT, SEL and MUX, per type and mixed",
  "strings / LEN, LEFT, RIGHT, MID, CONCAT, INSERT, DELETE, REPLACE and FIND at their edges",
  "strings / STRING(n) truncation, escapes and non-ASCII",
  "statements / every statement kind at its edges",
]

/** A cell is CLOSED when its fixture exists and the vendor has answered it. */
export function closure(all: readonly LanguageTest[]): {
  closed: Cell[]
  missing: Cell[]
  unanswered: Cell[]
} {
  const byName = new Map(all.map((t) => [t.name, t]))
  const closed: Cell[] = []
  const missing: Cell[] = []
  const unanswered: Cell[] = []
  for (const cell of CELLS) {
    const fixture = byName.get(cell.slug)
    if (fixture === undefined) missing.push(cell)
    else if (fixture.evidence === undefined || fixture.evidence === "unasked") unanswered.push(cell)
    else closed.push(cell)
  }
  return { closed, missing, unanswered }
}
