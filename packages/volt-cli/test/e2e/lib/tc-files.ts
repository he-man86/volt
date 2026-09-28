/**
 * The TwinCAT project files the SERVED XAE saves — the one place a hidden body can be read byte for byte.
 *
 * Nothing on the wire carries a body Volt does not show (`IMPLEMENTATION <LANG> UNSUPPORTED`): that is the point of
 * hiding it. TwinCAT saves every push to its `.TcPOU` files (`FlushPendingWrites`, a `File.SaveAll`), and a POU's
 * `<Implementation>` elements there ARE its bodies, so a test that must prove a push never wrote a hidden body reads
 * them before and after. CODESYS saves no file on push; its bodies are read through the served IDE's native export
 * (`codesys-native.ts`), and `held-body.ts` picks the vendor's source.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { currentPipe } from "./pipe"

/** The solution folder the served XAE has open — read from THAT process's own command line. The pipe is named
 *  `volt.bridge.twincat.<pid>` after the XAE it serves, and `ide.ps1` launches the XAE on the `.sln` of its copy, so
 *  this is a probe of the served copy rather than a guess among the `%TEMP%/volt-ide-twincat[-<instance>]` copies
 *  several `-Instance` runs leave side by side (picking the newest one was a guess that a stale copy could win). */
export function servedSolutionDir(): string {
	const pid = Number(currentPipe().split(".").pop())
	if (!Number.isInteger(pid) || pid <= 0) throw new Error(`pipe '${currentPipe()}' names no XAE pid`)
	const r = spawnSync("powershell", ["-NoProfile", "-Command",
		`(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: "utf8" })
	const sln = /"([^"]+\.sln)"/i.exec(r.stdout ?? "")?.[1]
	if (!sln) throw new Error(`XAE ${pid} was not opened on a .sln (command line: ${JSON.stringify(r.stdout)}; ${r.stderr})`)
	return dirname(sln)
}

/** The served PLC project's `<bare>.TcPOU` — exactly one, or the test cannot say which bytes it compared. */
export function tcPouFile(bare: string, project: string): string {
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

/** Every `<Implementation>` element of the file — the POU's own body and each member's and accessor's — as TwinCAT
 *  saved them, byte for byte and in order. */
export function tcImplementations(file: string): string[] {
	const found = readFileSync(file, "utf8").match(/<Implementation>[\s\S]*?<\/Implementation>/g)
	if (!found) throw new Error(`${file} holds no <Implementation>`)
	return found
}

/** The project `health` says is served (not idle) — the name `tcPouFile` needs. */
export function servedProject(health: any): string {
	const served = (health.projects ?? []).find((p: any) => p.status && p.status !== "idle")
	if (!served?.project) throw new Error(`health reports no served project: ${JSON.stringify(health)}`)
	return served.project
}
