/**
 * WHICH VENDOR'S DIALECT THIS WINDOW'S LANGUAGE SERVER SPEAKS.
 *
 * <p>Its own module, and not because `lsp.ts` is crowded: `lsp.ts` imports `vscode`, which does not resolve
 * outside an editor, so nothing in it can be tested. This is a pure function of (the setting, the folder paths)
 * and the only decision in the launch that is not VS Code API — so it lives where a test can reach it.</p>
 *
 * <p>`auto` is the DEFAULT and it used to mean codesys: the launch read
 * `vendor === "twincat" ? --twincat : --codesys`, so a TwinCAT workspace on the default got the CODESYS dialect
 * while the setting's own description promised a workspace scan. That was cosmetic once and is not any more —
 * `project.dialect` decides which names resolve and how each message is worded, so the wrong vendor is wrong
 * answers rather than wrong labels.</p>
 *
 * <p>It resolves from the BINDING, which is a better answer than the scan the description promised: `volt init
 * --vendor` wrote it, `.git/volt/config.json` holds it, and this extension already reads it for the panel.</p>
 */
import { readBridgeVendor } from "@volt/control"

export type ConfiguredVendor = "codesys" | "twincat" | "auto"

/**
 * EVERY bound folder is considered, not `workspaceFolders[0]`. A multi-root window whose first folder is unbound
 * would otherwise fall to codesys while the bound folder beside it is TwinCAT — and the rest of the extension
 * already scans all of them (`extension.ts` adds a workspace per folder that has a `.git/volt/config.json`).
 *
 * One server serves the window, so two differently-bound folders cannot both be served: the first BOUND one
 * wins, and that is stated here rather than left to folder order by accident. An unbound window has no IDE to
 * be wrong about, so codesys — the larger install base — stays the fallback.
 */
export function resolveVendor(configured: ConfiguredVendor, roots: readonly string[]): "codesys" | "twincat" {
	if (configured !== "auto") return configured
	for (const root of roots) {
		const bound = readBridgeVendor(root)
		if (bound !== undefined) return bound
	}
	return "codesys"
}
