/**
 * `volt push` OF A POSITIONAL FUNCTION CALL IN A GRAPHICAL BODY, LIVE (openspec ld-fbd-coverage 2R.4 gate, finding 1).
 *
 * <p>The push names a FUNCTION box's positional pins from the callee's declaration (`NetworkDerivation`; CODESYS builds
 * no function box without them, DIALECT N40), so `F(n)` is held as `F(a := n)`. The CLI's post-push check reads with no
 * project and cannot derive: it took the two texts for two programs, pinned `volt/ide` to the pushed text and left the
 * next `volt pull` to bring the names in as an IDE change nobody made. Here the whole client runs: after the push the
 * workspace holds the IDE's text, nothing is incoming or outgoing, and a pull has nothing to bring. The offline twin is
 * `Volt.Engine.Tests` `PushedTextTests.A_positional_function_call_held_with_its_derived_names_is_the_same_item`.</p>
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { init, setBundledCli } from "@volt/control"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { requireHealthy, cleanup, id, BASE, VENDOR, currentPipe } from "../harness"
import { newestBuiltCli } from "../lib/cli-exe"
import { itGapped, PLATFORM_GAPS } from "../lib/platform"

const CLI = newestBuiltCli({ dist: false })
if (CLI) setBundledCli(CLI)

/** On a CODESYS version that cannot take an LD/FBD write, the push must end in that refusal (lib/platform.ts). */
const itGraphical = itGapped(PLATFORM_GAPS.graphicalWrite)

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
/** Every line of `volt status --porcelain`: incoming and outgoing alike. */
function status(root: string): string[] {
	const r = run(CLI!, root, "status", "--porcelain")
	expect(r.code, r.err).toBe(0)
	return r.out.split(/\r?\n/).filter((l) => /^[io][AMDR] /.test(l)).sort()
}

const F = id("posF"), P = id("posP")
const fun = `FUNCTION ${F} : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\n%LANGUAGE ST\n${F} := a + 1;\n\nEND_FUNCTION\n`
const caller = (call: string) =>
	`PROGRAM ${P}\nVAR\n\tn : INT;\n\tr : INT;\nEND_VAR\n%LANGUAGE FBD\nNETWORK\n  r := ${call};\nEND_NETWORK\n\nEND_PROGRAM\n`

describe.skipIf(CLI === undefined)(`volt push of a positional FUNCTION call (${BASE})`, () => {
	setDefaultTimeout(240_000)
	let parent = "", root = ""

	beforeAll(async () => {
		await requireHealthy()
		await cleanup()
		parent = mkdtempSync(join(tmpdir(), "volt-e2e-positional-"))
		const r = await init(parent, VENDOR, { pipe: currentPipe() })
		expect(r.code, JSON.stringify(r)).toBe(0)
		root = r.workspace ?? parent
	})
	afterAll(async () => {
		try { await cleanup() } catch {}
		if (parent && existsSync(parent)) rmSync(parent, { recursive: true, force: true })
	})

	itGraphical("adopts the IDE's named pins: nothing incoming, nothing outgoing, nothing to pull", async () => {
		const srcDir = join(root, "src")
		const anyPou = (readdirSync(srcDir, { recursive: true }) as string[]).find((e) => typeof e === "string" && e.endsWith(".pou"))
		expect(anyPou, "the pulled workspace holds no .pou").toBeDefined()
		const dir = dirname(join(srcDir, anyPou!))
		const fFile = join(dir, `${F}.pou`), pFile = join(dir, `${P}.pou`)
		const rel = (f: string) => f.slice(root.length + 1).replace(/\\/g, "/")

		writeFileSync(fFile, fun)
		writeFileSync(pFile, caller(`${F}(n)`))
		git(root, "add", "--", rel(fFile), rel(pFile))
		git(root, "commit", "-m", "a function and a positional call of it")

		const push = run(CLI!, root, "push")
		console.log("[2R.4 gate] volt push:", JSON.stringify(push))
		expect(push.code, `stdout ${push.out} stderr ${push.err}`).toBe(0)
		expect(push.out + push.err, "the CLI took the derived names for another program").not.toContain("as another program")

		expect(readFileSync(pFile, "utf8").replace(/\r\n/g, "\n"), "the workspace holds the IDE's text").toBe(caller(`${F}(a := n)`))
		expect(status(root)).toEqual([])

		const pull = run(CLI!, root, "pull")
		console.log("[2R.4 gate] volt pull:", JSON.stringify(pull))
		expect(pull.code, `stdout ${pull.out} stderr ${pull.err}`).toBe(0)
		expect(readFileSync(pFile, "utf8").replace(/\r\n/g, "\n")).toBe(caller(`${F}(a := n)`))
		expect(status(root)).toEqual([])
	})
})
