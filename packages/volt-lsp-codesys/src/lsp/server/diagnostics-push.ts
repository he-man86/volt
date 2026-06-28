/**
 * Push-diagnostics surface — debouncing + LSP-shape conversion.
 *
 * Two responsibilities, kept together because they share the same
 * input (a document's parse + semantic state):
 *
 *   1. `computeDiagnostics(workspace, uri)` — produce the LSP-shaped
 *      diagnostics list for a document. Pure: same workspace + uri →
 *      same array. Called from both push (debounced) and pull
 *      (textDocument/diagnostic).
 *
 *   2. `DiagnosticsPusher` — debounces `textDocument/publishDiagnostics`
 *      notifications. Matches tsserver / opencode's 150ms cadence —
 *      long enough to coalesce rapid typing, short enough that the
 *      user feels the feedback.
 */
import { computeSemanticDiagnostics } from "../../semantic/diagnostics.js";
import type { JsonRpcMessage } from "../types.js";
import type { Workspace } from "../workspace.js";

interface LspDiagnostic {
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
	severity: number;
	source: string;
	code?: string;
	message: string;
}

/**
 * Build the diagnostics list for one document. Merges parse errors
 * with semantic diagnostics; both pass through the workspace's
 * resolved config so vendor-filtered rules behave identically here
 * and in the conformance harness.
 *
 * Returns `[]` when the document isn't open — that's how the LSP
 * sees "uri unknown to us" (post-didClose, or never-opened).
 */
export function computeDiagnostics(
	workspace: Workspace,
	uri: string,
): LspDiagnostic[] {
	const doc = workspace.getDocument(uri);
	if (doc === undefined) return [];

	const parseDiags: LspDiagnostic[] = doc.parseResult.errors.map((e) => ({
		range: {
			start: { line: e.span.startLine - 1, character: e.span.startCol },
			end: { line: e.span.endLine - 1, character: e.span.endCol },
		},
		severity: 1, // Error
		source: "volt-lsp-codesys",
		message: e.message,
	}));

	const semantic: LspDiagnostic[] = computeSemanticDiagnostics({
		parseResult: doc.parseResult,
		source: doc.source,
		project: workspace.getProjectScope(),
		config: workspace.config.diagnostics,
		activeVendor: workspace.config.vendor,
		bodyModels: doc.bodyModels,
	}).map((d) => ({
		range: {
			start: { line: d.span.startLine - 1, character: d.span.startCol },
			end: { line: d.span.endLine - 1, character: d.span.endCol },
		},
		severity: severityToNumber(d.severity),
		source: d.source,
		code: d.code,
		message: d.message,
	}));

	return [...parseDiags, ...semantic];
}

function severityToNumber(s: "error" | "warning" | "information" | "hint"): number {
	switch (s) {
		case "error":       return 1;
		case "warning":     return 2;
		case "information": return 3;
		case "hint":        return 4;
	}
}

/**
 * Per-document debounce timers for push diagnostics. 150ms matches
 * tsserver / opencode — coalesces rapid typing, fast enough to feel
 * responsive. Each `schedule(uri)` resets the timer for that URI; the
 * latest schedule wins.
 */
export class DiagnosticsPusher {
	private static readonly DEBOUNCE_MS = 150;
	private readonly timers = new Map<string, NodeJS.Timeout>();

	constructor(
		private readonly workspace: Workspace,
		private readonly send: (msg: JsonRpcMessage) => void,
	) {}

	schedule(uri: string): void {
		const existing = this.timers.get(uri);
		if (existing !== undefined) clearTimeout(existing);
		const timer = setTimeout(() => {
			this.timers.delete(uri);
			this.send({
				jsonrpc: "2.0",
				method: "textDocument/publishDiagnostics",
				params: { uri, diagnostics: computeDiagnostics(this.workspace, uri) },
			});
		}, DiagnosticsPusher.DEBOUNCE_MS);
		this.timers.set(uri, timer);
	}

	/** Drop any pending publish for this URI. Used on didClose so the
	 *  client doesn't get a delayed flash of stale diagnostics. */
	cancel(uri: string): void {
		const existing = this.timers.get(uri);
		if (existing !== undefined) {
			clearTimeout(existing);
			this.timers.delete(uri);
		}
	}
}
