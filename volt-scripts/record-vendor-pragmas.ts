/**
 * Record a live IDE's reaction to the `Tc*` vendor pragmas (conformance task 3.6), EITHER vendor.
 *
 * The full `record:language` recorder (which batches all ~220 fixtures) was removed with volt-agent.
 * This is a TARGETED, isolated recorder for just the `PRAGMA_TC_TESTS` catalog: each fixture is a
 * self-contained POU pushed one-at-a-time to a live bridge, built, and recorded — no PLC_PRG mutation,
 * no per-test diagnostic attribution. Which recording file it updates is chosen from the bridge's
 * reported `platform`: beckhoff → `expected-tc.json`, codesys → `expected-codesys.json`.
 *
 *   pwsh volt-scripts/bridge.ps1 -Port 8555               # TwinCAT (XAE must be open on a project first)
 *   pwsh volt-scripts/codesys-bridge.ps1 up               # CODESYS headless (port 8556)
 *   VOLT_BRIDGE_PORT=8555 bun volt-scripts/record-vendor-pragmas.ts   # capture; --dry-run to preview
 *   VOLT_BRIDGE_PORT=8556 bun volt-scripts/record-vendor-pragmas.ts
 *
 * Every POU it creates is `FB_LANG_`/`DUT_LANG_`/`GVL_LANG_`-prefixed and DELETED after its build,
 * so the connected project is left as it was found (modulo the transient build).
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { PRAGMA_TC_TESTS } from "../packages/volt-lsp-iec/test/conformance/fixtures/pragma-tc.js"

const PORT = process.env.VOLT_BRIDGE_PORT ?? "8555"
const BASE = `http://127.0.0.1:${PORT}`
const DRY = process.argv.includes("--dry-run")
const RECORDINGS = join(dirname(fileURLToPath(import.meta.url)), "../packages/volt-lsp-iec/test/conformance/recordings")
const RECORDING_FILE: Record<string, string> = { beckhoff: "expected-tc.json", codesys: "expected-codesys.json" }

type BridgeDiag = { severity: string; message: string; line: number; column: number }
type BuildRes = { success: boolean; duration: number; diagnostics: BridgeDiag[] }

async function post(path: string, body: unknown): Promise<Response> {
	return fetch(BASE + path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	})
}

async function push(ops: unknown[]): Promise<void> {
	const res = await post("/push", { ops })
	if (!res.ok) throw new Error(`/push ${res.status}: ${await res.text()}`)
	const json = (await res.json()) as { accepted: boolean; conflicts?: { name: string; reason: string }[] }
	if (!json.accepted) throw new Error(`/push rejected: ${JSON.stringify(json.conflicts)}`)
}

async function main() {
	// Pre-flight: bridge up + attached to a project.
	type Health = { connected: boolean; platform: string; ideName: string; ideVersion: string; projectName: string; version: string }
	const health = (await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null)) as Health | null
	if (!health?.connected) {
		console.error(`No connected bridge on ${BASE}. Start it: pwsh volt-scripts/bridge.ps1 -Port ${PORT} (XAE open first).`)
		process.exit(1)
	}
	const outName = RECORDING_FILE[health.platform]
	if (!outName) {
		console.error(`unknown bridge platform "${health.platform}" — expected beckhoff or codesys`)
		process.exit(1)
	}
	const OUT = join(RECORDINGS, outName)
	console.log(`bridge: ${health.platform} / ${health.ideName} ${health.ideVersion} / project "${health.projectName}"`)
	console.log(`recording ${PRAGMA_TC_TESTS.length} Tc* pragma fixtures into ${outName}${DRY ? " (DRY RUN — no push)" : ""}\n`)

	const doc = JSON.parse(readFileSync(OUT, "utf-8")) as {
		recorded: { at: string; bridgeVersion: string; testCount: number }
		tests: Record<string, { buildSuccess: boolean; durationMs: number; diagnostics: unknown[] }>
	}

	for (const t of PRAGMA_TC_TESTS) {
		if (DRY) {
			console.log(`  would record ${t.name} (${t.pouName})`)
			continue
		}
		// Isolated cycle: pre-delete stale, create, build, capture, delete.
		await push([{ op: "deleteItem", name: t.pouName }]).catch(() => {}) // no-op if absent
		await push([{ op: "set", name: t.pouName, sourceText: t.source }])
		const build = (await post("/build", { buildType: "full" }).then((r) => r.json())) as BuildRes
		await push([{ op: "deleteItem", name: t.pouName }])

		doc.tests[t.name] = {
			buildSuccess: build.success,
			durationMs: Math.round(build.duration),
			// Isolated single-POU build ⇒ every real diagnostic belongs to this POU.
			// Drop TC build-progress noise ("generate boot information…" etc.): status lines are
			// emitted as info at line 0, whereas real diagnostics are line-located (or line-0 errors).
			// This mirrors the old batch recorder, which filtered them via per-object attribution.
			diagnostics: build.diagnostics
				.filter((d) => !(d.severity === "info" && d.line === 0))
				.map((d) => ({ severity: d.severity, message: d.message, line: d.line, object: t.pouName, section: null })),
		}
		console.log(`  ${t.name}: build=${build.success}, ${build.diagnostics.length} diag(s)`)
	}

	if (DRY) return
	doc.recorded.at = new Date().toISOString()
	doc.recorded.bridgeVersion = health.version
	doc.recorded.testCount = Object.keys(doc.tests).length
	writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`, "utf-8")
	console.log(`\nwrote ${OUT} (${doc.recorded.testCount} tests)`)
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e)
	process.exit(1)
})
