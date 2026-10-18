/**
 * The bodies the IDE holds for a POU, BYTE FOR BYTE, on either vendor — what a test compares before and after a push
 * to prove the push never wrote a body Volt does not show (openspec `implementation-keyword`, "nothing in the IDE is
 * overwritten").
 *
 * The assertion is the same on both vendors; only where the bytes can be read differs. On TwinCAT the engineer's save
 * (`tc-engineer.ts`; Volt saves nothing) puts what the IDE holds in the `.TcPOU`, whose `<Implementation>` elements are the
 * bodies (`tc-files.ts`). CODESYS keeps a binary archive, so the served IDE exports the object in its own native
 * serialization and its `Implementation` elements are compared (`codesys-native.ts`).
 */
import { expectVendorDifference } from "./bridge"
import { codesysImplementations } from "./codesys-native"
import { tcImplementations, tcPouFile } from "./tc-files"
import { engineerSaveAll } from "./tc-engineer"
import { currentPipe } from "./pipe"

/** Every body of an item — its own, each member's and accessor's — as the IDE holds it, in order. `item` is its bare
 *  name, or its wire path where two applications hold the name (every CodesysTestProject fixture carries two devices).
 *  `project` is the served project (`servedProject(health)`), which TwinCAT's file lookup needs. */
export async function heldImplementations(item: string, project: string): Promise<string[]> {
	const bare = item.slice(item.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "")
	return expectVendorDifference(
		"openspec implementation-keyword 4.1: TwinCAT keeps a saved project in readable .TcPOU files; CODESYS in a " +
			"binary archive, so its bodies are read through the served IDE's native export",
		{
			twincat: async () => {
				engineerSaveAll(currentPipe(), process.env.VOLT_E2E_INSTANCE ?? "")
				return tcImplementations(tcPouFile(bare, project))
			},
			codesys: () => codesysImplementations(item),
		},
	)
}
