/**
 * Operators and conversion pairs the CORPUS writes and the catalog did not (census, 2026-09-16 — second pass, after
 * `corpus-types` and `corpus-pragmas` took the first 37).
 *
 * `ANY_TO_INT` 40 and its family 32 more, `MOVE` 2 — over a direct ADDRESS, which is the only place the corpus writes
 * one as an expression (8) — the Standard string functions no fixture called by name, and the dozen `X_TO_Y` pairs no fixture had:
 * `UINT_TO_INT`, `REAL_TO_UINT`, `LREAL_TO_INT`, `SINT_TO_DWORD`, `INT_TO_UINT`, `UINT_TO_REAL`, `DWORD_TO_REAL`,
 * `REAL_TO_DWORD`, `INT_TO_STRING`, `UINT_TO_STRING`, `DWORD_TO_STRING`, `REAL_TO_BYTE`, `BYTE_TO_DWORD`. Each is
 * written where its answer is a boundary, not a round number. Recorded like every other fixture: built and RUN in SP21.
 */
import type { LanguageTest } from "../types.js"

const doc = "conformance — operators the corpus uses"

function fb(name: string, pouName: string, feature: string, source: string, plcPrgVar: string, plcPrgBody: string, cycles?: number): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar, plcPrgBody, ...(cycles === undefined ? {} : { cycles }) }
}

export const CORPUS_OPERATOR_TESTS: readonly LanguageTest[] = [
  // ─── the ANY_TO_* family, 72 uses ──────────────────────────────────────────
  fb("co_any_to_conversions", "FB_CO_any", "ANY_TO_INT and its family over a literal, a constant and a variable — the generic source the corpus writes",
    `FUNCTION_BLOCK FB_CO_any
VAR CONSTANT
	cLimit : DINT := 16#80000000;
END_VAR
VAR
	source : DINT := 300;
	realSource : REAL := -2.5;
	asInt : INT;
	fromLiteral : INT;
	fromConstant : DINT;
	asDword : DWORD;
	asDint : DINT;
	asUdint : UDINT;
	asByte : BYTE;
	asUlint : ULINT;
END_VAR
asInt := ANY_TO_INT(source);
fromLiteral := ANY_TO_INT(60);
fromConstant := ANY_TO_DINT(cLimit);
asDword := ANY_TO_DWORD(source);
asDint := ANY_TO_DINT(realSource);
asUdint := ANY_TO_UDINT(source);
asByte := ANY_TO_BYTE(source);
asUlint := ANY_TO_ULINT(source);
END_FUNCTION_BLOCK
`,
    "inst : FB_CO_any;", "inst();"),

  // ─── MOVE, and the one place the corpus writes an ADDRESS as an expression ─
  fb("co_move_operator", "FB_CO_move", "the MOVE operator over a variable, a constant and a direct address — which is the only expression the corpus puts an address in",
    `FUNCTION_BLOCK FB_CO_move
VAR
	source : INT := 7;
	moved : INT;
	movedConstant : INT;
	fromImage : BYTE;
	marker AT %MW20 : WORD := 16#1234;
	movedMarker : WORD;
END_VAR
moved := MOVE(source);
movedConstant := MOVE(11);
movedMarker := MOVE(marker);
END_FUNCTION_BLOCK
`,
    "inst : FB_CO_move;", "inst();"),

  // ─── the conversion pairs no fixture had, each at a boundary ───────────────
  fb("co_remaining_conversion_pairs", "FB_CO_pairs", "the X_TO_Y pairs the corpus writes and the catalog missed, each where the answer is a boundary",
    `FUNCTION_BLOCK FB_CO_pairs
VAR
	bigUint : UINT := 40000;
	negativeInt : INT := -1;
	bigReal : REAL := 70000.6;
	negativeReal : REAL := -1.5;
	wideReal : LREAL := 40000.5;
	smallSint : SINT := -2;
	bits : DWORD := 16#C0000000;
	uintToInt : INT;
	realToUint : UINT;
	lrealToInt : INT;
	sintToDword : DWORD;
	intToUint : UINT;
	uintToReal : REAL;
	dwordToReal : REAL;
	realToDword : DWORD;
	realToByte : BYTE;
	intToString : STRING(12);
	uintToString : STRING(12);
	dwordToString : STRING(12);
END_VAR
uintToInt := UINT_TO_INT(bigUint);
realToUint := REAL_TO_UINT(bigReal);
lrealToInt := LREAL_TO_INT(wideReal);
sintToDword := SINT_TO_DWORD(smallSint);
intToUint := INT_TO_UINT(negativeInt);
uintToReal := UINT_TO_REAL(bigUint);
dwordToReal := DWORD_TO_REAL(bits);
realToDword := REAL_TO_DWORD(bigReal);
realToByte := REAL_TO_BYTE(negativeReal);
intToString := INT_TO_STRING(negativeInt);
uintToString := UINT_TO_STRING(bigUint);
dwordToString := DWORD_TO_STRING(bits);
END_FUNCTION_BLOCK
`,
    "inst : FB_CO_pairs;", "inst();"),

  // ─── the Standard string functions the catalog does not call by these names
  fb("co_standard_string_calls", "FB_CO_text", "REPLACE, DELETE, MID and RIGHT — the Standard string functions the corpus calls and no fixture did",
    `FUNCTION_BLOCK FB_CO_text
VAR
	base : STRING(20) := 'abcdefghij';
	replaced : STRING(20);
	deleted : STRING(20);
	middle : STRING(20);
	tail : STRING(20);
	found : INT;
	pastEnd : STRING(20);
	negative : STRING(20);
END_VAR
replaced := REPLACE(base, 'XY', 2, 3);
deleted := DELETE(base, 4, 2);
middle := MID(base, 3, 5);
tail := RIGHT(base, 4);
found := FIND(base, 'de');
pastEnd := MID(base, 5, 20);
negative := DELETE(base, 2, -1);
END_FUNCTION_BLOCK
`,
    "inst : FB_CO_text;", "inst();"),
]
