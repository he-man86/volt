/**
 * Types and conversions the CORPUS uses and the catalog did not (census, 2026-09-16 — `scripts/_census`, a diff of every
 * construct in the four real projects against every construct in these fixtures).
 *
 * The corpus is the last check, not the specification: what it contains belongs HERE, where it is recorded and replayed
 * rather than merely compiled. The gaps this batch closes, by how often the corpus writes them: `LWORD` 751 and
 * `__XWORD` 963 (no fixture had either), the bare `TO_<type>` conversions 132 + 69 + 30 + … (the catalog only ever wrote
 * `X_TO_Y`), the bit-string crossings `UINT_TO_DWORD` 241 and its family, `BIT` fields with `BOOL_TO_BIT` 56, and a
 * SUBRANGE converted like a number. Recorded like every other fixture: built and RUN in CODESYS SP21.
 */
import type { LanguageTest } from "../types.js"

const doc = "conformance — types the corpus uses"

function fb(name: string, pouName: string, feature: string, source: string, plcPrgVar: string, plcPrgBody: string, cycles?: number): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar, plcPrgBody, ...(cycles === undefined ? {} : { cycles }) }
}

export const CORPUS_TYPE_TESTS: readonly LanguageTest[] = [
  // ─── LWORD: 751 uses in the corpus, none in the catalog ────────────────────
  fb("ct_lword_arithmetic", "FB_CT_lword", "LWORD — the 64-bit bit string: its bounds, the bitwise operators, a shift past 32 and its conversions",
    `FUNCTION_BLOCK FB_CT_lword
VAR
	high : LWORD := 16#FFFFFFFFFFFFFFFF;
	mask : LWORD := 16#00000000FFFF0000;
	anded : LWORD;
	ored : LWORD;
	xored : LWORD;
	inverted : LWORD;
	shifted : LWORD;
	rotated : LWORD;
	wrapped : LWORD;
	asUlint : ULINT;
	fromDword : LWORD;
	backToDword : DWORD;
	topBit : BOOL;
END_VAR
anded := high AND mask;
ored := mask OR 16#F;
xored := high XOR mask;
inverted := NOT mask;
shifted := SHL(mask, 20);
rotated := ROR(mask, 4);
wrapped := high + 1;
asUlint := LWORD_TO_ULINT(mask);
fromDword := DWORD_TO_LWORD(16#ABCD1234);
backToDword := LWORD_TO_DWORD(high);
topBit := high.63;
END_FUNCTION_BLOCK
`,
    "inst : FB_CT_lword;", "inst();"),

  // ─── the pointer-width types: 963 uses of __XWORD in the corpus ────────────
  fb("ct_pointer_width_types", "FB_CT_xword", "__XINT, __UXINT and __XWORD — the pointer-width integers (`__UXWORD` is no type: the IDE refuses it), their size and their conversions",
    `FUNCTION_BLOCK FB_CT_xword
VAR
	signed : __XINT := -5;
	unsigned : __UXINT := 9;
	bits : __XWORD := 16#FF;
	sum : __UXINT;
	masked : __XWORD;
	asDint : DINT;
	widthOfXint : DINT;
	widthOfXword : DINT;
	address : __UXINT;
	target : INT := 42;
	readBack : INT;
	here : POINTER TO INT;
END_VAR
sum := unsigned + 1;
masked := bits AND 16#0F;
asDint := __XINT_TO_DINT(signed);
widthOfXint := SIZEOF(signed);
widthOfXword := SIZEOF(bits);
here := ADR(target);
readBack := here^;
END_FUNCTION_BLOCK
`,
    "inst : FB_CT_xword;", "inst();"),

  // ─── the bare TO_<type> conversions, which the catalog never wrote ─────────
  fb("ct_bare_to_conversions", "FB_CT_bare", "the bare `TO_<type>` conversions the corpus writes — TO_STRING, TO_REAL, TO_UINT, TO_DINT, TO_USINT, TO_LREAL, TO_UDINT, TO_WORD, TO_DWORD, TO_TIME",
    `FUNCTION_BLOCK FB_CT_bare
VAR
	source : INT := -7;
	unsignedSource : UINT := 40000;
	realSource : REAL := 2.5;
	msSource : DINT := 1500;
	asString : STRING(12);
	asReal : REAL;
	asUint : UINT;
	asDint : DINT;
	asUsint : USINT;
	asLreal : LREAL;
	asUdint : UDINT;
	asWord : WORD;
	asDword : DWORD;
	asTime : TIME;
	roundedToInt : INT;
END_VAR
asString := TO_STRING(source);
asReal := TO_REAL(source);
asUint := TO_UINT(source);
asDint := TO_DINT(unsignedSource);
asUsint := TO_USINT(unsignedSource);
asLreal := TO_LREAL(realSource);
asUdint := TO_UDINT(unsignedSource);
asWord := TO_WORD(unsignedSource);
asDword := TO_DWORD(unsignedSource);
asTime := TO_TIME(msSource);
roundedToInt := TO_INT(realSource);
END_FUNCTION_BLOCK
`,
    "inst : FB_CT_bare;", "inst();"),

  // ─── integer <-> bit string, the crossing the corpus writes 241 times ──────
  fb("ct_integer_bitstring_crossings", "FB_CT_cross", "the integer-to-bit-string conversions the corpus uses — UINT_TO_DWORD and its family, each at a boundary",
    `FUNCTION_BLOCK FB_CT_cross
VAR
	small : SINT := -1;
	unsignedSmall : USINT := 200;
	middle : UINT := 65535;
	signedMiddle : INT := -2;
	wide : DWORD := 16#FFFF0001;
	asDwordFromUint : DWORD;
	asWordFromSint : WORD;
	asDwordFromUsint : DWORD;
	asDwordFromInt : DWORD;
	asIntFromDword : INT;
	asDintFromDword : DINT;
	asLrealFromDword : LREAL;
	asBoolFromByte : BOOL;
	asByteFromBool : BYTE;
	asDwordFromByte : DWORD;
END_VAR
asDwordFromUint := UINT_TO_DWORD(middle);
asWordFromSint := SINT_TO_WORD(small);
asDwordFromUsint := USINT_TO_DWORD(unsignedSmall);
asDwordFromInt := INT_TO_DWORD(signedMiddle);
asIntFromDword := DWORD_TO_INT(wide);
asDintFromDword := DWORD_TO_DINT(wide);
asLrealFromDword := DWORD_TO_LREAL(wide);
asBoolFromByte := BYTE_TO_BOOL(16#80);
asByteFromBool := BOOL_TO_BYTE(TRUE);
asDwordFromByte := BYTE_TO_DWORD(16#FE);
END_FUNCTION_BLOCK
`,
    "inst : FB_CT_cross;", "inst();"),

  // ─── BIT fields in a struct, with BOOL_TO_BIT (56 uses) ────────────────────
  fb("ct_bit_fields", "FB_CT_bits", "BIT fields packed in a STRUCT of another object, written from a BOOL and read back",
    `TYPE DUT_CT_flags :
STRUCT
	ready : BIT;
	busy : BIT;
	fault : BIT;
	spare : BYTE;
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_CT_bits
VAR
	flags : DUT_CT_flags;
	readyOut : BOOL;
	faultOut : BOOL;
	size : DINT;
END_VAR
flags.ready := TRUE;
flags.busy := BOOL_TO_BIT(FALSE);
flags.fault := TRUE;
flags.spare := 16#A5;
readyOut := flags.ready;
faultOut := BIT_TO_BOOL(flags.fault);
size := SIZEOF(flags);
END_FUNCTION_BLOCK
`,
    "inst : FB_CT_bits;", "inst();"),

  // How BIT fields PACK — the one thing `ct_bit_fields` measured (three BITs and a BYTE are 2) does not settle. Each
  // arrangement's SIZEOF, recorded before the layout is built.
  fb("ct_bit_packing_sizes", "FB_CT_packing", "SIZEOF of seven structs of BIT fields — one, eight, nine, a BIT after a byte, a BIT before an INT, and BITs split by a byte",
    `TYPE DUT_CT_p1 : STRUCT a : BIT; END_STRUCT END_TYPE
TYPE DUT_CT_p8 : STRUCT a : BIT; b : BIT; c : BIT; d : BIT; e : BIT; f : BIT; g : BIT; h : BIT; END_STRUCT END_TYPE
TYPE DUT_CT_p9 : STRUCT a : BIT; b : BIT; c : BIT; d : BIT; e : BIT; f : BIT; g : BIT; h : BIT; i : BIT; END_STRUCT END_TYPE
TYPE DUT_CT_pAfter : STRUCT lead : BYTE; a : BIT; END_STRUCT END_TYPE
TYPE DUT_CT_pBeforeInt : STRUCT a : BIT; wide : INT; END_STRUCT END_TYPE
TYPE DUT_CT_pSplit : STRUCT a : BIT; mid : BYTE; b : BIT; END_STRUCT END_TYPE
TYPE DUT_CT_pBool : STRUCT a : BOOL; b : BOOL; END_STRUCT END_TYPE

FUNCTION_BLOCK FB_CT_packing
VAR
	one : DINT;
	eight : DINT;
	nine : DINT;
	afterByte : DINT;
	beforeInt : DINT;
	split : DINT;
	bools : DINT;
END_VAR
one := SIZEOF(DUT_CT_p1);
eight := SIZEOF(DUT_CT_p8);
nine := SIZEOF(DUT_CT_p9);
afterByte := SIZEOF(DUT_CT_pAfter);
beforeInt := SIZEOF(DUT_CT_pBeforeInt);
split := SIZEOF(DUT_CT_pSplit);
bools := SIZEOF(DUT_CT_pBool);
END_FUNCTION_BLOCK
`,
    "inst : FB_CT_packing;", "inst();"),

  // ─── a SUBRANGE, declared and converted like the number it is ──────────────
  fb("ct_subrange_across_objects", "FB_CT_ranged", "a SUBRANGE type from another object: its initial value, arithmetic on it, and a conversion out of it",
    `TYPE DUT_CT_percent : INT(0..100) := 50;
END_TYPE

FUNCTION_BLOCK FB_CT_ranged
VAR
	level : DUT_CT_percent;
	inline : INT(0..10) := 3;
	raised : DUT_CT_percent;
	asWord : WORD;
	asReal : REAL;
	sum : INT;
END_VAR
raised := level + 10;
asWord := TO_WORD(raised);
asReal := TO_REAL(inline);
sum := level + inline;
END_FUNCTION_BLOCK
`,
    "inst : FB_CT_ranged;", "inst();"),

  // ─── a three-dimensional array, which the corpus has and the catalog does not
  fb("ct_three_dimensional_array", "FB_CT_cube", "a three-dimensional ARRAY, written by a triple loop and read by constant index",
    `FUNCTION_BLOCK FB_CT_cube
VAR
	cube : ARRAY[1..2, 0..1, 1..3] OF INT;
	i : INT;
	j : INT;
	k : INT;
	total : INT;
	corner : INT;
	middle : INT;
END_VAR
FOR i := 1 TO 2 DO
	FOR j := 0 TO 1 DO
		FOR k := 1 TO 3 DO
			cube[i, j, k] := i * 100 + j * 10 + k;
			total := total + cube[i, j, k];
		END_FOR
	END_FOR
END_FOR
corner := cube[1, 0, 1];
middle := cube[2, 1, 3];
END_FUNCTION_BLOCK
`,
    "inst : FB_CT_cube;", "inst();"),

  // ─── REAL and LREAL into durations and back, which the corpus writes ───────
  fb("ct_real_time_conversions", "FB_CT_spans", "REAL_TO_TIME and DINT_TO_TIME beside the reverse, each where the rounding shows",
    `FUNCTION_BLOCK FB_CT_spans
VAR
	half : REAL := 2.5;
	down : REAL := 2.4;
	negative : REAL := -2.5;
	ticks : DINT := 1500;
	fromHalf : TIME;
	fromDown : TIME;
	fromNegative : TIME;
	fromTicks : TIME;
	backToDint : DINT;
	backToReal : REAL;
END_VAR
fromHalf := REAL_TO_TIME(half);
fromDown := REAL_TO_TIME(down);
fromNegative := REAL_TO_TIME(negative);
fromTicks := DINT_TO_TIME(ticks);
backToDint := TIME_TO_DINT(fromTicks);
backToReal := TIME_TO_REAL(fromTicks);
END_FUNCTION_BLOCK
`,
    "inst : FB_CT_spans;", "inst();"),
]
