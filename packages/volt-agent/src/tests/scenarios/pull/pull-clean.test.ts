/**
 * Pull against a fresh workspace bound to a bridge with N items.
 * Workspace should end up with one file per item, named/folded per
 * the registry, plus `.gitattributes`. This is the basic
 * end-to-end check that the dispatch pipeline works.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { pullVerb } from "../../../cli/pull.js";
import {
	listWorkspace,
	readWorkspace,
	workspaceHasFile,
} from "../../harness/assert-workspace.js";
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js";
import { runVerb } from "../../harness/run-verb.js";
import { simple } from "../../fixtures/projects/simple.js";
import { withConfig } from "../../fixtures/projects/with-config.js";

let env: TestEnv | undefined;
afterEach(() => {
	env?.cleanup();
	env = undefined;
});

describe("scenario: pull against a clean workspace", () => {
	test("materializes every source item under its folder with the right extension", async () => {
		env = makeTestEnv(simple);
		const result = await runVerb(pullVerb, env);
		expect(result.exitCode).toBe(0);

		const files = listWorkspace(env.workspace);
		// Source POUs land at their folder + name + per-kind extension.
		expect(files).toContain("src/POUs/FB_Motor.st");
		expect(files).toContain("src/POUs/GVL_Config.gvl");
		expect(files).toContain("src/POUs/Types/DUT_MotorState.struct");
		// .gitattributes is auto-generated under src/ alongside PLC files.
		expect(files).toContain("src/.gitattributes");
		// No mystery extras.
		expect(files.filter((p) => !/(^|\/)\./.test(p))).toEqual([
			"src/POUs/FB_Motor.st",
			"src/POUs/GVL_Config.gvl",
			"src/POUs/Types/DUT_MotorState.struct",
		]);
	});

	test("materializes config kinds with their own extensions + folders", async () => {
		env = makeTestEnv(withConfig);
		const result = await runVerb(pullVerb, env);
		expect(result.exitCode).toBe(0);

		// Source POU and config kinds coexist.
		expect(workspaceHasFile(env.workspace, "src/POUs/FB_Pump.st")).toBe(true);
		expect(
			workspaceHasFile(
				env.workspace,
				"src/Device/Plc Logic/Application/Library Manager/IoStandard.library",
			),
		).toBe(true);
		expect(
			workspaceHasFile(
				env.workspace,
				"src/Device/Plc Logic/Application/Task Configuration/MainTask.task",
			),
		).toBe(true);
		expect(workspaceHasFile(env.workspace, "src/Device.device")).toBe(true);
		expect(workspaceHasFile(env.workspace, "src/Project Information.projectinfo")).toBe(true);
	});

	test("config file content matches what the bridge sent verbatim", async () => {
		env = makeTestEnv(withConfig);
		await runVerb(pullVerb, env);
		// The .library file must contain the manifest the bridge produced ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â
		// the agent is a pass-through for config kinds.
		const libText = readWorkspace(
			env.workspace,
			"src/Device/Plc Logic/Application/Library Manager/IoStandard.library",
		);
		expect(libText).toContain("namespace = IoStandard");
		expect(libText).toContain("resolution = IoStandard, 3.5.17.0 (System)");
		expect(libText).toContain("system = true");
	});

	test("logs phase progress so the user sees what's happening", async () => {
		env = makeTestEnv(simple);
		const result = await runVerb(pullVerb, env);
		// Phase markers print to stderr; users see them in the terminal.
		expect(result.stderr).toContain("querying bridge state");
		expect(result.stderr).toContain("fetching");
		expect(result.stderr).toContain("writing");
	});
});
