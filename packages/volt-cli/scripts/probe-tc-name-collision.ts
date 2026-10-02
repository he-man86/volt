/**
 * CAN A FOLDER AND AN OBJECT SHARE A NAME AT THE SAME LEVEL, ON EACH VENDOR?
 *
 * Migrating `lenze-mid` into TwinCAT refused four DUTs with the vendor's own words:
 *
 *     A file or folder with the name 'UDT_CamControlLS' already exists on disk at this location.
 *
 * The corpus holds a FOLDER `UDT_CamControlLS/` and a DUT `UDT_CamControlLS` as SIBLINGS. The reading is that
 * TwinCAT backs both with filesystem entries and CODESYS does not — but that is an inference from one error
 * message, and the shape occurs exactly ONCE across all six corpora, so it deserves a direct test rather than
 * a confident sentence in a DIALECT row.
 *
 * THE DISTINCTION THIS PINS, because it is easy to conflate and someone already did:
 *   - an object INSIDE a folder of the same name (`BFU/BFU.prg`)  — different LEVELS, ordinary, works
 *   - an object BESIDE a folder of the same name                  — same level, same name, the question
 *
 * Run it against whichever bridge is serving:
 *   VOLT_PIPE=volt.bridge.twincat.<pid> VOLT_VENDOR=twincat bun run scripts/probe-tc-name-collision.ts
 *   VOLT_PIPE=volt.bridge.codesys.<pid>                     bun run scripts/probe-tc-name-collision.ts
 */
import { callOn } from "../test/e2e/lib/pipe"

const PIPE: string = process.env.VOLT_PIPE ?? ""
if (!PIPE) throw new Error("set VOLT_PIPE to the serving bridge")

const NAME = "VltCollide"
const CHILD = `${NAME}_Inner`

const refs = async (): Promise<any> => await callOn(PIPE, "refs")
const src = (n: string) => `PROGRAM ${n}\nVAR\nEND_VAR\n\nn := 0;\n\nEND_PROGRAM\n`

async function push(ops: any[]): Promise<any> {
	const r = await refs()
	return await callOn(PIPE, "push", { expectedProjectVersion: r.projectVersion, ops })
}

async function cleanup(): Promise<void> {
	const r = await refs()
	const mine = Object.keys(r.items ?? {}).filter((n) => n.startsWith(NAME))
	if (mine.length === 0) return
	await callOn(PIPE, "push", {
		expectedProjectVersion: r.projectVersion,
		ops: mine.map((n) => ({ op: "deleteItem", name: n, ifVersion: r.items[n] })),
	}).catch(() => {})
}

await cleanup()

/** Push one op and report. */
async function step(label: string, op: any): Promise<boolean> {
	const r = await push([op])
	console.log(`  ${label.padEnd(46)} ${r.accepted ? "OK" : "REFUSED"}`)
	if (!r.accepted) console.log(`      ${JSON.stringify(r.conflicts).slice(0, 220)}`)
	return r.accepted
}

const prg = (n: string, folder: string) =>
	({ op: "set", name: `${n}.prg`, toFolder: folder, sourceText: src(n), ifVersion: null })
const dut = (n: string, folder: string) =>
	({ op: "set", name: `${n}.dut`, toFolder: folder, sourceText: `TYPE ${n} :
STRUCT
	x : INT;
END_STRUCT
END_TYPE
`, ifVersion: null })

// THE FOUR CELLS, EACH ON ITS OWN NAME.
//
// The first cut reused one name and cleaned up between cells. That was wrong twice over: `cleanup` deletes
// ITEMS, and TwinCAT leaves the FOLDER on disk — so cell 2 collided with cell 1's leftover folder and reported
// a vendor limit that was really my own litter. One name per cell has no such failure mode.
//
// Two axes. The KIND (`.TcPOU` vs `.TcDUT` — lenze failed on DUTs, so kind was the first suspicion) and the
// ORDER (lenze's object existed BEFORE the folder was needed; the first probe made the folder first, which is
// why it answered "OK" and sent me to the wrong conclusion).
console.log("\nfolder FIRST, then a sibling object of the same name")
await step("POU: child in folder A, then POU beside it", prg("VltCollideA_Inner", "VltCollideA"))
await step("  -> the sibling POU", prg("VltCollideA", ""))

await step("DUT: child in folder B, then DUT beside it", dut("VltCollideB_Inner", "VltCollideB"))
await step("  -> the sibling DUT", dut("VltCollideB", ""))

console.log("\nOBJECT FIRST, then a folder of the same name  (the lenze order)")
await step("POU C, then a POU inside a folder of its name", prg("VltCollideC", ""))
await step("  -> the child that forces the folder", prg("VltCollideC_Inner", "VltCollideC"))

await step("DUT D, then a DUT inside a folder of its name", dut("VltCollideD", ""))
await step("  -> the child that forces the folder", dut("VltCollideD_Inner", "VltCollideD"))

const after = await refs()
const left = Object.keys(after.items ?? {}).filter((n) => n.startsWith(NAME)).sort()
console.log(`\nitems present afterwards: ${JSON.stringify(left)}`)

await cleanup()
console.log("done")
