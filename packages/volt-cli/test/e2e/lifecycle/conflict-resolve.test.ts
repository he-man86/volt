/**
 * The conflict → DIFF → take-a-side → finish flow, over a LIVE bridge, through the exact @volt/control functions
 * both frontends call (VS Code and the desktop). The C# suite already proves merge --resolve/--continue against a
 * FakeIde; this proves the same flow end-to-end on a real IDE, AND that `loadDiff` (the desktop diff popup + the
 * VS Code diff editor's refs) reads the right bytes on each side of a real conflict.
 *
 * Local-only (needs a live CODESYS/TwinCAT bridge and the built volt.exe), like the rest of test/e2e:
 *   pwsh scripts/codesys-pipe.ps1 up
 *   $env:VOLT_PIPE="volt.bridge.codesys"; $env:VOLT_VENDOR="codesys"; bun test test/e2e/lifecycle/conflict-resolve.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { init, pull, mergeResolve, mergeContinue, loadDiff, setBundledCli } from "@volt/control"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, basename } from "node:path"
import { requireHealthy, createItem, updateItem, cleanup, fid, id, BASE, VENDOR, PIPE } from "../harness"

// Point @volt/control at a built volt.exe; skip the suite if none is present (nothing to drive the CLI with). Pick
// the NEWEST of the candidates — a stale `dist/Cli/volt.exe` (an old shipped build) must not mask a fresh source
// build, or init fails against the current bridge wire for a reason that isn't the code under test.
const CLI_ROOT = resolve(import.meta.dir, "../..", "..") // packages/volt-cli
const CLI = ["dist/Cli/volt.exe", "src/Volt.Cli/bin/Release/net8.0/volt.exe", "src/Volt.Cli/bin/Debug/net8.0/volt.exe"]
	.map((p) => join(CLI_ROOT, p))
	.filter(existsSync)
	.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
if (CLI) setBundledCli(CLI)

const git = (cwd: string, ...args: string[]): void => {
	const r = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, GIT_AUTHOR_NAME: "e2e", GIT_AUTHOR_EMAIL: "e2e@volt", GIT_COMMITTER_NAME: "e2e", GIT_COMMITTER_EMAIL: "e2e@volt" },
	})
	if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`)
}

// A FB whose one interesting line (the initial value) is what each side changes — so the two edits collide on the
// SAME line and git can't auto-merge (a real conflict, not a clean 3-way).
const fb = (name: string, v: number): string => `FUNCTION_BLOCK ${name}\nVAR\n\tval : INT := ${v};\nEND_VAR\nEND_FUNCTION_BLOCK`

/** The on-disk src file for an item id (its src-relative path is also the tool ref path). */
function srcFileOf(root: string, itemId: string): { abs: string; rel: string } {
	const srcDir = join(root, "src")
	const hit = (readdirSync(srcDir, { recursive: true }) as string[]).find((e) => typeof e === "string" && basename(e).startsWith(itemId))
	if (hit === undefined) throw new Error(`no src file for ${itemId} under ${srcDir}`)
	return { abs: join(srcDir, hit), rel: hit.replace(/\\/g, "/") }
}

describe.skipIf(CLI === undefined)(`conflict → diff → take-a-side → finish (${BASE})`, () => {
	setDefaultTimeout(180_000) // init pulls the whole fixture project; each pull is a live bridge fetch
	let root = "" // the WORKSPACE — `volt init` creates <parent>/<projectName>/ (git-clone semantics), not <parent>
	let parent = "" // the temp dir we make; init makes the named workspace inside it, and we clean up the whole thing

	beforeAll(async () => {
		await requireHealthy()
		parent = mkdtempSync(join(tmpdir(), "volt-e2e-conflict-"))
		const r = await init(parent, VENDOR, { pipe: PIPE })
		expect(r.code).toBe(0)
		root = r.workspace ?? parent // operate on the created workspace, NOT the parent (which has no .git/volt)
	})
	afterAll(async () => {
		try { await cleanup() } catch {} // remove the VltE2E_* items from the IDE
		if (parent && existsSync(parent)) rmSync(parent, { recursive: true, force: true })
	})

	/** Create a fresh item, pull the base in, then diverge: MINE (committed in the workspace) vs IDE (live), each
	 *  editing the same line, then pull into a conflict. Returns the conflicted src-relative path. */
	async function setupConflict(itemId: string): Promise<string> {
		const name = `${itemId}.fb`
		await createItem(name, fb(itemId, 0)) // base, in the IDE
		expect((await pull(root)).kind).toBe("ok") // base lands clean in the workspace

		const file = srcFileOf(root, itemId)
		writeFileSync(file.abs, fb(itemId, 222)) // MINE
		git(root, "add", "-A")
		git(root, "commit", "-m", `mine ${itemId}`)
		await updateItem(name, fb(itemId, 111)) // IDE (theirs), same line → collides

		const out = await pull(root)
		expect(out.kind).toBe("conflict")
		const paths = out.kind === "conflict" ? out.paths : []
		expect(paths.some((p) => p.includes(itemId))).toBe(true) // the conflict names our item (path format-agnostic)
		return file.rel // drive the tools off the real on-disk src-relative path
	}

	it("incoming diff shows BOTH sides, take the IDE's version, then finish → in sync", async () => {
		const itemId = id("cflA")
		const rel = await setupConflict(itemId)

		// The diff the conflict row opens (data-dir="incoming"): HEAD (mine) ↔ BRIDGE (live IDE). Must show the
		// collision — mine removed, the IDE's added — not two identical panes.
		const d = await loadDiff(root, rel, `${itemId}.fb`, "incoming")
		expect(d.identical).toBe(false)
		expect(d.lines.some((l) => l.tag === "-" && l.text.includes("222"))).toBe(true)
		expect(d.lines.some((l) => l.tag === "+" && l.text.includes("111"))).toBe(true)

		// Take the IDE's whole side, then finish.
		expect((await mergeResolve(root, rel, "ide")).kind).toBe("done")
		expect((await mergeContinue(root)).kind).toBe("done")

		// Resolved: the file is the IDE's version, no markers; and HEAD == BRIDGE now (the incoming diff is clean).
		const text = readFileSync(join(root, "src", rel), "utf8")
		expect(text).toContain("val : INT := 111;")
		expect(text).not.toContain("222")
		expect(text).not.toContain("<<<<<<<")
		expect((await loadDiff(root, rel, `${itemId}.fb`, "incoming")).identical).toBe(true)
	})

	it("take MY version keeps the workspace edit through finish", async () => {
		const itemId = id("cflB")
		const rel = await setupConflict(itemId)

		expect((await mergeResolve(root, rel, "mine")).kind).toBe("done")
		expect((await mergeContinue(root)).kind).toBe("done")

		const text = readFileSync(join(root, "src", rel), "utf8")
		expect(text).toContain("val : INT := 222;") // mine survived
		expect(text).not.toContain("<<<<<<<")
	})
})
