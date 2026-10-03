/**
 * 0.4 TYPES — does every expression get a type, and the type a recording decides?
 *
 * The dump (`dumps.ts` `typeDump`) infers every value expression of every corpus file, fixture and library body; the
 * UNKNOWNs are pinned as counts per group and expression kind (an untyped literal is UNKNOWN by design — its context
 * types it — and is counted apart for that reason). Then what a recording decides (`bound-census.ts`): each CODESYS type
 * message must be explained by the types the front-end infers for some store in its fixture, and each recorded run path
 * must infer the type its value prints as. Each that is not is a finding in `baselines/type-dump.json`.
 */
import { describe, expect, test } from "bun:test"
import { checkBaseline } from "./baseline.js"
import { boundCensus } from "./bound-census.js"

describe("0.4 types", () => {
  test("an FB initializer's warning is said twice and explained by its one store — a refusal is said once", () => {
    // `bound_byte_below_min` records SINT → BYTE twice for `x : BYTE := -1` in a FUNCTION_BLOCK, which CODESYS checks once
    // for the type and once for the instance (`analysis` `initializerWarnedTwice`, `ir_initializer_warning_*`): one store
    // explains both copies — this read the second as a message no store explained
    const census = boundCensus()
    expect(census.typeDisagreements.filter((f) => f.includes(" bound_byte_below_min: "))).toEqual([])
    expect(census.types["build codesys: explained by the inferred types, said twice for an initializer"]).toBeGreaterThan(0)
  }, 240_000)
  test("measured on both vendors, each against its own build", () => {
    expect(boundCensus().types["build twincat: type messages recorded"]).toBeGreaterThan(0)
    expect(boundCensus().types["build codesys: type messages recorded"]).toBeGreaterThan(0)
  }, 240_000)

  test("every expression is typed as the recordings decide — the UNKNOWNs and disagreements are the baseline's", () => {
    const census = boundCensus()
    console.log(
      [
        "",
        "types (0.4)",
        ...Object.entries(census.types).map(([k, v]) => `  ${String(v).padStart(7)}  ${k}`),
        `  ${String(census.typeDisagreements.length).padStart(7)}  disagreements`,
      ].join("\n"),
    )
    checkBaseline("type-dump", { counts: census.types, findings: census.typeDisagreements })
  }, 240_000)
})
