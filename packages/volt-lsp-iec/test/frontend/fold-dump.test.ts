/**
 * 0.4 FOLDS — does `constEval` give every constant the value CODESYS runs with?
 *
 * The dump (`dumps.ts` `foldDump`) folds every expression a declaration holds and every constant expression of a body,
 * across the corpus, the fixtures and the library bodies; what does not fold is pinned as a count per group. Then the
 * run recordings (`bound-census.ts`): a variable no body of its fixture names still holds its initializer when CODESYS
 * reads it, so the initializer's fold must equal the recorded value. Each that does not — a wrong value, or no value
 * at all where CODESYS has one — is a finding in `baselines/fold-dump.json`.
 */
import { describe, expect, test } from "bun:test"
import { checkBaseline } from "./baseline.js"
import { boundCensus } from "./bound-census.js"

describe("0.4 folds", () => {
  test("every recorded run value is accounted for: asked, or counted by why not", () => {
    const folds = boundCensus().folds
    const notAsked = Object.entries(folds)
      .filter(([k]) => k.startsWith("run: not asked, "))
      .reduce((n, [, v]) => n + v, 0)
    expect(folds["run: recorded values"]).toBe(boundCensus().types["run: recorded values"])
    expect(notAsked + folds["run: recorded values still holding their initializer"]).toBe(folds["run: recorded values"])
  }, 240_000)

  test("every recorded constant folds to its run value — the rest is the baseline's", () => {
    const census = boundCensus()
    console.log(
      [
        "",
        "folds (0.4)",
        ...Object.entries(census.folds).map(([k, v]) => `  ${String(v).padStart(7)}  ${k}`),
        `  ${String(census.foldDisagreements.length).padStart(7)}  disagreements`,
      ].join("\n"),
    )
    checkBaseline("fold-dump", { counts: census.folds, findings: census.foldDisagreements })
  }, 240_000)
})
