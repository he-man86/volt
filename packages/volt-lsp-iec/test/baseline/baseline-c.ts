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
 * An ACTION's VAR section above its `%LANGUAGE` line (openspec language-line, `unit_action_var_section`): the line is the
 * boundary wherever it stands, so the action's body under it now PARSES — where the retired line, read only as a body's
 * first token, left the whole body unparsed and so out of these measures. An action has no declaration the IDE stores,
 * so the push refuses the VAR section and the LSP reports it with the push's words (`parseAction`); `t`, declared only
 * there, binds nowhere and has no type — what both vendors said of it when the push still dropped the section ("Identifier
 * 't' not defined"). Newly measurable, not a regression.
 */
const ACTION_VAR_SECTION: readonly CeilingException[] = [
  ...(
    [
      ["resolution-dump", "findings", 4],
      ["resolution-dump", "fixtures codesys: bare name NONE", 2],
      ["resolution-dump", "fixtures twincat: bare name NONE", 2],
      ["type-dump", "fixtures codesys: ident_expr UNKNOWN", 2],
      ["type-dump", "fixtures twincat: ident_expr UNKNOWN", 2],
    ] as const
  ).map(([baseline, measure, by]) => ({
    baseline,
    measure,
    by,
    fixture: "unit_action_var_section",
    task: "none: the push refuses the fixture (an action has no declaration), and the LSP reports the refusal",
    why: "an action's body under a %LANGUAGE line that a VAR section stands above parses now; `t` is declared only in the refused section",
  })),
  // `unit_method_override_public_order` (a method header the parser misreads, pushed as sent): its body under the line
  // now parses, so the parse noise that happened to match two of the build's messages about the misread header ("';'
  // expected instead of 'M'", "Unexpected token 'PUBLIC' found") is gone, and they count as the build's alone.
  ...(["fixtures.codesys", "fixtures.twincat"] as const).map((baseline) => ({
    baseline,
    measure: "total: GAP",
    by: 2,
    fixture: "unit_method_override_public_order",
    task: "none: a known divergence of the fixture (the parser's reading of `METHOD OVERRIDE PUBLIC M`)",
    why: "the body under a %LANGUAGE line parses wherever the line stands; the header's own errors were matched only by noise before",
  })),
]

/**
 * …and the shapes the push writes as stated since network-text-st, which store and do not build — an operator box read
 * through its ENO with its value wired nowhere (X3: `ng_en_eno_sink`, `ng_en_eno_named_wire`,
 * `network_unnamed_target_behind_enable`) and an operator box showing ENO without EN (X9: `rcc_network_eno_without_en`).
 * CODESYS's build names the implicit variable it invents with a counter (`__<pou>__ImpVar<n>`) no text holds, and adds
 * the box's own inconsistency; the LSP gives what the text states. Niche: 0 such boxes in the corpora (which build).
 */
const UNBUILDABLE_BOXES: readonly CeilingException[] = [
  ...(["network_unnamed_target_behind_enable", "ng_en_eno_sink", "ng_en_eno_named_wire"] as const).map((fixture) => ({
    baseline: "fixtures.codesys",
    measure: "total: GAP",
    by: 2,
    fixture,
    task: "none: niche, accepted loss (0 occurrences in the corpora)",
    why: "an operator box read through its ENO, its value wired nowhere: CODESYS's errors name the implicit variable it numbers (`__<pou>__ImpVar<n>`)",
  })),
  ...(
    [
      ["fixtures.codesys", "total: GAP", 4],
      ["fixtures.codesys", "total: unowned GAP", 2],
      ["fixtures.codesys", "group network: GAP", 1],
      ["fixtures.twincat", "total: GAP", 2],
      ["fixtures.twincat", "total: unowned GAP", 1],
    ] as const
  ).map(([baseline, measure, by]) => ({
    baseline,
    measure,
    by,
    fixture: "rcc_network_eno_without_en",
    task: "none: niche, accepted loss (0 occurrences in the corpora)",
    why: "an operator box showing ENO without EN: the build's \"Missing EN pin\", its implicit variable and the value it reads as the ENO",
  })),
  {
    baseline: "fixtures.codesys",
    measure: "total: GAP",
    by: 1,
    fixture: "ng_m_library_function_qualified_eno",
    task: "none: niche, accepted loss (0 occurrences in the corpora)",
    why: "a library function's box named through its namespace and shown with ENO: CODESYS's conversion echo of 'Standard.LEN.ENO', beside the member error the LSP gives",
  },
]

/**
 * \u2026and the call boxes the 2R.4 gate recorded (`ng_m_*`, 2026-10-17) whose answer the LSP does not give:
 *
 * - a LIBRARY function's box on CODESYS named through its namespace (`Standard.LEN(txt)`): the push builds it without the
 *   CallType the editor gives it \u2014 it reads a library function's signature by its bare name only (2R.4b, which builds
 *   `LEN(txt)` and `LEN(STR := txt)` clean) \u2014 and the build answers "The assignment source is incorrect.". The LSP cannot
 *   say it: the box the editor DRAWS builds, and a pulled text does not tell the two apart. Niche: 0 namespace-qualified
 *   library calls in the corpora's LD/FBD bodies.
 * - the FB's own METHOD called without an instance on CODESYS (no CallType: the push holds no declaration of the POU's
 *   members) \u2014 niche: TwinCAT builds it, and the corpora hold no such box.
 * - TwinCAT's empty-name answers for a positional pin nothing names (a METHOD's \u2014 its "'' is no input" the LSP gives),
 *   as on `ng_m_function_too_many`, and its namespace errors for `Standard.LEN` \u2014 a CODESYS
 *   namespace (TwinCAT's is `Tc2_Standard`), which the LSP's TwinCAT library model does not refuse.
 */
const UNNAMED_CALL_BOXES: readonly CeilingException[] = [
  ...(["total: GAP", "total: unowned GAP"] as const).map((measure) => ({
    baseline: "fixtures.codesys",
    measure,
    by: 1,
    fixture: "ng_m_library_function_qualified",
    task: "none: niche, accepted loss (0 occurrences in the corpora)",
    why: "a library function's box named through its namespace, which the push builds without a CallType: \"The assignment source is incorrect.\", which the drawn box does not give",
  })),
  ...(["total: GAP", "total: unowned GAP"] as const).map((measure) => ({
    baseline: "fixtures.codesys",
    measure,
    by: 1,
    fixture: "ng_m_own_method",
    task: "none: niche, accepted loss (0 occurrences in the corpora)",
    why: "the FB's own METHOD called without an instance: the push builds its box without CallType Method, \"The assignment source is incorrect.\"",
  })),
  {
    baseline: "fixtures.twincat",
    measure: "total: GAP",
    by: 3,
    fixture: "ng_m_library_function_qualified",
    task: "none: niche, accepted loss (0 occurrences in the corpora)",
    why: "CODESYS's namespace `Standard` on TwinCAT",
  },
  // the same "not defined" message, as the front-end's resolution census counts it (recorded, not given by the LSP)
  ...(["findings", "messages twincat: recorded only"] as const).map((measure) => ({
    baseline: "resolution-dump",
    measure,
    by: 1,
    fixture: "ng_m_library_function_qualified",
    task: "none: niche, accepted loss (0 occurrences in the corpora)",
    why: "\"Identifier 'Standard' not defined\" for CODESYS's namespace",
  })),
]

export const CEILING_EXCEPTIONS_C: readonly CeilingException[] = [
  // a LIBRARY function's box read through its namespace with ENO on TwinCAT: "Program name, function or function block
  // instance expected instead of 'Standard.LEN'" + "Identifier 'Standard' not defined" — CODESYS's namespace on TwinCAT
  {
    baseline: "fixtures.twincat",
    measure: "total: GAP",
    by: 2,
    fixture: "ng_m_library_function_qualified_eno",
    task: "none: niche, accepted loss (0 occurrences in the corpora)",
    why: "CODESYS's namespace `Standard` on TwinCAT",
  },
  ...UNBUILDABLE_BOXES,
  ...UNNAMED_CALL_BOXES,
  ...BEFORE_CASCADES,
  ...ROOT_GAPS,
  ...REVERSED_ARRAY_SIZE,
  ...INDEXOF_UNTYPED,
  ...NEGATED_INT_PIN,
  ...ACTION_VAR_SECTION,
]
