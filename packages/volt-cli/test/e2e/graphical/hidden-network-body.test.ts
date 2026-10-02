/**
 * A WORKSPACE PULLED FROM A PRODUCTION BRIDGE, PUSHED TO A DEVELOPMENT ONE: the ladder is hidden, never written.
 *
 * <p>A bridge without `VOLT_GRAPHICAL=1` (every shipped one) pulls each LD and FBD body as its line
 * `IMPLEMENTATION LD|FBD UNSUPPORTED` over an empty body. The same workspace pushed at a bridge that HAS network text
 * on — this suite's, `ide.ps1` sets it — states that line over a body the IDE holds as a real ladder. That is the same
 * body, hidden: the push must not be blocked (the ST and declaration edits beside it land) and must never write the
 * ladder (openspec `implementation-keyword` 3c.2 review; `BodyFormatGuard`, offline in `NetworkTextSwitchTests`).</p>
 *
 * <p>What makes this the live check both vendors can run: because network text is ON here, the IDE's body is readable
 * before and after — as its network text, and byte for byte in the vendor's own serialization (`lib/held-body.ts`:
 * TwinCAT's saved `.TcPOU`, CODESYS's native export). A push that rewrote the ladder, even with the same meaning (an
 * element id re-minted), moves those bytes; one that emptied or flattened it changes the network text too. And a
 * VISIBLE ladder edit must move the bytes, or a comparison that holds proves nothing about the reader.</p>
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { readFileSync } from "node:fs"
import { id, fid, bridge, fetchItem, pushOps, requireHealthy, expectVendorDifference, BASE } from "../harness"
import { heldImplementations } from "../lib/held-body"
import { servedProject, tcPouFile } from "../lib/tc-files"

setDefaultTimeout(120_000)

const LANGS = ["LD", "FBD"] as const
const ADDED = "VAR_INPUT\n\tbVoltHiddenProbe : BOOL;\nEND_VAR\n"

const bareOf = (lang: string) => id(`hidnet_${lang.toLowerCase()}`)
const itemOf = (lang: string) => fid(`hidnet_${lang.toLowerCase()}`, "pou")

/** A PROGRAM whose body is one network in `lang` — the shape both vendors create and read back (graphical-kinds). */
const created = (lang: string) =>
	`PROGRAM ${bareOf(lang)}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\nEND_VAR\n` +
	`IMPLEMENTATION ${lang}\nNETWORK\n  out := (a AND b);\nEND_NETWORK\n\nEND_PROGRAM\n`

/** The file as a PRODUCTION pull writes it: the same declaration, the body replaced by its UNSUPPORTED line. */
function asProductionPull(pulled: string, stated: string): string {
	const at = pulled.indexOf(`\nIMPLEMENTATION `)
	if (at < 0) throw new Error(`no IMPLEMENTATION line in:\n${pulled}`)
	return `${pulled.slice(0, at)}\nIMPLEMENTATION ${stated} UNSUPPORTED\nEND_PROGRAM\n`
}

describe(`graphical / a production workspace's hidden LD/FBD body pushed to a development bridge (${BASE})`, () => {
	let project = ""

	const clean = async (name: string) => {
		const items = (await bridge.refs()).items ?? {}
		if (items[name]) await pushOps([{ op: "deleteItem", name, ifVersion: items[name] }])
	}

	/** Push `sourceText` over `name`, gated on its current version. */
	async function set(name: string, sourceText: string): Promise<any> {
		const refs = await bridge.refs()
		return pushOps([{ op: "set", name, sourceText, ifVersion: refs.items[name] }])
	}

	/** The bodies the IDE holds for the item, byte for byte (see the file header). */
	const heldBytes = (lang: string) => heldImplementations(bareOf(lang), project)

	beforeAll(async () => {
		await requireHealthy()
		const health = await bridge.health()
		// This suite needs the IDE's ladder READABLE, i.e. network text on in the bridge; a production bridge would pull
		// the "before" as the UNSUPPORTED line too and the comparison would prove nothing.
		if (health.networkText !== true)
			throw new Error("LD and FBD network text is OFF in this bridge — serve it with `ide.ps1 up` (not -Production)")
		project = servedProject(health)
		for (const lang of LANGS) {
			await clean(itemOf(lang))
			const r = await pushOps([{ op: "set", name: itemOf(lang), toFolder: "", sourceText: created(lang), ifVersion: null }])
			expect(r.accepted, `create refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
			await settle(lang)
		}
	})

	/** Let TwinCAT write the new POU in ITS OWN serialization before any bytes are compared.
	 *
	 *  WHY, measured on TwinCAT Project14: a freshly created ladder is saved as the archive text the create stored, and
	 *  the next save of that POU after ANY write to it re-serializes it from the XAE's model (an empty
	 *  `<l2 n="OutputItems" cet="Operand">` with a blank line in it becomes `<l2 n="OutputItems" />`). That happens once,
	 *  and on a declaration-only push with the ladder VISIBLE too — where the driver writes no body either (the
	 *  archive already says exactly this, `ResolveBody` returns null) — so it is the vendor's save, not a body write.
	 *  A ladder an engineer drew is already in that form (the vendor-authored fixtures `hidden-declaration.test.ts`
	 *  compares hold still byte for byte). So the baseline is taken after a visible declaration round trip, and every
	 *  byte that moves after that is one a push moved. */
	async function settle(lang: string): Promise<void> {
		const name = itemOf(lang)
		const pulled = (await fetchItem(name)).sourceText as string
		const header = `PROGRAM ${bareOf(lang)}\n`
		for (const text of [pulled.replace(header, `${header}VAR_INPUT\n\tbSettle : BOOL;\nEND_VAR\n`), pulled]) {
			const r = await set(name, text)
			expect(r.accepted, `settling push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
		}
		expect((await fetchItem(name)).sourceText).toBe(pulled)
	}

	afterAll(async () => {
		for (const lang of LANGS) await clean(itemOf(lang))
	})

	for (const lang of LANGS) {
		it(`an ${lang} body stated UNSUPPORTED is not written, and the declaration edit beside it lands`, async () => {
			const name = itemOf(lang)
			const before = (await fetchItem(name)).sourceText as string
			expect(before).toContain(`\nIMPLEMENTATION ${lang}\nNETWORK\n`)
			const bytes = await heldBytes(lang)

			// The production file pushed back unchanged: the ordinary no-op.
			const hidden = asProductionPull(before, lang)
			expect((await set(name, hidden)).accepted).toBe(true)
			expect((await fetchItem(name)).sourceText).toBe(before)
			expect(await heldBytes(lang)).toEqual(bytes)

			// …and with its declaration edited: not blocked, the input lands, the ladder is exactly what it was.
			const edited = hidden.replace(`PROGRAM ${bareOf(lang)}\n`, `PROGRAM ${bareOf(lang)}\n${ADDED}`)
			expect(edited).not.toBe(hidden)
			const r = await set(name, edited)
			expect(r.accepted, `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
			const after = (await fetchItem(name)).sourceText as string
			expect(after).toBe(before.replace(`PROGRAM ${bareOf(lang)}\n`, `PROGRAM ${bareOf(lang)}\n${ADDED}`))
			expect(await heldBytes(lang)).toEqual(bytes)                        // not one byte of the ladder moved…
			expectVendorDifference("openspec implementation-keyword 3b.1: only TwinCAT saves a push to a readable file", {
				// …read from a file that took the push (CODESYS's export is taken live, so it is the IDE's current state)
				twincat: () => expect(readFileSync(tcPouFile(bareOf(lang), project), "utf8")).toContain("bVoltHiddenProbe : BOOL;"),
				codesys: () => undefined,
			})
		})
	}

	it("a hidden line stating ANOTHER language than the IDE's body is refused naming both, and nothing is written", async () => {
		const name = itemOf("LD")
		const before = await fetchItem(name)
		const bytes = await heldBytes("LD")
		const r = await set(name, asProductionPull(before.sourceText, "FBD"))
		expect(r.accepted).toBe(false)
		const reason = JSON.stringify(r.conflicts ?? r)
		expect(reason).toContain("IMPLEMENTATION FBD UNSUPPORTED")
		expect(reason).toContain("IMPLEMENTATION LD")
		const after = await fetchItem(name)
		expect(after.sourceText).toBe(before.sourceText)
		expect(after.version).toBe(before.version)
		expect(await heldBytes("LD")).toEqual(bytes)
	})

	/** The control that makes every comparison above mean something: a VISIBLE ladder edit — network text pushed under
	 *  `IMPLEMENTATION LD` — does write the body, and the bytes read back move. A reader that returned the same bytes
	 *  whatever the IDE held would pass every "unchanged" check in this file. The body is put back afterwards. */
	it("a visible ladder edit moves the held bytes, so the reader sees what the IDE holds", async () => {
		const name = itemOf("LD")
		const before = (await fetchItem(name)).sourceText as string
		const bytes = await heldBytes("LD")
		const rewired = before.replace("out := (a AND b);", "out := (a OR b);")
		expect(rewired).not.toBe(before)
		try {
			expect((await set(name, rewired)).accepted).toBe(true)
			expect((await fetchItem(name)).sourceText).toBe(rewired)
			expect(await heldBytes("LD")).not.toEqual(bytes)
		} finally {
			expect((await set(name, before)).accepted).toBe(true)
			expect((await fetchItem(name)).sourceText).toBe(before)
		}
	})
})
