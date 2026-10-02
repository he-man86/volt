/**
 * DOES A PUSH KEEP A SPECIAL CLASS? — the pushing half of `probe-merged-classes.py` (openspec
 * `push-without-header-check` 5.Q.6, design 5.Qb Migration 1, DIALECT C2n).
 *
 * For each object of a class the wire does not name, through the SHIPPED push path (one `set` op over the pipe):
 *   update — the text written in place (a comment added; for the abstract method, inside the METHOD);
 *   rename — `toName` VltR_<name>;
 *   move   — renamed back AND moved to another folder in one op;
 *   back   — moved back to its own folder, and the original text restored.
 * After every step the IDE-side probe reads the object's CLR class (request file, answered on the UI thread).
 *
 *   VOLT_PIPE=volt.bridge.codesys.<pid> bun run scripts/probe-merged-classes.ts pro2193|bakon
 *
 * Answer: `merged-classes.log` beside this file (both halves append to it).
 */
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { callOn } from "../test/e2e/lib/pipe"

const PIPE: string = process.env.VOLT_PIPE ?? ""
if (!PIPE) throw new Error("set VOLT_PIPE to the serving bridge")
const PHASE = process.argv[2]
if (PHASE !== "pro2193" && PHASE !== "bakon") throw new Error("phase: pro2193 | bakon")
const LOG = join(import.meta.dir, "merged-classes.log")
const out = (s: string): void => {
	console.log(s)
	appendFileSync(LOG, s + "\n")
}
const REQ_DIR = join(process.env.LOCALAPPDATA ?? "", "volt-bridge")
const REQ = join(REQ_DIR, "merged-probe.req")

async function read(label: string, names: string[]): Promise<void> {
	mkdirSync(REQ_DIR, { recursive: true })
	rmSync(REQ + ".done", { force: true })
	writeFileSync(REQ, `${label}|${names.join(",")}`)
	const until = Date.now() + 60_000
	while (!existsSync(REQ + ".done")) {
		if (Date.now() > until) throw new Error(`the IDE-side probe did not answer '${label}' within 60 s`)
		await Bun.sleep(250)
	}
}

const refs = async (): Promise<any> => await callOn(PIPE, "refs")
async function push(label: string, op: any): Promise<void> {
	const r = await refs()
	op.ifVersion = r.items[op.name] ?? null
	const p = await callOn(PIPE, "push", { expectedProjectVersion: r.projectVersion, ops: [op] })
	out(`  push ${label.padEnd(60)} ${p.accepted ? "ACCEPTED" : "REFUSED"}`)
	if (!p.accepted) {
		for (const c of p.conflicts ?? []) out(`      ${c.code}: ${String(c.reason).slice(0, 400)}`)
		throw new Error(`push '${label}' refused`)
	}
}
async function text(wire: string): Promise<string> {
	const f = await callOn(PIPE, "fetch", { knownItems: {}, onlyItems: [wire] })
	const it = (f.changed ?? []).find((i: any) => i.name === wire)
	if (!it?.sourceText) throw new Error(`fetch returned no text for ${wire}`)
	return it.sourceText
}

type Target = { wire: string; read: string[]; edit: (t: string) => string }
const comment = (t: string) => "// volt probe 5Qb: written in place\n" + t
const TARGETS: Target[] =
	PHASE === "pro2193"
		? [
				{ wire: "PersistentVars.gvl", read: ["PersistentVars"], edit: comment },
				{ wire: "CheckBounds.pou", read: ["CheckBounds"], edit: comment },
				{ wire: "IQSlices.dut", read: ["IQSlices"], edit: comment },
				{
					wire: "VisionSystem_BaseFB.pou",
					read: ["VisionSystem_BaseFB", "TakePicture"],
					edit: (t) => {
						const head = /^METHOD ABSTRACT TakePicture : enumResultTakePicture$/m
						if (!head.test(t)) throw new Error("VisionSystem_BaseFB: the abstract method's line is not there")
						return t.replace(head, (l) => l + "\n// volt probe 5Qb: written in place")
					},
				},
			]
		: [
				{ wire: "CAN_TO_PLC.gvl", read: ["CAN_TO_PLC"], edit: comment },
				{ wire: "CheckBounds.pou", read: ["CheckBounds"], edit: comment },
			]

out(`\n==== ${new Date().toISOString()} phase ${PHASE} (pipe ${PIPE})`)
for (const t of TARGETS) {
	const r0 = await refs()
	if (!(t.wire in r0.items)) throw new Error(`${t.wire} is not published by refs`)
	const ext = t.wire.slice(t.wire.lastIndexOf("."))
	const bare = t.wire.slice(0, -ext.length)
	const renamed = `VltR_${bare}${ext}`
	const home: string = r0.folders[t.wire]
	// Another FOLDER of the same application, one that holds source items. Not "the first other folder refs names":
	// that was `Device` (a device node) on Pro2193 and `Task Configuration` on Bakon, and a move into either was
	// ACCEPTED and left the object where it was (see the log).
	const app = home.split("/").slice(0, 3).join("/")
	const away: string | undefined = Object.entries(r0.folders as Record<string, string>).find(
		([n, f]) => f && f !== home && f.startsWith(app + "/") && /\.(pou|gvl|dut|itf)$/.test(n),
	)?.[1]
	if (away === undefined) throw new Error("no other folder to move into")
	const original = await text(t.wire)
	const readNames = (b: string) => t.read.map((n) => (n === bare ? b : n))

	out(`-- ${t.wire} (folder ${JSON.stringify(home)}; moved to ${JSON.stringify(away)})`)
	await read(`${t.wire}: before any push`, t.read)
	await push(`update ${t.wire} in place`, { op: "set", name: t.wire, sourceText: t.edit(original) })
	await read(`${t.wire}: after an update in place`, t.read)
	await push(`rename ${t.wire} -> ${renamed}`, { op: "set", name: t.wire, toName: renamed })
	await read(`${t.wire}: after a rename to ${renamed}`, readNames(`VltR_${bare}`))
	await push(`rename back + move to ${away}`, { op: "set", name: renamed, toName: t.wire, toFolder: away })
	await read(`${t.wire}: after rename back + move to '${away}'`, t.read)
	await push(`move home + original text`, { op: "set", name: t.wire, toFolder: home, sourceText: original })
	await read(`${t.wire}: after move home + original text`, t.read)
}
out(`==== done`)
