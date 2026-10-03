/**
 * WHICH TARGET WAS A RECORDING MADE ON? — read out of the recording itself, because nothing else says.
 *
 * `__XINT` is as wide as the target's pointer, so `plat_xint_into_string` names that width in its own error message:
 * "Cannot convert type 'LINT' to type 'STRING'" on a 64-bit target, 'DINT' on a 32-bit one. Both oracles are 64-bit
 * (`test/conformance/support/recording-environment.ts` states it): CODESYS on `CODESYS Control Win V3 x64`, TwinCAT on
 * `TwinCAT RT (x64)` — the `TwinCAT Project13` fixture. `TwinCAT Project14` opens on `TwinCAT CE7 (ARMV7)` (32-bit),
 * and `ide.ps1 up -Vendor twincat` opens both by default. The recorders no longer pick a pipe by prefix (`bridge.ts`
 * resolves the instance's ONE pipe and refuses two), but which of an instance's projects a `VOLT_PIPE` names is still
 * the caller's word — so a recording, whole or a `RECORD_ONLY` merge, is judged by this probe, and refused on any other
 * target.
 *
 * Shared by `check-recording.ts` (a whole run before `--write`) and `record-language.ts` (a `RECORD_ONLY` merge, which
 * records the probe in the same run and refuses to merge without the 64-bit answer — step 4a review, 2026-10-03). A 32-bit
 * target's recording is a file of its own, `<vendor>-32.build.json` (`VOLT_RECORDING_TARGET=32`, rule TY6), whose probe must
 * answer `THIRTY_TWO_BIT_WIDTH` (frontend-conformance 4.8).
 */
type Row = { diagnostics?: { message: string }[] }

/** The fixture whose message names the target's width. */
export const TARGET_PROBE = "plat_xint_into_string"

/** The integer type `__XINT` is on the recording's target, or "unknown" when the probe is absent or says nothing. */
export function targetWidth(tests: Record<string, Row>): string {
  const m = tests[TARGET_PROBE]?.diagnostics?.[0]?.message.match(/Cannot convert type '(\w+)'/)
  return m?.[1] ?? "unknown"
}

/** The width both oracles are recorded at. */
export const ORACLE_WIDTH = "LINT"

/** The width a 32-bit target's recording answers (`<vendor>-32.build.json`, rule TY6). */
export const THIRTY_TWO_BIT_WIDTH = "DINT"
