/**
 * the fixtures of `cross-object-three.ts` — part B: a struct initialized field by field, used as an input default.
 *
 * One slice of `cross-object-three.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { fb } from "./cross-object-three-shared.js"

export const CROSS_OBJECT_THREE_TESTS_B: readonly LanguageTest[] = [
  // ─── a struct initialized field by field, used as an input default ─────────
  fb("xo3_struct_default_as_input", "FB_X3_defaults", "a STRUCT with per-field initial values from another object, used as an FB's VAR_INPUT default and overridden at one call",
    `TYPE DUT_X3_config :
STRUCT
	speed : INT := 30;
	retries : INT := 2;
	tag : STRING(4) := 'cfg';
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_X3_worker
VAR_INPUT
	setup : DUT_X3_config;
END_VAR
VAR_OUTPUT
	effort : INT;
END_VAR
effort := setup.speed * setup.retries;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_X3_defaults
VAR
	plain : FB_X3_worker;
	tuned : FB_X3_worker;
	custom : DUT_X3_config := (speed := 4);
	fromDefault : INT;
	fromCustom : INT;
END_VAR
plain(effort => fromDefault);
tuned(setup := custom, effort => fromCustom);
END_FUNCTION_BLOCK
`,
    "inst : FB_X3_defaults;", "inst();"),
]
