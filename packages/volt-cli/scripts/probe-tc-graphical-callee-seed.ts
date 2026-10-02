/**
 * A GRAPHICAL CALL OF A POU THE SAME SESSION CREATED — what TwinCAT builds the box as under the one POU seed (openspec
 * `push-without-header-check` 5.Q, design S1; the 5Qa review's high finding).
 *
 * Since 5.Q every POU is created as a function block (604) whatever its text, and TwinCAT keeps that tree code until the
 * solution is reloaded (DIALECT C2f/C2h). Its compiler takes the TEXT (a 604 holding PROGRAM text builds as a program),
 * but its GRAPHICAL layer builds a call box from the tree code: the conformance re-record found the `.ENO` on a box
 * calling a just-created PROGRAM (`network_unnamed_target_of_void_call`) and a just-created FUNCTION
 * (`network_unnamed_target_of_valued_call`) refused — "the IDE builds that box with no ENO output". This asks what
 * else that lag reaches, through the shipped push path:
 *
 *   A  one push: FUNCTION callee + FBD caller `r := F(n);` (no ENO)     — accepted? round-trips? what does it build?
 *   B  one push: PROGRAM callee + LD caller `done := P(EN := go).ENO;`  — the fixture's shape with a named target
 *   C  FUNCTION callee pushed, a BUILD, then FBD caller with `.ENO`     — does a build re-derive the code?
 *
 *   VOLT_PIPE=volt.bridge.twincat.<pid> bun run scripts/probe-tc-graphical-callee-seed.ts
 *
 * Answer: `tc-graphical-callee-seed.log` beside this file.
 */
import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { callOn } from "../test/e2e/lib/pipe"

const PIPE: string = process.env.VOLT_PIPE ?? ""
if (!PIPE) throw new Error("set VOLT_PIPE to the serving bridge")
const LOG = join(import.meta.dir, "tc-graphical-callee-seed.log")
const out = (s: string): void => {
	console.log(s)
	appendFileSync(LOG, s + "\n")
}

const PREFIX = "VltG_"
const refs = async (): Promise<any> => await callOn(PIPE, "refs")

async function push(label: string, ops: any[]): Promise<boolean> {
	const r = await refs()
	const p = await callOn(PIPE, "push", { expectedProjectVersion: r.projectVersion, ops })
	out(`  ${label.padEnd(72)} ${p.accepted ? "ACCEPTED" : "REFUSED"}`)
	if (!p.accepted) for (const c of p.conflicts ?? []) out(`      ${c.code}: ${String(c.reason).slice(0, 500)}`)
	return p.accepted
}
async function fetchText(wire: string): Promise<string | undefined> {
	const f = await callOn(PIPE, "fetch", { knownItems: {}, onlyItems: [wire] })
	return (f.changed ?? []).find((i: any) => i.name === wire)?.sourceText
}
async function roundTrip(wire: string, sent: string): Promise<void> {
	const back = await fetchText(wire)
	if (back === undefined) return out(`  ${wire}: not published`)
	const norm = (s: string) => s.replace(/\r\n/g, "\n").trim()
	const net = (s: string) => norm(s).split("\n").filter((l) => /:=/.test(l) && !/^\s*\w+\s*:\s*\w+;/.test(l)).map((l) => l.trim())
	out(`  ${wire}: ${norm(back) === norm(sent) ? "fetches back identical" : "fetches back DIFFERENT — network lines: " + JSON.stringify(net(back))}`)
}
async function build(): Promise<void> {
	const b = await callOn(PIPE, "build", { buildType: "incremental" })
	const mine = (b.diagnostics ?? []).filter((d: any) => String(d.name ?? "").startsWith(PREFIX) || (d.message ?? "").includes(PREFIX))
	out(`  build: success=${b.success}; diagnostics on ${PREFIX}*: ${mine.length ? mine.map((d: any) => `[${d.severity}] ${d.name ?? ""}: ${d.message}`).join(" ~ ") : "none"}`)
}
async function clean(names: string[]): Promise<void> {
	for (const n of names) {
		const r = await refs()
		if (`${n}.pou` in r.items)
			await callOn(PIPE, "push", { expectedProjectVersion: r.projectVersion, force: true, ops: [{ op: "deleteItem", name: `${n}.pou`, ifVersion: null }] })
	}
}

const fun = (n: string) => `FUNCTION ${n} : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nIMPLEMENTATION ST\n${n} := a + 1;\n\nEND_FUNCTION\n`
const prg = (n: string) => `PROGRAM ${n}\nVAR\n\tx : BOOL;\nEND_VAR\nIMPLEMENTATION ST\nx := TRUE;\n\nEND_PROGRAM\n`
const caller = (n: string, lang: "FBD" | "LD", vars: string, net: string) =>
	`PROGRAM ${n}\nVAR\n${vars}\nEND_VAR\nIMPLEMENTATION ${lang}\nNETWORK\n  ${net}\nEND_NETWORK\n\nEND_PROGRAM\n`

out(`\n==== ${new Date().toISOString()} (pipe ${PIPE})`)
const plc = Object.keys((await refs()).items).find((n) => /^(MAIN|PLC_PRG)\.pou$/i.test(n))
const folder = plc ? (await refs()).folders[plc] : null
const ALL = ["A_F", "A_C", "B_P", "B_C", "C_F", "C_C"].map((s) => PREFIX + s)
await clean(ALL)

out("A  one push: FUNCTION callee + FBD caller without ENO")
{
	const c = caller(`${PREFIX}A_C`, "FBD", "\tn : INT;\n\tr : INT;", `r := ${PREFIX}A_F(n);`)
	const ok = await push("FUNCTION VltG_A_F + FBD `r := VltG_A_F(n);`", [
		{ op: "set", name: `${PREFIX}A_F.pou`, toFolder: folder, sourceText: fun(`${PREFIX}A_F`), ifVersion: null },
		{ op: "set", name: `${PREFIX}A_C.pou`, toFolder: folder, sourceText: c, ifVersion: null },
	])
	if (ok) await roundTrip(`${PREFIX}A_C.pou`, c)
	await build()
}

out("B  one push: PROGRAM callee + LD caller with ENO into a named variable")
{
	const c = caller(`${PREFIX}B_C`, "LD", "\tgo : BOOL;\n\tdone : BOOL;", `done := ${PREFIX}B_P(EN := go).ENO;`)
	const ok = await push("PROGRAM VltG_B_P + LD `done := VltG_B_P(EN := go).ENO;`", [
		{ op: "set", name: `${PREFIX}B_P.pou`, toFolder: folder, sourceText: prg(`${PREFIX}B_P`), ifVersion: null },
		{ op: "set", name: `${PREFIX}B_C.pou`, toFolder: folder, sourceText: c, ifVersion: null },
	])
	if (ok) await roundTrip(`${PREFIX}B_C.pou`, c)
	await build()
}

out("C  FUNCTION callee, a build, then an FBD caller with ENO")
{
	await push("FUNCTION VltG_C_F alone", [{ op: "set", name: `${PREFIX}C_F.pou`, toFolder: folder, sourceText: fun(`${PREFIX}C_F`), ifVersion: null }])
	await build()
	const c = caller(`${PREFIX}C_C`, "FBD", "\tgo : BOOL;\n\tn : INT;\n\tok : BOOL;", `ok := ${PREFIX}C_F(EN := go, n).ENO;`)
	const ok = await push("then FBD `ok := VltG_C_F(EN := go, n).ENO;`", [
		{ op: "set", name: `${PREFIX}C_C.pou`, toFolder: folder, sourceText: c, ifVersion: null },
	])
	if (ok) await roundTrip(`${PREFIX}C_C.pou`, c)
}

await clean(ALL.slice().reverse())
out(`  cleaned up: ${JSON.stringify(Object.keys((await refs()).items).filter((n) => n.startsWith(PREFIX)))}`)
