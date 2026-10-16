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
 * …and the gap 2R.3 left unowned (ld-fbd-coverage, re-recorded 2026-10-16): `ng_box_output_arrow` records "The
 * assignment source is incorrect." for a function's result pin wired straight to a variable, and the one builder that
 * spelled the sentence answered ENO read off a FUNCTION's box — which CODESYS now answers otherwise for the box 2R.3's
 * push builds ("'ENO' is no component of …"), so the builder went with its last true positive. The gap is the same gap.
 */
const SOURCE_SENTENCE_UNOWNED: readonly CeilingException[] = [
  {
    baseline: "fixtures.codesys",
    measure: "total: unowned GAP",
    by: 1,
    fixture: "ng_box_output_arrow",
    task: "none: the LSP gives no answer for a function's result pin wired to a variable (a gap before 2R.3 too)",
    why: "its builder answered ENO off a function box, which the 2R.3 recording no longer answers so",
  },
]

export const CEILING_EXCEPTIONS_C: readonly CeilingException[] = [
  ...BEFORE_CASCADES,
  ...ROOT_GAPS,
  ...REVERSED_ARRAY_SIZE,
  ...INDEXOF_UNTYPED,
  ...NEGATED_INT_PIN,
  ...SOURCE_SENTENCE_UNOWNED,
]
