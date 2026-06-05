/**
 * Smallest realistic project: a function block, a GVL, and a struct.
 * Used for "happy path" scenarios that just need source items to pull
 * and push without dragging in config-kind complexity.
 */
import type { ProjectFixture } from "../../harness/make-test-env.js";

export const simple: ProjectFixture = {
	items: [
		{
			name: "FB_Motor",
			kind: "function_block",
			folder: "POUs",
			language: "ST",
			sourceText:
				"FUNCTION_BLOCK FB_Motor\n" +
				"VAR_INPUT\n" +
				"\trun: BOOL;\n" +
				"END_VAR\n" +
				"VAR_OUTPUT\n" +
				"\trunning: BOOL;\n" +
				"END_VAR\n" +
				"\n" +
				"running := run;\n" +
				"\n" +
				"END_FUNCTION_BLOCK\n",
		},
		{
			name: "GVL_Config",
			kind: "gvl",
			folder: "POUs",
			sourceText:
				"VAR_GLOBAL CONSTANT\n" +
				"\tMAX_SPEED: REAL := 1500.0;\n" +
				"\tMIN_SPEED: REAL := 0.0;\n" +
				"END_VAR\n",
		},
		{
			name: "DUT_MotorState",
			kind: "structure",
			folder: "POUs/Types",
			sourceText:
				"TYPE DUT_MotorState :\n" +
				"STRUCT\n" +
				"\tspeed: REAL;\n" +
				"\tfault: BOOL;\n" +
				"END_STRUCT\n" +
				"END_TYPE\n",
		},
	],
};
