/**
 * the ceiling exceptions (`baseline.ts`) — part C: openspec lsp-quick-fixes.
 *
 * One slice of `baseline.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a test support
 * file is held to 400 lines).
 */
import type { CeilingException } from "./baseline-shared.js"

/**
 * lsp-quick-fixes 1.1 (2026-10-12): the quick-fix BEFOREs (`fixtures/quick-fixes/`) are new ground — each exists to report
 * the one finding its fix answers, which the LSP reports; the vendors' follow-on messages around it are the GAPs below,
 * each the same gap a sibling fixture already pins (`conformance/support/divergences-quick-fixes.ts` names which, and why
 * each is niche: accepted loss). Measured, not a regression.
 */
const BEFORE_CASCADES: readonly CeilingException[] = (
  [
    ["fixtures.codesys", "qf_access_before", "total: GAP", 1],
    ["fixtures.codesys", "qf_access_before", "total: unowned GAP", 1],
    ["fixtures.codesys", "qf_c0046_before_declare_argument", "total: GAP", 1],
    ["fixtures.codesys", "qf_c0046_before_declare_condition", "total: GAP", 1],
    ["fixtures.codesys", "qf_c0046_before_declare_condition", "total: unowned GAP", 1],
    ["fixtures.codesys", "qf_c0077_before", "total: GAP", 2],
    ["fixtures.codesys", "qf_c0533_before", "total: GAP", 1],
    ["fixtures.codesys", "qf_c0533_before", "group oop: GAP", 1],
    ["fixtures.twincat", "qf_access_before", "total: GAP", 1],
    ["fixtures.twincat", "qf_access_before", "total: unowned GAP", 1],
    ["fixtures.twincat", "qf_border_before", "total: GAP", 1],
    ["fixtures.twincat", "qf_c0046_before_declare_argument", "total: GAP", 1],
    ["fixtures.twincat", "qf_c0046_before_declare_condition", "total: GAP", 1],
    ["fixtures.twincat", "qf_c0046_before_declare_condition", "total: unowned GAP", 1],
  ] as const
).map(([baseline, fixture, measure, by]) => ({
  baseline,
  measure,
  by,
  fixture,
  task: "none: niche, accepted loss — conformance/support/divergences-quick-fixes.ts names each sibling and its reason",
  why: "a quick-fix BEFORE's follow-on message the LSP does not give, the same gap its sibling fixture pins",
}))

/**
 * …and two that are not a follow-on but a ROOT finding the LSP does not give (`divergences-quick-fixes.ts` names both):
 * TwinCAT's "Unknown type: 'DIMT'" on `qf_c0077_before` and its two conversions — deferred to 2.4's `References/` library
 * rule, not niche — and both vendors' "Array border cap does not evaluate to a valid signed integer constant" on
 * `qf_c0228_bound_subrange` with its vendor's follow-on (review of step 1, 2026-10-12) — niche — and the same on
 * `qf_c0228_bound_inline_subrange`, an INLINE subrange's (gate of step 1, 2026-10-12).
 */
const ROOT_GAPS: readonly CeilingException[] = [
  {
    baseline: "fixtures.twincat",
    fixture: "qf_c0077_before",
    measure: "total: GAP",
    by: 3,
    task: "lsp-quick-fixes 2.4: the TwinCAT `References/` library rule, after which `unknownTypeName` judges bare type names on TwinCAT too",
    why: "C0077 is judged on CODESYS only until TwinCAT's libraries are known as libraries",
  },
  ...(
    [
      ["fixtures.codesys", "total: GAP", 2],
      ["fixtures.codesys", "total: unowned GAP", 2],
      ["fixtures.twincat", "total: GAP", 2],
      ["fixtures.twincat", "total: unowned GAP", 1],
    ] as const
  ).flatMap(([baseline, measure, by]) =>
    (["qf_c0228_bound_subrange", "qf_c0228_bound_inline_subrange"] as const).map((fixture) => ({
      baseline,
      measure,
      by,
      fixture,
      task: "none: niche, accepted loss (0 occurrences in the corpora) — conformance/support/divergences-quick-fixes.ts",
      why: "a subrange's constant (named or inline) with no initial value bounds an array: the compiler says it does not evaluate, the LSP folds it to nothing and says nothing",
    })),
  ),
]

/**
 * …and one PROJECT-CONFIG follow-on: CODESYS sizes a refused `ARRAY[2..0]` at 2147483647 and says "The variable 'arr' is
 * too large" (`qf_c0228_bound_literal_two_below`, gate of step 1), as it does for `decl_array_reversed_bounds` — a
 * message about the target's memory segment (`census.ts` project-config), after the border error the LSP gives.
 */
const REVERSED_ARRAY_SIZE: readonly CeilingException[] = (["total: GAP", "total: unowned GAP"] as const).map(
  (measure) => ({
    baseline: "fixtures.codesys",
    measure,
    by: 1,
    fixture: "qf_c0228_bound_literal_two_below",
    task: "none: a project-config message (census.ts), as on decl_array_reversed_bounds",
    why: "CODESYS's \"variable is too large\" after the reversed array the LSP refuses — the target's segment, not the language",
  }),
)

/** …and one type-dump count: `qf_indexof_before`'s INDEXOF call, untyped on both vendors as here. */
const INDEXOF_UNTYPED: readonly CeilingException[] = (["codesys", "twincat"] as const).map((vendor) => ({
  baseline: "type-dump",
  measure: `fixtures ${vendor}: call UNKNOWN`,
  by: 1,
  fixture: "qf_indexof_before",
  task: "none: the vendors type it no more than the LSP does",
  why: 'INDEXOF, which both vendors refuse ("The operator INDEXOF is no longer supported") — its call has no result type there either, as in `atomic_indexof_variable`',
}))

/**
 * …and the S6 pin of another type than BOOL (ld-fbd-coverage gate 2-3): `ng_s6_negated_int_pin` records CODESYS's two
 * sign-change warnings through UINT, which the LSP does not give — new ground, its `deferred.lsp` the reason.
 */
const NEGATED_INT_PIN: readonly CeilingException[] = [
  {
    baseline: "fixtures.codesys",
    measure: "total: GAP",
    by: 2,
    fixture: "ng_s6_negated_int_pin",
    task: "none: niche, accepted loss (0 occurrences in the corpora) — the fixture's deferred.lsp",
    why: "a negated INT input pin: CODESYS warns twice of a sign change through UINT, the LSP says nothing",
  },
]

/**
 * …and a FUNCTION box given one positional value more than it declares, on TwinCAT (ld-fbd-coverage 2R.4,
 * `ng_m_function_too_many`, recorded 2026-10-17): the push derives no name for the extra pin and TwinCAT's in-place
 * write leaves it the empty name, so its build adds "Identifier '' not defined" to the arity error both vendors give —
 * which the LSP gives alone. No corpus network calls a function positionally (every drawn function box names its pins).
 */
const EXTRA_POSITIONAL_PIN_TC: readonly CeilingException[] = [
  {
    baseline: "fixtures.twincat",
    measure: "total: GAP",
    by: 1,
    fixture: "ng_m_function_too_many",
    task: "none: niche, accepted loss (0 occurrences in the corpora)",
    why: "an extra positional pin on a function box: TwinCAT also answers \"Identifier '' not defined\" for its empty name",
  },
  // the same message, as the front-end's resolution census counts it (a recorded "not defined" the LSP does not give)
  ...(["findings", "messages twincat: recorded only"] as const).map((measure) => ({
    baseline: "resolution-dump",
    measure,
    by: 1,
    fixture: "ng_m_function_too_many",
    task: "none: niche, accepted loss (0 occurrences in the corpora)",
    why: "an extra positional pin on a function box: TwinCAT's \"Identifier '' not defined\" for its empty name",
  })),
]

/**
 * \u2026and the call boxes the 2R.4 gate recorded (`ng_m_*`, 2026-10-17) whose answer the LSP does not give:
 *
 * - a LIBRARY function's box on CODESYS, whatever its pins (`LEN(txt)`, `LEN(STR := txt)`, `Standard.LEN(txt)`): the push
 *   builds it without the CallType the editor gives it \u2014 it holds no declaration of a library's function \u2014 and the build
 *   answers "The assignment source is incorrect.". The LSP cannot say it: the box the editor DRAWS builds (bakon-nano's
 *   REPLACE/DELETE, clean in its recorded build), and a pulled text does not tell the two apart. NOT niche (3 boxes in
 *   the corpora): the push's defect, owed in tasks.md 2R.4b.
 * - the FB's own METHOD called without an instance on CODESYS (no CallType: the push holds no declaration of the POU's
 *   members) \u2014 niche: TwinCAT builds it, and the corpora hold no such box.
 * - TwinCAT's empty-name answers for a positional pin nothing names (a METHOD's \u2014 its "'' is no input" the LSP gives \u2014 or a
 *   library function's), as on `ng_m_function_too_many`, and its namespace errors for `Standard.LEN` \u2014 a CODESYS
 *   namespace (TwinCAT's is `Tc2_Standard`), which the LSP's TwinCAT library model does not refuse.
 */
const UNNAMED_CALL_BOXES: readonly CeilingException[] = [
  ...(["ng_m_library_function", "ng_m_library_function_named", "ng_m_library_function_qualified"] as const).flatMap((fixture) =>
    (["total: GAP", "total: unowned GAP"] as const).map((measure) => ({
      baseline: "fixtures.codesys",
      measure,
      by: 1,
      fixture,
      task: "ld-fbd-coverage 2R.4b: the push builds a library function's box with its CallType (3 boxes in the corpora)",
      why: "a library function's box the push builds without a CallType: \"The assignment source is incorrect.\", which the drawn box does not give",
    })),
  ),
  ...(["total: GAP", "total: unowned GAP"] as const).map((measure) => ({
    baseline: "fixtures.codesys",
    measure,
    by: 1,
    fixture: "ng_m_own_method",
    task: "none: niche, accepted loss (0 occurrences in the corpora)",
    why: "the FB's own METHOD called without an instance: the push builds its box without CallType Method, \"The assignment source is incorrect.\"",
  })),
  ...(
    [
      ["ng_m_method_positional", 1],
      ["ng_m_library_function", 2],
      ["ng_m_library_function_qualified", 3],
    ] as const
  ).map(([fixture, by]) => ({
    baseline: "fixtures.twincat",
    measure: "total: GAP",
    by,
    fixture,
    task: "none: niche, accepted loss (0 occurrences in the corpora)",
    why: "a positional pin no declaration names (TwinCAT's \"'' is no input\" / \"Identifier '' not defined\"), or CODESYS's namespace `Standard` on TwinCAT",
  })),
  // the same "not defined" messages, as the front-end's resolution census counts them (recorded, not given by the LSP)
  ...(["ng_m_method_positional", "ng_m_library_function", "ng_m_library_function_qualified"] as const).flatMap((fixture) =>
    (["findings", "messages twincat: recorded only"] as const).map((measure) => ({
      baseline: "resolution-dump",
      measure,
      by: 1,
      fixture,
      task: "none: niche, accepted loss (0 occurrences in the corpora)",
      why: "TwinCAT's \"Identifier '' not defined\" for a positional pin no declaration names, or \"Identifier 'Standard' not defined\" for CODESYS's namespace",
    })),
  ),
]

export const CEILING_EXCEPTIONS_C: readonly CeilingException[] = [
  ...EXTRA_POSITIONAL_PIN_TC,
  ...UNNAMED_CALL_BOXES,
  ...BEFORE_CASCADES,
  ...ROOT_GAPS,
  ...REVERSED_ARRAY_SIZE,
  ...INDEXOF_UNTYPED,
  ...NEGATED_INT_PIN,
]
