/**
 * IS THIS POU ACTUALLY COMPILED? Asked by breaking it on purpose and seeing whether the compiler notices.
 *
 * `Lenze_MID-S100` builds with ZERO errors while `Mach1_MIDS` and `AHWF` hold four `???` markers that ARE a
 * compile error wherever the compiler looks (measured: scripts/audit-check.ts). So the compiler is not looking
 * — but "not looking" has two candidate causes, and an ABSENCE of diagnostics cannot tell them apart:
 *
 *   a) the object is EXCLUDED FROM BUILD (CODESYS has a folder-level control), or
 *   b) nothing REACHES it, so no code is generated for it — a proven mechanism: an uninstantiated FB answers
 *      with silence no matter what is wrong inside it (audit-check.ts with VOLT_NO_INSTANTIATE=1).
 *
 * Reading `ScriptBuildProperties.exclude_from_build` would settle it directly and could not be reached from a
 * runscript (probe-exclude-from-build.py). This settles it the other way round, with no vendor internals:
 * plant an unmistakable error in ONE object, build, restore, repeat. Give it a CONTROL first — an object known
 * to be compiled — so a silent subject means "not compiled" rather than "the experiment does not work".
 *
 *   VOLT_PIPE=volt.bridge.codesys.<pid> bun run scripts/probe-is-it-compiled.ts <control> <subject> [more…]
 *
 * ALWAYS POINT THIS AT A COPY. It writes to the open project and restores after each step, but an interrupted
 * run leaves the planted error in place — never aim it at an engineer's original.
 */
import { call, landedInFull } from "./bridge.js"

const MARKER = "zzVoltProbeUndeclared"
const names = process.argv.slice(2)
if (names.length < 2) {
	console.error("usage: probe-is-it-compiled.ts <control-item> <subject-item> [more…]   (the first is the control)")
	process.exit(1)
}

const fetchOne = async (name: string): Promise<{ sourceText: string; version: string }> => {
	const r = await call("fetch", { knownItems: {}, onlyItems: [name] })
	const it = (r.changed ?? []).find((i: any) => i.name === name)
	if (it === undefined) throw new Error(`no such item: ${name}`)
	return it
}
const push = async (ops: unknown[]): Promise<any> =>
	call("push", { expectedProjectVersion: (await call("refs")).projectVersion, ops })
const buildMessages = async (): Promise<string[]> =>
	((await call("build", { buildType: "full" })).diagnostics ?? []).map((d: any) => String(d.message))

/** Break the body by renaming its first coil target to a name nothing declares. */
function plant(src: string): string | null {
	const m = /^(\s+)([A-Za-z_]\w*(?:\.\w+)*)( (?::=|S=|R=) )/m.exec(src)
	return m === null ? null : src.slice(0, m.index) + m[1] + MARKER + m[3] + src.slice(m.index + m[0].length)
}

const base = new Set(await buildMessages())
console.log(`baseline: ${base.size} diagnostic(s)\n`)

for (const name of names) {
	const original = await fetchOne(name)
	const broken = plant(original.sourceText)
	if (broken === null) {
		console.log(`${name.padEnd(28)} SKIPPED — no coil assignment to break`)
		continue
	}
	const set = await push([{ op: "set", name, toFolder: null, sourceText: broken, ifVersion: original.version }])
	if (!landedInFull(set)) {
		console.log(`${name.padEnd(28)} PUSH REFUSED — ${JSON.stringify(set.conflicts).slice(0, 160)}`)
		continue
	}
	try {
		const fresh = (await buildMessages()).filter((m) => !base.has(m) && m.includes(MARKER))
		console.log(`${name.padEnd(28)} ${fresh.length > 0 ? "COMPILED" : "NOT COMPILED"}  (${fresh.length} new)`)
		for (const m of fresh) console.log(`      ${m}`)
	} finally {
		const cur = await fetchOne(name)
		const back = await push([
			{ op: "set", name, toFolder: null, sourceText: original.sourceText, ifVersion: cur.version },
		])
		if (!landedInFull(back)) console.error(`      RESTORE FAILED for ${name} — the copy still holds ${MARKER}`)
	}
}
