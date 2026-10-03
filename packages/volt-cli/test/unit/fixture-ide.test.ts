/**
 * The e2e harness's safety rule, offline: it drives ONLY a pipe an `ide.ps1` instance provably started on a fixture
 * COPY (`test/e2e/lib/fixture-ide.ts`). Measured cause (2026-10-03): prefix discovery made `vendor-parity` create and
 * delete `VltE2E_par_*` items in an engineer's 881-item project. Every case here is a machine state, as facts.
 */
import { describe, expect, it } from "bun:test"
import { FixtureRefusal, resolveFixturePipes, type Facts, type InstanceRecord, type Proc } from "../e2e/lib/fixture-ide"

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
