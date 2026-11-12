/**
 * THE STRING <-> WSTRING CROSSING'S CASES (`cases.ts`) — WSTRING_TO_STRING and STRING_TO_WSTRING under each setting of the
 * project's "UTF-8 Encoding for STRING" (`StringEncoding`), into a target of capacity `m`. The answer is the string the
 * target holds, as its units up to the terminator. `convert.test.ts` runs the table against `coerce`; the twin harness
 * (`test/conformance/runtime-twins-rust.test.ts`) against `IecStr::narrow` / `widen` / `narrow_low_byte` / `widen_bytes`.
 *
 * Measured on CODESYS 3.5.21.40: `utf8` is what the `wsu_*` fixtures recorded on the exec oracle's project (option on,
 * `codesys.run.json`); `latin1` what the same fixtures recorded on the build-recording project (option off,
 * `codesys.run.utf8-off.json`).
 */
import type { StringEncoding } from "../ir/index.js"
import type { Case } from "./cases.js"

/** `text`'s units (a WSTRING's UTF-16 units, or a STRING's bytes) crossed to the other width, into a target of `m`. */
export interface CrossingInput {
  readonly op: "narrow" | "widen"
  readonly encoding: StringEncoding
  readonly text: string
  readonly m: number
}

const crossing = (name: string, op: CrossingInput["op"], encoding: StringEncoding, text: string, expected: readonly number[], m = 255): Case<CrossingInput, readonly number[]> => ({
  name,
  input: { op, encoding, text, m },
  expected,
})

export const CROSSING_CASES: readonly Case<CrossingInput, readonly number[]>[] = [
  // on: UTF-8 (`wsu_narrow_*`, `wsu_widen_*`)
  crossing("utf8 narrow: two-byte characters (wsu_narrow_two_byte)", "narrow", "utf8", "größe", [103, 114, 195, 182, 195, 159, 101]),
  crossing("utf8 narrow: a three-byte character (wsu_narrow_three_byte)", "narrow", "utf8", "a计b", [97, 232, 174, 161, 98]),
  crossing("utf8 narrow: a surrogate pair is four bytes (wsu_narrow_surrogate_pair)", "narrow", "utf8", "a😀b", [97, 240, 159, 152, 128, 98]),
  crossing("utf8 narrow: cut inside ß at STRING(5) (wsu_narrow_cut_inside)", "narrow", "utf8", "größe", [103, 114, 195, 182, 195], 5),
  crossing("utf8 widen: two-byte sequences decode (wsu_widen_back)", "widen", "utf8", "gr\xC3\xB6\xC3\x9Fe", [103, 114, 246, 223, 101]),
  // off: a unit's low byte, a byte for byte widen (`codesys.run.utf8-off.json`)
  crossing("latin1 narrow: a Latin-1 character is its byte (wsu_narrow_two_byte)", "narrow", "latin1", "größe", [103, 114, 246, 223, 101]),
  crossing("latin1 narrow: 计 (U+8BA1) keeps its low byte 16#A1 (wsu_narrow_three_byte)", "narrow", "latin1", "a计b", [97, 0xa1, 98]),
  crossing("latin1 narrow: a surrogate pair is 16#3D then 0, which ends the string (wsu_narrow_surrogate_pair)", "narrow", "latin1", "a😀b", [97, 0x3d]),
  crossing("latin1 narrow: cut at STRING(3)", "narrow", "latin1", "größe", [103, 114, 246], 3),
  crossing("latin1 widen: each byte is its unit (wsu_widen_back)", "widen", "latin1", "gr\xF6\xDFe", [103, 114, 246, 223, 101]),
  crossing("latin1 widen: a byte no UTF-8 sequence starts is still its unit", "widen", "latin1", "\xE9A", [0xe9, 65]),
]
