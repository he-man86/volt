/**
 * Aggregate initializers — the oracle for the transpiler's `aggregate-init` blocker (147 corpus POUs), recorded BEFORE it
 * is built. No conformance fixture held one. The array forms are an execution case (`array_initializers`); these need
 * units of their own: a struct initialized by field name (and a field left out — its TYPE's own initial value, or 0?),
 * a nested struct, an array of structs, an FB instance initialized through its inputs, and the `STRUCT(…)` spelling the
 * corpus uses.
 */
import type { LanguageTest } from "../../types.js"

const doc = "transpile-st-to-rust phase 3½ — aggregate initializers"

const TYPES = `TYPE DUT_INIT_point :
STRUCT
	x : INT := 5;
	y : REAL;
	tag : STRING(8) := 'p';
END_STRUCT
END_TYPE

TYPE DUT_INIT_line :
STRUCT
	startPoint : DUT_INIT_point;
	endPoint : DUT_INIT_point;
	width : INT;
END_STRUCT
END_TYPE
`

export const INITIALIZER_TESTS: readonly LanguageTest[] = [
  {
    name: "init_struct_by_field",
    pouName: "DUT_INIT_point",
    kind: "dut",
    feature: "a struct initialized by field name — and a field left out keeps its TYPE's initial value, or starts at 0",
    fromDoc: doc,
    source: TYPES,
    plcPrgVar:
      "full : DUT_INIT_point := (x := 1, y := 2.5, tag := 'full'); partial : DUT_INIT_point := (y := 7); nested : DUT_INIT_line := (startPoint := (x := 10), width := 3); keyword : DUT_INIT_point := STRUCT(x := 20, y := 1.5);",
    plcPrgBody: "full.x := full.x + 0;",
  },
  {
    name: "init_array_of_structs",
    pouName: "DUT_INIT_pair",
    kind: "dut",
    feature: "an array of structs initialized element by element, one element left out",
    fromDoc: doc,
    source: `TYPE DUT_INIT_pair :
STRUCT
	a : INT;
	b : BOOL := TRUE;
END_STRUCT
END_TYPE
`,
    plcPrgVar: "pairs : ARRAY[0..2] OF DUT_INIT_pair := [(a := 1), (a := 2, b := FALSE)];",
    plcPrgBody: "pairs[0].a := pairs[0].a + 0;",
  },
  {
    name: "init_fb_instance_inputs",
    pouName: "FB_INIT_scaled",
    kind: "function_block",
    feature: "an FB instance initialized through its inputs, then called",
    fromDoc: doc,
    source: `FUNCTION_BLOCK FB_INIT_scaled
VAR_INPUT
	factor : INT := 2;
	offset : INT;
END_VAR
VAR_OUTPUT
	result : INT;
END_VAR
result := factor * 10 + offset;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "scaled : FB_INIT_scaled := (offset := 7); plain : FB_INIT_scaled;",
    plcPrgBody: "scaled(); plain();",
  },
]
