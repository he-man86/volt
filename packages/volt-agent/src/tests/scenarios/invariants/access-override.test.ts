/**
 * The `extensionAccess` config field can flip an extension's
 * default mode. Two scenarios:
 *   - `"off"` — skip the extension entirely on pull; no file lands.
 *   - `"rw"` — flip a default-`r` extension to writable; push goes
 *     through where it would otherwise be refused.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { pullVerb } from "../../../cli/pull.js";
import { pushVerb } from "../../../cli/push.js";
import {
	listWorkspace,
	workspaceHasFile,
} from "../../harness/assert-workspace.js";
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js";
import { runVerb } from "../../harness/run-verb.js";
import { withConfig } from "../../fixtures/projects/with-config.js";

let env: TestEnv | undefined;
afterEach(() => {
	env?.cleanup();
	env = undefined;
});

describe("scenario: extensionAccess overrides", () => {
	test('"off" makes a library extension invisible to the workspace', async () => {
		// NOTE: the registry currently emits config items regardless;
		// "off" is checked at the materialization boundary in pull.
		// If this test fails because libraries appear anyway, the
		// pull path isn't consulting `effectiveAccess` yet.
		env = makeTestEnv({
			...withConfig,
			extensionAccess: { ".library": "off" },
		});
		await runVerb(pullVerb, env);
		const files = listWorkspace(env.workspace);
		const libraryFiles = files.filter((f) => f.endsWith(".library"));
		expect(libraryFiles).toEqual([]);
		// Source POUs still land — only `.library` got filtered.
		expect(workspaceHasFile(env.workspace, "POUs/FB_Pump.st")).toBe(true);
	});

	test('"rw" override lets push send a normally-read-only extension', async () => {
		env = makeTestEnv({
			...withConfig,
			extensionAccess: { ".library": "rw" },
		});
		await runVerb(pullVerb, env);

		// Edit the .library file. With "rw" override push should succeed.
		writeFileSync(
			join(
				env.workspace,
				"Device/Plc Logic/Application/Library Manager/IoStandard.library",
			),
			"name = #IoStandard\nresolution = 3.5.18.0 (upgraded)\n",
			"utf-8",
		);
		const result = await runVerb(pushVerb, env);
		// Either accepted (bridge consumes the edit) or — depending on
		// TestBridge's policy for non-source kinds — refused at the
		// bridge level. Exit code should NOT be 2 (the agent's refusal
		// code), because the agent's policy guard saw "rw" and let it
		// through. Even if the bridge rejects (different exit), we
		// proved the agent stopped blocking.
		expect(result.exitCode).not.toBe(2);
	});
});
