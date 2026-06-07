/**
 * Regression test: `volt show <ref> <path>` accepts both vendor-relative
 * and workspace-relative (src/-prefixed) paths.
 *
 * The VS Code extension builds `volt://` URIs using workspace-relative
 * paths (`src/01_PackML/Foo.enum`) — those carry the `src/` prefix the
 * `materializeItem` outputs strip. Before this fix the snapshot lookup
 * compared the src-prefixed path against vendor-relative tree entries,
 * missed every time, and rendered the left diff pane empty for any
 * outgoing change. Same bug bit the BRIDGE branch's path-match (though
 * BRIDGE accidentally worked via the `?? outputs[0]` fallback when an
 * item produced only one file).
 */
import { afterEach, describe, expect, test } from "bun:test";

import { pullVerb } from "../../cli/pull.js";
import { show } from "../../cli/show.js";
import { simple } from "../fixtures/projects/simple.js";
import { makeTestEnv, type TestEnv } from "../harness/make-test-env.js";
import { runVerb } from "../harness/run-verb.js";

let env: TestEnv | undefined;
afterEach(() => {
	env?.cleanup();
	env = undefined;
});

describe("show: src/ prefix handling", () => {
	test("HEAD ref resolves a workspace-relative (src/-prefixed) path", async () => {
		env = makeTestEnv(simple);
		expect((await runVerb(pullVerb, env)).exitCode).toBe(0);

		// What the VS Code extension actually sends — paths come from
		// `status --json`'s `pathByName`, which carries the `src/` prefix.
		const result = await runVerb(show, env, {
			_positional: "HEAD",
			_positional2: "src/POUs/FB_Motor.st",
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout.length).toBeGreaterThan(0);
		expect(result.stdout).toContain("FUNCTION_BLOCK FB_Motor");
	});

	test("HEAD ref still resolves a vendor-relative path (no src/)", async () => {
		env = makeTestEnv(simple);
		expect((await runVerb(pullVerb, env)).exitCode).toBe(0);

		// Existing CLI users / older callers omit the src/ prefix.
		// Strip must be conditional — must not corrupt paths that
		// don't start with src/.
		const result = await runVerb(show, env, {
			_positional: "HEAD",
			_positional2: "POUs/FB_Motor.st",
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("FUNCTION_BLOCK FB_Motor");
	});

	test("BRIDGE ref resolves a workspace-relative path", async () => {
		env = makeTestEnv(simple);
		expect((await runVerb(pullVerb, env)).exitCode).toBe(0);

		const result = await runVerb(show, env, {
			_positional: "BRIDGE",
			_positional2: "src/POUs/FB_Motor.st",
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("FUNCTION_BLOCK FB_Motor");
	});

	test("missing item still reports the original (user-supplied) path in the error", async () => {
		env = makeTestEnv(simple);
		expect((await runVerb(pullVerb, env)).exitCode).toBe(0);

		const result = await runVerb(show, env, {
			_positional: "HEAD",
			_positional2: "src/POUs/Nope.st",
		});

		expect(result.exitCode).toBe(2);
		// Error message echoes the path the USER passed (with src/),
		// not the internal stripped form — easier to correlate when
		// reading logs.
		expect(result.stderr).toContain("src/POUs/Nope.st");
	});
});
