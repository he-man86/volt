/**
 * THE WIRE TRANSCRIPT — the pure half (openspec `volt-cli-rework` 1.3; the recorder is `wire-transcript.ts`).
 *
 * <p>A transcript is the request → response record of one fixed scenario on one fixture IDE: each step's request frame
 * and every frame the bridge answered, one JSON line per step. The rework's oracle (3.3) is that this record stays
 * BYTE-IDENTICAL while the code behind the wire is rewritten. So the normaliser replaces exactly what is legitimately
 * different between two runs of the same build on the same fixture, and nothing else:</p>
 * <ul>
 *   <li>`health.bridgeVersion` — the stamped release (or the dev commit) of the build under test;</li>
 *   <li>`build.durationMs` — wall-clock milliseconds;</li>
 *   <li>a path inside the instance's fixture COPY (`%TEMP%\volt-ide-<vendor>-<instance>\…`) and the temp dir itself — where
 *       `ide.ps1` put this run's copy;</li>
 *   <li>the pid in a pipe name (`volt.bridge.<vendor>.<pid>`);</li>
 *   <li>an ISO-8601 timestamp inside a string.</li>
 * </ul>
 * <p>Item versions, `projectVersion`, messages, member order and progress frames are all kept: they are the wire.</p>
 */

export type Step = { step: string; request: string; response: unknown[] }

export type Normaliser = { tempDir: string }

const ISO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?\b/g
const PIPE_PID = /\b(volt\.bridge\.(?:codesys|twincat))\.\d+\b/g

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** The fixture copy root (`<temp>\volt-ide-<…>`) and then the temp dir, in either slash direction and any case. */
function pathRules(n: Normaliser): [RegExp, string][] {
	const temp = n.tempDir.replace(/[\\/]+$/, "")
	const rules: [RegExp, string][] = []
	for (const t of new Set([temp, temp.replace(/\\/g, "/")])) {
		const sep = t.includes("/") ? "/" : "\\\\"
		rules.push([new RegExp(escapeRegex(t) + sep + "volt-ide-[^\\\\/\"]+", "gi"), "<fixtureCopy>"])
		rules.push([new RegExp(escapeRegex(t), "gi"), "<temp>"])
	}
	return rules
}

/** One string with the legitimately variable parts replaced. */
export function normaliseString(s: string, n: Normaliser): string {
	let out = s
	for (const [re, to] of pathRules(n)) out = out.replace(re, to)
	return out.replace(PIPE_PID, "$1.<pid>").replace(ISO, "<timestamp>")
}

/** A parsed frame (or any JSON value in it) normalised: strings everywhere, the two variable members by name. */
export function normaliseValue(v: unknown, n: Normaliser, key?: string, parent?: unknown): unknown {
	if (typeof v === "string") {
		if (key === "bridgeVersion") return "<bridgeVersion>"
		return normaliseString(v, n)
	}
	if (typeof v === "number" && key === "durationMs" && parent && typeof parent === "object" && "success" in parent) return 0
	if (Array.isArray(v)) return v.map((x) => normaliseValue(x, n, undefined, v))
	if (v && typeof v === "object")
		return Object.fromEntries(Object.entries(v).map(([k, x]) => [normaliseString(k, n), normaliseValue(x, n, k, v)]))
	return v
}

export function serialise(steps: Step[]): string {
	return steps.map((s) => JSON.stringify(s)).join("\n") + "\n"
}

export function parse(text: string): Step[] {
	return text.split(/\r?\n/).filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as Step)
}

/**
 * A JSON value flattened to `<path> = <value>` lines, keys in the order they stand, so two transcripts compare member by
 * member however large a fetch answer is — and a member that moved shows as an order change, not as noise.
 */
export function flatten(v: unknown, at = "$", out: string[] = []): string[] {
	if (Array.isArray(v)) {
		if (v.length === 0) out.push(`${at} = []`)
		v.forEach((x, i) => flatten(x, `${at}[${i}]`, out))
	} else if (v && typeof v === "object") {
		const entries = Object.entries(v)
		if (entries.length === 0) out.push(`${at} = {}`)
		for (const [k, x] of entries) flatten(x, /^[A-Za-z_]\w*$/.test(k) ? `${at}.${k}` : `${at}[${JSON.stringify(k)}]`, out)
	} else out.push(`${at} = ${JSON.stringify(v)}`)
	return out
}

/** The members of an object, at every depth, in order: `$.result.items: a, b, c`. Two answers with the same values in
 *  another member order differ only here. */
function memberOrders(v: unknown, at = "$", out: Map<string, string> = new Map()): Map<string, string> {
	if (Array.isArray(v)) v.forEach((x, i) => memberOrders(x, `${at}[${i}]`, out))
	else if (v && typeof v === "object") {
		out.set(at, Object.keys(v).join(", "))
		for (const [k, x] of Object.entries(v)) memberOrders(x, `${at}.${k}`, out)
	}
	return out
}

export type StepDiff = { step: string; lines: string[] }

/**
 * Every difference between a reference transcript and a new run: steps added, missing or reordered, a request that
 * changed (the scenario itself moved), and per step every response member added, removed, changed or reordered.
 * Empty when the two are byte-identical.
 */
export function compare(reference: Step[], run: Step[]): StepDiff[] {
	const diffs: StepDiff[] = []
	const names = (s: Step[]) => s.map((x) => x.step).join(", ")
	if (names(reference) !== names(run))
		diffs.push({ step: "(scenario)", lines: [`- steps: ${names(reference)}`, `+ steps: ${names(run)}`] })
	const byName = new Map(run.map((s) => [s.step, s]))
	for (const ref of reference) {
		const now = byName.get(ref.step)
		if (!now) { diffs.push({ step: ref.step, lines: ["- the step is missing from the run"] }); continue }
		if (JSON.stringify(ref) === JSON.stringify(now)) continue
		const lines: string[] = []
		if (ref.request !== now.request) lines.push(`- request ${ref.request.slice(0, 400)}`, `+ request ${now.request.slice(0, 400)}`)
		const split = (l: string): [string, string] => { const i = l.indexOf(" = "); return [l.slice(0, i), l.slice(i + 3)] }
		const a = new Map(flatten(ref.response, "$response").map(split))
		const b = new Map(flatten(now.response, "$response").map(split))
		for (const [path, value] of a) {
			if (!b.has(path)) lines.push(`- ${path} = ${value}`)
			else if (b.get(path) !== value) lines.push(`~ ${path} = ${value}  →  ${b.get(path)}`)
		}
		for (const [path, value] of b) if (!a.has(path)) lines.push(`+ ${path} = ${value}`)
		const oa = memberOrders(ref.response, "$response"), ob = memberOrders(now.response, "$response")
		const sameSet = (x: string, y: string) => [...x.split(", ")].sort().join(", ") === [...y.split(", ")].sort().join(", ")
		for (const [at, order] of oa)
			if (ob.has(at) && ob.get(at) !== order && sameSet(order, ob.get(at)!))
				lines.push(`order ${at}: ${order.slice(0, 200)}  →  ${ob.get(at)!.slice(0, 200)}`)
		if (lines.length === 0) lines.push("(the step differs in bytes only)")
		diffs.push({ step: ref.step, lines })
	}
	for (const s of run) if (!reference.some((r) => r.step === s.step)) diffs.push({ step: s.step, lines: ["+ the step is new in the run"] })
	return diffs
}

export function renderDiff(diffs: StepDiff[], cap = 200): string {
	if (diffs.length === 0) return "transcripts are byte-identical\n"
	const out: string[] = [`${diffs.length} step(s) differ`]
	for (const d of diffs) {
		out.push(`── ${d.step}`)
		out.push(...d.lines.slice(0, cap).map((l) => `  ${l}`))
		if (d.lines.length > cap) out.push(`  … ${d.lines.length - cap} more`)
	}
	return out.join("\n") + "\n"
}
