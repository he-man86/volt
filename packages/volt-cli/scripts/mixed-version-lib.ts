/**
 * THE MIXED-VERSION CELL — the pure half (openspec `volt-cli-rework` 1.3; the runner is `mixed-version.ts`).
 *
 * <p>Every other test pairs a client and a bridge from the SAME commit. PLC Assist does not: it ships a bridge bundle and
 * drives the pipe itself, and an update made while CODESYS is open leaves the previous bridge loaded in-proc. So this
 * cell runs the current CLI against the PREVIOUS release's bridge, and the previous CLI against the current bridge.</p>
 *
 * <p>The rule (wire-final-shape 4.3): a pair whose wires DIFFER — another protocol number, or one number over two shapes
 * ({@link capabilityGap} non-empty) — is refused by name in EACH direction, by EVERY verb ({@link REQUIRED_VERBS}),
 * before any op, never served: by the bridge (`PipeServer`: a request of another protocol, or none, is PROTOCOL_MISMATCH)
 * or by the client (`BridgeClient`: a `health` lacking a member of its wire is BRIDGE_PREDATES_WIRE, `WireShape`; an
 * older CLI's BRIDGE_PROTOCOL). A pair of ONE wire (same number, same documents) must work. So a verb served across
 * differing wires is a misread, and red. And the bridge that answered must be the release the direction meant.</p>
 */

type Schema = {
	$ref?: string
	type?: string | string[]
	enum?: unknown[]
	const?: unknown
	required?: string[]
	properties?: Record<string, Schema>
	items?: Schema
	additionalProperties?: Schema | boolean
	oneOf?: Schema[]
	anyOf?: Schema[]
	allOf?: Schema[]
}

export type OpenRpcLike = {
	info: { version: string }
	methods: { name: string; params: { name: string; schema: Schema }[]; result: { schema: Schema } }[]
	components: { schemas: Record<string, Schema> }
}

/** One verb the cell ran, and how it ended. */
export type VerbRun = { verb: string; exit: number | null; output: string }

/** The verbs every direction runs, each of which must meet the refusal when the wires differ: `init` and `status` read
 *  `health` first, `build` and the pushes rely on the client's guard on the op path (`BridgeClient.RequireShape`) — a
 *  cell that judged `init` alone could not see that guard. */
export const REQUIRED_VERBS = ["init", "status", "build", "push (create)", "push (delete)"] as const

export type Direction = {
	name: string
	cliProtocol: number
	bridgeProtocol: number | null
	bridgeOps: string[] | null
	/** `health.bridgeVersion` of the bridge that answered, and the release this direction means it to be. */
	bridgeRelease: string | null
	expectedRelease: string
	runs: VerbRun[]
}

export type DirectionVerdict = { name: string; green: boolean; why: string }

/**
 * A refusal BY NAME, as the CLI prints it — the message, never the code (`Program.cs` writes a `BridgeError`'s message):
 * this client's BRIDGE_PREDATES_WIRE, the bridge's PROTOCOL_MISMATCH as an older client relays it verbatim, the same as
 * this client rephrases it (`BridgeClient.ProtocolRefused`), and an older client's own BRIDGE_PROTOCOL. Whole sentences,
 * so a failure that merely mentions the protocol is no refusal.
 */
const REFUSED_BY_NAME = [
	/this bridge predates this wire: update it\..*Nothing was done\./,
	/this bridge speaks wire protocol \d+, the request states (\d+|none); nothing was done\./,
	/the bridge speaks wire protocol (\d+|none), this volt speaks \d+: .*Nothing was (done|sent to it)\./,
]
const refusedByName = (output: string) => REFUSED_BY_NAME.some((r) => r.test(output))

/** One direction's verdict. `shapesDiffer`: the two releases' OpenRPC documents differ ({@link capabilityGap}); another
 *  protocol number differs on its own. Differing wires must be refused by name, every verb; one wire must work. */
export function judgeDirection(d: Direction, shapesDiffer: boolean): DirectionVerdict {
	if (d.runs.length === 0) return { name: d.name, green: false, why: "no verb ran" }
	if (d.bridgeRelease !== d.expectedRelease)
		return { name: d.name, green: false, why: `the bridge that answered reports release ${d.bridgeRelease ?? "(none)"}, not ${d.expectedRelease}: not the build this direction pairs` }
	const missing = REQUIRED_VERBS.filter((v) => !d.runs.some((r) => r.verb === v))
	const wire = `bridge protocol ${d.bridgeProtocol ?? "none"}, CLI ${d.cliProtocol}`
	if (shapesDiffer || d.bridgeProtocol !== d.cliProtocol) {
		const how = `${wire}${shapesDiffer ? ", different shapes" : ""}`
		// The refusal is what the verb PRINTED. A verb that names it yet exits 0 was still served nothing — the previous
		// CLI's `status` folds a refusal into "IDE state unknown — <refusal>", exit 0 (measured on 0.1.17931; this CLI's
		// exits 1 since 4.3c) — so it is named in the verdict, not called a misread.
		const misread = d.runs.filter((r) => !refusedByName(r.output))
		const why: string[] = []
		if (misread.length > 0) why.push(`${misread.map((r) => `\`${r.verb}\` (exit ${r.exit})`).join(", ")} was not refused by name`)
		if (missing.length > 0) why.push(`${missing.map((v) => `\`${v}\``).join(", ")} never ran`)
		if (why.length > 0) return { name: d.name, green: false, why: `the wires differ (${how}), but ${why.join("; ")}` }
		const quiet = d.runs.filter((r) => r.exit === 0).map((r) => `\`${r.verb}\` exited 0 on the refusal`)
		return { name: d.name, green: true, why: `every verb refused by name before any op (${how})${quiet.length ? ` (${quiet.join(", ")})` : ""}: ${lastLine(d.runs[0].output)}` }
	}
	const failed = d.runs.filter((r) => r.exit !== 0)
	if (failed.length > 0)
		return { name: d.name, green: false, why: `both speak one wire (${wire}, same shape), yet ${failed.map((r) => `\`${r.verb}\` exited ${r.exit}: ${lastLine(r.output)}`).join("; ")}` }
	if (missing.length > 0)
		return { name: d.name, green: false, why: `both speak one wire (${wire}, same shape), yet ${missing.map((v) => `\`${v}\``).join(", ")} never ran` }
	return { name: d.name, green: true, why: `both speak one wire (${wire}, same shape); ${d.runs.map((r) => r.verb).join(", ")} worked` }
}

function lastLine(s: string): string {
	return s.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]?.slice(0, 300) ?? "(no output)"
}

/** A schema's SHAPE, flattened: every node by its path (`a.b`, `a[]` an array's element, `a{}` a map's value,
 *  `a|oneOf0` an arm) with its facts — type, enum values, const, required-ness, closed-ness. `$ref`s are resolved (a
 *  schema's NAME is not shape); a cycle stops at the schema it re-enters. Descriptions are not shape. */
type Shape = Map<string, Map<string, string>>

function shapeOf(doc: OpenRpcLike, root: Schema | undefined): Shape {
	const shape: Shape = new Map()
	const node = (path: string) => {
		let n = shape.get(path)
		if (!n) shape.set(path, (n = new Map()))
		return n
	}
	const walk = (s: Schema, path: string, seen: string[]): void => {
		const facts = node(path)
		if (s.$ref) {
			const name = /#\/components\/schemas\/(\w+)$/.exec(s.$ref)?.[1]
			const target = name ? doc.components.schemas[name] : undefined
			if (!name || !target) { facts.set("$ref", `unresolved ${s.$ref}`); return }
			if (seen.includes(name)) return
			return walk(target, path, [...seen, name])
		}
		if (s.type !== undefined) facts.set("type", JSON.stringify(Array.isArray(s.type) ? [...s.type].sort() : s.type))
		if (s.const !== undefined) facts.set("const", JSON.stringify(s.const))
		for (const v of s.enum ?? []) facts.set(`enum value ${JSON.stringify(v)}`, "")
		if (typeof s.additionalProperties === "boolean") facts.set("additionalProperties", String(s.additionalProperties))
		const at = (k: string) => (path ? `${path}.${k}` : k)
		for (const [k, p] of Object.entries(s.properties ?? {})) {
			walk(p, at(k), seen)
			if (s.required?.includes(k)) node(at(k)).set("required", "")
		}
		if (s.items) walk(s.items, `${path}[]`, seen)
		if (typeof s.additionalProperties === "object") walk(s.additionalProperties, `${path}{}`, seen)
		for (const kw of ["oneOf", "anyOf", "allOf"] as const) (s[kw] ?? []).forEach((x, i) => walk(x, `${path}|${kw}${i}`, seen))
	}
	if (root) walk(root, "", [])
	return shape
}

/** Two shapes' differences, each line `<at> …`: a node one has and the other lacks (named at its topmost path only), and
 *  per node both have, each fact that differs. */
function diffShapes(at: string, before: Shape, after: Shape, gap: string[]): void {
	const parent = (p: string) => /^(.*?)(?:\.[^.[\]{}|]+|\[\]|\{\}|\|\w+)$/.exec(p)?.[1] ?? ""
	const label = (p: string) => (p === "" ? "itself" : `'${p}'`)
	if (before.has("") !== after.has("")) { gap.push(`${at} body is ${after.has("") ? "new" : "gone"}`); return }
	for (const path of after.keys()) if (path && !before.has(path) && before.has(parent(path))) gap.push(`${at} member '${path}' is new`)
	for (const path of before.keys()) if (path && !after.has(path) && after.has(parent(path))) gap.push(`${at} member '${path}' is gone`)
	for (const [path, a] of after) {
		const b = before.get(path)
		if (!b) continue
		for (const k of new Set([...b.keys(), ...a.keys()])) {
			if (b.get(k) === a.get(k)) continue
			if (k === "required") gap.push(`${at} member '${path}' is now ${a.has(k) ? "required" : "optional"}`)
			else if (k.startsWith("enum value ")) gap.push(`${at} ${label(path)} ${k} is ${a.has(k) ? "new" : "gone"}`)
			else gap.push(`${at} ${label(path)} ${k} ${b.get(k) ?? "(none)"} → ${a.get(k) ?? "(none)"}`)
		}
	}
}

/** The schemas every op travels in, beside the ops' own request and response. */
const ENVELOPE = ["Request", "ProgressFrame", "ErrorFrame"]

/**
 * What one release's wire has that the other's lacks, from their two OpenRPC documents: ops; per op the request and
 * response SHAPE, deep (nested members, array elements, enum values, required-ness, types and consts — {@link shapeOf});
 * and the envelope every op travels in. Empty exactly when the two documents describe the same shape, which is what
 * makes a pair ONE wire.
 */
export function capabilityGap(previous: OpenRpcLike, current: OpenRpcLike): string[] {
	const gap: string[] = []
	const ops = (d: OpenRpcLike) => new Set(d.methods.map((m) => m.name))
	const po = ops(previous), co = ops(current)
	for (const op of co) if (!po.has(op)) gap.push(`op '${op}' is new (the previous bridge answers it BAD_REQUEST "unknown op"; health.ops tells a client)`)
	for (const op of po) if (!co.has(op)) gap.push(`op '${op}' is gone`)
	type Method = OpenRpcLike["methods"][number]
	const req = (d: OpenRpcLike, x: Method) => shapeOf(d, x.params.find((y) => y.name === "body")?.schema)
	const res = (d: OpenRpcLike, x: Method) => shapeOf(d, x.result.schema)
	for (const m of current.methods) {
		const p = previous.methods.find((x) => x.name === m.name)
		if (!p) continue
		diffShapes(`${m.name}: request`, req(previous, p), req(current, m), gap)
		diffShapes(`${m.name}: response`, res(previous, p), res(current, m), gap)
	}
	for (const name of ENVELOPE) {
		const b = previous.components.schemas[name], a = current.components.schemas[name]
		if (!a && !b) continue
		if (!a || !b) { gap.push(`envelope '${name}' is ${a ? "new" : "gone"} (the other document does not describe it)`); continue }
		diffShapes(`envelope ${name}:`, shapeOf(previous, b), shapeOf(current, a), gap)
	}
	return gap
}

export type MixedResult = { previous: string; current: string; green: boolean; directions: DirectionVerdict[]; gap: string[]; undetectable: string }

/** The cell's verdict over both directions, with what the pair's difference meant said in words. */
export function judgeCell(previous: string, current: string, dirs: Direction[], gap: string[]): MixedResult {
	const differ = gap.length > 0
	const directions = dirs.map((d) => judgeDirection(d, differ))
	const sameNumber = dirs.every((d) => d.bridgeProtocol === d.cliProtocol)
	const green = directions.length > 0 && directions.every((d) => d.green)
	const what = sameNumber ? `ONE protocol number over ${gap.length} shape difference(s), listed` : "another protocol number"
	const undetectable = !differ && sameNumber
		? "the two releases speak one protocol and their OpenRPC documents describe the same shape: nothing for either side to refuse"
		: green
			? `the two releases' wires differ (${what}): every verb refused by name in both directions, so nothing was misread`
			: `the two releases' wires differ (${what}), yet a verb was SERVED, failed unnamed or never ran: what it read may be misread`
	return { previous, current, green, directions, gap, undetectable }
}
