/**
 * LABELS, JUMPS AND THE EDGE WORDS, ON WHICHEVER BRIDGE IS SERVING (openspec network-text-literal-nwl, tasks
 * 1.14 and 1.15). The CODESYS halves were measured in-proc (`probe-nwl-labels.py`, `probe-edge-names-order.py`);
 * TwinCAT has no scripting host, so its halves go through the pipe: each case is PUSHED as an item, pulled back
 * (what the IDE HOLDS), and built (what the IDE SAYS). Run against CODESYS too, it cross-checks that the pipe path
 * reports what the in-proc probes did.
 *
 *   1.14  can a FUNCTION, an FB, an instance or a variable be named R_EDGE / F_EDGE?
 *   1.15  one label on two networks (same and other case), a label on a DISABLED network as a jump target, a JMP
 *         inside a DISABLED network, a JMP to a label no network carries.
 *
 * A build diagnostic carries no item name on CODESYS, so each case is built ALONE and compared with the baseline
 * the project reports before any case is pushed — the same method as `test/e2e/graphical/labels.test.ts`.
 *
 *   VOLT_E2E_INSTANCE=<instance> bun run scripts/probe-labels-edge-names.ts > scripts/tc-labels-edge-names.log
 *   The pipe comes from an `ide.ps1` fixture instance ONLY (`test/e2e/lib/fixture-ide.ts`): VOLT_E2E_INSTANCE names it
 *   (unset = the default instance), or VOLT_PIPE names one exact pipe an instance provably owns. Anything else is refused.
 */
import { callOn } from "../test/e2e/lib/pipe"
import { scriptPipe, vendorOf } from "../test/e2e/lib/fixture-ide"

// Never a pipe found by prefix, never "the first": only this instance's fixture IDE (refuses, naming the rest).
const PIPE: string = scriptPipe(vendorOf(process.env.VOLT_VENDOR, "twincat"))
const PREFIX = "VltProbe"

const refs = async (): Promise<any> => await callOn(PIPE, "refs")

async function push(ops: any[]): Promise<any> {
	const r = await refs()
	return await callOn(PIPE, "push", { expectedProjectVersion: r.projectVersion, ops })
}

/** Everything this probe created, by prefix OR by one of the edge words it had to use as a POU name. */
async function cleanup(): Promise<void> {
	const r = await refs()
	const mine = Object.keys(r.items ?? {}).filter(
		(n) => n.startsWith(PREFIX) || /^(R_EDGE|F_EDGE)\.(fun|fb)$/i.test(n),
	)
	if (mine.length === 0) return
	const res = await callOn(PIPE, "push", {
		expectedProjectVersion: r.projectVersion,
		ops: mine.map((n) => ({ op: "deleteItem", name: n, ifVersion: r.items[n] })),
	})
	if (!res.accepted) console.log(`  cleanup refused: ${JSON.stringify(res.conflicts).slice(0, 300)}`)
}

const problems = async (): Promise<string[]> =>
	((await callOn(PIPE, "build", {})).diagnostics ?? [])
		.filter((d: any) => d.severity === "error" || d.severity === "warning")
		.map((d: any) => `${d.severity}: ${d.message ?? ""}`)

const set = (name: string, sourceText: string) => ({ op: "set", name, toFolder: "", sourceText, ifVersion: null })

const prg = (n: string, vars: string, body: string) =>
	`PROGRAM ${n}\nVAR\n${vars}\nEND_VAR\nIMPLEMENTATION ST\n${body}\n\nEND_PROGRAM\n`

/** A v1 graphical body: one `NETWORK` block per entry, each [header suffix, statement]. */
const fbd = (n: string, nets: [string, string][]) =>
	`PROGRAM ${n}\nVAR\n\ta : BOOL;\n\tx : BOOL;\n\ty : BOOL;\nEND_VAR\nIMPLEMENTATION ST\n` +
	nets.map(([hdr, stmt], i) => `NETWORK ${i} FBD${hdr}\n  ${stmt}\nEND_NETWORK\n`).join("") +
	`\nEND_PROGRAM\n`

const JMP = (l: string) => `IF a THEN JMP ${l}; END_IF`

type Case = { label: string; ops: any[]; show?: string }
const cases: Case[] = [
	{ label: "control: an error", ops: [set(`${PREFIX}Err.prg`, prg(`${PREFIX}Err`, "\tq : BOOL;", "q := zz;"))] },
	// ---- 1.14 names
	{
		label: "a FUNCTION named R_EDGE, called",
		ops: [
			set("R_EDGE.fun", `FUNCTION R_EDGE : BOOL\nVAR_INPUT\n\ti : BOOL;\nEND_VAR\nIMPLEMENTATION ST\nR_EDGE := i;\n\nEND_FUNCTION\n`),
			set(`${PREFIX}UseR.prg`, prg(`${PREFIX}UseR`, "\tq : BOOL;\n\ta : BOOL;", "q := R_EDGE(a);")),
		],
	},
	{
		label: "a FUNCTION named F_EDGE, called",
		ops: [
			set("F_EDGE.fun", `FUNCTION F_EDGE : BOOL\nVAR_INPUT\n\ti : BOOL;\nEND_VAR\nIMPLEMENTATION ST\nF_EDGE := i;\n\nEND_FUNCTION\n`),
			set(`${PREFIX}UseFf.prg`, prg(`${PREFIX}UseFf`, "\tq : BOOL;\n\ta : BOOL;", "q := F_EDGE(a);")),
		],
	},
	{
		label: "an FB named R_EDGE, instantiated",
		ops: [
			set("R_EDGE.fb", `FUNCTION_BLOCK R_EDGE\nVAR_INPUT\n\ti : BOOL;\nEND_VAR\nIMPLEMENTATION ST\n;\n\nEND_FUNCTION_BLOCK\n`),
			set(`${PREFIX}UseRb.prg`, prg(`${PREFIX}UseRb`, "\tinst : R_EDGE;", "inst(i := TRUE);")),
		],
	},
	{
		label: "an FB named F_EDGE, instantiated",
		ops: [
			set("F_EDGE.fb", `FUNCTION_BLOCK F_EDGE\nVAR_INPUT\n\ti : BOOL;\nEND_VAR\nIMPLEMENTATION ST\n;\n\nEND_FUNCTION_BLOCK\n`),
			set(`${PREFIX}UseF.prg`, prg(`${PREFIX}UseF`, "\tinst : F_EDGE;", "inst(i := TRUE);")),
		],
	},
	{
		label: "an instance named R_EDGE",
		ops: [set(`${PREFIX}InstR.prg`, prg(`${PREFIX}InstR`, "\tR_EDGE : TON;", "R_EDGE(IN := TRUE, PT := T#1S);"))],
	},
	{
		label: "a variable named F_EDGE",
		ops: [set(`${PREFIX}VarF.prg`, prg(`${PREFIX}VarF`, "\tF_EDGE : BOOL;", "F_EDGE := TRUE;"))],
	},
	// ---- 1.15 labels and jumps
	{
		label: "control: a jump to a label",
		ops: [set(`${PREFIX}L0.prg`, fbd(`${PREFIX}L0`, [["", JMP("Done")], [" LABEL: Done", "x := a;"]]))],
		show: `${PREFIX}L0.prg`,
	},
	{
		label: "jump spelled in another case",
		ops: [set(`${PREFIX}Lc.prg`, fbd(`${PREFIX}Lc`, [["", JMP("DONE")], [" LABEL: Done", "x := a;"]]))],
		show: `${PREFIX}Lc.prg`,
	},
	{
		label: "one label on two networks, same case",
		ops: [set(`${PREFIX}L1.prg`, fbd(`${PREFIX}L1`, [[" LABEL: Done", "x := a;"], [" LABEL: Done", "y := a;"], ["", JMP("Done")]]))],
		show: `${PREFIX}L1.prg`,
	},
	{
		label: "one label on two networks, other case",
		ops: [set(`${PREFIX}L2.prg`, fbd(`${PREFIX}L2`, [[" LABEL: Done", "x := a;"], [" LABEL: DONE", "y := a;"], ["", JMP("Done")]]))],
		show: `${PREFIX}L2.prg`,
	},
	{
		label: "a LABEL on a DISABLED network as target",
		ops: [set(`${PREFIX}L3.prg`, fbd(`${PREFIX}L3`, [["", JMP("Done")], [" LABEL: Done DISABLED", "x := a;"]]))],
		show: `${PREFIX}L3.prg`,
	},
	{
		label: "a JMP inside a DISABLED network",
		ops: [set(`${PREFIX}L4.prg`, fbd(`${PREFIX}L4`, [[" DISABLED", JMP("Done")], [" LABEL: Done", "x := a;"]]))],
		show: `${PREFIX}L4.prg`,
	},
	{
		label: "a JMP to a label no network carries",
		ops: [set(`${PREFIX}L5.prg`, fbd(`${PREFIX}L5`, [["", JMP("Nowhere")], ["", "x := a;"]]))],
		show: `${PREFIX}L5.prg`,
	},
]

/**
 * The main program, and its source with a call to each of `prgs` added. A case program nothing calls is not
 * compiled on TwinCAT, so it would report CLEAN whatever it holds — the control case is what shows this is not
 * happening. The main program is restored after every case.
 */
// A `string`, not `string | undefined` narrowed by the guard: the narrowing does not reach `setMain` below (a closure),
// which is where `tsc` stopped the package's typecheck.
const MAIN: string = Object.keys((await refs()).items ?? {}).find((n) => /^(PLC_PRG|MAIN)\.prg$/i.test(n))
	?? (() => { throw new Error("no PLC_PRG / MAIN program to call the cases from") })()
const fetchSrc = async (n: string): Promise<string> =>
	(await callOn(PIPE, "fetch", { knownItems: {}, onlyItems: [n] })).changed.find((i: any) => i.name === n).sourceText
const MAIN_SRC = await fetchSrc(MAIN)
const MARK = "IMPLEMENTATION ST\n"
if (!MAIN_SRC.includes(MARK)) throw new Error(`${MAIN} has no implementation marker`)
const withCalls = (prgs: string[]) =>
	MAIN_SRC.replace(MARK, MARK + prgs.map((p) => `${p.replace(/\.prg$/, "")}();\n`).join(""))
async function setMain(src: string): Promise<void> {
	const r = await refs()
	const res = await callOn(PIPE, "push", {
		expectedProjectVersion: r.projectVersion,
		ops: [{ op: "set", name: MAIN, sourceText: src, ifVersion: r.items[MAIN] }],
	})
	if (!res.accepted) throw new Error(`${MAIN} refused: ${JSON.stringify(res.conflicts)}`)
}

console.log(`bridge: ${PIPE}  (cases called from ${MAIN})`)
await cleanup()
const baseline = await problems()
console.log(`baseline: ${baseline.length} problem(s)`)
for (const c of cases) {
	console.log(c.label)
	const r = await push(c.ops)
	if (!r.accepted) {
		console.log(`   push: REFUSED ${JSON.stringify(r.conflicts).slice(0, 400)}`)
		await cleanup()
		continue
	}
	await setMain(withCalls(c.ops.map((o) => o.name).filter((n: string) => n.startsWith(PREFIX) && n.endsWith(".prg"))))
	if (c.show) {
		const got = (await callOn(PIPE, "fetch", { knownItems: {}, onlyItems: [c.show] })).changed?.find(
			(i: any) => i.name === c.show,
		)
		const held = (got?.sourceText ?? "<vanished>").split("\n").filter((l: string) => l.startsWith("NETWORK"))
		console.log(`   held: ${held.join(" | ")}`)
	}
	const now = (await problems()).filter((p) => !baseline.includes(p))
	console.log(`   build: ${now.length === 0 ? "CLEAN" : ""}`)
	for (const p of now) console.log(`      ${p}`)
	await setMain(MAIN_SRC)
	await cleanup()
}
console.log("done")
