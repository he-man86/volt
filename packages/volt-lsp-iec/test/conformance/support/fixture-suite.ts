/**
 * THE FIXTURE CONTRACT — one walk over `ALL_TESTS`, and each fixture's EVIDENCE RATING names the row it answers. This
 * module is what the contract's three test files share; the rows are theirs.
 *
 * A fixture is a question put to CODESYS 3.5.21.40. What it is worth depends entirely on whether the vendor
 * answered and whether we match, and `support/evidence.ts` derives exactly that into `t.evidence`:
 *
 *   confirmed    the vendor ran it; the interpreter AND the emitted Rust produce its values
 *   refused      the vendor rejects the source, and so do we — in its own words where a fragment is recorded
 *   not-lowered  the vendor runs it and lowering refuses, under a registered code
 *   diverges     we both execute it and disagree; the fixture says what was measured
 *   lsp-gap      the vendor objects and the LSP is silent; the fixture says so, with a date
 *   unaskable    the oracle cannot put the question, and the fixture says why
 *   unasked      nobody has asked yet — the one rating that must stay at zero
 *
 * ONE SELECTION, THREE FILES. This was `replay` + `refused` + `transpile` + `confidence`, four files that shared one
 * input (the fixtures), one derivation (the rating) and one report but not a SELECTION: each re-selected its own subset
 * by hand — `refused !== undefined`, `recording.tests[name] !== undefined`, `deferred?.transpile === undefined` — so a
 * fixture could be covered by three of them and a fixture in a state nobody had thought of by none, silently. They
 * became one file, and that file split again by CONCERN (transpile-restructure 1.8.7) — the rating
 * rows (`transpile-replay.test.ts`), the map's own columns and ratchet (`map.test.ts`), the LSP against each vendor's
 * build (`lsp-replay.test.ts`) — over the one selection, recordings, lowering and rating index this module holds. The
 * rating is total over the fixtures, so a row that no rating maps to is a hole the table shows.
 *
 * WHAT DRIVES THE ROWS is the STORED rating, not a freshly computed one — `map.generated.ts`, written by
 * `bun run rate:fixtures`. That is only safe because the tests under "the table is total" (`map.test.ts`) recompute every rating
 * and fail on a disagreement; derived data committed to source needs exactly that gate and nothing less.
 *
 * That file carries the OTHER half of each fixture's row too — the tier its ST lowers to, which oracle reached the
 * emitted Rust, what the Rust linter still says about that Rust, how many pedantic findings it carries, whether the
 * interpreter and the Rust agree on edge inputs, its size and its emission shape — and this gate owns all of it: the
 * tier, the oracle, the shape and the size are recomputed below, and the lints, the pedantic count and the edge
 * verdict come out of the compile (and the run) the Rust blocks of `transpile-replay.test.ts` already make, one binary
 * per fixture.
 *
 * A RED ROW IS THE PRODUCT BEING WRONG, never the recording. Fix `lower/`, `interp/`, `emit/` or the check —
 * never the expectation.
 *
 * COST. The rating rows are the expensive gate: every lowering case is compiled by `rustc` as its own binary, one
 * process per core. Each of the three files runs alone.
 */

import { test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Vendor } from "../../../src/analysis/index.js"
import { lowerSource, type LoweredPou } from "../../../src/transpile/index.js"
import { ALL_TESTS } from "../fixtures/index.js"
import type { LanguageTest } from "../types.js"
import { EVIDENCE_ORDER, type Evidence } from "./evidence.js"
import { assembleFixture } from "./fixture-units.js"
import { PROJECT_BASE } from "./project-libraries.js"
import type { RunRecorded } from "./recordings.js"
import { selectFixtures } from "./selection.js"

/** The fixtures this run covers — all of them, or the ones `VOLT_FIXTURES` names (`support/selection.ts`). Every
 *  per-fixture row walks THIS; `ALL_TESTS` stays the universe a fixture is assembled, rated and bound in, so a named
 *  fixture is checked against exactly the project the full run checks it against. */
export const SELECTION = selectFixtures(ALL_TESTS)
/** A project-wide total — a partial run cannot answer it, and skips it (the loud line says so). */
export const whole = test.skipIf(SELECTION.partial)

// ─── the recordings ──────────────────────────────────────────────────────────────────────────────────────────

export interface RecordedDiagnostic {
  severity: "error" | "warning" | "info"
  message: string
  line: number
}
interface BuildRecording {
  recorded: { at: string } | null
  tests: Record<string, { buildSuccess: boolean; diagnostics: RecordedDiagnostic[] }>
}

const RECORDINGS_DIR = join(import.meta.dir, "..", "recordings")
const readRecording = <T>(name: string): T => JSON.parse(readFileSync(join(RECORDINGS_DIR, name), "utf8")) as T

/** What each IDE's BUILD said — per vendor, because the two compilers diverge at times. */
export const BUILDS: Record<Vendor, BuildRecording> = {
  codesys: readRecording<BuildRecording>("codesys.build.json"),
  twincat: readRecording<BuildRecording>("twincat.build.json"),
}

// ─── one lowering per fixture, shared by every row that needs one ────────────────────────────────────────────

const loweredCache = new Map<string, LoweredPou>()
export function lowering(c: LanguageTest): LoweredPou {
  let lowered = loweredCache.get(c.name)
  if (lowered === undefined) {
    // A GVL is an object of its own, named by its pouName — `GVL_Name.var` reaches it only under that name, which a
    // file gives it. Folded into the one source, every list was named `source`, and no qualified access could resolve.
    const { source, gvls } = assembleFixture(c, ALL_TESTS)
    lowered = lowerSource(source, "PLC_PRG", gvls, undefined, PROJECT_BASE)
    loweredCache.set(c.name, lowered)
  }
  return lowered
}

/** The recorded values a run can reproduce — all but the ones that read the IDE's wall clock (`LanguageTest.wallClock`). */
export const reproducible = (c: LanguageTest, rec: RunRecorded): [string, string][] =>
  Object.entries(rec.values!).filter(([path]) => !(c.wallClock ?? []).includes(path))

// ─── the rating rows ─────────────────────────────────────────────────────────────────────────────────────────

/** Every fixture under the rating it stores. A rating with no fixtures is not an error; a fixture with a rating
 *  this file has no row for IS, and the last test in the table says so. */
const BY_RATING = new Map<Evidence, LanguageTest[]>(EVIDENCE_ORDER.map((r) => [r, []]))
for (const t of SELECTION.selected) BY_RATING.get(t.evidence as Evidence)?.push(t)
export const rated = (r: Evidence): LanguageTest[] => BY_RATING.get(r) ?? []
