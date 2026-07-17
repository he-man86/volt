import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VoltStatus } from "./status-tracker.js";

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
