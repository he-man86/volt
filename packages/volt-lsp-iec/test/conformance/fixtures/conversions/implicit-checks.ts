/**
 * Implicit check functions — POUs a project may define that CODESYS then calls itself: `CheckBounds` on array indexing,
 * `CheckDiv…` on division. bakon-nano and pro2193 both define `CheckBounds`, `CheckDivDInt`, `CheckDivLInt`,
 * `CheckDivReal` and `CheckDivLReal`, as CODESYS's own suggestion: clamp the index, divide by 1 instead of 0. The
 * transpiler knew none of it — a REAL division by zero gave infinity where the project's check gives a finite value.
 * Asked before anything is built: which operations call which function, with what, and whether its result is used.
 * Each question in its own project, so one run-time exception cannot hide another answer.
 *
 * Recorded (CODESYS SP21), and it answered a different question: a FUNCTION named `CheckBounds` or `CheckDivDInt` that
 * the fixture loader adds as a plain POU is NOT an implicit check — CODESYS never called one (0 calls). An out-of-range
 * write then landed in the next variable, `10 MOD 0` was 0, and DINT and REAL division by zero stopped the application.
 * An implicit check is CODESYS's own object kind ("POU for implicit checks"), which the loader cannot create — so what a
 * real one does is still unrecorded, and whether the bridge keeps that kind for the corpus's check POUs is open. The
 * bounds case keeps its indices in range: an out-of-range write is undefined behaviour the transpiler refuses to model.
 */
import type { LanguageTest } from "../../types.js"

const doc = "transpile-st-to-rust — implicit check functions"

function gvl(name: string, pouName: string, feature: string, source: string, plcPrgVar: string, plcPrgBody: string): LanguageTest {
  return { name, pouName, kind: "gvl", feature, fromDoc: doc, source, plcPrgVar, plcPrgBody }
}

export const IMPLICIT_CHECK_TESTS: readonly LanguageTest[] = [
  // A FUNCTION named CheckBounds loaded as a plain POU: is it called for a variable index, or a constant one (calls
  // counted)? Recorded first with an out-of-range write too — it was not clamped but landed in the next variable, so
  // CheckBounds was not called at all; that write is gone here, as undefined behaviour no backend models.
  gvl("implicit_check_bounds", "GVL_IC_bounds",
    "a FUNCTION named CheckBounds added as a plain POU: whether indexing an array by a variable or a constant calls it",
    `VAR_GLOBAL
	gIcBoundsCalls : INT;
END_VAR

FUNCTION CheckBounds : DINT
VAR_INPUT
	index, lower, upper : DINT;
END_VAR
gIcBoundsCalls := gIcBoundsCalls + 1;
IF index < lower THEN
	CheckBounds := lower;
ELSIF index > upper THEN
	CheckBounds := upper;
ELSE
	CheckBounds := index;
END_IF
END_FUNCTION
`,
    "values : ARRAY[1..3] OF INT; inside : INT := 2; readConstant : INT; boundsCalls : INT;",
    "values[inside] := 4;\nreadConstant := values[1];\nboundsCalls := gIcBoundsCalls;"),
  // DINT and REAL division by zero through the project's CheckDivDInt / CheckDivReal (10 / 1 = 10 if the result is used),
  // and a division by a constant: is the check called for it (calls 2 each) or not (1)?
  gvl("implicit_check_div_dint_real", "GVL_IC_div",
    "a project's CheckDivDInt and CheckDivReal: DINT and REAL division by a zero variable and by a constant — the results, and how often each is called",
    `VAR_GLOBAL
	gIcDivDintCalls : INT;
	gIcDivRealCalls : INT;
END_VAR

FUNCTION CheckDivDInt : DINT
VAR_INPUT
	divisor : DINT;
END_VAR
gIcDivDintCalls := gIcDivDintCalls + 1;
IF divisor = 0 THEN
	CheckDivDInt := 1;
ELSE
	CheckDivDInt := divisor;
END_IF
END_FUNCTION

FUNCTION CheckDivReal : REAL
VAR_INPUT
	divisor : REAL;
END_VAR
gIcDivRealCalls := gIcDivRealCalls + 1;
IF divisor = 0 THEN
	CheckDivReal := 1;
ELSE
	CheckDivReal := divisor;
END_IF
END_FUNCTION
`,
    "zeroDint : DINT; tenDint : DINT := 10; zeroReal : REAL; tenReal : REAL := 10.0; divDint : DINT; divReal : REAL; byConstDint : DINT; byConstReal : REAL; dintCalls : INT; realCalls : INT;",
    "divDint := tenDint / zeroDint;\ndivReal := tenReal / zeroReal;\nbyConstDint := tenDint / 2;\nbyConstReal := tenReal / 4.0;\ndintCalls := gIcDivDintCalls;\nrealCalls := gIcDivRealCalls;"),
  // INT operands divided by zero, with only CheckDivDInt defined (pro2193's set has no CheckDivInt): does the DINT check
  // cover it (10, 1 call), or does the run stop?
  gvl("implicit_check_div_int_operands", "GVL_IC_divint",
    "INT operands divided by a zero variable when the project defines CheckDivDInt but no CheckDivInt",
    `VAR_GLOBAL
	gIcDivIntCalls : INT;
END_VAR

FUNCTION CheckDivDInt : DINT
VAR_INPUT
	divisor : DINT;
END_VAR
gIcDivIntCalls := gIcDivIntCalls + 1;
IF divisor = 0 THEN
	CheckDivDInt := 1;
ELSE
	CheckDivDInt := divisor;
END_IF
END_FUNCTION
`,
    "zeroInt : INT; tenInt : INT := 10; divInt : INT; intCalls : INT;",
    "divInt := tenInt / zeroInt;\nintCalls := gIcDivIntCalls;"),
  // MOD by a zero variable: does CheckDivDInt cover MOD (10 MOD 1 = 0, 1 call), or does the run stop?
  gvl("implicit_check_mod", "GVL_IC_mod",
    "DINT MOD by a zero variable when the project defines CheckDivDInt",
    `VAR_GLOBAL
	gIcModCalls : INT;
END_VAR

FUNCTION CheckDivDInt : DINT
VAR_INPUT
	divisor : DINT;
END_VAR
gIcModCalls := gIcModCalls + 1;
IF divisor = 0 THEN
	CheckDivDInt := 1;
ELSE
	CheckDivDInt := divisor;
END_IF
END_FUNCTION
`,
    "zeroDint : DINT; tenDint : DINT := 10; modDint : DINT; modCalls : INT;",
    "modDint := tenDint MOD zeroDint;\nmodCalls := gIcModCalls;"),
]
