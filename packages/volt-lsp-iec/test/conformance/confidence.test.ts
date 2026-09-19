/**
 * HOW WELL IS EACH FIXTURE EVIDENCED? — the rating, and the gate that keeps it honest.
 *
 * A fixture is a question put to the vendor. What it is worth depends entirely on whether the vendor ANSWERED and
 * whether we match — and nothing said which fixtures were in which state. "963 fixtures" reads as 963 facts; it is
 * not. Some are measured and matched, some are measured and NOT matched, and some have never been asked.
 *
 * Every fixture now carries its rating (`t.evidence`), generated into `fixtures/evidence.generated.ts` by
 * `bun run rate:fixtures` and merged by `fixtures/index.ts`. This file is the other half of that arrangement: it
 * RECOMPUTES every rating and fails if a stored one disagrees. Derived data committed to source is only safe with a
 * gate like this one; without it the ratings would rot the first time a recording landed.
 *
 * `support/evidence.ts` defines what each rating means and computes it — one implementation, so the generator and
 * this gate can never measure different things.
 *
 * WHAT THIS DOES NOT DO: compare values. `transpile.test.ts` owns that, in both backends, using the vendor's own
 * display formats. A first version re-implemented it here and reported 97 false divergences on a green suite.
 */
import { describe, expect, test } from "bun:test"
import { ALL_TESTS } from "./fixtures/index.js"
import { EVIDENCE_ORDER, type Evidence, rateFixture } from "./support/evidence.js"

/** Every fixture's rating, computed fresh. */
let cached: Map<string, Evidence> | undefined
const computed = (): Map<string, Evidence> => (cached ??= new Map(ALL_TESTS.map((t) => [t.name, rateFixture(t, ALL_TESTS)])))

/**
 * Ceilings, not targets. `unasked` is the normal state of a fixture written before the next recording, and `refused`
 * is an answer — neither is a problem. These exist so the numbers stay visible rather than assumed, and so the ones
 * that mean something is missing or wrong cannot grow quietly.
 */
const CEILINGS: Partial<Record<Evidence, number>> = {
  // 6 -> 4. `real_to_dint_below_range` and `real_to_dint_runtime_below` are RESOLVED: 192 measured cells showed the
  // REAL->INT conversion happens at the DESTINATION'S register width, so a DINT gets the 32-bit indefinite where a
  // LINT gets the 64-bit one. Four points could not show that, and it had been parked as unexplainable.
  // What is left is two families, both about a vendor routine rather than a rule: trig argument reduction for a huge
  // angle (`op_math_trig`, `mathdom_sin_large`, `mathdom_cos_large`) and STRING being UTF-8 bytes.
  // 4 -> 5. `string_high_byte_escape` is RESOLVED — a STRING holds UTF-8 bytes and `literal-value.ts` stores them
  // — and `strings/escapes.ts` added `$80`, the one cell nothing explains: LEN answers 3 where every other escape
  // at or above 0x80 answers 2, and no reading that gives 3 there leaves `$81` at 2. Deferred rather than fitted.
  // 5 -> 3. `$80` is RESOLVED too, by widening the probe: `$hh` is a WINDOWS-1252 byte, not the code point U+00XX,
  // and sixteen cells across 0x80..0x9F follow that codepage exactly. What is left is one family — CODESYS's trig
  // is the x87 FPU, whose 66-bit argument reduction and few-ULP kernel are named at `interp/values.ts` and
  // deliberately not emulated.
  diverges: 3,
  // 18 -> 34 because the MEASUREMENT changed, not because gaps appeared. `refused` claimed the vendor rejects a
  // source AND so do we, while only checking the vendor; 16 fixtures were counted as evidence while the LSP accepted
  // them silently (`cc_reserved_name_s_string` and its neighbours). The rating asks both sides now.
  // 35 -> 36: `tc_nc_axis` reached a compiler for the first time and came back "Unknown type: 'AXIS_REF'", which the
  // LSP does not say.
  // 36 -> 2, over a run of measurements rather than one change: the signature-name family (a harness fault — the
  // rating was reading the TRANSPILER's assembly, two POUs in one file), the operator call forms, `__POSITION` and
  // `__CURRENTTASK`, the `CALC` family, `ANYNUM_TO_*`, `FB_Init`'s arguments, `__QUERYPOINTER`'s first operand and
  // `__NEW`'s pragma. The two left are the `???` target over a call, where the fixture and the corpus disagree
  // because the compiler never reads network text — see `network/network-analysis.ts`.
  "lsp-gap": 2,
  // 21 -> 25 by RECLASSIFICATION, not regression: fixtures that had never been ASKED turn out to be ones the vendor
  // compiles and we refuse — `refuse_var_temp_struct`, two pointer derefs — which is exactly what this rating is for.
  // 25 -> 27. `conversions/cross-family.ts` asked 76 conversions across the isolated families and found 35 the
  // transpiler refused; 33 are implemented now (the whole date family plus TIME<->LTIME, one tick rule). The two
  // left are `LTIME_TO_STRING` and `REAL_TO_STRING`, whose FORMAT is a fact one recording cannot generalize — one
  // duration does not show whether an LTIME prints `us` and `ns` components, and one REAL does not show how many
  // digits. They are refused honestly until a format sweep asks properly.
  // 27 -> 49. `conversions/to-string-format.ts` recorded eleven shapes each of `REAL_TO_STRING` and
  // `LREAL_TO_STRING`, and the two widths do not agree on the case of the exponent (`1.2345679E08` against
  // `1.0e20`), on where plain notation stops, or on how many digits survive. Reproducing that from eleven points
  // would be inventing the rest of it, and the prelude mirrors these line for line — a guess is a silent divergence
  // between the backends, not a rough edge. 22 fixtures refuse on purpose, and the table in `lower/builtins.ts` is
  // what a proper format sweep would extend. `LTIME_TO_STRING` from the same sweep IS implemented: its boundaries
  // are all measured and it is a TIME's format with three more units.
  // 49 -> 53. Six of those are address ALIASING — two names on one storage, which the vendor does and this has no
  // byte-addressable area to do in. The whole model is measured at the refusal in `lower/storage.ts` (little-endian,
  // addresses numbered in UNITS, bit 0 the least significant) and waiting for that area. `not-lowered` is the honest
  // rating for it: the vendor runs them and we refuse.
  // 53 -> 55: `atomic_xadd_pointer` and `atomic_cas_pointer` — the two probes the vendor ACCEPTS. They take the
  // address of a local and pass it to an atomic, which `pointer-targets` refuses; the interesting half (what the
  // operators demand of a non-pointer) is measured and implemented.
  // 55 -> 75, and the whole rise is ONE formatter told apart from another. A format sweep of 70 more cells
  // determined `LREAL_TO_STRING` completely (fifteen significant digits, fixed while the exponent is 0..13,
  // lowercase `e`) — it is implemented in both backends and its 35 cells are `confirmed`. `REAL_TO_STRING` is a
  // DIFFERENT formatter and the same sweep showed it is not derivable: two of its exponential cells print eight
  // significant digits beside four that print seven at the same magnitudes, and four fractions round their
  // seventh digit where rounding the value does not (1/3 is '0.3333334', 1/9 prints eight digits and stops).
  // Its 35 cells refuse on purpose, with 70 measurements written down rather than a rule invented from them.
  // 75 -> 80. `declarations/constant-folding.ts` asked 31 cells about what an initial value may hold; 26 of them
  // now lower (a conversion, a shift, SIZEOF of a type, MIN/MAX/SEL/MUX/ABS/TRUNC/EXPT/SQRT, nested and
  // parenthesised). The five here are the ones that are NOT constants and say so:
  //   `cfold_user_function`, `cfold_user_function_reads_global`  a user FUNCTION runs, and sees an initialized global
  //   `cfold_argument_declared_first`, `cfold_non_constant_argument`  initializers run in DECLARATION ORDER
  //   `cfold_sizeof_var`  SIZEOF of a variable declared LATER — constant to the vendor, and our fold needs the slot
  // The first four are one finding: a CODESYS initializer is an initialisation SEQUENCE, not a fold. Modelling
  // that is the next increment, and these are its acceptance tests.
  // 80 -> 88. `declarations/init-sequence.ts` asked 16 more cells about the initialisation SEQUENCE, and the eight
  // that stay here are the ones an FB INSTANCE'S fields raise: an instance's initializers run per instance, which
  // is the FB_Init machinery rather than the POU's init step, so `declareVars` only defers for the POU's own frame.
  // Deferring in a layout would take the DEFAULT silently, which is the bug the refusal was added for.
  // 88 -> 79. An FB INSTANCE'S field initializers run too now, as an implicit per-type routine `initStep` invokes
  // at each instance — which is what a routine already is, a body that runs on an instance. Built while the
  // LAYOUT is, before any body: a field may store an address (`p : POINTER TO X := ADR(y)`) and a body may only
  // dereference that pointer once the store is known.
  "not-lowered": 79,
  // `refused` is uncapped on purpose: it is the rating that GROWS when a probe family asks the vendor something it
  // rejects, which is the point of a probe family. 252 -> 322 in one sitting (`mixed-type`, `unary-operand`), all of
  // them questions with answers.
  // ZERO. Every fixture has been put to a real CODESYS. It was 140 while fixtures were written ahead of the recording
  // sessions, and the last 59 fell in two groups: some the vendor had genuinely never seen, and more that were
  // SKIPPED BY THE RECORDER because they declared nothing readable — a DUT, a GVL, an INTERFACE, an FB whose only
  // members are VAR_TEMP. Those were never unanswerable; they were unasked, which is a different thing and a worse
  // one. A fixture added from here starts at 0 and gets recorded, or it says in `execSkip` why it cannot be.
  unasked: 0,
}

describe("how well each fixture is evidenced", () => {
  test("the stored rating on every fixture matches the computed one", () => {
    // The whole reason `evidence` can live in a generated file: a stale entry is a red test, not a quiet lie.
    const byName = new Map(ALL_TESTS.map((t) => [t.name, t]))
    const stale = [...computed()]
      .filter(([name, rating]) => byName.get(name)?.evidence !== rating)
      .map(([name, rating]) => `${name}: stored ${byName.get(name)?.evidence ?? "(none)"}, computed ${rating}`)
    if (stale.length > 0) console.log("  [confidence] run `bun run rate:fixtures`")
    expect(stale).toEqual([])
  })

  test("the distribution, printed so a status report quotes a measured number", () => {
    const all = computed()
    const count = (r: Evidence): number => [...all.values()].filter((x) => x === r).length
    const total = all.size
    const pct = (n: number): string => `${((n / total) * 100).toFixed(1)}%`

    console.log(`  [confidence] ${total} fixtures`)
    for (const r of EVIDENCE_ORDER) console.log(`  [confidence]   ${r.padEnd(12)} ${String(count(r)).padStart(4)}  ${pct(count(r)).padStart(6)}`)

    // The number a status report should quote is not "963 fixtures", which counts QUESTIONS. It is how much of what
    // the vendor answered we actually match.
    const executed = count("confirmed") + count("diverges")
    const answered = count("confirmed") + count("refused") + count("not-lowered") + count("diverges")
    console.log(`  [confidence] the vendor ANSWERED ${answered} of ${total} (${pct(answered)})`)
    console.log(
      `  [confidence] of the ${executed} we both EXECUTE, we match ${count("confirmed")} — ${executed === 0 ? "n/a" : `${((count("confirmed") / executed) * 100).toFixed(1)}%`}`,
    )
    expect(total).toBeGreaterThan(900)
  })

  test("each rating stays within its ceiling, and the ones that matter are named", () => {
    const all = computed()
    const named = (r: Evidence): string[] => [...all].filter(([, x]) => x === r).map(([n]) => n)

    // DIVERGES is the only rating that means something is WRONG rather than missing. Every one carries
    // `deferred.transpile` saying what was measured and why it is not matched yet; a NEW one is a fixture that
    // started disagreeing with the vendor without anybody writing down why.
    console.log(`  [confidence] diverges: ${named("diverges").join(", ") || "none"}`)
    console.log(`  [confidence] not-lowered: ${named("not-lowered").length} the vendor runs and lowering refuses`)
    console.log(`  [confidence] unasked: ${named("unasked").length} have no recording — run \`bun run record:exec\``)

    const over = EVIDENCE_ORDER.filter((r) => CEILINGS[r] !== undefined && named(r).length > CEILINGS[r]!).map(
      (r) => `${r}: ${named(r).length} > ${CEILINGS[r]!}`,
    )
    expect(over).toEqual([])
  })
})
