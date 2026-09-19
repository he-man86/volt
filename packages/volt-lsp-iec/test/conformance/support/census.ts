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

  ...cells(
    "operators",
    "MIN and MAX per type, and across two",
    [
      ...INTEGERS.flatMap((t) => [`sel_min_${lower(t.name)}`, `sel_max_${lower(t.name)}`]),
      ...([["INT", "UINT"], ["DINT", "UDINT"], ["SINT", "DINT"], ["INT", "REAL"], ["LINT", "REAL"], ["BYTE", "SINT"]] as [string, string][]).flatMap(
        ([l, r]) => [`sel_min_${lower(l)}_${lower(r)}`, `sel_max_${lower(l)}_${lower(r)}`],
      ),
    ],
  ),
  ...cells("operators", "LIMIT, including bounds the wrong way round", [
    "sel_limit_below", "sel_limit_inside", "sel_limit_above",
    "sel_limit_inverted_below", "sel_limit_inverted_between", "sel_limit_inverted_above",
  ]),
  ...cells("operators", "SEL both ways, and MUX past its last input", [
    "sel_sel_false", "sel_sel_true", "sel_mux_0", "sel_mux_1", "sel_mux_2", "sel_mux_3", "sel_mux_7",
  ]),

  ...cells(
    "conversions",
    "across the isolated families — durations, dates, text and truth",
    [
      ...["dint", "udint", "dword", "lint", "ulint", "lword", "int", "uint"].map((d) => `xf_time_to_${d}`),
      ...["dint", "udint", "lint", "ulint"].map((d) => `xf_ltime_to_${d}`),
      "xf_time_to_ltime", "xf_ltime_to_time", "xf_dint_to_time", "xf_dint_to_ltime",
      ...["date", "dt", "tod", "ldate", "ldt", "ltod"].flatMap((a) =>
        ["date", "dt", "tod", "ldate", "ldt", "ltod"].filter((b) => b !== a).map((b) => `xf_${a}_to_${b}`),
      ),
      "xf_time_to_string", "xf_time_zero_to_string", "xf_ltime_to_string", "xf_date_to_string",
      "xf_dt_to_string", "xf_tod_to_string", "xf_tod_round_to_string", "xf_dint_to_string",
      "xf_real_to_string", "xf_bool_to_string",
      ...["plain", "negative", "empty", "not_a_number", "trailing_rubbish", "leading_spaces", "far_too_large"].flatMap(
        (k) => [`xf_string_to_int_${k}`, `xf_string_to_real_${k}`],
      ),
      "xf_int_to_bool_zero", "xf_int_to_bool_one", "xf_int_to_bool_two", "xf_int_to_bool_negative",
      "xf_bool_to_int_true", "xf_bool_to_real_true",
    ],
  ),

  ...cells(
    "conversions",
    "the exact text a value converts to",
    [
      ...["real", "lreal"].flatMap((t) =>
        ["zero", "whole", "one_decimal", "many_decimals", "negative", "large_whole", "very_large", "very_small", "more_digits_than_a_real_holds", "nan", "infinity"].map(
          (k) => `fmt_${t}_${k}`,
        ),
      ),
      ...["zero", "one_nanosecond", "one_microsecond", "one_millisecond", "one_second", "one_minute", "one_hour", "one_day", "every_component", "the_one_already_measured"].map(
        (k) => `fmt_ltime_${k}`,
      ),
      ...["zero", "one_millisecond", "one_second", "every_component"].map((k) => `fmt_time_${k}`),
    ],
  ),

  // ── strings ──────────────────────────────────────────────────────────────────────────────────
  ...cells("strings", "LEN, CONCAT and FIND at their edges", [
    "str_len_empty", "str_len_five", "str_len_after_truncation",
    "str_concat_both", "str_concat_empty_left", "str_concat_into_short",
    "str_find_present", "str_find_absent", "str_find_empty_needle", "str_find_longer_needle",
  ]),
  ...cells(
    "strings",
    "LEFT and RIGHT at every count that means something",
    ["zero", "one", "exactly_the_length", "past_the_end", "negative"].flatMap((c) => [`str_left_${c}`, `str_right_${c}`]),
  ),
  ...cells(
    "strings",
    "MID, DELETE, INSERT and REPLACE at every position",
    ["at_zero", "at_one", "at_the_last", "past_the_end"].flatMap((p) => [
      `str_mid_${p}`, `str_mid_len0_${p}`, `str_mid_lenneg_${p}`,
      `str_delete_${p}`, `str_insert_${p}`, `str_replace_${p}`,
    ]),
  ),
  ...cells("strings", "assignment into a STRING(n) at each length", [
    "str_assign_into_shorter", "str_assign_into_exact", "str_assign_into_longer",
  ]),

  // ── declarations ──────────────────────────────────────────────────────────────────────────────
  ...cells(
    "declarations",
    "what each VAR section does over three scans",
    ["plain", "temp", "stat", "input", "output", "retain", "persistent", "retain_persistent"].flatMap((k) => [
      `decl_${k}_counts`,
      `decl_${k}_initialized`,
    ]),
  ),
  ...cells("declarations", "a CONSTANT, and a composite that has to start over", [
    "decl_constant_reads", "decl_constant_in_expression",
    "decl_temp_string_counts", "decl_var_string_counts",
    "decl_temp_array_counts", "decl_var_array_counts",
  ]),

  // ── calls ────────────────────────────────────────────────────────────────────────────────────
  ...cells("calls", "an FB, every argument form", [
    "cg_fb_positional", "cg_fb_named", "cg_fb_mixed", "cg_fb_output_bound",
    "cg_fb_omitted_input", "cg_fb_inout_counts",
  ]),
  ...cells("calls", "a FUNCTION, a METHOD and a PROPERTY", [
    "cg_fun_positional", "cg_fun_named", "cg_fun_mixed", "cg_fun_named_reversed",
    "cg_method_positional", "cg_method_named", "cg_property_after_calls",
  ]),
  ...cells("calls", "when an argument is evaluated and when an in-out is bound", [
    "cg_argument_order", "cg_inout_bound_after_write", "cg_instance_state_over_scans",
  ]),

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
  "declarations / RETAIN, PERSISTENT, CONSTANT and direct addresses",
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
