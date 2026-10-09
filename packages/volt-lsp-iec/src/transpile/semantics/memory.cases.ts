/**
 * THE BYTE IMAGE'S CASES (model 3, design.md P3 and §3.3 step 4d; `cases.ts`). Each case is one image of two regions —
 * `[0, 16)` and `[24, 32)` from `IMAGE_BASE`, all zeros — taken through a list of stores (an integer or a BOOL at an
 * offset, little-endian), then asked one thing: a load at an offset as a type (an integer or BOOL printed as itself, a
 * REAL or LREAL as its bits in hex), the order of two offsets, or nothing at all. The answer is that printed text, or
 * `fault: <kind>` when the access stops the program. `memory.test.ts` runs the table against `semantics/memory.ts`; the
 * twin harness (`test/conformance/runtime-twins.test.ts`) runs it through rustc against `Mem`
 * (`emit/rust/runtime/pointer.ts`), and holds every case that names a recording to it.
 */
import type { Case } from "./cases.js"

/** An elementary type the cases store or load, by its IEC name. */
export type MemoryType = "BOOL" | "BYTE" | "SINT" | "WORD" | "INT" | "DWORD" | "DINT" | "REAL" | "LINT" | "LREAL"

/** A store of `value` as `type` at `at` bytes from `IMAGE_BASE`. */
export interface MemoryStore {
  readonly type: Exclude<MemoryType, "REAL" | "LREAL">
  readonly at: number
  readonly value: bigint | boolean
}

/** What a case asks of the image once its stores ran. */
export type MemoryRead = { readonly load: MemoryType; readonly at: number } | { readonly order: readonly [number, number] }

export interface MemoryInput {
  readonly stores: readonly MemoryStore[]
  readonly read: MemoryRead
}

/** The image every case starts from: two regions of zeros, a gap of 8 bytes between them. */
export const CASE_IMAGE = { size: 32, bytes: [], regions: [[0, 16], [24, 32]] } as const

/** The cases, keyed by the rule they show. */
export const MEMORY_CASES: Readonly<Record<string, readonly Case<MemoryInput, string>[]>> = {
  "a value is stored little-endian, and read back at any type over its bytes (pointer_byte_walk_struct_padding)": [
    { name: "INT -2 is fe ff: its low byte", input: { stores: [{ type: "INT", at: 0, value: -2n }], read: { load: "BYTE", at: 0 } }, expected: "254" },
    { name: "INT -2 is fe ff: its high byte", input: { stores: [{ type: "INT", at: 0, value: -2n }], read: { load: "BYTE", at: 1 } }, expected: "255" },
    { name: "a byte 16#FF over byte 1 of a DWORD 16#A4A3A2A1, read as a DINT", input: { stores: [{ type: "DWORD", at: 4, value: 0xa4a3a2a1n }, { type: "BYTE", at: 5, value: 0xffn }], read: { load: "DINT", at: 4 } }, expected: "-1532756063" },
    { name: "a byte 16#EE over the low byte of a WORD 16#B2B1", input: { stores: [{ type: "WORD", at: 8, value: 0xb2b1n }, { type: "BYTE", at: 8, value: 0xeen }], read: { load: "WORD", at: 8 } }, expected: "45806" },
    { name: "a BYTE 255 read as a SINT", input: { stores: [{ type: "BYTE", at: 2, value: 255n }], read: { load: "SINT", at: 2 } }, expected: "-1" },
    // NO case for a BOOL whose byte is 2: CODESYS keeps the byte (`bool_byte_two_through_pointer`: `b = TRUE` FALSE, `NOT b`
    // TRUE), which a BOOL read as `<> 0` cannot show — that fixture holds the divergence (niche: accepted loss, review 4d)
    { name: "a BOOL TRUE is the byte 1", input: { stores: [{ type: "BOOL", at: 3, value: true }], read: { load: "BYTE", at: 3 } }, expected: "1" },
    { name: "a LINT at the minimum, read back", input: { stores: [{ type: "LINT", at: 8, value: -(1n << 63n) }], read: { load: "LINT", at: 8 } }, expected: "-9223372036854775808" },
  ],
  "a DINT read as a REAL keeps every bit (reinterpret_dint_as_real_edges)": [
    { name: "a quiet NaN", input: { stores: [{ type: "DINT", at: 0, value: 2143289344n }], read: { load: "REAL", at: 0 } }, expected: "7fc00000",
      recording: { fixture: "reinterpret_dint_as_real_edges", variable: "bQnan", input: "inst_reinterp.dQnan" } },
    { name: "a signalling NaN", input: { stores: [{ type: "DINT", at: 0, value: 2141192192n }], read: { load: "REAL", at: 0 } }, expected: "7fa00000",
      recording: { fixture: "reinterpret_dint_as_real_edges", variable: "bSnan", input: "inst_reinterp.dSnan" } },
    { name: "-0", input: { stores: [{ type: "DINT", at: 0, value: -2147483648n }], read: { load: "REAL", at: 0 } }, expected: "80000000",
      recording: { fixture: "reinterpret_dint_as_real_edges", variable: "bNzero", input: "inst_reinterp.dNzero" } },
    { name: "the smallest denormal", input: { stores: [{ type: "DINT", at: 0, value: 1n }], read: { load: "REAL", at: 0 } }, expected: "1",
      recording: { fixture: "reinterpret_dint_as_real_edges", variable: "bDenorm", input: "inst_reinterp.dDenorm" } },
    { name: "-max", input: { stores: [{ type: "DINT", at: 0, value: -8388609n }], read: { load: "REAL", at: 0 } }, expected: "ff7fffff",
      recording: { fixture: "reinterpret_dint_as_real_edges", variable: "bMin", input: "inst_reinterp.dMin" } },
    { name: "an LREAL -0 from its LINT bits", input: { stores: [{ type: "LINT", at: 8, value: -(1n << 63n) }], read: { load: "LREAL", at: 8 } }, expected: "8000000000000000" },
  ],
  "an access stays inside one region, an order inside one region — its one-past-the-end address included": [
    { name: "two addresses of one region ordered", input: { stores: [], read: { order: [2, 6] } }, expected: "-1" },
    { name: "one address ordered with itself", input: { stores: [], read: { order: [6, 6] } }, expected: "0" },
    { name: "two regions' addresses are not ordered", input: { stores: [], read: { order: [2, 26] } }, expected: "fault: address-across-frames" },
    { name: "a region's start ordered with its one-past-the-end address", input: { stores: [], read: { order: [0, 16] } }, expected: "-1" },
    { name: "the last region's one-past-the-end address ordered with its start", input: { stores: [], read: { order: [32, 24] } }, expected: "1" },
    { name: "one region's one-past-the-end address and another region's address are not ordered", input: { stores: [], read: { order: [16, 26] } }, expected: "fault: address-across-frames" },
    { name: "a load across a region's end", input: { stores: [], read: { load: "DINT", at: 14 } }, expected: "fault: address-outside-image" },
    { name: "a load in the gap between two regions", input: { stores: [], read: { load: "BYTE", at: 18 } }, expected: "fault: address-outside-image" },
    { name: "a load past the image", input: { stores: [], read: { load: "BYTE", at: 40 } }, expected: "fault: address-outside-image" },
  ],
}

/**
 * The cases the INTERPRETER cannot answer, each with its reason — run as expected failures by `memory.test.ts`, so one
 * that starts passing fails the suite until its mark is removed. A REAL is a JavaScript number in the value model, and
 * every NaN a number holds is the one quiet NaN: a signalling NaN's bits do not survive a load (the Rust `f32` keeps
 * them, as CODESYS does).
 */
export const MEMORY_INTERPRETER_DIVERGENCES: Readonly<Record<string, string>> = {
  "a signalling NaN": "a REAL is a JavaScript number, whose NaN is always 7fc00000 — niche: accepted loss (1 occurrence in the corpora: bakon-nano ReadParametersFromAGM views a REAL's bytes through a POINTER TO ARRAY OF BYTE) (design.md §3.3 step 4e)",
}
