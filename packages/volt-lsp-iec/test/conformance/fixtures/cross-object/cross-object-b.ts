/**
 * the fixtures of `cross-object.ts` — part B: a STRING built across objects.
 *
 * One slice of `cross-object.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { fb } from "./cross-object-shared.js"

export const CROSS_OBJECT_TESTS_B: readonly LanguageTest[] = [
  // ─── a STRING built across objects ──────────────────────────────────────────
  fb("xo_string_built_across_objects", "FB_XO_labeller", "a STRING built by a FUNCTION in its own object from a struct field, then measured by its caller",
    `TYPE DUT_XO_name :
STRUCT
	first : STRING(8);
	last : STRING(8);
END_STRUCT
END_TYPE

FUNCTION F_XO_join : STRING(20)
VAR_IN_OUT
	who : DUT_XO_name;
END_VAR
F_XO_join := CONCAT(CONCAT(who.first, ' '), who.last);
END_FUNCTION

FUNCTION_BLOCK FB_XO_labeller
VAR
	person : DUT_XO_name := (first := 'Ada', last := 'Lovelace');
	label : STRING(20);
	width : INT;
	initial : STRING(1);
END_VAR
label := F_XO_join(who := person);
width := LEN(label);
initial := LEFT(label, 1);
END_FUNCTION_BLOCK
`,
    "inst : FB_XO_labeller;", "inst();"),
]
