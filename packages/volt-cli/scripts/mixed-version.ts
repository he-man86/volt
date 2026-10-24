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
 * serves its own bridge on its own fixture copy, exactly as the release did. Each direction serves its own `ide.ps1`
 * instance (`<prefix>-cur-cli` / `<prefix>-prev-cli`) and closes it.
 *
 * In each direction the CLI runs `init`, `status`, `build` and a push cycle (create one `VltE2E_Mx` POU, then delete
 * it) in a fresh workspace, through `VOLT_PIPE`. The verdict (`judgeDirection`): bridges of another protocol are refused
 * by name before any op; bridges of the same protocol work. The result — both directions, the OpenRPC difference between
 * the two releases, and what the protocol check therefore cannot detect — is `<out>/result.json`; each direction's
 * output is `<out>/<direction>.log`. Exit 0 green, 1 red. Windows only; no interactive step.
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

/** Build a tree's CLI, Release, and answer its `volt.exe`. */
function buildCli(pkg: string): string {
	const r = spawnSync(DOTNET, ["build", join(pkg, "src", "Volt.Cli", "Volt.Cli.csproj"), "-c", "Release", "--nologo", "-v", "quiet"], { encoding: "utf8" })
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

/** One direction: `bridgePkg`'s ide.ps1 serves its bridge; `cliExe` drives it. */
async function direction(name: string, cliExe: string, cliPkg: string, bridgePkg: string, instance: string,
	codesys: { version: string; bits: string }, noBuild: boolean, log: string[]): Promise<Direction> {
	const ide = (action: "up" | "down") => run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(bridgePkg, "scripts", "ide.ps1"), action,
		"-Vendor", "codesys", "-Instance", instance, ...(action === "up" ? ["-CodesysVersion", codesys.version, "-CodesysBitness", codesys.bits, "-Wait", ...(noBuild ? ["-NoBuild"] : [])] : [])],
		{ timeout: 20 * 60_000 })
	const runs: VerbRun[] = []
	let bridgeProtocol: number | null = null, bridgeOps: string[] | null = null
	const ws = mkdtempSync(join(tmpdir(), `volt-mixed-${name}-`))
	try {
		const up = await ide("up")
		log.push(`── ${name}: ide.ps1 up (exit ${up.status})`, up.text)
		const pipe = /^(volt\.bridge\.codesys\.\d+)\s*$/m.exec(up.text)?.[1]
		if (up.status !== 0 || !pipe) throw new Error(`${name}: the IDE did not come up (no pipe printed)`)
		const { callRaw, WIRE_PROTOCOL } = await import("../test/e2e/lib/pipe")
		const h = (await callRaw(pipe, JSON.stringify({ op: "health", protocol: WIRE_PROTOCOL }))).frames.at(-1)?.result
		bridgeProtocol = typeof h?.protocol === "number" ? h.protocol : null
		bridgeOps = Array.isArray(h?.ops) ? h.ops : null
		log.push(`── ${name}: health.protocol ${bridgeProtocol}, health.ops ${JSON.stringify(bridgeOps)}, bridgeVersion ${h?.bridgeVersion}`)

		const env = { ...process.env, ...GIT_ENV, VOLT_PIPE: pipe }
		const verb = async (label: string, args: string[], cwd: string) => {
			const r = await run(cliExe, args, { cwd, env, timeout: 15 * 60_000 })
			runs.push({ verb: label, exit: r.status, output: r.text })
			log.push(`── ${name}: volt ${args.join(" ")} (exit ${r.status})`, r.text)
			return r
		}
		const init = await verb("init", ["init", "--vendor", "codesys", "--json"], ws)
		const root = /"workspace":"((?:[^"\\]|\\.)*)"/.exec(init.text)?.[1]?.replace(/\\\\/g, "\\")
		if (init.status !== 0 || !root) return { name, cliProtocol: protocolOf(cliPkg) ?? -1, bridgeProtocol, bridgeOps, runs }
		await verb("status", ["status", "--json"], root)
		await verb("build", ["build", "--json"], root)
		// A push cycle: one new POU beside one the project holds, committed, pushed; then deleted and pushed.
		const src = join(root, "src")
		const anyPou = (readdirSync(src, { recursive: true }) as string[]).find((e) => e.endsWith(".pou"))
		if (!anyPou) throw new Error(`${name}: the pulled workspace holds no .pou`)
		const file = join(dirname(join(src, anyPou)), "VltE2E_Mx.pou")
		const rel = file.slice(root.length + 1).replace(/\\/g, "/")
		const g = (...a: string[]) => spawnSync("git", a, { cwd: root, env, encoding: "utf8" })
		writeFileSync(file, "FUNCTION_BLOCK VltE2E_Mx\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := x + 1;\nEND_FUNCTION_BLOCK\n")
		g("add", "--", rel); g("commit", "-q", "-m", "mixed-version: create")
		await verb("push (create)", ["push", "--json"], root)
		g("rm", "-q", "--", rel); g("commit", "-q", "-m", "mixed-version: delete")
		await verb("push (delete)", ["push", "--json"], root)
	} catch (e) {
		runs.push({ verb: "(the cell)", exit: null, output: String((e as Error).message) })
	} finally {
		const down = await ide("down")
		log.push(`── ${name}: ide.ps1 down (exit ${down.status})`, down.text)
		rmSync(ws, { recursive: true, force: true })
	}
	return { name, cliProtocol: protocolOf(cliPkg) ?? -1, bridgeProtocol, bridgeOps, runs }
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
	const prevCli = buildCli(prevPkg), curCli = arg("--current-cli") ?? buildCli(CLI)
	const noBuildCurrent = process.argv.includes("--no-build-current")
	const log: string[] = []
	const dirs: Direction[] = []
	try {
		dirs.push(await direction("cli-current__bridge-previous", curCli, CLI, prevPkg, `${prefix}-cur-cli`, codesys, false, log))
		dirs.push(await direction("cli-previous__bridge-current", prevCli, prevPkg, CLI, `${prefix}-prev-cli`, codesys, noBuildCurrent, log))
	} finally {
		writeFileSync(join(out, "mixed-version.log"), log.join("\n"))
	}
	const doc = (pkg: string) => JSON.parse(readFileSync(join(pkg, "docs", "volt-bridge.openrpc.json"), "utf8")) as OpenRpcLike
	const result = judgeCell(previous, git("rev-parse", "HEAD"), dirs, capabilityGap(doc(prevPkg), doc(CLI)))
	writeFileSync(join(out, "result.json"), JSON.stringify({ ...result, health: dirs.map((d) => ({ name: d.name, protocol: d.bridgeProtocol, ops: d.bridgeOps })) }, null, 2))
	for (const d of result.directions) console.log(`${d.green ? "GREEN" : "RED  "}  ${d.name}: ${d.why}`)
	console.log(`what the protocol check cannot detect: ${result.undetectable}`)
	for (const g of result.gap) console.log(`  ${g}`)
	process.exit(result.green ? 0 : 1)
}
