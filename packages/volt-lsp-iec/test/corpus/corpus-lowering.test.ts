/**
 * THE CORPUS, QUESTION 3 — LOWERING IS TOTAL: nothing throws over the real projects, and the reach figures
 * `src/transpile/index.ts` quotes are what is measured. The walk and the other two questions: `corpus.test.ts`.
 */
import { describe, expect, test } from "bun:test"
import { LOWER_CODES, LOWER_CODE_PREFIXES } from "../../src/transpile/index.js"
import type { IrBuiltinName, IrExpr, IrStmt } from "../../src/transpile/ir/index.js"
import { ALL_TESTS } from "../conformance/fixtures/index.js"
import { assembleFixture } from "../conformance/support/fixture-units.js"
import { PROJECT_BASE } from "../conformance/support/project-libraries.js"
import { lowerSource } from "../../src/transpile/lower/index.js"
import { hasCorpus, LOWERING_TIMEOUT, fromPou, pass } from "./support/walk.js"

// ─── question 3: lowering is total ───────────────────────────────────────────────────────────────────────────

/**
 * THE DOCUMENTED REACH — `src/transpile/index.ts` states the rule and points here, the one place the figures live
 * (transpile-restructure 7.10.3). They are exact rather than a floor on purpose: a floor lets the documented figure rot
 * quietly upward while still "passing".
 */
// 55 -> 56 and 543/14 -> 549/20 on 2026-09-20: a declaration-level `REF=` (`r : REFERENCE TO T REF= x`) now binds
// its target. The parser accepted the operator and did not record WHICH one it was, so every such declaration
// reached lowering as a plain assignment and every read of the reference was refused `pointer-order` — 72 corpus
// POUs stopped hitting that refusal at all (reach 177 -> 105).
// 56 -> 54 on 2026-09-25, and DOWN is the correction: the gate built its project without saying which units came from
// a LIBRARY, so lowering ran every bodyless library element as an empty body — `t.Q` FALSE forever, counted as reach.
// Two POUs "lowered" only through that. With the library units marked (`test/corpus/support/project.ts`, one loader
// for the gate and the scripts), a library runs only where the library repo (`libraries/`) has written its ST.
// 54 -> 55 on 2026-09-26: Util's BLINK is in the library repo (`libraries/Util/`), and one POU was waiting on it alone.
// 55 -> 54 on 2026-09-28, DOWN and the correction again (openspec implementation-keyword): pro2193 holds a CFC chart
// (`SetErrorFB`) and an FBD body network text cannot spell (`Cylinder_53ValveFB.SetAlarm`). Before the change each
// pulled as the retired boundary comment over a `(* @volt-graphical: … *)` comment, which this gate read as an ST
// body holding one comment — so lowering ran a chart as an EMPTY body and counted the POU that calls it
// (`EjectorCorePullerFB`) as reach. Pulled now as `%LANGUAGE CFC|FBD UNSUPPORTED`, neither parser reads them and
// lowering refuses `graphical-body` where it truly stops. Measured: stating those two bodies `%LANGUAGE ST` again
// restores 55 / 20 / 78 exactly, so nothing else moved.
// 54 -> 53 on 2026-10-11, DOWN and the same correction (openspec abstract-member-push): pro2193's 10
// `AbstractPOUMethodObject`s and its abstract property's GET hold no body slot, and the pull now states each
// no `%LANGUAGE` line (a member with no body slot) instead of an empty `%LANGUAGE ST` body (the corpus re-pulled live, exactly those 11 lines
// in 7 files). `ActuatorWithAlarm_BaseFB` (an abstract base) "lowered" only by running its own abstract `Alarms` as an
// empty body; now it is refused `graphical-body` ("is abstract: it holds no code"). Measured per POU with
// the since-deleted `probe-lowering-refusals.ts` (`git show 0db2d45fcd:packages/volt-lsp-iec/scripts/probe-lowering-refusals.ts`) before and after the 7 files: that is the only verdict that moved — four other
// already-refused bases gain the `graphical-body` code, nothing else changes.
// bodies 304 -> 300 on 2026-10-13, a CORPUS change, not a lowering one (openspec bridge-one-to-one 4.2): the live re-pull
// no longer materializes the 13 pro2193 objects that sit in folders excluded from build ("Turn Around Magazine", "Wrap
// Magazine", "Peeling", "Stack Status" — design §3 (3): such a folder is refused by name and its objects are not walked),
// 4 of them POUs with a body, none lowered. Restoring exactly those 13 files gives 304 / 53 again, so nothing else moved.
// 300 / 53 -> 301 / 54 on 2026-10-13, a CORPUS change again (bridge-one-to-one 4.2, the TwinCAT half): the re-pull of
// twincat-project14 brings `POUs/VltFixtureMembers.pou` (authored in fixture 14 at step 2), an FB whose ST body
// (`nTick := nTick + 1;`) lowers; its CFC method is `UNSUPPORTED` and holds no body. The other files the re-pull touched
// are manifest/stub/settings lines that carry no body.
const REACH = { bodies: 301, lowered: 54 }

/**
 * The METHOD/ACTION half of the same contract, measured 2026-09-19. `index.ts` said **none reachable** and that was
 * never true: a routine lowers when a POU that lowers calls it, and 543 do. Only 14 come from a POU that RUNS —
 * the rest are lifecycle methods (`FB_Init`, `call_after_global_init_slot`) reached from declaration-only POUs,
 * which is why the claim survived: nobody counted the half that was not zero.
 */
// 549 -> 558 the same day: `declarations/reference-binding.ts` measured that CODESYS binds a reference declared
// with `:=` exactly as it binds one declared with `REF=` (`refdecl_assign_spelling_write` writes 41 through it
// and reads it back from the target), so the TYPE decides rather than the operator — and nine more routines lower.
//
// 558 -> 582 on 2026-09-23, and this one is a RESOLVER fix rather than a coverage feature. A bare type name can
// have several candidates — every referenced library materializes its elements under their own names, and two
// libraries may export the same one — and `resolveNamedType` took the first of them, which meant the first
// BOUND, which meant `readdirSync` order. Names now resolve against the asking file's own library and that
// library's declared DEPENDENCIES (`symbols/precedence.ts`), so 24 more routines reach a type that resolves.
// The same change is why `REACHED_CODES` moves below: a body that gets further produces refusals it could not
// reach before.
//
// Note what did NOT move: 56/304 POUs still lower, and 20 routines still come from one that RUNS. No POU
// changed verdict — checked per-POU with `probe-lowering-refusals.ts` (`git show 0db2d45fcd:packages/volt-lsp-iec/scripts/probe-lowering-refusals.ts`), whose diff is entirely
// `type-unknown` refusals disappearing.
//
// 582 -> 20 on 2026-09-25, and the 582 was never the project's. 566 of those routines were the `FB_INIT`/`__INIT`
// methods of LIBRARY function blocks (3SLicense, AlarmManager, Component Manager…) — materialized declarations with
// no bodies, walked as roots and lowered as if their empty bodies did nothing. The "lifecycle methods reached from
// declaration-only POUs" above were those. Walking project files only, with library units marked, every routine
// that lowers is reached from a POU that RUNS: 20 of 20. (One more was reached only past an empty library body.)
// 20 -> 14 on 2026-09-28, the same correction as REACH: six routines were reached only past the chart and the FBD body
// that lowered as empty ST.
// 14 -> 13 on 2026-10-11, the same correction as REACH (openspec abstract-member-push): the routine was
// `ActuatorWithAlarm_BaseFB.Alarms`, an abstract method with no body slot (no `%LANGUAGE` line) its abstract owner's body
// (`Alarms();`, nothing else) ran as an empty body.
const ROUTINES = { routines: 13, routinesFromRunning: 13 }

/** Every node kind the IR defines — `IrExpr` and `IrStmt`, from `ir/expr.ts` and `ir/stmt.ts`. Checked by the compiler
 *  both ways, as BUILTINS is below: it held eight expression kinds while the IR defined eleven (`fresh`, `select`, and
 *  `address` added by 4.4 without a line here — review 4d), so a kind nothing built could not be reported. */
const EXPR_KINDS = ["const", "fresh", "load", "binary", "unary", "convert", "builtin", "invoke", "dispatch", "select", "address", "count", "reinterpret"] as const satisfies readonly IrExpr["kind"][]

const STMT_KINDS = ["assign", "if", "switch", "loop", "break", "continue", "return", "call", "eval"] as const satisfies readonly IrStmt["kind"][]

const BUILTINS = [
  "max", "min", "limit", "sel", "trunc", "abs", "expt", "shl", "shr", "rol", "ror", "mux",
  "sqrt", "ln", "log", "exp", "sin", "cos", "tan", "asin", "acos", "atan",
  "char", "setchar", "length", "address_order",
] as const satisfies readonly IrBuiltinName[]

/**
 * Floors, measured 2026-09-18: EVERY node kind and EVERY builtin is built by something. That is the good outcome
 * and it is worth pinning at full — there is no arm of either backend's `switch` that no test has ever reached.
 * 31 -> 24 on 2026-09-25 because the IR has 24: the nine string builtins are gone (the Standard library is ST now)
 * and `char`/`setchar` replaced them — still every one built, by the library bodies real code calls.
 */
// 8 -> 10 on 2026-10-09 (review 4d) because the list grew to the IR's 11: `fresh` and `address` are built, `select` (the
// multi-target tag read, `pointers/deref.ts`) is built by nothing — no fixture and no corpus POU reaches it since the
// byte image answers a pointer that holds addresses
const COVERED_EXPR_KINDS = 10

const COVERED_STMT_KINDS = 9

// 24 -> 25 on 2026-10-09 (transpile-restructure 4.4): `address_order`, two pointers ordered in the byte image, is built
// by the FIXTURES' pointer compares (`pointer_order_compare`); the corpus alone builds none (measured, review 4d)
// 25 -> 26 on 2026-10-10 (transpile-restructure 7.4.6): `length`, Standard.LEN_INTERNAL as a primitive, is built by every
// Standard string function a corpus POU calls (LEN, CONCAT, FIND, …)
const COVERED_BUILTINS = 26

/**
 * HOW MANY REGISTERED REFUSAL CODES ANY REAL PROGRAM ACTUALLY PRODUCES.
 *
 * `codes.test.ts` gates the registry STATICALLY — it greps `lower/` for the slugs and checks each resolves. That
 * proves a code is WRITTEN, not that it can be REACHED, and those are different claims: a refusal nothing can
 * produce is either dead code or a construct no test covers, and the registry cannot tell them apart.
 *
 * This walks the conformance fixtures and the whole corpus and records every code that actually comes out. It is a
 * FLOOR, not an exact figure — a new fixture may legitimately reach one more — but it only ever goes up, so a
 * refactor that quietly makes a refusal unreachable fails here.
 */
// 80 -> 79 because a refusal was RETIRED, not because one became unreachable: `var-temp-composite` refused a
// composite VAR_TEMP as "starting it over is not built", and `declarations/section-semantics.ts` measured that it
// behaves exactly as a scalar does (an ARRAY in VAR_TEMP counts 1 after three scans, a VAR one counts 3). The code
// is gone from the registry, so both totals drop by one. The floor only ever goes UP for a code that stops being
// produced; it comes down only when a code stops existing.
// 79 -> 78 for the same reason again: `value-string-order` refused MAX/MIN/LIMIT over a STRING because nothing
// recorded what the vendor orders two strings by. `strings/ordering.ts` recorded it — UNSIGNED, byte by byte, a
// prefix losing — so the refusal is retired and both totals drop by one.
// 78 -> 83 on 2026-09-23: the floor going UP, which is the direction it is allowed to move on its own. Names
// that used to resolve to the wrong candidate now resolve, so bodies get further and reach refusals they never
// used to — `layout-function_block` where `type-unknown` used to stop them first.
// 83 -> 78 on 2026-09-25, measured code by code against HEAD — none of it is a refusal going unreachable:
//   - `attr-init-unreached`, `call-target`, `fb-init-order`, `root-type` came from lowering the LIBRARY files' own
//     units as roots. The gate walked every file, and a library element is not the customer's code: it is reached
//     when project code calls it, so the walk is over project files now;
//   - `call-fb-inout` came from bodies that got past a library call by running its empty body;
//   - `call-named-args` came from the deleted Standard string intrinsic, which refused named arguments — a library
//     call with them now lowers like any call;
//   - and `call-library` counts again, 646 sites, where the lowering truly stops.
// 78 -> 77 on 2026-09-28: `call-inout-derived` came only from routines reached past those same two hidden bodies — a
// body "got further" by running a chart as nothing, as `call-fb-inout` did past an empty library body on 2026-09-25.
// The code still exists and nothing that is ST stopped producing it (same measurement as REACH above).
const REACHED_CODES = 77

/**
 * The project declarations whose type name has two or more DIFFERING candidates tied at the best rank —
 * listed rather than counted, because the interesting change is WHICH ones. A new entry is a new library
 * pair that collides, and the name says where to look.
 */
const AMBIGUOUS: readonly string[] = [
  "lenze-mid/Device/Plc Logic/Application/OEE/Local/L_OEEA_MachinePerformance/OEE_POUs/L_OEE_Input_IF.pou :: WEEKDAY",
  "lenze-mid/Device/Plc Logic/Application/OEE/Local/_FirstErrorCapture/GVL_FirstErrCapture.gvl :: scErrorData_base",
  "lenze-mid/Device/Plc Logic/Application/OEE/ProductionDataInputs.pou :: WEEKDAY",
  "pro2193/Device/Plc Logic/Application/01 Main/HMI.pou :: State",
  "pro2193/Device/Plc Logic/Application/01 Main/HMI_BFU.pou :: State",
  "pro2193/Device/Plc Logic/Application/04 Physical Interfaces/Ethernet/PNOZMulti2/PNOZMulti2.pou :: ERROR",
  "pro2193/Device/Plc Logic/Application/99 Library/Function Blocks/Fanuc FB/FanucFB.pou :: State",
  "pro2193/Device/Plc Logic/Application/99 Library/Function Blocks/ProductionStatsFB.pou :: State",
  "pro2193/Device/Plc Logic/Application/99 Library/Programs/TimeSettings.pou :: GetDateAndTime",
  "pro2193/Device/Plc Logic/Application/99 Library/Programs/TimeSettings.pou :: SetDateAndTime",
  "pro2193/Device/Plc Logic/Application/99 Library/Programs/TimeSettings.pou :: SetTimeZoneInformation",
]

describe.skipIf(!hasCorpus)("3. lowering is total, and its documented reach is measured", () => {
  test("NOTHING THROWS — invalid input ends in a LowerDiagnostic, never an exception", () => {
    expect(pass().throws).toEqual([])
  }, LOWERING_TIMEOUT)

  test(`REACH — the documented figures are what the corpus measures`, () => {
    const p = pass()
    console.log(`  [lowering] ${p.lowered}/${p.bodies} POUs with a body lower; ${p.routines} routines, ${p.routinesFromRunning} of them from a POU that runs`)
    // If this fails after a deliberate coverage change, update these constants (the figures live here alone;
    // `src/transpile/index.ts` states the rule). The documented reach is a contract a reader relies on; a plan for this very
    // component once justified itself with a figure 470x the real one, which is what this exists to prevent.
    expect({ bodies: p.bodies, lowered: p.lowered }).toEqual(REACH)
    expect({ routines: p.routines, routinesFromRunning: p.routinesFromRunning }).toEqual(ROUTINES)
  }, LOWERING_TIMEOUT)

  /**
   * AMBIGUITY PRECEDENCE CANNOT SETTLE — pinned, not fixed, and deliberately not a diagnostic.
   *
   * A project file can name a type that two referenced libraries both export with DIFFERENT declarations:
   * `GetDateAndTime` comes from `CAA DTUtility` and from `CAA RTCLK`, and they are not the same function
   * block. Both are rank 2 for project code (any library it references), so `symbols/precedence.ts` has
   * nothing left to separate them and falls to the URI tiebreak — a stable answer, not a known-correct one.
   *
   * <b>Why a gate and not a warning.</b> Measured over the corpus's 1,142 project files: 3,291 named types
   * produce 23 ties, and 20 of those are between IDENTICAL declarations — one library re-exporting another's
   * element, where either choice is right. Reporting all 23 would be 20 false positives, and the 11 that
   * remain sit in projects that BUILD CLEAN, so the vendor is not objecting either. An LSP-only message is a
   * false positive by this package's own rule, so the count stays visible to US rather than shown to an
   * engineer CODESYS never warns.
   *
   * If this list grows, a new project has hit a name two libraries answer to differently. Read the entries
   * before touching the figure.
   */
  test("AMBIGUOUS NAMES — the coin tosses precedence cannot settle, pinned", () => {
    const p = pass()
    console.log(`  [ambiguity] ${p.ambiguous.length} project declarations name a type two libraries differ on`)
    expect(p.ambiguous.sort()).toEqual([...AMBIGUOUS])
  }, LOWERING_TIMEOUT)

  test("REFUSAL REACH — a registered code that no real program produces is reported", () => {
    const registered = Object.keys(LOWER_CODES)
    const families = LOWER_CODE_PREFIXES.map((x) => x.prefix)
    const produced = new Set(pass().codes)

    // the fixtures too: many refusals need a shape the corpus does not happen to contain
    for (const t of ALL_TESTS) {
      // assembled exactly as `backends` does it, so both gates read the same program from a fixture
      const { source, gvls } = assembleFixture(t, ALL_TESTS)
      try {
        for (const d of lowerSource(source, "PLC_PRG", gvls, undefined, PROJECT_BASE).diagnostics ?? []) produced.add(d.code)
      } catch {
        // a throw is question 3's first assertion, not this one's
      }
    }

    const reached = registered.filter((c) => produced.has(c) || families.some((f) => c.startsWith(f)))
    const never = registered.filter((c) => !reached.includes(c))
    console.log(`  [refusals] ${reached.length} of ${registered.length} registered codes are produced by a real program`)
    console.log(`  [refusals] ${never.length} are not: ${never.slice(0, 8).join(", ")}${never.length > 8 ? ", …" : ""}`)
    expect(reached.length).toBeGreaterThanOrEqual(REACHED_CODES)
  }, LOWERING_TIMEOUT)

  test("IR COVERAGE — every node kind and every builtin the IR defines is built by something", () => {
    const p = pass()
    for (const t of ALL_TESTS) {
      const { source, gvls } = assembleFixture(t, ALL_TESTS)
      try {
        const { pou } = lowerSource(source, "PLC_PRG", gvls, undefined, PROJECT_BASE)
        if (pou !== undefined) fromPou(pou, p.kinds, p.builtins)
      } catch {
        // as above
      }
    }
    const missingExprs = EXPR_KINDS.filter((k) => !p.kinds.has(k))
    const missingStmts = STMT_KINDS.filter((k) => !p.kinds.has(k))
    const missingBuiltins = BUILTINS.filter((b) => !p.builtins.has(b))
    console.log(`  [ir] expressions ${EXPR_KINDS.length - missingExprs.length}/${EXPR_KINDS.length}${missingExprs.length ? ` — never built: ${missingExprs.join(", ")}` : ""}`)
    console.log(`  [ir] statements ${STMT_KINDS.length - missingStmts.length}/${STMT_KINDS.length}${missingStmts.length ? ` — never built: ${missingStmts.join(", ")}` : ""}`)
    console.log(`  [ir] builtins ${BUILTINS.length - missingBuiltins.length}/${BUILTINS.length}${missingBuiltins.length ? ` — never built: ${missingBuiltins.join(", ")}` : ""}`)
    expect(EXPR_KINDS.length - missingExprs.length).toBeGreaterThanOrEqual(COVERED_EXPR_KINDS)
    expect(STMT_KINDS.length - missingStmts.length).toBeGreaterThanOrEqual(COVERED_STMT_KINDS)
    expect(BUILTINS.length - missingBuiltins.length).toBeGreaterThanOrEqual(COVERED_BUILTINS)
  }, LOWERING_TIMEOUT)
})
