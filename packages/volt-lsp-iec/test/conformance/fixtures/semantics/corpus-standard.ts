/**
 * What real projects call that no fixture had ever called — found by `scripts/corpus-census.ts`, which diffs every
 * construct in the four corpus projects against every construct in this catalog.
 *
 * The census is the discipline here: each of these is in the corpus by the dozen or the hundred and was at zero
 * fixtures, so nothing held the LSP's answer about it to a build. A fixture that merely COMPILES is the point —
 * these exist to catch the LSP inventing a diagnostic about ordinary code, which is the failure mode a catalog
 * grown from error cases is blind to.
 *
 * Deliberately NOT here, though the census lists them: `CONCAT3`…`CONCAT9`, `TEST_AND_SET`, `BITADR`,
 * `DWORD_TO_HEXSTRING`. None appears in any project's SOURCE — they are names the census picked up from library
 * signatures, so a fixture would be measuring a declaration nobody calls.
 */
import type { LanguageTest } from "../../types.js"

const doc = "conformance — constructs the corpus uses and the fixtures did not"

function fb(name: string, pouName: string, feature: string, source: string, note?: string): LanguageTest {
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    ...(note === undefined ? {} : { note }),
    source,
    plcPrgVar: `inst : ${pouName};`,
    plcPrgBody: "inst();",
  }
}

export const CORPUS_STANDARD_TESTS: readonly LanguageTest[] = [
  fb("cs_anynum_to_conversions", "FB_CS_anynum", "the ANYNUM_TO_* family over an ENUM member — the corpus's commonest conversion, at 80 uses and no fixture",
    `TYPE DUT_CS_kernelError :
(
\tNO_ERROR := 0,
\tGUARDING_ERROR := 16#8130,
\tDATA_OVERFLOW := 16#8210
) UINT;
END_TYPE

FUNCTION_BLOCK FB_CS_anynum
VAR
\tasWord : WORD;
\tasInt : INT;
\tasDword : DWORD;
END_VAR
asWord := ANYNUM_TO_WORD(DUT_CS_kernelError.GUARDING_ERROR);
asInt := ANYNUM_TO_INT(DUT_CS_kernelError.NO_ERROR);
asDword := ANY_TO_DWORD(DUT_CS_kernelError.DATA_OVERFLOW);
END_FUNCTION_BLOCK
`,
    "The corpus form exactly: `ANYNUM_TO_WORD(CS.CANOPEN_KERNEL_ERROR.…)`, a generic conversion applied to an enum MEMBER. `co_any_to_conversions` covers ANY_TO_*; ANYNUM_TO_* is a different family and was at zero."),

  fb("cs_array_four_dimensions", "FB_CS_array4", "a FOUR-dimensional array, declared and indexed — the fixtures stopped at three",
    `FUNCTION_BLOCK FB_CS_array4
VAR
\tgrid : ARRAY[1..2, 1..2, 1..2, 1..2] OF INT;
\ttaken : INT;
END_VAR
grid[1, 2, 1, 2] := 7;
taken := grid[1, 2, 1, 2];
END_FUNCTION_BLOCK
`,
    "One corpus project declares a 4-d array. Rank is not cosmetic: the index-count check reads it, and so does lowering."),

  fb("cs_standard_string_functions", "FB_CS_strings", "the Standard library's string functions — INSERT, DELETE, REPLACE, FIND, MID, LEFT, RIGHT",
    `FUNCTION_BLOCK FB_CS_strings
VAR
\tbase : STRING(40) := 'Hello world';
\tbuilt : STRING(40);
\tcut : STRING(40);
\tswapped : STRING(40);
\tpart : STRING(40);
\thead : STRING(40);
\ttail : STRING(40);
\twhere : INT;
END_VAR
built := INSERT(base, 'brave ', 6);
cut := DELETE(base, 6, 6);
swapped := REPLACE(base, 'there', 5, 7);
where := FIND(base, 'world');
part := MID(base, 5, 7);
head := LEFT(base, 5);
tail := RIGHT(base, 5);
END_FUNCTION_BLOCK
`,
    "All seven are in the materialized Standard library the replay binds against, and only LEN had a fixture. INSERT/DELETE/REPLACE/FIND take INT positions, which is where an argument-type check would go wrong unnoticed."),

  fb("cs_clock_reads", "FB_CS_clock", "TIME() and LTIME() — a type NAME that is also a nullary function",
    `FUNCTION_BLOCK FB_CS_clock
VAR
\tsince : TIME;
\tsinceLong : LTIME;
END_VAR
since := TIME();
sinceLong := LTIME();
END_FUNCTION_BLOCK
`,
    "The corpus reads the clock this way (pro2193's StopwatchFB). It is the shape that made `refused-name` exempt a call's CALLEE: an elementary type name in callee position is a legitimate function, not a name the parser refuses."),

  fb("cs_spelled_narrowing_conversions", "FB_CS_spelled", "the spelled X_TO_Y conversions the corpus uses, including ones that NARROW",
    `FUNCTION_BLOCK FB_CS_spelled
VAR
\twide : UDINT := 70000;
\tnarrow : UINT;
\tsmall : SINT := -5;
\tunsignedWide : UDINT;
\tcount : DINT := 12;
\tasReal : REAL;
\ttiny : USINT := 200;
\tasWord : WORD;
END_VAR
narrow := UDINT_TO_UINT(wide);
unsignedWide := SINT_TO_UDINT(small);
asReal := DINT_TO_REAL(count);
asWord := USINT_TO_WORD(tiny);
END_FUNCTION_BLOCK
`,
    "An EXPLICIT conversion is the engineer saying they meant it, so a narrowing one should be silent where the same implicit store would warn. Nothing pinned that: `cc_conv_spelled_*` covers only the TOD/UDINT pair, which exists to record that CODESYS refuses the long spelling."),
]
