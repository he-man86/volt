/**
 * WHETHER PUSHED CODE RUNS, on the served CODESYS — the run probe's client (`scripts/run_pipe_production.py`, which
 * says why it is files and not a pipe op). The probe builds the application, logs in to the simulation, starts it, lets
 * it run, and reads the named variables; a build error is its refusal, naming the messages.
 *
 * A body can store, round-trip and build and still not run: an Execute box built in one model commit kept its ST and the
 * build did not compile it (openspec ld-fbd-coverage 2R.6a). Only the runtime says so.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { currentPipe } from "./pipe"
import { withMainProgramRestored } from "./compile"
import { fetchItem, mainProgram, pushOps } from "./workspace"

// a hang guard, not a budget: a build, a login with a download and two seconds of running
const TIMEOUT_MS = 120_000

function probeFolder(): string {
	const pid = Number(currentPipe().split(".").pop())
	if (!Number.isInteger(pid) || pid <= 0) throw new Error(`pipe '${currentPipe()}' names no CODESYS pid`)
	const base = process.env.LOCALAPPDATA
	if (!base) throw new Error("LOCALAPPDATA is not set, so the CODESYS run probe cannot be reached")
	return join(base, "volt-bridge", "codesys-run", String(pid))
}

/** Build, run the served CODESYS's application in simulation, and read `paths` (`P_Run.i`) — each as the online read
 *  renders it (`5`, `TRUE`). Throws naming the reason when the probe refuses, and after a bounded wait when it never
 *  answers — a launcher without the probe. */
export async function runAndRead(paths: readonly string[]): Promise<Record<string, string>> {
	const folder = probeFolder()
	mkdirSync(folder, { recursive: true })
	const id = randomUUID().replace(/-/g, "")
	const tmp = join(folder, `request.${id}.tmp`)
	writeFileSync(tmp, [id, ...paths].join("\n") + "\n")
	renameSync(tmp, join(folder, "request"))

	const done = join(folder, `${id}.json`)
	const error = join(folder, `${id}.error`)
	const deadline = Date.now() + TIMEOUT_MS
	while (!existsSync(done) && !existsSync(error)) {
		if (Date.now() > deadline)
			throw new Error(
				`the CODESYS run probe in ${folder} did not answer within ${TIMEOUT_MS / 1000}s — serve the IDE with ` +
					"scripts/ide.ps1 (its launcher starts the probe)",
			)
		await Bun.sleep(200)
	}
	try {
		if (existsSync(error)) throw new Error(`the CODESYS run probe refused: ${readFileSync(error, "utf8")}`)
		return JSON.parse(readFileSync(done, "utf8"))
	} finally {
		for (const f of [done, error]) rmSync(f, { force: true })
	}
}

/** Run the application with each of `programs` called from the main program (a PROGRAM runs only when its task's program
 *  calls it), read `paths`, and put the main program back. Throws naming a variable the probe could not read. */
export async function runCalled(programs: readonly string[], paths: readonly string[]): Promise<Record<string, string>> {
	const values = await withMainProgramRestored(async () => {
		const main = await mainProgram()
		if (!main) throw new Error("the fixture has no main program to call the test programs from")
		const item = await fetchItem(main)
		const lines: string[] = item.sourceText.split("\n")
		const at = lines.findIndex((l) => l.trim() === "IMPLEMENTATION ST")
		if (at === -1) throw new Error(`${main} has no ST body to call ${programs.join(", ")} from`)
		lines.splice(at + 1, 0, ...programs.map((p) => `${p}();`))
		const r = await pushOps([{ op: "set", name: main, sourceText: lines.join("\n"), ifVersion: item.version }])
		if (!r.accepted) throw new Error(`could not call ${programs.join(", ")} from ${main}: ${JSON.stringify(r.conflicts)}`)
		return runAndRead(paths)
	})
	for (const p of paths) {
		const value = values[p]
		if (value === undefined || value.startsWith("UNREADABLE"))
			throw new Error(`'${p}' was not read: ${JSON.stringify(values)}`)
	}
	return values
}
