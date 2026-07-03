/**
 * VG network-local navigation — definition / references / rename for the
 * VG-only names that don't exist in the POU declaration scope: `LET`
 * wires (and EN echoes) and jump labels (vg-language.md §8, §11).
 *
 * These names are scoped to a single network and never escape to the IDE,
 * so navigation is confined to the enclosing `NETWORK … END_NETWORK`
 * block. Real variables / FB instances are NOT handled here — they flow
 * through the normal scope-based navigation.
 */
import type { Span } from "../../../lexer/span.js";
import type { Token } from "../../../lexer/tokens.js";
import type { VgBody, VgNetwork, VgStatement } from "../../../vg/index.js";

export interface VgLocalName {
	name: string;
	kind: "wire" | "label";
	/** Span of the defining occurrence (the `LET` name or the `label:`). */
	declSpan?: Span;
	/** Span of the identifier token actually under the cursor. */
	atSpan: Span;
	/** Every identifier-token occurrence of the name within its network. */
	occurrences: Span[];
}

/**
 * If the cursor is on a network-local wire or label, return its
 * occurrences within the enclosing network; otherwise undefined (the
 * caller falls back to scope-based navigation for real variables).
 */
export function vgLocalNameAtOffset(vg: VgBody, tokens: Token[], offset: number): VgLocalName | undefined {
	const tok = identifierAt(tokens, offset);
	if (tok === undefined) return undefined;

	const network = vg.networks.find((n) => offset >= n.span.start && offset <= n.span.end);
	if (network === undefined) return undefined;

	const wires = new Map<string, Span>();
	const labels = new Map<string, Span>();
	collectLocalDecls(network, wires, labels);

	let kind: "wire" | "label" | undefined;
	if (wires.has(tok.text)) kind = "wire";
	else if (labels.has(tok.text)) kind = "label";
	if (kind === undefined) return undefined;

	const declSpan = kind === "wire" ? wires.get(tok.text) : labels.get(tok.text);
	const occurrences: Span[] = [];
	for (const t of tokens) {
		if (t.kind !== "identifier") continue;
		if (t.text !== tok.text) continue;
		if (t.span.start < network.span.start || t.span.end > network.span.end) continue;
		occurrences.push(t.span);
	}

	return { name: tok.text, kind, declSpan, atSpan: tok.span, occurrences };
}

function collectLocalDecls(network: VgNetwork, wires: Map<string, Span>, labels: Map<string, Span>): void {
	const visit = (stmt: VgStatement): void => {
		switch (stmt.kind) {
			case "wire_def":
				if (!wires.has(stmt.name.text)) wires.set(stmt.name.text, stmt.name.span);
				return;
			case "label":
				if (!labels.has(stmt.name.text)) labels.set(stmt.name.text, stmt.name.span);
				return;
			case "en_eno_if":
				visit(stmt.body);
				return;
			default:
				return;
		}
	};
	for (const stmt of network.statements) visit(stmt);
}

function identifierAt(tokens: Token[], offset: number): Token | undefined {
	for (const t of tokens) {
		if (t.kind === "identifier" && offset >= t.span.start && offset < t.span.end) return t;
	}
	return undefined;
}
