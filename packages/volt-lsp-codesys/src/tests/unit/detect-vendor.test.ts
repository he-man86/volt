/**
 * Unit tests for `detectVendor`.
 *
 * Each test gets an isolated temp directory so filesystem state doesn't
 * bleed between cases. Only .st files are content-scanned — other
 * extensions (.TcPOU, .tsproj, .iecst, .project, .exp) score by filename
 * only. See `src/detect-vendor.ts` for the full scoring table.
 */
import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectVendor } from "../../detect-vendor.js";

async function makeWorkspace(): Promise<string> {
	return mkdtemp(join(tmpdir(), "volt-vendor-"));
}

// ── TwinCAT: filename signals ───────────────────────────────────────────────

describe("detectVendor: TwinCAT filename signals", () => {
	it("returns 'twincat' when a .TcPOU file is present", async () => {
		const root = await makeWorkspace();
		await writeFile(join(root, "FB_Motor.TcPOU"), "<TcPlcObject/>", "utf-8");
		expect(await detectVendor(root)).toBe("twincat");
	});

	it("returns 'twincat' when a .TcDUT file is present", async () => {
		const root = await makeWorkspace();
		await writeFile(join(root, "ST_MotorParams.TcDUT"), "<TcPlcObject/>", "utf-8");
		expect(await detectVendor(root)).toBe("twincat");
	});

	it("returns 'twincat' when a .tsproj file is present", async () => {
		const root = await makeWorkspace();
		await writeFile(join(root, "Project.tsproj"), "<TcSmProject/>", "utf-8");
		expect(await detectVendor(root)).toBe("twincat");
	});

	it("returns 'twincat' when a .tmc file is present", async () => {
		const root = await makeWorkspace();
		await writeFile(join(root, "Library.tmc"), "<TcModuleClass/>", "utf-8");
		expect(await detectVendor(root)).toBe("twincat");
	});

	it("returns 'twincat' for multiple TC extensions (score accumulates)", async () => {
		const root = await makeWorkspace();
		await writeFile(join(root, "FB_Drive.TcPOU"), "<TcPlcObject/>", "utf-8");
		await writeFile(join(root, "Tc3.tmc"), "<TcModuleClass/>", "utf-8");
		expect(await detectVendor(root)).toBe("twincat");
	});
});

// ── TwinCAT: content signals (ST files only) ────────────────────────────────

describe("detectVendor: TwinCAT content signals", () => {
	it("returns 'twincat' when .st content contains a Tc* attribute pragma", async () => {
		const root = await makeWorkspace();
		await writeFile(
			join(root, "FB_Drive.st"),
			"{attribute 'TcRpcEnable'}\nFUNCTION_BLOCK FB_Drive\nEND_FUNCTION_BLOCK\n",
			"utf-8",
		);
		expect(await detectVendor(root)).toBe("twincat");
	});

	it("returns 'twincat' when .st content contains Tc2_ library reference", async () => {
		const root = await makeWorkspace();
		await writeFile(
			join(root, "PRG_Main.st"),
			"PROGRAM PRG_Main\nVAR\n  fb : Tc2_System.FB_SysTask;\nEND_VAR\nEND_PROGRAM\n",
			"utf-8",
		);
		expect(await detectVendor(root)).toBe("twincat");
	});

	it("returns 'twincat' when .st content contains Tc3_ library reference", async () => {
		const root = await makeWorkspace();
		await writeFile(
			join(root, "FB_Iot.st"),
			"FUNCTION_BLOCK FB_Iot\nVAR\n  client : Tc3_IotBase.FB_MqttClient;\nEND_VAR\nEND_FUNCTION_BLOCK\n",
			"utf-8",
		);
		expect(await detectVendor(root)).toBe("twincat");
	});

	it("ignores Tc* content in non-.st files (only .st is content-scanned)", async () => {
		// A .exp file with Tc2_ content should NOT trigger TC — the extension
		// alone scores +2 for CODESYS; content is not read for non-.st files.
		const root = await makeWorkspace();
		await writeFile(
			join(root, "GVL.exp"),
			"VAR_GLOBAL\n  lib : Tc2_Utilities.T_MaxString;\nEND_VAR\n",
			"utf-8",
		);
		// .exp is a CODESYS signal (+2). No TC signals. Result: codesys.
		expect(await detectVendor(root)).toBe("codesys");
	});
});

// ── CODESYS: filename signals ───────────────────────────────────────────────

describe("detectVendor: CODESYS filename signals", () => {
	it("returns 'codesys' when a .project file with CodeSysProject XML is present", async () => {
		const root = await makeWorkspace();
		await writeFile(
			join(root, "MyProject.project"),
			'<?xml version="1.0"?><CodeSysProject xmlns="http://www.3s-software.com/schemas/CoDeSysV3"/>',
			"utf-8",
		);
		expect(await detectVendor(root)).toBe("codesys");
	});

	it("returns 'codesys' when a .project file with Project xmlns is present", async () => {
		const root = await makeWorkspace();
		await writeFile(
			join(root, "Lamp.project"),
			'<?xml version="1.0"?><Project xmlns="http://www.3s-software.com/schemas/CoDeSysV3.1"/>',
			"utf-8",
		);
		expect(await detectVendor(root)).toBe("codesys");
	});

	it("returns 'codesys' when a .iecst file is present", async () => {
		const root = await makeWorkspace();
		await writeFile(join(root, "PRG_Main.iecst"), "PROGRAM PRG_Main END_PROGRAM", "utf-8");
		expect(await detectVendor(root)).toBe("codesys");
	});

	it("returns 'codesys' when a .exp file is present", async () => {
		const root = await makeWorkspace();
		await writeFile(join(root, "GVL_Constants.exp"), "VAR_GLOBAL END_VAR", "utf-8");
		expect(await detectVendor(root)).toBe("codesys");
	});
});

// ── CODESYS: content signals ────────────────────────────────────────────────

describe("detectVendor: CODESYS content signals", () => {
	it("returns 'codesys' when .st content contains __POOL", async () => {
		const root = await makeWorkspace();
		await writeFile(
			join(root, "FB_Pool.st"),
			"FUNCTION_BLOCK FB_Pool\nVAR\n  pool : __POOL;\nEND_VAR\nEND_FUNCTION_BLOCK\n",
			"utf-8",
		);
		expect(await detectVendor(root)).toBe("codesys");
	});

	it("returns 'codesys' when .st content contains {attribute 'init_namespace'}", async () => {
		const root = await makeWorkspace();
		await writeFile(
			join(root, "GVL.st"),
			"{attribute 'init_namespace'}\nVAR_GLOBAL\n  g : INT;\nEND_VAR\n",
			"utf-8",
		);
		expect(await detectVendor(root)).toBe("codesys");
	});
});

// ── No signals ─────────────────────────────────────────────────────────────

describe("detectVendor: no signals → undefined", () => {
	it("returns undefined for an empty directory", async () => {
		const root = await makeWorkspace();
		expect(await detectVendor(root)).toBeUndefined();
	});

	it("returns undefined for a workspace with only non-PLC files", async () => {
		const root = await makeWorkspace();
		await writeFile(join(root, "README.md"), "# My Project", "utf-8");
		await writeFile(join(root, "package.json"), "{}", "utf-8");
		await writeFile(join(root, ".gitignore"), "node_modules\n", "utf-8");
		expect(await detectVendor(root)).toBeUndefined();
	});

	it("returns undefined for a .project file with unrelated XML", async () => {
		const root = await makeWorkspace();
		await writeFile(
			join(root, "Visual.project"),
			'<?xml version="1.0"?><VisualStudioProject/>',
			"utf-8",
		);
		// The .project extension is checked for CODESYS XML content.
		// A non-CODESYS project file does NOT score CODESYS points.
		expect(await detectVendor(root)).toBeUndefined();
	});
});

// ── Signal strength / tie-breaking ─────────────────────────────────────────

describe("detectVendor: signal strength", () => {
	it("TC filename signal (+10) beats many CODESYS .iecst files (+2 each)", async () => {
		const root = await makeWorkspace();
		await writeFile(join(root, "FB_Motor.TcPOU"), "<TcPlcObject/>", "utf-8"); // +10 TC
		// Four .iecst files each at +2 = +8 CODESYS — still loses to a single TC file.
		for (let i = 0; i < 4; i++) {
			await writeFile(join(root, `PRG_${i}.iecst`), "PROGRAM P END_PROGRAM", "utf-8");
		}
		expect(await detectVendor(root)).toBe("twincat");
	});

	it("TC content signal beats CODESYS .exp extension signal", async () => {
		const root = await makeWorkspace();
		await writeFile(join(root, "GVL.exp"), "VAR_GLOBAL END_VAR", "utf-8"); // +2 CODESYS
		await writeFile(
			join(root, "FB.st"),
			"{attribute 'TcLinkTo' := '%I*'}\n{attribute 'TcContextId' := '1'}\nFUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK\n",
			"utf-8",
		); // +4 TC (2 Tc* pragma matches × 2)
		expect(await detectVendor(root)).toBe("twincat");
	});

	it("scans subdirectories up to maxDepth", async () => {
		const root = await makeWorkspace();
		// Place TC file 2 levels deep (within default maxDepth=3).
		const deep = join(root, "PLC", "POUs");
		await mkdir(deep, { recursive: true });
		await writeFile(join(deep, "FB_Motor.TcPOU"), "<TcPlcObject/>", "utf-8");
		expect(await detectVendor(root)).toBe("twincat");
	});

	it("respects maxDepth option — does NOT find files beyond the limit", async () => {
		const root = await makeWorkspace();
		// Place TC file 4 levels deep, but maxDepth is 1.
		const deep = join(root, "a", "b", "c", "d");
		await mkdir(deep, { recursive: true });
		await writeFile(join(deep, "FB.TcPOU"), "<TcPlcObject/>", "utf-8");
		expect(await detectVendor(root, { maxDepth: 1 })).toBeUndefined();
	});
});
