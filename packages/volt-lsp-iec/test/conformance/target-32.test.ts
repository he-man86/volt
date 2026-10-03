/**
 * A 32-BIT TARGET — rule TY6 of openspec `frontend-conformance` (design.md §4 4.1): the platform integers `__XINT`,
 * `__UXINT`, `__XWORD` and a pointer's width are the TARGET's, and the oracles are both 64-bit (`support/recording-
 * environment.ts`). TwinCAT Project14 builds for TwinCAT CE7 (ARMV7), a 32-bit target, and its recording is a file of its
 * own, `recordings/twincat-32.build.json` (`VOLT_RECORDING_TARGET=32 RECORD_ONLY=… bun run record:language`, frontend-
 * conformance 4.8): the fixtures that name a platform integer or store a pointer, asked there. The LSP replays each on a
 * project of THAT target, with C0033 an error as the recording project configures it, and must give exactly the build's
 * messages — the agreement the 64-bit oracles are held to (`fixtures.test.ts`).
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ALL_TESTS } from "./fixtures/index.js"
import { lspMessagesOn } from "./support/evidence.js"
import { comparable } from "./support/compare-message.js"
import { RECORDING_ENVIRONMENT } from "./support/recording-environment.js"
import { TARGET_PROBE, THIRTY_TWO_BIT_WIDTH, targetWidth } from "../../scripts/recording-target.js"
import { expectStillDiverges } from "./support/expected-failure.js"

/**
 * THE KNOWN DIVERGENCES ON THIS TARGET, each run as an expected failure. Not `KNOWN_DIVERGENCES.twincat` wholesale: its
 * C0033 marks are the 64-bit replay's shipped severity, and here C0033 is an error, as the project configures it.
 *   `cp_xsizeof` — XSIZEOF is no TwinCAT keyword, on this target as on the 64-bit one (`TWINCAT_XSIZEOF_IS_NO_KEYWORD`).
 *
 * The batch of 2026-10-03T08:00Z ran while another session opened its own Project14 XAE on the same project and recorded
 * three fixtures CLEAN that build with errors (`ty_xint_to_dint_result_type`, `cv_integers_into_pointer`,
 * `dt_pointer_arithmetic_values`); two were marked here as niche losses. Re-recorded at 09:11Z on an XAE of its own, with
 * `dt_pointer_difference` (pointer − pointer is a DWORD here too): the LSP agrees with both marked ones, and the third
 * is the 32-bit half of rule CV6 (`compat` `integerIntoPointer`).
 */
const TARGET_32_DIVERGENCES: Readonly<Record<string, string>> = {
  cp_xsizeof: "TWINCAT_XSIZEOF_IS_NO_KEYWORD (support/divergences.ts), on the 32-bit target as on the 64-bit one",
}

type Recorded = { buildSuccess: boolean; diagnostics: { severity: string; message: string }[] }
const RECORDED = (
  JSON.parse(readFileSync(join(import.meta.dir, "recordings", "twincat-32.build.json"), "utf8")) as { tests: Record<string, Recorded> }
).tests

/** The recording project's compile environment: the oracles' (no compile define), on a 32-bit target. */
const THIRTY_TWO_BIT = Object.freeze({ ...RECORDING_ENVIRONMENT, target: Object.freeze({ pointerBits: 32 as const }) })

describe("a 32-bit target (rule TY6): the LSP against TwinCAT's build on TwinCAT CE7 (ARMV7)", () => {
  test("the recording was made on a 32-bit target — its probe names __XINT a DINT", () => {
    expect(targetWidth(RECORDED)).toBe(THIRTY_TWO_BIT_WIDTH)
  })

  for (const [name, recorded] of Object.entries(RECORDED)) {
    test(`${name}: the LSP gives the 32-bit build's messages`, () => {
      const t = ALL_TESTS.find((f) => f.name === name)
      if (t === undefined) throw new Error(`twincat-32.build.json records ${name}, which is no fixture`)
      const ide = recorded.diagnostics
        .filter((d) => d.severity === "error" || d.severity === "warning")
        .map((d) => `[${d.severity}] ${comparable(d.message)}`)
        .sort()
      const lsp = lspMessagesOn(t, ALL_TESTS, "twincat", THIRTY_TWO_BIT, { "pointer-not-convertible": "error" })
      const mark = TARGET_32_DIVERGENCES[name]
      if (mark !== undefined) expectStillDiverges(name, mark, [() => expect(lsp).toEqual(ide)], "TwinCAT's 32-bit build")
      else expect(lsp).toEqual(ide)
    })
  }

  test("the probe is among them", () => {
    expect(Object.keys(RECORDED)).toContain(TARGET_PROBE)
  })
})
