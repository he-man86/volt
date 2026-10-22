/**
 * THE CONTRACT SUITE (openspec `volt-cli-rework` 1.3): the bridge judged as a PUBLIC API. PLC Assist ships the bridge
 * bundles and drives the pipe itself, so every request the schema allows is a request the bridge must answer as
 * `wire.html` promises — not only the ones our CLI happens to send.
 *
 * <p>Requests come from `docs/volt-bridge.openrpc.json` (`lib/openrpc.ts`), not from the CLI's DTOs: for every op and
 * every request member the schema names, the suite sends the member in another case, an unknown member, each required
 * member missing, each member of another JSON type, the members in another order, a body that is no object, the op in
 * another case, frames that are not requests at all, and then the awkward combinations — a taken name, the same item
 * twice, an unknown path, empty and boundary values. Each answer must</p>
 * <ul>
 *   <li>be framed as wire.html#framing says (one key per frame, progress first, one terminal frame);</li>
 *   <li>conform to the method's result schema, strictly (a member the document does not name is drift);</li>
 *   <li>carry an error code the op declares (`x-errorCodes`, plus BAD_REQUEST, which wire.html gives every request), and
 *       never INTERNAL_ERROR: every case here is a request or an IDE state, never a Volt bug;</li>
 *   <li>be the answer wire.html promises for that case, where it promises one; where it promises none the case is an
 *       OBSERVATION — recorded, judged only by the rules above.</li>
 * </ul>
 *
 * <p>A defect the suite finds is a FINDING (`FINDINGS`): the case still runs and must still answer the way the finding
 * says, so the day the bridge is fixed the case goes red and the entry is deleted — the red-first mark the C# suites
 * keep (`ExpectRed`). Every case's answer is written to `VOLT_CONTRACT_REPORT` (JSON lines) when set: the release
 * matrix keeps one per cell.</p>
 *
 * <p>Read-only ops run freely. Writes touch only `VltE2E_Ctr*` items this file creates, and clean up after themselves
 * (`cleanup` sweeps the prefix) — the same rule as every e2e file.</p>
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { appendFileSync } from "node:fs"
import { callRaw, currentPipe, BASE, VENDOR, type RawAnswer } from "../lib/pipe"
import { bridge } from "../lib/bridge"
import { cleanup, plcFolder, requireHealthy, folderOf, inFolder } from "../lib/workspace"
import { drivenApplication } from "../lib/main-program"
import { bodySchema, loadOpenRpc, method, otherCase, reversed, sample, validate, wrongType, type Method } from "../lib/openrpc"
import { fb, structDut } from "../fixtures"

const DOC = loadOpenRpc()
const REPORT = process.env.VOLT_CONTRACT_REPORT

/**
 * The defects this suite found, by case id, with what the bridge answers instead of what wire.html promises. A case
 * listed here must STILL show the defect (the assertion is inverted); when it is fixed the case fails and its entry goes.
 */
const FINDINGS: Record<string, string> = {
	// Found 2026-10-22 on CODESYS 3.5.21.40 and TwinCAT MultiProject (both vendors: the cause is shared Core).
	"health/unknown-member":
		"answered as if the member were absent: BridgePipeHost's `health` arm never reads its body, so the strict reader " +
		"never sees it (pinned in Volt.Repo.Gates WireRulesHaveOneImplementationTests.UnreadBodyPins)",
	"disconnect/unknown-member":
		"answered ok — and the bridge paused — as if the member were absent: the `disconnect` arm never reads its body",
	"push/missing:ops":
		"accepted:true with no conflict: a push without its required `ops` reads as an empty list (the strict reader " +
		"refuses unknown members, not missing required ones)",
	"push/null:ops":
		"INTERNAL_ERROR (NullReferenceException): `ops: null` reaches PushService as a null list — a request answered as a Volt bug",
	"unknown/delete":
		"accepted:true with no conflict: a deleteItem quoting a version for a path that names nothing is answered as done, " +
		"where wire.html promises ITEM_MISSING (\"you quoted a version for an item that is gone\")",
}

// ── one answer, judged ───────────────────────────────────────────────────────────────────────────────────────────────

type Answer = {
	raw: RawAnswer
	/** What the frames broke of wire.html#framing, the result schema or the code rules — empty when they conform. */
	broken: string[]
	error?: { code: string; message: string }
	result?: any
}

function frameOf(op: string | undefined, body: unknown, bodyKey = true): string {
	const env: Record<string, unknown> = { op }
	if (bodyKey && body !== undefined) env.body = body
	return JSON.stringify(env)
}

/** Every code an op may answer: its declared `x-errorCodes`, and BAD_REQUEST, which wire.html gives every request
 *  ("the request breaks the wire's own rules, whichever phase meets it"). An unknown op may answer only BAD_REQUEST. */
function allowedCodes(m: Method | undefined): Set<string> {
	return new Set([...(m?.["x-errorCodes"] ?? []), "BAD_REQUEST"])
}

function judge(raw: RawAnswer, m: Method | undefined): Answer {
	const broken: string[] = []
	const frames = raw.frames
	if (frames.length === 0) broken.push("framing: the bridge answered no frame")
	frames.forEach((f, i) => {
		if ("unparsed" in f) return broken.push(`framing: frame ${i} is not JSON: ${String(f.unparsed).slice(0, 120)}`)
		const keys = Object.keys(f)
		if (keys.length !== 1 || !["progress", "result", "error"].includes(keys[0]))
			broken.push(`framing: frame ${i} carries ${JSON.stringify(keys)}, not exactly one of progress/result/error`)
		const terminal = keys[0] === "result" || keys[0] === "error"
		if (terminal && i !== frames.length - 1) broken.push(`framing: a terminal frame at ${i} is not the last of ${frames.length}`)
		if (!terminal && i === frames.length - 1) broken.push("framing: the last frame is not terminal")
		if (keys[0] === "progress") {
			const p = f.progress
			if (typeof p?.operation !== "string" || typeof p?.done !== "number")
				broken.push(`framing: progress frame ${i} lacks operation/done: ${JSON.stringify(p)}`)
		}
	})
	const last = frames[frames.length - 1] ?? {}
	const answer: Answer = { raw, broken }
	if ("error" in last) {
		const e = last.error
		if (typeof e?.code !== "string" || typeof e?.message !== "string") broken.push(`error frame without code/message: ${JSON.stringify(e)}`)
		answer.error = e
		if (e?.code === "INTERNAL_ERROR") broken.push(`INTERNAL_ERROR for a request or an IDE state: ${e.message}`)
		else if (!allowedCodes(m).has(e?.code))
			broken.push(`error code ${e?.code} is not one ${m ? `'${m.name}' declares (x-errorCodes ${JSON.stringify(m["x-errorCodes"])})` : "an unknown op may answer"}`)
	} else if ("result" in last) {
		answer.result = last.result
		if (m) for (const why of validate(DOC, m.result.schema, last.result, { strict: true })) broken.push(`result schema: ${why}`)
		else broken.push("an unknown op answered a result")
		for (const c of last.result?.conflicts ?? [])
			if (c?.code === "INTERNAL_ERROR") broken.push(`a conflict coded INTERNAL_ERROR for a request or an IDE state: ${c.name}: ${c.reason}`)
	}
	return answer
}

/** The code an answer refused with — the error frame's, or (a push) the first conflict's on `accepted:false`. */
function refusal(a: Answer): string | undefined {
	if (a.error) return a.error.code
	if (a.result?.accepted === false) return a.result.conflicts?.[0]?.code ?? "(accepted:false without a conflict)"
	return undefined
}

function summary(a: Answer): unknown {
	if (a.error) return { error: a.error.code, message: a.error.message.slice(0, 300) }
	const r = a.result
	if (r && typeof r === "object" && "accepted" in r)
		return { accepted: r.accepted, conflicts: (r.conflicts ?? []).map((c: any) => ({ name: c.name, code: c.code, reason: String(c.reason).slice(0, 200) })) }
	return { result: Object.keys(r ?? {}) }
}

// ── a case ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A promise wire.html makes about one answer: null when the answer keeps it, else what it broke. */
type Promise_ = (a: Answer) => string | null

const refusedWith = (code: string): Promise_ => (a) =>
	refusal(a) === code ? null : `wire.html promises ${code}; the bridge answered ${JSON.stringify(summary(a))}`
const answered: Promise_ = (a) => (a.error || a.result?.accepted === false ? `expected an answer; got ${JSON.stringify(summary(a))}` : null)
/** No promise beyond the general rules: the case is an observation. */
const observed: Promise_ = () => null

async function contractCase(id: string, op: string | undefined, send: () => Promise<RawAnswer>, promise: Promise_, extra?: (a: Answer) => string | null) {
	const m = op ? DOC.methods.find((x) => x.name === op) : undefined
	const a = judge(await send(), m)
	const broken = [...a.broken]
	const p = promise(a)
	if (p) broken.push(p)
	const x = extra?.(a)
	if (x) broken.push(x)
	if (REPORT)
		appendFileSync(REPORT, JSON.stringify({ vendor: VENDOR, id, op, promise: promise === observed ? "observation" : "promised", kept: broken.length === 0, finding: FINDINGS[id] ?? null, broken, answer: summary(a) }) + "\n")
	const finding = FINDINGS[id]
	if (finding)
		expect(broken.length, `FINDING ${id} is no longer reproduced — the bridge now keeps the contract here; delete its FINDINGS entry ("${finding}")`).toBeGreaterThan(0)
	else expect(broken, `${id}: the answer breaks the contract`).toEqual([])
	return a
}

const send = (op: string | undefined, body?: unknown) => () => callRaw(currentPipe(), frameOf(op, body))
const sendRaw = (frame: string | Buffer) => () => callRaw(currentPipe(), frame)

// ── the state the cases run against ──────────────────────────────────────────────────────────────────────────────────

const ctx = {
	identity: { expectedPlatform: "", expectedProjectName: "" },
	served: "",
	folder: "",
	apps: [] as string[],
	a: "",   // VltE2E_CtrA.pou — a function block the writes address
	b: "",   // VltE2E_CtrB.pou — a second one, the taken name
}
const A = "VltE2E_CtrA", B = "VltE2E_CtrB"

/** The body each op's generated variations start from: a request that conforms and that the bridge answers. Push and
 *  build carry the identity they require; push sends no op (the shape is what varies); fetch names one test item. */
function baseBody(op: string): Record<string, unknown> {
	switch (op) {
		case "connect": return { project: ctx.served }
		case "refs": return { expectedPlatform: ctx.identity.expectedPlatform, expectedProjectName: ctx.identity.expectedProjectName }
		case "fetch": return { onlyItems: [ctx.a] }
		case "push": return { ...ctx.identity, ops: [] }
		case "build": return { ...ctx.identity, applications: [ctx.apps[0]] }
		case "grep": return { pattern: A, limit: 5 }
	}
	throw new Error(`no base body for '${op}'`)
}

/** What a reordered request must answer identically to: the code, or the result as JSON (reads), or the verdict. */
function sameAnswer(x: Answer, y: Answer): string | null {
	const key = (a: Answer) => a.error ? `error ${a.error.code}` : JSON.stringify(a.result?.accepted !== undefined || a.result?.success !== undefined
		? { accepted: a.result.accepted, success: a.result.success, codes: (a.result.conflicts ?? []).map((c: any) => c.code) }
		: a.result)
	return key(x) === key(y) ? null : `members in another order answered differently: ${key(x).slice(0, 200)} vs ${key(y).slice(0, 200)}`
}

describe(`contract / the bridge against its OpenRPC document (${BASE})`, () => {
	setDefaultTimeout(180_000)

	beforeAll(async () => {
		await requireHealthy()
		await cleanup()
		const refs = await bridge.refs()
		ctx.identity = { expectedPlatform: refs.platform, expectedProjectName: refs.projectName }
		ctx.apps = refs.applications
		const h = await bridge.health()
		ctx.served = h.projects.find((p: any) => p.status !== "idle").project
		ctx.folder = await plcFolder("POUs")
		ctx.a = inFolder(ctx.folder, `${A}.pou`)
		ctx.b = inFolder(ctx.folder, `${B}.pou`)
		const created = await bridge.push({
			...ctx.identity, expectedProjectVersion: refs.projectVersion,
			ops: [{ op: "set", name: ctx.a, sourceText: fb(A) }, { op: "set", name: ctx.b, sourceText: fb(B) }],
		})
		expect(created.accepted && !created.conflicts?.length, `the contract suite's test items: ${JSON.stringify(created.conflicts)}`).toBe(true)
	})

	afterAll(async () => {
		await bridge.connect({ project: ctx.served }).catch(() => {})
		await cleanup()
	})

	it("the document describes every op the bridge serves, and the bridge serves every op it describes", async () => {
		const h = await bridge.health()
		expect([...h.ops].sort()).toEqual(DOC.methods.map((m) => m.name).sort())
		expect(String(h.protocol)).toBe(DOC.info.version)
	})

	// ── generated from the schema: every op, every member ────────────────────────────────────────────────────────────

	for (const m of DOC.methods) {
		const schema = bodySchema(DOC, m)
		const op = m.name
		// `disconnect` pauses the bridge and a `connect` may re-point it (an empty select takes the first project on
		// TwinCAT): every case on either is followed by a connect back to the served project.
		const after = op === "disconnect" || op === "connect" ? () => bridge.connect({ project: ctx.served }).then(() => {}) : async () => {}
		const guarded = (name: string, fn: () => Promise<unknown>) => it(name, async () => { try { await fn() } finally { await after() } })

		describe(`op '${op}'`, () => {
			guarded(`${op}: the op in another case is an unknown op`, async () => {
				await contractCase(`${op}/op-other-case`, undefined, send(op.toUpperCase(), schema ? baseBody(op) : undefined), refusedWith("BAD_REQUEST"))
			})

			if (!schema) {
				// health / disconnect take no params; wire.html still gives every request "a body member the op does not have".
				guarded(`${op}: a body member the op does not have is BAD_REQUEST`, async () => {
					try { await contractCase(`${op}/unknown-member`, op, send(op, { zzUnknown: 1 }), refusedWith("BAD_REQUEST")) } finally { await after() }
				})
				guarded(`${op}: an empty body is answered`, async () => {
					try { await contractCase(`${op}/empty-body`, op, send(op, {}), answered) } finally { await after() }
				})
				return
			}

			const props = Object.entries(schema.properties ?? {})
			const required = schema.required ?? []

			guarded(`${op}: a conforming body is answered`, async () => {
				await contractCase(`${op}/base`, op, () => callRaw(currentPipe(), frameOf(op, baseBody(op))), answered)
			})
			guarded(`${op}: a body member the op does not have is BAD_REQUEST`, async () => {
				await contractCase(`${op}/unknown-member`, op, () => callRaw(currentPipe(), frameOf(op, { ...baseBody(op), zzUnknown: 1 })), refusedWith("BAD_REQUEST"))
			})
			for (const [name, p] of props) {
				guarded(`${op}: member '${name}' in another case is a member the op does not have`, async () => {
					const body = { ...baseBody(op) }
					const value = name in body ? body[name] : sample(DOC, p)
					delete body[name]
					body[otherCase(name)] = value
					await contractCase(`${op}/other-case:${name}`, op, () => callRaw(currentPipe(), frameOf(op, body)), refusedWith("BAD_REQUEST"))
				})
				guarded(`${op}: member '${name}' of another JSON type is BAD_REQUEST`, async () => {
					await contractCase(`${op}/wrong-type:${name}`, op, () => callRaw(currentPipe(), frameOf(op, { ...baseBody(op), [name]: wrongType(DOC, p) })), refusedWith("BAD_REQUEST"))
				})
				if (op !== "build")
					guarded(`${op}: member '${name}' as null (observation)`, async () => {
						await contractCase(`${op}/null:${name}`, op, () => callRaw(currentPipe(), frameOf(op, { ...baseBody(op), [name]: null })), observed)
					})
			}
			for (const r of required)
				guarded(`${op}: without its required member '${r}' is BAD_REQUEST`, async () => {
					const body = { ...baseBody(op) }
					delete body[r]
					await contractCase(`${op}/missing:${r}`, op, () => callRaw(currentPipe(), frameOf(op, body)), refusedWith("BAD_REQUEST"))
				})
			guarded(`${op}: its members in another order answer the same`, async () => {
				const base = await contractCase(`${op}/base-for-order`, op, () => callRaw(currentPipe(), frameOf(op, baseBody(op))), observed)
				await contractCase(`${op}/members-reordered`, op, () => callRaw(currentPipe(), frameOf(op, reversed(baseBody(op)))), observed, (a) => sameAnswer(base, a))
				await contractCase(`${op}/envelope-reordered`, op, () => callRaw(currentPipe(), JSON.stringify({ body: baseBody(op), op })), observed, (a) => sameAnswer(base, a))
			})
			guarded(`${op}: a body that is no object is BAD_REQUEST`, async () => {
				await contractCase(`${op}/body-array`, op, send(op, []), refusedWith("BAD_REQUEST"))
				await contractCase(`${op}/body-string`, op, send(op, "x"), refusedWith("BAD_REQUEST"))
			})
		})
	}

	// ── frames that are no request ───────────────────────────────────────────────────────────────────────────────────

	describe("frames", () => {
		it("a frame that is not JSON is BAD_REQUEST", async () => {
			await contractCase("frame/not-json", undefined, sendRaw('{"op":"refs",'), refusedWith("BAD_REQUEST"))
		})
		it("an empty frame is BAD_REQUEST", async () => {
			await contractCase("frame/empty", undefined, sendRaw(""), refusedWith("BAD_REQUEST"))
		})
		it("a JSON null or array frame is BAD_REQUEST", async () => {
			await contractCase("frame/null", undefined, sendRaw("null"), refusedWith("BAD_REQUEST"))
			await contractCase("frame/array", undefined, sendRaw("[]"), refusedWith("BAD_REQUEST"))
		})
		it("an unknown op is BAD_REQUEST", async () => {
			await contractCase("frame/unknown-op", undefined, send("frobnicate", {}), refusedWith("BAD_REQUEST"))
		})
		it("an envelope with its `op` in another case names no op: BAD_REQUEST", async () => {
			await contractCase("frame/envelope-op-other-case", undefined, sendRaw(JSON.stringify({ OP: "refs", body: {} })), refusedWith("BAD_REQUEST"))
		})
		it("an envelope member beside op and body (observation)", async () => {
			await contractCase("frame/envelope-unknown-member", "refs", sendRaw(JSON.stringify({ op: "refs", body: {}, zz: 1 })), observed)
		})
		it("a frame over the 64 MiB cap is BAD_REQUEST, unread", async () => {
			const over = Buffer.alloc(64 * 1024 * 1024 + 1, 0x20)
			await contractCase("frame/over-cap", undefined, sendRaw(over), refusedWith("BAD_REQUEST"))
		})
	})

	// ── addressed paths ignore case; held keys are exact (wire.html#identity) ─────────────────────────────────────────

	describe("case", () => {
		it("fetch: an addressed path in another case finds the item, answered in the IDE's spelling", async () => {
			await contractCase("case/fetch-onlyItems", "fetch", send("fetch", { onlyItems: [ctx.a.toLowerCase()] }), answered, (a) =>
				a.result?.changed?.length === 1 && a.result.changed[0].name === ctx.a ? null
					: `expected one changed item named '${ctx.a}'; got ${JSON.stringify((a.result?.changed ?? []).map((c: any) => c.name))}`)
		})
		it("refs: a held key in another case is exact — removed, and the item listed in its own spelling", async () => {
			const v = (await bridge.refs()).items[ctx.a]
			await contractCase("case/refs-knownItems", "refs", send("refs", { knownItems: { [ctx.a.toLowerCase()]: v } }), answered, (a) =>
				a.result?.removed?.includes(ctx.a.toLowerCase()) && a.result?.items?.[ctx.a] === v ? null
					: `expected removed ∋ '${ctx.a.toLowerCase()}' and items['${ctx.a}']; got removed ${JSON.stringify(a.result?.removed)}`)
		})
		it("push: an update addressed in another case lands on the item", async () => {
			const refs = await bridge.refs()
			await contractCase("case/push-update", "push", send("push", { ...ctx.identity, ops: [{ op: "set", name: ctx.a.toLowerCase(), ifVersion: refs.items[ctx.a], sourceText: fb(A, { body: "x := x + 2;" }) }] }), answered, (a) =>
				a.result?.newItems && ctx.a in a.result.newItems ? null : `expected newItems keyed '${ctx.a}'; got ${JSON.stringify(Object.keys(a.result?.newItems ?? {}))}`)
		})
		it("push: one item twice, once in another case, is BAD_REQUEST before anything is applied", async () => {
			const refs = await bridge.refs()
			await contractCase("case/push-one-op-per-item", "push", send("push", { ...ctx.identity, ops: [
				{ op: "set", name: ctx.a, ifVersion: refs.items[ctx.a], sourceText: fb(A, { body: "x := x + 3;" }) },
				{ op: "deleteItem", name: ctx.a.toUpperCase(), ifVersion: refs.items[ctx.a] },
			] }), refusedWith("BAD_REQUEST"))
			expect((await bridge.refs()).items[ctx.a], "a refused push applied nothing").toBe(refs.items[ctx.a])
		})
		it("refs: expectedProjectName in another case (observation)", async () => {
			await contractCase("case/refs-project-name", "refs", send("refs", { ...ctx.identity, expectedProjectName: ctx.identity.expectedProjectName.toUpperCase() }), observed)
		})
		it("connect: the project in another case (observation)", async () => {
			try {
				await contractCase("case/connect-project", "connect", send("connect", { project: ctx.served.toUpperCase() }), observed)
			} finally { await bridge.connect({ project: ctx.served }) }
		})
	})

	// ── push: the op's own shape ─────────────────────────────────────────────────────────────────────────────────────

	describe("push ops", () => {
		it("the `op` discriminator after the other members is the same op", async () => {
			const refs = await bridge.refs()
			await contractCase("push/discriminator-last", "push", sendRaw(
				`{"op":"push","body":{"expectedPlatform":${JSON.stringify(ctx.identity.expectedPlatform)},"expectedProjectName":${JSON.stringify(ctx.identity.expectedProjectName)},` +
				`"ops":[{"name":${JSON.stringify(ctx.a)},"ifVersion":${JSON.stringify(refs.items[ctx.a])},"sourceText":${JSON.stringify(fb(A, { body: "x := x + 4;" }))},"op":"set"}]}}`), answered)
		})
		it("an op with no discriminator is BAD_REQUEST", async () => {
			await contractCase("push/op-without-discriminator", "push", send("push", { ...ctx.identity, ops: [{ name: ctx.a }] }), refusedWith("BAD_REQUEST"))
		})
		it("an op with an unknown discriminator is BAD_REQUEST", async () => {
			await contractCase("push/op-unknown-discriminator", "push", send("push", { ...ctx.identity, ops: [{ op: "rename", name: ctx.a }] }), refusedWith("BAD_REQUEST"))
		})
		it("the discriminator in another case is BAD_REQUEST", async () => {
			await contractCase("push/op-discriminator-other-case", "push", send("push", { ...ctx.identity, ops: [{ op: "SET", name: ctx.a }] }), refusedWith("BAD_REQUEST"))
		})
		it("an op member the op does not have is BAD_REQUEST", async () => {
			await contractCase("push/op-unknown-member", "push", send("push", { ...ctx.identity, ops: [{ op: "deleteItem", name: ctx.a, to: ctx.b }] }), refusedWith("BAD_REQUEST"))
		})
		it("an op without its name is BAD_REQUEST", async () => {
			await contractCase("push/op-without-name", "push", send("push", { ...ctx.identity, ops: [{ op: "deleteItem", ifVersion: "x" }] }), refusedWith("BAD_REQUEST"))
		})
		it("a push with no op (observation)", async () => {
			await contractCase("push/no-ops", "push", send("push", { ...ctx.identity, ops: [] }), observed)
		})
		it("an empty identity member is BAD_REQUEST", async () => {
			await contractCase("push/empty-project-name", "push", send("push", { ...ctx.identity, expectedProjectName: "", ops: [] }), refusedWith("BAD_REQUEST"))
			await contractCase("push/empty-platform", "push", send("push", { ...ctx.identity, expectedPlatform: "", ops: [] }), refusedWith("BAD_REQUEST"))
		})
		it("another project's identity is WRONG_PROJECT", async () => {
			await contractCase("push/wrong-project", "push", send("push", { ...ctx.identity, expectedProjectName: "VltE2E_NoSuchProject", ops: [] }), refusedWith("WRONG_PROJECT"))
			await contractCase("push/wrong-platform", "push", send("push", { ...ctx.identity, expectedPlatform: VENDOR === "codesys" ? "twincat" : "codesys", ops: [] }), refusedWith("WRONG_PROJECT"))
			await contractCase("refs/wrong-project", "refs", send("refs", { expectedProjectName: "VltE2E_NoSuchProject" }), refusedWith("WRONG_PROJECT"))
		})
		it("a platform no bridge has (observation)", async () => {
			await contractCase("refs/unknown-platform", "refs", send("refs", { expectedPlatform: "siemens" }), observed)
		})
	})

	// ── a taken name ─────────────────────────────────────────────────────────────────────────────────────────────────

	describe("taken names", () => {
		it("a create on a path the IDE holds is ITEM_EXISTS", async () => {
			await contractCase("taken/create-on-existing", "push", send("push", { ...ctx.identity, ops: [{ op: "set", name: ctx.b, sourceText: fb(B) }] }), refusedWith("ITEM_EXISTS"))
		})
		it("a rename onto a path the IDE holds is ITEM_EXISTS", async () => {
			const refs = await bridge.refs()
			await contractCase("taken/rename-onto-existing", "push", send("push", { ...ctx.identity, ops: [{ op: "set", name: ctx.a, ifVersion: refs.items[ctx.a], to: ctx.b }] }), refusedWith("ITEM_EXISTS"))
		})
		it("a rename onto a held path in another case is ITEM_EXISTS", async () => {
			const refs = await bridge.refs()
			await contractCase("taken/rename-onto-existing-other-case", "push", send("push", { ...ctx.identity, ops: [{ op: "set", name: ctx.a, ifVersion: refs.items[ctx.a], to: ctx.b.toLowerCase() }] }), refusedWith("ITEM_EXISTS"))
		})
		it("a create of a DUT named as a POU of the same application is ITEM_EXISTS", async () => {
			await contractCase("taken/create-same-name-other-kind", "push", send("push", { ...ctx.identity, ops: [{ op: "set", name: inFolder(ctx.folder, `${B}.dut`), sourceText: structDut(B) }] }), refusedWith("ITEM_EXISTS"))
		})
		it("a create of a POU named as one in another folder of the same application is ITEM_EXISTS", async () => {
			await contractCase("taken/create-same-name-other-folder", "push", send("push", { ...ctx.identity, ops: [{ op: "set", name: inFolder(folderOf(ctx.folder), `${B}.pou`), sourceText: fb(B) }] }), refusedWith("ITEM_EXISTS"))
		})
		it("the same item in two ops is BAD_REQUEST", async () => {
			const refs = await bridge.refs()
			await contractCase("taken/same-item-twice", "push", send("push", { ...ctx.identity, ops: [
				{ op: "set", name: ctx.b, ifVersion: refs.items[ctx.b], sourceText: fb(B, { body: "x := 9;" }) },
				{ op: "deleteItem", name: ctx.b, ifVersion: refs.items[ctx.b] },
			] }), refusedWith("BAD_REQUEST"))
		})
	})

	// ── an unknown path ──────────────────────────────────────────────────────────────────────────────────────────────

	describe("unknown paths", () => {
		const nope = () => inFolder(ctx.folder, "VltE2E_CtrNope.pou")
		it("fetch of a path that names nothing (observation)", async () => {
			await contractCase("unknown/fetch-onlyItems", "fetch", send("fetch", { onlyItems: [nope()] }), observed)
		})
		it("an update of a path that names nothing is ITEM_MISSING", async () => {
			await contractCase("unknown/update", "push", send("push", { ...ctx.identity, ops: [{ op: "set", name: nope(), ifVersion: "0000", sourceText: fb("VltE2E_CtrNope") }] }), refusedWith("ITEM_MISSING"))
		})
		it("a delete of a path that names nothing, with a version, is ITEM_MISSING", async () => {
			await contractCase("unknown/delete", "push", send("push", { ...ctx.identity, ops: [{ op: "deleteItem", name: nope(), ifVersion: "0000" }] }), refusedWith("ITEM_MISSING"))
		})
		it("a delete of a path that names nothing, with no version (observation)", async () => {
			await contractCase("unknown/delete-no-version", "push", send("push", { ...ctx.identity, ops: [{ op: "deleteItem", name: nope() }] }), observed)
		})
		it("a name with no kind extension is BAD_REQUEST", async () => {
			await contractCase("unknown/no-extension", "push", send("push", { ...ctx.identity, ops: [{ op: "set", name: inFolder(ctx.folder, "VltE2E_CtrX"), sourceText: fb("VltE2E_CtrX") }] }), refusedWith("BAD_REQUEST"))
		})
		it("a name with an unknown kind extension is BAD_REQUEST", async () => {
			await contractCase("unknown/unknown-extension", "push", send("push", { ...ctx.identity, ops: [{ op: "set", name: inFolder(ctx.folder, "VltE2E_CtrX.foo"), sourceText: fb("VltE2E_CtrX") }] }), refusedWith("BAD_REQUEST"))
			await contractCase("unknown/retired-extension", "push", send("push", { ...ctx.identity, ops: [{ op: "set", name: inFolder(ctx.folder, "VltE2E_CtrX.prg"), sourceText: fb("VltE2E_CtrX") }] }), refusedWith("BAD_REQUEST"))
		})
		it("a create with no sourceText is BAD_REQUEST", async () => {
			await contractCase("unknown/create-without-source", "push", send("push", { ...ctx.identity, ops: [{ op: "set", name: nope() }] }), refusedWith("BAD_REQUEST"))
		})
		it("a move into another application is BAD_REQUEST", async () => {
			const other = ctx.apps.find((x) => x !== drivenApplication(ctx.apps))
			if (!other) return console.log("contract: the served project states one application — no cross-application move to send")
			const refs = await bridge.refs()
			await contractCase("unknown/move-to-other-application", "push", send("push", { ...ctx.identity, ops: [{ op: "set", name: ctx.a, ifVersion: refs.items[ctx.a], to: inFolder(other, `${A}.pou`) }] }), refusedWith("BAD_REQUEST"))
		})
		it("a create under a root no application holds (observation)", async () => {
			await contractCase("unknown/create-under-unknown-root", "push", send("push", { ...ctx.identity, ops: [{ op: "set", name: "VltE2E_NoSuchDevice/X/VltE2E_CtrD.pou", sourceText: fb("VltE2E_CtrD") }] }), observed)
		})
		it("build of an application the project does not hold is BAD_REQUEST", async () => {
			await contractCase("unknown/build-application", "build", send("build", { ...ctx.identity, applications: ["VltE2E_NoSuchApplication"] }), refusedWith("BAD_REQUEST"))
			await contractCase("boundary/build-no-application", "build", send("build", { ...ctx.identity, applications: [] }), refusedWith("BAD_REQUEST"))
		})
		it("grep of paths that match nothing (observation)", async () => {
			await contractCase("unknown/grep-paths", "grep", send("grep", { pattern: A, paths: ["VltE2E_NoSuch/**"] }), observed)
		})
		it("connect to a project the IDE has not open is PLC_DISCONNECTED, and leaves the bridge resumed", async () => {
			try {
				await contractCase("unknown/connect-project", "connect", send("connect", { project: "VltE2E_NoSuchProject" }), refusedWith("PLC_DISCONNECTED"))
			} finally { await bridge.connect({ project: ctx.served }) }
		})
	})

	// ── empty and boundary values ────────────────────────────────────────────────────────────────────────────────────

	describe("boundaries", () => {
		it("fetch with neither knownItems nor onlyItems nor init is BAD_REQUEST", async () => {
			await contractCase("boundary/fetch-empty", "fetch", send("fetch", {}), refusedWith("BAD_REQUEST"))
		})
		it("fetch with empty knownItems or onlyItems (observation)", async () => {
			await contractCase("boundary/fetch-knownItems-empty", "fetch", send("fetch", { knownItems: {}, onlyItems: [ctx.a] }), observed)
			await contractCase("boundary/fetch-onlyItems-empty", "fetch", send("fetch", { onlyItems: [] }), observed)
			await contractCase("boundary/fetch-onlyItems-empty-path", "fetch", send("fetch", { onlyItems: [""] }), observed)
		})
		it("fetch of a 300-character path (observation)", async () => {
			await contractCase("boundary/fetch-long-path", "fetch", send("fetch", { onlyItems: [inFolder(ctx.folder, "V".repeat(300) + ".pou")] }), observed)
		})
		it("grep: an empty pattern, a pattern that does not compile, a limit outside 1-1000 are BAD_REQUEST", async () => {
			await contractCase("boundary/grep-empty-pattern", "grep", send("grep", { pattern: "" }), refusedWith("BAD_REQUEST"))
			await contractCase("boundary/grep-bad-regex", "grep", send("grep", { pattern: "(" }), refusedWith("BAD_REQUEST"))
			for (const limit of [0, -1, 1001, 2147483648])
				await contractCase(`boundary/grep-limit:${limit}`, "grep", send("grep", { pattern: A, limit }), refusedWith("BAD_REQUEST"))
		})
		it("grep: the limit's own bounds are answered", async () => {
			await contractCase("boundary/grep-limit:1", "grep", send("grep", { pattern: A, limit: 1 }), answered)
			await contractCase("boundary/grep-limit:1000", "grep", send("grep", { pattern: A, limit: 1000 }), answered)
		})
		it("a create of a name that is no IEC identifier (observation)", async () => {
			await contractCase("boundary/create-non-ascii", "push", send("push", { ...ctx.identity, ops: [{ op: "set", name: inFolder(ctx.folder, "VltE2E_CtrÄ.pou"), sourceText: fb("VltE2E_CtrÄ") }] }), observed)
			await contractCase("boundary/create-with-space", "push", send("push", { ...ctx.identity, ops: [{ op: "set", name: inFolder(ctx.folder, "VltE2E_Ctr E.pou"), sourceText: fb("VltE2E_Ctr E") }] }), observed)
		})
		it("a push with an empty lease (observation)", async () => {
			await contractCase("boundary/push-empty-lease", "push", send("push", { ...ctx.identity, expectedProjectVersion: "", ops: [] }), observed)
		})
	})

	// ── an IDE state: paused ─────────────────────────────────────────────────────────────────────────────────────────

	describe("paused", () => {
		it("after disconnect every sync op is PLC_DISCONNECTED and health still answers, every row idle", async () => {
			try {
				await bridge.disconnect()
				await contractCase("paused/refs", "refs", send("refs", {}), refusedWith("PLC_DISCONNECTED"))
				await contractCase("paused/push", "push", send("push", { ...ctx.identity, ops: [] }), refusedWith("PLC_DISCONNECTED"))
				await contractCase("paused/grep", "grep", send("grep", { pattern: A }), refusedWith("PLC_DISCONNECTED"))
				await contractCase("paused/health", "health", send("health"), answered, (a) =>
					(a.result?.projects ?? []).every((p: any) => p.status === "idle") ? null : `rows not idle while paused: ${JSON.stringify(a.result?.projects)}`)
			} finally { await bridge.connect({ project: ctx.served }) }
		})
	})
})
