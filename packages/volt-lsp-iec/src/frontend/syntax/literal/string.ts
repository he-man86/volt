/**
 * STRING LITERALS — the `$` escapes of a STRING or WSTRING, decoded as CODESYS stores them.
 */

/**
 * A string literal's text with its `$` escapes decoded — only the ones measured on CODESYS (conformance `string_escapes*`,
 * `wstring_code_units`): `$T`/`$t` a tab, `$$` a dollar, `$N` and `$L` ONE line feed, `$R` CR, `$P` form feed, `$'` and `$"`
 * the quotes; two hex digits one byte in a STRING, four one code unit in a WSTRING (`$00E9` = 'é'). Any other escape — and
 * a WSTRING's named escapes, unmeasured — returns undefined, so a caller refuses rather than guesses. The ONE decoder:
 * the transpiler, the string-constant check and the assignment message used to count three different ways.
 */
export function decodeStringLiteral(raw: string, wide = false): string | undefined {
  const MEASURED: Readonly<Record<string, string>> = { T: "\t", t: "\t", N: "\n", L: "\n", R: "\r", P: "\f", $: "$", "'": "'", '"': '"' }
  let out = ""
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== "$") {
      out += raw[i]
      continue
    }
    const digits = wide ? 4 : 2
    const hex = raw.slice(i + 1, i + 1 + digits)
    if (hex.length === digits && /^[0-9A-Fa-f]+$/.test(hex)) {
      const code = parseInt(hex, 16)
      // A STRING HOLDS UTF-8 BYTES, AND `$XX` NAMES A WINDOWS-1252 BYTE — not the code point U+00XX. The
      // compiler decodes it through that codepage and stores the UTF-8 encoding, so `LEN` counts the bytes.
      // Sixteen cells measured (`strings/escapes.ts`, 2026-09-19) and all sixteen follow it:
      //
      //   $41 $7E $7F              1   ASCII
      //   $81 $8D $9D              2   UNDEFINED in CP1252 — they fall back to U+0081/008D/009D
      //   $83 $8A $9F $A9 $C3 $FF  2   ƒ Š Ÿ © Ã ÿ, all below U+0800
      //   $80 $92 $99 $9B          3   € ' ™ ›, all above it
      //
      // `$80` answering THREE was the cell nothing explained while `$XX` was read as U+00XX; it is the one the
      // codepage differs on most visibly, and the four three-byte answers rule the Latin-1 reading out entirely.
      // `$C3$A9` is FOUR, not two — the pair is two CP1252 bytes, not the UTF-8 'é' it would spell.
      //
      // The bytes are kept as one JS char each, so `.length` IS the byte count and `slice` cuts on byte
      // boundaries — the same model the emitter already has in `&[u8]`.
      out += wide || code < 0x80 ? String.fromCharCode(code) : utf8Bytes(CP1252[code] ?? code)
      i += digits
      continue
    }
    if (wide) return undefined // a WSTRING's named escapes are not measured yet
    const decoded = MEASURED[raw[++i] ?? ""]
    if (decoded === undefined) return undefined
    out += decoded
  }
  return out
}

/**
 * WINDOWS-1252's own 0x80..0x9F, the only bytes where it differs from Latin-1. The five it leaves UNDEFINED
 * (0x81, 0x8D, 0x8F, 0x90, 0x9D) are absent, so the caller's `?? code` gives them U+0081 and friends — which is
 * what the compiler does with them (`esc_len_hex_81`, `_8d`, `_9d` all answer 2).
 */
const CP1252: Readonly<Record<number, number>> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
}

/** A code point's UTF-8 bytes, one JS char each — two below U+0800, three above it. */
function utf8Bytes(code: number): string {
  if (code < 0x800) return String.fromCharCode(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
  return String.fromCharCode(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
}
