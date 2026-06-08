/**
 * `textDocument/codeAction` — quick fixes for our own diagnostics.
 *
 * The LSP client (VS Code, opencode, etc.) sends a CodeActionParams
 * containing the diagnostics in the current range. For each
 * diagnostic whose `code` matches a fixable rule, we return a
 * CodeAction with a `WorkspaceEdit` that applies the fix.
 *
 * Fixable codes:
 *   - `pragma-missing-companion` → insert `{attribute 'X'}` above FB
 *   - `double-underscore-prefix` → rename to drop `__` prefix
 *   - `consecutive-underscores` → collapse to single underscore
 *   - `init-slot-collision` → suggest nearest free slot
 *   - `conversion-source-mismatch` → swap call name to suggested conversion
 *   - `assignment-type-mismatch` → wrap RHS in explicit conversion
 *   - `missing-interface-implementation` → insert METHOD/PROPERTY stub
 *   - `deref-non-pointer` → remove the `^` caret
 *   - `var-section-placement` → remove NON_RETAIN modifier (sub-case only)
 *
 * Codes we do NOT auto-fix (judgment call required):
 *   - `reserved-keyword` — user must rename meaningfully
 *   - `duplicate-declaration` — ambiguous which to remove
 *   - `unresolved-identifier` — typo vs. missing library
 *   - `fb-lifecycle-signature` — many possible correct shapes
 *   - `pragma-conflict` — unclear which pragma to remove
 *   - `shadowing-declaration` — informational; rename is risky
 *   - `unknown-pragma` — typo vs. vendor extension
 *   - `binary-op-type-mismatch` — needs expression-level context
 *   - `vendor-only-operator` — semantic change, not mechanical
 */
import type {
	CodeAction,
	CodeActionParams,
	Diagnostic,
	Range,
} from "vscode-languageserver-protocol";
import { CodeActionKind } from "vscode-languageserver-protocol";
import type { Document } from "../workspace.js";
import type { Scope } from "../../semantic/symbol-table.js";
import { lookupLocal } from "../../semantic/symbol-table.js";
import { findScopeByName } from "../../semantic/checks/_shared.js";
import { getConversion } from "../../reference/type-conversion.js";
import type { FunctionBlock, InterfaceMethod, InterfaceProperty, TypeExpr } from "../../parser/ast.js";

export interface CodeActionArgs {
	doc: Document;
	params: CodeActionParams;
	/** Full project scope — needed for stubs that reference interface signatures. */
	project?: Scope;
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
			case "conversion-source-mismatch": {
				const a = fixConversionSourceMismatch(uri, diag);
				if (a !== undefined) actions.push(a);
				break;
			}
			case "assignment-type-mismatch": {
				const a = fixAssignmentTypeMismatch(uri, diag, args.doc);
				if (a !== undefined) actions.push(a);
				break;
			}
			case "missing-interface-implementation":
				if (args.project !== undefined) {
					actions.push(...fixMissingInterfaceImplementation(uri, diag, args.doc, args.project));
				}
				break;
			case "deref-non-pointer":
				actions.push(fixDerefNonPointer(uri, diag));
				break;
			case "var-section-placement": {
				const a = fixVarSectionPlacementNonRetain(uri, diag, args.doc);
				if (a !== undefined) actions.push(a);
				break;
			}
		}
	}
	return actions;
}

// ─── Fix builders ────────────────────────────────────────────────────

function fixMissingCompanion(uri: string, diag: Diagnostic, doc: Document): CodeAction[] {
	const m = /requires companion '([^']+)'/.exec(diag.message);
	if (m === null) return [];
	const companion = m[1] as string;
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
					[uri]: [{ range: insertRange, newText: `{attribute '${companion}'}\n` }],
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
		edit: { changes: { [uri]: [{ range: diag.range, newText: renamed }] } },
	};
}

function fixConsecutiveUnderscores(uri: string, diag: Diagnostic, doc: Document): CodeAction {
	const text = textInRange(doc.source, diag.range);
	const renamed = text.replace(/_{2,}/g, "_");
	return {
		title: `Collapse underscores → '${renamed}'`,
		kind: CodeActionKind.QuickFix,
		diagnostics: [diag],
		edit: { changes: { [uri]: [{ range: diag.range, newText: renamed }] } },
	};
}

function fixInitSlotCollision(uri: string, diag: Diagnostic, doc: Document): CodeAction {
	const text = textInRange(doc.source, diag.range);
	const m = /(\d+)/.exec(text);
	if (m === null) {
		return {
			title: "Change to a unique slot number",
			kind: CodeActionKind.QuickFix,
			diagnostics: [diag],
		};
	}
	const suggested = Number(m[1]) + 1;
	const replaced = text.replace(/\d+/, String(suggested));
	return {
		title: `Use slot ${suggested} (unique)`,
		kind: CodeActionKind.QuickFix,
		diagnostics: [diag],
		edit: { changes: { [uri]: [{ range: diag.range, newText: replaced }] } },
	};
}

/**
 * `conversion-source-mismatch` — swap the call name for the suggested
 * alternative. The message always embeds the replacement in the form
 * `Use \`SUGGESTED_NAME(arg)\` instead.` when one exists.
 */
function fixConversionSourceMismatch(uri: string, diag: Diagnostic): CodeAction | undefined {
	const m = /Use `(\S+)\(/.exec(diag.message);
	if (!m) return undefined;
	const suggestedName = m[1]!;
	return {
		title: `Replace with '${suggestedName}'`,
		kind: CodeActionKind.QuickFix,
		diagnostics: [diag],
		isPreferred: true,
		edit: { changes: { [uri]: [{ range: diag.range, newText: suggestedName }] } },
	};
}

/**
 * `assignment-type-mismatch` — wrap the RHS value in an explicit
 * conversion. Only fires when a conversion from RHS type to LHS type
 * exists in the type-conversion catalog.
 *
 * The diagnostic range covers the LHS identifier. We scan forward on
 * the same source line to locate `:=` and the single-token RHS.
 */
function fixAssignmentTypeMismatch(uri: string, diag: Diagnostic, doc: Document): CodeAction | undefined {
	// Message: "Cannot assign ${rhsType} value to '${lhsName}' (declared ${lhsType})."
	const m = /Cannot assign (\w+) value to '[^']+' \(declared (\w+)\)/.exec(diag.message);
	if (!m) return undefined;
	const rhsType = m[1]!;
	const lhsType = m[2]!;
	const convName = `${rhsType}_TO_${lhsType}`;
	if (getConversion(convName) === undefined) return undefined;

	const lines = doc.source.split(/\r?\n/);
	const lineTxt = lines[diag.range.end.line] ?? "";

	// Scan for `:=` on this line after the LHS end character.
	const afterLhs = lineTxt.slice(diag.range.end.character);
	const assignM = /^\s*:=\s*/.exec(afterLhs);
	if (!assignM) return undefined;
	const rhsStartChar = diag.range.end.character + assignM[0].length;

	// RHS is a single non-whitespace token up to `;`.
	const afterAssign = lineTxt.slice(rhsStartChar);
	const rhsM = /^(\S+)\s*;/.exec(afterAssign.trimStart());
	if (!rhsM) return undefined;
	const leadingSpaces = afterAssign.length - afterAssign.trimStart().length;
	const rhsText = rhsM[1]!;
	const actualStart = rhsStartChar + leadingSpaces;

	const rhsRange: Range = {
		start: { line: diag.range.end.line, character: actualStart },
		end: { line: diag.range.end.line, character: actualStart + rhsText.length },
	};
	return {
		title: `Wrap with ${convName}(...)`,
		kind: CodeActionKind.QuickFix,
		diagnostics: [diag],
		edit: { changes: { [uri]: [{ range: rhsRange, newText: `${convName}(${rhsText})` }] } },
	};
}

/**
 * `missing-interface-implementation` — insert a METHOD or PROPERTY stub
 * after the `END_FUNCTION_BLOCK` line. When the interface scope is
 * available via `project`, the stub includes the full signature from
 * the interface declaration; otherwise it falls back to a bare skeleton.
 */
function fixMissingInterfaceImplementation(
	uri: string,
	diag: Diagnostic,
	doc: Document,
	project: Scope,
): CodeAction[] {
	// Message: "FB '${fbName}' implements '${ifaceName}' but doesn't provide method|property '${memberName}'."
	const m = /FB '([^']+)' implements '([^']+)' but doesn't provide (method|property) '([^']+)'/.exec(diag.message);
	if (!m) return [];
	const [, fbName, ifaceName, memberKind, memberName] = m;

	// Find the FB unit in the current document.
	const fbUnit = doc.parseResult.units.find(
		(u): u is FunctionBlock =>
			u.kind === "function_block" && u.name.text.toLowerCase() === fbName.toLowerCase(),
	);
	if (fbUnit === undefined) return [];

	// Insert on the line after END_FUNCTION_BLOCK.
	// span.endLine is 1-based; LSP line for the line after = endLine (not -1, since +1 cancels).
	const insertPos = { line: fbUnit.span.endLine, character: 0 };

	// Try to look up the interface member signature for a richer stub.
	const ifaceScope = findScopeByName(project, ifaceName);
	const memberSymbols = ifaceScope !== undefined ? lookupLocal(ifaceScope, memberName) : [];
	const memberSym = memberSymbols.find(
		(s) => s.kind === "interface_method" || s.kind === "interface_property",
	);

	let stubText: string;
	if (memberKind === "method") {
		stubText = generateMethodStub(memberName, memberSym?.ast as InterfaceMethod | undefined);
	} else {
		stubText = generatePropertyStub(memberName, memberSym?.ast as InterfaceProperty | undefined);
	}

	return [
		{
			title: `Implement ${memberKind} '${memberName}'`,
			kind: CodeActionKind.QuickFix,
			diagnostics: [diag],
			isPreferred: false, // Stub is syntactically valid but not functional yet
			edit: {
				changes: {
					[uri]: [
						{
							range: { start: insertPos, end: insertPos },
							newText: "\n" + stubText + "\n",
						},
					],
				},
			},
		},
	];
}

/** `deref-non-pointer` — delete the `^` caret token at the diagnostic span. */
function fixDerefNonPointer(uri: string, diag: Diagnostic): CodeAction {
	return {
		title: "Remove `^` dereference",
		kind: CodeActionKind.QuickFix,
		diagnostics: [diag],
		isPreferred: true,
		edit: { changes: { [uri]: [{ range: diag.range, newText: "" }] } },
	};
}

/**
 * `var-section-placement` — for the `NON_RETAIN` sub-case only, remove the
 * `NON_RETAIN` modifier from `VAR NON_RETAIN`. Other sub-cases (VAR_TEMP in
 * METHOD, VAR_GLOBAL outside GVL) require structural changes that are
 * too ambiguous to auto-apply.
 */
function fixVarSectionPlacementNonRetain(
	uri: string,
	diag: Diagnostic,
	doc: Document,
): CodeAction | undefined {
	if (!diag.message.includes("NON_RETAIN")) return undefined;
	const lines = doc.source.split(/\r?\n/);
	const lineTxt = lines[diag.range.start.line] ?? "";
	const idx = lineTxt.toUpperCase().indexOf("NON_RETAIN");
	if (idx < 0) return undefined;
	// Remove " NON_RETAIN" (with the preceding space if present).
	const removeStart = idx > 0 && lineTxt[idx - 1] === " " ? idx - 1 : idx;
	const removeEnd = idx + "NON_RETAIN".length;
	return {
		title: "Remove NON_RETAIN modifier",
		kind: CodeActionKind.QuickFix,
		diagnostics: [diag],
		edit: {
			changes: {
				[uri]: [
					{
						range: {
							start: { line: diag.range.start.line, character: removeStart },
							end: { line: diag.range.start.line, character: removeEnd },
						},
						newText: "",
					},
				],
			},
		},
	};
}

// ─── Stub generators ─────────────────────────────────────────────────

function typeExprToString(te: TypeExpr): string {
	switch (te.kind) {
		case "named_type":
			return te.name.text;
		case "string_type":
			return te.wide ? "WSTRING" : "STRING";
		case "array_type":
			return `ARRAY[*] OF ${typeExprToString(te.element)}`;
		case "pointer_type":
			return `POINTER TO ${typeExprToString(te.target)}`;
		case "reference_type":
			return `REFERENCE TO ${typeExprToString(te.target)}`;
		case "implicit_enum_type":
			return "(...)";
		default:
			return "ANY";
	}
}

function generateMethodStub(name: string, ast: InterfaceMethod | undefined): string {
	const retType = ast?.returnType !== undefined ? ` : ${typeExprToString(ast.returnType)}` : "";
	const sectionLines: string[] = [];
	if (ast !== undefined) {
		for (const sec of ast.varSections) {
			if (sec.sectionKind !== "VAR_INPUT" && sec.sectionKind !== "VAR_IN_OUT" && sec.sectionKind !== "VAR_OUTPUT") continue;
			sectionLines.push(`\t${sec.sectionKind}`);
			for (const decl of sec.decls) {
				const names = decl.names.map((n) => n.text).join(", ");
				sectionLines.push(`\t\t${names} : ${typeExprToString(decl.type)};`);
			}
			sectionLines.push("\tEND_VAR");
		}
	}
	const body = sectionLines.length > 0 ? "\n" + sectionLines.join("\n") + "\n" : "\n";
	return `METHOD ${name}${retType}${body}END_METHOD`;
}

function generatePropertyStub(name: string, ast: InterfaceProperty | undefined): string {
	const dataType = ast !== undefined ? typeExprToString(ast.dataType) : "ANY";
	const hasGetter = ast?.hasGetter ?? true;
	const hasSetter = ast?.hasSetter ?? true;
	const parts: string[] = [`PROPERTY ${name} : ${dataType}`];
	if (hasGetter) {
		parts.push("GET", `\t${name} := ;`, "END_GET");
	}
	if (hasSetter) {
		parts.push("SET", "END_SET");
	}
	parts.push("END_PROPERTY");
	return parts.join("\n");
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
