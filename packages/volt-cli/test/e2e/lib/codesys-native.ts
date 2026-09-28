/**
 * A CODESYS body BYTE FOR BYTE — the CODESYS twin of `tc-files.ts`.
 *
 * Nothing on the wire carries a body Volt does not show (`IMPLEMENTATION <LANG> UNSUPPORTED`), and CODESYS saves no
 * file on push, so a test that must prove a push never wrote a hidden body asks the IDE for its OWN serialization of
 * the object: `export_native`, whose `<Single Name="Implementation">` elements are the bodies as the IDE holds them
 * (chart elements, NWL element ids and all). The export runs inside the served IDE, through the harness launcher's
 * native-export probe (`scripts/run_pipe_production.py`, which says why it is files and not a pipe op); this is the
 * test's side of that exchange.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { currentPipe } from "./pipe"

const TIMEOUT_MS = 60_000

/** The probe's folder for the served CODESYS — named after its pid, as the pipe is. */
function probeFolder(): string {
	const pid = Number(currentPipe().split(".").pop())
	if (!Number.isInteger(pid) || pid <= 0) throw new Error(`pipe '${currentPipe()}' names no CODESYS pid`)
	const base = process.env.LOCALAPPDATA
	if (!base) throw new Error("LOCALAPPDATA is not set, so the CODESYS native-export probe cannot be reached")
	return join(base, "volt-bridge", "codesys-native", String(pid))
}

/** Every `<Single Name="Implementation">` element of `xml` — the object's own body, and each child object's — as the
 *  IDE serialized them, in order. Balanced on `Single` tags, the only element the implementation nests by name. */
export function nativeImplementations(xml: string): string[] {
	const out: string[] = []
	const open = /<Single Name="Implementation"[^>]*>/g
	for (let m = open.exec(xml); m; m = open.exec(xml)) {
		if (m[0].endsWith("/>")) {
			out.push(m[0])
			continue
		}
		const tag = /<Single\b[^>]*?(\/)?>|<\/Single>/g
		tag.lastIndex = m.index + m[0].length
		let depth = 1
		let t: RegExpExecArray | null
		while (depth > 0 && (t = tag.exec(xml))) {
			if (t[0] === "</Single>") depth--
			else if (!t[1]) depth++
		}
		if (depth !== 0) throw new Error("an Implementation element in the native export never closes")
		out.push(xml.slice(m.index, tag.lastIndex))
		open.lastIndex = tag.lastIndex
	}
	return out
}

/** The bodies the served CODESYS holds for `bare` (and every object under it), byte for byte. Throws naming the
 *  reason when the probe refuses, and after a bounded wait when it never answers — a launcher without the probe. */
export async function codesysImplementations(bare: string): Promise<string[]> {
	const folder = probeFolder()
	mkdirSync(folder, { recursive: true })
	const id = randomUUID().replace(/-/g, "")
	const tmp = join(folder, `request.${id}.tmp`)
	writeFileSync(tmp, `${id}\n${bare}\n`)
	renameSync(tmp, join(folder, "request"))            // whole, or not at all: the probe reads it on its next tick

	const done = join(folder, `${id}.done`)
	const error = join(folder, `${id}.error`)
	const exported = join(folder, `${id}.${bare}.export`)
	const deadline = Date.now() + TIMEOUT_MS
	while (!existsSync(done) && !existsSync(error)) {
		if (Date.now() > deadline)
			throw new Error(
				`the CODESYS native-export probe in ${folder} did not answer within ${TIMEOUT_MS / 1000}s — serve the IDE ` +
					"with scripts/ide.ps1 (its launcher starts the probe)",
			)
		await Bun.sleep(100)
	}
	try {
		if (existsSync(error)) throw new Error(`the CODESYS native-export probe refused '${bare}': ${readFileSync(error, "utf8")}`)
		const found = nativeImplementations(readFileSync(exported, "utf8"))
		if (found.length === 0) throw new Error(`the native export of '${bare}' holds no Implementation`)
		return found
	} finally {
		for (const f of [done, error, exported]) rmSync(f, { force: true })
	}
}
