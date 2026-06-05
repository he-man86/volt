/**
 * Set up an isolated workspace + in-memory bridge for one scenario.
 *
 * Each call creates a fresh temporary directory, initializes the
 * Volt snapshot bare repo, writes a workspace config that points at
 * the test bridge, and returns the env object. Scenarios then call
 * `runVerb()` to drive real CLI verbs against this env — no
 * subprocess, no HTTP, deterministic, parallelizable.
 *
 * Single point of harness setup so scenarios stay short and focused
 * on behavior assertions.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TestBridge, type TestBridgeItem, type TestBridgeOptions } from "../../bridge/test-bridge.js";
import type { Access } from "../../engine/access.js";
import { saveConfig, workspacePaths } from "../../engine/config.js";
import { ensureSnapshotRepo } from "../../engine/snapshot.js";

export interface ProjectFixture {
	/** Items the test bridge starts with. Each MUST declare `kind`. */
	items: TestBridgeItem[];
	/** Optional access-mode overrides written into `.volt/config.json`. */
	extensionAccess?: Record<string, Access>;
	/** Optional health override (e.g. set platform to "codesys"). */
	health?: TestBridgeOptions["health"];
}

export interface TestEnv {
	/** Absolute path to the workspace root. */
	workspace: string;
	/** The in-memory bridge backing this env. */
	bridge: TestBridge;
	/** Tear down — remove the temp dir. Call from `afterEach` or
	 *  `finally`. Safe to call multiple times. */
	cleanup(): void;
}

let envCounter = 0;

/**
 * Build a fresh test environment from a fixture.
 *
 * Each call:
 *   - mkdtemp's a fresh workspace under the OS tempdir
 *   - constructs a TestBridge populated with the fixture's items
 *   - calls `ensureSnapshotRepo` so verbs can find the snapshot
 *   - writes `.volt/config.json` (platform = bridge health platform,
 *     port = 0 since the harness wires the bridge directly), with
 *     any `extensionAccess` overrides the fixture declares
 */
export function makeTestEnv(fixture: ProjectFixture): TestEnv {
	envCounter += 1;
	const workspace = mkdtempSync(join(tmpdir(), `volt-scenario-${envCounter}-`));
	const paths = workspacePaths(workspace);
	ensureSnapshotRepo(paths.snapshotPath);
	const bridge = new TestBridge({
		initialItems: fixture.items,
		health: fixture.health,
	});
	const platform = fixture.health?.platform ?? "beckhoff";
	saveConfig(workspace, {
		bridge: { port: 0 },
		project: {
			platform,
			projectName: "ScenarioProject",
			plcProjectName: "ScenarioPlc",
		},
		...(fixture.extensionAccess !== undefined
			? { extensionAccess: fixture.extensionAccess }
			: {}),
		linkedAt: new Date(0).toISOString(),
	});
	let cleaned = false;
	return {
		workspace,
		bridge,
		cleanup(): void {
			if (cleaned) return;
			cleaned = true;
			try {
				rmSync(workspace, { recursive: true, force: true });
			} catch {
				// best effort — temp dir survives until next reboot anyway
			}
		},
	};
}
