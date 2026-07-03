/**
 * VG folding ranges — each `NETWORK … END_NETWORK` block is foldable, and
 * so is each EN/ENO `IF … END_IF` (vg-language.md §11). Network/EN spans
 * carry absolute source lines (token spans are absolute), so they map
 * straight to LSP ranges.
 */
import type { FoldingRange } from "vscode-languageserver-protocol";
import type { VgBody, VgStatement } from "../../../vg/index.js";

export function vgFoldingRanges(vg: VgBody): FoldingRange[] {
	const out: FoldingRange[] = [];
	for (const network of vg.networks) {
		pushMultiline(out, network.span.startLine, network.span.endLine);
		for (const stmt of network.statements) collectStatement(stmt, out);
	}
	return out;
}

function collectStatement(stmt: VgStatement, out: FoldingRange[]): void {
	if (stmt.kind === "en_eno_if") {
		pushMultiline(out, stmt.span.startLine, stmt.span.endLine);
		collectStatement(stmt.body, out);
	}
}

function pushMultiline(out: FoldingRange[], startLine1: number, endLine1: number): void {
	if (endLine1 <= startLine1) return; // 1-based; nothing to fold on one line
	out.push({ startLine: startLine1 - 1, endLine: endLine1 - 1 });
}
