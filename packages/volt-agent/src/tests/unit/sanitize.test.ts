import { describe, expect, test } from "bun:test";
import { toPackageName } from "../../scaffold/sanitize.js";

describe("toPackageName", () => {
	test("lowercases and preserves digits", () => {
		expect(toPackageName("MyProject")).toBe("myproject");
		expect(toPackageName("Untitled2")).toBe("untitled2");
	});

	test("collapses non-alphanumeric runs to single dash", () => {
		expect(toPackageName("Untitled 2")).toBe("untitled-2");
		expect(toPackageName("My  Project!!  Name")).toBe("my-project-name");
	});

	test("strips leading and trailing dashes", () => {
		expect(toPackageName("---MyProject---")).toBe("myproject");
		expect(toPackageName(" .. MyProject .. ")).toBe("myproject");
	});

	test("falls back to plc-workspace on all-special input", () => {
		expect(toPackageName("!!!")).toBe("plc-workspace");
		expect(toPackageName("   ")).toBe("plc-workspace");
		expect(toPackageName("")).toBe("plc-workspace");
	});

	test("falls back on CJK-only input (no a-z0-9 to preserve)", () => {
		expect(toPackageName("プロジェクト")).toBe("plc-workspace");
	});

	test("accepts leading digit (legal npm name)", () => {
		expect(toPackageName("123-PLC")).toBe("123-plc");
		expect(toPackageName("42")).toBe("42");
	});
});
