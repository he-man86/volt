/**
 * ONE WALK OF EVERYTHING BOUND, EVERY BOUND QUESTION ASKED OF IT — the measurements behind 0.3 (resolution) and 0.4
 * (types, folds), computed once per process and read by `resolution-dump.test.ts`, `type-dump.test.ts` and
 * `fold-dump.test.ts` (test/README.md: one walk per input).
 *
 * Each group is summarized as counts, and what a recording can decide is cross-checked against it:
 *
 *   types   a build message that names a type — "Cannot convert type 'X' to type 'Y'", the two sign-change
 *           warnings, the loss-of-information warning — is explained by a store (an assignment, an initializer, a call
 *           argument, an operand) whose target the front-end types Y and whose value it types X, each store explaining
 *           ONE copy of a message (the recordings carry no position, so the count is all there is to hold); the other
 *           way, every store the front-end types as not implicitly convertible (`classifyConversion` "incompatible")
 *           must be matched by a recorded "Cannot convert" for it; and every path a CODESYS run recorded, read as an
 *           expression in PLC_PRG, must infer the type its value is printed as;
 *   folds   a variable a run recorded that no body of its fixture names still holds its initializer, so when that
 *           initializer reads nothing the init step runs (`readsRuntime`, asked of the AST and name resolution — never of
 *           the fold under test) the value the declaration holds (`declaredValue`: the
 *           fold stored into the declared type — wrapped to its width, a string cut at its capacity) must equal the
 *           recorded value — every recorded value this cannot be asked of is counted by why, so the values the check sees
 *           plus the ones it does not add up to every recorded value. An initializer that reads a variable or calls a
 *           user function is run by the init step, not folded: no constant to ask (frontend-conformance 4.6.1).
 *
 * Fixtures are bound and measured once per vendor, each against that vendor's build recording; the run recording is
 * CODESYS's alone, so the run cross-checks (types and folds) are CODESYS-bound.
 *
 * This file is the walk; one file per concern does the rest (openspec lsp-same-standard 4.4): `bound-census-summarize.ts`
 * (one file's resolution, types and folds), `bound-census-untyped.ts` (why an expression is untyped), `bound-census-runs.ts`
 * and `bound-census-folds.ts` (the cross-checks), `bound-census-stores.ts` and `bound-census-store-units.ts` (the stores).
 */
import { tally } from "../baseline/baseline.js"

import { boundCorpus, boundLibrary, withBoundFixture } from "./bound.js"
import { KNOWN_DIVERGENCES } from "../conformance/support/divergences.js"
import { corpusProjects, fixtureSources, isLibraryManagerFile, unanswered, type FixtureSources } from "./sources.js"
import { type Dialect } from "../../src/frontend/syntax/index.js"
import { type BoundCensus, type VendorFacts } from "./bound-census-untyped.js"
import { summarize } from "./bound-census-summarize.js"
import {
  crossCheckBuildTypes,
  crossCheckRunTypes,
  INHERITED_THROUGH_INSTANCE,
  vendorSays,
} from "./bound-census-runs.js"
import { crossCheckFolds } from "./bound-census-folds.js"

let cached: BoundCensus | undefined

export function boundCensus(): BoundCensus {
  if (cached !== undefined) return cached
  const c: BoundCensus = {
    resolution: {},
    fixtureUnresolved: [],
    // the run paths inferred UNKNOWN are measured at 0 too, so a ceiling that reached 0 stays pinned there (frontend-
    // conformance 3.2: the inherited-member class closed at 41 → 0, the rest 2 → 0)
    types: { "run: path inferred UNKNOWN": 0, [INHERITED_THROUGH_INSTANCE]: 0 },
    typeDisagreements: [],
    // measured at 0 too, so the ceiling that reached 0 stays pinned there (frontend-conformance 4.6.1: 33 → 0)
    folds: { "run: initializer does not fold": 0 },
    foldDisagreements: [],
  }
  for (const project of corpusProjects())
    for (const b of boundCorpus(project))
      summarize(c, isLibraryManagerFile(b.parsed.id) ? "corpus Library Manager" : "corpus", b, undefined)
  for (const vendor of ["codesys", "twincat"] as const) for (const f of fixtureSources()) censusFixture(c, f, vendor)
  for (const b of boundLibrary()) summarize(c, "library", b, "")
  cached = c
  return c
}

/** One fixture, bound and measured against `vendor`'s build — and, on CODESYS, against the run. */
function censusFixture(c: BoundCensus, f: FixtureSources, vendor: Dialect): void {
  // an SFC fixture the push refuses and no build or refusal answers — TwinCAT's, which no recorder can create, and CODESYS's
  // that build (a run records values, not the build's messages): counted, not measured (`sources.ts` `unanswered`). ONLY
  // the SFC fixtures: every other push-refused fixture was measured here before them and still is — its names, types and
  // folds are the census's to hold (lsp-sfc-step-names 1, review: the rule taken whole dropped 45 fixture/vendor pairs).
  if (f.test.sfcStep !== undefined && unanswered(f, vendor)) {
    tally(c.resolution, `fixtures ${vendor}: SFC files the push refuses, no build or refusal recorded, not measured`, 2)
    tally(c.types, `fixtures ${vendor}: SFC files the push refuses, no build or refusal recorded, not measured`, 2)
    return
  }
  withBoundFixture(f, vendor, (own, plc, deps) => {
    const facts = vendorFacts(f, vendor)
    summarize(c, `fixtures ${vendor}`, own, `${vendor} `, facts)
    summarize(c, `fixtures ${vendor}`, plc, `${vendor} `, facts)
    if (!facts.known) crossCheckBuildTypes(f, vendor, [own, plc], c)
    if (vendor === "codesys") {
      crossCheckRunTypes(f, plc, c)
      crossCheckFolds(f, plc, [own, plc, ...deps], c)
    }
  })
}

/** What `vendor`'s build of fixture `f` says, as `summarize` asks it (`VendorFacts`). */
function vendorFacts(f: FixtureSources, vendor: Dialect): VendorFacts {
  const known = KNOWN_DIVERGENCES[vendor].has(f.test.name)
  const notDefined = new Set(
    ((vendor === "codesys" ? f.codesys : f.twincat)?.diagnostics ?? []).flatMap((d) => {
      const m = /^Identifier '(.+)' not defined$/.exec(d.message)
      if (m !== null) return [m[1].toLowerCase()]
      // …and `.name` no GLOBAL declares — "There is no global definition for 'loc'" (rule E33): the dump's `(global) loc`
      const g = /^There is no global definition for '(.+)'$/.exec(d.message)
      return g === null ? [] : [`(global) ${g[1].toLowerCase()}`]
    }),
  )
  // "'<member>' is no component of '<base>'": each member the vendor found on no component, with the base it names
  // (`member|base`, lower case — `memberBases`)
  const noComponent = new Set(
    ((vendor === "codesys" ? f.codesys : f.twincat)?.diagnostics ?? []).flatMap((d) => {
      const m = /^'(.*)' is no component of '(.+)'$/.exec(d.message) // the member may be '': the end of the text (`rec_member_name_at_end`)
      return m === null ? [] : [`${m[1]!.toLowerCase()}|${m[2]!.toLowerCase()}`]
    }),
  )
  const unknownTypes = new Set(
    ((vendor === "codesys" ? f.codesys : f.twincat)?.diagnostics ?? []).flatMap((d) =>
      [...d.message.matchAll(/Unknown type: '(.+?)''? to type|^Unknown type: '(.+)'$/g)].map((m) => m[1] ?? m[2]),
    ),
  )
  const says = vendorSays(vendor === "codesys" ? f.codesys : f.twincat)
  return { known, notDefined, noComponent, unknownTypes, says }
}

