/** THE STRING BUFFER MODEL: one character of a string as `s[i]` reads and writes it, and the string a buffer holds. */
import { characterOutOfRange } from "../ir/faults.js"

/**
 * ONE CHARACTER OF A STRING, as `s[i]` reads and writes it — counted from 0, a BYTE (a WSTRING's WORD). It is the
 * primitive the Standard library's string functions are written in (`libraries/Standard`). Mirrored by the emitter's
 * prelude (`IecStr::char_at` / `with_char`).
 *
 * A STRING(n) is n + 1 bytes in CODESYS, and `s[i]` reaches every one of them — 0 to n — whatever the length
 * (recorded: lib_prim_char_past_length — `buf[SIZEOF(buf) - 1] := 0` on a short string runs). The value holds the
 * WHOLE BUFFER, one JS char a unit, trailing zeros trimmed; the string is what stands before its first 0 (`visible`):
 *   - a read reads that byte — the terminator, or whatever lies behind it — and 0 past what is held;
 *   - a store stores that byte wherever it lands, and the length is where the first 0 now stands: a 0 cuts the
 *     string and KEEPS its tail, which a later store over that 0 brings back ('abcdef', t[2] := 0, t[2] := 88 is
 *     'abXdef'); a store past the terminator is held behind it (recorded: tr_34_lib_prim_char_behind);
 *   - at n only a 0 fits.
 * An index outside 0..n is outside the variable — a fault, as CODESYS would be writing into its neighbour.
 * Mirrored by the prelude's `IecStr`, whose `[T; N]` is the same buffer and `len` the same first 0.
 */
export function charAt(s: string, i: bigint, capacity: number): bigint {
  const at = Number(i)
  if (at < 0 || at > capacity) throw new RangeError(characterOutOfRange(at, capacity))
  return at >= s.length ? 0n : BigInt(s.charCodeAt(at))
}

export function setChar(s: string, i: bigint, c: bigint, capacity: number): string {
  const at = Number(i)
  if (at < 0 || at > capacity || (at === capacity && c !== 0n)) throw new RangeError(characterOutOfRange(at, capacity))
  return held(s.padEnd(at, "\0").slice(0, at) + String.fromCharCode(Number(c)) + s.slice(at + 1))
}

/** The string a buffer holds — its units before the first 0. */
export function visible(s: string): string {
  const end = s.indexOf("\0")
  return end < 0 ? s : s.slice(0, end)
}

/** A buffer as the value holds it: its trailing zeros trimmed, so one buffer has one spelling. */
export const held = (s: string): string => s.replace(/\0+$/, "")
