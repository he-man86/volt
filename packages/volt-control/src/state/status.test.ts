import { expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VoltStatus, isIdeChangeEdge, settleOutcome } from "./status.js";
import type { StatusJson } from "../view/types.js";

/** Poll until `cond()` is true or `ms` elapses — fs.watch delivers events + the handler debounces, so a fixed
 *  sleep would be racy. */
async function until(cond: () => boolean, ms = 3000): Promise<void> {
	const start = Date.now();
	while (!cond() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 50));
}

// Change detection now rides the /health poll (no /refs). These pin the edge decision the poll makes.
test("isIdeChangeEdge: fires on a projectDirty false→true edge, not on the first read or while staying dirty", () => {
	// First read never fires (start()'s explicit refresh covers the initial state).
	expect(isIdeChangeEdge({ seen: false, dirty: false, name: "P" }, { dirty: true, name: "P" })).toBe(false);
	// clean → dirty: an IDE edit.
	expect(isIdeChangeEdge({ seen: true, dirty: false, name: "P" }, { dirty: true, name: "P" })).toBe(true);
	// staying dirty: no new edge (the documented same-dirty-cycle limitation).
	expect(isIdeChangeEdge({ seen: true, dirty: true, name: "P" }, { dirty: true, name: "P" })).toBe(false);
	// dirty → clean (a save): not an edge either.
	expect(isIdeChangeEdge({ seen: true, dirty: true, name: "P" }, { dirty: false, name: "P" })).toBe(false);
});

test("isIdeChangeEdge: fires on a project switch (rebind)", () => {
	expect(isIdeChangeEdge({ seen: true, dirty: false, name: "P" }, { dirty: false, name: "Q" })).toBe(true);
	expect(isIdeChangeEdge({ seen: true, dirty: false, name: "P" }, { dirty: false, name: "P" })).toBe(false);
});

// A disconnect/reconnect moves the name undefined↔defined — that's the bridge dropping and coming back, NOT an
// IDE edit, so it must not raise the "IDE changed — Refresh" hint (it did on every reconnect before).
test("isIdeChangeEdge: a reconnect (name undefined↔defined) is not an edit edge", () => {
	expect(isIdeChangeEdge({ seen: true, dirty: false, name: undefined }, { dirty: false, name: "P" })).toBe(false); // reconnect
	expect(isIdeChangeEdge({ seen: true, dirty: false, name: "P" }, { dirty: false, name: undefined })).toBe(false); // disconnect
});

// `adopt` carries the drift the action returned but NOT health, and health now rides the connector feed, which
// fires once per change and never repeats itself. A change that lands while our own mutation holds the gate is
// skipped — so settling must re-read, or the panel sits on "connected" against an IDE that closed mid-push.
test("settleOutcome re-reads health after adopting the action's status", async () => {
	const dir = mkdtempSync(join(tmpdir(), "volt-settle-"));
	try {
		const s = new VoltStatus(dir);
		const health = spyOn(s, "refreshHealth").mockResolvedValue(undefined);
		const status: StatusJson = {
			initialized: true,
			merging: null,
			incoming: { added: [], modified: [], deleted: [] },
			outgoing: { added: [], modified: [], deleted: [] },
			pathByName: {},
			projectMismatch: null,
			summary: "",
		};

		await settleOutcome(s, { kind: "ok", status });
		expect(health).toHaveBeenCalledTimes(1);
		s.dispose();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// A disposed tracker must go quiet: the desktop rebinds the moment opencode switches project, and an in-flight
// auto-connect settles a beat later — that late refresh would walk the IDE for a workspace nobody is showing.
test("a disposed VoltStatus stops refreshing", async () => {
	const dir = mkdtempSync(join(tmpdir(), "volt-disposed-"));
	try {
		const s = new VoltStatus(dir);
		let fired = 0;
		s.onDidChange.event(() => fired++);
		s.dispose();
		await s.refresh(true); // a late settle from work that was already in flight
		expect(fired).toBe(0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("refresh on an unbound workspace clears state and fires onDidChange (no bridge needed)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "volt-st-"));
	try {
		const s = new VoltStatus(dir); // no .git/volt/config.json → not a bound workspace
		let fired = 0;
		s.onDidChange.event(() => fired++);
		await s.refresh(true);
		expect(s.cached).toBeUndefined();
		expect(s.statusError).toBeUndefined();
		expect(fired).toBe(1); // onDidChange fires once, even on the empty path
		s.dispose(); // safe without start() — the interval handles are null
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// The outgoing-detection fix: a workspace src edit (however made — agent, terminal, external editor) triggers a
// refresh via the src/ watcher, not just an in-editor save. Within the 3s window neither poll fires a refresh
// (health poll needs a bound vendor; mtime poll needs ide-refs.json), so a recorded refresh came from the watcher.
test("a workspace src edit triggers a refresh (src watcher closes the outgoing gap)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "volt-watch-"));
	mkdirSync(join(dir, "src", "POUs"), { recursive: true }); // src/ must exist before start() attaches the watcher
	const s = new VoltStatus(dir);
	const spy = spyOn(s, "refresh");
	try {
		await s.start();
		spy.mockClear(); // ignore start()'s own initial refresh
		writeFileSync(join(dir, "src", "POUs", "FB_Motor.fb"), "FUNCTION_BLOCK FB_Motor\nx := 1;");
		await until(() => spy.mock.calls.length > 0);
		expect(spy.mock.calls.length).toBeGreaterThan(0);
	} finally {
		s.dispose();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the src watcher ignores non-source files (no refresh for a README)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "volt-watch-"));
	mkdirSync(join(dir, "src"), { recursive: true });
	const s = new VoltStatus(dir);
	const spy = spyOn(s, "refresh");
	try {
		await s.start();
		spy.mockClear();
		writeFileSync(join(dir, "src", "README.md"), "not a POU");
		await until(() => spy.mock.calls.length > 0, 900); // well past the debounce; should never fire
		expect(spy.mock.calls.length).toBe(0);
	} finally {
		s.dispose();
		rmSync(dir, { recursive: true, force: true });
	}
});
