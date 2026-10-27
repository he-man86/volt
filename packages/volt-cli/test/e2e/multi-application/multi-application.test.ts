import { landed } from "../harness"
/**
 * EVERY APPLICATION OF A PROJECT, EACH UNDER ITS OWN PATH — openspec `multi-application-tree` 2.1, against a live IDE.
 *
 * <p>The item's identity is its PATH in the IDE's own tree (design.md): the wire keys `refs`, `fetch` and every push op
 * by `<folder>/<name>.<kind>`, so two `PLC_PRG.pou` in two applications are two items. Measured 2026-10-17 before the
 * change: CODESYS returns ONE `PLC_PRG.pou` (Device_1's; Device's application is missing), TwinCAT returns the first PLC
 * project of the selected system project and nothing of the other three.</p>
 *
 * <p>The fixtures: on CODESYS every `test/fixtures/CodesysTestProject.<version>.project` — the project the release matrix
 * serves on each version — carries two devices, each with an application holding the same names (PLC_PRG, MainTask,
 * VltFixtureCfc/Members/Sfc), as does `test/fixtures/CodesysTwoDevices.3.5.21.40.project`; on TwinCAT
 * `test/fixtures/TwinCAT MultiProject/` (system project `TwinCAT Project14` with PLC projects Untitled2, Untitled1,
 * Untitled3; system project `TwinCAT Project1` with Untitled1). The suite is skipped against any other fixture.</p>
 *
 * <pre>
 *   powershell -File scripts/ide.ps1 up -Vendor codesys -Instance multi-app -CodesysVersion 3.5.21.40 -Wait
 *   VOLT_E2E_INSTANCE=multi-app VOLT_VENDOR=codesys bun test test/e2e/multi-application
 *   powershell -File scripts/ide.ps1 up -Vendor twincat -Instance multi-app -Fixture "test/fixtures/TwinCAT MultiProject/TwinCAT MultiProject.sln" -Wait
 *   VOLT_E2E_INSTANCE=multi-app VOLT_VENDOR=twincat bun test test/e2e/multi-application
 * </pre>
 */
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test"
import { basename } from "node:path"
import { bridge } from "../lib/bridge"
import { E2E_INSTANCE, readInstances } from "../lib/fixture-ide"
import { BASE, VENDOR } from "../lib/pipe"
import { servedSolutionDir } from "../lib/tc-files"
import { landedInFull, requireHealthy } from "../lib/workspace"

setDefaultTimeout(600_000)

const lf = (s: string) => s.replace(/\r\n/g, "\n")

/** Each application's main program, by its path, and the items every application must hold under its own path.
 *  `buildErrors`: the fixture's own build errors, each as `<item path> :: <message>` (`-` for no item). `tasks`: the task
 *  of each application in `applications`' order. */
type Expected = {
	/** CODESYS: the devices the fixture's descriptors name, each holding one application (TwinCAT: none). */
	devices: string[]
	mains: string[]
	items: string[]
	applications: string[]
	tasks: string[]
	project: string
	buildErrors: string[]
	compiled: string[]
}

/** TwinCAT's closing line of a failed whole build, up to the OS's own (localized) words for the failure. */
const FAILED_BUILD_LINE = "Error: The operation could not be completed."

/** The CODESYS project the served IDE OPENED, by its file's base name (`CodesysTestProject.3.5.21.40`), read from the
 *  `ide.ps1` instance's record — not from the wire under test. */
function openedCodesysProject(): string | undefined {
	const inst = readInstances("codesys").find((i) => i.instance === E2E_INSTANCE)
	const opened = (inst?.projects ?? []).filter((p) => /\.project$/i.test(p))
	return opened.length === 1 ? basename(opened[0]!).replace(/\.project$/i, "") : undefined
}

/** The CODESYS fixtures of two devices: every version's CodesysTestProject, and CodesysTwoDevices. */
const isCodesysMultiAppFixture = (project: string) => /^(CodesysTestProject|CodesysTwoDevices)\.\d+\.\d+\.\d+\.\d+$/.test(project)

/** The devices a CODESYS fixture holds, read from its device descriptors (`<device>/<device>.device`) — the devices'
 *  names are the owner's; that there are TWO, each with one application holding the same items, is the fixture fact. */
const DEVICES = 2

function codesysExpected(project: string, items: Record<string, unknown>): Expected {
	const app = (d: string) => `${d}/Plc Logic/Application`
	const devices = Object.keys(items)
		.map((p) => /^([^/]+)\/([^/]+)\.device$/.exec(p))
		.filter((m): m is RegExpExecArray => m !== null && m[1] === m[2])
		.map((m) => m[1]!)
	// The task's folder is the IDE's own tree node, and its name is the version's: `Task Configuration` from SP21 on,
	// `TaskConfiguration` on 3.5.18.30. So the task is read where the tree puts it — the one `MainTask.task` in the
	// application — and a missing one is spelled so that `refs holds every item` names it.
	const taskOf = (d: string) => {
		const found = Object.keys(items).filter((p) => p.startsWith(`${app(d)}/`) && p.endsWith("/MainTask.task"))
		return found.length === 1 ? found[0]! : `${app(d)}/<one task configuration, found ${found.length}>/MainTask.task`
	}
	return {
		project,
		devices,
		// Measured 2026-10-17 (SP21 Patch 4, CodesysTwoDevices) and 2026-10-18 (each CodesysTestProject): both
		// applications compile clean although they declare the same names.
		buildErrors: [],
		compiled: devices.map((d) => `${app(d)}/PLC_PRG.pou`),
		applications: devices.map(app),
		tasks: devices.map(taskOf),
		mains: devices.map((d) => `${app(d)}/PLC_PRG.pou`),
		items: devices.flatMap((d) => [
			`${d}/${d}.device`,
			`${app(d)}/PLC_PRG.pou`,
			`${app(d)}/VltFixtureCfc.pou`,
			`${app(d)}/VltFixtureMembers.pou`,
			`${app(d)}/VltFixtureSfc.pou`,
			taskOf(d),
		]),
	}
}

const TWINCAT: Expected = (() => {
	const plc = (sys: string, p: string) => `${sys}/PLC/${p}/${p} Project`
	const P14 = "TwinCAT Project14"
	const P1 = "TwinCAT Project1"
	const mains = [
		`${plc(P14, "Untitled2")}/PLC_PRG.pou`,
		`${plc(P14, "Untitled1")}/POUs/PLC_PRG.pou`,
		`${plc(P14, "Untitled3")}/POUs/MAIN.pou`,
		`${plc(P1, "Untitled1")}/POUs/MAIN.pou`,
	]
	const plcs = [plc(P14, "Untitled2"), plc(P14, "Untitled1"), plc(P14, "Untitled3"), plc(P1, "Untitled1")]
	return {
		project: "TwinCAT MultiProject",
		devices: [],
		// Measured 2026-10-17 (4024.74): Untitled1's task calls MAIN, which that PLC project does not hold (design §9) —
		// an error on that task, as CODESYS names the same fault; nothing else, although the four PLC projects repeat
		// PLC_PRG / MAIN / PlcTask.
		// And the failed whole build's own closing line, naming no item (measured 2026-10-24 on the same XAE; carried since
		// wire-final-shape 3.6). Its tail is the OS's words for E_FAIL, in the OS's language — `errorsOf` keeps the head.
		buildErrors: [
			`${plc(P14, "Untitled1")}/PlcTask.task :: Identifier 'MAIN' not defined`,
			`${plc(P14, "Untitled1")}/PlcTask.task :: Program name, function or function block instance expected instead of 'MAIN'`,
			`- :: ${FAILED_BUILD_LINE}`,
		],
		// The mains a task calls. Untitled1's task calls MAIN, so nothing calls its PLC_PRG, and a POU no task calls is not
		// compiled on either vendor ("a POU no task calls is not compiled" below) — a fault in it is in no build.
		compiled: mains.filter((m) => !m.startsWith(`${plc(P14, "Untitled1")}/`)),
		applications: plcs,
		tasks: plcs.map((p) => `${p}/PlcTask.task`),
		mains,
		items: [
			`${P14}/${P14}.device`,
			`${P1}/${P1}.device`,
			...mains,
			...plcs.map((p) => `${p}/PlcTask.task`),
			`${plc(P14, "Untitled2")}/POUs/POUexecute.pou`,
			`${plc(P14, "Untitled2")}/DUTs/E_PackML_Mode.dut`,
			`${plc(P14, "Untitled2")}/GVLs/GVL_PackML.gvl`,
		],
	}
})()

/** Is the served IDE holding one of the multi-application fixtures? Read from what was OPENED, not from the wire under
 *  test: CODESYS's project file (the `ide.ps1` instance's record), TwinCAT's XAE was launched on the solution's `.sln`. */
function servesMultiAppFixture(): boolean {
	try {
		if (VENDOR === "codesys") {
			const opened = openedCodesysProject()
			return opened !== undefined && isCodesysMultiAppFixture(opened)
		}
		return basename(servedSolutionDir()) === "TwinCAT MultiProject"
	} catch {
		return false
	}
}

const served = servesMultiAppFixture()
if (!served)
	console.warn(`[multi-application] ${BASE} serves no CodesysTestProject/CodesysTwoDevices nor TwinCAT MultiProject — skipped (see the header)`)
/** Set in `beforeAll`: CODESYS's devices are read from the fixture's descriptors once the IDE serves. */
let expected: Expected = TWINCAT

/** What of `want` a version map lacks — named in the failure, so a red run says which application went missing. */
const missing = (map: Record<string, unknown>, want: string[]) => want.filter((p) => !(p in map))

describe.skipIf(!served)(`multi-application tree / ${VENDOR} (${BASE})`, () => {
	beforeAll(async () => {
		await requireHealthy(300_000)
		if (VENDOR === "codesys") expected = codesysExpected(openedCodesysProject()!, (await bridge.refs()).items ?? {})
	})

	it(`the fixture's ${VENDOR === "codesys" ? `${DEVICES} devices are` : "system projects are"} all walked`, () => {
		if (VENDOR === "codesys") expect(expected.devices, "device descriptors in refs").toHaveLength(DEVICES)
		expect(expected.applications.length).toBeGreaterThan(1)
	})

	it("refs holds every item of every application under its own path", async () => {
		const r = await bridge.refs()
		const items = r.items ?? {}
		expect(missing(items, expected.items), `refs keys (${Object.keys(items).length}): ${Object.keys(items).filter((k) => !k.endsWith(".library")).join(", ")}`).toEqual([])
	})

	it("a pull (fetch init) holds every item of every application under its own path", async () => {
		const f = await bridge.init()
		const pulled: Record<string, string> = {}
		for (const c of f.changed ?? []) pulled[c.name] = c.sourceText
		expect(missing(pulled, expected.items), `pulled names: ${Object.keys(pulled).filter((k) => !k.endsWith(".library")).join(", ")}`).toEqual([])
		// One file per application: the main programs are distinct items, read from their own application.
		expect(new Set(expected.mains.map((m) => pulled[m] !== undefined)).has(false)).toBe(false)
	})

	describe("an edit in each application round-trips to that application only", () => {
		const original: Record<string, string> = {}
		const marker = (path: string) => `// VltE2E multi-application: ${path}`

		afterAll(async () => {
			// Restore what was read, so a second run starts from the fixture; a path never read is left alone.
			const paths = Object.keys(original)
			if (paths.length === 0) return
			const refs = await bridge.refs()
			const ops = paths
				.filter((p) => refs.items?.[p])
				.map((p) => ({ op: "set", name: p, sourceText: original[p], ifVersion: refs.items[p] }))
			if (ops.length) await bridge.push({ expectedProjectVersion: refs.projectVersion, ops })
		})

		it("each main program is fetched by its path", async () => {
			const f = await bridge.fetch({ knownItems: {}, onlyItems: expected.mains })
			for (const c of f.changed ?? []) if (expected.mains.includes(c.name)) original[c.name] = lf(c.sourceText)
			expect(missing(original, expected.mains), `fetched: ${(f.changed ?? []).map((c: any) => `${c.folder ?? ""} :: ${c.name}`).join(", ")}`).toEqual([])
		})

		it("a push to each path lands in that application and no other", async () => {
			expect(missing(original, expected.mains), "the main programs were not all read (previous test)").toEqual([])
			const refs = await bridge.refs()
			const ops = expected.mains.map((p) => ({
				op: "set",
				name: p,
				sourceText: original[p]!.replace(/^%LANGUAGE ST$/m, `%LANGUAGE ST\n${marker(p)}`),
				ifVersion: refs.items?.[p] ?? null,
			}))
			const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops })
			expect(landedInFull(r), `push: ${JSON.stringify(r.conflicts ?? r).slice(0, 600)}`).toBe(true)

			const back = await bridge.fetch({ knownItems: {}, onlyItems: expected.mains })
			const text: Record<string, string> = {}
			for (const c of back.changed ?? []) text[c.name] = lf(c.sourceText)
			for (const p of expected.mains) {
				expect(text[p], `${p} not fetched back`).toBeDefined()
				expect(text[p]!, `${p} lost its own edit`).toContain(marker(p))
				for (const other of expected.mains.filter((o) => o !== p))
					expect(text[p]!, `${p} holds the edit meant for ${other}`).not.toContain(marker(other))
			}
		})
	})

	// §3: an application is STATED by the bridge, never parsed out of a path by a client.
	it("refs and fetch state every application by its root path", async () => {
		const r = await bridge.refs()
		expect([...(r.applications ?? [])].sort()).toEqual([...expected.applications].sort())
		const f = await bridge.fetch({ knownItems: {}, onlyItems: [expected.mains[0]!] })
		expect([...(f.applications ?? [])].sort()).toEqual([...expected.applications].sort())
	})

	// §7: one IDE window is one bound project — the CODESYS `.project`, the TwinCAT solution — whatever it holds.
	it("health lists the IDE as one project, named after what was opened", async () => {
		const h = await bridge.health()
		expect((h.projects ?? []).map((p: any) => p.project)).toEqual([expected.project])
	})

	// §5/§9: a move pairs only within one application; a `to` in another application reaching the bridge is refused per
	// op, BAD_REQUEST naming both applications, before anything is applied.
	it("a move into another application is refused, naming both, and changes nothing", async () => {
		const [from, other] = expected.mains
		const refs = await bridge.refs()
		const to = `${expected.applications.find((a) => !from!.startsWith(`${a}/`) && other!.startsWith(`${a}/`))}/VltE2EMoved.pou`
		const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "set", name: from, to, ifVersion: refs.items[from!] }] })
		expect(landed(r), JSON.stringify(r)).toBe(false)
		const c = (r.conflicts ?? []).find((x: any) => x.name === from)
		expect(c?.code, JSON.stringify(r.conflicts)).toBe("BAD_REQUEST")
		for (const app of expected.applications.filter((a) => from!.startsWith(`${a}/`) || to.startsWith(`${a}/`)))
			expect(String(c.reason), String(c.reason)).toContain(app)
		const after = await bridge.refs()
		expect(after.projectVersion).toBe(refs.projectVersion)
	})

	/** A build's errors as `<item path> :: <message>` (`-` for none) — the name is compared, not only the message: a
	 *  fault both vendors give must land on the same item on the wire. */
	const errorsOf = (r: any): string[] =>
		(r.diagnostics ?? []).filter((d: any) => d.severity === "error")
			.map((d: any) => `${d.name ?? "-"} :: ${d.message.startsWith(FAILED_BUILD_LINE) ? FAILED_BUILD_LINE : d.message}`).sort()
	/** The application a path lies in: the longest stated root it is under. */
	const applicationOf = (path: string) =>
		expected.applications.filter((a) => path.startsWith(`${a}/`)).sort((a, b) => b.length - a.length)[0]!

	/** Push `ops` against the current refs; an op's `ifVersion: "current"` is the item's version now. */
	async function pushNow(ops: any[]) {
		const refs = await bridge.refs()
		for (const o of ops) if (o.ifVersion === "current") o.ifVersion = refs.items?.[o.name] ?? null
		return bridge.push({ expectedProjectVersion: refs.projectVersion, ops })
	}

	/** Put back what a test changed: each edited path's original text, each created path deleted (one that is not there
	 *  any more is skipped). */
	async function restore(original: Record<string, string>, created: string[]) {
		const refs = await bridge.refs()
		const ops = [
			...Object.keys(original).filter((p) => refs.items?.[p]).map((p) => ({ op: "set", name: p, sourceText: original[p], ifVersion: refs.items[p] })),
			...created.filter((p) => refs.items?.[p]).map((p) => ({ op: "deleteItem", name: p, ifVersion: refs.items[p] })),
		]
		if (ops.length) await bridge.push({ expectedProjectVersion: refs.projectVersion, ops })
	}

	it("the fixture builds with only its own known errors", async () => {
		const r = await bridge.build()
		expect(errorsOf(r), JSON.stringify(r.diagnostics)).toEqual([...expected.buildErrors].sort())
	})

	// §8's oracle, measured on both vendors 2026-10-17: each application is its own scope. The same global declared in two
	// applications is two globals — no ambiguity — and a function block another application holds is an unknown type.
	describe("each application is its own scope", () => {
		const original: Record<string, string> = {}
		const created: string[] = []
		afterAll(() => restore(original, created))

		it("the same global in two applications is no conflict; another application's FB is an unknown type", async () => {
			const [mainA, mainB] = expected.compiled as [string, string]
			const [appA, appB] = [applicationOf(mainA), applicationOf(mainB)]
			expect(appA).not.toBe(appB)
			const f = await bridge.fetch({ knownItems: {}, onlyItems: [mainA, mainB] })
			for (const c of f.changed ?? []) original[c.name] = lf(c.sourceText)
			expect(missing(original, [mainA, mainB])).toEqual([])
			const gvl = "VAR_GLOBAL\n\tgVltShared : INT;\nEND_VAR\n"
			const fbA = `${appA}/VltE2EOnlyA.pou`
			created.push(`${appA}/VltE2EShared.gvl`, `${appB}/VltE2EShared.gvl`, fbA)
			const pushed = await pushNow([
				{ op: "set", name: `${appA}/VltE2EShared.gvl`, sourceText: gvl, ifVersion: null },
				{ op: "set", name: `${appB}/VltE2EShared.gvl`, sourceText: gvl, ifVersion: null },
				{ op: "set", name: fbA, sourceText: "FUNCTION_BLOCK VltE2EOnlyA\nVAR\n\tx : INT;\nEND_VAR\n%LANGUAGE ST\nx := x + 1;\nEND_FUNCTION_BLOCK\n", ifVersion: null },
				{ op: "set", name: mainA, sourceText: original[mainA]!.replace(/^%LANGUAGE ST$/m, "%LANGUAGE ST\ngVltShared := 1;"), ifVersion: "current" },
				{
					op: "set",
					name: mainB,
					sourceText: original[mainB]!.replace(/^VAR$/m, "VAR\n\tvltCross : VltE2EOnlyA;").replace(/^%LANGUAGE ST$/m, "%LANGUAGE ST\ngVltShared := 2;"),
					ifVersion: "current",
				},
			])
			expect(landedInFull(pushed), JSON.stringify(pushed.conflicts ?? pushed).slice(0, 600)).toBe(true)

			const r = await bridge.build()
			expect(errorsOf(r), JSON.stringify(r.diagnostics)).toEqual([...expected.buildErrors, `${mainB} :: Unknown type: 'VltE2EOnlyA'`].sort())
			// CODESYS states the code (TwinCAT writes none): the LSP's `Unknown type` is the same C0077.
			if (VENDOR === "codesys") expect(r.diagnostics.find((d: any) => d.name === mainB)?.code).toBe("C0077")
		})
	})

	// Measured on both vendors 2026-10-17: a task that calls a program its application does not hold is an error ON THE
	// TASK — the same two messages, the same item path on the wire.
	it("a task calling a program its application does not hold is an error on that task", async () => {
		const task = expected.tasks[expected.applications.indexOf(applicationOf(expected.compiled[0]!))]!
		const f = await bridge.fetch({ knownItems: {}, onlyItems: [task] })
		const text = lf(f.changed?.find((c: any) => c.name === task)?.sourceText ?? "")
		expect(text).toMatch(/^Calls:/m)
		try {
			const pushed = await pushNow([{ op: "set", name: task, sourceText: text.replace(/^Calls:.*$/m, "Calls:     VltE2ENoSuchProgram"), ifVersion: "current" }])
			expect(landedInFull(pushed), JSON.stringify(pushed.conflicts ?? pushed).slice(0, 600)).toBe(true)
			const r = await bridge.build()
			expect(errorsOf(r), JSON.stringify(r.diagnostics)).toEqual(
				[
					...expected.buildErrors,
					`${task} :: Identifier 'VltE2ENoSuchProgram' not defined`,
					`${task} :: Program name, function or function block instance expected instead of 'VltE2ENoSuchProgram'`,
				].sort(),
			)
		} finally {
			await restore({ [task]: text }, [])
		}
	})

	// Measured on both vendors 2026-10-17: the build compiles what a task reaches. A fault in a POU no task calls is in no
	// build — which is why `compiled` leaves out a main program its own task does not call.
	it("a POU no task calls is not compiled", async () => {
		const p = `${applicationOf(expected.compiled[0]!)}/VltE2EUncalled.pou`
		try {
			const pushed = await pushNow([
				{ op: "set", name: p, sourceText: "PROGRAM VltE2EUncalled\nVAR\n\tn : INT;\nEND_VAR\n%LANGUAGE ST\nzzVltMultiApp := 1;\nEND_PROGRAM\n", ifVersion: null },
			])
			expect(landedInFull(pushed), JSON.stringify(pushed.conflicts ?? pushed).slice(0, 600)).toBe(true)
			const r = await bridge.build()
			expect(errorsOf(r), JSON.stringify(r.diagnostics)).toEqual([...expected.buildErrors].sort())
		} finally {
			await restore({}, [p])
		}
	})

	// §6: `build` compiles EVERY application, and a diagnostic carries its item's path — the same fault in each main
	// program is one diagnostic per application, never one folded across them.
	describe("build compiles every application", () => {
		const original: Record<string, string> = {}
		const token = "zzVltMultiApp"
		const undefinedHere = (r: any) =>
			// The compiler's "not defined" error alone (CODESYS also says C0018 about the same line), as build-diagnostics.test.ts.
			(r.diagnostics ?? []).filter((d: any) => d.severity === "error" &&
				(d.code !== undefined ? d.code === "C0046" : d.message === `Identifier '${token}' not defined`) && String(d.message).includes(`'${token}'`))

		afterAll(() => restore(original, []))

		it("the same fault in each application's main program is one diagnostic per path", async () => {
			const f = await bridge.fetch({ knownItems: {}, onlyItems: expected.mains })
			for (const c of f.changed ?? []) if (expected.mains.includes(c.name)) original[c.name] = lf(c.sourceText)
			expect(missing(original, expected.mains)).toEqual([])
			const refs = await bridge.refs()
			const ops = expected.mains.map((p) => ({
				op: "set",
				name: p,
				sourceText: original[p]!.replace(/^%LANGUAGE ST$/m, `%LANGUAGE ST
${token} := 1;`),
				ifVersion: refs.items?.[p] ?? null,
			}))
			const pushed = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops })
			expect(landedInFull(pushed), JSON.stringify(pushed.conflicts ?? pushed).slice(0, 600)).toBe(true)

			const r = await bridge.build()
			expect(r.success).toBe(false)
			expect(undefinedHere(r).map((d: any) => d.name).sort(), JSON.stringify(r.diagnostics)).toEqual([...expected.compiled].sort())
		})

		// openspec build-selects-application: a build that names one application compiles that one alone — the fault the
		// test above put in every main program is reported for the named application's only, and every named diagnostic
		// lies under its root. On TwinCAT the build is `BuildProject` of that PLC project (DIALECT D46).
		it("a build naming one application compiles that one alone", async () => {
			const one = expected.compiled[0]!
			const root = applicationOf(one)
			const r = await bridge.build({ applications: [root] })
			expect(undefinedHere(r).map((d: any) => d.name), JSON.stringify(r.diagnostics)).toEqual([one])
			const elsewhere = (r.diagnostics ?? []).filter((d: any) => d.name && !String(d.name).startsWith(`${root}/`))
			expect(elsewhere, JSON.stringify(elsewhere)).toEqual([])
		})

		it("a build naming an application the project does not hold is refused by name", async () => {
			const unknown = `${expected.applications[0]}_VltE2E_none`
			const refused = await bridge.build({ applications: [unknown] }).then(
				(r: any) => `answered ${JSON.stringify(r).slice(0, 200)}`,
				(e: Error) => e.message,
			)
			expect(refused).toStartWith("BAD_REQUEST: ")
			expect(refused).toContain(`'${unknown}'`)
		})
	})
})
