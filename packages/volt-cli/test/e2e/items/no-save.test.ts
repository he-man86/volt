import { landed } from "../harness"
/**
 * VOLT NEVER SAVES THE PROJECT (owner, 2026-10-18; DIALECT D45). A push or a build is an edit in the engineer's open IDE,
 * as on CODESYS; the engineer saves. Every operation the bridge performs is driven here with no save anywhere, each
 * checked through `refs` and `fetch` right after it:
 *
 *   create · set content · rename · move (into a new folder: a folder create) · rename + move · rename + move + edit ·
 *   delete (its emptied folders pruned: a folder delete) · delete then create the same name · rename onto a name just
 *   deleted · build (an error in a changed POU, then fixed)
 *
 * and, on TwinCAT, two facts about the DISK: an engineer's unsaved edit in another POU stays unsaved through all of it
 * (the push saved nothing), and after the engineer's own save and a reopen every item reads back as it was pushed (what
 * TwinCAT wrote without a save, plus the engineer's save, is a project that loads).
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { readFileSync } from "node:fs"
import {
	id, fid, cleanup, requireHealthy, createItem, updateItem, fetchSource, pushOps, pathOf, plcFolder, inFolder,
	folderOf, versionOf, bridge, BASE, VENDOR, currentPipe, drivenBuild, instantiate, withMainProgramRestored,
} from "../harness"
import { tcImplementations, tcPouFile, servedProject } from "../lib/tc-files"
import { engineerSaveAll, engineerSetBody, xaeHolds } from "../lib/tc-engineer"
import { reopenTwinCatSolution } from "../lib/tc-reopen"

const twincat = VENDOR === "twincat"
const instance = process.env.VOLT_E2E_INSTANCE ?? ""
const prg = (s: string, body: string) => `PROGRAM ${id(s)}\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n${body}\n\nEND_PROGRAM\n`

const fb = (s: string, body: string) =>
	`FUNCTION_BLOCK ${id(s)}\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n${body}\n\nEND_FUNCTION_BLOCK\n`

describe(`no save: every operation lands in the open IDE (${BASE})`, () => {
	setDefaultTimeout(300_000)
	let project = ""
	/** The bystander's body as saved on disk (TwinCAT): what an engineer's unsaved edit must not reach. */
	const diskBody = () => tcImplementations(tcPouFile(id("ns_bystander"), project))[0]!

	const rename = async (from: string, to: string, folder?: string, source?: string) => {
		const at = await pathOf(fid(from))
		const op: Record<string, unknown> = { op: "set", name: at, to: inFolder(folder ?? folderOf(at), fid(to)), ifVersion: await versionOf(at) }
		if (source !== undefined) op.sourceText = source
		const r = await pushOps([op])
		expect(landed(r) && !(r.conflicts ?? []).length, JSON.stringify(r.conflicts)).toBe(true)
	}
	const remove = async (s: string) => {
		const at = await pathOf(fid(s))
		const r = await pushOps([{ op: "deleteItem", name: at, ifVersion: await versionOf(at) }])
		expect(landed(r) && !(r.conflicts ?? []).length, JSON.stringify(r.conflicts)).toBe(true)
		expect(await versionOf(at)).toBeNull()
	}
	const holds = async (s: string, body: string, folder?: string) => {
		const text = await fetchSource(fid(s))
		expect(text).toContain(`PROGRAM ${id(s)}\n`)
		expect(text).toContain(`\n${body}\n`)
		if (folder !== undefined) expect(folderOf(await pathOf(fid(s)))).toBe(folder)
	}
	const bystanderUnsaved = () => {
		if (!twincat) return
		expect(diskBody()).toContain("b := 1;")
		expect(diskBody()).not.toContain("b := 2;")
	}

	beforeAll(async () => {
		await requireHealthy()
		await cleanup()
		if (!twincat) return
		project = servedProject(await bridge.health())
		// The engineer's own state: a POU saved with `b := 1;`, then typed to `b := 2;` and NOT saved.
		await createItem(fid("ns_bystander"), prg("ns_bystander", "b := 1;"))
		engineerSaveAll(currentPipe(), instance)
		engineerSetBody(currentPipe(), instance, await pathOf(fid("ns_bystander")), "b := 2;\n")
		expect(await fetchSource(fid("ns_bystander"))).toContain("b := 2;")
		bystanderUnsaved()
	})
	afterAll(cleanup)

	it("create", async () => {
		await createItem(fid("ns_a"), prg("ns_a", "x := 1;"))
		await holds("ns_a", "x := 1;")
		bystanderUnsaved()
	})

	it("set content", async () => {
		await updateItem(fid("ns_a"), prg("ns_a", "x := 2;"))
		await holds("ns_a", "x := 2;")
		bystanderUnsaved()
	})

	it("rename", async () => {
		await rename("ns_a", "ns_r")
		expect(await versionOf(fid("ns_a"))).toBeNull()
		await holds("ns_r", "x := 2;")
		bystanderUnsaved()
	})

	it("case-only rename, then delete: the IDE asks nothing", async () => {
		await createItem(fid("ns_Case"), prg("ns_Case", "x := 4;"))
		await rename("ns_Case", "ns_case")
		await holds("ns_case", "x := 4;")
		await Bun.sleep(5_000) // XAE's file watcher answers a one-step case rename within ~2 s (D45)
		await remove("ns_case")
		bystanderUnsaved()
	})

	it("move into a new folder (a folder create), the unsaved body with it", async () => {
		const folder = await plcFolder("POUs/VltE2E_NsMoved")
		await rename("ns_r", "ns_r", folder)
		await holds("ns_r", "x := 2;", folder)
		bystanderUnsaved()
	})

	it("rename + move", async () => {
		const folder = await plcFolder("POUs/VltE2E_NsMoved2")
		await rename("ns_r", "ns_rm", folder)
		await holds("ns_rm", "x := 2;", folder)
		bystanderUnsaved()
	})

	it("rename + move + edit in one op", async () => {
		const folder = await plcFolder("POUs/VltE2E_NsMoved")
		await rename("ns_rm", "ns_rm2", folder, prg("ns_rm2", "x := 3;"))
		await holds("ns_rm2", "x := 3;", folder)
		bystanderUnsaved()
	})

	it("delete (its emptied folders pruned: a folder delete)", async () => {
		await remove("ns_rm2")
		if (twincat)
			for (const f of ["POUs/VltE2E_NsMoved", "POUs/VltE2E_NsMoved2"])
				expect(xaeHolds(currentPipe(), instance, await plcFolder(f)), f).toBe(false)
		bystanderUnsaved()
	})

	it("a POU with members: edit, move (member bodies carried), delete — the IDE asks nothing", async () => {
		const withMembers = (s: string, body: string) =>
			`FUNCTION_BLOCK ${id(s)}\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\n\nEND_FUNCTION_BLOCK\n` +
			`\nMETHOD Deep : INT\nIMPLEMENTATION ST\n${body}\nEND_METHOD\n` +
			`\nMETHOD Shallow : INT\nIMPLEMENTATION ST\n%FOLDER Helpers\nShallow := 1;\nEND_METHOD\n` +
			`\nPROPERTY P : INT\nGET\nIMPLEMENTATION ST\nP := x;\nEND_GET\nEND_PROPERTY\n`
		await createItem(fid("ns_m"), withMembers("ns_m", "Deep := 1;"))
		await updateItem(fid("ns_m"), withMembers("ns_m", "Deep := 2;"))
		const folder = await plcFolder("POUs/VltE2E_NsMembers")
		await rename("ns_m", "ns_m", folder)
		const moved = await fetchSource(fid("ns_m"))
		expect(moved).toContain("Deep := 2;")
		expect(moved).toContain("P := x;")
		expect(moved).toContain("%FOLDER Helpers")
		await updateItem(fid("ns_m"), withMembers("ns_m", "Deep := 3;"))
		await remove("ns_m")
		bystanderUnsaved()
	})

	it("delete then create the same name", async () => {
		await createItem(fid("ns_d"), prg("ns_d", "x := 1;"))
		await remove("ns_d")
		await createItem(fid("ns_d"), prg("ns_d", "x := 5;"))
		await holds("ns_d", "x := 5;")
		bystanderUnsaved()
	})

	it("rename onto a name just deleted", async () => {
		await createItem(fid("ns_e"), prg("ns_e", "x := 1;"))
		await createItem(fid("ns_f"), prg("ns_f", "x := 6;"))
		await remove("ns_e")
		await rename("ns_f", "ns_e")
		await holds("ns_e", "x := 6;")
		bystanderUnsaved()
	})

	it("build compiles what the IDE holds: an error in a changed POU, then fixed", async () => {
		await withMainProgramRestored(async () => {
			await createItem(fid("ns_b"), fb("ns_b", "x := 1;"))
			await instantiate(id("ns_b"))
			await updateItem(fid("ns_b"), fb("ns_b", "x := VltE2E_NoSuchName;"))
			const broken = await drivenBuild()
			expect(broken.diagnostics.filter((d: any) => d.severity === "error").map((d: any) => d.message).join("\n")).toContain("VltE2E_NoSuchName")
			await updateItem(fid("ns_b"), fb("ns_b", "x := 7;"))
			const fixed = await drivenBuild()
			expect(fixed.diagnostics.filter((d: any) => d.severity === "error"), JSON.stringify(fixed.diagnostics)).toEqual([])
		})
		// On TwinCAT a build saves changed documents, as XAE's Build does (DIALECT D45): the shell's own "Before building:
		// Save all changes", which `SolutionBuild.Build` obeys — the engineer's unsaved edit is on disk after it. Volt calls
		// no save; the rows above prove every other operation leaves it unsaved.
		if (twincat) expect(diskBody()).toContain("b := 2;")
	})

	it("after the engineer saves and reopens, every item reads back as pushed (TwinCAT)", async () => {
		if (!twincat) return // CODESYS holds one project file it writes on save; nothing per item to reload
		reopenTwinCatSolution(currentPipe(), instance) // the engineer's File > Save All, close, reopen
		const row = (await bridge.projects()).find((p: any) => p.status !== "idle") ?? (await bridge.projects())[0]
		await bridge.connect({ project: row?.project })
		await requireHealthy()
		await holds("ns_e", "x := 6;")
		await holds("ns_d", "x := 5;")
		expect(await versionOf(fid("ns_rm2"))).toBeNull()
		expect(await versionOf(fid("ns_f"))).toBeNull()
		expect(await fetchSource(fid("ns_bystander"))).toContain("b := 2;")
		expect(diskBody()).toContain("b := 2;") // the engineer's save, not Volt's
	})
})
