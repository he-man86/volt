/**
 * The bodies the IDE holds for a POU, BYTE FOR BYTE, on either vendor — what a test compares before and after a push
 * to prove the push never wrote a body Volt does not show (openspec `implementation-keyword`, "nothing in the IDE is
 * overwritten").
 *
 * The assertion is the same on both vendors; only where the bytes can be read differs. TwinCAT saves every push to its
 * `.TcPOU`, whose `<Implementation>` elements are the bodies (`tc-files.ts`). CODESYS saves nothing and keeps a binary
 * archive, so the served IDE exports the object in its own native serialization and its `Implementation` elements are
 * compared (`codesys-native.ts`).
 */
import { expectVendorDifference } from "./bridge"
import { codesysImplementations } from "./codesys-native"
import { tcImplementations, tcPouFile } from "./tc-files"

/** Every body of `bare` — its own, each member's and accessor's — as the IDE holds it, in order. `project` is the
 *  served project (`servedProject(health)`), which TwinCAT's file lookup needs. */
export async function heldImplementations(bare: string, project: string): Promise<string[]> {
	return expectVendorDifference(
		"openspec implementation-keyword 4.1: TwinCAT saves a push to a readable .TcPOU; CODESYS saves nothing, so its " +
			"bodies are read through the served IDE's native export",
		{
			twincat: async () => tcImplementations(tcPouFile(bare, project)),
			codesys: () => codesysImplementations(bare),
		},
	)
}
