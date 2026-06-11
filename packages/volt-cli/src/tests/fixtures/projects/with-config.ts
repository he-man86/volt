import type { ProjectFixture } from "../../harness/make-test-env.js"

export const withConfig: ProjectFixture = {
	items: [
		{
			name: "FB_Pump",
			kind: "function_block",
			folder: "POUs",
			sourceText:
				"FUNCTION_BLOCK FB_Pump\n" +
				"VAR\n" +
				"\tspeed: REAL;\n" +
				"END_VAR\n" +
				"\nEND_FUNCTION_BLOCK\n",
		},
		{
			name: "IoStandard",
			kind: "library",
			folder: "Device/Plc Logic/Application/Library Manager",
			sourceText:
				"name = #IoStandard\n" +
				"placeholder = IoStandard\n" +
				"namespace = IoStandard\n" +
				"resolution = IoStandard, 3.5.17.0 (System)\n" +
				"managed = false\n" +
				"placeholder-only = true\n" +
				"system = true\n",
		},
		{
			name: "MainTask",
			kind: "task",
			folder: "Device/Plc Logic/Application/Task Configuration",
			sourceText:
				"kind = Cyclic\n" +
				"priority = 1\n" +
				"interval = 50\n" +
				"pou = PLC_PRG\n",
		},
		{
			name: "Device",
			kind: "device",
			folder: "",
			sourceText:
				"device-type = 64\n" +
				"device-id = 1028 0100\n" +
				"device-version = 3.32.0.1\n" +
				"enabled = true\n",
		},
		{
			name: "Project Information",
			kind: "project_info",
			folder: "",
			sourceText:
				"title = TestProject\n" +
				"version = 1.0.0\n" +
				"author = Tester\n",
		},
	],
}
