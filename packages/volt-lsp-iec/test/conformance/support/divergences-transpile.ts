/**
 * THE TRANSPILER'S ACCEPTED RUN DIVERGENCES — the vendor routines no backend reproduces (the x87 trig kernel, a FUNCTION
 * frame's stack residue), each fixture's `deferred.transpile` its entry here. One concern of `divergences.ts`
 * (openspec lsp-same-standard 4.4).
 */
/**
 * THE ACCEPTED VENDOR-ROUTINE DIVERGENCES OF THE TRANSPILER (transpile-restructure design.md §7.2, task 6.21) — the three
 * expected failures no task will close. CODESYS's SIN / COS / TAN run on the x87 FPU: a huge angle is reduced with FSIN's
 * 66-bit approximation of pi, and the kernel after it is a hardware polynomial a few ULPs from the correctly rounded value.
 * Both backends compute IEEE libm, correctly rounded; the cause is set out at `src/transpile/semantics/math.ts` and is
 * deliberately not emulated (only the reduction half could be). Each fixture's `deferred.transpile` is its entry here.
 */
export const X87_TRIG_DIVERGENCES = {
  op_math_trig:
    "x87 trig kernel (accepted, design.md §7.2): COS(1.5708) is -3.6732051033465756E-06 in CODESYS, -3.673205103346574e-6 here — the exact value to 300 bits is -3.6732051033465738e-6, so this side is correctly rounded and the FPU's kernel is a few ULPs out; 1.5708 is below pi, so no argument reduction is involved (2026-09-19). Not emulated (`semantics/math.ts`).",
  mathdom_sin_large:
    "x87 argument reduction (accepted, design.md §7.2): CODESYS reduces a huge angle with the x87 FPU's 66-bit pi, not an exact one — SIN(1.0E18) is -0.9928161040530035 there and -0.9929693207404051 here (2026-09-19). Reproducible, deliberately not emulated (`semantics/math.ts`).",
  mathdom_cos_large:
    "x87 argument reduction (accepted, design.md §7.2): CODESYS reduces a huge angle with the x87 FPU's 66-bit pi — reducing by round(pi * 2^64) / 2^64 reproduces its 0.11965025504785125 to all seventeen digits, against 0.11837199021871073 from an exact reduction (2026-09-19). Deliberately not emulated (`semantics/math.ts`).",
} as const

/**
 * THE FUNCTION-FRAME RESIDUE (design.md §7.2, transpile-restructure 8.2): the units behind a FUNCTION's STRING input's
 * terminator are whatever the vendor's STACK held at that frame's address — measured, and not modelled: reproducing them
 * needs every routine's frame layout on the vendor's stack, which no declaration states. Both backends start a
 * FUNCTION's input at zeros. Each fixture's `deferred.transpile` is its entry here.
 */
const FUNCTION_FRAME_RESIDUE =
  "FUNCTION frame residue (accepted, design.md §7.2, transpile-restructure 8.2): behind a FUNCTION's VAR_INPUT STRING(20)'s terminator stands what the vendor's shared stack held there — the previous call's 20 'Y' (89) at p[11..19] when nothing ran between the two calls (`string_store_function_input_tail`, record:exec 2026-10-08, twice: 'Y' and then 'Z'); with another FUNCTION called between them, at the same depth, still 'Y' at p[11..15] but an address's bytes (176, 250, 63, 25, 178) at p[16..20], which that FUNCTION's frame wrote (`string_input_tail_interleaved`, record:exec 2026-10-11) — the buffer is the stack, not one the function keeps. Measured impossible to model: it needs every routine's frame layout on the vendor's stack, which declarations do not state; both backends start the input at zeros. niche: accepted loss (0 occurrences in the corpora: the 72 index or address reads of a STRING VAR_INPUT in the 61 FUNCTIONs and METHODs that declare one all stop at its terminator — StrCpyA / StrConcatA, LEN-bounded indexes)"
export const FUNCTION_FRAME_RESIDUE_DIVERGENCES = {
  string_store_function_input_tail: FUNCTION_FRAME_RESIDUE,
  string_input_tail_interleaved: FUNCTION_FRAME_RESIDUE,
} as const
