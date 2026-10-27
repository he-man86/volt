/** The mixed-version cell's judgement (`scripts/mixed-version-lib.ts`), offline. The rule (wire-final-shape 4.3): a pair
 *  whose wires DIFFER — another protocol number, or one number over two shapes — is refused by name in each direction,
 *  EVERY verb (`init`, `status`, `build`, both pushes), never served; a pair of one wire must work. The refusals below
 *  are the CLI's real output, verbatim (`dist/mixed-version/mixed-version.log`, 2026-10-24): the CLI prints a
 *  `BridgeError`'s message, never its code (Program.cs). */
import { describe, expect, it } from "bun:test"
import { capabilityGap, judgeCell, judgeDirection, REQUIRED_VERBS, type Direction, type OpenRpcLike } from "../../scripts/mixed-version-lib"
import { loadOpenRpc } from "../e2e/lib/openrpc"

/** This bridge, refusing a request of the previous CLI (it states no protocol) — measured. */
const bridgeRefusal = "this bridge speaks wire protocol 1, the request states none; nothing was done."
/** This CLI, refusing the previous bridge (its health lacks this wire's members) — measured. */
const clientRefusal = "this bridge predates this wire: update it. The IDE bridge on pipe 'volt.bridge.codesys.30728' (bridge 0.1.17931) states no `languages`, `kinds` in its health. Install this Volt release and restart the IDE so it loads the updated bridge. Nothing was done."
/** This CLI relaying a bridge's PROTOCOL_MISMATCH (`BridgeClient.ProtocolRefused`). */
const relayedMismatch = "the bridge speaks wire protocol 2, this volt speaks 1: restart the IDE to load the updated bridge. Nothing was done."
/** The previous CLI's own check (0.1.17931 `BridgeClient.RequireOurProtocol`). */
const oldClientRefusal = "the bridge speaks wire protocol 2, this volt speaks 1: update Volt to the release that bridge belongs to. Nothing was sent to it."

const every = (exit: number | null, output: string): Direction["runs"] => REQUIRED_VERBS.map((verb) => ({ verb, exit, output }))
const dir = (bridgeProtocol: number | null, runs: Direction["runs"], release = { reported: "0.1.17931" as string | null, expected: "0.1.17931" }): Direction =>
	({ name: "d", cliProtocol: 1, bridgeProtocol, bridgeOps: null, bridgeRelease: release.reported, expectedRelease: release.expected, runs })
const SAME = false, DIFFER = true

describe("a direction of the mixed-version cell", () => {
	it("is green when the pair speaks one wire and every verb works", () => {
		expect(judgeDirection(dir(1, every(0, "")), SAME).green).toBe(true)
	})

	it("is red when the pair speaks one wire and a verb fails — the pair was declared compatible", () => {
		const runs = every(0, "").map((r) => r.verb === "push (create)" ? { ...r, exit: 1, output: "x\nBAD_REQUEST: unknown member" } : r)
		const v = judgeDirection(dir(1, runs), SAME)
		expect(v.green).toBe(false)
		expect(v.why).toContain("`push (create)` exited 1: BAD_REQUEST: unknown member")
	})

	it("is green when the wires differ and every verb is refused by name — by the bridge or by the client", () => {
		for (const refusal of [bridgeRefusal, clientRefusal, relayedMismatch])
			expect(judgeDirection(dir(1, every(1, refusal)), DIFFER).green).toBe(true)
		expect(judgeDirection(dir(2, every(1, oldClientRefusal)), DIFFER).green).toBe(true)
	})

	it("takes a refusal the previous CLI folds into an exit-0 `status` as refused — the bridge served nothing", () => {
		// Measured 2026-10-24 (0.1.17931 CLI against this bridge): its `status` names the bridge's refusal in its summary
		// and exits 0 — the behaviour 4.3c fixed in this CLI; a released CLI cannot be changed.
		const oldStatus = `{"initialized":true,"incoming":{"count":0},"summary":"IDE state unknown \\u2014 ${bridgeRefusal}","incomingStale":true}`
		const runs = every(1, bridgeRefusal).map((r) => r.verb === "status" ? { ...r, exit: 0, output: oldStatus } : r)
		const v = judgeDirection(dir(1, runs), DIFFER)
		expect(v.green).toBe(true)
		expect(v.why).toContain("`status` exited 0 on the refusal")
	})

	it("is red when the wires differ and only `init` was refused — every verb must meet the refusal", () => {
		// The gap review 4.3 found: `init` reads `health` first, `build`/`push` rely on the op path's guard; a cell that
		// stops after a refused `init` cannot see that guard at all.
		const v = judgeDirection(dir(1, [{ verb: "init", exit: 1, output: clientRefusal }]), DIFFER)
		expect(v.green).toBe(false)
		expect(v.why).toContain("`status`, `build`, `push (create)`, `push (delete)` never ran")
	})

	it("is red when the wires differ and a later verb is SERVED — the guard on the op path is gone", () => {
		const runs = every(1, clientRefusal).map((r) => r.verb === "build" || r.verb.startsWith("push") ? { ...r, exit: 0, output: "{}" } : r)
		const v = judgeDirection(dir(1, runs), DIFFER)
		expect(v.green).toBe(false)
		expect(v.why).toContain("`build` (exit 0)")
		expect(v.why).toContain("`push (delete)` (exit 0)")
	})

	it("is red when one protocol number spans two shapes and a verb is SERVED — the misread 4.3 forbids", () => {
		const v = judgeDirection(dir(1, every(0, "")), DIFFER)
		expect(v.green).toBe(false)
		expect(v.why).toContain("`init` (exit 0)")
		expect(v.why).toContain("was not refused by name")
	})

	it("is red when the wires differ and a verb failed for another reason — mentioning the protocol is no refusal", () => {
		expect(judgeDirection(dir(1, every(1, "IDE_LOST_ITEM")), DIFFER).green).toBe(false)
		expect(judgeDirection(dir(1, every(1, "BAD_REQUEST: the wire protocol envelope has an unknown member 'x'")), DIFFER).green).toBe(false)
		expect(judgeDirection(dir(2, every(0, "")), SAME).green).toBe(false)
		expect(judgeDirection(dir(1, []), DIFFER).green).toBe(false)
	})

	it("does not take a code the CLI never prints as a refusal", () => {
		expect(judgeDirection(dir(1, every(1, "BRIDGE_PREDATES_WIRE")), DIFFER).green).toBe(false)
		expect(judgeDirection(dir(1, every(1, "PROTOCOL_MISMATCH")), DIFFER).green).toBe(false)
	})

	it("treats another protocol number as a differing wire even when the documents agree", () => {
		expect(judgeDirection(dir(2, every(1, oldClientRefusal)), SAME).green).toBe(true)
		expect(judgeDirection(dir(null, every(1, "the bridge speaks wire protocol none, this volt speaks 1: restart the IDE to load the updated bridge. Nothing was sent to it.")), SAME).green).toBe(true)
	})

	it("is red when the bridge that answered is not the release the direction meant — a mislabelled or wrong build", () => {
		const v = judgeDirection(dir(1, every(0, ""), { reported: "(dev) f15228b6a34fdec68c5e86c1d93b5eccd51e47bf", expected: "0.1.17931" }), SAME)
		expect(v.green).toBe(false)
		expect(v.why).toContain("reports release (dev) f15228b6a34fdec68c5e86c1d93b5eccd51e47bf, not 0.1.17931")
		expect(judgeDirection(dir(1, every(1, bridgeRefusal), { reported: null, expected: "0.1.17931" }), DIFFER).green).toBe(false)
	})
})

describe("what one release's wire has that the other's lacks", () => {
	const doc = loadOpenRpc() as unknown as OpenRpcLike
	const schemas = (d: OpenRpcLike) => d.components.schemas as Record<string, any>

	it("finds no gap between a document and itself", () => {
		expect(capabilityGap(doc, doc)).toEqual([])
	})

	it("names an op and a member one release has and the other lacks", () => {
		const older = structuredClone(doc)
		older.methods = older.methods.filter((m) => m.name !== "grep")
		delete schemas(older).FetchRequest.properties.onlyItems
		delete schemas(older).HealthResponse.properties.ops
		const gap = capabilityGap(older, doc)
		expect(gap).toContain(`op 'grep' is new (the previous bridge answers it BAD_REQUEST "unknown op"; health.ops tells a client)`)
		expect(gap).toContain("fetch: request member 'onlyItems' is new")
		expect(gap).toContain("health: response member 'ops' is new")
		expect(capabilityGap(doc, older)).toContain("op 'grep' is gone")
	})

	it("names a value one release's enum has and the other's lacks", () => {
		const older = structuredClone(doc)
		schemas(older).BridgeDiagnostic.properties.severity.enum = ["error", "warning"]
		expect(capabilityGap(older, doc)).toContain("build: response 'diagnostics[].severity' enum value \"info\" is new")
	})

	it("names a member renamed inside a nested schema an op's response references", () => {
		const older = structuredClone(doc)
		const item = schemas(older).FetchedItem.properties
		item.text = item.sourceText
		delete item.sourceText
		const gap = capabilityGap(older, doc)
		expect(gap.some((g) => /^fetch: response member '.*\.sourceText' is new$/.test(g))).toBe(true)
		expect(gap.some((g) => /^fetch: response member '.*\.text' is gone$/.test(g))).toBe(true)
	})

	it("names a member that became optional or nullable", () => {
		const older = structuredClone(doc)
		schemas(older).BridgeDiagnostic.required = (schemas(doc).BridgeDiagnostic.required as string[]).filter((r) => r !== "message")
		schemas(older).BridgeDiagnostic.properties.message = { type: ["string", "null"] }
		const gap = capabilityGap(older, doc)
		expect(gap).toContain("build: response member 'diagnostics[].message' is now required")
		expect(gap).toContain("build: response 'diagnostics[].message' type [\"null\",\"string\"] → \"string\"")
	})

	it("names a change to the envelope every op travels in", () => {
		const older = structuredClone(doc)
		delete schemas(older).Request.properties.protocol
		expect(capabilityGap(older, doc)).toContain("envelope Request: member 'protocol' is new")
		const none = structuredClone(doc)
		delete schemas(none).Request
		expect(capabilityGap(none, doc)).toContain("envelope 'Request' is new (the other document does not describe it)")
	})
})

describe("the cell over both directions", () => {
	const refusedBoth = [dir(1, every(1, clientRefusal)), dir(1, every(1, bridgeRefusal))]
	const gap = ["fetch: request member 'x' is new"]

	it("is green when one number spans two shapes and BOTH directions refuse every verb by name", () => {
		const r = judgeCell("0.1.1", "abc", refusedBoth, gap)
		expect(r.green).toBe(true)
		expect(r.undetectable).toContain("refused by name in both directions")
	})

	it("is red when one number spans two shapes and one direction is served", () => {
		const r = judgeCell("0.1.1", "abc", [refusedBoth[0], dir(1, every(0, ""))], gap)
		expect(r.green).toBe(false)
		expect(r.undetectable).toContain("SERVED")
	})

	it("judges a pair of one wire by its verbs working, and says there was nothing to refuse", () => {
		const r = judgeCell("0.1.1", "abc", [dir(1, every(0, ""))], [])
		expect(r.green).toBe(true)
		expect(r.undetectable).toContain("same shape")
	})
})

/** ONE WIRE, TWO TEXT FORMATS (openspec `language-line` 4.1; design.md "Not kept"): the body line is `%LANGUAGE <LANG>`
 *  from this release on, `IMPLEMENTATION <LANG>` before it, over an unchanged protocol 1. Each release's BRIDGE refuses
 *  the other's push by name, before any op — and that refusal, and only it, is a green push across the pair. */
describe("a pair of one wire whose text formats differ", () => {
	/** A rejected push as the CLI prints it with `--json`: .NET's encoder escapes `'`, `<`, `>`, a backtick and every
	 *  non-ASCII character as a `\u` + four hex digits sequence (measured in the log below). */
	const asCliPrints = (reason: string) =>
		JSON.stringify({ kind: "rejected", reason }).replace(/[^ -~]|['<>`]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"))
	/** The previous bridge (0.1.18026) refusing this CLI's `%LANGUAGE` text — measured 2026-10-27
	 *  (`dist/release-matrix/mixed-version/mixed-version.log`). */
	const previousBridge = asCliPrints("the bridge rejected the push:\n  Device/Plc Logic/Application/VltE2E_Mx.pou: [INVALID_ST] 'VltE2E_Mx' has no 'IMPLEMENTATION <ST|LD|FBD>' line — the text does not say where its declaration ends or what language its body is in. Run `volt pull` once to rewrite the workspace in the current format.")
	/** This bridge refusing the previous CLI's `IMPLEMENTATION` text (`PropertyLines.RetiredLineRefusal`), as that CLI prints it. */
	const currentBridge = asCliPrints("the bridge rejected the push:\n  Device/Plc Logic/Application/VltE2E_Mx.pou: [INVALID_ST] 'VltE2E_Mx' holds 'IMPLEMENTATION ST': `IMPLEMENTATION` is no longer read — pull again (it is now `%LANGUAGE <LANG>`).")
	/** The previous CLI's LOCAL read of a `%LANGUAGE` text it already pushed — measured 2026-10-27 after "push: 1/1": the
	 *  bridge had applied the push, so this is no refusal before any op. */
	const previousCliLocal = "applying: 0/1 (0%)\npush: 1/1 (100%)\nthis pou has no 'IMPLEMENTATION <ST|LD|FBD>' line — the text does not say where its declaration ends or what language its body is in. Run `volt pull` once to rewrite the workspace in the current format."
	const pushes = (exit: number, output: string) => every(0, "").map((r) => r.verb.startsWith("push") ? { ...r, exit, output } : r)

	it("is green when every push is refused by the other release's bridge for the text format, by name", () => {
		for (const refusal of [previousBridge, currentBridge]) {
			const v = judgeDirection(dir(1, pushes(2, refusal)), SAME)
			expect(v.green).toBe(true)
			expect(v.why).toContain("text format")
		}
	})

	it("is red when a push was applied and the CLI failed after it — not refused before any op", () => {
		expect(judgeDirection(dir(1, pushes(1, previousCliLocal)), SAME).green).toBe(false)
	})

	it("is red when a verb other than a push fails, even naming the format", () => {
		const runs = every(0, "").map((r) => r.verb === "build" ? { ...r, exit: 2, output: previousBridge } : r)
		expect(judgeDirection(dir(1, runs), SAME).green).toBe(false)
	})

	it("says in the cell's verdict that the formats differ and each push was refused by name", () => {
		const r = judgeCell("0.1.18026", "abc", [dir(1, pushes(2, previousBridge)), dir(1, pushes(2, currentBridge))], [])
		expect(r.green).toBe(true)
		expect(r.undetectable).toContain("text formats differ")
	})
})
