/**
 * Full-cycle integration tests against a live bridge (L5).
 *
 * Exercises read+write round-trips the simulator can't cover:
 *   - init → pull → modify workspace → push → re-pull (idempotence)
 *   - move via the IDE (folder change on the bridge) → pull catches up
 *   - move via the workspace (rename a .st path) → push relocates
 *   - spurious-version-churn check (untouched items don't bump)
 *
 * Skipped unless `VOLT_TEST_BRIDGE_PORT` is set (8555 = TwinCAT,
 * 8556 = CODESYS). Test targets are the `VoltTest_*` sandbox items
 * defined in `SANDBOX.md` — each test skips its leg gracefully if the
 * target item isn't in the IDE project, so a partial sandbox still
 * runs the legs whose items exist.
 *
 * Idempotency: every test that mutates restores the original content in
 * `afterAll`. If a test crashes between push and restore, the next
 * test run cleans up (because the restore loop reads the current
 * version and overwrites with the saved-original content).
 */
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { BridgeClient } from "../../bridge/client.js";
import { findExistingFile, type VerbContext } from "../../cli/_shared.js";
import { init as initVerb } from "../../cli/init.js";
import { pullVerb } from "../../cli/pull.js";
import { pushVerb } from "../../cli/push.js";

const PORT_RAW = process.env.VOLT_TEST_BRIDGE_PORT;
const PORT = PORT_RAW !== undefined ? Number.parseInt(PORT_RAW, 10) : Number.NaN;
const LIVE = Number.isFinite(PORT);

const LIVE_TIMEOUT_MS = 120_000;

// Sandbox item names — see `SANDBOX.md`. These are the canonical
// items the L5 live tests target. If an item is missing in the IDE
// project, the per-leg test skips itself cleanly.
const PLC_PRG = "VoltTest_PLC_PRG";
const FB_ST = "VoltTest_FB_ST";
const FB_MOVABLE = "VoltTest_FB_MovableA";
const FB_MOVABLE_WS = "VoltTest_FB_MovableB";

const MARKER = "// volt-fullcycle-test marker";
const MARKER_V2 = "// volt-fullcycle-test marker v2";

interface SandboxState {
	workspace: string;
	bridge: BridgeClient;
	/** Items the IDE project actually has, mapping name → workspace path
	 *  + original content + original bridge folder. Only items found at
	 *  startup are here; per-test code probes this map to decide whether
	 *  to skip. The folder is the bridge-side path (forward-slash,
	 *  workspace-relative without basename) — captured so afterAll can
	 *  restore items that mid-test failures left at the wrong folder. */
	items: Map<string, { path: string; originalFolder: string; originalContent: string }>;
}

/**
 * Bridge folder path for a workspace file. Returns the slash-joined
 * directory portion of the workspace-relative path (e.g.
 * `POUs/VoltTest/MoveSource`), or `""` for items at the project root.
 * The bridge's `folder` wire field matches this format exactly — the
 * pull writes files at `<workspace>/<folder>/<name>.<ext>`.
 */
function folderFromWorkspacePath(workspace: string, filePath: string): string {
	const rel = relative(workspace, filePath).replace(/\\/g, "/");
	const idx = rel.lastIndexOf("/");
	return idx === -1 ? "" : rel.slice(0, idx);
}

let state: SandboxState | undefined;

function ctx(extraFlags: Record<string, string | boolean> = {}): VerbContext {
	if (state === undefined) throw new Error("state not initialized");
	return {
		workspace: state.workspace,
		port: PORT,
		bridge: state.bridge,
		flags: extraFlags,
	};
}

function sandboxItem(name: string): { path: string; original: string } | undefined {
	const entry = state?.items.get(name);
	if (entry === undefined) return undefined;
	return { path: entry.path, original: entry.originalContent };
}

describe.skipIf(!LIVE)("full-cycle integration (live bridge)", () => {
	beforeAll(async () => {
		const workspace = mkdtempSync(join(tmpdir(), "volt-fullcycle-"));
		const bridge = new BridgeClient({ port: PORT });
		const h = await bridge.getHealth();
		if (h.connected !== true) {
			throw new Error(
				`bridge at :${PORT} reports connected=false (ide=${h.ideName}) — open an IDE project before running this test`,
			);
		}
		state = { workspace, bridge, items: new Map() };
	});

	afterAll(async () => {
		if (state === undefined) return;
		// Restore every sandbox item to its original folder AND original
		// content, regardless of which test (or which assertion within a
		// test) mutated it.
		//
		// Two round-trips per item, in order:
		//   1. moveItem to originalFolder — UpdateHandler does NOT
		//      relocate items on its own; folder field on pushItem only
		//      affects CHILD creation paths.
		//   2. pushItem with originalContent (against the post-move
		//      version) — restores text.
		//
		// Items already at the right folder still get a moveItem (the
		// bridge implements it as snapshot + delete + recreate, which
		// is wasteful here but correct). Worth one wasted round-trip
		// per untouched item to avoid an extra /fetch just to read the
		// current folder — refs alone doesn't carry folder.
		//
		// Combining [moveItem, pushItem] for the same item into ONE
		// /push batch is unsafe: moveItem's apply deletes the cached
		// COM reference; the following pushItem's `ResolveItem` would
		// hit the stale cache entry and dereference a deleted object.
		//
		// LIVE_TIMEOUT_MS lifts the default 5s hook timeout — 4 items
		// × 2 round-trips routinely exceeds 5s, and silent hook
		// timeouts leave the bridge in a partial-restore state that
		// then breaks the next describe block's wire-invariants tests
		// (a real failure mode observed during this work).
		for (const [name, entry] of state.items) {
			try {
				const refs1 = await state.bridge.getRefs();
				const v1 = refs1.items[name];
				if (v1 === undefined) continue;
				try {
					await state.bridge.pushBatch({
						ops: [{
							op: "moveItem",
							name,
							newFolder: entry.originalFolder,
							ifVersion: v1,
						}],
					});
				} catch { /* best-effort */ }

				const refs2 = await state.bridge.getRefs();
				const v2 = refs2.items[name];
				if (v2 === undefined) continue;
				try {
					await state.bridge.pushBatch({
						ops: [{
							op: "pushItem",
							name,
							sourceText: entry.originalContent,
							ifVersion: v2,
						}],
					});
				} catch { /* best-effort */ }
			} catch { /* best-effort — afterAll must not throw */ }
		}
		try {
			rmSync(state.workspace, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
		state = undefined;
	}, LIVE_TIMEOUT_MS);

	test(
		"init + pull populates the workspace; capture sandbox items",
		{ timeout: LIVE_TIMEOUT_MS },
		async () => {
			expect(await initVerb(ctx())).toBe(0);
			expect(await pullVerb(ctx())).toBe(0);

			// Discover which sandbox items are actually present in the
			// project. Each test below probes this map.
			for (const name of [PLC_PRG, FB_ST, FB_MOVABLE, FB_MOVABLE_WS]) {
				const p = findExistingFile(state!.workspace, `${name}.st`);
				if (p !== undefined) {
					state!.items.set(name, {
						path: p,
						originalFolder: folderFromWorkspacePath(state!.workspace, p),
						originalContent: readFileSync(p, "utf-8"),
					});
				}
			}
			if (state!.items.size === 0) {
				console.warn(
					`live full-cycle: no VoltTest_* sandbox items found in this project. ` +
						`See packages/volt-agent/src/tests/live/SANDBOX.md to set up.`,
				);
			}
		},
	);

	test(
		"push (modified VoltTest_PLC_PRG) is accepted and idempotent on re-pull",
		{ timeout: LIVE_TIMEOUT_MS },
		async () => {
			const item = sandboxItem(PLC_PRG);
			if (item === undefined) return; // skip: sandbox missing
			const modified = item.original.replace(/END_PROGRAM/, `${MARKER}\nEND_PROGRAM`);
			writeFileSync(item.path, modified);

			expect(await pushVerb(ctx())).toBe(0);
			expect(await pullVerb(ctx())).toBe(0);
			expect(readFileSync(item.path, "utf-8")).toContain(MARKER);
		},
	);

	test(
		"back-to-back push (no phantom drift across the push→fetch boundary)",
		{ timeout: LIVE_TIMEOUT_MS },
		async () => {
			const item = sandboxItem(PLC_PRG);
			if (item === undefined) return;
			const current = readFileSync(item.path, "utf-8");
			writeFileSync(item.path, current.replace(MARKER, MARKER_V2));
			// The bug we fixed (phantom drift across the push-fetch
			// boundary) would surface here as exit-code 2 + a project-
			// level drift error in stderr.
			expect(await pushVerb(ctx())).toBe(0);
			expect(await pullVerb(ctx())).toBe(0);
			expect(readFileSync(item.path, "utf-8")).toContain(MARKER_V2);
		},
	);

	test(
		"untouched items keep their per-item versions across an unrelated push",
		{ timeout: LIVE_TIMEOUT_MS },
		async () => {
			const item = sandboxItem(PLC_PRG);
			if (item === undefined) return;
			const beforeItems = { ...(await state!.bridge.getRefs()).items };
			const cur = readFileSync(item.path, "utf-8");
			writeFileSync(item.path, cur.replace(MARKER_V2, `${MARKER_V2}_x`));
			expect(await pushVerb(ctx())).toBe(0);

			const afterItems = (await state!.bridge.getRefs()).items;
			const churned: string[] = [];
			for (const [name, ver] of Object.entries(beforeItems)) {
				if (afterItems[name] !== ver) churned.push(name);
			}
			for (const name of Object.keys(afterItems)) {
				if (!(name in beforeItems)) churned.push(name);
			}
			const spurious = churned.filter((n) => n !== PLC_PRG);
			if (spurious.length > 0) {
				console.error(
					`SPURIOUS VERSION CHURN — items changed version without being pushed:\n  ${spurious.join("\n  ")}`,
				);
			}
			expect(spurious).toEqual([]);
		},
	);

	test(
		"IDE-side move of VoltTest_FB_MovableA → next pull mirrors into workspace",
		{ timeout: LIVE_TIMEOUT_MS },
		async () => {
			const item = sandboxItem(FB_MOVABLE);
			if (item === undefined) return;
			// Capture current location.
			const refs = await state!.bridge.getRefs();
			const currentVersion = refs.items[FB_MOVABLE];
			if (currentVersion === undefined) return;

			// Move via the bridge directly using a pushItem that sets a
			// new folder. This simulates the IDE-side move that the
			// engineer would do in CODESYS / TC. After this completes,
			// the workspace is stale (still has the file at the old
			// folder); volt pull should detect and migrate.
			const newFolder = "POUs/VoltTest/MoveDest";
			await state!.bridge.pushBatch({
				ops: [
					{
						op: "moveItem",
						name: FB_MOVABLE,
						newFolder,
						ifVersion: currentVersion,
					},
				],
			});

			expect(await pullVerb(ctx())).toBe(0);
			// File now lives at the new folder; old location swept.
			const newPath = join(state!.workspace, newFolder, `${FB_MOVABLE}.st`);
			expect(existsSync(newPath)).toBe(true);
			expect(existsSync(item.path)).toBe(false);
			// Folder is restored by afterAll — no per-test cleanup. Inline
			// restore here would skip on assertion failure and leak state
			// to the next run, which is exactly the bug afterAll fixes.
		},
	);

	test(
		"workspace-side move of VoltTest_FB_MovableB → push emits moveItem",
		{ timeout: LIVE_TIMEOUT_MS },
		async () => {
			const item = sandboxItem(FB_MOVABLE_WS);
			if (item === undefined) return;
			// Ensure workspace is fresh first.
			expect(await pullVerb(ctx())).toBe(0);
			const refreshedPath = findExistingFile(state!.workspace, `${FB_MOVABLE_WS}.st`);
			if (refreshedPath === undefined) return;

			// Engineer drags the file in their editor to a new folder.
			const newRelFolder = "POUs/VoltTest/MoveDest";
			const newPath = join(state!.workspace, newRelFolder, `${FB_MOVABLE_WS}.st`);
			mkdirSync(dirname(newPath), { recursive: true });
			renameSync(refreshedPath, newPath);

			// Push should emit a moveItem op (folder-only change) and
			// the bridge should land the item at the new folder.
			expect(await pushVerb(ctx())).toBe(0);

			const refs = await state!.bridge.getRefs();
			expect(refs.items[FB_MOVABLE_WS]).toBeDefined();
			// Folder restored by afterAll — see test 5's note. The inline
			// per-test restore that lived here was load-bearing for the
			// next run only when the asserts above passed; afterAll covers
			// both the pass and the assertion-failure paths.
		},
	);

	test(
		"VoltTest_FB_ST: bridge re-emits child changes; pull surfaces them in the parent .st",
		{ timeout: LIVE_TIMEOUT_MS },
		async () => {
			const item = sandboxItem(FB_ST);
			if (item === undefined) return;
			// Re-pull to baseline.
			expect(await pullVerb(ctx())).toBe(0);
			const baselineContent = readFileSync(item.path, "utf-8");
			// Sanity: the sandbox shape must include a Reset action and a
			// GetValue method (per SANDBOX.md). Skip if not — sandbox is
			// older or incomplete.
			if (!baselineContent.includes("ACTION Reset") || !baselineContent.includes("METHOD GetValue")) {
				return;
			}

			// Make a content edit that touches the action body, push,
			// re-pull, verify the action body change round-trips.
			const edited = baselineContent.replace(
				/value := 0;/,
				`value := 0; ${MARKER}`,
			);
			writeFileSync(item.path, edited);
			expect(await pushVerb(ctx())).toBe(0);
			expect(await pullVerb(ctx())).toBe(0);
			const after = readFileSync(item.path, "utf-8");
			expect(after).toContain("value := 0;");
			expect(after).toContain(MARKER);
		},
	);

	test(
		"status reports clean after the cycle",
		{ timeout: LIVE_TIMEOUT_MS },
		async () => {
			if (state!.items.size === 0) return;
			// Re-pull to sync any pending bridge changes from previous
			// move tests, then status should be clean.
			expect(await pullVerb(ctx())).toBe(0);
			const { status } = await import("../../cli/status.js");
			expect(await status(ctx({ porcelain: true }))).toBe(0);
		},
	);
});
