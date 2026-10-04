/**
 * THE LIVE REFUSAL TABLE — one minimal trigger per wire code a client can receive (openspec `bridge-refusal-review` 8.1).
 *
 * <p>Measured 2026-10-03: the live suite asserted 5 distinct codes of the vocabulary; every other refusal lived only in
 * the offline C# doubles, which cannot show what a real IDE does. This table is the live half. Every code in
 * `BridgeErrorCodes` / `ConflictCodes` has exactly one row here — a {@link LiveRow} that `matrix.test.ts` drives against
 * BOTH fixture IDEs, or a {@link NoTriggerRow} that says why no live trigger exists — and `Volt.Repo.Gates`
 * (`LiveRefusalTableTests`, 8.3) fails when a code has no row, so a code added later cannot go unproven in silence.</p>
 *
 * <p>Each live row states (a) the exact code, (b) what the message must name (the item, or for a frame the thing the
 * frame is about), (c) the project after the call — `unchanged` (a refusal before any write: `refs` equal to the refs
 * taken just before the call) or `receipt` (an apply-time stop: the next `refs` IS the receipt) — and (d) the answer
 * both vendors give, compared byte for byte after {@link normalize} (versions and the served project's own name are
 * masked: they are different projects).</p>
 *
 * <p><b>Format contract for the gate:</b> every row opens with `code: "<CODE>"` on its own line inside {@link ROWS}, and a
 * row with no live trigger carries `live: false` and a `reason`; the NETWORK_* rows carry the reason prefix
 * {@link DEFERRED_LD_FBD} (owner, 2026-10-03: live network-text tests need the LD/FBD coverage change first). A live
 * row's `divergence` opens with `divergence: { vendor: "<v>", answers: "<CODE>"` — the gate pins each one, so a new
 * divergence fails until the owner lists it (8.4).</p>
 */
import { callOn } from "../lib/pipe"
import { fb, MARK } from "../fixtures"

export const DEFERRED_LD_FBD = "deferred: LD/FBD design"

/** Every name a row creates starts with this, so a sweep can find what a timed-out row left behind. */
export const REF_PREFIX = "VltE2E_ref_"

export type Answer =
	| { kind: "frame"; code: string; message: string }
	| { kind: "push"; response: any }
	| { kind: "ok"; result: any }

/** One bridge, as a row sees it: the pipe plus the two facts a trigger needs from it. */
export type Bridge = {
	pipe: string
	vendor: "codesys" | "twincat"
	/** The served project's name, as `health` reports it — the one string WRONG_PROJECT and the masks need. */
	project: string
	call: (op: string, body?: unknown) => Promise<any>
}

/** Make one call and hand back the answer whatever it is: an error frame is data here, not an exception. */
export async function answer(b: Bridge, op: string, body?: unknown): Promise<Answer> {
	try {
		const result = await b.call(op, body)
		return op === "push" ? { kind: "push", response: result } : { kind: "ok", result }
	} catch (e) {
		const text = String((e as Error).message)
		const colon = text.indexOf(": ")
		if (colon < 0) throw e // a socket error, not an error frame
		return { kind: "frame", code: text.slice(0, colon), message: text.slice(colon + 2) }
	}
}

export async function refsOf(b: Bridge): Promise<any> {
	return b.call("refs")
}

/** A push behind a fresh project lease. */
export async function pushFresh(b: Bridge, ops: unknown[], extra: Record<string, unknown> = {}): Promise<Answer> {
	return answer(b, "push", { expectedProjectVersion: (await refsOf(b)).projectVersion, ops, ...extra })
}

export async function createFb(b: Bridge, bare: string, text = fb(bare)): Promise<void> {
	const r = await pushFresh(b, [{ op: "set", name: `${bare}.pou`, toFolder: "", sourceText: text, ifVersion: null }])
	if (r.kind !== "push" || r.response.accepted !== true || (r.response.conflicts ?? []).length)
		throw new Error(`${b.vendor}: setup create of '${bare}.pou' refused: ${JSON.stringify(r)}`)
}

/** Delete every `VltE2E_ref_*` item, readable or not (an unreadable one is named BARE and needs its kind back). */
export async function sweep(b: Bridge): Promise<void> {
	const refs = await refsOf(b)
	const mine = (n: string) => n.startsWith(REF_PREFIX)
	const ops = [
		...Object.keys(refs.items ?? {}).filter(mine).map((n) => ({ op: "deleteItem", name: n, ifVersion: null })),
		...(refs.unreadable ?? []).filter(mine).map((n: string) => ({ op: "deleteItem", name: `${n}.pou`, ifVersion: null })),
	]
	if (ops.length === 0) return
	const r = await b.call("push", { expectedProjectVersion: refs.projectVersion, force: true, ops })
	if (!r.accepted || (r.conflicts ?? []).length)
		throw new Error(`${b.vendor}: sweep could not delete ${ops.length} item(s): ${JSON.stringify(r.conflicts).slice(0, 400)}`)
}

/**
 * What a row hands back: the answer under test, and what the message must name. An apply-time stop (`after: "receipt"`)
 * also names what the project must hold after it — `landed` (the ops before the stop, written) and `absent` (the ops
 * after it, never tried) — because a receipt equal to the next refs proves nothing about a bridge that rolled the whole
 * push back, or wrote the op it calls NOT_ATTEMPTED anyway: the receipt matches refs either way.
 */
export type Outcome = { answer: Answer; names: string[]; item?: string; landed?: string[]; absent?: string[] }

export type LiveRow = {
	code: string
	live: true
	trigger: string
	/** `unchanged`: refused before any write. `receipt`: an apply-time stop — the next refs is the receipt. */
	after: "unchanged" | "receipt"
	/** Creates what the trigger needs. Runs BEFORE the "before" refs is taken. */
	setup?: (b: Bridge, n: (s: string) => string) => Promise<void>
	run: (b: Bridge, n: (s: string) => string) => Promise<Outcome>
	/** Undo what `run` did to the connection (the items are swept). */
	restore?: (b: Bridge) => Promise<void>
	/**
	 * A vendor on which this trigger does NOT produce the code — an IRREDUCIBLE vendor fact, measured against at least two
	 * other vendor paths and LISTED FOR THE OWNER (8.4), never accepted here. On that vendor the row asserts what it answers
	 * instead (`answers`, with the item named and nothing written), so the divergence is pinned: when the vendors
	 * converge the parity half fails and says to take this off.
	 */
	divergence?: { vendor: "codesys" | "twincat"; answers: string; why: string }
}

export type NoTriggerRow = { code: string; live: false; reason: string }

export type Row = LiveRow | NoTriggerRow

/** The conflict of one item in a push answer. */
export function conflictOf(a: Answer, name: string): any {
	if (a.kind !== "push") return undefined
	return (a.response.conflicts ?? []).find((c: any) => c.name === name)
}

/**
 * Mask what MAY differ between two vendors' answers to the same trigger, and nothing else: content hashes (each IDE
 * hashes its own export of a different project), and the served project's / vendor's own name where a message quotes
 * it. Everything that is left — every key, every code, every word Volt writes — must be byte-identical.
 */
export function normalize(a: Answer, b: Bridge): unknown {
	const text = (s: string) => {
		let t = s.split(b.project).join("<project>").replace(new RegExp(`\\b${b.vendor}\\b`, "gi"), "<vendor>")
		for (const [said, as] of IDE_WORDS) t = t.replace(said, as)
		return t
	}
	const walk = (v: any, key?: string): any => {
		if (typeof v === "string")
			return /version/i.test(key ?? "") || key === "newProjectVersion" ? "<v>" : text(v)
		if (Array.isArray(v)) return v.map((x) => walk(x))
		if (v && typeof v === "object") {
			const out: Record<string, any> = {}
			for (const k of Object.keys(v).sort()) {
				// The receipt maps every item of the project to its version: the item set is the project's, not the
				// answer's. What the answer says about OUR items is kept, the rest of the project is not compared.
				if (k === "newItems" || k === "newFolders" || k === "newSources") {
					const mine = Object.keys(v[k] ?? {}).filter((n) => n.startsWith(REF_PREFIX)).sort()
					out[k] = Object.fromEntries(mine.map((n) => [n, k === "newFolders" ? v[k][n] : "<v>"]))
					continue
				}
				out[k] = walk(v[k], k)
			}
			return out
		}
		return v
	}
	return walk(a)
}

/**
 * The IDE's OWN sentence for one refusal, per vendor, as each IDE words it (measured live 2026-10-04, this matrix; the
 * drivers' `Refusal` quote it verbatim and nothing around it). Volt quotes the IDE's reason so the engineer reads what
 * their IDE said; the sentence is the only part of an answer that is the vendor's, so it is the only part masked. Every
 * entry is a measured sentence — a new difference is never masked by adding a pattern here without its measurement.
 */
const IDE_WORDS: [RegExp, string][] = [
	// a member or POU NAME the IDE refuses (DIALECT C2k; push-keeps-what-landed 1.1 / 1.G F3)
	[/The name '([^']*)' is not valid for this object\./g, "<the IDE refuses the name '$1'>"],
	// TwinCAT's sentence ends without a period; where Volt quotes it as a sentence it adds one (PushService's member
	// refusal), which CODESYS's own period makes unnecessary there — Volt's punctuation, absorbed with the sentence.
	[/Creating the child named '([^']*)' is not possible on node \(Name mismatch\)\.?/g, "<the IDE refuses the name '$1'>"],
]

const METHOD_NAMED = (name: string) =>
	`\nMETHOD ${name} : BOOL\nVAR_INPUT\n\tmsg : STRING;\nEND_VAR\n${MARK}\n${name} := TRUE;\nEND_METHOD\n`

/** A name no probe asked about that both IDEs refuse as a member name at APPLY time (`push-keeps-what-landed`). */
const REFUSED_AT_APPLY = "Vlt__Log"

export const ROWS: Row[] = [
	// ── the frame codes ──────────────────────────────────────────────────────────────────────────────────────
	{
		code: "PLC_DISCONNECTED",
		live: true,
		trigger: "`disconnect` (the tray's pause), then `refs`",
		after: "unchanged",
		run: async (b) => {
			await b.call("disconnect")
			return { answer: await answer(b, "refs"), names: ["Reconnect"] }
		},
		restore: async (b) => {
			await b.call("connect", { project: b.project })
		},
	},
	{
		code: "WRONG_PROJECT",
		live: true,
		trigger: "`refs` naming a project the bridge does not serve (`expectedProjectName`)",
		after: "unchanged",
		run: async (b, n) => {
			const other = n("other")
			return { answer: await answer(b, "refs", { expectedProjectName: other }), names: [other] }
		},
	},
	{
		code: "IDE_UNSUPPORTED",
		live: false,
		reason:
			"raised only by an IDE below the bridge's minimum (CODESYS older than SP21 — openspec codesys-minimum-version); " +
			"both fixture IDEs meet it (CODESYS SP21, TwinCAT 3.1.4024), and SP18 is installed but never used (codesys-sp21-only)",
	},
	{
		code: "IDE_BUSY",
		live: true,
		trigger: "three `build`s sent at once (openspec codesys-build-nesting): the first holds the IDE, the others are refused",
		after: "unchanged",
		run: async (b) => {
			const all = await Promise.all([answer(b, "build"), answer(b, "build"), answer(b, "build")])
			const refused = all.filter((a) => a.kind === "frame")
			if (all.length - refused.length !== 1)
				throw new Error(`${b.vendor}: expected exactly one build to run, got ${JSON.stringify(all).slice(0, 600)}`)
			return { answer: refused[0], names: ["build or push", "nothing was applied"] }
		},
	},
	{
		code: "IDE_SAVE_FAILED",
		live: false,
		reason:
			"raised when TwinCAT's File.SaveAll throws; no fixture state makes the XAE refuse a save without a modal dialog " +
			"(a read-only .TcPOU opens a 'file is read-only' prompt, and a modal window blocks every COM call — " +
			"twincat-com-automation-traps). CODESYS saves nothing on push (the project file is written on SAVE only, " +
			"test/e2e/README 'storage model'), so the code has no CODESYS situation at all",
	},
	{
		code: "BAD_REQUEST",
		live: true,
		trigger: "a `fetch` with no baseline (no `knownItems`, no `onlyItems`, no `init`)",
		after: "unchanged",
		run: async (b) => ({ answer: await answer(b, "fetch", {}), names: ["knownItems", "init"] }),
	},
	{
		code: "UNSUPPORTED",
		live: true,
		trigger: "a create of an FB whose METHOD is named `Log` (a name both IDEs refuse — measured, pre-flight)",
		after: "unchanged",
		run: async (b, n) => {
			const name = `${n("unsup")}.pou`
			const a = await pushFresh(b, [
				{ op: "set", name, toFolder: "", sourceText: fb(n("unsup"), { children: METHOD_NAMED("Log") }), ifVersion: null },
			])
			return { answer: a, names: [n("unsup"), "Log"], item: name }
		},
	},
	{
		code: "INTERNAL_ERROR",
		live: false,
		reason:
			"means Volt's own broken invariant or a refusal nobody coded (wire.html); a live trigger IS a bug, fixed by coding " +
			"the refusal — the uncoded-throw census in WireVocabularyTests holds the sites that could still raise it",
	},
	{
		code: "IDE_LOST_ITEM",
		live: false,
		reason:
			"a post-condition: the IDE acknowledged a write and then does not hold it. No request makes a healthy IDE lose " +
			"what it just took; the offline doubles (FakeIde DropsOnMove, TcMemberMovePostConditionTests) are its proof",
	},
	{
		code: "DUPLICATE_CHILD",
		live: true,
		trigger: "a create of an FB declaring two METHODs of one name",
		after: "unchanged",
		run: async (b, n) => {
			const name = `${n("dup")}.pou`
			const a = await pushFresh(b, [
				{ op: "set", name, toFolder: "", sourceText: fb(n("dup"), { children: METHOD_NAMED("Twice") + METHOD_NAMED("Twice") }), ifVersion: null },
			])
			return { answer: a, names: [n("dup"), "Twice"], item: name }
		},
	},
	{
		code: "INVALID_ST",
		live: true,
		trigger: "a create whose text is not a POU at all",
		after: "unchanged",
		run: async (b, n) => {
			const name = `${n("inv")}.pou`
			const a = await pushFresh(b, [{ op: "set", name, toFolder: "", sourceText: "not a POU at all", ifVersion: null }])
			return { answer: a, names: [n("inv")], item: name }
		},
	},
	{
		code: "UNREADABLE",
		live: true,
		trigger: "a create over a POU the IDE holds and Volt cannot read (a text whose opening comment never closes)",
		after: "unchanged",
		divergence: {
			vendor: "codesys",
			answers: "ITEM_EXISTS",
			why:
				"CODESYS reads such a POU by its class and fetches it back as written, so the create collides with an item it " +
				"lists; TwinCAT stores no POU type (neither the .TcPOU nor the .plcproj — measured 2026-10-04, " +
				"scripts/tc-broken-pou.log), derives it from the text at load, and touching the tree item of one it could " +
				"not type crashes XAE (DIALECT C2i), so the snapshot names it `unreadable`. Measured alternatives: (1) the " +
				".TcPOU file (holds the text, no type), (2) the tree item in the session that wrote it (reads, ItemType 604 — " +
				"safe only until a reload, and a project reload-from-disk is not measured to invalidate the worker's handle), " +
				"(3) the DTE project model (no ProjectItems on TcXaeShell). Listed for the owner: DIALECT C2i, 8.4",
		},
		setup: async (b, n) => {
			await createFb(
				b,
				n("unread"),
				`(* Motor\n *\nFUNCTION_BLOCK ${n("unread")}\nVAR\n\tn : INT;\nEND_VAR\n${MARK}\nn := n + 1;\nEND_FUNCTION_BLOCK\n`,
			)
		},
		run: async (b, n) => {
			const name = `${n("unread")}.pou`
			const a = await pushFresh(b, [{ op: "set", name, toFolder: "", sourceText: fb(n("unread")), ifVersion: null }])
			return { answer: a, names: [], item: name }
		},
	},

	// ── the optimistic gate and the apply loop ──────────────────────────────────────────────────────────────
	{
		code: "STALE_PROJECT_VERSION",
		live: true,
		trigger: "a push carrying a project lease that is not the current one",
		after: "unchanged",
		run: async (b, n) => {
			const name = `${n("stalep")}.pou`
			const a = await answer(b, "push", {
				expectedProjectVersion: "deadbeef",
				ops: [{ op: "set", name, toFolder: "", sourceText: fb(n("stalep")), ifVersion: null }],
			})
			return { answer: a, names: [], item: "<project>" }
		},
	},
	{
		code: "STALE_ITEM_VERSION",
		live: true,
		trigger: "an update guarded by an item version the IDE has moved past",
		after: "unchanged",
		setup: async (b, n) => createFb(b, n("stalei")),
		run: async (b, n) => {
			const name = `${n("stalei")}.pou`
			const a = await pushFresh(b, [
				{ op: "set", name, sourceText: fb(n("stalei"), { body: "x := 5;" }), ifVersion: "0123456789abcdef" },
			])
			return { answer: a, names: [], item: name }
		},
	},
	{
		code: "ITEM_EXISTS",
		live: true,
		trigger: "a create of a name the IDE already holds",
		after: "unchanged",
		setup: async (b, n) => createFb(b, n("exists")),
		run: async (b, n) => {
			const name = `${n("exists")}.pou`
			const a = await pushFresh(b, [{ op: "set", name, toFolder: "", sourceText: fb(n("exists")), ifVersion: null }])
			return { answer: a, names: [], item: name }
		},
	},
	{
		code: "ITEM_MISSING",
		live: true,
		trigger: "an update of a name the IDE does not hold (complete walk)",
		after: "unchanged",
		run: async (b, n) => {
			const name = `${n("missing")}.pou`
			const a = await pushFresh(b, [{ op: "set", name, sourceText: fb(n("missing")), ifVersion: "0123456789abcdef" }])
			return { answer: a, names: [], item: name }
		},
	},
	{
		code: "ITEM_UNVERIFIED",
		live: false,
		reason:
			"raised when the IDE cannot enumerate where an item lives (a refused child/name read, or a TwinCAT hierarchy that " +
			"does not vouch for a folder — DIALECT C2i). Neither fixture IDE refuses an enumeration; the one TwinCAT state that " +
			"reaches the C2i guard (a POU loaded broken after a reload) is named UNREADABLE per item, and forcing a reload " +
			"that crashes XAE is no test. Offline: ErrorCodeVocabularyTests (FakeIde FaultingChildReads/FaultingNameReads)",
	},
	{
		code: "NOT_ATTEMPTED",
		live: true,
		trigger: "[create A, create an FB whose METHOD the IDE refuses at apply (`Vlt__Log`), create C] — C is never tried",
		after: "receipt",
		run: async (b, n) => {
			const first = `${n("na_a")}.pou`, refused = `${n("na_b")}.pou`, never = `${n("na_c")}.pou`
			const a = await pushFresh(b, [
				{ op: "set", name: first, toFolder: "", sourceText: fb(n("na_a")), ifVersion: null },
				{ op: "set", name: refused, toFolder: "", sourceText: fb(n("na_b"), { children: METHOD_NAMED(REFUSED_AT_APPLY) }), ifVersion: null },
				{ op: "set", name: never, toFolder: "", sourceText: fb(n("na_c")), ifVersion: null },
			])
			return { answer: a, names: [], item: never, landed: [first], absent: [never] }
		},
	},

	// ── the graphical body format (owner, 2026-10-03: live network-text tests wait for the LD/FBD design) ───
	{ code: "NETWORK_PARSE", live: false, reason: `${DEFERRED_LD_FBD} — network text that does not parse` },
	{ code: "NETWORK_NOT_CLOSED", live: false, reason: `${DEFERRED_LD_FBD} — a NETWORK block with no END_NETWORK` },
	{ code: "NETWORK_DUPLICATE_NAME", live: false, reason: `${DEFERRED_LD_FBD} — a wire declared twice` },
	{ code: "NETWORK_BAD_EXPRESSION", live: false, reason: `${DEFERRED_LD_FBD} — a malformed operator group` },
	{ code: "NETWORK_UNKNOWN_OPERATOR", live: false, reason: `${DEFERRED_LD_FBD} — an operator outside the FBD/LD table` },
	{ code: "NETWORK_UNSUPPORTED", live: false, reason: `${DEFERRED_LD_FBD} — a body shape network text has no spelling for` },
]

/** Bind a pipe to a {@link Bridge}: the served project's name comes from `health` (a TwinCAT XAE serves nothing until
 *  told, so this selects the first detected project and waits for it — the same thing `requireHealthy` does). */
export async function bindBridge(pipe: string, vendor: "codesys" | "twincat"): Promise<Bridge> {
	const call = (op: string, body?: unknown) => callOn(pipe, op, body)
	const t0 = Date.now()
	while (Date.now() - t0 < 90_000) {
		const h = await call("health").catch(() => ({ projects: [] }))
		const served = (h.projects ?? []).find((p: any) => p.status && p.status !== "idle")
		if (served) return { pipe, vendor, project: served.project, call }
		const first = (h.projects ?? [])[0]
		if (first) await call("connect", { project: first.project }).catch(() => {})
		await new Promise((r) => setTimeout(r, 1500))
	}
	throw new Error(`${vendor}: ${pipe} never served a project within 90 s`)
}
