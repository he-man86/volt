/**
 * CHILD FOLDER PRESERVATION: an in-place edit must not flatten a POU's INTERNAL folders.
 *
 * `folder-preservation.test.ts` pins the ITEM's own folder. This pins the one a POU keeps INSIDE itself —
 * the `%FOLDER <path>` directive each child carries — and it is the case the measurement says will actually
 * break when `pou-writes-via-plcopen` §3.1 lands.
 *
 * Measured on CODESYS against `CassetteFB`, with the delete verified: an export → delete → import returns
 * every child but ZERO folders. 54 children with 2 folders (`Private`, `Properties`) came back as 52 with
 * none — `/Properties/ActualPositionX1` became `/ActualPositionX1`. `export_xml`'s `bExportFolderStructure`
 * flag is not the answer either: with it TRUE the export grows (so folder data IS written) and the import
 * still restores none.
 *
 * So the write must UNDO that flattening, re-placing each child through the `%FOLDER` path Volt already
 * carries (`PouToStText` writes it, `StSplitter` peels it, `PushService.ResolveFolder` applies it). This test
 * is what proves it did. Today it passes trivially — the per-child path never flattens anything — which is
 * exactly why it is written first.
 *
 * Real projects use these: `CassetteFB` separates `Private` helpers from `Properties`.
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { id, fid, cleanup, requireHealthy, createItem, updateItem, fetchItem, plcFolder, BASE } from "../harness"
import { fb, METHOD, PROPERTY } from "../fixtures"

/** A child body that declares its sub-folder, the way the materializer emits it. */
const inFolder = (folder: string, body: string) => `%FOLDER ${folder}\n${body}`

/** Every `%FOLDER <path>` directive in a materialized source, sorted — the child folder tree as text. */
function folderPaths(src: string): string[] {
	return (src.match(/^%FOLDER .+$/gm) ?? []).map((l) => l.trim()).sort()
}

describe(`lifecycle / child folder preservation (${BASE})`, () => {
	setDefaultTimeout(120_000)
	beforeAll(async () => {
		await requireHealthy()
		await cleanup()
	})
	afterAll(async () => {
		try {
			await cleanup()
		} catch {}
	})

	/** Children in sub-folders, at two depths, plus one at the POU root for contrast. */
	const children = (n: string) =>
		METHOD("Shallow", inFolder("Helpers", `Shallow := d;`)) +
		METHOD("Deep", inFolder("Helpers/Inner", `Deep := d;`)) +
		METHOD("AtRoot", `AtRoot := d;`) +
		PROPERTY("Speed")

	it("children keep their sub-folders across an in-place edit", async () => {
		const name = id("cf_keep")
		const wire = fid("cf_keep")
		const folder = await plcFolder("POUs")

		await createItem(wire, fb(name, { body: "x := 1;", children: children(name) }), folder)

		const created = await fetchItem(wire)
		const before = folderPaths(created.sourceText)
		// The create must actually have placed them — otherwise the edit assertion below proves nothing.
		expect(before).toEqual(["%FOLDER Helpers", "%FOLDER Helpers/Inner"])

		// Edit the POU body only. Nothing about the children changes.
		await updateItem(wire, fb(name, { body: "x := 2;", children: children(name) }))

		const edited = await fetchItem(wire)
		expect(edited.sourceText).toContain("x := 2")       // the edit landed
		expect(folderPaths(edited.sourceText)).toEqual(before) // ...and the child folders are untouched
	})

	it("a child at the POU root stays at the root, and the members all survive", async () => {
		const wire = fid("cf_keep")
		const fetched = await fetchItem(wire)

		// All four members still present after the edit above.
		for (const member of ["Shallow", "Deep", "AtRoot", "Speed"]) expect(fetched.sourceText).toContain(member)

		// Exactly two children declare a folder; AtRoot and the property do not — a flattening would show up
		// as fewer directives, and a spurious folder as more.
		expect(folderPaths(fetched.sourceText).length).toBe(2)
	})
})
