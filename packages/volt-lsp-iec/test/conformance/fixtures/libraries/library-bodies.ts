/**
 * THE LIBRARY REPO'S BODIES, ASKED OF CODESYS — `libraries/<library>/<version>/`, run against the real libraries.
 *
 * The repo writes each library element in ST (plc-library-runtime design §6). Standard's string functions were already
 * held to the vendor by the `str_*` recordings; everything else was a reading of the element's contract, pinned only
 * by `test/libraries/*` — what the body was MEANT to do. These ask CODESYS what it DOES, above all where the contract
 * leaves a choice the body had to make: a counter at the end of its WORD, a compare's value beyond its sign, what a
 * buffer too small to concatenate into is left holding.
 *
 * The fixture project references Standard 3.5.18.0, Util 3.5.19.0 and StringUtils 3.5.18.0 — the versions the repo
 * writes — so the replay lowers each call against the body for the version CODESYS resolved.
 *
 * TIMERS RUN ON A RECORDED CLOCK (`LanguageTest.clock`): each clocked fixture stores `TIME()` into `now[n]` on every
 * scan, beside the timer's outputs, and the replay sets the transpiler's clock to those instants — so a TON's `Q` and
 * `ET` must match CODESYS exactly although the simulator's clock is real time.
 */
import type { LanguageTest } from "../../types.js"

const doc = "libraries — the library repo's bodies (plc-library-runtime design §6)"

/** One FB fixture, instantiated as `inst` in PLC_PRG and called once a scan. */
function fb(name: string, feature: string, source: string, extra: Partial<LanguageTest> = {}): LanguageTest {
  const pouName = /FUNCTION_BLOCK (\w+)/.exec(source)![1]!
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar: `inst : ${pouName};`, plcPrgBody: "inst();", ...extra }
}

/** A clocked fixture over `cycles` scans: `now` records the clock every scan, and the replay runs on it. */
const clocked = (cycles: number): Partial<LanguageTest> => ({ cycles, clock: "inst.now" })

export const LIBRARY_BODY_TESTS: readonly LanguageTest[] = [
  // ── Standard: the clock-free blocks ────────────────────────────────────────────────────────────────────────
  fb("lib_std_edges", "R_TRIG and F_TRIG over a signal high on scans 2, 4 and 5 — how many edges, on which scans",
    `FUNCTION_BLOCK FB_LANG_LIB_edges
VAR
\tn : INT;
\tsig : BOOL;
\trise : R_TRIG;
\tfall : F_TRIG;
\trises : INT;
\tfalls : INT;
\tlastRise : INT;
\tlastFall : INT;
END_VAR
n := n + 1;
sig := n = 2 OR n = 4 OR n = 5;
rise(CLK := sig);
fall(CLK := sig);
IF rise.Q THEN rises := rises + 1; lastRise := n; END_IF
IF fall.Q THEN falls := falls + 1; lastFall := n; END_IF
END_FUNCTION_BLOCK
`, { cycles: 6 }),

  fb("lib_std_counters", "CTU, CTD and CTUD counting the rising edges of a signal, each against PV 2",
    `FUNCTION_BLOCK FB_LANG_LIB_counters
VAR
\tn : INT;
\tsig : BOOL;
\tup : CTU;
\tdown : CTD;
\tboth : CTUD;
END_VAR
n := n + 1;
sig := n = 2 OR n = 4 OR n = 5;
up(CU := sig, RESET := n = 6, PV := 2);
down(CD := sig, LOAD := n = 1, PV := 2);
both(CU := sig, CD := n = 5, RESET := FALSE, LOAD := n = 1, PV := 2);
END_FUNCTION_BLOCK
`, { cycles: 6 }),

  fb("lib_std_counter_ends", "a CTD counted below 0 and a CTUD counted past 16#FFFF — does CV stop, or wrap its WORD?",
    `FUNCTION_BLOCK FB_LANG_LIB_ends
VAR
\tn : INT;
\tdown : CTD;
\tup : CTUD;
END_VAR
n := n + 1;
down(CD := n MOD 2 = 0, LOAD := n = 1, PV := 1);
up(CU := n MOD 2 = 0, CD := FALSE, RESET := FALSE, LOAD := n = 1, PV := 16#FFFE);
END_FUNCTION_BLOCK
`, { cycles: 8 }),

  fb("lib_std_bistables", "SR and RS set, held, reset, and both inputs at once",
    `FUNCTION_BLOCK FB_LANG_LIB_bistables
VAR
\tn : INT;
\tsr1 : SR;
\trs1 : RS;
\tsrHeld : BOOL;
\trsHeld : BOOL;
END_VAR
n := n + 1;
sr1(SET1 := n = 1 OR n = 3, RESET := n >= 3);
rs1(SET := n = 1 OR n = 3, RESET1 := n >= 3);
IF n = 2 THEN srHeld := sr1.Q1; rsHeld := rs1.Q1; END_IF
END_FUNCTION_BLOCK
`, { cycles: 3 }),

  // ── Standard: the timers, on the recorded clock ─────────────────────────────────────────────────────────────
  fb("lib_std_ton", "TON: IN high on scans 2..9 against PT 30ms, then low — Q and ET every scan",
    `FUNCTION_BLOCK FB_LANG_LIB_ton
VAR
\tn : INT;
\tnow : ARRAY[1..12] OF TIME;
\tq : ARRAY[1..12] OF BOOL;
\tet : ARRAY[1..12] OF TIME;
\tt : TON;
END_VAR
n := n + 1;
now[n] := TIME();
t(IN := n >= 2 AND n <= 9, PT := T#30MS);
q[n] := t.Q;
et[n] := t.ET;
END_FUNCTION_BLOCK
`, clocked(12)),

  fb("lib_std_tof", "TOF: IN high on scans 2..3, then low — Q holds for PT 30ms after the fall",
    `FUNCTION_BLOCK FB_LANG_LIB_tof
VAR
\tn : INT;
\tnow : ARRAY[1..12] OF TIME;
\tq : ARRAY[1..12] OF BOOL;
\tet : ARRAY[1..12] OF TIME;
\tt : TOF;
END_VAR
n := n + 1;
now[n] := TIME();
t(IN := n = 2 OR n = 3, PT := T#30MS);
q[n] := t.Q;
et[n] := t.ET;
END_FUNCTION_BLOCK
`, clocked(12)),

  fb("lib_std_tp", "TP: a pulse on scan 2 that IN falling does not cut short, and a second edge on scan 10",
    `FUNCTION_BLOCK FB_LANG_LIB_tp
VAR
\tn : INT;
\tnow : ARRAY[1..12] OF TIME;
\tq : ARRAY[1..12] OF BOOL;
\tet : ARRAY[1..12] OF TIME;
\tt : TP;
END_VAR
n := n + 1;
now[n] := TIME();
t(IN := n = 2 OR n = 10 OR n = 11, PT := T#30MS);
q[n] := t.Q;
et[n] := t.ET;
END_FUNCTION_BLOCK
`, clocked(12)),

  fb("lib_std_tp_held", "TP: IN held high past the pulse's end — what ET holds while IN stays high, and when it clears",
    `FUNCTION_BLOCK FB_LANG_LIB_tp_held
VAR
\tn : INT;
\tnow : ARRAY[1..12] OF TIME;
\tq : ARRAY[1..12] OF BOOL;
\tet : ARRAY[1..12] OF TIME;
\tt : TP;
END_VAR
n := n + 1;
now[n] := TIME();
t(IN := (n >= 2 AND n <= 7) OR n = 11, PT := T#30MS);
q[n] := t.Q;
et[n] := t.ET;
END_FUNCTION_BLOCK
`, clocked(12)),

  fb("lib_std_rtc", "RTC: CDT from PDT on EN's rising edge, running with the clock",
    `FUNCTION_BLOCK FB_LANG_LIB_rtc
VAR
\tn : INT;
\tnow : ARRAY[1..8] OF TIME;
\tq : ARRAY[1..8] OF BOOL;
\tcdt : ARRAY[1..8] OF DT;
\tclk : RTC;
END_VAR
n := n + 1;
now[n] := TIME();
clk(EN := n >= 2, PDT := DT#2026-01-01-00:00:00);
q[n] := clk.Q;
cdt[n] := clk.CDT;
END_FUNCTION_BLOCK
`, clocked(8)),

  // ── Util ───────────────────────────────────────────────────────────────────────────────────────────────
  fb("lib_util_blink", "BLINK: TIMELOW 20ms, TIMEHIGH 10ms while ENABLE holds — which phase first, and OUT every scan",
    `FUNCTION_BLOCK FB_LANG_LIB_blink
VAR
\tn : INT;
\tnow : ARRAY[1..14] OF TIME;
\tout : ARRAY[1..14] OF BOOL;
\tb : BLINK;
END_VAR
n := n + 1;
now[n] := TIME();
b(ENABLE := n <= 12, TIMELOW := T#20MS, TIMEHIGH := T#10MS);
out[n] := b.OUT;
END_FUNCTION_BLOCK
`, clocked(14)),

  fb("lib_util_blink_slow", "BLINK: TIMELOW 50ms, TIMEHIGH 30ms — phases several scans long, so each phase's LENGTH shows",
    `FUNCTION_BLOCK FB_LANG_LIB_blink_slow
VAR
\tn : INT;
\tnow : ARRAY[1..14] OF TIME;
\tout : ARRAY[1..14] OF BOOL;
\tb : BLINK;
END_VAR
n := n + 1;
now[n] := TIME();
b(ENABLE := n <= 12, TIMELOW := T#50MS, TIMEHIGH := T#30MS);
out[n] := b.OUT;
END_FUNCTION_BLOCK
`, clocked(14)),

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

  // ── the primitives the repo's bodies are written in ─────────────────────────────────────────────────────────
  fb("lib_prim_char_past_length", "s[i] past the length but inside the variable: a read, a store, and the terminator idiom buf[SIZEOF(buf) - 1] := 0",
    `FUNCTION_BLOCK FB_LANG_LIB_char_past
VAR
\tbuf : STRING(10);
\treadPast : BYTE;
\tlenAfterTerminator : INT;
\tlenAfterStore : INT;
\tatCapacity : BYTE;
END_VAR
buf := 'ab';
readPast := buf[4];
buf[10] := 0;
lenAfterTerminator := LEN(buf);
buf[6] := 88;
lenAfterStore := LEN(buf);
atCapacity := buf[10];
END_FUNCTION_BLOCK
`),

  fb("lib_prim_string_cursor_offset", "a POINTER TO STRING handed a byte pointer that stepped: p^[0] is the character it stands on",
    `FUNCTION F_LANG_LIB_first : BYTE
VAR_INPUT
\tp : POINTER TO STRING;
END_VAR
F_LANG_LIB_first := p^[0];
END_FUNCTION
FUNCTION F_LANG_LIB_first_after_step : BYTE
VAR_INPUT
\tq : POINTER TO BYTE;
END_VAR
q := q + 1;
F_LANG_LIB_first_after_step := F_LANG_LIB_first(q);
END_FUNCTION
FUNCTION_BLOCK FB_LANG_LIB_cursor_offset
VAR
\ttext : STRING := 'abc';
\tatStart : BYTE;
\tafterStep : BYTE;
END_VAR
atStart := F_LANG_LIB_first(ADR(text));
afterStep := F_LANG_LIB_first_after_step(ADR(text));
END_FUNCTION_BLOCK
`),

  fb("lib_prim_null_cursor", "a pointer variable handed to a byte pointer: set, then null — the callee's own IF p = 0 answers",
    `FUNCTION F_LANG_LIB_len_or : DINT
VAR_INPUT
\tp : POINTER TO BYTE;
END_VAR
IF p = 0 THEN
\tF_LANG_LIB_len_or := -1;
\tRETURN;
END_IF
WHILE p^ <> 0 DO
\tF_LANG_LIB_len_or := F_LANG_LIB_len_or + 1;
\tp := p + 1;
END_WHILE
END_FUNCTION
FUNCTION_BLOCK FB_LANG_LIB_null_cursor
VAR
\ttext : STRING := 'abc';
\tps : POINTER TO STRING;
\tsetLength : DINT;
\tnullLength : DINT;
END_VAR
ps := ADR(text);
setLength := F_LANG_LIB_len_or(ps);
ps := 0;
nullLength := F_LANG_LIB_len_or(ps);
END_FUNCTION_BLOCK
`),
]
