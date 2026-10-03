/**
 * `volt push` OF A PARTLY REFUSED BATCH, LIVE (openspec `push-keeps-what-landed` task 4.2).
 *
 * <p>The offline twin is `Volt.Cli.Tests` `PartialPushCommandTests` (FakeIde). This drives the built `volt.exe`
 * against the live bridge: a workspace commits two new items, the IDE takes the DUT and refuses the FB's METHOD at
 * apply (a name no probe asked — `Vlt__Log` — so the pre-flight of task 3.1 passes it), and the CLI must adopt ONLY
 * what landed: exit 2, the DUT in `volt/ide` and out of the outgoing set, the FB still outgoing; once the FB is fixed
 * the next `volt push` sends only it.</p>
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { init, setBundledCli } from "@volt/control"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readdirSync, rmSync, existsSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname } from "node:path"
import { requireHealthy, cleanup, id, BASE, VENDOR, currentPipe } from "../harness"
import { fb, enumDut, MARK } from "../fixtures"

const CLI_ROOT = resolve(import.meta.dir, "..", "..", "..")
function exesUnder(dir: string): string[] {
	if (!existsSync(dir)) return []
	const out: string[] = []
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name)
		if (entry.isDirectory()) out.push(...exesUnder(p))
		else if (entry.name === "volt.exe") out.push(p)
	}
	return out
}
// The NEWEST built volt.exe, as conflict-resolve.test.ts finds it (a pinned path went stale once).
const CLI = exesUnder(join(CLI_ROOT, "src", "Volt.Cli", "bin")).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
if (CLI) setBundledCli(CLI)

const GIT_ENV = { GIT_AUTHOR_NAME: "e2e", GIT_AUTHOR_EMAIL: "e2e@volt", GIT_COMMITTER_NAME: "e2e", GIT_COMMITTER_EMAIL: "e2e@volt" }
function run(cmd: string, cwd: string, ...args: string[]) {
	const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } })
	return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" }
}
function git(cwd: string, ...args: string[]): string {
	const r = run("git", cwd, ...args)
	if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err}`)
	return r.out
}
/** The outgoing lines of `volt status --porcelain` (`oA`/`oM`/`oD <path>`). */
function outgoing(root: string): string[] {
	const r = run(CLI!, root, "status", "--porcelain")
	expect(r.code, r.err).toBe(0)
	return r.out.split(/\r?\n/).filter((l) => /^o[AMD] /.test(l)).sort()
}

describe.skipIf(CLI === undefined)(`volt push of a partly refused batch (${BASE})`, () => {
	setDefaultTimeout(240_000)
	let parent = "", root = ""

	beforeAll(async () => {
		await requireHealthy()
		await cleanup()
		parent = mkdtempSync(join(tmpdir(), "volt-e2e-partial-"))
		const r = await init(parent, VENDOR, { pipe: currentPipe() })
		expect(r.code, JSON.stringify(r)).toBe(0)
		root = r.workspace ?? parent
	})
	afterAll(async () => {
		try { await cleanup() } catch {}
		if (parent && existsSync(parent)) rmSync(parent, { recursive: true, force: true })
	})

	it("adopts only the item that landed, keeps the refused one outgoing, and the next push sends only it", async () => {
		expect(outgoing(root), "a fresh workspace has something outgoing").toEqual([])
		// New files go beside an item the project already holds — the folder the IDE has, on either vendor.
		const srcDir = join(root, "src")
		const anyPou = (readdirSync(srcDir, { recursive: true }) as string[]).find((e) => typeof e === "string" && e.endsWith(".pou"))
		expect(anyPou, "the pulled workspace holds no .pou").toBeDefined()
		const dir = dirname(join(srcDir, anyPou!))
		const dut = join(dir, `${id("cp_E")}.dut`), pou = join(dir, `${id("cp_FB")}.pou`)
		const relDut = dut.slice(root.length + 1).replace(/\\/g, "/"), relPou = pou.slice(root.length + 1).replace(/\\/g, "/")
		const method = (n: string) => `\nMETHOD ${n} : BOOL\n${MARK}\n${n} := TRUE;\nEND_METHOD\n`

		writeFileSync(dut, enumDut(id("cp_E")))
		writeFileSync(pou, fb(id("cp_FB"), { children: method("Vlt__Log") }))
		git(root, "add", "--", relDut, relPou)
		git(root, "commit", "-m", "two items, one the IDE refuses")
		const before = outgoing(root)
		expect(before.length, before.join("\n")).toBe(2)

		const push = run(CLI!, root, "push")
		console.log("[push-keeps-what-landed 4.2] volt push:", JSON.stringify(push))
		expect(push.code, `exit code — stdout ${push.out} stderr ${push.err}`).toBe(2)
		expect(push.out).toContain("pushed 1 item(s)")
		expect(push.err).toContain(id("cp_FB"))

		// The baseline: volt/ide moved for the DUT only.
		const ideTree = git(root, "ls-tree", "-r", "--name-only", "refs/remotes/volt/ide").split(/\r?\n/)
		expect(ideTree).toContain(relDut)
		expect(ideTree).not.toContain(relPou)
		const after = outgoing(root)
		console.log("[push-keeps-what-landed 4.2] outgoing after the partial push:", JSON.stringify(after))
		expect(after.length, after.join("\n")).toBe(1)
		expect(after[0]).toContain(`${id("cp_FB")}.pou`)

		// Fix the refused edit; the next push re-sends only it.
		writeFileSync(pou, fb(id("cp_FB"), { children: method("Vlt_Log") }))
		git(root, "add", "--", relPou)
		git(root, "commit", "-m", "a method name the IDE takes")
		const again = run(CLI!, root, "push")
		console.log("[push-keeps-what-landed 4.2] second volt push:", JSON.stringify(again))
		expect(again.code, again.err).toBe(0)
		expect(again.out).toContain("pushed 1 item(s)")
		expect(outgoing(root)).toEqual([])
	})
})
