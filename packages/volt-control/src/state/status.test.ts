import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VoltStatus, isIdeChangeEdge } from "./status.js";

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
