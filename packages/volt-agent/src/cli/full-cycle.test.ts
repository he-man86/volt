/**
 * Full-cycle integration test against a live bridge.
 *
 * Exercises the round-trip the simulator tests can't cover:
 *   init → pull → modify workspace → push → pull → assert match.
 *
 * This is the test that would have caught this session's drift bug.
 * The simulator (TestBridge) passed 37/37 throughout, because the bug
 * lived in the BRIDGE's `projectVersion` computation — out of reach
 * for the in-process simulator. A real-IDE cycle is the only thing
 * that exercises the contract `newProjectVersion === next /fetch's
 * projectVersion` (the structural invariant the parity test asserts
 * at a single-call level — but only a full cycle proves it survives
 * a push-then-pull).
 *
 * Skipped when `VOLT_TEST_BRIDGE_PORT` is unset so CI without a live
 * IDE passes through. Set it to the running bridge port (8555 = TC,
 * 8556 = CODESYS) to enable.
 *
 * Cleanup contract: the test mutates PLC_PRG on the bridge to inject
 * a marker. `afterAll` restores the original content so re-runs are
 * idempotent. If the test crashes between push and restore, PLC_PRG
 * is left with the marker — manual cleanup or another test run
 * restores it.
 */
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeClient } from "../bridge/client.js";
import { findExistingFile, type VerbContext } from "./_shared.js";
import { init as initVerb } from "./init.js";
import { pullVerb } from "./pull.js";
import { pushVerb } from "./push.js";

const PORT_RAW = process.env.VOLT_TEST_BRIDGE_PORT;
const PORT = PORT_RAW !== undefined ? Number.parseInt(PORT_RAW, 10) : Number.NaN;
const LIVE = Number.isFinite(PORT);

const MARKER = "// volt-fullcycle-test marker";
const MARKER_V2 = "// volt-fullcycle-test marker v2";

describe.skipIf(!LIVE)("full-cycle integration (live bridge)", () => {
	let workspace: string;
	let bridge: BridgeClient;
	let plcPath: string | undefined;
	let originalPlcContent: string | undefined;

	function ctx(extraFlags: Record<string, string | boolean> = {}): VerbContext {
		return {
			workspace,
			port: PORT,
			bridge,
			flags: extraFlags,
		};
	}

	beforeAll(async () => {
		workspace = mkdtempSync(join(tmpdir(), "volt-fullcycle-"));
		bridge = new BridgeClient({ port: PORT });
		// Bridge must be reachable BEFORE the suite runs. If not, fail
		// loud rather than skipping silently — VOLT_TEST_BRIDGE_PORT
		// was explicitly set, so the user expects the test to run.
		const h = await bridge.getHealth();
		if (h.connected !== true) {
			throw new Error(
				`bridge at :${PORT} reports connected=false (ide=${h.ideName}) — open an IDE project before running this test`,
			);
		}
	});

	afterAll(() => {
		// Restore PLC_PRG to its original content if we modified it.
		// Doesn't go through volt push — we hit the bridge directly so
		// even a half-broken push pipeline leaves the IDE clean.
		if (plcPath !== undefined && originalPlcContent !== undefined) {
			try {
				const refs = bridge.getRefs();
				void refs.then(async (r) => {
					await bridge.pushBatch({
						ops: [
							{
								op: "pushItem",
								name: "PLC_PRG",
								sourceText: originalPlcContent ?? "",
								ifVersion: r.items["PLC_PRG"] ?? null,
							},
						],
					});
				});
			} catch {
				// Best-effort cleanup; not the test's job to recover here.
			}
		}
		try {
			rmSync(workspace, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	test("init + pull populates the workspace", async () => {
		const initCode = await initVerb(ctx());
		expect(initCode).toBe(0);
		const pullCode = await pullVerb(ctx());
		expect(pullCode).toBe(0);
		// Workspace must contain at least PLC_PRG.st (every TC / CODESYS
		// project has one by default). If the bridge's open project is
		// truly empty, the test will skip subsequent assertions.
		plcPath = findExistingFile(workspace, "PLC_PRG.st");
		if (plcPath !== undefined) {
			originalPlcContent = readFileSync(plcPath, "utf-8");
		}
	});

	test("push (modified PLC_PRG) is accepted and idempotent on re-pull", async () => {
		if (plcPath === undefined || originalPlcContent === undefined) {
			// IDE project has no PLC_PRG — skip the modify-push-pull leg.
			// (Test environment is unusual but valid; the init+pull leg
			// above is what we still want to assert.)
			return;
		}
		// Inject a marker comment that the bridge has to preserve.
		const modified = originalPlcContent.replace(
			/END_PROGRAM/,
			`${MARKER}\nEND_PROGRAM`,
		);
		writeFileSync(plcPath, modified);

		const pushCode = await pushVerb(ctx());
		expect(pushCode).toBe(0);

		// Re-pull. Workspace should now equal what the bridge has.
		const pullCode = await pullVerb(ctx());
		expect(pullCode).toBe(0);
		const afterPull = readFileSync(plcPath, "utf-8");
		expect(afterPull).toContain(MARKER);
	});

	test("second push (re-edit) goes through with no phantom drift", async () => {
		if (plcPath === undefined || originalPlcContent === undefined) return;
		// Sequence two pushes back-to-back. This is the exact pattern
		// the recorder hit: previous push succeeded → newProjectVersion
		// returned → state saved → next push uses it as
		// expectedProjectVersion → should match the bridge's view.
		const current = readFileSync(plcPath, "utf-8");
		writeFileSync(plcPath, current.replace(MARKER, MARKER_V2));

		const pushCode = await pushVerb(ctx());
		// The bug we fixed (phantom drift across the push-fetch
		// boundary) would surface here as exit code 2 with a
		// `<project>: project-level drift` message in stderr.
		expect(pushCode).toBe(0);

		// And a re-pull picks up v2.
		const pullCode = await pullVerb(ctx());
		expect(pullCode).toBe(0);
		expect(readFileSync(plcPath, "utf-8")).toContain(MARKER_V2);
	});

	test("untouched items keep their per-item versions across an unrelated push", async () => {
		if (plcPath === undefined || originalPlcContent === undefined) return;
		// Capture per-item versions BEFORE the push.
		const beforeRefs = await bridge.getRefs();
		const beforeItems = { ...beforeRefs.items };

		// Make ANOTHER trivial edit to PLC_PRG. We don't care about
		// PLC_PRG's version churning — that's expected. We DO care
		// whether items the user didn't touch (other POUs, FBs, GVLs,
		// graphical POUs) get new versions just because TC's
		// `Documents.SaveAll` re-emitted them on save. If they do,
		// every push spuriously inflates the project's drift surface
		// → next `volt pull` thinks the engineer changed things and
		// kicks into 3-way merge for no real reason.
		const cur = readFileSync(plcPath, "utf-8");
		writeFileSync(plcPath, cur.replace(MARKER_V2, `${MARKER_V2}_x`));
		const pushCode = await pushVerb(ctx());
		expect(pushCode).toBe(0);

		const afterRefs = await bridge.getRefs();
		const afterItems = afterRefs.items;

		// Diff: which items changed version?
		const changed: string[] = [];
		for (const [name, ver] of Object.entries(beforeItems)) {
			if (afterItems[name] !== ver) changed.push(name);
		}
		for (const name of Object.keys(afterItems)) {
			if (!(name in beforeItems)) changed.push(name);
		}

		// PLC_PRG SHOULD have a new version (we touched it). Anything
		// else changing is the spurious-conflict bug.
		const spurious = changed.filter((n) => n !== "PLC_PRG");
		if (spurious.length > 0) {
			console.error(
				`SPURIOUS VERSION CHURN — items changed version without being pushed:\n  ${spurious.join("\n  ")}`,
			);
		}
		expect(spurious).toEqual([]);
	});

test("status reports clean after the cycle", async () => {
		if (plcPath === undefined) return;
		const { status } = await import("./status.js");
		const code = await status(ctx({ porcelain: true }));
		// status exits 0 when workspace matches bridge matches snapshot.
		// porcelain mode prints nothing on a clean tree (matching `git
		// status --porcelain`'s convention).
		expect(code).toBe(0);
	});
});
