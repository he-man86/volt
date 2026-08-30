/** Method C: the referenced-library precompile runs ONLY when a .library version changed. The .library files are
 *  hashed like any other file and carried in knownItems. A fetch whose knownItems already has them ships NO
 *  signature items (proof it didn't extract); a fetch without them ships the full set. */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { bridge, requireHealthy, BASE } from "../harness"

const LIB_EXT = ".library"

/** The folders the `.library` refs live in — one per referenced library. */
const libraryFolders = (f: any) =>
	new Set(
		(f.changed as any[])
			.filter((i) => String(i.name).toLowerCase().endsWith(LIB_EXT))
			.map((i) => String(i.folder ?? "")),
	)

/** A signature item is a rendered library ELEMENT: it sits in a `.library` ref's own folder and is not the
 *  `.library` file itself.
 *
 *  DERIVED, not matched on a folder NAME. This used to test `folder.includes("Library Manager/")`, which is
 *  CODESYS's name for that node — TwinCAT calls it `References` — so the predicate silently answered 0 on the
 *  other vendor. Combined with the suite being skipped there, that made the gate look green while measuring
 *  nothing. The folders are passed IN so the warm case is judged against the same set the cold case
 *  established; recomputing them from a fetch that ships no libraries would make "no signatures" trivially
 *  true and the assertion worthless. */
const libSigCount = (f: any, folders: Set<string>) => {
	// UNDER THE LIBRARY-MANAGER NODE, which is the parent the `.library` refs share — CODESYS calls it
	// "Library Manager", TwinCAT "References". Testing "inside a specific library" is too tight: an element whose
	// owning library matched no ref is deliberately foldered under an explicit `(unresolved)` marker beside the
	// libraries rather than inside one.
	const roots = new Set([...folders].map((f) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : f)))
	const inALibrary = (folder: string) =>
		[...roots].some((r) => r.length > 0 && (folder === r || folder.startsWith(r + "/")))
	return (f.changed as any[]).filter(
		(i) => !String(i.name).toLowerCase().endsWith(LIB_EXT) && inALibrary(String(i.folder ?? "")),
	).length
}

// BOTH VENDORS. This was CODESYS-only, on the reasoning that "TwinCAT has no equivalent surface wired up yet" —
// which DIALECT C2c had already measured to be false: `_ITcPlcLibraryManager.ProduceAllLibrarySignatures()` returns
// 181,179 chars out-of-process. The surface was there; Volt simply implemented no extraction, so TwinCAT users got
// no completion, hover or go-to-definition on any library FB while CODESYS users did. `BeckhoffDriver` now
// overrides `ExtractLibrarySignatures`, so the gate runs on both — which is the point of a parity boundary at the wire.
describe(`endpoints / library-signature gate (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(async () => { await requireHealthy() })

	it(".library resolutions carry a version (the change signal)", async () => {
		const f = await bridge.fetch({ knownItems: {} })
		const manifests = (f.changed as any[]).filter((i) => i.name.toLowerCase().endsWith(LIB_EXT))
		expect(manifests.length).toBeGreaterThan(0)
		const resolutions = manifests.map((m) => /^RESOLUTION (.+)$/m.exec(m.sourceText)?.[1] ?? "")
		expect(resolutions.every((r) => r.length > 0)).toBe(true)
		expect(resolutions.some((r) => /\d+\.\d+\.\d+/.test(r))).toBe(true)
	})

	it("unchanged .library versions in knownItems skip the precompile (no signature items); missing ones extract", async () => {
		// A fetch WITHOUT the .library versions extracts → ships the full signature set.
		const cold = await bridge.fetch({ knownItems: {} })
		const folders = libraryFolders(cold)
		expect(folders.size).toBeGreaterThan(0)
		expect(libSigCount(cold, folders)).toBeGreaterThan(0)
		const known = cold.items as Record<string, string> // includes every .library version
		expect(Object.keys(known).some((k) => k.toLowerCase().endsWith(LIB_EXT))).toBe(true)

		// A fetch WITH those versions known → no library changed → NO precompile → NO signature items shipped.
		const warm = await bridge.fetch({ knownItems: known })
		expect(libSigCount(warm, folders)).toBe(0)
	})
})
