/**
 * The bridge half of `probe-tc-view-switch.ps1` (openspec bridge-refusal-review 3.10): create the two probe POUs on the
 * instance's fixture XAE, fetch one, or clean up. The DTE half (opening the editor and running TwinCAT's own View
 * command) is PowerShell, because the DTE is a COM object in the ROT.
 *
 *   VOLT_VENDOR=twincat VOLT_E2E_INSTANCE=bridge-refusal-review bun scripts/probe-tc-view-switch.ts create|fetch <name>|cleanup
 */
import { pushOps, fetchItem, cleanup, fid, id } from "../test/e2e/lib/workspace"

const DECL = (n: string) =>
	`PROGRAM ${n}\nVAR\n\ta : BOOL := TRUE;\n\tb : BOOL;\n\tout : BOOL;\n\tout3 : BOOL;\n\ti1 : INT := 2;\n\ti2 : INT := 3;\n` +
	`\ti3 : INT := 4;\n\tiout : INT;\nEND_VAR\n`

/** LD: an OR (drawn as two contacts in parallel - the LD-only drawing this vendor can be given; a PARALLEL cannot be
 *  created on TwinCAT, D30) and an AND (series contacts). FBD: data boxes (no contact or coil drawing) and an AND. */
const SOURCES: Record<string, string> = {
	[fid("vs_ld")]: DECL(id("vs_ld")) +
		"IMPLEMENTATION LD\nNETWORK\n  out := (a OR b);\nEND_NETWORK\nNETWORK\n  out3 := (a AND b);\nEND_NETWORK\n\nEND_PROGRAM\n",
	[fid("vs_fbd")]: DECL(id("vs_fbd")) +
		"IMPLEMENTATION FBD\nNETWORK\n  iout := (i1 + i2);\nEND_NETWORK\nNETWORK\n  out := ((i1 + i2) > i3);\nEND_NETWORK\n" +
		"NETWORK\n  out3 := (a AND b);\nEND_NETWORK\n\nEND_PROGRAM\n",
}

const [cmd, arg] = process.argv.slice(2)
const deadline = <T>(p: Promise<T>, what: string) =>
	Promise.race([p, new Promise<T>((_, j) => setTimeout(() => j(new Error(`${what} timed out after 300 s`)), 300_000))])

if (cmd === "create") {
	await deadline(cleanup(), "cleanup")
	for (const [name, src] of Object.entries(SOURCES)) {
		const r = await deadline(pushOps([{ op: "set", name, toFolder: "", sourceText: src, ifVersion: null }]), "create")
		if (!r.accepted) throw new Error(`create ${name} refused: ${JSON.stringify(r.conflicts)}`)
		const back = (await deadline(fetchItem(name), "fetch")).sourceText
		console.log(`${name} created; pulled back ${back === src ? "IDENTICAL" : "DIFFERENT:\n" + back}`)
	}
} else if (cmd === "fetch") {
	process.stdout.write((await deadline(fetchItem(arg), "fetch")).sourceText)
} else if (cmd === "cleanup") {
	await deadline(cleanup(), "cleanup")
	console.log("cleaned")
} else {
	throw new Error("usage: create | fetch <name> | cleanup")
}
process.exit(0)
