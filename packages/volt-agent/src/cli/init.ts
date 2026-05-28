/**
 * `volt init` verb — bind the workspace folder to the IDE project.
 */
import { runInit } from "../engine/init.js";
import { flagBool, type VerbFn } from "./_shared.js";

export const init: VerbFn = async ({ workspace, port, bridge, flags }) => {
	const r = await runInit(workspace, bridge, port, { force: flagBool(flags, "force") });
	const project = `${r.platform}/${r.projectName}/${r.plcProjectName}`;
	if (r.alreadyInitialized) {
		console.log(`workspace already initialized for ${project}`);
	} else {
		console.log(`initialized workspace for ${project}`);
		console.log("next: run `volt import` to populate.");
	}
	if (r.corpus !== undefined) {
		if (r.corpus.filesCopied > 0) {
			console.log(
				`Language reference: installed ${r.corpus.filesCopied} files; SKILL.md ${r.corpus.skillAction}.`,
			);
		} else if (r.corpus.skillAction === "unchanged") {
			// Idempotent re-run — already present.
		}
	}
	if (r.detectedVendor !== undefined) {
		console.log(`Detected vendor: ${r.detectedVendor}.`);
	}
	return 0;
};
