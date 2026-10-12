/**
 * the fixtures of `string-edges.ts` — part E.
 *
 * One slice of `string-edges.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { whole } from "./string-edges-shared.js"

export const STRING_MODEL_TESTS_E: readonly LanguageTest[] = [
  // Owner fixtures (2026-10-11, transpile-restructure 7.4.6): a VAR_INPUT is NOT read-only — CODESYS lets a POU write its
  // own input, and the write must never reach the caller. (The input is `inp`: `s` is an IL operator CODESYS refuses as a
  // name, see the head of this file.) 7.4.6 lends a Standard string FUNCTION's STRING input as
  // `&IecStr<N>`; these pin that a user POU's input stays a COPY. Each cell discriminates: a leaked write would change the
  // caller's `txt` (and so the second call's answer), an aliased borrow would read the caller's capacity or its units.
  { ...whole("input_written_function_string", "a user FUNCTION writing its own STRING VAR_INPUT (inp := CONCAT(inp, 'x'); F := LEN(inp)), by a caller variable passed twice, positionally, and through another FUNCTION's VAR_IN_OUT: the caller's variable unchanged, the result the written copy (owner, transpile-restructure 7.4.6)",
    `FUNCTION F_InWrStrLen : INT
VAR_INPUT
\tinp : STRING(20);
END_VAR
inp := CONCAT(inp, 'x');
F_InWrStrLen := LEN(inp);
END_FUNCTION

FUNCTION F_InWrStrBack : STRING(20)
VAR_INPUT
\tinp : STRING(20);
END_VAR
inp := CONCAT(inp, 'yz');
inp[0] := 90;
F_InWrStrBack := inp;
END_FUNCTION

FUNCTION F_InWrStrGrow : BOOL
VAR_IN_OUT
\tio : STRING(20);
END_VAR
io := CONCAT(io, 'Q');
F_InWrStrGrow := TRUE;
END_FUNCTION

FUNCTION F_InWrStrViaInout : STRING(20)
VAR_INPUT
\tinp : STRING(20);
END_VAR
VAR
\tok : BOOL;
END_VAR
ok := F_InWrStrGrow(io := inp);
ok := F_InWrStrGrow(io := inp);
F_InWrStrViaInout := inp;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_input_written_function_string
VAR
\ttxt : STRING(20);
\tfirst : INT;
\tsecond : INT;
\tpositional : INT;
\tafterLen : STRING(20);
\tback : STRING(20);
\tafterBack : STRING(20);
\tviaInout : STRING(20);
\tafterInout : STRING(20);
END_VAR
txt := 'abc';
first := F_InWrStrLen(inp := txt);
second := F_InWrStrLen(inp := txt);
positional := F_InWrStrLen(txt);
afterLen := txt;
back := F_InWrStrBack(inp := txt);
afterBack := txt;
viaInout := F_InWrStrViaInout(inp := txt);
afterInout := txt;
END_FUNCTION_BLOCK
`), pouName: "FB_LANG_input_written_function_string", plcPrgVar: "inst : FB_LANG_input_written_function_string;" },
  // The same for a FUNCTION_BLOCK: its input is written in the body, the caller's variable stays, and the INSTANCE keeps
  // its written input until a call assigns it again — asked within a scan (a call with no `inp :=`) and across scans (scan 2
  // starts with a call that does not assign it). Each call appends 'x' to what the instance holds, so a call that read
  // the caller's 'ab' instead of its own input would answer 'abx' where a kept input answers 'abxx' / 'abxxx'.
  { ...whole("input_written_fb_string", "a user FUNCTION_BLOCK writing its own STRING VAR_INPUT (inp := CONCAT(inp, 'x')): the caller's variable unchanged, and the instance keeps its written input across a call and a scan that do not assign it (owner, transpile-restructure 7.4.6)",
    `FUNCTION_BLOCK FB_InWrStrCallee
VAR_INPUT
\tinp : STRING(20);
END_VAR
VAR_OUTPUT
\tn : INT;
\tseen : STRING(20);
END_VAR
inp := CONCAT(inp, 'x');
n := LEN(inp);
seen := inp;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_input_written_fb_string
VAR
\tcallee : FB_InWrStrCallee;
\tscan : INT;
\ttxt : STRING(20);
\tassigned1 : STRING(20);
\tkept1 : STRING(20);
\tkeptAcrossScan : STRING(20);
\tassigned2 : STRING(20);
\tkept2 : STRING(20);
\tn1 : INT;
\tn2 : INT;
\tn3 : INT;
\tn4 : INT;
\tn5 : INT;
\ttxtAfter : STRING(20);
END_VAR
scan := scan + 1;
IF scan = 1 THEN
\ttxt := 'ab';
\tcallee(inp := txt);
\tassigned1 := callee.seen;
\tn1 := callee.n;
\tcallee();
\tkept1 := callee.seen;
\tn2 := callee.n;
ELSE
\tcallee();
\tkeptAcrossScan := callee.seen;
\tn3 := callee.n;
\tcallee(inp := txt);
\tassigned2 := callee.seen;
\tn4 := callee.n;
\tcallee();
\tkept2 := callee.seen;
\tn5 := callee.n;
END_IF
txtAfter := txt;
END_FUNCTION_BLOCK
`), pouName: "FB_LANG_input_written_fb_string", plcPrgVar: "inst : FB_LANG_input_written_fb_string;", cycles: 2 },
  // A user FUNCTION writes its own STRING input and then hands it to Standard LEN / LEFT / MID / CONCAT / FIND: the 7.4.6
  // borrow must lend the WRITTEN copy at the input's own capacity (20), never the caller's variable — here a STRING(5)
  // full to its capacity, so an alias would read 'abcde' (LEN 5) where the copy holds 'abcdeXYZ' (LEN 8). The third
  // function writes one unit (inp[1] := 0) and asks again: the copy is 'a' (LEN 1), the caller still 'abcde'.
  { ...whole("input_written_function_string_to_standard", "a user FUNCTION writing its own STRING VAR_INPUT then passing it to Standard LEN/LEFT/MID/CONCAT/FIND: the borrow lends the written copy, never the caller's (narrower) variable (owner, transpile-restructure 7.4.6)",
    `FUNCTION F_InWrStdText : STRING(80)
VAR_INPUT
\tinp : STRING(20);
END_VAR
inp := CONCAT(inp, 'XYZ');
F_InWrStdText := CONCAT(CONCAT(LEFT(inp, 7), '|'), CONCAT(MID(inp, 5, 3), CONCAT('|', CONCAT(inp, '!'))));
END_FUNCTION

FUNCTION F_InWrStdNum : INT
VAR_INPUT
\tinp : STRING(20);
END_VAR
inp := CONCAT(inp, 'XYZ');
F_InWrStdNum := LEN(inp) * 100 + FIND(inp, 'YZ');
END_FUNCTION

FUNCTION F_InWrStdCut : INT
VAR_INPUT
\tinp : STRING(20);
END_VAR
inp[1] := 0;
F_InWrStdCut := LEN(inp) * 100 + LEN(CONCAT(inp, inp));
END_FUNCTION

FUNCTION_BLOCK FB_LANG_input_written_function_string_to_standard
VAR
\ttxt : STRING(5);
\ttext : STRING(80);
\tnum : INT;
\tcut : INT;
\tcallerLen : INT;
\ttxtAfter : STRING(5);
END_VAR
txt := 'abcde';
text := F_InWrStdText(inp := txt);
num := F_InWrStdNum(inp := txt);
cut := F_InWrStdCut(inp := txt);
callerLen := LEN(txt);
txtAfter := txt;
END_FUNCTION_BLOCK
`), pouName: "FB_LANG_input_written_function_string_to_standard", plcPrgVar: "inst : FB_LANG_input_written_function_string_to_standard;" },
]
