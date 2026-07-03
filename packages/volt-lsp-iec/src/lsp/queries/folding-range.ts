/**
 * `textDocument/foldingRange` — provide collapsible regions for the
 * editor's gutter triangles.
 *
 * Foldable regions:
 *   - POU bodies (FB / PROGRAM / FUNCTION / METHOD / ACTION / PROPERTY / INTERFACE)
 *   - NAMESPACE blocks
 *   - TYPE / DUT bodies (STRUCT / UNION / ENUM)
 *   - VAR sections
 *   - Region pragmas: {region '...'} ... {end_region}
 *
 * Statement-level folding (IF/CASE/FOR/WHILE/REPEAT) is intentionally
 * omitted — we don't parse statement trees, only opaque bodies. The
 * editor's indent-based folding fills that gap.
 */
import type { FoldingRange } from "vscode-languageserver-protocol";
import { FoldingRangeKind } from "vscode-languageserver-protocol";
import { lex } from "../../lexer/lexer.js";
import type { Span } from "../../lexer/span.js";
import type { ParseResult, TopLevel } from "../../parser/ast.js";
import type { VgBody } from "../../vg/index.js";
import { vgFoldingRanges } from "./vg/folding.js";

export interface FoldingRangeArgs {
	parseResult: ParseResult;
	source: string;
	/** VG (graphical) bodies in this document — each network and EN/ENO IF
	 *  block adds a fold region. */
	vgBodies?: ReadonlyArray<{ span: Span; vg: VgBody }>;
}

export function foldingRanges(args: FoldingRangeArgs): FoldingRange[] {
	const out: FoldingRange[] = [];
	for (const unit of args.parseResult.units) {
		collectUnit(unit, out);
	}
	for (const body of args.vgBodies ?? []) out.push(...vgFoldingRanges(body.vg));
	collectRegionPragmas(args.source, out);
	return out;
}

function collectUnit(unit: TopLevel, out: FoldingRange[]): void {
	pushRange(out, unit.span);
	if ("varSections" in unit) {
		for (const section of unit.varSections) {
			pushRange(out, section.span);
		}
	}
	if (unit.kind === "namespace") {
		for (const inner of unit.units) {
			collectUnit(inner, out);
		}
	}
	if (unit.kind === "type_decl") {
		// The DUT body has its own span only for struct/union/enum.
		const body = unit.body;
		if (body.kind === "struct" || body.kind === "union" || body.kind === "enum") {
			pushRange(out, unit.span); // already pushed via unit.span
		}
	}
}

/**
 * Find {region '...'} / {end_region} pairs in the source and emit a
 * FoldingRange for each matched pair. Region pragmas are stripped
 * from the parsed token stream (treated as trivia), so we re-lex.
 */
function collectRegionPragmas(source: string, out: FoldingRange[]): void {
	const tokens = lex(source);
	const stack: Span[] = [];
	for (const t of tokens) {
		if (t.kind !== "pragma") continue;
		const text = t.text.toLowerCase();
		if (/^\{\s*region\b/.test(text)) {
			stack.push(t.span);
		} else if (/^\{\s*end_region\b/.test(text)) {
			const open = stack.pop();
			if (open === undefined) continue;
			out.push({
				startLine: open.startLine - 1, // 1-based → 0-based
				endLine: t.span.endLine - 1,
				kind: FoldingRangeKind.Region,
			});
		}
	}
}

function pushRange(out: FoldingRange[], span: Span): void {
	// LSP FoldingRange uses 0-based line numbers. Lexer/parser spans
	// are 1-based. Skip single-line ranges — nothing to fold.
	if (span.endLine <= span.startLine) return;
	out.push({
		startLine: span.startLine - 1,
		endLine: span.endLine - 1,
	});
}
