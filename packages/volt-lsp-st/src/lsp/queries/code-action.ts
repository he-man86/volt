/**
 * `textDocument/codeAction` — quick fixes for our own diagnostics.
 *
 * The LSP client (VS Code, opencode, etc.) sends a CodeActionParams
 * containing the diagnostics in the current range. For each
 * diagnostic whose `code` matches a fixable rule, we return a
 * CodeAction with a `WorkspaceEdit` that applies the fix.
 *
 * Fixable codes (mapped to mechanical, low-risk edits):
 *   - `pragma-missing-companion` → insert `{attribute 'reflection'}`
 *     above the enclosing FB declaration.
 *   - `double-underscore-prefix` → suggest renaming to drop the `__`
 *     prefix (offer single-underscore alternative as a refactor).
 *   - `consecutive-underscores` → suggest collapsing to single underscore.
 *   - `init-slot-collision` → suggest the nearest free slot
 *     (e.g. 50001 or 49989).
 *
 * Codes we do NOT auto-fix (judgment call required):
 *   - `reserved-keyword` — user must rename meaningfully
 *   - `duplicate-declaration` — could remove or rename, unclear which
 *   - `unresolved-identifier` — could be a typo or a library import
 *   - `fb-lifecycle-signature` — many possible fixes
 *   - `pragma-conflict` — unclear which to remove
 *   - `shadowing-declaration` — informational; not a fix candidate
 *   - `unknown-pragma` — could be a typo or a vendor extension
 */
import type {
	CodeAction,
	CodeActionParams,
	Diagnostic,
	Range,
} from "vscode-languageserver-protocol";
import { CodeActionKind } from "vscode-languageserver-protocol";
import type { Document } from "../workspace.js";

export interface CodeActionArgs {
	doc: Document;
	params: CodeActionParams;
}

export function codeActions(args: CodeActionArgs): CodeAction[] {
	const actions: CodeAction[] = [];
	const uri = args.params.textDocument.uri;
	for (const diag of args.params.context.diagnostics) {
		const code = typeof diag.code === "string" ? diag.code : undefined;
		switch (code) {
			case "pragma-missing-companion":
				actions.push(...fixMissingCompanion(uri, diag, args.doc));
				break;
			case "double-underscore-prefix":
				actions.push(fixDoubleUnderscore(uri, diag, args.doc));
				break;
			case "consecutive-underscores":
				actions.push(fixConsecutiveUnderscores(uri, diag, args.doc));
				break;
			case "init-slot-collision":
				actions.push(fixInitSlotCollision(uri, diag, args.doc));
				break;
		}
	}
	return actions;
}

// ─── Fix builders ────────────────────────────────────────────────────

function fixMissingCompanion(uri: string, diag: Diagnostic, doc: Document): CodeAction[] {
	// Extract the required pragma name from the message.
	// Message form: "Pragma 'X' requires companion 'Y' on the enclosing FB or variable."
	const m = /requires companion '([^']+)'/.exec(diag.message);
	if (m === null) return [];
	const companion = m[1] as string;
	// Insert at the very start of the line containing the diagnostic.
	const insertLine = diag.range.start.line;
	const insertRange: Range = {
		start: { line: insertLine, character: 0 },
		end: { line: insertLine, character: 0 },
	};
	return [
		{
			title: `Add companion pragma '{attribute '${companion}'}'`,
			kind: CodeActionKind.QuickFix,
			diagnostics: [diag],
			isPreferred: true,
			edit: {
				changes: {
					[uri]: [
						{
							range: insertRange,
							newText: `{attribute '${companion}'}\n`,
						},
					],
				},
			},
		},
	];
}

function fixDoubleUnderscore(uri: string, diag: Diagnostic, doc: Document): CodeAction {
	const text = textInRange(doc.source, diag.range);
	const renamed = text.replace(/^__/, "_");
	return {
		title: `Rename to '${renamed}'`,
		kind: CodeActionKind.QuickFix,
		diagnostics: [diag],
		edit: {
			changes: {
				[uri]: [{ range: diag.range, newText: renamed }],
			},
		},
	};
}

function fixConsecutiveUnderscores(uri: string, diag: Diagnostic, doc: Document): CodeAction {
	const text = textInRange(doc.source, diag.range);
	const renamed = text.replace(/_{2,}/g, "_");
	return {
		title: `Collapse underscores → '${renamed}'`,
		kind: CodeActionKind.QuickFix,
		diagnostics: [diag],
		edit: {
			changes: {
				[uri]: [{ range: diag.range, newText: renamed }],
			},
		},
	};
}

function fixInitSlotCollision(uri: string, diag: Diagnostic, doc: Document): CodeAction {
	// Pull the slot number out of the source range, suggest +1.
	const text = textInRange(doc.source, diag.range);
	const m = /(\d+)/.exec(text);
	if (m === null) {
		return {
			title: "Change to a unique slot number",
			kind: CodeActionKind.QuickFix,
			diagnostics: [diag],
		};
	}
	const current = Number(m[1]);
	const suggested = current + 1;
	const replaced = text.replace(/\d+/, String(suggested));
	return {
		title: `Use slot ${suggested} (unique)`,
		kind: CodeActionKind.QuickFix,
		diagnostics: [diag],
		edit: {
			changes: {
				[uri]: [{ range: diag.range, newText: replaced }],
			},
		},
	};
}

// ─── Helper ──────────────────────────────────────────────────────────

function textInRange(source: string, range: Range): string {
	const lines = source.split(/\r?\n/);
	if (range.start.line === range.end.line) {
		const line = lines[range.start.line] ?? "";
		return line.slice(range.start.character, range.end.character);
	}
	const parts: string[] = [];
	const firstLine = lines[range.start.line] ?? "";
	parts.push(firstLine.slice(range.start.character));
	for (let i = range.start.line + 1; i < range.end.line; i++) {
		parts.push(lines[i] ?? "");
	}
	const lastLine = lines[range.end.line] ?? "";
	parts.push(lastLine.slice(0, range.end.character));
	return parts.join("\n");
}
