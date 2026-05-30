/**
 * Bun test wrapper that shells out to Python and runs the CODESYS
 * bridge's helper unit tests. Those tests live in
 * `codesys/CodesysBridge.Tests/` and use stdlib `unittest` so they
 * also run inside IronPython 2.7 (the production runtime). The
 * harness here is what makes them part of `bun test` on the dev/CI
 * side.
 *
 * Skipped (not failed) when no `python` is on PATH — most contributors
 * have CPython installed but not all CI runners do.
 */
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "bun:test";

const TESTS_DIR = resolve(__dirname, "codesys/CodesysBridge.Tests");

function pythonAvailable(): string | null {
	for (const cmd of ["python", "python3"]) {
		const r = spawnSync(cmd, ["--version"], { encoding: "utf-8" });
		if (r.status === 0) return cmd;
	}
	return null;
}

const PY = pythonAvailable();

describe("codesys bridge: Python helper tests", () => {
	if (PY === null) {
		it.skip("no python on PATH — install CPython 3 to run codesys bridge helper tests", () => {});
		return;
	}

	it("test_st_splitter.py passes (cross-language ground truth vs C# splitter)", () => {
		const r = spawnSync(PY, ["test_st_splitter.py"], {
			encoding: "utf-8",
			cwd: TESTS_DIR,
		});
		if (r.status !== 0) {
			const detail = (r.stderr || "") + "\n--- stdout ---\n" + (r.stdout || "");
			throw new Error(`codesys st_splitter tests failed (exit ${r.status}):\n${detail}`);
		}
		expect(r.status).toBe(0);
	});
});
