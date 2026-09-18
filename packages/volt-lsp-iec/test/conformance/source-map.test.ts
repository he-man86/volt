/**
 * THE SOURCE MAP — does a mapped position land on the statement it claims?
 *
 * The emitter ships `sourceMap: { line, span }[]` and, until this, one hand-written assertion checked one line of one
 * program. Everything else about it was assumed: that a span lies inside the source, that the text it points at is a
 * statement rather than whitespace, and that the Rust line it names is code rather than a brace.
 *
 * Measured over every conformance fixture (781 programs, 3636 mappings, 2026-09-18) and two things came out.
 *
 * **It holds for a single-file program** — no span out of bounds, no blank slice, no mapping onto a lone delimiter.
 *
 * **It had NO FILE IDENTITY**, which made it wrong for a program of more than one file: a mapping was a line and a
 * span, with nothing saying WHICH source the span indexed, so a body lowered from a GVL or a library declaration
 * mapped to an offset in THAT file which a consumer would slice out of the main one. Ten mappings did this —
 * `fb_init_before_slot_method_sibling` mapped to offset 200 of a 137-character source. Each mapping now carries the
 * `uri` of the file its span indexes (`IrRoutine.uri`, `IrLayout.bodyUri`), and the test below holds it there: a span
 * outside the main source must NAME its file, and one with no `uri` must be inside the main source.
 *
 * ONE-TO-MANY IS NOT A DEFECT, and the gate must not treat it as one: a PROPERTY assignment lowers to a setter, a
 * `__QUERYINTERFACE` to a whole `match`, and `x := y := z` to several assignments. All of those legitimately map many
 * Rust lines to one ST statement, which is why the check below is about the SPAN being sound, not about the shapes
 * matching one to one.
 */
import { describe, expect, test } from "bun:test"
import { emitRust } from "../../src/transpile/emit/rust/index.js"
import { lowerSource } from "../../src/transpile/lower/index.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { withDependencies } from "./support/fixture-units.js"
import { plcPrgSource } from "./support/plc-prg.js"
import { STANDARD_LIBRARY } from "./support/standard-library.js"



/** Mapped assignments whose Rust line does not name the ST target because lowering RENAMED it — the classes are
 *  listed at the test. A ceiling, so a new renaming class has to be looked at rather than absorbed. */
const RENAMED_TARGETS = 27

interface Program {
  name: string
  source: string
  multiFile: boolean
  map: readonly { line: number; span: { start: number; end: number; startLine: number }; uri?: string }[]
  rustLines: readonly string[]
}

function programs(): Program[] {
  const out: Program[] = []
  for (const t of ALL_TESTS) {
    const fixtures = withDependencies(t, ALL_TESTS).filter((f) => f.source !== "")
    const gvls = fixtures.filter((f) => f.kind === "gvl").map((f) => ({ uri: `${f.pouName}.gvl`, source: f.source }))
    const source = [...fixtures.filter((f) => f.kind !== "gvl").map((f) => f.source), plcPrgSource(t)].join("\n")
    let pou
    try {
      pou = lowerSource(source, "PLC_PRG", [...STANDARD_LIBRARY, ...gvls]).pou
    } catch {
      continue // a lowering throw is `lowering-totality`'s to report
    }
    if (pou === undefined) continue
    try {
      const emitted = emitRust(pou)
      out.push({ name: t.name, source, multiFile: gvls.length > 0, map: emitted.sourceMap, rustLines: emitted.code.split("\n") })
    } catch {
      continue // an emitter throw is the emitter suite's to report
    }
  }
  return out
}

let cached: Program[] | undefined
const all = (): Program[] => (cached ??= programs())

describe("the source map", () => {
  test("every mapping names a Rust line that exists and holds code", () => {
    const bad: string[] = []
    for (const p of all())
      for (const { line } of p.map) {
        const rust = p.rustLines[line - 1]
        if (rust === undefined) bad.push(`${p.name}: line ${line} of ${p.rustLines.length}`)
        else if (rust.trim() === "" || /^[{}();]*$/.test(rust.trim())) bad.push(`${p.name}: line ${line} is ${JSON.stringify(rust.trim())}`)
      }
    expect(bad).toEqual([])
  })

  test("in a SINGLE-FILE program every span lies in the source and points at a statement", () => {
    const bad: string[] = []
    for (const p of all().filter((x) => !x.multiFile))
      for (const { span } of p.map) {
        if (span.start < 0 || span.end > p.source.length || span.start >= span.end) {
          bad.push(`${p.name}: [${span.start},${span.end}) of ${p.source.length}`)
          continue
        }
        if (p.source.slice(span.start, span.end).trim() === "") bad.push(`${p.name}: [${span.start},${span.end}) is blank`)
        if (span.startLine < 1) bad.push(`${p.name}: startLine ${span.startLine}`)
      }
    expect(bad).toEqual([])
  })

  test("an ST assignment maps to a Rust line that names its target, except where lowering RENAMES it", () => {
    // Underscore-insensitive, because the emitter snake_cases: `seenCount` is `self.seen_count`.
    //
    // A handful of assignments legitimately do NOT name their ST target on the mapped line, and every one was read
    // before being allowed (2026-09-18):
    //   - a PROPERTY is a synthesized field — `Level := 40` is `self._property_5 = 40i16`;
    //   - `__QUERYINTERFACE` is a whole `match`, whose arms all map to the one ST statement;
    //   - `x := y := z` becomes several assignments through a chain temp;
    //   - `latch S= cond` becomes `self.latch = true`;
    //   - a VAR_IN_OUT parameter takes the CALLER's field name when `specializeRoutine` substitutes it, so
    //     `target := target + amount` is `self.counter = …` — the rename is the specialization working.
    // So this is a ratchet, not a demand for zero: a NEW unnamed mapping is a new renaming class, and worth reading
    // before it is admitted.
    const squash = (s: string): string => s.toLowerCase().replace(/_/g, "")
    let checked = 0
    let named = 0
    for (const p of all().filter((x) => !x.multiFile))
      for (const { line, span } of p.map) {
        if (span.start < 0 || span.end > p.source.length) continue
        const target = /^\s*([A-Za-z_]\w*)\s*:=/.exec(p.source.slice(span.start, span.end))
        const rust = p.rustLines[line - 1]
        if (target === null || rust === undefined) continue
        if (!/^[^=]*=[^=]/.test(rust)) continue // the mapped line is not itself an assignment
        checked++
        if (squash(rust).includes(squash(target[1]!))) named++
      }
    expect(checked).toBeGreaterThan(200)
    expect(checked - named).toBeLessThanOrEqual(RENAMED_TARGETS)
  })

  test("CROSS-FILE — a span outside the main source NAMES the file it belongs to", () => {
    // The property that makes the map usable: either the span is inside the main source, or it says which file it is
    // not from. A mapping that is neither sends a consumer to read the wrong text, or past the end of the file.
    const blind: string[] = []
    let named = 0
    for (const p of all())
      for (const { span, uri } of p.map) {
        const outside = span.start < 0 || span.end > p.source.length || span.start >= span.end
        if (!outside) continue
        if (uri === undefined || uri === "transpile://source") blind.push(`${p.name}: [${span.start},${span.end}) of ${p.source.length}, uri ${String(uri)}`)
        else named++
      }
    console.log(`  [source-map] ${named} mappings index another file, and every one names it`)
    expect(blind).toEqual([])
  })
})
