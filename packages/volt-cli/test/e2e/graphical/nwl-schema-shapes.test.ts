/**
 * THE NWL SCHEMA GATE'S SHAPES ON A LIVE CODESYS (openspec nwl-schema-completeness-gate 3.1): a sample of the spelled
 * shapes the offline gate exports (`test/fixtures/nwl-schema/shapes.v2.jsonl`) — one per depth × slot × class and one per
 * flag holder × flag value, in each language — is pushed as the networks of small function blocks, pulled back (the IDE
 * stores it as the text spells it: an exact round trip and a fixed point), exported natively (the IDE serializes the
 * implementation it holds) and built (every error recorded against the block that raised it, since a build names no POU).
 *
 * With `VOLT_RECORD_NWL_SHAPES=1` the outcome of every block is written to
 * `test/fixtures/nwl-schema/codesys-3.5.21.40.recording.json`. The test fails on a shape the IDE took and handed back
 * reshaped — a silent change, the one outcome no shape may have; a refusal or a build error is recorded for the owner.
 *
 * CODESYS only (openspec: no TwinCAT live for now).
 */
import { describe, beforeAll, afterAll, expect, setDefaultTimeout } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { id, fid, requireHealthy, VENDOR, BASE } from "../harness"
import { itGapped, PLATFORM_GAPS } from "../lib/platform"
import { createItem, fetchItem, pathOf, pushOps, removeItem, versionOf, landed, at } from "../lib/workspace"
import { drivenBuild } from "../lib/compile"
import { codesysImplementations } from "../lib/codesys-native"

const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(3_600_000)

interface Shape {
	language: "LD" | "FBD"
	depth: number
	slot: string
	class: string
	holder: string
	flags: string
	outcome: string
	text?: string
}

const FIXTURES = join(import.meta.dir, "..", "..", "fixtures", "nwl-schema")
const lines = readFileSync(join(FIXTURES, "shapes.v2.jsonl"), "utf8").replace(/\r\n/g, "\n").trim().split("\n")
const shapes: Shape[] = lines.slice(1).map((l): Shape => JSON.parse(l))

/** One spelled shape per language × depth × slot × class, and per language × holder × flags. */
function sample(): Shape[] {
	const picked = new Map<string, Shape>()
	for (const s of shapes.filter((x) => x.outcome === "spelled"))
		for (const k of [`${s.language}|${s.depth}|${s.slot}|${s.class}`, `${s.language}|${s.holder}|${s.flags}`])
			if (!picked.has(k)) picked.set(k, s)
	return [...new Set(picked.values())]
}

/** The callees the export's scope names, under the suite's prefix (a CODESYS name is case-blind: `fb1 : FB1` is no
 *  declaration there). */
const F1 = id("nwlF1")
const FB1 = id("nwlFB1")
const rename = (t: string) => t.replace(/\bFB1\b/g, FB1).replace(/\bF1\b/g, F1)

const CALLEES = [
	[`${F1}.pou`, `FUNCTION ${F1} : BOOL\nVAR_INPUT\n\tIN1 : BOOL;\n\tIN2 : BOOL;\nEND_VAR\n%LANGUAGE ST\n${F1} := IN1 AND IN2;\n\nEND_FUNCTION\n`],
	[`${FB1}.pou`, `FUNCTION_BLOCK ${FB1}\nVAR_INPUT\n\tIN1 : BOOL;\n\tIN2 : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tQ1 : BOOL;\n\tQ2 : BOOL;\nEND_VAR\n%LANGUAGE ST\nQ1 := IN1;\nQ2 := IN2;\n\nEND_FUNCTION_BLOCK\n`],
] as const

/** A shape's networks with its wires renumbered past `base` (the text numbers wires across the body). */
function networksOf(s: Shape, base: number): { text: string; wires: number } {
	const body = rename(s.text!).split("\n").slice(1).join("\n").replace(/\n$/, "")
	const seen = new Map<string, string>()
	const text = body.replace(/\bw(\d+)\b/g, (w) => {
		if (!seen.has(w)) seen.set(w, `w${base + seen.size + 1}`)
		return seen.get(w)!
	})
	return { text, wires: seen.size }
}

/** A function block holding `group`'s shapes as its networks, in `language`. */
function block(name: string, language: string, group: Shape[]): string {
	let wires = 0
	const nets = group.map((s) => {
		const n = networksOf(s, wires)
		wires += n.wires
		return n.text
	})
	return (
		`FUNCTION_BLOCK ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tc : BOOL;\n\tgo : BOOL;\n\tstart : BOOL;\n\tn : BOOL;\n\tq : BOOL;\n` +
		`\ty : BOOL;\n\tz : BOOL;\n\tfb1 : ${FB1};\nEND_VAR\n%LANGUAGE ${language}\n${nets.join("\n")}\n\nEND_FUNCTION_BLOCK\n`
	)
}

const GROUP = 12

interface Recorded {
	block: string
	language: string
	shapes: { depth: number; slot: string; class: string; holder: string; flags: string }[]
	stored: "round-tripped" | "refused" | "reshaped"
	refusal?: string
	back?: string
	native?: number
	buildErrors?: string[]
}

describe(`graphical / NWL schema shapes, nwl-schema-completeness-gate 3.1 (${BASE})`, () => {
	const recorded: Recorded[] = []

	beforeAll(async () => {
		await requireHealthy()
		for (const [file, src] of CALLEES) {
			await removeItem(file)
			await createItem(file, src)
		}
	})

	afterAll(async () => {
		for (const [file] of CALLEES) await removeItem(file)
		if (process.env.VOLT_RECORD_NWL_SHAPES === "1")
			writeFileSync(
				join(FIXTURES, "codesys-3.5.21.40.recording.json"),
				JSON.stringify({ version: "v1", ide: "CODESYS 3.5.21.40", sampled: recorded.reduce((n, r) => n + r.shapes.length, 0), blocks: recorded }, null, 2) + "\n",
			)
	})

	it("every sampled shape is stored as spelled, exported and built", async () => {
		expect(VENDOR).toBe("codesys")
		const picked = sample()
		const reshaped: string[] = []
		for (const language of ["LD", "FBD"] as const) {
			const mine = picked.filter((s) => s.language === language)
			for (let i = 0; i < mine.length; i += GROUP) {
				const group = mine.slice(i, i + GROUP)
				const key = `nwl${language}${i / GROUP}`
				const name = id(key)
				const file = fid(key)
				const src = block(name, language, group)
				const rec: Recorded = {
					block: name,
					language,
					shapes: group.map((s) => ({ depth: s.depth, slot: s.slot, class: s.class, holder: s.holder, flags: s.flags })),
					stored: "round-tripped",
				}
				recorded.push(rec)
				await removeItem(file)
				try {
					const r = await pushOps([{ op: "set", name: await at(file), sourceText: src, ifVersion: null }])
					if (!landed(r)) {
						rec.stored = "refused"
						rec.refusal = JSON.stringify(r.conflicts).slice(0, 2000)
						continue
					}
					const back = (await fetchItem(file)).sourceText
					if (back !== src) {
						rec.stored = "reshaped"
						rec.back = back
						reshaped.push(`${name}:\n--- pushed\n${src}\n--- back\n${back}`)
						continue
					}
					const again = await pushOps([{ op: "set", name: await pathOf(file), sourceText: back, ifVersion: await versionOf(file) }])
					if (!landed(again) || (await fetchItem(file)).sourceText !== back) {
						rec.stored = "reshaped"
						reshaped.push(`${name}: not a fixed point`)
						continue
					}
					rec.native = (await codesysImplementations(name)).length
					const build = await drivenBuild()
					rec.buildErrors = build.diagnostics.filter((d: any) => d.severity === "error").map((d: any) => String(d.message))
				} finally {
					await removeItem(file)
				}
			}
		}
		expect(reshaped.slice(0, 5)).toEqual([])
	})
})
