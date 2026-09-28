/**
 * A HIDDEN BODY'S DECLARATION IS EDITABLE, AND THE IDE'S BODY IS NEVER WRITTEN (openspec `implementation-keyword` 3b).
 *
 * <p>A CFC or SFC body pulls as `IMPLEMENTATION CFC|SFC UNSUPPORTED` over an empty body: Volt shows no implementation
 * code for it. The item's DECLARATION stays editable and is pushed as usual — so this suite gives each committed
 * diagram fixture (`VltFixtureCfc`, `VltFixtureSfc`, authored by each IDE itself; see `unsupported.test.ts`) a new
 * `VAR_INPUT`, pushes it, and asserts on the live IDE that the push was not blocked, the declaration landed, the item
 * still reads back as the same hidden body, and — where the vendor lets anything outside it read the body — that the
 * body is BYTE-IDENTICAL before and after. The declaration is put back at the end, so the fixture is left as found.</p>
 *
 * <p><b>Where the body can be read byte for byte.</b> Nothing on the wire carries a hidden body — that is the point of
 * hiding it — so the bytes are read from the vendor's own storage. TwinCAT saves every push to its `.TcPOU` files
 * (`FlushPendingWrites`, a `File.SaveAll`), and the POU's `<Implementation>` element there IS the body. CODESYS commits
 * a push into the open project in memory and writes no file, and its project archive is binary, so no process outside
 * the IDE can read a CODESYS body at all; the CODESYS writer's guarantee is proven offline instead, against the object
 * manager's checkout (`CodesysHiddenBodyWriteTests`, which counts every read of the implementation aspect), and live
 * here by everything short of the bytes.</p>
 */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { bridge, fetchItem, requireHealthy, pushOps, expectVendorDifference, currentPipe, BASE } from "../harness"

setDefaultTimeout(60000)

const CASES = [["CFC", "VltFixtureCfc"], ["SFC", "VltFixtureSfc"]] as const

const ADDED = "VAR_INPUT\n\tbVoltHiddenProbe : BOOL;\nEND_VAR\n"

/** The solution folder the served XAE has open — read from THAT process's own command line. The pipe is named
 *  `volt.bridge.twincat.<pid>` after the XAE it serves, and `ide.ps1` launches the XAE on the `.sln` of its copy, so
 *  this is a probe of the served copy rather than a guess among the `%TEMP%/volt-ide-twincat[-<instance>]` copies
 *  several `-Instance` runs leave side by side (picking the newest one was a guess that a stale copy could win). */
function servedSolutionDir(): string {
	const pid = Number(currentPipe().split(".").pop())
	if (!Number.isInteger(pid) || pid <= 0) throw new Error(`pipe '${currentPipe()}' names no XAE pid`)
	const r = spawnSync("powershell", ["-NoProfile", "-Command",
		`(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: "utf8" })
	const sln = /"([^"]+\.sln)"/i.exec(r.stdout ?? "")?.[1]
	if (!sln) throw new Error(`XAE ${pid} was not opened on a .sln (command line: ${JSON.stringify(r.stdout)}; ${r.stderr})`)
	return dirname(sln)
}

/** The served PLC project's `<bare>.TcPOU` — exactly one, or the test cannot say which bytes it compared. */
function tcPouFile(bare: string, project: string): string {
	const found: string[] = []
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name)
			if (statSync(path).isDirectory()) walk(path)
			else if (name.toLowerCase() === `${bare.toLowerCase()}.tcpou`) found.push(path)
		}
	}
	const solution = servedSolutionDir()
	walk(solution)
	const served = found.filter((p) => p.split(/[\\/]/).includes(project))
	if (served.length !== 1)
		throw new Error(`expected one ${bare}.TcPOU in project '${project}' under ${solution}, found: ${JSON.stringify(found)}`)
	return served[0]!
}

/** The POU's own `<Implementation>` element as TwinCAT saved it — the body, byte for byte. */
function tcImplementation(file: string): string {
	const xml = readFileSync(file, "utf8")
	const m = /<Implementation>[\s\S]*?<\/Implementation>/.exec(xml)
	if (!m) throw new Error(`${file} holds no <Implementation>`)
	return m[0]
}

describe(`graphical / a hidden body's declaration is pushed and its body never written (${BASE})`, () => {
	const wire = new Map<string, string>()
	let project = ""

	beforeAll(async () => {
		await requireHealthy()
		// The SERVED project, or no test here can say which file it read: requireHealthy just proved one is served.
		const served = ((await bridge.health()).projects ?? []).find((p: any) => p.status && p.status !== "idle")
		if (!served?.project) throw new Error(`health reports no served project: ${JSON.stringify(served)}`)
		project = served.project
		const refs = await bridge.refs()
		for (const [, bare] of CASES) {
			const full = Object.keys(refs.items).find((n) => n.startsWith(`${bare}.`))
			if (!full) throw new Error(`fixture POU '${bare}' is missing from this project — it is committed; re-add it in the IDE`)
			wire.set(bare, full)
		}
	})

	/** Push `sourceText` over `name`, gated on its current version. */
	async function set(name: string, sourceText: string): Promise<any> {
		const refs = await bridge.refs()
		return pushOps([{ op: "set", name, sourceText, ifVersion: refs.items[name] }])
	}

	/** The body as the IDE holds it, where anything outside the IDE can read it (see the file header). */
	function heldBody(bare: string): string | null {
		return expectVendorDifference(
			"openspec implementation-keyword 3b.1: CODESYS saves no file on push and its archive is binary, so a CODESYS " +
				"body cannot be read outside the IDE; its writer is held offline by CodesysHiddenBodyWriteTests",
			{ twincat: () => tcImplementation(tcPouFile(bare, project)), codesys: () => null },
		)
	}

	for (const [lang, bare] of CASES) {
		it(`a ${lang} POU pulls as IMPLEMENTATION ${lang} UNSUPPORTED, and its edited declaration is pushed while its body is untouched`, async () => {
			const name = wire.get(bare)!
			const pulled = (await fetchItem(name)).sourceText as string
			expect(pulled).toContain(`\nIMPLEMENTATION ${lang} UNSUPPORTED\n`)
			expect(pulled).not.toContain("XmlArchive")

			// The bytes BEFORE ANY PUSH — the body as the served project holds it now. Taking the baseline after a push
			// would make whatever that push did the reference, so a push that rewrote the body would compare equal to
			// itself. The restating push (the ordinary no-op) is then held to the same bytes like every other push.
			const before = heldBody(bare)
			expect((await set(name, pulled)).accepted).toBe(true)
			expect(heldBody(bare)).toBe(before)

			const edited = pulled.replace(`FUNCTION_BLOCK ${bare}\n`, `FUNCTION_BLOCK ${bare}\n${ADDED}`)
			expect(edited).not.toBe(pulled)
			try {
				const r = await set(name, edited)
				expect(r.accepted).toBe(true)                                   // a hidden body blocks no push

				const after = (await fetchItem(name)).sourceText as string
				expect(after).toContain("bVoltHiddenProbe : BOOL;")             // the declaration landed
				expect(after).toContain(`\nIMPLEMENTATION ${lang} UNSUPPORTED\n`) // still the same hidden body
				expect(after).toBe(edited)
				expect(heldBody(bare)).toBe(before)                              // and not one byte of it moved
				// …read from a file that DID take this push: the saved declaration carries the probe, so the bytes compared
				// above are the IDE's current state and not a file nothing wrote.
				expectVendorDifference("openspec implementation-keyword 3b.1: only TwinCAT saves a push to a readable file", {
					twincat: () => expect(readFileSync(tcPouFile(bare, project), "utf8")).toContain("bVoltHiddenProbe : BOOL;"),
					codesys: () => undefined,
				})
			} finally {
				// Leave the fixture as found — and that restore is itself a declaration push over a hidden body.
				expect((await set(name, pulled)).accepted).toBe(true)
				expect((await fetchItem(name)).sourceText).toBe(pulled)
				expect(heldBody(bare)).toBe(before)
			}
		})
	}

	it("a pull of a project holding the hidden bodies is not blocked by them", async () => {
		const names = (await bridge.fetch({ knownItems: {} })).changed.map((i: any) => i.name)
		for (const [, bare] of CASES) expect(names).toContain(wire.get(bare)!)
	})
})
