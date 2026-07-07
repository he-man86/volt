import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeWorkspaceScaffold } from "./scaffold.js";

function scaffoldInto(plc = "My Conveyor 01"): string {
	const root = mkdtempSync(join(tmpdir(), "volt-scaffold-"));
	writeWorkspaceScaffold(root, plc);
	return root;
}

test("writes a single Cargo crate under rust/, not a Bun project", () => {
	const root = scaffoldInto();
	try {
		for (const f of ["rust/Cargo.toml", "rust/src/lib.rs", "rust/tests/smoke.rs", ".vscode/settings.json", "README.md"]) {
			expect(existsSync(join(root, f))).toBe(true);
		}
		for (const f of ["package.json", "bunfig.toml", "tsconfig.json", "tests/example.test.ts"]) {
			expect(existsSync(join(root, f))).toBe(false);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Cargo.toml is a single package (no workspace) so the PLC src/ is never a target", () => {
	const root = scaffoldInto("4-Axis Robot");
	try {
		const toml = readFileSync(join(root, "rust/Cargo.toml"), "utf-8");
		expect(toml).toContain("[package]");
		expect(toml).not.toContain("[workspace]");
		// leading-digit project names must not yield an invalid crate name
		expect(toml).toMatch(/name = "plc-4-axis-robot"/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("VS Code settings keep ST associations + point rust-analyzer at the crate", () => {
	const root = scaffoldInto();
	try {
		const settings = JSON.parse(readFileSync(join(root, ".vscode/settings.json"), "utf-8"));
		expect(settings["files.associations"]["*.prg"]).toBe("structured-text");
		expect(settings["rust-analyzer.linkedProjects"]).toEqual(["rust/Cargo.toml"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("idempotent — a second pass without force writes nothing", () => {
	const root = scaffoldInto();
	try {
		const second = writeWorkspaceScaffold(root, "My Conveyor 01");
		expect(second.created).toEqual([]);
		expect(second.skipped.length).toBeGreaterThan(0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("README spells out the kind→extension mapping and warns off `.dut`", () => {
	// The PackML incident: an AI read this README, saw only a trailing "…" after `.struct`, and reached for
	// CODESYS's generic `.dut`. The README must now give the full per-kind mapping AND an explicit no-`.dut`.
	const root = scaffoldInto();
	try {
		const readme = readFileSync(join(root, "README.md"), "utf-8");
		for (const ext of ["`.struct`", "`.enum`", "`.union`", "`.alias`", "`.fb`", "`.prg`", "`.fun`", "`.itf`", "`.gvl`"]) {
			expect(readme).toContain(ext);
		}
		expect(readme).toContain("no"); // the explicit "There is no `.dut` extension" callout
		expect(readme).toContain("`.dut`");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
