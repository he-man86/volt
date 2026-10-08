/**
 * THE ONE READER OF `recordings/codesys.run.json` — what CODESYS's simulator did with each fixture: every recorded
 * variable after N scans, or the reason it could not run (written by `scripts/record-exec.ts`, never by hand).
 *
 * `transpile-replay.test.ts`, `evidence.ts`, `transpile/correctness.ts` and `runtime-twins.test.ts` each parsed the file on
 * their own, each with its own idea of an entry's shape; they read this one (transpile-restructure 1.8.4).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

/** One fixture's run, as the recorder wrote it. */
export interface RunRecorded {
  /** The scan count the run read its values after, read back from the IDE (the recorder's own gate). */
  cycles?: string
  /** Each recorded variable's value, as the IDE displays it. */
  values?: Record<string, string>
  /** What failed in the IDE (`does not compile …`, a fault), as the recorder reported it. */
  error?: string
  /** The paths the recorder could not read, each with what the IDE answered. */
  unreadable?: Record<string, string>
}

/** Every fixture's run, by fixture name. */
export const RUNS: Readonly<Record<string, RunRecorded>> = (
  JSON.parse(readFileSync(join(import.meta.dir, "..", "recordings", "codesys.run.json"), "utf8")) as {
    tests: Record<string, RunRecorded>
  }
).tests
