/**
 * THE MAP ITSELF — the pure halves of its measured columns, the table being total (every stored rating, tier,
 * oracle, shape, size and note matches the computed one) and the evidence ratchet. The contract and the selection are
 * `support/fixture-suite.ts`'s (transpile-restructure 1.8.7).
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { emitRust } from "../../src/transpile/index.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { assembleFixture } from "./support/fixture-units.js"
import { assertNotes, deadNotes, notesOf } from "./support/notes/notes.js"
import { NOTES } from "./support/notes/notes.data.js"
import { renderNotes } from "./support/notes/render.js"
import { correctnessOf } from "./support/transpile/correctness.js"
import { edgeSeeds, reachesLibm } from "./support/transpile/edge.js"
import { assertPolicy } from "./support/transpile/lint-policy.js"
import { divergesOf } from "./support/transpile/row.js"
import { emissionShape, normalizeRustLine, shapeId, sizeRatio } from "./support/transpile/shape.js"
import { tierOf } from "./support/transpile/tier.js"
// the string blob a string program starts with — a deep path, test support only (the runtime registry is not surface)
import { runtimeText } from "../../src/transpile/emit/rust/runtime/index.js"
import { NaNBits } from "../../src/transpile/semantics/nan.js"
import { elementaryType, elementaryTypeRef } from "../../src/frontend/types/index.js"
import { EVIDENCE_ORDER, rateFixture, type Evidence } from "./support/evidence.js"
import { lowering, rated, SELECTION, whole } from "./support/fixture-suite.js"

const STRING_PRELUDE = runtimeText("string")

// ─── the table itself ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every rating is either handled above or listed here with why. This is what makes the selection total: add a
 * rating to `EVIDENCE_ORDER` without a row and this fails naming it, where four hand-written filters would each
 * have silently skipped it.
 */
const NO_ROW: Partial<Record<Evidence, string>> = {
  unasked: "nothing has been measured, so there is nothing to assert — the ceiling below holds it at zero",
}

/**
 * THE PURE HALVES OF THE MAP'S MEASURED COLUMNS — the normalizer behind `shape` and the input set behind `edge`,
 * pinned on their own so a change to either is a red line here before it is 2,300 changed rows in the map.
 *
 * The two ids below are the ones the overnight review (transpile-review-2026-09-29) printed into its `shapes.json`
 * for these lines. Pinning them is what "the same normalization the measure step used" means in a test: the
 * review's lean items and `NOTES` are keyed by those ids, and a normalizer that drifted would orphan all of them.
 */
describe("the map's measured columns — the pure halves", () => {
  test("a line normalizes to its construct: identifiers, literals and temporaries are erased, types are kept", () => {
    expect(normalizeRustLine("    self.total = (self.total as i32).wrapping_add(1i32) as i16; // step")).toBe(
      "self.f = (self.f as i32).wrapping_add(Li32) as i16;",
    )
    expect(normalizeRustLine("        let __mod_l_3 = helper(5u8);")).toBe("let __mod_l_N = m(Lu8);")
    expect(normalizeRustLine('    name: IecString::<12>::lit(b"hi"),')).toBe("x: IecString::<L>::lit(B),")
    // the SUFFIX is the construct: an i16 and a u8 store are different emissions
    expect(normalizeRustLine("x = 1i16;")).not.toBe(normalizeRustLine("x = 1u8;"))
    expect(normalizeRustLine("alpha = 1i16;")).toBe(normalizeRustLine("beta = 7i16;"))
  })

  test("a construct's id is the review's id for the same line", () => {
    expect(shapeId("loop {")).toBe("521ba042ac")
    expect(shapeId(normalizeRustLine("    limit: 5,"))).toBe("fbde4d6e1e")
  })

  test("a fixture's shape is its constructs in order — renaming is invisible, reordering is not", () => {
    const a = "pub struct P {\n    pub a: i16,\n}\nfn scan() {\n    self.a = 1i16;\n    self.b = self.a;\n}\n"
    const renamed = a.replaceAll("self.a", "self.zz").replace("pub a", "pub zz").replace("1i16", "9i16")
    const swapped = "pub struct P {\n    pub a: i16,\n}\nfn scan() {\n    self.b = self.a;\n    self.a = 1i16;\n}\n"
    expect(emissionShape(renamed)).toEqual(emissionShape(a))
    expect(emissionShape(swapped).shape).not.toBe(emissionShape(a).shape)
    // braces are boilerplate, not constructs
    expect(emissionShape(a).constructs.length).toBe(5)
  })

  test("the prelude is not the fixture's construct", () => {
    const body = "pub struct P {\n    pub s: IecString<5>,\n}\n"
    expect(emissionShape(STRING_PRELUDE + body)).toEqual(emissionShape(body))
  })

  test("a fixture's constructs come with their normalized lines, one per id", () => {
    const code = "fn scan() {\n    self.a = 1i16;\n    self.b = self.a;\n}\n"
    const { constructs, lines } = emissionShape(code)
    expect(lines).toEqual(["fn scan() {", "self.a = 1i16;", "self.b = self.a;"].map((l) => normalizeRustLine(l)))
    expect(constructs).toEqual(lines.map(shapeId))
  })

  test("a row's notes are the ids of its noted constructs, deduplicated and sorted", () => {
    const [first, second] = Object.keys(NOTES).sort()
    const unnoted = shapeId("no review ever judged this line")
    expect(NOTES[unnoted]).toBeUndefined()
    expect(notesOf([unnoted])).toEqual({})
    expect(notesOf([second!, unnoted, first!, second!])).toEqual({ notes: [first!, second!] })
  })

  test("the map's NOTES section renders every note's full text under its construct line, by id", () => {
    const notes = {
      bbbbbbbbbb: { improvement: 'say "less"', tasks: ["keep:nothing to change"] },
      aaaaaaaaaa: { improvement: "one", alternatives: ["x", "y"], chosen: "y", why: "because", tasks: ["7.3.1", "7.2.2"] },
    }
    const lines = new Map([
      ["aaaaaaaaaa", "self.f = Li16;"],
      ["bbbbbbbbbb", "loop {"],
    ])
    const text = renderNotes(notes, lines)
    expect(text).toContain(
      [
        "export const NOTES: Readonly<Record<string, ShapeNote>> = {",
        "  // self.f = Li16;",
        '  "aaaaaaaaaa": {',
        '    improvement: "one",',
        "    alternatives: [",
        '      "x",',
        '      "y",',
        "    ],",
        '    chosen: "y",',
        '    why: "because",',
        '    tasks: ["7.3.1", "7.2.2"],',
        "  },",
        "  // loop {",
        '  "bbbbbbbbbb": {',
        '    improvement: "say \\"less\\"",',
        '    tasks: ["keep:nothing to change"],',
        "  },",
        "}",
      ].join("\n"),
    )
    expect(text.endsWith("}\n")).toBe(true)
    // a note whose construct no fixture emits has no line to print — refused, never printed without one
    expect(() => renderNotes(notes, new Map([["aaaaaaaaaa", "loop {"]]))).toThrow(/bbbbbbbbbb/)
  })

  test("size counts emitted lines per ST line, the prelude and blank lines excluded", () => {
    const rust = "pub struct P {\n\n    pub a: i16,\n}\n"
    expect(sizeRatio(rust, "PROGRAM P\n// note\nVAR a : INT; END_VAR\n\nEND_PROGRAM", [])).toBe(1)
    expect(sizeRatio(STRING_PRELUDE + rust, "PROGRAM P\nEND_PROGRAM", [])).toBe(1.5)
    expect(sizeRatio(rust, "PROGRAM P\n", [{ source: "VAR_GLOBAL\nEND_VAR" }])).toBe(1)
  })

  const elementary = (name: string, length?: number) => ({ ...elementaryTypeRef(elementaryType(name)!), ...(length === undefined ? {} : { length }) })
  const labels = (name: string, length?: number) => edgeSeeds(elementary(name, length)).map((s) => s.label)

  test("the edge inputs of an integer are its extremes, zero, one and minus one", () => {
    expect(labels("INT")).toEqual(["INT#-32768", "INT#-1", "INT#0", "INT#1", "INT#32767"])
    // an unsigned type has no -1 to seed: its -1 IS its maximum, one past its range from below
    expect(labels("USINT")).toEqual(["USINT#0", "USINT#1", "USINT#255"])
    expect(labels("LWORD")).toEqual(["LWORD#0", "LWORD#1", "LWORD#18446744073709551615"])
    const [min] = edgeSeeds(elementary("DINT"))
    expect(min).toEqual({ label: "DINT#-2147483648", interp: -2147483648n, rust: "(-2147483648i128) as _" })
  })

  test("the edge inputs of a REAL reach NaN, both infinities, both zeros and the largest finite value", () => {
    for (const name of ["REAL", "LREAL"]) {
      const seeds = labels(name)
      for (const l of ["NaN", "+inf", "-inf", "0", "-0", `${name}_MAX`, `-${name}_MAX`, "min_subnormal"])
        expect(seeds).toContain(`${name}#${l}`)
    }
    // the SAME NaN in both backends: the interpreter's is its bits (`NaNBits`, transpile-restructure 8.2), as the Rust's is
    const nan = edgeSeeds(elementary("REAL")).find((s) => s.label === "REAL#NaN")!
    expect(nan.interp).toEqual(new NaNBits(0x7fc00000n, 32))
    expect(nan.rust).toBe("f32::from_bits(0x7fc00000)")
  })

  test("a program that reaches the platform's libm is not an edge question the repo can answer", () => {
    expect(reachesLibm("self.r = self.x.powf(2.0f32);")).toBe(true)
    expect(reachesLibm("self.r = (self.x as f64).ln();")).toBe(true)
    expect(reachesLibm("self.r = self.x.sin();")).toBe(true)
    // IEEE-754 defines these to the last bit on every platform
    expect(reachesLibm("self.r = self.x.sqrt(); self.q = self.x.abs(); self.t = self.x.trunc();")).toBe(false)
    // the prelude is the same text everywhere, and does not reach it
    expect(reachesLibm(STRING_PRELUDE)).toBe(false)
  })

  test("the edge inputs of a string are empty and full; of a BOOL both values", () => {
    expect(labels("STRING", 5)).toEqual(["''(empty)", "'A'x5(max length)"])
    expect(edgeSeeds(elementary("WSTRING", 3))[1]).toEqual({ label: "'A'x3(max length)", interp: "AAA", rust: "IecStr::lit(&[65u16; 3])" })
    expect(labels("BOOL")).toEqual(["FALSE", "TRUE"])
  })
})

describe("the table is total", () => {
  test("every fixture carries a rating this file has a row for", () => {
    const unknown = SELECTION.selected.filter((t) => !EVIDENCE_ORDER.includes(t.evidence as Evidence)).map(
      (t) => `${t.name}: ${t.evidence ?? "(none)"}`,
    )
    expect(unknown).toEqual([])
  })

  test("the stored rating on every fixture matches the computed one", () => {
    // The whole reason `evidence` can live in a generated file: a stale entry is a red test, not a quiet lie.
    const stale = SELECTION.selected.map((t) => [t, rateFixture(t, ALL_TESTS)] as const)
      .filter(([t, rating]) => t.evidence !== rating)
      .map(([t, rating]) => `${t.name}: stored ${t.evidence ?? "(none)"}, computed ${rating}`)
    if (stale.length > 0) console.log("  [fixtures] run `bun run rate:fixtures`")
    expect(stale).toEqual([])
    // A BUDGET PROPORTIONAL TO THE WORK, because this had none — it ran on bun's 5s default, which is a default
    // and not a decision. `rateFixture` lowers AND runs every fixture, so the cost is linear in how many there
    // are: measured 2026-09-20, 2514 fixtures in ~6.0s, or 2.4ms each. Under full-suite load that tipped over 5s
    // and failed as a timeout, which reads as a hang rather than as "there are more fixtures now" — the same
    // shape as the rustc guard above, and the same fix.
    //
    // Checked for the quadratic first, because this suite has had two: `withDependencies` calls
    // `declarationIndex(all)` per fixture, which LOOKS like O(n) per call. It is memoized on the identity of
    // `all`, and `parsed` caches per fixture, so the walk is O(its own dependencies). There is no hidden term —
    // this is the work the gate exists to do.
  }, Math.max(30_000, SELECTION.selected.length * 10))

  /**
   * THE OTHER HALF OF THE SAME ROW. `tier` and `rust` are derived from the lowered IR and the recordings — no
   * compiler — so they are checked for every fixture here rather than inside the Rust block, which only reaches
   * the cases that have recorded values. `lints` is checked there, because only there is anything compiled.
   */
  test("the stored tier and oracle on every fixture match the computed ones", () => {
    const stale: string[] = []
    for (const t of SELECTION.selected) {
      const { pou } = lowering(t)
      const tier = pou === undefined ? undefined : tierOf(pou, t.pouName)
      if (tier !== t.transpile?.tier) stale.push(`${t.name}: tier stored ${t.transpile?.tier ?? "(none)"}, computed ${tier ?? "(none)"}`)

      // `compiles` VS `rejected` IS NOT DECIDED HERE, and asserting it was how this test started failing on the
      // six rows that are honestly `rejected`: no compiler runs in this block, so it cannot know which one a
      // fixture earned. The two Rust blocks above compile every lowered fixture and assert exactly that. What is
      // checkable WITHOUT a compiler is the rest of the claim, and all of it is checked:
      //   a row exists exactly when the fixture lowers, and
      //   `vendor` — the strongest thing the field says — is claimed only where a recording holds values.
      const rust = t.transpile?.rust
      if ((pou === undefined) !== (rust === undefined))
        stale.push(`${t.name}: rust stored ${rust ?? "(none)"}, but it ${pou === undefined ? "does not lower" : "lowers"}`)
      // `built: true` only so the call is well formed — this compares the `vendor` half, which does not depend on it
      const { source, gvls } = assembleFixture(t, ALL_TESTS)
      const inputs = [source, ...gvls.map((g) => g.source)].join("\n")
      if (rust !== undefined && (rust === "vendor") !== (correctnessOf(t.name, t.evidence ?? "", true, inputs) === "vendor"))
        stale.push(`${t.name}: rust stored ${rust}, and the recording says otherwise`)

      const diverges = divergesOf(t.name)
      if (JSON.stringify(diverges ?? null) !== JSON.stringify(t.transpile?.diverges ?? null))
        stale.push(`${t.name}: diverges stored ${JSON.stringify(t.transpile?.diverges)}, computed ${JSON.stringify(diverges)}`)
    }
    if (stale.length > 0) console.log("  [fixtures] run `bun run rate:fixtures`")
    expect(stale).toEqual([])
  }, Math.max(30_000, SELECTION.selected.length * 10))

  /**
   * THE COLUMNS THAT NEED NO COMPILER — the emission's `shape`, its `size`, and the ids of its constructs `NOTES`
   * judged — recomputed for every fixture that lowers, from the same emitted code the generator hashed. And the
   * map's own `NOTES` section, re-rendered from the authored table and the construct lines those fixtures emit: the
   * texts a row's `notes` point at are in the same file, so they are gated like every other column.
   */
  test("the stored shape, size and notes on every fixture, and the map's NOTES section, match the computed ones", () => {
    const stale: string[] = []
    const lines = new Map<string, string>()
    for (const t of SELECTION.selected) {
      const { pou } = lowering(t)
      if (pou === undefined) continue
      const code = emitRust(pou).code
      const { source, gvls } = assembleFixture(t, ALL_TESTS)
      const emitted = emissionShape(code)
      emitted.constructs.forEach((id, i) => lines.set(id, emitted.lines[i]!))
      const got = { shape: emitted.shape, size: sizeRatio(code, source, gvls), notes: notesOf(emitted.constructs).notes }
      const stored = t.transpile
      const want = { shape: stored?.shape, size: stored?.size, notes: stored?.notes }
      if (JSON.stringify(got) !== JSON.stringify(want)) stale.push(`${t.name}: stored ${JSON.stringify(want)}, computed ${JSON.stringify(got)}`)
    }
    if (stale.length > 0) console.log("  [fixtures] the emitted Rust changed — run `bun run rate:fixtures`")
    expect(stale).toEqual([])
    // the section renders the construct lines of EVERY fixture — a project-wide total a partial run cannot answer
    if (SELECTION.partial) return
    const map = readFileSync(join(import.meta.dir, "fixtures", "map.generated.ts"), "utf8")
    const section = renderNotes(NOTES, lines)
    if (!map.endsWith(section)) console.log("  [fixtures] the map's NOTES section is stale — run `bun run rate:fixtures`")
    expect(map.endsWith(section)).toBe(true)
  }, Math.max(30_000, SELECTION.selected.length * 10))

  /**
   * A NOTE ABOUT A CONSTRUCT NOBODY EMITS IS A NOTE ABOUT NOTHING — the refusal the generator makes for a dead
   * `ALLOWED` entry, made for `NOTES` here as well, so an emitter change that retires a construct cannot leave its
   * review note behind looking like open work.
   */
  whole("every note names a construct some fixture still emits, and says something", () => {
    expect(() => assertNotes()).not.toThrow()
    const emitted = new Set<string>()
    for (const t of ALL_TESTS) {
      const { pou } = lowering(t)
      if (pou !== undefined) for (const id of emissionShape(emitRust(pou).code).constructs) emitted.add(id)
    }
    expect(deadNotes(emitted)).toEqual([])
  }, Math.max(30_000, ALL_TESTS.length * 10))

  test("every allowed lint states the reason it is Volt's answer rather than a defect", () => {
    expect(() => assertPolicy()).not.toThrow()
  })

  test("the ratings with no row say why", () => {
    const handled = new Set<Evidence>(["confirmed", "refused", "not-lowered", "diverges", "lsp-gap", "unaskable"])
    expect(EVIDENCE_ORDER.filter((r) => !handled.has(r) && NO_ROW[r] === undefined)).toEqual([])
  })
})

// ─── ratchet one: how much of what the vendor answered we match ──────────────────────────────────────────────

/**
 * Ceilings, not targets. `unasked` is the normal state of a fixture written before the next recording, and
 * `refused` is an answer — neither is a problem. These exist so the numbers stay visible rather than assumed, and
 * so the ones that mean something is missing or wrong cannot grow quietly.
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
  // is the x87 FPU, whose 66-bit argument reduction and few-ULP kernel are named at `semantics/math.ts` and
  // deliberately not emulated.
  // 3 -> 4. `named_const_expression_keeps` (transpile-review-2026-09-29 task 2.3): CODESYS reads a constant whose
  // constant-EXPRESSION initializer overflows its type as the unwrapped fold (`D : SINT := K + 1` reads SINT#128);
  // lowering stores and reads it through a slot of the declared width.
  // 4 -> 58, ALL FOR MEASUREMENT. transpile-review-2026-09-29 landed a CODESYS-recorded fixture for every open root
  // cause ahead of its fix (tasks 6, 12, 14, 16-22, 24-33, 35, 36, 41, 42, 45-47), each carrying its task in
  // `deferred.transpile`. This number comes back down task by task as the fixes land.
  // 58 -> 57: task 18 refuses its fixture now (`not-lowered`).
  // `named_const_expression_keeps` (task 2.3) is RESOLVED: a CONSTANT's slot takes the width its unwrapped fold needs.
  diverges: 57,
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
  // 2 -> 3. `op_sys_queryinterface` is a gap this session CREATED, by making the fixture ask a real question:
  // its method body named an interface ANOTHER fixture declares, and `withDependencies` scans declarations
  // rather than bodies, so the interface was never pushed and every recording said `Unknown type`. It has never
  // measured `__QUERYINTERFACE` on either vendor. Given its own interface it now records CODESYS's real answer
  // (the FB must extend `__System.IQueryInterface`, and the operand must be an instance rather than a type),
  // and the LSP says nothing about any of it.
  // 3 -> 4. `cc_decl_init_dunder_unknown` is another gap a fixture CREATED by asking properly: both vendors
  // refuse an unknown `__` name in a declaration initializer at the PARSER, and `nameResolves` accepts every
  // unlisted `__` name on purpose — the blanket that keeps an unlisted system operator from false-positiving.
  // `system-initializer` answers the half the dialect table HAS a verdict for; this is the half it does not.
  // 4 -> 7. `for_limit_wider_than_counter_{dint_var,dint_expr,upper_bound}` (transpile-review task 13) asked
  // whether a FOR limit wider than an INT counter compiles, and it does NOT: "Cannot convert type 'DINT' to type
  // 'INT'". The LSP says nothing. A rise for measurement — the refusal is the follow-up.
  // 7 -> 17. transpile-review-2026-09-29 tasks 35, 37 and 40: ten sources CODESYS refuses (a FOR step or a CASE label
  // outside the type, an inverted CASE range, DATE/DT/TOD +/- LTIME) that the LSP accepts — `MEASURED_SILENT` names them.
  // 17 -> 18. frontend-conformance 2.4a review (2026-10-01): `unit_interface_property_accessor_var_output` and
  // `_var_in_out` asked whether an interface accessor may declare an output or in-out — CODESYS refuses the implementer's
  // getter against it ("Interface of overridden method '__GETVAL' … doesn't match declaration"), which the LSP does not
  // compare; niche, accepted (`deferred.lsp`, 0 occurrences in the corpora). A rise for measurement.
  // 18 -> 19. frontend-conformance 2.5 (2026-10-01): `expr_trailing_comma_conversion_call` — `INT_TO_DINT(a,)` is "')'
  // expected instead of ','" on both vendors (a conversion takes ONE argument), which the parser cannot tell from a user
  // function named like one; niche, accepted (`deferred.lsp`, 0 occurrences in the corpora). A rise for measurement.
  // 19 -> 22. frontend-conformance 2.5.6 (2026-10-02), new questions, no fixture moved: `expr_pool_qualified_call` and
  // `_global` (`__POOL.X` is a lookup in the POUs view, which the workspace does not model) and `expr_inline_assign_operand`
  // (a chain's inner target `1 + a`, ST4's) — each niche, accepted (`deferred.lsp`, 0 occurrences in the corpora). A rise
  // for measurement.
  // 22 -> 21. frontend-conformance 2.6 (2026-10-02): `expr_inline_assign_operand` agrees — a chain's inner target that is no
  // name is "no valid assignment target" (`statement-rules`).
  // 21 -> 22, FOR MEASUREMENT. The 2.6 review (2026-10-02): `lex_keyword_called_sys_pool` — `__pool(n);`, the member read
  // `__POOL` makes of the next token, which the LSP does not model (`MEASURED_SILENT`; niche, 0 occurrences).
  // 22 -> 24, FOR MEASUREMENT. frontend-conformance 2.7 (2026-10-02): `prag_if_defined_in_declaration` ("This code is not
  // supported in declaration part", CODESYS) and `prag_project_defined_in_declaration` (a declaration under an unset
  // `project_defined` dropped) — the declaration parser applies no conditional pragma (`MEASURED_SILENT`, both
  // `KNOWN_DIVERGENCES`; niche: accepted loss, 0 conditional directives in any declaration part of the corpora).
  // 24 -> 23. frontend-conformance 2.8.3 (2026-10-02): `cc_decl_init_dunder_unknown` — the PARSER refuses a `__` identifier
  // leading an initializer (every `__` operator a dialect has is its keyword; the `__SYSTEM` namespace is read through its
  // `.`), where name resolution had answered every `__` name on CODESYS.
  // 23 -> 26, FOR MEASUREMENT. frontend-conformance 2.10 (2026-10-02): P14's three `strict` refusals
  // (`prag_strict_enum_int_assign`, `_literal_not_a_member_assign`, `_add_literal`, both vendors) — `strict` is read by the
  // type compatibility of task 4.5.1, which owns it (`deferred.lsp`). Not niche: 56 `{attribute 'strict'}` in the corpora.
  // 26 -> 29, FOR MEASUREMENT. frontend-conformance 3.1 (2026-10-02), new questions, no fixture moved, each niche and accepted
  // (`deferred.lsp`, 0 occurrences in the corpora): `sym_var_external_of_ambiguous_global` (a VAR_EXTERNAL of a global two
  // lists declare), `sym_library_gvl_needs_qualification` (a library global read bare — the manifest carries no
  // qualified-access flag) and `sym_library_gvl_qualified_by_namespace` (`Stu.HALFSHIFT`: a namespace holds no list's
  // variable).
  // 29 -> 31, FOR MEASUREMENT. frontend-conformance 3.2 (2026-10-02), new questions, no fixture moved (`deferred.lsp`):
  // `inh_override_final_method` and `inh_abstract_method_not_implemented` — both vendors' words recorded, the CODESYS code
  // number unknown (a wire diagnostic is a catalog `Cnnnn`; `server/diagnostic-codes.ts` admits no new slug), 0
  // occurrences of either refusal in the corpora.
  // 31 -> 34, FOR MEASUREMENT. frontend-conformance 3.3 (2026-10-02), new questions, no fixture moved, each niche and accepted
  // (`deferred.lsp`, 0 occurrences in the corpora): `enum_member_vs_global` (a project global and a project enum member of
  // one name are ambiguous), `enum_member_vs_function_name` (the member before a FUNCTION of its name) and
  // `enum_library_member_vs_library_global` (Util's `TUESDAY`, a WEEKDAY member and a DAY_FLAGS global).
  // 34 -> 36, FOR MEASUREMENT. frontend-conformance 3.3 review (2026-10-02), new questions, no fixture moved (`MEASURED_SILENT`,
  // LB2 → 3.4.2): `enum_library_member_vs_project_function` / `_program` — CODESYS takes Util's member before a project
  // POU of its name; which libraries are open (their members candidates at all) is not in the manifest, and pro2193's 87
  // clean POU names beside qualified-access libraries' members say the LSP must not refuse without it.
  // 36 -> 43, FOR MEASUREMENT. frontend-conformance 3.4 (2026-10-02): 8 new library questions CODESYS refuses
  // (`deferred.lsp`, `CODESYS_LIBRARY_DIVERGENCES`, each niche: 0 occurrences in the corpora) — which libraries the
  // APPLICATION references, which require qualified access, which dependencies a namespace publishes, and which POUs are
  // INTERNAL are facts the manifest does not carry (`lib_ns_transitive_bare`, `_transitive_namespace`,
  // `_qualified_access_library_bare`, `_type_name_two_libraries_other_member`, `_direct_dependency_only`,
  // `_library_internal_function_bare`, `_qualified`, `_library_gvl_shared_list_name_bare`); and one closed:
  // `decl_type_unknown_qualified` (a qualifier naming nothing, `unknownQualifiedTypeName`).
  // 43 -> 55, FOR MEASUREMENT. frontend-conformance 3.5 (2026-10-02): 12 member cells both vendors refuse for an access
  // modifier checked after resolution, the LSP silent — "Cannot access private method B.M", an interface METHOD implemented PRIVATE "must
  // be PUBLIC" (`deferred.lsp`, `MEMBER_DIVERGENCES`): no catalog code for a METHOD's refusal (a PROPERTY's C0513/C0515
  // document another, unverified sentence), 0 occurrences in the corpora of a refused access (they build; pro2193's own
  // Application declares 525 such members, user code — not library code, as first written). No fixture moved.
  // 55 -> 60, FOR MEASUREMENT. frontend-conformance 4.1.3 (2026-10-03): 5 elementary-type cells both vendors refuse, the
  // LSP silent (`ELEMENTARY_RULE_DIVERGENCES`): REFERENCE TO BIT and ANY_NUM as a local (no catalog code), ANY_ELEMENTARY
  // and ANY_MAGNITUDE as a parameter type (no type on either vendor), VERSION stored whole into a STRING (a struct into an
  // elementary target is unchecked for every struct — task 4.5.3) — each niche, 0 occurrences in the corpora. No fixture moved.
  // 60 -> 62, FOR MEASUREMENT. frontend-conformance 4.3.4 (2026-10-03): 2 built-in result cells CODESYS refuses, the LSP
  // silent (`ARITHMETIC_RESULT_DIVERGENCES`, `CODESYS_POUNAME_IS_SIZED_BY_ITS_BODY`): `__VARINFO` into a STRING (the VAR_INFO
  // struct's members are unmeasured, and a struct into an elementary target is 4.5.3's) and `__POUNAME()` into an INT (a
  // STRING sized by the asking body's qualified name, which an ACTION's body does not carry). No fixture moved.
  // 62 -> 63, FOR MEASUREMENT. frontend-conformance 4d (2026-10-03): 4 constant-evaluation and storage cells the vendors
  // refuse, the LSP silent (`UNTYPED_OPERAND_AS_A_BOUND` `ce_fold_not_int_untyped`, `ce_fold_shl_untyped` — an untyped literal
  // under NOT or a shift has no width without a context; `UNTYPED_NOT_IN_A_SIGNED_CONTEXT`; `LIBRARY_ENUM_BASE_NOT_MATERIALIZED`
  // `dt_library_enum_storage`), each niche or the bridge's. No fixture moved.
  // 63 -> 65, FOR MEASUREMENT. frontend-conformance 4.7.4 (2026-10-03): 2 alias-initializer cells both vendors refuse, the
  // LSP silent (`ALIAS_INITIALIZER_NOT_CHECKED` `dt_alias_init_out_of_range`, `dt_alias_init_wrong_type`: an alias's
  // initializer is checked as often as the alias is used, a project-wide count) — niche, 0 occurrences in the corpora. No
  // fixture moved.
  // 65 -> 72, FOR MEASUREMENT. lsp-sfc-step-names 1.1 (2026-10-03): 7 SFC step cells CODESYS refuses, the LSP wording them
  // otherwise or silent because no step of the chart is in scope (`deferred.lsp` on each, `SFC_STEPS_NOT_IN_SCOPE`): an
  // unknown member of a step, the step as a value, `.t` as TIME and `.x` as BOOL into an INT, a variable of the step's name,
  // a step written from outside, an action's `.x`. Fixed by 2.1, which lowers this again. No fixture moved.
  // 72 -> 74, FOR MEASUREMENT. lsp-sfc-step-names 1 review (2026-10-03): the default step `Init`'s `.t` into an INT and its
  // unknown member `.y` — CODESYS refuses both, the LSP binds bare `Init` to a transitive library's enum member (LB2) and is
  // silent. Fixed by 2.1. No fixture moved.
  // 74 -> 70. lsp-sfc-step-names 2.1 (2026-10-03): a step read with a member is in scope (`types/infer/sfc-step`), which
  // answers 6 of those cells as CODESYS does (an unknown member, `.t` as TIME and `.x` as BOOL — of `S_Boot` and of the default
  // `Init` — and a step written from outside) and costs 2 (`sfc_step_typo`, `_typo_qualified`: with no chart in the text the
  // bet takes a typo read with a member for a step — niche: accepted loss, 0 occurrences in the corpora).
  // 70 -> 72, FOR MEASUREMENT. lsp-sfc-step-names 2 review (2026-10-03): the edge of the bet, recorded (S15) —
  // `sfc_step_typo_other_member` (`S_Bot.y`: CODESYS "Identifier 'S_Bot' not defined", the LSP a step's unknown member) and
  // `sfc_step_pointer_global_no_step` (a pointer global read with a member: CODESYS "no structured variable", the LSP takes
  // it for a step, as it must for the step S15 measured over a pointer global) — the bet's price, niche: accepted loss
  // (0 occurrences in the corpora). No fixture moved.
  // 72 -> 73, FOR MEASUREMENT. lsp-sfc-step-names gate 2 (2026-10-03): S16 `sfc_step_bit_const_qualified` — a bit numbered
  // by a list-qualified constant (`gw.GVL.cBit`), which CODESYS refuses ("Bit access requires literal or symbolic integer
  // constant") and the LSP passes in ANY POU, an ST one too — niche: accepted loss (0 occurrences in the corpora).
  // 73 -> 74, FOR MEASUREMENT. lsp-sfc-step-names gate 3 (2026-10-03): S3 `sfc_step_qualified_self_typo` — the field's
  // self-qualified shape with a typo (`PRG.S_Bot.x` in the SFC program's own action), which CODESYS refuses ("'S_Bot' is no
  // component of 'PRG…'") and the bet takes for a step, as from outside (`sfc_step_typo_qualified`) — niche: accepted loss
  // (0 occurrences in the corpora). No fixture moved.
  // 74 -> 75, FOR MEASUREMENT. analysis-conformance 3.3 (2026-10-06): `callarg_no_argument_variable_default` (MEASURED_SILENT
  // above), 3.8's to close. No fixture moved.
  // 75 -> 76, FOR MEASUREMENT. analysis-conformance 3.11 closed `ty_reference_to_bit` (-1); its gate review (2026-10-06)
  // measured an alias of REFERENCE TO BIT, `refbit_alias` and `refbit_alias_variable_unread` (+2), which both vendors refuse
  // and the LSP passes — REFERENCE_TO_BIT_ALIAS, niche: accepted loss (0 REFERENCE TO BIT in the corpora). No fixture moved.
  // 76 -> 81, FOR MEASUREMENT. transpile-restructure 2.6 (2026-10-08), new questions, no fixture moved:
  // `for_limit_wider_than_counter_dint_constant`, `_typed_literal`, `for_step_wider_than_counter_dint_paren`, `_upper_bound`
  // ("Cannot convert type 'DINT' to type 'INT'", the LSP half of RC 13 / RC 35, lsp-transpile-review-gaps 2.1) and
  // `for_step_wider_than_counter_dint_expr` (`BY k - 1` is a CODESYS parse error the parser accepts — niche: accepted loss,
  // 0 occurrences in the corpora). MEASURED_SILENT in `transpile-replay.test.ts`.
  // 81 -> 82, FOR MEASUREMENT (gate 2c, no fixture moved): `for_step_typed_literal_on_narrower_counter` (`BY INT#-1` on a
  // BYTE, "Cannot convert type 'INT' to type 'BYTE'"; lsp-transpile-review-gaps 2.1).
  // 82 -> 83, FOR MEASUREMENT (transpile-restructure 5.1, no fixture moved): `init_struct_field_fb_init_scope_local` (a
  // STRUCT field's FB_Init argument naming a local of the declaring POU, "Identifier '…' not defined" on both vendors) —
  // niche: accepted loss (0 occurrences in the corpora), its `deferred.lsp`.
  // 83 -> 84, FOR MEASUREMENT (transpile-restructure 6.17, no fixture moved): `tr_43_routine_output_dint_to_int` (a
  // FUNCTION's DINT output => an INT, "Cannot convert type 'DINT' to type 'INT'"; lsp-transpile-review-gaps 2.4).
  // 84 -> 85, FOR MEASUREMENT (transpile-restructure 6Ba+6Bb gate, no fixture moved): `tr_b5_time_times_wide_literal` (an
  // untyped literal past 32 bits beside a TIME, "Cannot convert type 'TIME' to type 'ULINT'" on both vendors) — niche:
  // accepted loss (0 occurrences in the corpora), its `deferred.lsp`.
  // 85 -> 87, FOR MEASUREMENT (transpile-restructure 8.2 step 8e, no fixture moved): `string_inout_narrower`,
  // `wstring_inout_narrower` (a STRING / WSTRING bound to a VAR_IN_OUT that declares more units, "String variable 'v' too
  // short for the VAR_IN_OUT parameter 'io' of …" on both vendors; lsp-transpile-review-gaps 2.5). MEASURED_SILENT.
  // 87 -> 74, CLOSED (lsp-transpile-review-gaps, 2026-10-11): the ten FOR limits and steps that do not convert into the
  // counter (1.1, 1.2, 2.1), the routine output `tr_43_routine_output_dint_to_int` (2.4) and the two string in-outs bound
  // narrower (2.5) rate `refused`. `for_step_wider_than_counter_dint_expr` stays, now by its `deferred.lsp` (2.2, niche).
  // 74 -> 88, FOR MEASUREMENT (transpile-refusal-classification 2.2, no fixture moved): fourteen of the `rk_*` asks are
  // invalid ST CODESYS refuses and the LSP says nothing about (a VAR_IN_OUT bound to another struct type, LIMIT with named
  // parameters, a FUNCTION output given `:=`, a program instance's property written from outside, `REF=` in a chain, a
  // pointer stepped by a STRUCT, an ARRAY[*] assigned whole, a STRING indexed twice, an init-slot METHOD's input, an
  // interface given a non-implementing FB or an INT, two partial accesses, MAX of a BOOL and a TIME) — each niche:
  // accepted loss (0 occurrences in the corpora), its `deferred.lsp` (the partial accesses `MEASURED_SILENT`: TwinCAT agrees).
  "lsp-gap": 88,
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
  // 79 -> 87. `semantics/try-catch.ts` measured `__TRY`/`__CATCH`/`__FINALLY`/`__ENDTRY` — the one construct that
  // CHANGES the fault model: a divide by zero inside one is caught (code 258), the logarithm of a run-time zero
  // too (338), and THE SCAN FINISHES where the same fault outside ends the application. Eight cells, complete and
  // deliberately not lowered: the model is written at the refusal in `lower/statements.ts` so the implementation
  // is not asked to guess, and the open design question is the Rust form (the emitter's faults are `panic!`).
  // 87 -> 89. `declarations/reference-binding.ts` asked what a reference bound at its DECLARATION does, and two of
  // its sixteen cells rebind afterwards — `refdecl_rebound_by_statement` (declaration bind, then `ref_ REF= other`)
  // and `refdecl_rebound_in_method` (rebound from a METHOD, and the new target SURVIVES to the next scan: seen=20).
  // Two targets is design §9 form 3, the tagged handle, which is not built — so these are refused honestly, and
  // they are the first measured acceptance tests form 3 has.
  // 89 -> 90. `sysop_position_value` reads `__POSITION`'s actual TEXT out of the simulator — the one question a
  // build cannot answer — and the transpiler has no business lowering a CODESYS source-position intrinsic.
  // 90 -> 98. `memory/pointer-parameters.ts` — eight fixtures RECORDED BEFORE the thing they measure is built,
  // which is the order `memory-model.ts` beside them used and the order `fixtures/README.md` asks for. They are
  // the acceptance tests for `pointer-model.md` §8 step 1: a `POINTER TO` input the callee only dereferences is a
  // VAR_IN_OUT binding with a `^` on every use. The recordings say the erasure is sound —
  //   `ptrparam_write`        the callee's `p^ := 77` changes the CALLER's variable, so it is a borrow, not a copy
  //   `ptrparam_two_targets`  one input, two call sites, two ADR arguments, two answers (11 and 22) — which is
  //                           precisely what form 1's ONE recorded target per pointer cannot represent
  //   `ptrparam_kept`         a pointer input stored in a field still reads its target three scans later, so the
  //                           handle form is real and this is the shape the borrow may NOT swallow
  // This number is expected to come back DOWN by eight when step 1 lands, and further as it clears the 105 POUs
  // `pointer-order` stops in the corpus. A ceiling that rises for measurement is not the same as one that rises
  // for a gap, and the eight below are the first kind.
  // 98 -> 94. Step 1 landed for a ROUTINE's pointer input — `ptrparam_read`, `_write`, `_two_targets` and
  // `_method` lower and match CODESYS.
  // 94 -> 95. `ptrparam_input_persists`, which answers the question that decides whether form 2 reaches an FB at
  // all: it does NOT. An FB's VAR_INPUT is a FIELD, and the recording says it keeps its address — supplied on one
  // call and OMITTED on the next, the body still reads 55 through it. So the address outlives the call by
  // construction, which is §4's own definition of a HANDLE.
  // 95 -> 92. FORM 3 READS. A pointer or reference naming several variables holds a TAG, and a read selects the
  // arm it names (`IrSelect` — `IrDispatch` with a place where the call is). `refuse_pointer_two_targets` reads b
  // after `p := ADR(a); p := ADR(b)`, and both `refdecl_rebound_*` follow a reference rebound after its
  // declaration, one of them from a METHOD and across a scan. Writing through such a pointer is still refused,
  // and says so: a place cannot express a select, so the write wants an `IrSwitch` over the arms.
  // 92 -> 103. transpile-review-2026-09-29's recorded fixtures that lowering refuses today — tasks 11, 15, 22 (THIS),
  // 23, 28, 34, 43 (three output conversions) and 44. Coverage the fixes are expected to take back.
  // 103 -> 104. `tr_18_queryinterface_into_global` (task 18): a wrong answer turned into a refusal — the query's edge
  // is foreign like the plain store's (`interface-instance-relative`); CODESYS's r1 = r2 = 1 wants form-3 lending.
  // 104 -> 108. Task 11 lowers its fixture (-1); task 16 (`call-fb-inout`: a METHOD reaching the in-out of an FB copied
  // whole) and task 17 (`pointer-type`: an ANY input's pValue dereferenced as another type, four) turn wrong answers
  // into refusals (+5) — CODESYS's answers want the copied binding tag and a byte view.
  // 108 -> 109, FOR MEASUREMENT. frontend-conformance 2.3a recorded `decl_var_generic_in_array` (an ARRAY OF a
  // VAR_GENERIC FB with its value builds and runs on CODESYS); lowering refuses VAR_GENERIC as it does for
  // `decl_var_generic` and `_read` — the transpiler's, not the front-end's.
  // 109 -> 111, FOR MEASUREMENT. frontend-conformance 2.3.6 recorded two type expressions CODESYS builds and runs that
  // lowering refuses: `decl_implicit_enum_in_array` (`a[1] := ia_b` — `place-not-local`, an implicit enum's value whose
  // declaration is an ARRAY OF it is no constant to lowering, `constants.ts` reads only a declaration typed directly)
  // and `decl_array_star_in_function_input` (a FUNCTION's `ARRAY[*]` VAR_INPUT indexed — `place-shape`). The
  // transpiler's, not the front-end's.
  // 111 stays, its members change (2.3b review): `decl_implicit_enum_in_array` LOWERS now (`constants.ts` reads an
  // implicit enum through the ARRAY OF it; confirmed), and `decl_array_star_in_method_input` (a METHOD's `ARRAY[*]`
  // VAR_INPUT, CODESYS builds and runs it) joins the function's. Both are `deferred.transpile`: lowering lends an open
  // array only as a VAR_IN_OUT; niche: accepted loss (0 occurrences in the corpora — their 36 `ARRAY[*]` are VAR_IN_OUT).
  // `decl_pointer_to_pointer_deref` was recorded refused by lowering and lowers too (`pointers.ts`: a pointer's storage
  // is its target's), so it adds nothing here.
  // 111 -> 113, FOR MEASUREMENT. frontend-conformance 2.4a recorded two units CODESYS builds and runs that lowering
  // refuses, each the transpiler's and not the front-end's: `unit_fb_extends_qualified` (an FB extending a LIBRARY FB,
  // `Standard.TON` — its base has no layout lowering reaches, `layout-base`; 0 qualified library bases in the corpora)
  // and `unit_type_extends_on_union` (a UNION of INT and DINT — `layout-union`, its overlaid bytes unmeasured; the
  // EXTENDS is only the warning's).
  // 113 -> 130, FOR MEASUREMENT. frontend-conformance 2.5.6 (2026-10-02) recorded 17 expressions CODESYS builds and runs
  // that lowering refuses, each the transpiler's and not the front-end's: nine inline assignments (`expr_inline_assign_*`
  // — `assign_expr` is lowered nowhere, `cp_inline_assignment` is not either), six global-namespace reads, writes and
  // calls (`expr_global_namespace_*`, the new `global_expr` node: "global_expr is not lowered yet"),
  // `expr_this_as_pointer` (`p := THIS`) and `expr_pool_qualified_fb_type` (whose `__POOL.` type the parser refuses).
  // 130 -> 132, FOR MEASUREMENT. The 2.5b review (2026-10-02) recorded two more CODESYS builds and runs that lowering
  // refuses: `expr_inline_assign_for_start` (`assign_expr`, as above) and `expr_global_namespace_enum_bound` — an array
  // bounded `E.Up...E.Left` is "not a sized array" (`aggregate-init`), and so it is with `..` and no dot: `constEval`
  // folds no enum value yet (task 4.6.1; 60-odd enum-bounded arrays in the corpora wait on it).
  // 132 -> 136, FOR MEASUREMENT. frontend-conformance 2.6 (2026-10-02) recorded four statements CODESYS builds and runs
  // that lowering refuses, each the transpiler's and not the front-end's: `stmt_try_nested` and
  // `stmt_try_catch_without_operand` (`__TRY` is lowered nowhere — `try_*` are not either), `stmt_bare_member` (a bare
  // expression statement, `bx.v;`) and `stmt_label_at_end` (JMP and its label).
  // 136 -> 137, FOR MEASUREMENT. The 2.6 review (2026-10-02): `stmt_function_own_name_bare` builds and runs (out = 12)
  // and lowering refuses its bare-name statement, as `stmt_bare_member`'s (the transpiler's).
  // 137 -> 139, FOR MEASUREMENT. frontend-conformance 2.7 (2026-10-02): `prag_if_hasconstanttype` (whether a constant is
  // replaced is the project's "Replace constants" option, which the exec world does not state — refused by name, not
  // guessed; P16 is area 4's) and `prag_unknown_attribute_on_union` (a UNION of INT and DINT — `layout-union`, the
  // transpiler's, as `unit_type_extends_on_union`).
  // 139 -> 146, FOR MEASUREMENT. frontend-conformance 2.10 (2026-10-02), each the transpiler's: `decl_pointer_to_pointer_deref_typed`
  // (dereferences in a branch never taken — `pointer-order`, the pointer model wants an address stored before a `^`) and
  // six `prag_to_string_*` — under `{attribute 'to_string'}` an enum's STRING conversions print the member's NAME
  // (CODESYS 'On', "On"), which lowering printed as the number: a silent wrong answer, now refused by name
  // (`lower/builtins.ts`; the name table is task 4.5.1's). `prag_to_string_absent` (no attribute, '1') is confirmed.
  // 146 -> 151, FOR MEASUREMENT. frontend-conformance 3.1 (2026-10-02) recorded five scope fixtures CODESYS builds and runs
  // that lowering refuses, each the transpiler's: `sym_global_namespace_dot_skips_local` (`expr-global_expr`, as the
  // `expr_global_namespace_*`), `sym_method_output_param_bound` (a METHOD's VAR_OUTPUT bound `o => out`,
  // `call-inout-alias`), `sym_library_gvl_qualified_by_list` and `_fully` (a library's global, `place-not-local`) and
  // `sym_device_instance_bare` (`ADR(Device)`, a device instance has no storage the lowering knows, `place-not-local`).
  // 151 -> 152, FOR MEASUREMENT. frontend-conformance 3.2 (2026-10-02): `inh_interface_method_output_param` builds and runs
  // (out = 6) and lowering refuses an interface METHOD's VAR_OUTPUT bound `o => out`, as `sym_method_output_param_bound`
  // (the transpiler's).
  // 152 -> 161, FOR MEASUREMENT. frontend-conformance 3.4 (2026-10-02): 9 new library cells CODESYS builds and runs and the
  // lowering refuses — library elements it has no body or place for (`ISLIBRELEASED`, `DATETIMEFROMWEEK`, a library's
  // globals `Util.DAY_FLAGS.TUESDAY` / `Util.CONSTANTS.…`, `Util.Standard.LEN`, a library enum through a namespace or a
  // namespace's dependency, bare `ERROR`): `lib_ns_type_qualified`, `_type_name_two_libraries`, `_library_member_own_type`,
  // `_own_type_other_enum`, `_same_name_two_libraries`, `_transitive_qualification`, `_transitive_qualification_call`,
  // `_library_gvl_member`, `_library_gvl_shared_list_name` (the transpiler's; src/transpile is not this change's to edit).
  // 161 -> 162, FOR MEASUREMENT. frontend-conformance 3.5 (2026-10-02): `mem_private_method_of_same_type_instance` builds
  // and runs (out 14) — a PRIVATE METHOD through a POINTER TO an instance of its own FB, `pOther := THIS` — and the lowering
  // refuses it (the transpiler's).
  // 162 -> 166, FOR MEASUREMENT. frontend-conformance 4.1/4.2 (2026-10-03): 4 new cells CODESYS builds and runs and the
  // lowering refuses (the transpiler's; handed to transpile-restructure, task 5.3): `ty_dint_to_uxint` (`DINT_TO___UXINT`
  // and the other platform-target conversions, "not a project FUNCTION"), `ty_version_type` (VERSION, "no declaration
  // lowering can lay out"), `ty_array_of_pointer` ("a pointer stored somewhere this does not track") and
  // `lt_literal_case_label_out_of_range` ("a CASE label outside the selector's type" — CODESYS converts 200 to SINT -56).
  // 166 -> 286, FOR MEASUREMENT. frontend-conformance 4c (2026-10-03): 120 new cells CODESYS builds and runs and the
  // lowering refuses (the transpiler's; handed to transpile-restructure, task 5.3): 111 explicit-pair conversions
  // (`conversions/explicit-pairs.ts`, "conversion-type": a date or a duration to or from BOOL/REAL/LREAL, the cross-unit
  // temporal ones, every X_TO_WSTRING and the STRING/WSTRING parses into a bit string or a date), the two
  // `{attribute 'to_string'}` member-name cells (`cv_enum_to_string_*`, refused by name since 2.10) and 7 pointer cells
  // (`cv_pointer_*`, `cv_reference_to_pointer`, `cv_xword_into_pointer`, `cb_compare_pointer_values`,
  // `dt_pointer_arithmetic_values`: a pointer stored into an integer, compared, stepped). No wrong value: `diverges` stays 5.
  // 286 -> 287, FOR MEASUREMENT. frontend-conformance 4d (2026-10-03): `ce_fold_untyped_in_context_values` (`NOT 0` into a
  // WORD CONSTANT, "init-not-constant": the lowering asks the fold of the initializer alone, which has no context to give
  // the literal a width) and `dt_union_member_sizes` (a UNION laid out and read through another member) — both the
  // transpiler's, handed to transpile-restructure (task 5.3).
  // 287 -> 289, FOR MEASUREMENT. frontend-conformance 4.7.4 (2026-10-03): `dt_this_into_pointer` (`p := THIS`, "THIS does
  // not resolve" as a place) and `dt_this_deref_identity_values` (`SUPER^.v`, "deref is not a lowerable storage location
  // yet") — the transpiler's, handed to transpile-restructure (task 5.3).
  // 289 -> 300, FOR MEASUREMENT. lsp-sfc-step-names 1.1 (2026-10-03): 11 SFC cells CODESYS builds and runs; an SFC body has no
  // ST to lower ("graphical-body", `lower/lower.ts`) — not a transpiler gap this change closes, and no wrong value.
  // 300 -> 330, FOR MEASUREMENT. lsp-sfc-step-names 1 review (2026-10-03): 30 more SFC cells CODESYS builds and runs — the
  // default step `Init`, a step beside a global, an enum member and a FUNCTION of its name, and the SFC flag variables
  // declared with their type and another. Same reason: an SFC body has no ST to lower.
  // 330 -> 334, FOR MEASUREMENT. lsp-sfc-step-names 2 review (2026-10-03): 4 more SFC cells CODESYS builds and runs — a step
  // beside a struct, an FB instance and a pointer global of its name, and a WORD global's bit and partial access in an SFC
  // action. Same reason: an SFC body has no ST to lower.
  // 334 -> 337, FOR MEASUREMENT. lsp-sfc-step-names gate 2 (2026-10-03): 3 more SFC cells CODESYS builds and runs — a bit
  // numbered by a GVL constant and by a local VAR CONSTANT, and a step written and read through THIS^ in its FB's method.
  // Same reason: an SFC body has no ST to lower.
  // 337 -> 338, FOR MEASUREMENT. lsp-sfc-step-names gate 3 (2026-10-03): S3 `sfc_step_qualified_self` — a step read
  // SELF-qualified in its SFC program's own action (the field's shape), which CODESYS builds and runs. Same reason: an SFC
  // body has no ST to lower.
  // 338 -> 345, FOR MEASUREMENT. analysis-conformance 3.1 (2026-10-06): 8 cells both vendors build and CODESYS runs, a
  // POINTER compared with a narrow or a signed integer (`cmpop_pointer_vs_{byte,uint,sint,lint,int_ordered}`) and stored
  // into a LINT, an LREAL and a REAL (`ptrsc_into_{lint,real,real32}`) — asked for the analysis's pointer rules
  // (`types/compat` `pointerComparison`, `pointerIntoElementary`); the transpiler lowers no pointer–integer mix.
  // 345 -> 346, FOR MEASUREMENT. analysis-conformance 3.3 (2026-10-06): `dflt_function_input_from_variable` — a FUNCTION input
  // defaulted with a global variable (CODESYS warns, builds and runs it), which the transpiler does not lower.
  // 346 -> 349, FOR MEASUREMENT. analysis-conformance 3.1+3.3 gate review (2026-10-06): `ptrsc_into_xint` and
  // `cmpop_pointer_vs_xint` (a POINTER stored into and compared with an __XINT — the pointer–integer mix the transpiler
  // does not lower) and `dflt_method_input_from_variable` (a METHOD input defaulted with a global variable, as the
  // FUNCTION's above).
  // 349 -> 350, FOR MEASUREMENT. analysis-conformance 3.6 (2026-10-06): `oopa_inout_in_property` — a property's GET reading
  // its FB's VAR_IN_OUT (CODESYS warns, builds and runs it); the transpiler gives an accessor no frame slot for the
  // parameter ("io is a var, which has no frame slot yet", `place-not-local`).
  // 350 -> 367, FOR MEASUREMENT. analysis-conformance 3.7–3.9 (2026-10-06): seventeen new rule cells CODESYS builds and
  // runs, each a refusal the transpiler states — a JMP and its labels (3: "jmp/label is not lowered yet"), a bare
  // expression statement (4: "expr_stmt is not lowered yet"), INI and __QUERYPOINTER (no project FUNCTION, 2), the address
  // of a bit, of a BIT field, of a derived FB through a base's pointer (4), a method's output bound to the variable
  // the call holds (3: `out := M(o => res)`), and two FUNCTIONs calling each other (1). No fixture moved.
  // 367 -> 389, FOR MEASUREMENT. analysis-conformance 3.12 (2026-10-07): the 22 `initord_*` cells CODESYS builds and runs
  // (`fixtures/cross-object/init-order.ts`) — every one initializes an FB instance's input with another PROGRAM's instance
  // (or its own later instance), which lowering refuses as "an initial value that is not a compile-time constant". No
  // fixture moved.
  // 389 -> 390, FOR MEASUREMENT. transpile-restructure 3.10 (2026-10-08): `cursor_whole_store_capacity` — a STRING(10)
  // stored through a POINTER TO STRING(20) into a STRING(5), which CODESYS builds and runs by writing past the variable
  // into its neighbour; lowering refuses it by name (`cursor-overrun`; the local pointer form `pointer-type`). No fixture
  // moved.
  // 390 -> 394, FOR MEASUREMENT. transpile-restructure 4.1 (2026-10-09): four pointer-model questions CODESYS builds and
  // runs, recorded before §3.3 decides the representation (`fixtures/memory/pointer-model.ts`) — pointer order compares,
  // an ADR difference across two arrays, a byte pointer walking a padded STRUCT, a pointer through an LWORD and back; each
  // refused by name (`pointer-value`, `adr-offset`, `pointer-type`). No fixture moved. Until 4b two of them also carried
  // `pointer-order` — a knock-on of their own refused store, "before any address was stored" though one was; a use after
  // a refused store now repeats that store's code, and an integer stored as a pointer is `pointer-value`.
  "not-lowered": 394,
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

describe("the evidence ratchet", () => {
  whole("the distribution, printed so a status report quotes a measured number", () => {
    const total = ALL_TESTS.length
    const pct = (n: number): string => `${((n / total) * 100).toFixed(1)}%`
    console.log(`  [fixtures] ${total} fixtures`)
    for (const r of EVIDENCE_ORDER) console.log(`  [fixtures]   ${r.padEnd(12)} ${String(rated(r).length).padStart(4)}  ${pct(rated(r).length).padStart(6)}`)

    // The number a status report should quote is not "2514 fixtures", which counts QUESTIONS. It is how much of what
    // the vendor answered we actually match.
    const executed = rated("confirmed").length + rated("diverges").length
    const answered = executed + rated("refused").length + rated("not-lowered").length
    console.log(`  [fixtures] the vendor ANSWERED ${answered} of ${total} (${pct(answered)})`)
    console.log(
      `  [fixtures] of the ${executed} we both EXECUTE, we match ${rated("confirmed").length} — ${executed === 0 ? "n/a" : `${((rated("confirmed").length / executed) * 100).toFixed(1)}%`}`,
    )
    expect(total).toBeGreaterThan(900)
  })

  whole("each rating stays within its ceiling, and the ones that matter are named", () => {
    console.log(`  [fixtures] diverges: ${rated("diverges").map((c) => c.name).join(", ") || "none"}`)
    console.log(`  [fixtures] not-lowered: ${rated("not-lowered").length} the vendor runs and lowering refuses`)
    console.log(`  [fixtures] unasked: ${rated("unasked").length} have no recording — run \`bun run record:exec\``)

    const over = EVIDENCE_ORDER.filter((r) => CEILINGS[r] !== undefined && rated(r).length > CEILINGS[r]!).map(
      (r) => `${r}: ${rated(r).length} > ${CEILINGS[r]!}`,
    )
    expect(over).toEqual([])
  })
})
