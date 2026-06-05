/**
 * Project with the full mix of kinds Volt tracks: source POUs +
 * non-source config items (library refs, tasks, devices, project
 * info). Drives the access-mode + config-tracking scenarios.
 *
 * Config items already carry the rendered text manifest the bridge
 * would produce — keeps fixtures readable instead of relying on
 * formatters running inside the test harness.
 */
import type { ProjectFixture } from "../../harness/make-test-env.js";

export const withConfig: ProjectFixture = {
	items: [
		// Source POUs.
		{
			name: "FB_Pump",
			kind: "function_block",
			folder: "POUs",
			language: "ST",
			sourceText:
				"FUNCTION_BLOCK FB_Pump\n" +
				"VAR\n" +
				"\tspeed: REAL;\n" +
				"END_VAR\n" +
				"\nEND_FUNCTION_BLOCK\n",
		},
		// A library reference — what `lib_manager.references` would
		// produce on the bridge for one entry.
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
		// An IEC task — rendered text manifest from the bridge's
		// `format_task` extractor.
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
		// A device tree node.
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
		// Project information.
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
};
