/**
 * COMPATIBILITY SHIM — the old flat harness surface, re-exported from `lib/`.
 *
 * <p>`harness.ts` was a 569-line module owning five unrelated concerns: pipe transport, a typed op client, test
 * identity and cleanup, main-program surgery, and assertion helpers. Every test file pulled the whole thing in to
 * use a slice of it, and the slices did not overlap. It is now `lib/pipe.ts`, `lib/bridge.ts`, `lib/workspace.ts`,
 * `lib/compile.ts`, `lib/roundtrip.ts` and `lib/versions.ts`.</p>
 *
 * <p>This file exists so the migration is incremental rather than a single unreviewable rewrite. <b>New tests must
 * import from `lib/` directly.</b> It goes away when the last file has moved.</p>
 *
 * <p>Gone already, with nothing to re-export: <code>get</code>/<code>post</code> (the suite spoke HTTP —
 * <code>get("/health")</code> — to a wire that has not been HTTP for a long time), <code>plcRoot</code>,
 * <code>bodyOf</code> and the <code>Snapshot</code> type had no importers outside the harness itself.</p>
 */
export { VENDOR, BASE, currentPipe, livePipes, livePipesFor } from "./lib/pipe"
export { bridge, clientFor, opErrorCode, healthStatus, expectVendorDifference, type PipeClient } from "./lib/bridge"
export {
	PREFIX,
	FOLDER,
	id,
	fid,
	requireHealthy,
	pushOps,
	landedInFull,
	cleanup,
	removeItem,
	plcFolder,
	mainProgram,
	createItem,
	updateItem,
	fetchItem,
	fetchSource,
	versionOf,
} from "./lib/workspace"
export { ensureCompiles, instantiate, diagnostics, withMainProgramRestored, clearTestInstances } from "./lib/compile"
export { expectRoundTrip, expectRoundTripOrRefusal, expectStable, expectNoOperandsLost, bodyOf } from "./lib/roundtrip"
export { snapshot, assertDelta, libraryRoots, inLibrary, type Snapshot } from "./lib/versions"

import { expect } from "bun:test"
import { fetchItem, mainProgram, pushOps } from "./lib/workspace"
import { clearTestInstances } from "./lib/compile"
import { snapshot as _snapshot, versionIn, has } from "./lib/versions"

/** @deprecated use `versionIn` from lib/versions. */
export const snapshotItem = versionIn
/** @deprecated use `has` from lib/versions. */
export const snapshotHas = has

/** @deprecated use `instantiate` from lib/compile. */
export { instantiate as instantiateInPlcPrg } from "./lib/compile"

/** @deprecated use `clearTestInstances` from lib/compile. */
export const fixPlcPrg = clearTestInstances

/**
 * The main program's text, saved so a test can put it back.
 *
 * @deprecated Use `withMainProgramRestored(async () => { … })`, which cannot be unbalanced.
 *
 * <p><b>A STACK, not the single slot this used to be.</b> The original held ONE module-level string shared by 14
 * files: a second save before the matching restore silently overwrote the first's original, and the restore nulled
 * the slot even when its push had been REJECTED — it only warned. A failed restore therefore lost the original
 * irrecoverably and left the fixture's main program edited. A stack makes nesting safe, and a refused restore now
 * throws instead of reporting success over a dirty fixture.</p>
 */
const _mainProgramStack: string[] = []

export async function savePlcPrg(): Promise<void> {
	const main = await mainProgram()
	if (!main) return
	_mainProgramStack.push((await fetchItem(main)).sourceText)
}

export async function restorePlcPrg(): Promise<void> {
	const original = _mainProgramStack.pop()
	if (original === undefined) return
	const main = await mainProgram()
	if (!main) return
	const current = await fetchItem(main)
	if (current.sourceText === original) return
	const r = await pushOps([{ op: "set", name: main, toFolder: null, sourceText: original, ifVersion: current.version }])
	// The message is built ONLY on failure. `expect(cond, msg)` evaluates `msg` eagerly, and `r.conflicts` is
	// undefined on an accepted push — so an inline `JSON.stringify(r.conflicts).slice(…)` threw on the happy path
	// and failed every test that restores the main program.
	if (!r.accepted)
		throw new Error(
			`could not restore '${main}' — the fixture's main program is left edited: ` +
				JSON.stringify(r.conflicts ?? r).slice(0, 300),
		)
}

/** @deprecated re-exported for the few callers still importing it from here. */
export const PIPE = (await import("./lib/pipe")).BASE.replace(/^pipe /, "")
export { _snapshot as snapshotOf }
