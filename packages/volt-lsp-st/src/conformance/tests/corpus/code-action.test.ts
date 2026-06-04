/**
 * Code-action corpus: snapshot the offered quickfixes for every
 * diagnostic the LSP emits on every test source. Code actions are
 * diagnostic-driven — compute diagnostics first, then call
 * `codeActions` per diagnostic with that diagnostic's range as the
 * context. Snapshot the action titles + kinds per diagnostic.
 *
 * Per probe: `{file, diagCode, title, kind}` for each offered action.
 * Tests whose diagnostics offer no actions snapshot as `[]`. Tests
 * with a clean source (no diagnostics) also snapshot as `[]`.
 *
 * Snapshot signal: a regression where a fixable diagnostic loses its
 * quickfix shows as that test's `title` entry disappearing.
 */
import { describe, expect, it } from "bun:test";
import { codeActions } from "../../../lsp/queries/code-action.js";
import { computeSemanticDiagnostics } from "../../../semantic/diagnostics.js";
import { DEFAULT_DIAGNOSTIC_CONFIG, type DiagnosticConfig } from "../../../lsp/config.js";
import { rangeFromSpan } from "../../../lsp/position.js";
import { buildCorpusWorkspace } from "../../_shared.js";
import { ALL_TESTS } from "../../fixtures/index.js";

// Flip every diagnostic check ON. DEFAULT_DIAGNOSTIC_CONFIG ships
// stricter-than-TC lints OFF (per the LSP-mirrors-TC design), but
// those are exactly the diagnostics that have code-action fixes.
// This corpus is about exercising the code-action machinery, so we
// want maximum diagnostic surface.
const ALL_CHECKS_ON: DiagnosticConfig = Object.fromEntries(
	Object.keys(DEFAULT_DIAGNOSTIC_CONFIG).map((k) => [k, true]),
) as DiagnosticConfig;

interface ActionProbe {
	file: "pou" | "plc_prg";
	diagCode: string | undefined;
	title: string;
	kind: string | undefined;
}

function probe(
	doc: Parameters<typeof codeActions>[0]["doc"],
	project: Parameters<typeof computeSemanticDiagnostics>[0]["project"],
	tag: "pou" | "plc_prg",
): ActionProbe[] {
	const out: ActionProbe[] = [];
	const diagnostics = computeSemanticDiagnostics({
		parseResult: doc.parseResult,
		source: doc.source,
		project,
		config: ALL_CHECKS_ON,
		activeVendor: "twincat",
		languageId: "structured-text",
		bodyModels: doc.bodyModels,
	});
	for (const diag of diagnostics) {
		// The code-action handlers in src/lsp/queries/code-action.ts expect
		// LSP-shape Diagnostic with `range`; the in-process diagnostic uses
		// our internal `span`. Convert before passing.
		const lspRange = rangeFromSpan(diag.span);
		const lspDiag = {
			range: lspRange,
			severity: diag.severity === "error" ? 1 : diag.severity === "warning" ? 2 : 3,
			code: diag.code,
			source: diag.source,
			message: diag.message,
		};
		const actions = codeActions({
			doc,
			params: {
				textDocument: { uri: doc.uri },
				range: lspRange,
				context: { diagnostics: [lspDiag] as never },
			},
		});
		const code = typeof diag.code === "string" ? diag.code : undefined;
		for (const a of actions) {
			out.push({
				file: tag,
				diagCode: code,
				title: a.title,
				kind: a.kind,
			});
		}
	}
	return out;
}

describe("codeAction corpus (every diagnostic in POU + PLC_PRG)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const { ws, pouDoc, plcPrgDoc } = buildCorpusWorkspace(t);
			const project = ws.getProjectScope();
			const probes = [
				...probe(pouDoc, project, "pou"),
				...probe(plcPrgDoc, project, "plc_prg"),
			];
			expect(probes).toMatchSnapshot();
		});
	}
});
