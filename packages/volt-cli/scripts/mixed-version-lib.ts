/**
 * THE MIXED-VERSION CELL — the pure half (openspec `volt-cli-rework` 1.3; the runner is `mixed-version.ts`).
 *
 * <p>Every other test pairs a client and a bridge from the SAME commit. PLC Assist does not: it ships a bridge bundle and
 * drives the pipe itself, and an update made while CODESYS is open leaves the previous bridge loaded in-proc. So this
 * cell runs the current CLI against the PREVIOUS release's bridge, and the previous CLI against the current bridge.</p>
 *
 * <p>The rule (`Volt.Cli/Sync/BridgeClient.RequireOurProtocol`): before its first op the CLI reads `health.protocol` and
 * refuses a bridge of another number (or none) by name — BRIDGE_PROTOCOL, "Nothing was sent to it". The bridge checks
 * nothing (the request carries no protocol). So:</p>
 * <ul>
 *   <li>protocols DIFFER — every verb must fail, naming BRIDGE_PROTOCOL / "wire protocol", having sent no op;</li>
 *   <li>protocols are EQUAL — the pair is declared compatible, so every verb must work. What the cell then CANNOT see
 *       is a change that kept the number: a response member re-meant, a request member the old peer ignores, an op
 *       one side lacks. It reports what the two OpenRPC documents differ in ({@link capabilityGap}) and what
 *       `health.ops` lists, so a shape change shipped under one number is named, never silently passed.</li>
 * </ul>
 */

export type OpenRpcLike = {
	info: { version: string }
	methods: { name: string; params: { name: string; schema: { $ref?: string } }[]; result: { schema: { $ref?: string; properties?: Record<string, unknown> } } }[]
	components: { schemas: Record<string, { properties?: Record<string, unknown> }> }
}

/** One verb the cell ran, and how it ended. */
export type VerbRun = { verb: string; exit: number | null; output: string }

export type Direction = {
	name: string
	cliProtocol: number
	bridgeProtocol: number | null
	bridgeOps: string[] | null
	runs: VerbRun[]
}

export type DirectionVerdict = { name: string; green: boolean; why: string }

const PROTOCOL_REFUSAL = /BRIDGE_PROTOCOL|wire protocol/

/** One direction's verdict: refused by name before any op when the numbers differ, working when they are equal. */
export function judgeDirection(d: Direction): DirectionVerdict {
	if (d.runs.length === 0) return { name: d.name, green: false, why: "no verb ran" }
	if (d.bridgeProtocol !== d.cliProtocol) {
		const misread = d.runs.filter((r) => r.exit === 0 || !PROTOCOL_REFUSAL.test(r.output))
		if (misread.length > 0)
			return { name: d.name, green: false, why: `protocol ${d.bridgeProtocol ?? "none"} bridge vs ${d.cliProtocol} CLI, but ${misread.map((r) => `\`${r.verb}\` (exit ${r.exit})`).join(", ")} was not refused by name` }
		return { name: d.name, green: true, why: `refused by name before any op (bridge protocol ${d.bridgeProtocol ?? "none"}, CLI ${d.cliProtocol})` }
	}
	const failed = d.runs.filter((r) => r.exit !== 0)
	if (failed.length > 0)
		return { name: d.name, green: false, why: `both speak protocol ${d.cliProtocol}, yet ${failed.map((r) => `\`${r.verb}\` exited ${r.exit}: ${lastLine(r.output)}`).join("; ")}` }
	return { name: d.name, green: true, why: `both speak protocol ${d.cliProtocol}; ${d.runs.map((r) => r.verb).join(", ")} worked` }
}

function lastLine(s: string): string {
	return s.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]?.slice(0, 300) ?? "(no output)"
}

function members(doc: OpenRpcLike, ref: string | undefined): string[] {
	const m = ref ? /#\/components\/schemas\/(\w+)$/.exec(ref) : null
	return m ? Object.keys(doc.components.schemas[m[1]]?.properties ?? {}) : []
}

/**
 * What one release's wire has that the other's lacks, from their two OpenRPC documents: ops, and per op the request and
 * response members. Under ONE protocol number this is exactly what the protocol check cannot refuse — empty when the two
 * documents describe the same shape.
 */
export function capabilityGap(previous: OpenRpcLike, current: OpenRpcLike): string[] {
	const gap: string[] = []
	const ops = (d: OpenRpcLike) => new Set(d.methods.map((m) => m.name))
	const po = ops(previous), co = ops(current)
	for (const op of co) if (!po.has(op)) gap.push(`op '${op}' is new (the previous bridge answers it BAD_REQUEST "unknown op"; health.ops tells a client)`)
	for (const op of po) if (!co.has(op)) gap.push(`op '${op}' is gone`)
	for (const m of current.methods) {
		const p = previous.methods.find((x) => x.name === m.name)
		if (!p) continue
		const req = (d: OpenRpcLike, x: OpenRpcLike["methods"][number]) => members(d, x.params.find((y) => y.name === "body")?.schema.$ref)
		const res = (d: OpenRpcLike, x: OpenRpcLike["methods"][number]) =>
			x.result.schema.$ref ? members(d, x.result.schema.$ref) : Object.keys(x.result.schema.properties ?? {})
		const diff = (side: string, before: string[], after: string[]) => {
			for (const k of after) if (!before.includes(k)) gap.push(`${m.name}: ${side} member '${k}' is new`)
			for (const k of before) if (!after.includes(k)) gap.push(`${m.name}: ${side} member '${k}' is gone`)
		}
		diff("request", req(previous, p), req(current, m))
		diff("response", res(previous, p), res(current, m))
	}
	return gap
}

export type MixedResult = { previous: string; current: string; green: boolean; directions: DirectionVerdict[]; gap: string[]; undetectable: string }

/** The cell's verdict over both directions, with what it could not detect said in words. */
export function judgeCell(previous: string, current: string, dirs: Direction[], gap: string[]): MixedResult {
	const directions = dirs.map(judgeDirection)
	const same = dirs.every((d) => d.bridgeProtocol === d.cliProtocol)
	const undetectable = same
		? gap.length === 0
			? "the two releases speak one protocol and their OpenRPC documents describe the same shape: nothing for the protocol check to refuse"
			: `the two releases speak ONE protocol number over DIFFERENT shapes (${gap.length} difference(s) listed): the CLI's protocol check cannot refuse that pair, so a re-meant member would be misread — bump WireProtocol.Version by its rule, or confirm each difference is one an old peer can ignore`
		: "the protocol numbers differ: the CLI refuses the pair before any op"
	return { previous, current, green: directions.every((d) => d.green), directions, gap, undetectable }
}
