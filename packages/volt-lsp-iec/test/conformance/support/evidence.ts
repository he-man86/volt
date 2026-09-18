/**
 * HOW WELL A FIXTURE IS EVIDENCED — the one implementation, used by the generator and by the gate.
 *
 * `scripts/rate-fixtures.ts` writes the answer into each fixture's `evidence`; `confidence.test.ts` recomputes it and
 * fails if a stored one disagrees. Both call THIS, so a generated file and the gate that checks it can never be
 * measuring different things — which is the only way storing derived data in source is safe.
 *
 * **It does not compare values, and that is deliberate.** `transpile.test.ts` owns value equality, in both backends,
 * using the vendor's own display formats (`ideValue` reads `DUT_X.Running`, `TIME#1s1ns`, `'a$Tb'`). A first version
 * re-implemented that comparison here and reported 97 false divergences on a green suite. So `confirmed` means "the
 * vendor answered, we execute it, and the gate that owns equality is asserting it" — a statement about WHERE THE
 * EVIDENCE IS, not a second opinion about the values.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { lowerSource } from "../../../src/transpile/lower/index.js"
import { run } from "../../../src/transpile/interp/index.js"
import { assembleFixture } from "./fixture-units.js"
import { STANDARD_LIBRARY } from "./standard-library.js"
import type { LanguageTest } from "../types.js"

export type Evidence = NonNullable<LanguageTest["evidence"]>

/** The order a report lists them in: strongest evidence first, then the gaps, then what was never asked. */
export const EVIDENCE_ORDER: readonly Evidence[] = [
  "confirmed",
  "refused",
  "not-lowered",
  "unasked",
  "lsp-gap",
  "diverges",
  "unaskable",
]

const RECORDINGS = join(import.meta.dir, "..", "recordings")
const runRec = JSON.parse(readFileSync(join(RECORDINGS, "codesys.run.json"), "utf8")).tests as Record<
  string,
  { error?: string; values?: Record<string, string> }
>
const buildRec = JSON.parse(readFileSync(join(RECORDINGS, "codesys.build.json"), "utf8")).tests as Record<
  string,
  { buildSuccess?: boolean }
>

/** The fixture as one program, plus the libraries it lowers against — `assembleFixture` is the shared assembly. */
function sourceOf(t: LanguageTest, all: readonly LanguageTest[]): { source: string; libraries: { uri: string; source: string }[] } {
  const { source, gvls } = assembleFixture(t, all)
  return { source, libraries: [...STANDARD_LIBRARY, ...gvls] }
}

export function rateFixture(t: LanguageTest, all: readonly LanguageTest[]): Evidence {
  if (t.execSkip !== undefined || t.recorderSkip === true) return "unaskable"
  if (t.deferred?.lsp !== undefined) return "lsp-gap"

  const rec = runRec[t.name]
  const build = buildRec[t.name]
  // A vendor REFUSAL is an answer, and either recording can carry it.
  if (rec?.error?.startsWith("does not compile") === true || build?.buildSuccess === false || t.refused !== undefined) return "refused"
  if (rec?.values === undefined) return "unasked"

  // The vendor ran it. Do WE? That is the only thing left to decide here.
  const { source, libraries } = sourceOf(t, all)
  let pou
  try {
    pou = lowerSource(source, "PLC_PRG", libraries).pou
  } catch {
    return "diverges" // a THROW is not a refusal — lowering must end in a diagnostic, so this is a defect
  }
  // `deferred.transpile` is read only AFTER this: a fixture deferred because lowering REFUSES it is a coverage gap,
  // and reading the flag first reported four refusals as wrong answers.
  if (pou === undefined) return "not-lowered"
  if (t.deferred?.transpile !== undefined) return "diverges"
  try {
    const p = run(pou)
    for (let i = 0; i < (t.cycles ?? 1); i++) p.scan()
  } catch {
    return "diverges" // the vendor completed the scan and we faulted
  }
  return "confirmed"
}
