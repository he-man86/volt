/**
 * THE TRANSPILE REPLAY, THE REFUSALS — what the vendor rejects (in words we repeat), what it runs and lowering refuses
 * (a registered code), what the LSP does not refuse yet, what the oracle cannot ask. The confirmed runs:
 * `transpile-replay.test.ts`; the rest of the lowered fixtures: `transpile-replay-lowered.test.ts`.
 */
import { describe, expect, test } from "bun:test"
import { parseSource } from "../../src/frontend/syntax/index.js"
import { build } from "../../src/frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../src/analysis/index.js"
import { lowerCodeKind } from "../../src/transpile/index.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { RUNS } from "./support/recordings.js"
import { comparable } from "./support/compare-message.js"
import { lspErrors } from "./support/evidence.js"
import { nameRefusal } from "./support/name-refusal.js"
import { expectStillDiverges } from "./support/expected-failure.js"
import { BUILDS, lowering, rated, SELECTION, whole } from "./support/fixture-suite.js"

/**
 * THE VENDOR REFUSES IT AND SO DO WE. The rating already established that the LSP objects — that is what separates
 * `refused` from `lsp-gap`. What is left is the WORDING, for the fixtures that record the vendor's own text.
 *
 * This is the class fix for the LSP gaps the transpiler work keeps exposing: the replay below fails only on a false
 * POSITIVE, so a construct the compiler rejects and the LSP silently accepts could stay unnoticed forever. Here it
 * is a failing row.
 *
 * PARSE ERRORS COUNT. `lspErrors` collects them alongside the semantic ones — a reserved word in name position is
 * reported by `cursor.ts` rather than by a check (`lt : BOOL;` is `Unexpected token 'LT' found`, CODESYS's own
 * wording), and a gate that reads only semantic diagnostics sees half of what the LSP says. Two fixtures were filed
 * as LSP gaps on that basis and were never gaps at all.
 *
 * And the vendor's own answer is re-asserted: a fixture cannot quietly stop being refused.
 *
 * NOTHING ELSE IS OWED. The transpiler's input contract is "code CODESYS compiles" (`src/transpile/index.ts`),
 * so a source the vendor rejects is outside it — there is no value to produce and no lowering to demand. That is
 * why a refused fixture is an answer rather than a gap, and why it is COUNTED rather than dropped: a fixture
 * cannot go quiet here by becoming uncompilable.
 */
describe("refused — the vendor rejects it, in words we repeat", () => {
  for (const c of rated("refused").filter((x) => x.refused !== undefined)) {
    test(c.name, () => {
      const rec = RUNS[c.name]
      if (rec?.error !== undefined) expect(rec.error).toContain(c.refused!)
      expect(lspErrors(c, ALL_TESTS, "codesys")).toContainEqual(expect.stringContaining(c.refused!))
    })
  }
})

/**
 * THE VENDOR RUNS IT AND LOWERING REFUSES — a coverage gap, named by the code that stops it.
 *
 * Counted rather than asserted case by case: which construct is missing is the work list's question
 * (`scripts/lower-completeness.ts`), and the number that DO lower is what must not regress. The code has to be in
 * the registry, so a refusal cannot arrive under a slug nothing documents.
 */
describe("not-lowered — the vendor runs it and lowering refuses", () => {
  for (const c of rated("not-lowered")) {
    const code = lowering(c).diagnostics[0]?.code ?? "unknown"
    test.todo(`${c.name} — not lowered: ${code}`, () => {})
  }

  whole("what blocks them, by code — the work list's input", () => {
    const blockers = new Map<string, number>()
    for (const c of rated("not-lowered")) {
      const code = lowering(c).diagnostics[0]?.code ?? "unknown"
      blockers.set(code, (blockers.get(code) ?? 0) + 1)
    }
    const summary = [...blockers].sort((a, b) => b[1] - a[1]).map(([code, n]) => `${code} ${n}`)
    console.log(`  [fixtures] ${rated("confirmed").length} of ${ALL_TESTS.length} lower and run; what blocks the ${rated("not-lowered").length}: ${summary.join(" · ") || "nothing"}`)
    console.log(`  [fixtures] ${rated("refused").length} more the VENDOR refuses to compile — not this row's to answer`)
    // the report is the point; the ceiling above is the gate
    expect(blockers.size).toBeGreaterThan(0)
  })

  test("every refusal is a registered code", () => {
    // `lowerCodeKind` is the one answer: an exact entry, or one of the templated families (`stmt-try`, `slot-*`),
    // which cannot be enumerated because they expand over AST kinds. Reading `LOWER_CODES` alone called eleven
    // perfectly well-registered refusals unregistered.
    const unregistered = rated("not-lowered")
      .map((c) => [c.name, lowering(c).diagnostics[0]?.code] as const)
      .filter(([, code]) => code === undefined || lowerCodeKind(code) === undefined)
      .map(([name, code]) => `${name}: ${code ?? "(no diagnostic)"}`)
    expect(unregistered).toEqual([])
  })
})

/**
 * THE VENDOR OBJECTS AND THE LSP IS SILENT. Asserting parity would assert something false; dropping the fixture
 * would lose the vendor's answer. So each is named, dated on the fixture, and COUNTED — a backlog that reports
 * itself is one that cannot quietly grow.
 */
describe("lsp-gap — a refusal the LSP does not make yet", () => {
  // AN EXPECTED FAILURE, like `diverges`: the check is the one `refused` makes — the LSP objects, in the vendor's
  // words where the fixture records them — and the row fails the day it passes. `deferred.lsp` pins the rating to
  // `lsp-gap` whatever the LSP says, so without this a closed gap stayed excused indefinitely.
  for (const c of rated("lsp-gap")) {
    const mark = c.deferred?.lsp ?? "MEASURED_SILENT: the vendor refuses and the LSP says nothing"
    test(`${c.name} — still silent: ${mark}`, () => {
      expectStillDiverges(c.name, mark, [
        () =>
          c.refused === undefined
            ? expect(lspErrors(c, ALL_TESTS, "codesys").length).toBeGreaterThan(0)
            : expect(lspErrors(c, ALL_TESTS, "codesys")).toContainEqual(expect.stringContaining(c.refused)),
      ])
    })
  }

  /**
   * THE RATING HAS TWO SOURCES AND ONLY ONE OF THEM IS DECLARED. A fixture reaches `lsp-gap` either by CARRYING
   * `deferred.lsp` — somebody wrote the gap down, with a date — or by being MEASURED silent: the vendor refused
   * and `lspReportsAnError` found nothing. This asserted the first and the two measured ones failed it, which is
   * the hole the table exists to show. Four separate filters could not: each selected the subset it already knew.
   *
   * The measured kind is not required to say anything on the fixture — there is nothing to say until somebody
   * looks — so what is asserted is that they are the ones we know about. The ceiling holds the total at 2.
   */
  const MEASURED_SILENT: ReadonlySet<string> = new Set([
    // `__POUNAME()` into an INT (frontend-conformance 4.3.4): CODESYS names a STRING sized by the asking body's qualified
    // name, which an ACTION's body does not carry (`CODESYS_POUNAME_IS_SIZED_BY_ITS_BODY`); TwinCAT has no `__POUNAME`
    // and agrees, so it cannot be written on the fixture as a deferral (agreeing would end it there)
    "ar_pouname_type",
    // (the `???` target over a CALL read through its ENO left 2026-10-16, ld-fbd-coverage 2R.3: re-recorded on the box
    // 2R.3's push builds, CODESYS answers the target, and `checkUnresolvedBoxes` says so.)
    // partial access CODESYS refuses — `.%B0` of an INT ("Partial access is only supported on ANY_BIT types and not on
    // 'INT'"), `.%W1` of a WORD ("'%W1' is not a valid partial component of 'WORD'"; transpile-refusal-classification 2.2).
    // TwinCAT has no `.%` access and the LSP's TwinCAT parse agrees, so it cannot be a deferral on the fixture. niche:
    // accepted loss (0 occurrences in the corpora).
    "rk_partial_access_signed",
    "rk_partial_access_out_of_range",
    // (`op_sys_queryinterface` left 2026-10-06, analysis-conformance 3.8: the interface named as an operand must be
    // instantiated, `fb-instantiation` says so now; its two other errors stay GAPs — niche, task 3.8.4.)
    // (the FOR limits and steps that do not convert into the counter left 2026-10-11, lsp-transpile-review-gaps 1.1, 1.2,
    // 2.1: `statement-rules` `for-bound-type` refuses them by type, and a folded step by value.)
    // frontend-conformance 2.1.3, recorded 2026-09-30 on both vendors — `__POOL` named where an operand (or an
    // assignment target) belongs reads the next token as its member, a shape the LSP does not model (rules E30/E34,
    // task 2.5.6; niche, accepted — `support/divergences.ts`). Bare `__NEW` and `__POUNAME` left this set in 2.1: the
    // parser now answers them as the vendor does (`parse/expression.ts`).
    "lex_keyword_assigned_sys_pool",
    "lex_keyword_operand_sys_pool",
    // …and called where a statement starts, `__pool(n);` (review 2.6, both vendors 2026-10-02): the same member read,
    // "Identifier expected instead of ''" and the `.` on `!!!'ERROR'!!!` — niche: accepted loss (0 `__POOL(` in the
    // corpora)
    "lex_keyword_called_sys_pool",
    // frontend-conformance 2.3.4, recorded 2026-10-01 — an ARRAY OF a function block initialized element by element with
    // no `:=` passes each element's list to the FB's FB_Init, which this FB does not declare: CODESYS "No matching
    // 'FB_Init' method found for instantiation of FB_…" (TwinCAT: a failed build with no message). The grammar now reads
    // the form (`parse/declarations`); the FB_Init matching is `analysis/checks/oop/fb-init-instantiation`'s, outside
    // the front-end (`support/divergences.ts` `CODESYS_DECLARATION_DIVERGENCES`).
    "decl_bracket_init_no_assign_fb",
    // …and `[K+L(7)]`: the parser reads L's call as the vendors do; refusing a call inside an aggregate initializer is the
    // calls check's, which walks bodies (`support/divergences.ts` `CALL_IN_AN_AGGREGATE_INITIALIZER`)
    "decl_repeat_count_expression_names",
    // frontend-conformance 2.3b review, recorded 2026-10-01 on both vendors — an implicit enum's value stored into a BYTE,
    // with or without a written base: "Cannot convert type 'IMPLICIT_ENUM__FB_…__E' to type 'BYTE'". Every implicit
    // enum is the one `(implicit)` type with no base, so the store is unchecked (`support/divergences.ts`
    // `IMPLICIT_ENUM_TYPE_NAME`, the type's identity, tasks 3.3/4.7.4)
    "decl_implicit_enum_into_byte",
    "decl_implicit_enum_with_base_into_byte",
    // frontend-conformance 2.7: a conditional pragma in a declaration part (the declaration parser applies none)
    "prag_if_defined_in_declaration",
    "prag_project_defined_in_declaration",
    // frontend-conformance 3.3 review, recorded 2026-10-02 — CODESYS takes an open library's enum member (Util's GEN_MODE)
    // before a project FUNCTION / PROGRAM of its name; which libraries' members are candidates is LB2's (task 3.4.2), and
    // pro2193's 87 clean POU names beside other libraries' members forbid refusing without it (`support/divergences.ts`
    // `CODESYS_ENUM_DIVERGENCES`)
    "enum_library_member_vs_project_function",
    "enum_library_member_vs_project_program",
    // (`callarg_no_argument_variable_default` left 2026-10-06, analysis-conformance 3.8: a VARIABLE default is no default
    // on CODESYS, `call-arguments` 4b.)
    // (`tr_43_routine_output_dint_to_int` left 2026-10-11, lsp-transpile-review-gaps 2.4: a FUNCTION's output binding is judged.)
    // (`string_inout_narrower`, `wstring_inout_narrower` left 2026-10-11, lsp-transpile-review-gaps 2.5: `call-arguments`
    // judges a string in-out's capacity, `in-out-string-too-short`.)
  ])

  test("each is either written down on the fixture or a known measured silence", () => {
    const unaccounted = rated("lsp-gap")
      .filter((c) => c.deferred?.lsp === undefined && !MEASURED_SILENT.has(c.name))
      .map((c) => c.name)
    expect(unaccounted).toEqual([])
    // and the other direction — one that gains a check should leave the set rather than rot in it
    expect([...MEASURED_SILENT].filter((n) => SELECTION.has(n) && !rated("lsp-gap").some((c) => c.name === n))).toEqual([])
  })
})

/**
 * THE IDE REFUSES TO CREATE IT BY NAME, AND THE LSP SAYS SO IN THE IDE'S WORDS (`checks/names/object-name.ts`, openspec
 * lsp-field-followups 3). A fixture the vendor refuses carries no build, so the agreement replay skips it; its refusal,
 * as the push answered it (`vendorRefuses`), is the oracle here. Every name refusal of every fixture, both vendors: the
 * LSP gives that sentence word for word.
 */
describe("create refused by name — the IDE's own refusal", () => {
  for (const vendor of ["codesys", "twincat"] as const) {
    for (const c of ALL_TESTS) {
      const sentence = nameRefusal(c, vendor)
      if (sentence === undefined || !SELECTION.has(c.name)) continue
      test(`${c.name} — ${vendor}: ${sentence}`, () => {
        expect(lspErrors(c, ALL_TESTS, vendor)).toContainEqual(sentence)
      })
    }
  }
})

/**
 * THE LINE, where a recording carries one — openspec bridge-refusal-review 5.2 (review 5+6). The agreement replay
 * compares `[severity] message` and never a line, so it cannot back a claim of line parity. CODESYS records every line
 * as 0. TwinCAT records an ST body's line as its declaration's lines plus the body's own line — the file's line minus
 * one, since the push takes the %LANGUAGE line off. A NETWORK body's lines are the vendor's own numbering, no text
 * line (`rcc_network_undeclared_wire_shape`: 6 and 7 for the one statement on file line 8), so none is compared there.
 *
 * Pinned for this change's ST row. Three of its four lines agree; the fourth, "';' expected instead of end of POU", the
 * build puts on the body's last line and the LSP on END_FUNCTION_BLOCK, one line lower — held as an expected failure
 * here, and the same for every "end of POU" (146 recorded, never compared: a line-parity gate for the whole replay is
 * the follow-up this belongs to, not this change).
 */
describe("lines — TwinCAT's, for this change's ST row", () => {
  const name = "rcc_st_body_network"
  const lines = (): { lsp: string[]; ide: string[] } => {
    const t = ALL_TESTS.find((x) => x.name === name)!
    const pr = parseSource(t.source, { networkText: true }, "twincat")
    const project = build.buildSymbolTable([{ uri: `file:///w/${t.pouName}.pou`, parseResult: pr, source: t.source }], [], "twincat")
    const at = (ds: readonly { severity: string; message: string; line: number }[]) =>
      ds.filter((d) => d.severity === "error" || d.severity === "warning").map((d) => `[${d.severity}] ${comparable(d.message)} @${d.line}`)
    const lsp = computeDiagnostics({ uri: `file:///w/${t.pouName}.pou`, parseResult: pr, source: t.source, project, config: resolveConfig({ vendor: "twincat" }) })
    // the file's 1-based line, less the %LANGUAGE line the push takes off
    return {
      lsp: at(lsp.map((d) => ({ severity: d.severity, message: d.message, line: d.span.startLine - 1 }))),
      ide: at(BUILDS.twincat.tests[name]!.diagnostics),
    }
  }
  const endOfPou = (m: string) => m.includes("end of POU")
  const run = SELECTION.has(name) && BUILDS.twincat.recorded !== null
  test.if(run)(`${name} — every message but "end of POU" on the build's line`, () => {
    const { lsp, ide } = lines()
    expect(lsp.filter((m) => !endOfPou(m)).sort()).toEqual(ide.filter((m) => !endOfPou(m)).sort())
  })
  test.if(run)(`${name} — "end of POU" is one line below the build's, still`, () => {
    const { lsp, ide } = lines()
    expectStillDiverges(name, "end of POU on END_FUNCTION_BLOCK, the build's on the body's last line", [
      () => expect(lsp.filter(endOfPou)).toEqual(ide.filter(endOfPou)),
    ], "TwinCAT's lines")
  })
})

/** THE ORACLE CANNOT PUT THE QUESTION — a graphical body the exec recorder cannot load, a project setting no LSP
 *  can see. Not a gap in the product; a limit of the harness, which has to say which. */
describe("unaskable — the oracle cannot ask it", () => {
  test("each says why, in execSkip or recorderSkip", () => {
    const silent = rated("unaskable").filter((c) => c.execSkip === undefined && c.recorderSkip !== true)
    // A fixture rated unaskable for the PROJECT's configuration carries neither flag — the reason is in the
    // recording, and `evidence.ts` names it (`PROJECT_CONFIGURATION`). Those are allowed; anything else is not.
    expect(silent.filter((c) => RUNS[c.name]?.error === undefined).map((c) => c.name)).toEqual([])
  })
})

/**
 * THE SIMULATOR REFUSED WHAT THE BRIDGE BUILT — not a rating, a harness defect, and the one thing the rating
 * cannot see because both halves look like ordinary refusals from the inside.
 *
 * `record:exec` writes declaration and implementation text STRAIGHT into a POU, so a body that is not ST cannot
 * survive the trip: network text reaches the compiler as the literal `NETWORK 0 FBD` and is answered "';' expected
 * instead of 'FBD'". Those fixtures carry `execSkip` and are never sent; one arriving here slipped past it.
 */
test("no fixture the BUILD recording compiled was refused by the simulator", () => {
  const disagreed = SELECTION.selected.filter(
    (c) => RUNS[c.name]?.error?.startsWith("does not compile") === true && BUILDS.codesys.tests[c.name]?.buildSuccess === true,
  ).map((c) => `${c.name}: ${RUNS[c.name]!.error}`)
  expect(disagreed).toEqual([])
})
