#!/usr/bin/env bun
/**
 * THE MIXED-VERSION CELL (openspec `volt-cli-rework` 1.3; its judgement is `mixed-version-lib.ts`): the current CLI
 * against the PREVIOUS release's bridge, and the previous release's CLI against the current bridge — the pairing no
 * other test makes, and the one an update made while CODESYS is open produces.
 *
 *   bun scripts/mixed-version.ts [--previous <tag>] [--instance-prefix <p>] [--codesys-version 3.5.21.40] [--bits 64] [--out <dir>]
 *                                [--current-cli <volt.exe>] [--no-build-current]
 *
 * `--current-cli` and `--no-build-current` are for a caller that built the current tree already (the release matrix,
 * whose other cells run from the same `bin\` and must not see it rebuilt under them).
 *
 * `--previous` defaults to the newest release tag below HEAD (`git describe --tags --abbrev=0`, of HEAD^ when HEAD is
 * itself tagged). The previous release is BUILT FROM ITS TAG — `git archive <tag> packages/volt-cli`, extracted under
 * `--out` — so the cell needs no installer and writes nothing outside its folder: that tree's own `ide.ps1` builds and
 * serves its own bridge on its own fixture copy, exactly as the release did, built stamped with the tag's version so
 * its `health.bridgeVersion` names that release. Both bridges are served at once, each on its own `ide.ps1` instance
 * (`<prefix>-bridge-previous` / `<prefix>-bridge-current`), and closed at the end.
 *
 * In each direction the CLI runs `init`, `status`, `build` and a push cycle (create one `VltE2E_Mx` POU, then delete
 * one) against the OTHER release's bridge, through `VOLT_PIPE`. When `init` there is refused, a workspace is bound on
 * the CLI's own release's bridge (not judged) and the other verbs then meet the other bridge from it, so every verb is
 * judged. The verdict (`judgeCell`): a pair whose wires differ (another protocol, or the two releases' OpenRPC documents
 * differ, deep) is refused by name in each direction by every verb before any op; a pair of one wire works; the bridge
 * that answered must report the release the direction meant. The result — both directions, the OpenRPC difference
 * between the two releases, and what it meant — is `<out>/result.json`; every direction's output is
 * `<out>/mixed-version.log`. Exit 0 green, 1 red. Windows only; no interactive step.
 */
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { capabilityGap, judgeCell, type Direction, type OpenRpcLike, type VerbRun } from "./mixed-version-lib"

const CLI = resolve(import.meta.dir, "..")
const REPO = resolve(CLI, "..", "..")
const DOTNET = "C:\\Program Files\\dotnet\\dotnet.exe"

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name)
	return i >= 0 ? process.argv[i + 1] : undefined
}

function git(...args: string[]): string {
	const r = spawnSync("git", args, { cwd: REPO, encoding: "utf8" })
	if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`)
	return r.stdout.trim()
}

/** The newest release tag below HEAD — the release a user updates FROM. */
export function previousRelease(): string {
	const atHead = spawnSync("git", ["describe", "--tags", "--exact-match", "HEAD"], { cwd: REPO, encoding: "utf8" }).status === 0
	return git("describe", "--tags", "--abbrev=0", atHead ? "HEAD^" : "HEAD")
}

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout: number }): Promise<{ status: number | null; text: string }> {
	return new Promise((done) => {
		const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env })
		const chunks: Buffer[] = []
		child.stdout.on("data", (b: Buffer) => chunks.push(b))
		child.stderr.on("data", (b: Buffer) => chunks.push(b))
		const timer = setTimeout(() => child.kill(), opts.timeout)
		child.on("close", (status) => { clearTimeout(timer); done({ status, text: Buffer.concat(chunks).toString("utf8") }) })
	})
}

/** The previous release's `packages/volt-cli`, extracted from its tag under `out` (once). */
function extract(tag: string, out: string): string {
	const root = join(out, tag)
	const pkg = join(root, "packages", "volt-cli")
	if (existsSync(join(pkg, "Volt.sln"))) return pkg
	mkdirSync(root, { recursive: true })
	const tar = join(out, `${tag}.tar`)
	git("archive", "--format=tar", "-o", tar, tag, "packages/volt-cli")
	const x = spawnSync("tar", ["-xf", tar, "-C", root], { encoding: "utf8" })
	if (x.status !== 0) throw new Error(`could not extract ${tar}: ${x.stderr}`)
	rmSync(tar, { force: true })
	return pkg
}

function newestExe(dir: string, name: string): string | undefined {
	const all: string[] = []
	const walk = (d: string) => {
		if (!existsSync(d)) return
		for (const e of readdirSync(d, { withFileTypes: true }))
			if (e.isDirectory()) walk(join(d, e.name))
			else if (e.name === name) all.push(join(d, e.name))
	}
	walk(dir)
	return all.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

/** Build a tree's CLI, Release, and answer its `volt.exe`. `env` carries a stamp ({@link stamp}) or nothing. */
function buildCli(pkg: string, env: NodeJS.ProcessEnv = process.env): string {
	const r = spawnSync(DOTNET, ["build", join(pkg, "src", "Volt.Cli", "Volt.Cli.csproj"), "-c", "Release", "--nologo", "-v", "quiet"], { env, encoding: "utf8" })
	if (r.status !== 0) throw new Error(`building ${pkg}'s CLI failed:\n${r.stdout}${r.stderr}`)
	const exe = newestExe(join(pkg, "src", "Volt.Cli", "bin", "Release"), "volt.exe")
	if (!exe) throw new Error(`no volt.exe under ${pkg}\\src\\Volt.Cli\\bin\\Release after the build`)
	return exe
}

/** The protocol a tree's code speaks — its `WireProtocol.Version`, or null for a tree from before the number. */
function protocolOf(pkg: string): number | null {
	const f = join(pkg, "src", "Volt.Contracts", "Wire", "WireProtocol.cs")
	if (!existsSync(f)) return null
	const m = /public const int Version = (\d+);/.exec(readFileSync(f, "utf8"))
	return m ? Number(m[1]) : null
}

const GIT_ENV = { GIT_AUTHOR_NAME: "volt-mixed", GIT_AUTHOR_EMAIL: "mixed@volt.invalid", GIT_COMMITTER_NAME: "volt-mixed", GIT_COMMITTER_EMAIL: "mixed@volt.invalid" }

/** One tree's bridge, served by that tree's own `ide.ps1` on its own instance, and what its `health` states. */
type Served = { name: string; pkg: string; instance: string; pipe: string; protocol: number | null; ops: string[] | null; release: string | null }

function ide(pkg: string, instance: string, action: "up" | "down", codesys: { version: string; bits: string }, noBuild: boolean, env: NodeJS.ProcessEnv) {
	return run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(pkg, "scripts", "ide.ps1"), action,
		"-Vendor", "codesys", "-Instance", instance, ...(action === "up" ? ["-CodesysVersion", codesys.version, "-CodesysBitness", codesys.bits, "-Wait", ...(noBuild ? ["-NoBuild"] : [])] : [])],
		{ env, timeout: 20 * 60_000 })
}

/** Serve `pkg`'s bridge on `instance` and read its `health`. `env` carries the build's stamp (`Version`/`FileVersion`,
 *  read by MSBuild as properties) for a tree built here, so the bridge names the release it is. */
async function serve(name: string, pkg: string, instance: string, codesys: { version: string; bits: string }, noBuild: boolean,
	env: NodeJS.ProcessEnv, log: string[]): Promise<Served> {
	const up = await ide(pkg, instance, "up", codesys, noBuild, env)
	log.push(`── bridge ${name}: ide.ps1 up -Instance ${instance} (exit ${up.status})`, up.text)
	const pipe = /^(volt\.bridge\.codesys\.\d+)\s*$/m.exec(up.text)?.[1]
	if (up.status !== 0 || !pipe) throw new Error(`bridge ${name}: the IDE did not come up (no pipe printed)`)
	const { callRaw, WIRE_PROTOCOL } = await import("../test/e2e/lib/pipe")
	const h = (await callRaw(pipe, JSON.stringify({ op: "health", protocol: WIRE_PROTOCOL }))).frames.at(-1)?.result
	const served: Served = {
		name, pkg, instance, pipe,
		protocol: typeof h?.protocol === "number" ? h.protocol : null,
		ops: Array.isArray(h?.ops) ? h.ops : null,
		release: typeof h?.bridgeVersion === "string" ? h.bridgeVersion : null,
	}
	log.push(`── bridge ${name}: ${pipe}, health.protocol ${served.protocol}, health.ops ${JSON.stringify(served.ops)}, bridgeVersion ${served.release}`)
	return served
}

/**
 * One direction: `cliExe` (of `cliPkg`) against the OTHER release's bridge `other`. `init` runs there in a fresh
 * workspace. When it works (one wire), the rest runs in that workspace. When it is refused (the wires differ), the
 * remaining verbs still each meet the other bridge: a workspace is bound on the CLI's OWN wire (`own`, not judged) and
 * `VOLT_PIPE` is then pointed at `other` — so `status`, `build` and both pushes are judged too, not only `init`.
 */
async function direction(name: string, cliExe: string, cliPkg: string, own: Served, other: Served, expectedRelease: string, log: string[]): Promise<Direction> {
	const runs: VerbRun[] = []
	const workspaces: string[] = []
	const fresh = () => { const w = mkdtempSync(join(tmpdir(), `volt-mixed-${name}-`)); workspaces.push(w); return w }
	const call = async (label: string, args: string[], cwd: string, pipe: string, judged: boolean) => {
		const r = await run(cliExe, args, { cwd, env: { ...process.env, ...GIT_ENV, VOLT_PIPE: pipe }, timeout: 15 * 60_000 })
		if (judged) runs.push({ verb: label, exit: r.status, output: r.text })
		log.push(`── ${name}: volt ${args.join(" ")} against ${pipe === other.pipe ? `bridge ${other.name}` : `bridge ${own.name} (binding, not judged)`} (exit ${r.status})`, r.text)
		return r
	}
	const rootOf = (text: string) => /"workspace":"((?:[^"\\]|\\.)*)"/.exec(text)?.[1]?.replace(/\\\\/g, "\\")
	try {
		const init = await call("init", ["init", "--vendor", "codesys", "--json"], fresh(), other.pipe, true)
		let root = init.status === 0 ? rootOf(init.text) : undefined
		if (init.status === 0 && !root) throw new Error(`${name}: \`init\` exited 0 but named no workspace`)
		if (!root) {
			const bind = await call("init", ["init", "--vendor", "codesys", "--json"], fresh(), own.pipe, false)
			root = bind.status === 0 ? rootOf(bind.text) : undefined
			if (!root) throw new Error(`${name}: could not bind a workspace on the CLI's own wire (bridge ${own.name}, exit ${bind.status}): ${bind.text.trim().slice(-300)}`)
		}
		await call("status", ["status", "--json"], root, other.pipe, true)
		await call("build", ["build", "--json"], root, other.pipe, true)
		// A push cycle: one new POU beside one the project holds, committed, pushed; then deleted and pushed. When the
		// create was refused, the delete removes the POU the workspace pulled instead — deleting the never-pushed one
		// would leave nothing to send, and a push with nothing to send is no verdict on the wire.
		const src = join(root, "src")
		const anyPou = (readdirSync(src, { recursive: true }) as string[]).find((e) => e.endsWith(".pou"))
		if (!anyPou) throw new Error(`${name}: the pulled workspace holds no .pou`)
		const file = join(dirname(join(src, anyPou)), "VltE2E_Mx.pou")
		const rel = (f: string) => f.slice(root.length + 1).replace(/\\/g, "/")
		const g = (...a: string[]) => spawnSync("git", a, { cwd: root, env: { ...process.env, ...GIT_ENV }, encoding: "utf8" })
		writeFileSync(file, "FUNCTION_BLOCK VltE2E_Mx\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := x + 1;\nEND_FUNCTION_BLOCK\n")
		g("add", "--", rel(file)); g("commit", "-q", "-m", "mixed-version: create")
		const created = await call("push (create)", ["push", "--json"], root, other.pipe, true)
		g("rm", "-q", "--", created.status === 0 ? rel(file) : rel(join(src, anyPou))); g("commit", "-q", "-m", "mixed-version: delete")
		await call("push (delete)", ["push", "--json"], root, other.pipe, true)
	} catch (e) {
		runs.push({ verb: "(the cell)", exit: null, output: String((e as Error).message) })
	} finally {
		for (const w of workspaces) rmSync(w, { recursive: true, force: true })
	}
	return { name, cliProtocol: protocolOf(cliPkg) ?? -1, bridgeProtocol: other.protocol, bridgeOps: other.ops, bridgeRelease: other.release, expectedRelease, runs }
}

if (import.meta.main) {
	if (process.platform !== "win32") { console.error("the mixed-version cell drives a live CODESYS - Windows only"); process.exit(1) }
	const previous = arg("--previous") ?? previousRelease()
	const out = resolve(arg("--out") ?? join(REPO, "dist", "mixed-version"))
	const prefix = arg("--instance-prefix") ?? "mixed-version"
	// Its two instances are one ide.ps1 RUN (openspec shared-ide-machine-rules): the matrix's when it runs this cell (its
	// prefix is under `release-matrix`), else the prefix's own. A signal closes both, through the current tree's ide.ps1.
	process.env.VOLT_IDE_RUN ??= prefix
	const sweep = () => spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(CLI, "scripts", "ide.ps1"), "sweep",
		"-Vendor", "codesys", "-Instance", prefix, "-Run", prefix], { encoding: "utf8", stdio: "inherit" })
	for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(sig, () => { sweep(); process.exit(130) })
	const codesys = { version: arg("--codesys-version") ?? "3.5.21.40", bits: arg("--bits") ?? "64" }
	mkdirSync(out, { recursive: true })
	console.log(`mixed-version: current ${git("rev-parse", "--short", "HEAD")} <-> previous ${previous}`)
	const prevPkg = extract(previous, out)
	// The previous tree is built HERE, from its tag: stamped with the tag's version as its release build was
	// (build-cli.ps1 passes it as Version/FileVersion), so its bridge reports that release, not this checkout's commit.
	const prevRelease = previous.replace(/^v/, "")
	const stamp = { ...process.env, Version: prevRelease, FileVersion: prevRelease }
	const prevCli = buildCli(prevPkg, stamp), curCli = arg("--current-cli") ?? buildCli(CLI)
	const noBuildCurrent = process.argv.includes("--no-build-current")
	// What the current bridge reports: the stamp of this build, or an unstamped build's commit (`BridgeRelease.From`).
	const curRelease = process.env.VOLT_VERSION || `(dev) ${git("rev-parse", "HEAD")}`
	const log: string[] = []
	const dirs: Direction[] = []
	const instances = { previous: `${prefix}-bridge-previous`, current: `${prefix}-bridge-current` }
	try {
		// Both bridges at once: each direction binds its workspace on its CLI's own wire, then meets the other one.
		const prev = await serve("previous", prevPkg, instances.previous, codesys, false, stamp, log)
		const cur = await serve("current", CLI, instances.current, codesys, noBuildCurrent, process.env, log)
		dirs.push(await direction("cli-current__bridge-previous", curCli, CLI, cur, prev, prevRelease, log))
		dirs.push(await direction("cli-previous__bridge-current", prevCli, prevPkg, prev, cur, curRelease, log))
	} catch (e) {
		for (const name of ["cli-current__bridge-previous", "cli-previous__bridge-current"].slice(dirs.length))
			dirs.push({ name, cliProtocol: -1, bridgeProtocol: null, bridgeOps: null, bridgeRelease: null, expectedRelease: name.endsWith("previous") ? prevRelease : curRelease,
				runs: [{ verb: "(the cell)", exit: null, output: String((e as Error).message) }] })
	} finally {
		for (const [pkg, instance] of [[prevPkg, instances.previous], [CLI, instances.current]]) {
			const down = await ide(pkg, instance, "down", codesys, false, process.env)
			log.push(`── ide.ps1 down -Instance ${instance} (exit ${down.status})`, down.text)
		}
		writeFileSync(join(out, "mixed-version.log"), log.join("\n"))
	}
	const doc = (pkg: string) => JSON.parse(readFileSync(join(pkg, "docs", "volt-bridge.openrpc.json"), "utf8")) as OpenRpcLike
	const result = judgeCell(previous, git("rev-parse", "HEAD"), dirs, capabilityGap(doc(prevPkg), doc(CLI)))
	writeFileSync(join(out, "result.json"), JSON.stringify({ ...result, health: dirs.map((d) => ({ name: d.name, protocol: d.bridgeProtocol, ops: d.bridgeOps, bridgeVersion: d.bridgeRelease, expected: d.expectedRelease })) }, null, 2))
	for (const d of result.directions) console.log(`${d.green ? "GREEN" : "RED  "}  ${d.name}: ${d.why}`)
	console.log(`what the pair's difference meant: ${result.undetectable}`)
	for (const g of result.gap) console.log(`  ${g}`)
	process.exit(result.green ? 0 : 1)
}
