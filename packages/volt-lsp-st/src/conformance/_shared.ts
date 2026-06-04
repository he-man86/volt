/**
 * Shared workspace setup for the *-corpus.test.ts files that need
 * cross-file LSP behavior (hover / definition / references /
 * completion / signature-help). Mirrors what the recorder does to
 * drive TC: each test gets its POU file PLUS a synthesized PLC_PRG
 * built from `test.plcPrgVar` + `test.plcPrgBody`. Cross-file
 * resolution then works exactly the way TC sees it.
 *
 * doc-symbols and semantic-tokens are per-file shape queries and
 * don't use this — they stay simple.
 */
import { Workspace, type Document } from "../lsp/workspace.js";
import type { LanguageTest } from "./types.js";

export const KIND_EXT: Record<LanguageTest["kind"], string> = {
	function_block: "st",
	function: "st",
	program: "st",
	gvl: "gvl",
	structure: "dut",
	interface: "itf",
};

/**
 * File extension for the test's POU file. Honors `bodyLanguage` for
 * graphical POUs (FBD/LD/SFC/CFC) so the workspace + LSP route them
 * through the right body parser. ST-bodied POUs fall back to KIND_EXT.
 */
export function extensionFor(t: LanguageTest): string {
	if (t.bodyLanguage !== undefined && t.bodyLanguage !== "structured-text") {
		return t.bodyLanguage.toLowerCase();
	}
	return KIND_EXT[t.kind];
}

export const PLC_PRG_URI = "file:///conformance/PLC_PRG.st";

/**
 * Build the PLC_PRG source that instantiates this test's POU. Matches
 * the shape `buildMegaPlcPrg` in volt-agent's recorder uses, but for
 * a single test (single var + single body).
 */
export function buildPlcPrgForTest(t: LanguageTest): string {
	const varLine = t.plcPrgVar !== undefined ? `\t${t.plcPrgVar}\n` : "";
	const body = t.plcPrgBody !== undefined ? `${t.plcPrgBody}\n` : "";
	return `PROGRAM PLC_PRG
VAR
${varLine}END_VAR
${body}END_PROGRAM
`;
}

export interface CorpusWorkspace {
	ws: Workspace;
	pouDoc: Document;
	pouUri: string;
	pouSource: string;
	plcPrgDoc: Document;
	plcPrgSource: string;
}

/**
 * Open the test POU + a per-test PLC_PRG into a fresh workspace.
 * Throws if the workspace can't locate the documents after open —
 * indicates a setup-side bug, not a test failure.
 */
export function buildCorpusWorkspace(t: LanguageTest): CorpusWorkspace {
	const pouUri = `file:///conformance/${t.pouName}.${extensionFor(t)}`;
	const plcPrgSource = buildPlcPrgForTest(t);

	const ws = new Workspace();
	// Pass the right languageId so graphical POUs route through the
	// FBD/LD parser. ST POUs get the default (structured-text).
	const languageId = languageIdFor(t);
	ws.openDocument(pouUri, t.source, 1, languageId);
	ws.openDocument(PLC_PRG_URI, plcPrgSource, 1);

	const pouDoc = ws.getDocument(pouUri);
	const plcPrgDoc = ws.getDocument(PLC_PRG_URI);
	if (pouDoc === undefined || plcPrgDoc === undefined) {
		throw new Error(`corpus workspace setup failed for ${t.name}`);
	}

	return { ws, pouDoc, pouUri, pouSource: t.source, plcPrgDoc, plcPrgSource };
}

/** VS Code language ID for the test's POU file. Mirrors the body
 *  parsers registry in `body/index.ts`. */
export function languageIdFor(t: LanguageTest): string {
	switch (t.bodyLanguage) {
		case "FBD":
			return "plc-fbd";
		case "LD":
			return "plc-ld";
		default:
			return "structured-text";
	}
}
