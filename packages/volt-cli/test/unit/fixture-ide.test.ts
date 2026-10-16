/**
 * The e2e harness's safety rule, offline: it drives ONLY a pipe an `ide.ps1` instance provably started on a fixture
 * COPY (`test/e2e/lib/fixture-ide.ts`). Measured cause (2026-10-03): prefix discovery made `vendor-parity` create and
 * delete `VltE2E_par_*` items in an engineer's 881-item project. Every case here is a machine state, as facts.
 *
 * The same module is the rule for every SCRIPT that drives a bridge (probes, `corpus-migration.ts`, the LSP recorders):
 * `resolveOnePipe` narrows it to exactly one pipe — the "first of several" was the other half of the same bug.
 */
import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bitnessOf, compileTempEnv, e2eReport, FixtureRefusal, ideLine, resolveFixturePipes, resolveOnePipe, vendorOf, type Facts, type InstanceRecord, type Proc } from "../e2e/lib/fixture-ide"

const TEMP = "C:\\Users\\eng\\AppData\\Local\\Temp"
const T0 = "638900000000000000" // .NET ticks — beyond 2^53, so they stay strings

function facts(vendor: "codesys" | "twincat", procs: Proc[], instances: InstanceRecord[], pipes: string[]): Facts {
	return { vendor, pipes, procs: new Map(procs.map((p) => [p.pid, p])), instances, tempDir: TEMP }
}

// The engineer's own CODESYS (39448), opened by hand on a real project, and ours (5100) from `ide.ps1 up -Instance
// e2e-hygiene`, which CODESYS re-exec'd from the launched 5000.
const engineer: Proc = { pid: 39448, ppid: 1200, ticks: "638800000000000000", name: "CODESYS.exe", title: "Customer881.project - CODESYS" }
const launched: Proc = { pid: 5000, ppid: 4000, ticks: T0, name: "CODESYS.exe" }
const reexec: Proc = { pid: 5100, ppid: 5000, ticks: "638900000000100000", name: "CODESYS.exe", title: "CodesysTestProject.project - CODESYS" }
const ours: InstanceRecord = {
	instance: "e2e-hygiene",
	records: [{ pid: 5000, ticks: T0 }],
	projects: [`${TEMP}\\volt-ide-codesys-e2e-hygiene\\CodesysTestProject.project`],
}
const PIPES = ["volt.bridge.codesys.39448", "volt.bridge.codesys.5100", "volt.bridge.twincat.777", "other.pipe"]

describe("e2e fixture-IDE resolver", () => {
	it("accepts the instance's own pipe (served by the IDE its launch re-exec'd into) and never the foreign one", () => {
		const f = facts("codesys", [engineer, launched, reexec], [ours], PIPES)
		expect(resolveFixturePipes(f, { instance: "e2e-hygiene" })).toEqual(["volt.bridge.codesys.5100"])
	})

	it("refuses when the instance serves nothing — naming the foreign pipe and its project, never falling back to it", () => {
		const f = facts("codesys", [engineer, launched], [ours], ["volt.bridge.codesys.39448"])
		const run = () => resolveFixturePipes(f, { instance: "e2e-hygiene" })
		expect(run).toThrow(FixtureRefusal)
		expect(run).toThrow(/no fixture IDE for instance 'e2e-hygiene'.*refusing to touch.*volt\.bridge\.codesys\.39448 \(project Customer881\.project/)
	})

	it("refuses an instance ide.ps1 has no record of, even with a single pipe up", () => {
		const f = facts("codesys", [engineer], [], ["volt.bridge.codesys.39448"])
		expect(() => resolveFixturePipes(f, { instance: "" })).toThrow(/no fixture IDE for instance \(default\).*39448/)
	})

	it("refuses an explicit VOLT_PIPE that no fixture instance owns", () => {
		const f = facts("codesys", [engineer, launched, reexec], [ours], PIPES)
		expect(() => resolveFixturePipes(f, { instance: "", explicit: "volt.bridge.codesys.39448" })).toThrow(
			/refusing to touch volt\.bridge\.codesys\.39448/,
		)
	})

	it("accepts an explicit VOLT_PIPE that a fixture instance owns", () => {
		const f = facts("codesys", [engineer, launched, reexec], [ours], PIPES)
		expect(resolveFixturePipes(f, { instance: "", explicit: "volt.bridge.codesys.5100" })).toEqual(["volt.bridge.codesys.5100"])
	})

	it("refuses a prefix as VOLT_PIPE — a prefix is discovery", () => {
		const f = facts("codesys", [engineer, launched, reexec], [ours], PIPES)
		expect(() => resolveFixturePipes(f, { instance: "", explicit: "volt.bridge.codesys" })).toThrow(/exact/)
	})

	it("refuses a recorded pid whose start time no longer matches (the pid was reused by a stranger)", () => {
		const reused: Proc = { ...engineer, pid: 5000, ppid: 1200 }
		const f = facts("codesys", [reused], [ours], ["volt.bridge.codesys.5000"])
		expect(() => resolveFixturePipes(f, { instance: "e2e-hygiene" })).toThrow(/not started by ide\.ps1 instance/)
	})

	it("refuses an instance that served the committed tree in place (-InPlace) — it is not a fixture COPY", () => {
		const inPlace = { ...ours, projects: ["C:\\repo\\packages\\volt-cli\\test\\fixtures\\CodesysTestProject.project"] }
		const f = facts("codesys", [launched, reexec], [inPlace], ["volt.bridge.codesys.5100"])
		expect(() => resolveFixturePipes(f, { instance: "e2e-hygiene" })).toThrow(/not a copy under/)
	})

	it("does not let the default instance claim another instance's copy (the root ends in a separator)", () => {
		const def = { ...ours, instance: "" }
		const f = facts("codesys", [launched, reexec], [def], ["volt.bridge.codesys.5100"])
		expect(() => resolveFixturePipes(f, { instance: "" })).toThrow(/not a copy under/)
	})

	it("twincat: the XAE must itself be open on a .sln under the instance's copy", () => {
		const root = `${TEMP}\\volt-ide-twincat-x`
		const inst: InstanceRecord = { instance: "x", records: [{ pid: 777, ticks: T0 }], projects: [`${root}\\P13\\P13.sln`] }
		const xae = (cmd: string): Proc => ({ pid: 777, ppid: 1, ticks: T0, name: "TcXaeShell.exe", commandLine: cmd })
		const ok = facts("twincat", [xae(`"C:\\XAE\\TcXaeShell.exe" "${root}\\P13\\P13.sln"`)], [inst], PIPES)
		expect(resolveFixturePipes(ok, { instance: "x" })).toEqual(["volt.bridge.twincat.777"])
		const foreign = facts("twincat", [xae(`"C:\\XAE\\TcXaeShell.exe" "D:\\Customer\\Line4.sln"`)], [inst], PIPES)
		expect(() => resolveFixturePipes(foreign, { instance: "x" })).toThrow(/refusing to touch.*Line4\.sln/)
	})
})

describe("script pipe resolver (one pipe, never the first of several)", () => {
	const root = `${TEMP}\\volt-ide-twincat`
	const xae = (pid: number, sln: string): Proc => ({
		pid,
		ppid: 1,
		ticks: T0,
		name: "TcXaeShell.exe",
		commandLine: `"C:\\XAE\\TcXaeShell.exe" "${root}\\${sln}\\${sln}.sln"`,
	})
	// `ide.ps1 up -Vendor twincat -Fixture both`: Project13 (x64) and Project14 (ARM, 32-bit).
	const both: InstanceRecord = {
		instance: "",
		records: [
			{ pid: 701, ticks: T0 },
			{ pid: 702, ticks: T0 },
		],
		projects: [`${root}\\P13\\P13.sln`, `${root}\\P14\\P14.sln`],
	}
	const pipes = ["volt.bridge.twincat.701", "volt.bridge.twincat.702"]

	it("returns the instance's single pipe", () => {
		const f = facts("codesys", [engineer, launched, reexec], [ours], PIPES)
		expect(resolveOnePipe(f, { instance: "e2e-hygiene" })).toBe("volt.bridge.codesys.5100")
	})

	it("refuses an instance serving two projects instead of taking the first, naming both", () => {
		const f = facts("twincat", [xae(701, "P13"), xae(702, "P14")], [both], pipes)
		const run = () => resolveOnePipe(f, { instance: "" })
		expect(run).toThrow(FixtureRefusal)
		expect(run).toThrow(/serves 2 fixture pipes.*P13\.sln.*P14\.sln.*VOLT_PIPE/)
	})

	it("an exact VOLT_PIPE the instance owns picks one of them", () => {
		const f = facts("twincat", [xae(701, "P13"), xae(702, "P14")], [both], pipes)
		expect(resolveOnePipe(f, { instance: "", explicit: "volt.bridge.twincat.702" })).toBe("volt.bridge.twincat.702")
	})

	it("keeps every refusal of the rule underneath (a foreign VOLT_PIPE)", () => {
		const f = facts("codesys", [engineer, launched, reexec], [ours], PIPES)
		expect(() => resolveOnePipe(f, { instance: "", explicit: "volt.bridge.codesys.39448" })).toThrow(/refusing to touch/)
	})

	it("refuses an unknown vendor rather than defaulting", () => {
		expect(vendorOf(undefined)).toBe("codesys")
		expect(vendorOf("twincat")).toBe("twincat")
		expect(() => vendorOf("beckhoff")).toThrow(FixtureRefusal)
	})
})

/**
 * WHICH BITNESS A RUN MEASURED (environment-dependency-audit 2.6): the dev machine runs 64-bit AND 32-bit CODESYS
 * (3.5.21.60 under Program Files (x86)), and a run that does not say which it drove cannot be a matrix cell. Read from
 * the IDE process's modules as a 64-bit reader sees them: a WOW64 (32-bit) process carries `wow64.dll`, a 64-bit one
 * never does (DIALECT V5: a 64-bit reader sees only the WOW64 layer of the 32-bit TcXaeShell).
 */
describe("ide bitness", () => {
	it("a process with the WOW64 layer is 32-bit", () => {
		expect(bitnessOf(["TcXaeShell.exe", "ntdll.dll", "wow64.dll", "wow64base.dll", "wow64con.dll", "wow64win.dll", "wow64cpu.dll"])).toBe(32)
	})
	it("a process without it is 64-bit", () => {
		expect(bitnessOf(["CODESYS.exe", "ntdll.dll", "KERNEL32.DLL", "clr.dll"])).toBe(64)
	})
	it("the module name is matched without regard to case", () => {
		expect(bitnessOf(["CODESYS.exe", "WOW64.DLL"])).toBe(32)
	})
	it("no modules at all is no answer, never a guess", () => {
		expect(() => bitnessOf([])).toThrow(FixtureRefusal)
	})
})

/** Windows PowerShell's Add-Type (csc) cannot write into a folder the ANSI code page cannot spell (measured with a
 *  Cyrillic TEMP, environment-dependency-audit 2.5): a child that compiles gets an ASCII TEMP, nothing else changes. */
describe("compile temp", () => {
	// Real Windows path shapes (gate 2c+3 review: single backslashes in a plain literal made these "C:UsersengAppData…").
	// The replacement folder is created under a scratch ProgramData, never the machine's %ProgramData%.
	it("an ASCII TEMP is kept", () => {
		const env = { TEMP: "C:\\Users\\eng\\AppData\\Local\\Temp", ProgramData: "C:\\ProgramData" }
		expect(env.TEMP.split("\\")).toEqual(["C:", "Users", "eng", "AppData", "Local", "Temp"])
		expect(compileTempEnv(env)).toBe(env)
	})
	// win32.join of a POSIX scratch path is no folder on Linux; the product is Windows-only (csc).
	it.skipIf(process.platform !== "win32")("a non-ASCII TEMP is replaced by an ASCII folder for the child", () => {
		const scratch = mkdtempSync(join(tmpdir(), "volt-compile-temp-"))
		try {
			const temp = "C:\\Users\\Тест\\AppData\\Local\\Temp"
			const env = { TEMP: temp, TMP: temp, ProgramData: scratch }
			const out = compileTempEnv(env)
			expect(out.TEMP).toBe(`${scratch}\\volt-ide-compile`)
			expect(out.TMP).toBe(out.TEMP)
			expect(existsSync(out.TEMP!)).toBe(true)
		} finally {
			rmSync(scratch, { recursive: true, force: true })
		}
	})
	it("no ASCII folder at all is refused by name", () => {
		const temp = "C:\\Users\\Тест\\AppData\\Local\\Temp"
		expect(() => compileTempEnv({ TEMP: temp, ProgramData: "C:\\Данные" })).toThrow(FixtureRefusal)
	})
})

/**
 * WHAT A RUN REPORTS IT DROVE (gate 2c+3 review). The release matrix judges a cell by this report, so it is refused
 * when a fact is missing — never written with a `?`/null in its place. The console line is only a log: a bitness that
 * cannot be read there (an IDE run elevated, whose modules a non-elevated reader is denied) is named, and the run goes
 * on; only a run that must REPORT (VOLT_E2E_REPORT, the matrix) stops on it.
 */
describe("e2e report", () => {
	const health = { productName: "CODESYS", productVersion: "3.5.21.60", ideVersion: "3.5.21.60" }
	it("carries the IDE the run drove", () => {
		expect(e2eReport("codesys", "P", "volt.bridge.codesys.42", health, 32)).toEqual({
			vendor: "codesys", project: "P", pipe: "volt.bridge.codesys.42", bits: 32,
			productName: "CODESYS", productVersion: "3.5.21.60", ideVersion: "3.5.21.60",
		})
	})
	it("a fact health does not state is refused by name, never written as null", () => {
		expect(() => e2eReport("codesys", "P", "p", { ...health, ideVersion: undefined }, 64)).toThrow(/ideVersion/)
		expect(() => e2eReport("codesys", "P", "p", { productVersion: "1", ideVersion: "1" }, 64)).toThrow(/productName/)
	})
	it("an unreadable bitness is refused for the report", () => {
		expect(() => e2eReport("codesys", "P", "p", health, new FixtureRefusal("could not read the modules of pid 42: Access is denied"))).toThrow(/Access is denied/)
	})
	it("the console line names what is missing or unreadable instead of a placeholder", () => {
		expect(ideLine(health, 64)).toBe("CODESYS 3.5.21.60, platform 3.5.21.60, 64-bit")
		expect(ideLine({ productName: "CODESYS" }, new FixtureRefusal("Access is denied"))).toBe(
			"CODESYS, health states no productVersion, ideVersion; bitness unreadable (Access is denied)")
	})
})
