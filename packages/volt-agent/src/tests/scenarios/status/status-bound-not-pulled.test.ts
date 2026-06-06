/**
 * `volt status` against a workspace that's been `volt init`-ed but
 * never `volt pull`-ed. Without this case, the SCM view in VS Code
 * would render empty right after init â€” the engineer has no preview
 * of what `volt pull` would do.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { status as statusVerb } from "../../../cli/status.js";
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js";
import { runVerb } from "../../harness/run-verb.js";
import { simple } from "../../fixtures/projects/simple.js";

let env: TestEnv | undefined;
afterEach(() => {
	env?.cleanup();
	env = undefined;
});

describe("scenario: status after init, before any pull", () => {
	test("shows every bridge item as incoming added", async () => {
		// makeTestEnv writes config.json + snapshot bare repo but no
		// state.json (no pull has happened) â€” the post-`volt init`
		// shape we want to exercise.
		env = makeTestEnv(simple);

		const result = await runVerb(statusVerb, env, { json: true });
		expect(result.exitCode).toBe(0);
		const out = JSON.parse(result.stdout) as {
			initialized: boolean;
			incoming: { added: string[]; modified: string[]; removed: string[] };
			outgoing: { added: string[]; modified: string[]; removed: string[] };
			nextAction: string | null;
			pathByName: Record<string, string>;
			summary: string;
		};

		expect(out.initialized).toBe(true);
		expect(out.outgoing.added).toEqual([]);
		expect(out.outgoing.modified).toEqual([]);
		expect(out.outgoing.removed).toEqual([]);
		// `simple` fixture has 3 items â€” all should appear as incoming added.
		expect(out.incoming.added.sort()).toEqual([
			"DUT_MotorState",
			"FB_Motor",
			"GVL_Config",
		]);
		expect(out.incoming.modified).toEqual([]);
		expect(out.incoming.removed).toEqual([]);
		expect(out.nextAction).toBe("pull");
		expect(out.summary).toMatch(/run volt pull/i);
	});

	test("pathByName entries are workspace-relative under src/", async () => {
		env = makeTestEnv(simple);

		const result = await runVerb(statusVerb, env, { json: true });
		const out = JSON.parse(result.stdout) as { pathByName: Record<string, string> };

		// Every entry must start with `src/` so the VS Code extension
		// can `vscode.Uri.joinPath(workspaceFolder, rel)` without
		// guessing.
		for (const [name, rel] of Object.entries(out.pathByName)) {
			expect(rel.startsWith("src/"), `pathByName[${name}] = ${rel} should start with "src/"`).toBe(true);
		}
		// /refs now carries `folders` (protocol bump), so the SCM view
		// shows each pre-pull item under its REAL workspace path â€” even
		// nested ones like `src/POUs/Types/...` â€” not a `src/POUs/`
		// best-effort default.
		expect(out.pathByName["FB_Motor"]).toBe("src/POUs/FB_Motor.st");
		expect(out.pathByName["GVL_Config"]).toBe("src/POUs/GVL_Config.gvl");
		expect(out.pathByName["DUT_MotorState"]).toBe("src/POUs/Types/DUT_MotorState.struct");
	});

	test("porcelain output emits one iA line per bridge item", async () => {
		env = makeTestEnv(simple);

		const result = await runVerb(statusVerb, env, { porcelain: true });
		expect(result.exitCode).toBe(0);
		const lines = result.stdout.trim().split("\n").sort();
		expect(lines).toEqual([
			"iA DUT_MotorState",
			"iA FB_Motor",
			"iA GVL_Config",
		]);
	});
});
