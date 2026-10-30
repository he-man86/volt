/**
 * the ceiling exceptions (`baseline.ts`) — part E: openspec dut-unknown-field-type, the class sweep (2026-10-30).
 *
 * The sweep recorded 45 `tref_*` fixtures on both vendors (`fixtures/declarations/type-references.ts`) — new ground,
 * measured, not a regression. What each adds to a disagreement measure is one of the reasons below, per fixture, in
 * `exceptions-dut-unknown-field-type.json` (`[baseline, measure, by, fixture]` rows, written from the measurement — each
 * fixture's own contribution). A row goes stale, failing, the day its fixture stops producing it.
 */
import ROWS from "./exceptions-dut-unknown-field-type.json" with { type: "json" }
import type { CeilingException } from "./baseline-shared.js"

const NAMED_UNKNOWN_TASK =
  "none planned: an unresolved type kept as the NAME written — a type the LSP's model has no form for (an unresolved name is UNKNOWN)"

/** Why a row is excepted: the first reason whose rule holds for its baseline and fixture. */
const REASONS: readonly { holds: (baseline: string, fixture: string) => boolean; task: string; why: string }[] = [
  {
    holds: (_, f) => f === "tref_struct_field_unused",
    task: "none planned: the replay and the census analyse a fixture's file with no reachability (divergences.ts, beside `sn_dut_mismatch`)",
    why: "a STRUCT nobody uses is not compiled: its unknown field type records nothing, the LSP answers about the DUT file in front of it",
  },
  {
    holds: (_, f) => f === "tref_new",
    task: NAMED_UNKNOWN_TASK,
    why: "`__NEW(NoSuchType)`: the vendor converts 'POINTER TO NoSuchType' (and CODESYS adds the recording device's \"No memory for dynamic object creation\"); the LSP gives the \"Unknown type\" and says nothing it would have to guess",
  },
  {
    holds: (b, f) => (f === "tref_property_type" || f === "tref_property_type_get_set") && b !== "fixtures.twincat",
    task: NAMED_UNKNOWN_TASK,
    why: "a GET's implementation adds one \"Unknown type\" and \"Cannot convert type 'NoSuchType' to type 'NoSuchType'\" (a known divergence, `conformance/support/divergences.ts`)",
  },
  {
    holds: (b) => b === "fixtures.twincat",
    task: "lsp-quick-fixes 2.4: the TwinCAT `References/` library rule, after which `unknownTypeName` judges bare type names on TwinCAT too",
    why: "\"Unknown type\" (C0077) is judged on CODESYS only until TwinCAT's libraries are known as libraries — the same root gap as `qf_c0077_before`",
  },
  {
    holds: (_, f) => f === "tref_array_bound_name" || f === "tref_subrange_bound_name",
    task: "none: the vendors say the same — a bound naming nothing is \"Border … of array is no constant value\" and no \"not defined\"",
    why: "a bound that names nothing binds nothing: the dumps count the unbound name the build answers with the border error alone",
  },
  {
    holds: (_, f) => f === "tref_function_return",
    task: "none: the vendors say the same — the FUNCTION's result type is \"Unknown type\"",
    why: "a call of a FUNCTION whose result type names nothing has no type",
  },
  {
    holds: (_, f) => f === "tref_var_global",
    task: "none: a list's own declarations have no scope in the census (`bound.ts` `withBoundFixture`)",
    why: "a GVL with an initializer, as the `upa_` lists of part D",
  },
]

export const CEILING_EXCEPTIONS_E: readonly CeilingException[] = (ROWS as [string, string, number, string][]).map(
  ([baseline, measure, by, fixture]) => {
    const reason = REASONS.find((r) => r.holds(baseline, fixture))
    if (reason === undefined) throw new Error(`exceptions-dut-unknown-field-type.json: ${baseline} ${fixture} has no reason`)
    return { baseline, measure, by, fixture, task: reason.task, why: reason.why }
  },
)
