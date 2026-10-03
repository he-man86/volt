/**
 * LT14 — does the type the TRANSPILER gives an untyped literal agree with the type the CHECKER checks it as?
 *
 * Every literal stored somewhere in the corpus, the fixtures (bound as CODESYS — the transpiler's vendor) and the library
 * bodies is asked both (`literal-agreement.ts`): `contextLiteralType` and `literalCheckType`, under the store's target.
 * Each (target, transpiler, checker) class where they disagree is a finding in `baselines/literal-agreement.json`, its
 * count pinned. The pinned classes, as measured 2026-10-03 (frontend-conformance 4.2):
 *   - a 0/1 (or any integer) into BOOL, BIT or TIME — the transpiler lowers the narrowest integer and converts it at the
 *     store, the checker names the target (0 and 1 into a BOOL are silent on both vendors, rule LT4);
 *   - an integer the target cannot hold — the transpiler lowers it IN the target (it wraps), the checker names the
 *     literal's narrowest type, which converts with the warning the vendors give (rule LT1, `overflow_*`);
 *   - a real beyond REAL's largest value into a REAL — LREAL for the checker (rule LT3), REAL for the transpiler;
 *   - a real into an integer (a refused source) — LREAL for the transpiler, the target for `literalCheckType`, which
 *     checks only the warnings (its error twin `literalErrorType` names LREAL, as the vendor does).
 * Each is the same STORED value reached two ways; the call site that reads `contextLiteralType` is the transpiler's, and
 * unifying the two is handed to transpile-restructure (frontend-conformance 5.3).
 */
import { describe, test } from "bun:test"
import { checkBaseline, tally } from "./baseline.js"
import { boundCorpus, boundLibrary, withBoundFixture } from "./bound.js"
import { literalAnswers } from "./literal-agreement.js"
import { corpusProjects, fixtureSources } from "./sources.js"
import type { Bound } from "./dumps.js"

describe("LT14 literal agreement", () => {
  test("the transpiler's and the checker's type of every stored literal agree — the disagreeing classes are the baseline's", () => {
    const counts: Record<string, number> = {}
    const classes = new Map<string, number>()
    const ask = (group: string, b: Bound): void => {
      for (const a of literalAnswers(b)) {
        tally(counts, `${group}: literals stored`)
        if (a.transpiler === a.checker) continue
        tally(counts, `${group}: literals the two disagree on`)
        const key = `${group}: into ${a.target} — transpiler ${a.transpiler}, checker ${a.checker}`
        classes.set(key, (classes.get(key) ?? 0) + 1)
      }
    }
    for (const project of corpusProjects()) for (const b of boundCorpus(project)) ask("corpus", b)
    for (const f of fixtureSources()) withBoundFixture(f, "codesys", (own, plc) => (ask("fixtures", own), ask("fixtures", plc)))
    for (const b of boundLibrary()) ask("library", b)
    // a group whose disagreements all close stays measured, at 0
    for (const group of ["corpus", "fixtures", "library"]) counts[`${group}: literals the two disagree on`] ??= 0
    const findings = [...classes].map(([k, n]) => `${k} (${n})`)
    console.log(["", "literal agreement (LT14)", ...Object.entries(counts).map(([k, v]) => `  ${String(v).padStart(7)}  ${k}`), ...findings.map((f) => `  ${f}`)].join("\n"))
    checkBaseline("literal-agreement", { counts, findings })
  }, 240_000)
})
