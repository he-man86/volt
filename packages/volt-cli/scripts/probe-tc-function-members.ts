/**
 * DOES A TWINCAT POU WHOSE TEXT SAYS FUNCTION TAKE MEMBERS — before and after a solution reload? (openspec
 * `push-without-header-check` 5.Q.4, DIALECT C2k's TwinCAT column.)
 *
 * CODESYS judges a member create against the POU's TEXT: FUNCTION text refuses a method, a property, an action and a
 * transition, and a member created before such text lands is kept (C2k, `kind-audit2.log`). Since 5.Q every POU is
 * created as a function block (604) and the push writes the declaration BEFORE it creates members, so the IDE is
 * shown the text first. This asks TwinCAT the same question through the shipped push path:
 *
 *   create  — VltQ_FunM.pou: FUNCTION text + a METHOD, as ONE create (declaration lands, then the member create);
 *             VltQ_FbKeep.pou: FUNCTION_BLOCK text + METHOD KM, then FUNCTION text keeping KM, then FUNCTION text
 *             adding METHOD K2 (a member create under FUNCTION text, on an update); fetch both; build.
 *   reload  — after the solution was closed and reopened (`ide.ps1 down`, then `up -InPlace` on the same copy):
 *             refs, fetch both, a METHOD create under FUNCTION text again, build; then delete both.
 *
 *   VOLT_PIPE=volt.bridge.twincat.<pid> bun run scripts/probe-tc-function-members.ts create|reload
 *
 * Answer: `tc-function-members.log` beside this file.
 */
import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { callOn } from "../test/e2e/lib/pipe"

const PIPE: string = process.env.VOLT_PIPE ?? ""
if (!PIPE) throw new Error("set VOLT_PIPE to the serving bridge")
const PHASE = process.argv[2]
if (PHASE !== "create" && PHASE !== "reload") throw new Error("phase: create | reload")
const LOG = join(import.meta.dir, "tc-function-members.log")
const out = (s: string): void => {
	console.log(s)
	appendFileSync(LOG, s + "\n")
}

const FUN = "VltQ_FunM"
const KEEP = "VltQ_FbKeep"
const method = (m: string) => `\n\nMETHOD ${m} : BOOL\nVAR_INPUT\nEND_VAR\nIMPLEMENTATION ST\n${m} := TRUE;\nEND_METHOD\n`
const funText = (n: string) => `FUNCTION ${n} : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nIMPLEMENTATION ST\n${n} := a + 1;\nEND_FUNCTION`
const fbText = (n: string) => `FUNCTION_BLOCK ${n}\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := n + 1;\nEND_FUNCTION_BLOCK`

const refs = async (): Promise<any> => await callOn(PIPE, "refs")
async function push(label: string, op: any): Promise<boolean> {
	const r = await refs()
	if (op.op === "set" && op.ifVersion === undefined) op.ifVersion = r.items[op.name] ?? null
	const p = await callOn(PIPE, "push", { expectedProjectVersion: r.projectVersion, ops: [op] })
	out(`  ${label.padEnd(64)} ${p.accepted ? "ACCEPTED" : "REFUSED"}`)
	if (!p.accepted) for (const c of p.conflicts ?? []) out(`      ${c.code}: ${String(c.reason).slice(0, 400)}`)
	return p.accepted
}
async function show(name: string): Promise<void> {
	const r = await refs()
	const wire = `${name}.pou`
	if (!(wire in r.items)) {
		out(`  ${wire}: not published (unreadable: ${(r.unreadable ?? []).includes(name)})`)
		return
	}
	const f = await callOn(PIPE, "fetch", { knownItems: {}, onlyItems: [wire] })
	const it = (f.changed ?? []).find((i: any) => i.name === wire)
	const text: string = it?.sourceText ?? ""
	const heads = text.split("\n").filter((l) => /^(FUNCTION_BLOCK|FUNCTION|PROGRAM|METHOD|PROPERTY|ACTION|END_FUNCTION_BLOCK|END_FUNCTION|END_PROGRAM)\b/.test(l))
	out(`  ${wire}: ${heads.join(" | ")}`)
}
async function build(): Promise<void> {
	const b = await callOn(PIPE, "build", { buildType: "incremental" })
	const mine = (b.diagnostics ?? []).filter((d: any) => String(d.name ?? "").startsWith("VltQ_") || /VltQ_/.test(d.message ?? ""))
	out(`  build: success=${b.success}; diagnostics on VltQ_*: ${mine.length ? mine.map((d: any) => `[${d.severity}] ${d.name ?? ""}${d.member ? "(" + d.member + ")" : ""}: ${d.message}`).join(" ~ ") : "none"}`)
}

out(`\n==== ${new Date().toISOString()} phase ${PHASE} (pipe ${PIPE})`)
const plc = Object.keys((await refs()).items).find((n) => /^(MAIN|PLC_PRG)\.pou$/i.test(n))
const folder = plc ? (await refs()).folders[plc] : null
out(`  entry program: ${plc} in ${JSON.stringify(folder)}`)

if (PHASE === "create") {
	for (const n of [FUN, KEEP]) {
		const r = await refs()
		if (`${n}.pou` in r.items)
			await callOn(PIPE, "push", { expectedProjectVersion: r.projectVersion, force: true, ops: [{ op: "deleteItem", name: `${n}.pou`, ifVersion: null }] })
	}
	await push("create FUNCTION text + METHOD M (one create)", { op: "set", name: `${FUN}.pou`, toFolder: folder, sourceText: funText(FUN) + method("M") })
	await push("create FUNCTION text alone", { op: "set", name: `${FUN}.pou`, toFolder: folder, sourceText: funText(FUN) + "\n" })
	await push("update: add METHOD M under FUNCTION text", { op: "set", name: `${FUN}.pou`, sourceText: funText(FUN) + method("M") })
	await push("create FUNCTION_BLOCK text + METHOD KM", { op: "set", name: `${KEEP}.pou`, toFolder: folder, sourceText: fbText(KEEP) + method("KM") })
	await push("update: FUNCTION text, keeping METHOD KM", { op: "set", name: `${KEEP}.pou`, sourceText: funText(KEEP) + method("KM") })
	await push("update: FUNCTION text, adding METHOD K2", { op: "set", name: `${KEEP}.pou`, sourceText: funText(KEEP) + method("KM") + method("K2") })
	await show(FUN)
	await show(KEEP)
	await build()
} else {
	const r = await refs()
	out(`  after reload: ${[FUN, KEEP].map((n) => `${n}.pou ${n + ".pou" in r.items ? "published" : "absent"}`).join(", ")}; unreadable: ${JSON.stringify((r.unreadable ?? []).filter((u: string) => u.startsWith("VltQ_")))}`)
	await show(FUN)
	await show(KEEP)
	// K2 was refused before the reload, so KEEP holds only KM: both K2 and K3 are new here, and K2 is created (and refused) first.
	await push("after reload: update KEEP adding METHODs K2 + K3 under FUNCTION text", { op: "set", name: `${KEEP}.pou`, sourceText: funText(KEEP) + method("KM") + method("K2") + method("K3") })
	await show(KEEP)
	await build()
	for (const n of [FUN, KEEP]) {
		const rr = await refs()
		if (`${n}.pou` in rr.items)
			await callOn(PIPE, "push", { expectedProjectVersion: rr.projectVersion, force: true, ops: [{ op: "deleteItem", name: `${n}.pou`, ifVersion: null }] })
	}
	out(`  cleaned up: ${JSON.stringify(Object.keys((await refs()).items).filter((n) => n.startsWith("VltQ_")))}`)
}
