# Status — 2026-09-21

## Where it stands

```
2595 fixtures        confirmed 1925 (74.2%)   refused 537 (20.7%)
                     not-lowered 90           lsp-gap 4     diverges 3    unaskable 36
                     unasked 0

the vendor has ANSWERED 2555 of 2595 (98.5%)
of the 1928 we both EXECUTE, we match 1925 — 99.8%

agreement (exact message-for-message on the build recordings): 2545 codesys / 2528 twincat
corpus: zero false positives on five real projects
```

The suite was 967 fixtures when this change was written. Every one has been put to a real CODESYS;
`unasked: 0` has held since the day it was reached, and **every one has now been put to a real TwinCAT too**
(`twincat-conformance-parity`) — which is where the agreement row comes from. It read 866 / 266 on 2026-09-19,
and the second number was never a divergence: it was 2250 questions TwinCAT had not been asked.

## The sweeps, and what each found

| sweep | cells | found |
|---|---|---|
| primitive defaults | 29 | the simulator is a 64-bit target; an alias displays under its canonical name |
| primitive bounds | 64 | an unsigned type accepts `-1`; a signed one refuses its own minimum minus one |
| unary operators | 35 | **minus widens an 8-bit operand; NOT was implemented for signed integers only** |
| arithmetic edges | 64 | **integer division is not wrapping — `MIN / -1` STOPS at 32 and 64 bits** |
| the meet lattice | 175 | **`BYTE + BYTE` is USINT; every mixed expression inferred `unknown`, silencing every check** |
| real overflow + math domain | 28 | **the fault model was wrong — it is dividing by zero and the logarithm of zero** |
| comparison + bitwise | 175 | cross-signedness comparison is width-dependent; a shift past 32 bits is masked |
| REAL → integer | 192 | **the conversion happens at the DESTINATION's register width — the two oldest divergences** |
| integer → integer | 176 | a pure two's-complement reinterpretation; no saturation anywhere |
| integer → REAL, rounding | 80 | half away from zero, confirmed on eight halves instead of one |
| selection functions | 49 | **MIN and MAX inferred `unknown`**; MUX clamps past its last input |
| string edges | 47 | **DELETE at position 0 removes a character** |
| cross-family conversions | 76 | **28 date conversions were refused as "not measured"; now one tick rule** |
| section semantics | 22 | **a composite VAR_TEMP starts over too** — `var-temp-composite` retired |
| platform integers | 18 | **`__XINT` / `__UXINT` / `__XWORD` were missing from the type system entirely** |
| the atomic operators | 15 | **every one-sample reading was wrong** — `__XADD` wants a FIXED `POINTER TO DINT` |
| hex string escapes | 16 | **`$hh` is a WINDOWS-1252 byte**, not the code point U+00XX — `$80` explained |
| `__POSITION` / `__CURRENTTASK` | 12 | **`__POSITION` is a call whose missing parentheses eat the next token** |
| `CALC` | 5 | **it is the IL conditional call, which is why it was never a reserved NAME** |
| `__NEW` and its pragma | 5 | the pragma is the only variable; the recording that said otherwise was our own |
| string ordering | 8 | unsigned, byte by byte, a prefix losing — **and two strings meet at the WIDER capacity** |
| to-string formats | 106 | **LREAL's formatter is exact; REAL's is not derivable from seventy cells** |

### …and the sweeps since (2026-09-20/21, both vendors)

Every one is the same move: a family answered by two or three cells, asked at every width or position it has.
Three of them found that a NOTE written beside the old cells was wrong, which is the cheapest kind of bug to have.

| sweep | cells | found |
|---|---|---|
| WSTRING hex escapes | 13 | **the form is FOUR digits** — three cells recorded that `"$41"` is refused and cannot say whether that means "no `$` in a WSTRING" or "not four digits"; `$0041`, `$20AC`, `a$0041b`, the named escapes and both `WSTRING(n)` forms all compile |
| `tc_*` attributes | 17 | **`{attribute 'TcRetain'}` is TwinCAT's and CODESYS warns about it** — one flat catalog made every `Tc*` name known to both. The seventeenth (`Tc2GvlVarNames` on a GVL) is silent for a different reason: the attribute pass does not run on a GVL file, as it does not on a DUT |
| partial-access widths | 2 | `.%X`/`.%D` had been asserted in a note beside the measured `.%W`/`.%B`; asked, they answer identically — a CODESYS extension TwinCAT reads as a member access. Asking `.%X` also handed the transpiler the value it had been bailing on |
| `TEST_AND_SET` operands | 7 | **the operand converts to DWORD exactly as an assignment would** — DWORD/UDINT make no temporary, a legal conversion makes one and a temporary has no address, and a type with no conversion at all reports the conversion instead |
| `NOT` on the date types | 3 | `NOT aTime` had been written down as "nothing beyond the UDINT it produces"; the recording carried the operand conversion all along, and TOD, DT and LTIME answer at their own widths |
| `-` on a BOOL | 1 | the same row, asked into a STRING where the operand message cannot hide behind the result's |
| `__NEW`'s pragma, again | 3 | **the attribute moves NOTHING on either vendor** — not for a self-reference, a different FB, a STRUCT, or by its absence. CODESYS names the missing memory pool beside the message and TwinCAT does not, which is the only difference between them |
| declaration initializers | 4 | **an initializer is not a constant-only place** (a sibling VARIABLE initializes one), and a `__` name the compiler does not know is a PARSE refusal there rather than an undefined identifier |
| a METHOD's required inputs | 1 | the check was gated to `function` and the METHOD form had never been asked; both vendors answer with the same message, naming the method |

**Twenty-odd product bugs, in sweeps that mostly confirmed what we already did.** The ones in bold changed behaviour.

## `lsp-gap` 36 → 2 → 4

It came down over one run of measurements, and one of them was a fault in the GATE rather than the product:

- **the signature-name family** — `lspReportsAnError` was analysing the TRANSPILER's assembly, which concatenates
  every dependency and the synthesized PLC_PRG into one source. Read as a file that is two top-level POUs, which
  `signature-name` correctly ignores, so four measured refusals read as phantom gaps. It builds the file set the
  way a workspace has it now: one item, one file.
- the operator CALL FORMS (`ADD(a, b)` is Instruction List), `__POSITION`, `__CURRENTTASK`, the `CALC` family,
  `ANYNUM_TO_*` (not a CODESYS function — the 80 corpus uses are all inside materialized library files),
  `FB_Init`'s declaration arguments, `__QUERYPOINTER`'s first operand, `__NEW`'s pragma.
- `cc5_pointer_not_convertible` was never a gap: C0033's severity is the PROJECT's, and the message agrees.

**The two left are the same decision.** `??? := <call>()` is refused by the compiler and carried four times by
lenze-mid in a project that builds clean. Both are right: the compiler never reads network text — the recorder
pushes a fixture through the BRIDGE, which writes PlcOpen XML — so the fixture measures the XML the bridge makes of
a `???` and the corpus measures the XML its author drew. The fidelity question belongs to `volt-cli`.

**Two more since, and both are gaps a FIXTURE created by asking properly** — which is the rating working rather
than failing. `op_sys_queryinterface` had always named an interface another fixture declares, in a METHOD BODY,
which `withDependencies` does not scan; it was never pushed, so every recording said `Unknown type`. Given its own
interface it records CODESYS's three real answers and the LSP says nothing about any of them.
`cc_decl_init_dunder_unknown` asks what both vendors do with an unknown `__` name in a declaration initializer — a
parse refusal — and `nameResolves` accepts every unlisted `__` name on purpose, so an unlisted system operator is
never a false positive. Completing that catalog on both vendors is the prerequisite, and it is written on the
fixture rather than left to be rediscovered.

## `diverges` 5 → 3, and the three are one cause

CODESYS computes trig with the **x87 FPU**. Computing the same arguments to 300 bits shows both halves of it: near a
zero of COS the correctly rounded answer is ours and CODESYS is a few ULPs out (the hardware kernel), and for a huge
angle it reduces with FSIN's 66-BIT approximation of pi — reducing 1.0E18 by `round(pi * 2^64) / 2^64` reproduces
its COS to all seventeen digits. Only the reduction could be emulated; the kernel could not, and doing half would
close two fixtures and leave the third while making every program's trig depend on emulated hardware.

## `not-lowered` 47 → 75 → 90, which is the number going the right way

The rise is one formatter being told apart from another. `LREAL_TO_STRING` is now exact in both backends — fifteen
significant digits, fixed while the decimal exponent is 0..13, lowercase `e` — and its 35 cells are `confirmed`.
`REAL_TO_STRING` is a DIFFERENT formatter and seventy cells show it is not derivable: two exponential cells print
eight significant digits beside four printing seven at the same magnitudes, and four fractions round their seventh
digit where rounding the value does not. Its 35 cells refuse on purpose.

The 75 became 90 the same way: every rise is a family that was ASKED rather than a capability that was lost.
One fell — `.%X`, a bit of an unsigned integer, had been bailing as "not measured" and
`operand_partial_bit_in_dword` measured it (16#DEADBEEF.%X3 is TRUE), so it lowers.

What else is in them:
- **6 address ALIASING** — two names on one storage. The model is measured at the refusal in `lower/storage.ts`
  (little-endian, addresses numbered in UNITS, bit 0 the least significant) and waits on a byte-addressable area.
- **3 instance-path** — needs the project tree (`Device/Plc Logic/Application`), which a source is not in.
- the rest are individual: two pointer derefs, `SIZEOF` of an interface, a FOR step holding a call, an ANY input
  through an interface, and the three atomics whose POINTER form `pointer-targets` refuses.

## What is left that is NOT a census topic

- **`batches/`** — six files named after the batch they arrived in. Should shrink to nothing.
- **D6, the METHOD/ACTION bodies** — still governs everything, but the number was wrong and is now measured:
  **558 of 56,629 are REACHED**, not none. A routine lowers when a POU that lowers calls it, and that mechanism
  has always existed; only **20** of the 558 come from a POU that RUNS, the rest being lifecycle methods reached
  from declaration-only POUs. So D6 is not a missing mechanism — it is the same 56-of-304 problem, stated once.
  Corrected in `src/transpile/index.ts` and gated by `lowering-totality.test.ts` (2026-09-19; re-measured 2026-09-21).
