import { describe, expect, test } from "bun:test";
import { canonicalizeDiagnostics } from "./diagnostics-normalize.js";
import type { BridgeDiagnostic } from "./types.js";

const d = (object: string | null, extra: Partial<BridgeDiagnostic> = {}): BridgeDiagnostic => ({
	severity: "error",
	message: "m",
	line: 1,
	object,
	section: null,
	...extra,
});

describe("canonicalizeDiagnostics", () => {
	test("strips the CODESYS `Application.` container prefix from top-level POUs", () => {
		expect(canonicalizeDiagnostics([d("Application.FB_X")])[0]!.object).toBe("FB_X");
	});

	test("leaves bare (Beckhoff) objects untouched", () => {
		const out = canonicalizeDiagnostics([d("FB_X"), d("FB_X.DoWork")]);
		expect(out.map((x) => x.object)).toEqual(["FB_X", "FB_X.DoWork"]);
	});

	test("only strips a LEADING prefix, never mid-string", () => {
		expect(canonicalizeDiagnostics([d("FB_Application.X")])[0]!.object).toBe("FB_Application.X");
	});

	test("passes project-level (null) objects through", () => {
		expect(canonicalizeDiagnostics([d(null)])[0]!.object).toBeNull();
	});

	test("preserves all other fields", () => {
		const out = canonicalizeDiagnostics([d("Application.FB_X.Run", { section: "impl", line: 5 })]);
		expect(out[0]).toEqual({ severity: "error", message: "m", line: 5, object: "FB_X.Run", section: "impl" });
	});
});
