/**
 * the fixtures of `cross-object-four.ts` — part B: REAL arithmetic that must stay float32, computed across objects; a VAR_IN_OUT CONSTANT from a METHOD into another object's FUNCTION.
 *
 * One slice of `cross-object-four.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { fb } from "./cross-object-four-shared.js"

export const CROSS_OBJECT_FOUR_TESTS_B: readonly LanguageTest[] = [
  // ─── REAL arithmetic that must stay float32, computed across objects ───────
  fb("xo4_real_precision_across_objects", "FB_X4_maths", "a REAL computed by a FUNCTION in another object and compared against an LREAL doing the same sum",
    `FUNCTION F_X4_third : REAL
VAR_INPUT
	value : REAL;
END_VAR
F_X4_third := value / 3.0;
END_FUNCTION

FUNCTION F_X4_thirdWide : LREAL
VAR_INPUT
	value : LREAL;
END_VAR
F_X4_thirdWide := value / 3.0;
END_FUNCTION

FUNCTION_BLOCK FB_X4_maths
VAR
	narrow : REAL;
	wide : LREAL;
	widened : LREAL;
	same : BOOL;
	rounded : DINT;
	truncated : DINT;
END_VAR
narrow := F_X4_third(value := 1.0);
wide := F_X4_thirdWide(value := 1.0);
widened := narrow;
same := widened = wide;
rounded := REAL_TO_DINT(narrow * 10.0);
truncated := TRUNC(narrow * 10.0);
END_FUNCTION_BLOCK
`,
    "inst : FB_X4_maths;", "inst();"),
  // ─── a VAR_IN_OUT CONSTANT from a METHOD into another object's FUNCTION ────
  fb("xo4_inout_constant_chain", "FB_X4_reporter", "a VAR_IN_OUT CONSTANT STRING handed from a METHOD to a FUNCTION in another object, which only reads it",
    `FUNCTION F_X4_width : INT
VAR_IN_OUT CONSTANT
	text : STRING;
END_VAR
F_X4_width := LEN(text);
END_FUNCTION

FUNCTION_BLOCK FB_X4_reporter
VAR
	title : STRING(12) := 'hello world';
	measured : INT;
	literalWidth : INT;
END_VAR
measured := Measure();
literalWidth := F_X4_width(text := 'abc');
END_FUNCTION_BLOCK

METHOD Measure : INT
Measure := F_X4_width(text := title);
END_METHOD
`,
    "inst : FB_X4_reporter;", "inst();"),
]
