#!/usr/bin/env bun
/**
 * THE WIRE TRANSCRIPT RECORDER and its comparer (openspec `volt-cli-rework` 1.3; the pure half is
 * `wire-transcript-lib.ts`). The rework's fixed reference (3.3): a request → response record of one fixed scenario on one
 * fixture IDE, which must stay byte-identical while the code behind the wire is rewritten.
 *
 *   bun scripts/wire-transcript.ts record --vendor codesys --instance <ide.ps1 instance> --out <file.jsonl>
 *   bun scripts/wire-transcript.ts compare --reference <file.jsonl> --run <file.jsonl> [--diff <file.txt>]
 *
 * `record` drives ONLY the pipe of that `ide.ps1` instance's fixture IDE (`test/e2e/lib/fixture-ide.ts` refuses any other)
 * and sends every frame raw, so the record is what a foreign client sees. The scenario: health, refs, a whole-project
 * fetch, a create / fetch / update / rename / move / stale-update / delete cycle on `VltE2E_Wt*` items of its own, refs
 * against the first baseline, grep, a build of the driven application, an unknown op, health. It deletes any `VltE2E_Wt*`
 * item a previous run left BEFORE it records, and its own cycle deletes what it made. Run it on a fresh fixture copy (the
 * release matrix runs it right after `ide.ps1 up`, before the e2e suite) — the record starts from the fixture as committed.
 *
 * `compare` exits 0 when the two are byte-identical, 1 when they differ (the diff printed, and written to `--diff`), and
 * 2 when the reference does not exist — a missing reference is not a pass.
 *
 * The references live in `test/transcripts/<cell>.jsonl` (`bun run release:matrix --record-transcripts` writes them).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { tmpdir } from "node:os"
import { compare, normaliseString, normaliseValue, parse, renderDiff, serialise, type Normaliser, type Step } from "./wire-transcript-lib"

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name)
	return i >= 0 ? process.argv[i + 1] : undefined
}

function need(name: string): string {
	const v = arg(name)
	if (!v) { console.error(`missing ${name}`); process.exit(2) }
	return v
}

const PREFIX = "VltE2E_Wt"
const fb = (name: string, body = "x := x + 1;") =>
	`FUNCTION_BLOCK ${name}\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n${body}\nEND_FUNCTION_BLOCK\n`
const dut = (name: string) => `TYPE ${name} :\nSTRUCT\n\ta : INT;\n\tb : BOOL;\nEND_STRUCT\nEND_TYPE\n`

export async function record(vendor: "codesys" | "twincat", instance: string): Promise<Step[]> {
	// The e2e pipe layer reads both at import: the vendor it resolves, and the instance whose fixture pipe alone it drives.
	process.env.VOLT_VENDOR = vendor
	process.env.VOLT_E2E_INSTANCE = instance
	const { callRaw, currentPipe } = await import("../test/e2e/lib/pipe")
	const { drivenApplication, inFolder, fileOf, mainProgram } = await import("../test/e2e/lib/main-program")
	const n: Normaliser = { tempDir: tmpdir() }
	const steps: Step[] = []

	/** One raw call; the terminal frame's `result` (or throws with the error frame) for the scenario to go on with. */
	const call = async (op: string, body?: unknown): Promise<any> => {
		const a = await callRaw(currentPipe(), JSON.stringify(body === undefined ? { op } : { op, body }))
		const last = a.frames[a.frames.length - 1]
		if (!last || !("result" in last)) throw new Error(`${op}: ${JSON.stringify(last)}`)
		return last.result
	}
	/** One recorded step: the request as sent, every frame as answered, both normalised. */
	const step = async (name: string, op: string, body?: unknown): Promise<any> => {
		const frame = JSON.stringify(body === undefined ? { op } : { op, body })
		const a = await callRaw(currentPipe(), frame)
		steps.push({ step: name, request: normaliseString(frame, n), response: a.frames.map((f) => normaliseValue(f, n)) })
		const last = a.frames[a.frames.length - 1]
		return last && "result" in last ? last.result : undefined
	}

	// ── before recording: a served project, the identity, the folder, and nothing of a previous run left ──
	// A TwinCAT worker starts every project idle: serve the first row, as the e2e harness does (`requireHealthy`).
	const t0 = Date.now()
	for (;;) {
		const h = await call("health")
		if (h.projects.some((p: any) => p.status !== "idle")) break
		if (Date.now() - t0 > 120_000) throw new Error(`no project became served within 2 min: ${JSON.stringify(h.projects)}`)
		if (h.projects[0]?.project) await callRaw(currentPipe(), JSON.stringify({ op: "connect", body: { project: h.projects[0].project } }))
		await new Promise((r) => setTimeout(r, 1500))
	}
	const refs0 = await call("refs", {})
	const identity = { expectedPlatform: refs0.platform, expectedProjectName: refs0.projectName }
	const leftovers = Object.keys(refs0.items).filter((p) => fileOf(p).startsWith(PREFIX))
	if (leftovers.length > 0) {
		const r = await call("push", { ...identity, ops: leftovers.map((p) => ({ op: "deleteItem", name: p, ifVersion: refs0.items[p] })) })
		if (!r.accepted || r.conflicts?.length) throw new Error(`could not delete a previous run's ${leftovers.join(", ")}: ${JSON.stringify(r.conflicts)}`)
	}
	const app = drivenApplication(refs0.applications)
	const main = mainProgram(refs0)
	const root = main.folder
	const folder = fileOf(root) === "POUs" ? root : inFolder(root, "POUs")
	const a = inFolder(folder, `${PREFIX}A.pou`), t = inFolder(folder, `${PREFIX}T.dut`)
	const b = inFolder(folder, `${PREFIX}B.pou`), moved = inFolder(inFolder(folder, `${PREFIX}Sub`), `${PREFIX}B.pou`)

	// ── the scenario ──
	await step("health", "health")
	const refs = await step("refs", "refs", {})
	await step("fetch-init", "fetch", { ...identity, init: true })
	const created = await step("push-create", "push", { ...identity, expectedProjectVersion: refs.projectVersion, ops: [
		{ op: "set", name: a, sourceText: fb(`${PREFIX}A`) },
		{ op: "set", name: t, sourceText: dut(`${PREFIX}T`) },
	] })
	if (!created?.accepted) throw new Error(`the scenario's create was refused: ${JSON.stringify(created)}`)
	const fetched = await step("fetch-created", "fetch", { ...identity, onlyItems: [a, t] })
	const va = fetched.changed.find((c: any) => c.name === a).version
	const updated = await step("push-update", "push", { ...identity, ops: [{ op: "set", name: a, ifVersion: va, sourceText: fb(`${PREFIX}A`, "x := x + 2;") }] })
	const renamed = await step("push-rename", "push", { ...identity, ops: [{ op: "set", name: a, ifVersion: updated.newItems[a], to: b }] })
	const vb = renamed.newItems[b]
	const movedR = await step("push-move", "push", { ...identity, ops: [{ op: "set", name: b, ifVersion: vb, to: moved }] })
	await step("push-stale", "push", { ...identity, ops: [{ op: "set", name: moved, ifVersion: vb, sourceText: fb(`${PREFIX}B`, "x := 0;") }] })
	await step("refs-against-baseline", "refs", { ...identity, knownItems: refs.items, knownApplications: refs.applications })
	await step("grep", "grep", { ...identity, pattern: PREFIX, limit: 50 })
	if (app) await step("build", "build", { ...identity, applications: [app] })
	const now = await call("refs", {})
	await step("push-delete", "push", { ...identity, ops: [
		{ op: "deleteItem", name: moved, ifVersion: movedR.newItems?.[moved] ?? now.items[moved] },
		{ op: "deleteItem", name: t, ifVersion: now.items[t] },
	] })
	await step("refs-after", "refs", {})
	await step("unknown-op", "frobnicate", {})
	await step("health-after", "health")
	return steps
}

if (import.meta.main) {
	const verb = process.argv[2]
	if (verb === "record") {
		const vendor = need("--vendor")
		if (vendor !== "codesys" && vendor !== "twincat") { console.error(`--vendor codesys|twincat, not ${vendor}`); process.exit(2) }
		const out = need("--out")
		const steps = await record(vendor, need("--instance"))
		mkdirSync(dirname(out), { recursive: true })
		writeFileSync(out, serialise(steps))
		console.log(`recorded ${steps.length} steps to ${out}`)
	} else if (verb === "compare") {
		const reference = need("--reference"), run = need("--run")
		if (!existsSync(reference)) {
			console.error(`no reference transcript at ${reference} — record one (bun run release:matrix --record-transcripts) before comparing`)
			process.exit(2)
		}
		const diff = renderDiff(compare(parse(readFileSync(reference, "utf8")), parse(readFileSync(run, "utf8"))))
		const out = arg("--diff")
		if (out) writeFileSync(out, diff)
		process.stdout.write(diff)
		process.exit(diff.startsWith("transcripts are byte-identical") ? 0 : 1)
	} else {
		console.error("usage: wire-transcript.ts record --vendor <v> --instance <i> --out <f> | compare --reference <f> --run <f> [--diff <f>]")
		process.exit(2)
	}
}
