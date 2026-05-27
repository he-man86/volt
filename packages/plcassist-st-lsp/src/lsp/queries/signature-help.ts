/**
 * `textDocument/signatureHelp` — show parameter info on method/function
 * calls.
 *
 * Resolution:
 *   1. Walk back from the cursor to find the most recent unmatched `(`.
 *   2. The identifier immediately before that `(` is the callee.
 *   3. Resolve the callee in the project scope.
 *   4. Build a SignatureInformation from its VAR_INPUT section.
 *   5. Count commas between `(` and cursor → active parameter index.
 */
import type {
	Position,
	SignatureHelp,
	SignatureInformation,
} from "vscode-languageserver-protocol";
import type { Scope } from "../../semantic/symbol-table.js";
import { offsetFromPosition } from "../position.js";
import type { Document } from "../workspace.js";

export interface SignatureHelpArgs {
	doc: Document;
	position: Position;
	project: Scope;
}

export function signatureHelp(args: SignatureHelpArgs): SignatureHelp | null {
	const offset = offsetFromPosition(args.doc.source, args.position);
	if (offset < 0) return null;
	const ctx = parseCallContext(args.doc.source, offset);
	if (ctx === undefined) return null;

	const target = findCallable(args.project, ctx.calleeName);
	if (target === undefined) return null;

	const params = collectVarInputParams(target.ast);
	if (params.length === 0) return null;

	const sig: SignatureInformation = {
		label: `${target.name}(${params.map((p) => `${p.name} : ${p.type}`).join(", ")})`,
		documentation: undefined,
		parameters: params.map((p) => ({ label: `${p.name} : ${p.type}` })),
	};

	return {
		signatures: [sig],
		activeSignature: 0,
		activeParameter: Math.min(ctx.activeParam, params.length - 1),
	};
}

interface CallContext {
	calleeName: string;
	activeParam: number;
}

/**
 * Walk back from `offset` to find the call site: most recent unmatched
 * `(`, the identifier before it, and the number of commas separating
 * the cursor from the opening paren.
 */
function parseCallContext(source: string, offset: number): CallContext | undefined {
	let depth = 0;
	let commas = 0;
	let i = offset - 1;
	while (i >= 0) {
		const ch = source[i] as string;
		if (ch === ")") depth++;
		else if (ch === "(") {
			if (depth === 0) break;
			depth--;
		} else if (ch === "," && depth === 0) {
			commas++;
		}
		i--;
	}
	if (i < 0) return undefined; // no unmatched `(` found

	// Walk left over whitespace before `(`.
	let j = i - 1;
	while (j >= 0 && /\s/.test(source[j] as string)) j--;
	// Collect identifier characters.
	let end = j + 1;
	while (j >= 0 && /[A-Za-z0-9_]/.test(source[j] as string)) j--;
	const start = j + 1;
	const calleeName = source.slice(start, end);
	if (calleeName.length === 0) return undefined;
	return { calleeName, activeParam: commas };
}

/**
 * Find a callable symbol (function / FB / method) by name. We accept
 * any symbol with `varSections`; the caller filters by VAR_INPUT.
 */
interface CallableSym {
	name: string;
	ast: { varSections?: ReadonlyArray<{ sectionKind: string; decls: ReadonlyArray<{ names: ReadonlyArray<{ text: string }>; type: unknown }> }> };
}

function findCallable(project: Scope, name: string): CallableSym | undefined {
	const target = name.toLowerCase();
	const stack: Scope[] = [project];
	while (stack.length > 0) {
		const sc = stack.pop()!;
		for (const [, syms] of sc.symbols) {
			for (const sym of syms) {
				if (sym.name.toLowerCase() === target) {
					// AST shape varies — TopLevel union includes some
					// with `varSections` and some without.
					const ast = sym.ast as { varSections?: ReadonlyArray<unknown> };
					if (Array.isArray(ast.varSections)) {
						return sym as unknown as CallableSym;
					}
				}
			}
		}
		stack.push(...sc.children);
	}
	return undefined;
}

function collectVarInputParams(ast: CallableSym["ast"]): Array<{ name: string; type: string }> {
	const out: Array<{ name: string; type: string }> = [];
	if (ast.varSections === undefined) return out;
	for (const section of ast.varSections) {
		if (section.sectionKind !== "VAR_INPUT") continue;
		for (const decl of section.decls) {
			const typeText = renderTypeExprText(decl.type);
			for (const id of decl.names) {
				out.push({ name: id.text, type: typeText });
			}
		}
	}
	return out;
}

function renderTypeExprText(t: unknown): string {
	if (t === null || typeof t !== "object") return "?";
	const obj = t as { kind?: string; name?: { text: string }; target?: unknown; element?: unknown; wide?: boolean };
	switch (obj.kind) {
		case "named_type":
			return obj.name?.text ?? "?";
		case "array_type":
			return `ARRAY OF ${renderTypeExprText(obj.element)}`;
		case "pointer_type":
			return `POINTER TO ${renderTypeExprText(obj.target)}`;
		case "reference_type":
			return `REFERENCE TO ${renderTypeExprText(obj.target)}`;
		case "string_type":
			return obj.wide ? "WSTRING" : "STRING";
		case "implicit_enum_type":
			return "(implicit enum)";
		default:
			return "?";
	}
}
