/**
 * the fixtures of `library-bodies.ts` — part B: StringUtils.
 *
 * One slice of `library-bodies.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { fb } from "./library-bodies-shared.js"

export const LIBRARY_BODY_TESTS_B: readonly LanguageTest[] = [
  // ── StringUtils ─────────────────────────────────────────────────────────────────────────────────────────
  fb("lib_stu_length", "StrLenA and StrIsNullOrEmptyA of a string, an empty one, and a STRING(80) with 5 characters",
    `FUNCTION_BLOCK FB_LANG_LIB_length
VAR
\ttext : STRING := 'hello';
\tempty : STRING;
\tlong : STRING(80) := 'abcde';
\tlenS : DINT;
\tlenEmpty : DINT;
\tlenLong : DINT;
\tisEmpty : BOOL;
\tnotEmpty : BOOL;
END_VAR
lenS := StrLenA(ADR(text));
lenEmpty := StrLenA(ADR(empty));
lenLong := StrLenA(ADR(long));
isEmpty := StrIsNullOrEmptyA(ADR(empty));
notEmpty := StrIsNullOrEmptyA(ADR(text));
END_FUNCTION_BLOCK
`),
  fb("lib_stu_concat", "StrConcatA that fits, one exactly at the buffer, and one a byte too big — the answer and what is left",
    `FUNCTION_BLOCK FB_LANG_LIB_concat
VAR
\ttail : STRING := 'bar';
\tfits : STRING(80) := 'foo';
\texact : STRING(80) := 'foo';
\ttooBig : STRING(80) := 'foo';
\tokFits : BOOL;
\tokExact : BOOL;
\tokTooBig : BOOL;
END_VAR
okFits := StrConcatA(pstFrom := ADR(tail), pstTo := ADR(fits), iBufferSize := 80);
okExact := StrConcatA(pstFrom := ADR(tail), pstTo := ADR(exact), iBufferSize := 7);
okTooBig := StrConcatA(pstFrom := ADR(tail), pstTo := ADR(tooBig), iBufferSize := 6);
END_FUNCTION_BLOCK
`),
  fb("lib_stu_copy", "StrCpyA into a buffer large enough, one that cuts it, and one of size 1 — the count and the text",
    `FUNCTION_BLOCK FB_LANG_LIB_copy
VAR
\tsrc : STRING := 'hello';
\twhole : STRING(20) := 'xxxxxxxxxx';
\tcut : STRING(20) := 'xxxxxxxxxx';
\tnone : STRING(20) := 'xxxxxxxxxx';
\tnWhole : DINT;
\tnCut : DINT;
\tnNone : DINT;
END_VAR
nWhole := StrCpyA(pBuffer := ADR(whole), iBufferSize := 20, pStr := ADR(src));
nCut := StrCpyA(pBuffer := ADR(cut), iBufferSize := 4, pStr := ADR(src));
nNone := StrCpyA(pBuffer := ADR(none), iBufferSize := 1, pStr := ADR(src));
END_FUNCTION_BLOCK
`),
  fb("lib_stu_compare", "StrCmpA and StrCaseCmpA: equal, less, greater, a prefix, and case — the VALUE, not only its sign",
    `FUNCTION_BLOCK FB_LANG_LIB_compare
VAR
\tabc : STRING := 'abc';
\tabc2 : STRING(30) := 'abc';
\tabd : STRING := 'abd';
\tab : STRING := 'ab';
\tupper : STRING := 'ABC';
\tequal : INT;
\tless : INT;
\tgreater : INT;
\tprefix : INT;
\tlonger : INT;
\tcaseEqual : INT;
\tcaseSensitive : INT;
END_VAR
equal := StrCmpA(ADR(abc), ADR(abc2));
less := StrCmpA(ADR(abc), ADR(abd));
greater := StrCmpA(ADR(abd), ADR(abc));
prefix := StrCmpA(ADR(abc), ADR(ab));
longer := StrCmpA(ADR(ab), ADR(abc));
caseEqual := StrCaseCmpA(ADR(abc), ADR(upper));
caseSensitive := StrCmpA(ADR(abc), ADR(upper));
END_FUNCTION_BLOCK
`),
  fb("lib_stu_start_end", "StrCmpStartA, StrCmpEndA and their case-folding forms, matching and not",
    `FUNCTION_BLOCK FB_LANG_LIB_start_end
VAR
\ttext : STRING := 'hello';
\thel : STRING := 'hel';
\tllo : STRING := 'llo';
\tupperLlo : STRING := 'LLO';
\txyz : STRING := 'xyz';
\tlonger : STRING := 'hello world';
\tstarts : INT;
\tnotStarts : INT;
\tends : INT;
\tnotEnds : INT;
\tsuffixLonger : INT;
\tcaseEnds : INT;
\tcaseStarts : INT;
END_VAR
starts := StrCmpStartA(ADR(text), ADR(hel));
notStarts := StrCmpStartA(ADR(text), ADR(xyz));
ends := StrCmpEndA(ADR(text), ADR(llo));
notEnds := StrCmpEndA(ADR(text), ADR(hel));
suffixLonger := StrCmpEndA(ADR(text), ADR(longer));
caseEnds := StrCaseCmpEndA(ADR(text), ADR(upperLlo));
caseStarts := StrCaseCmpStartA(ADR(upperLlo), ADR(llo));
END_FUNCTION_BLOCK
`),
  fb("lib_stu_pad", "StrPadLeftA and StrPadRightA to a buffer of 6, and a source already longer than it",
    `FUNCTION_BLOCK FB_LANG_LIB_pad
VAR
\tabc : STRING := 'abc';
\tlong : STRING := 'abcdefgh';
\tleft : STRING(20) := 'zz';
\tright : STRING(20) := 'zz';
\ttooLong : STRING(20) := 'zz';
\tokLeft : BOOL;
\tokRight : BOOL;
\tokTooLong : BOOL;
END_VAR
okLeft := StrPadLeftA(byPadChar := 16#2A, pstFrom := ADR(abc), pstTo := ADR(left), diBufferSize := 6);
okRight := StrPadRightA(byPadChar := 16#2E, pstFrom := ADR(abc), pstTo := ADR(right), diBufferSize := 6);
okTooLong := StrPadLeftA(byPadChar := 16#2A, pstFrom := ADR(long), pstTo := ADR(tooLong), diBufferSize := 6);
END_FUNCTION_BLOCK
`),
  fb("lib_stu_find", "StrFindA and StrCaseFindA from search starts 0, 1 and 3, not found, and of an empty string",
    `FUNCTION_BLOCK FB_LANG_LIB_find
VAR
\ttwice : STRING := 'ababab';
\tab : STRING := 'ab';
\tupperAb : STRING := 'AB';
\txyz : STRING := 'xyz';
\tempty : STRING;
\tfromZero : INT;
\tfromOne : INT;
\tfromThree : INT;
\tnotFound : INT;
\tofEmpty : INT;
\tcaseFound : INT;
\tcaseSensitive : INT;
END_VAR
fromZero := StrFindA(ADR(twice), ADR(ab), 0);
fromOne := StrFindA(ADR(twice), ADR(ab), 1);
fromThree := StrFindA(ADR(twice), ADR(ab), 3);
notFound := StrFindA(ADR(twice), ADR(xyz), 1);
ofEmpty := StrFindA(ADR(twice), ADR(empty), 1);
caseFound := StrCaseFindA(ADR(twice), ADR(upperAb), 2);
caseSensitive := StrFindA(ADR(twice), ADR(upperAb), 1);
END_FUNCTION_BLOCK
`),
  fb("lib_stu_wide", "StrFindW, StrCaseFindW, StrCmpW and StrCaseCmpW over WSTRINGs",
    `FUNCTION_BLOCK FB_LANG_LIB_wide
VAR
\thello : WSTRING := "hello";
\thello2 : WSTRING(30) := "hello";
\tlo : WSTRING := "lo";
\tupperLo : WSTRING := "LO";
\tupperHello : WSTRING := "HELLO";
\tfound : INT;
\tcaseFound : INT;
\tequal : INT;
\tcaseEqual : INT;
\tcaseSensitive : INT;
END_VAR
found := StrFindW(ADR(hello), ADR(lo), 1);
caseFound := StrCaseFindW(ADR(hello), ADR(upperLo), 1);
equal := StrCmpW(ADR(hello), ADR(hello2));
caseEqual := StrCaseCmpW(ADR(hello), ADR(upperHello));
caseSensitive := StrCmpW(ADR(hello), ADR(upperHello));
END_FUNCTION_BLOCK
`),
  fb("lib_stu_chars", "CharToUpper, WCharToUpper and IsSpaceCharacter across letters, a digit, a byte past ASCII and the space set",
    `FUNCTION_BLOCK FB_LANG_LIB_chars
VAR
\tupperA : BYTE;
\tupperZ : BYTE;
\tdigit : BYTE;
\thigh : BYTE;
\talready : BYTE;
\twideA : WORD;
\twideHigh : WORD;
\tspace : BOOL;
\ttab : BOOL;
\tcr : BOOL;
\tletter : BOOL;
\tnbsp : BOOL;
END_VAR
upperA := CharToUpper(16#61);
upperZ := CharToUpper(16#7A);
digit := CharToUpper(16#35);
high := CharToUpper(16#E9);
already := CharToUpper(16#41);
wideA := WCharToUpper(16#61);
wideHigh := WCharToUpper(16#E9);
space := IsSpaceCharacter(16#20);
tab := IsSpaceCharacter(16#09);
cr := IsSpaceCharacter(16#0D);
letter := IsSpaceCharacter(16#41);
nbsp := IsSpaceCharacter(16#A0);
END_FUNCTION_BLOCK
`),
  fb("lib_stu_trim", "StrTrimA in place: spaces and a TAB on both sides, inner spaces, nothing to trim, only spaces, empty",
    `FUNCTION_BLOCK FB_LANG_LIB_trim
VAR
\tboth : STRING(20);
\tinner : STRING(20);
\tnone : STRING(20);
\tblank : STRING(20);
\tempty : STRING(20);
END_VAR
both := ' $T ab  ';
inner := '  a b c ';
none := 'abc';
blank := '    ';
empty := '';
StrTrimA(ADR(both));
StrTrimA(ADR(inner));
StrTrimA(ADR(none));
StrTrimA(ADR(blank));
StrTrimA(ADR(empty));
END_FUNCTION_BLOCK
`),
  fb("lib_stu_mid", "StrMidA: a middle, in place, past the end, a cut result buffer, position 0, position past the length, length 0",
    `FUNCTION_BLOCK FB_LANG_LIB_mid
VAR
\ttext : STRING(20);
\tmiddle : STRING(20);
\tinPlace : STRING(40);
\tpastEnd : STRING(20);
\tcut : STRING(20);
\tposZero : STRING(20);
\tposPast : STRING(20);
\tnoLength : STRING(20);
END_VAR
text := 'abcdefgh';
middle := 'xxxxxxxxxxxx';
inPlace := 'Device.Application.Main';
pastEnd := 'xx';
cut := 'xx';
posZero := 'xx';
posPast := 'xx';
noLength := 'xx';
StrMidA(pst := ADR(text), uiInputBufferSize := 21, iLength := 3, iPosition := 2, pstResult := ADR(middle), uiResultBufferSize := 21);
StrMidA(pst := ADR(inPlace), uiInputBufferSize := 41, iLength := 4, iPosition := 20, pstResult := ADR(inPlace), uiResultBufferSize := 41);
StrMidA(pst := ADR(text), uiInputBufferSize := 21, iLength := 10, iPosition := 6, pstResult := ADR(pastEnd), uiResultBufferSize := 21);
StrMidA(pst := ADR(text), uiInputBufferSize := 21, iLength := 5, iPosition := 1, pstResult := ADR(cut), uiResultBufferSize := 3);
StrMidA(pst := ADR(text), uiInputBufferSize := 21, iLength := 3, iPosition := 0, pstResult := ADR(posZero), uiResultBufferSize := 21);
StrMidA(pst := ADR(text), uiInputBufferSize := 21, iLength := 3, iPosition := 12, pstResult := ADR(posPast), uiResultBufferSize := 21);
StrMidA(pst := ADR(text), uiInputBufferSize := 21, iLength := 0, iPosition := 2, pstResult := ADR(noLength), uiResultBufferSize := 21);
END_FUNCTION_BLOCK
`),
  fb("lib_stu_replace", "StrReplaceA in place: same length, growing, shrinking, iLengthInput not the length, a cut buffer, a short iLengthToReplaceWith, a position past the end",
    `FUNCTION_BLOCK FB_LANG_LIB_replace
VAR
\trepl : STRING(10);
\tsame : STRING(20);
\tgrow : STRING(20);
\tshrink : STRING(20);
\tlengthInput : STRING(20);
\tcut : STRING(20);
\tshortWith : STRING(20);
\tpastEnd : STRING(20);
\tatEnd : STRING(20);
END_VAR
repl := 'XYZ';
same := 'Device.App';
grow := 'abc';
shrink := 'abcdef';
lengthInput := 'abcdef';
cut := 'abcdef';
shortWith := 'abcdef';
pastEnd := 'abc';
atEnd := 'abc';
StrReplaceA(pstInput := ADR(same), uiInputBufferSize := 21, pstReplaceWith := ADR(repl), iLengthInput := 10, iLengthToReplace := 1, iLengthToReplaceWith := 1, iPosition := 7);
StrReplaceA(pstInput := ADR(grow), uiInputBufferSize := 21, pstReplaceWith := ADR(repl), iLengthInput := 3, iLengthToReplace := 1, iLengthToReplaceWith := 3, iPosition := 2);
StrReplaceA(pstInput := ADR(shrink), uiInputBufferSize := 21, pstReplaceWith := ADR(repl), iLengthInput := 6, iLengthToReplace := 3, iLengthToReplaceWith := 1, iPosition := 2);
StrReplaceA(pstInput := ADR(lengthInput), uiInputBufferSize := 21, pstReplaceWith := ADR(repl), iLengthInput := 1, iLengthToReplace := 1, iLengthToReplaceWith := 1, iPosition := 4);
StrReplaceA(pstInput := ADR(cut), uiInputBufferSize := 7, pstReplaceWith := ADR(repl), iLengthInput := 6, iLengthToReplace := 1, iLengthToReplaceWith := 3, iPosition := 2);
StrReplaceA(pstInput := ADR(shortWith), uiInputBufferSize := 21, pstReplaceWith := ADR(repl), iLengthInput := 6, iLengthToReplace := 2, iLengthToReplaceWith := 2, iPosition := 1);
StrReplaceA(pstInput := ADR(pastEnd), uiInputBufferSize := 21, pstReplaceWith := ADR(repl), iLengthInput := 3, iLengthToReplace := 1, iLengthToReplaceWith := 1, iPosition := 6);
StrReplaceA(pstInput := ADR(atEnd), uiInputBufferSize := 21, pstReplaceWith := ADR(repl), iLengthInput := 3, iLengthToReplace := 0, iLengthToReplaceWith := 3, iPosition := 4);
END_FUNCTION_BLOCK
`),
  // transpile-restructure 3.11: StrReplaceA where ILENGTHINPUT (12) reaches PAST the string's length (3) into the bytes a
  // shorter store left behind its terminator — each STRING(20) is assigned 'abcdefghijkl' and then 'abc', so it holds
  // 'abc' + 0 + 'efghijkl' + 0. Replaced growing inside the string (position 2), growing at a position behind its
  // terminator (6) and shrinking inside it; every buffer is dumped [0..20] through `[i]`, so what the in-place move does
  // to the bytes behind the terminator is read, not only the string up to its first 0. RECORDED (CODESYS 3.5.21.40, 2026-10-08): the move
  // and the copy run over the whole buffer in place — inside 97 88 89 90 99 0 101…108 0, behind 97 98 99 0 101 88 89 90
  // 103…108 0 (the copy lands behind the terminator), shrink 97 88 89 90 103…108 0 108 0 ('aXYZghijkl').
  fb("lib_stu_replace_past_len", "StrReplaceA with iLengthInput past the string's length, over bytes a shorter store left behind its terminator",
    `FUNCTION_BLOCK FB_LANG_LIB_replace_past_len
VAR
\ti : INT;
\trepl : STRING(10);
\tinside : STRING(20);
\tbehind : STRING(20);
\tshrink : STRING(20);
\tinsideLo : ARRAY[0..15] OF BYTE;
\tinsideHi : ARRAY[16..20] OF BYTE;
\tbehindLo : ARRAY[0..15] OF BYTE;
\tbehindHi : ARRAY[16..20] OF BYTE;
\tshrinkLo : ARRAY[0..15] OF BYTE;
\tshrinkHi : ARRAY[16..20] OF BYTE;
END_VAR
repl := 'XYZ';
inside := 'abcdefghijkl';
inside := 'abc';
behind := 'abcdefghijkl';
behind := 'abc';
shrink := 'abcdefghijkl';
shrink := 'abc';
StrReplaceA(pstInput := ADR(inside), uiInputBufferSize := 21, pstReplaceWith := ADR(repl), iLengthInput := 12, iLengthToReplace := 1, iLengthToReplaceWith := 3, iPosition := 2);
StrReplaceA(pstInput := ADR(behind), uiInputBufferSize := 21, pstReplaceWith := ADR(repl), iLengthInput := 12, iLengthToReplace := 1, iLengthToReplaceWith := 3, iPosition := 6);
StrReplaceA(pstInput := ADR(shrink), uiInputBufferSize := 21, pstReplaceWith := ADR(repl), iLengthInput := 12, iLengthToReplace := 3, iLengthToReplaceWith := 1, iPosition := 2);
FOR i := 0 TO 15 DO
\tinsideLo[i] := inside[i];
\tbehindLo[i] := behind[i];
\tshrinkLo[i] := shrink[i];
END_FOR
FOR i := 16 TO 20 DO
\tinsideHi[i] := inside[i];
\tbehindHi[i] := behind[i];
\tshrinkHi[i] := shrink[i];
END_FOR
END_FUNCTION_BLOCK
`),
]
