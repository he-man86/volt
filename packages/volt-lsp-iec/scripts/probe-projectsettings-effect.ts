/**
 * Is `.projectsettings` LOAD-BEARING in the LSP, or merely parsed?
 *
 * The two are indistinguishable from a green suite: a setting that is read and then dropped on the floor looks
 * exactly like one that is honoured, right up until it hides ~150 real warnings (or reports ~150 the project
 * switched off — which is what a mis-committed `Disabled warnings: C0371` under lenze-mid did).
 *
 * So this analyses each corpus project TWICE — once with its real workspace refs, once with the project
 * settings stripped — and prints the per-code delta. A code that a project disables must appear in the
 * stripped run and vanish in the real one; a project that disables nothing must be identical in both.
 *
 *   bun run scripts/probe-projectsettings-effect.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { WorkspaceStore } from "../src/server/workspace-store.js"
import { resolveConfig } from "../src/analysis/config.js"
import { messagesFor } from "../src/analysis/index.js"
import { documentDiagnostics } from "../src/server/diagnostics.js"
import { loadWorkspaceRefs, loadTaskRoots, scanWorkspace } from "../src/workspace-refs.js"

const CORPUS = join(import.meta.dir, "..", "test-corpus")
const SOURCE = /\.(prg|fb|fun|itf|gvl|dut)$/i

function walk(dir: string, out: string[] = []): string[] {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name)
		if (e.isDirectory()) walk(p, out)
		else if (SOURCE.test(e.name)) out.push(p)
	}
	return out
}

/** Every diagnostic code the project produces, counted — under the given project configuration. */
function countsFor(dir: string, diagnostics: ReturnType<typeof scanWorkspace>["projectDiagnostics"]): Map<string, number> {
	const files = walk(dir)
	const store = new WorkspaceStore(resolveConfig({ vendor: "codesys", diagnostics }))
	store.workspaceRefs = loadWorkspaceRefs(dir)
	store.taskRoots = loadTaskRoots(dir)
	store.seedDisk(files.map((p) => ({ uri: p, source: readFileSync(p, "utf8") })))
	const messages = messagesFor("codesys")
	const counts = new Map<string, number>()
	for (const d of store.workspace())
		for (const diag of documentDiagnostics(store, messages, d)) {
			const code = String(diag.code ?? "(parse)")
			counts.set(code, (counts.get(code) ?? 0) + 1)
		}
	return counts
}

for (const project of readdirSync(CORPUS)) {
	const dir = join(CORPUS, project)
	if (!statSync(dir).isDirectory() || walk(dir).length === 0) continue

	// The project's own compiler-warning configuration, exactly as the conformance gates read it — versus
	// the same project with that configuration removed. The configuration is the only variable.
	const declared = scanWorkspace(dir).projectDiagnostics ?? {}
	const withSettings = countsFor(dir, declared)
	const without = countsFor(dir, undefined)

	const codes = new Set([...withSettings.keys(), ...without.keys()])
	const changed = [...codes]
		.map((c) => ({ c, on: withSettings.get(c) ?? 0, off: without.get(c) ?? 0 }))
		.filter((r) => r.on !== r.off)

	console.log(`\n=== ${project}`)
	console.log(`  declares: ${Object.keys(declared).length ? JSON.stringify(declared) : "(nothing)"}`)
	if (changed.length === 0) console.log("  no code changes when the settings are stripped")
	for (const r of changed) console.log(`  ${r.c}: ${r.on} with settings, ${r.off} without  (suppressed ${r.off - r.on})`)
}
