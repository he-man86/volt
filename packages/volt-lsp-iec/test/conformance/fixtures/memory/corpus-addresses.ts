/**
 * The last language constructs the census found in the CORPUS and not in the catalog (2026-09-16, third pass — what
 * remains after it is library FB instances and library functions, which are not language).
 *
 * A direct ADDRESS written as an expression — `x := %IB8`, which the corpus does 8 times, reading the process image with
 * no variable to name it — and `DWORD_TO_DT`, the bit-string-to-date crossing. Recorded like every other fixture: built
 * and RUN in CODESYS SP21, where nothing drives an input, so an input image reads 0 and a marker reads what was written.
 */
import type { LanguageTest } from "../../types.js"

const doc = "conformance — addresses the corpus reads"

function fb(name: string, pouName: string, feature: string, source: string, plcPrgVar: string, plcPrgBody: string, cycles?: number): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar, plcPrgBody, ...(cycles === undefined ? {} : { cycles }) }
}

export const CORPUS_ADDRESS_TESTS: readonly LanguageTest[] = [
  fb("ca_direct_address_expression", "FB_CA_image", "a direct address as an EXPRESSION — read from the input image, read and written on a marker, and the same address named twice",
    `FUNCTION_BLOCK FB_CA_image
VAR
	fromInputByte : BYTE;
	fromInputWord : WORD;
	markerFirst : WORD;
	markerAgain : WORD;
	sum : INT;
END_VAR
fromInputByte := %IB8;
fromInputWord := %IW6;
%MW30 := 16#0102;
markerFirst := %MW30;
%MW30 := %MW30 + 1;
markerAgain := %MW30;
sum := BYTE_TO_INT(fromInputByte) + WORD_TO_INT(markerAgain);
END_FUNCTION_BLOCK
`,
    "inst : FB_CA_image;", "inst();", 2),

  // The corpus declares `%IW5` and `%IW6` side by side, and `%QW2` beside `%QB2` — patterns that ALIAS under byte
  // addressing and do not under word addressing, and those projects compile. Which one the simulator uses decides
  // whether Volt's overlap refusal is protecting anything or just refusing the ordinary case. Measured here.
  fb("ca_adjacent_word_addresses", "FB_CA_adjacent", "two adjacent `AT %IW`/`%QW` variables, and a `%QW` beside a `%QB` — whether writing one is seen by the other",
    `FUNCTION_BLOCK FB_CA_adjacent
VAR
	firstWord AT %QW5 : WORD;
	secondWord AT %QW6 : WORD;
	overlapping AT %QW2 : WORD;
	maybeInside AT %QB2 : BYTE;
	seenSecond : WORD;
	seenByte : BYTE;
END_VAR
firstWord := 16#1111;
secondWord := 16#2222;
seenSecond := secondWord;
overlapping := 16#ABCD;
seenByte := maybeInside;
END_FUNCTION_BLOCK
`,
    "inst : FB_CA_adjacent;", "inst();"),

  fb("ca_bitstring_date_conversions", "FB_CA_stamps", "DWORD_TO_DT and the rest of the bit-string-to-date crossings, each from a known count of seconds",
    `FUNCTION_BLOCK FB_CA_stamps
VAR
	seconds : DWORD := 16#5F000000;
	stamp : DT;
	asDate : DATE;
	asTod : TOD;
	backToDword : DWORD;
	asString : STRING(30);
END_VAR
stamp := DWORD_TO_DT(seconds);
asDate := DT_TO_DATE(stamp);
asTod := DT_TO_TOD(stamp);
backToDword := DT_TO_DWORD(stamp);
asString := DT_TO_STRING(stamp);
END_FUNCTION_BLOCK
`,
    "inst : FB_CA_stamps;", "inst();"),
]
