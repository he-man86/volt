/**
 * VG hover — markdown tooltips for the VG-specific tokens an ST hover
 * can't explain: operators, keywords, modifier words, and internal
 * (`LET`) wires (vg-language.md §11). Real variables / FB instances fall
 * through to the normal symbol hover (returns null here).
 *
 * Wire type inference is added in a later phase; for now a wire hovers as
 * a network-local single-assignment binding.
 */
import type { Token } from "../../../lexer/tokens.js";
import { rangeFromSpan } from "../../position.js";
import type { Range } from "../../types.js";
import { operatorBySymbol, isPunctOperator, isWordOperator } from "../../../vg/operators.js";
import type { VgBody } from "../../../vg/index.js";
import { inferWireType, type VgTypeEnv } from "../../../vg/type-infer.js";
import { collectVgWireNames } from "./semantic-tokens.js";

interface VgHoverResult {
	contents: { kind: "markdown"; value: string };
	range?: Range;
}

const VG_KEYWORD_DOC: Record<string, string> = {
	NETWORK: "Start of a graphical network (FBD/LD). `NETWORK <index> <FBD|LD>`.",
	END_NETWORK: "End of a graphical network.",
	LET: "Defines an internal **wire** — a named producer (a fan-out block result, an EN echo, or an opaque leaf). Network-local; stripped on push.",
	IF: "EN/ENO enable, or a conditional jump/return.",
	THEN: "Introduces the gated statement of an EN/ENO `IF`.",
	END_IF: "Ends an EN/ENO `IF` block.",
	JMP: "Jump to a label in this body.",
	RETURN: "Early return from the POU.",
	FBD: "Function Block Diagram — this network's graphical language.",
	LD: "Ladder Diagram — this network's graphical language.",
	DISABLED: "This network is disabled (not executed).",
};

const MODIFIER_DOC: Record<string, string> = {
	NOT: "Negation — inverts the operand it rides on.",
	RISING: "Rising-edge detection on the operand.",
	FALLING: "Falling-edge detection on the operand.",
	SET: "Set (latching) coil storage.",
	RESET: "Reset coil storage.",
};

export function vgHover(vg: VgBody, tokens: Token[], offset: number, env?: VgTypeEnv): VgHoverResult | null {
	const t = tokenAt(tokens, offset);
	if (t === undefined) return null;
	const upper = t.text.toUpperCase();

	// Operators (word or punctuation).
	if ((t.kind === "keyword" && isWordOperator(t.text)) || (t.kind === "punct" && isPunctOperator(t.text))) {
		const entry = operatorBySymbol(t.text);
		if (entry !== undefined) {
			const result = entry.class === "arithmetic" ? "the operands' common type" : "`BOOL`";
			return md(`**${entry.symbol}** — ${entry.class} operator (box \`${entry.type}\`)\n\nResult: ${result}.`, t);
		}
	}

	// Modifier words.
	if (MODIFIER_DOC[upper] !== undefined && (t.kind === "identifier" || t.kind === "keyword")) {
		return md(`**${upper}** — ${MODIFIER_DOC[upper]}`, t);
	}

	// VG keywords (word boundary — NETWORK/LET/… as identifiers, IF/THEN/… as keywords).
	if (VG_KEYWORD_DOC[upper] !== undefined && (t.kind === "identifier" || t.kind === "keyword")) {
		return md(`**${upper}** — ${VG_KEYWORD_DOC[upper]}`, t);
	}

	// Internal wires — show the inferred type (§8) when available.
	if (t.kind === "identifier" && collectVgWireNames(vg).has(t.text.toLowerCase())) {
		const inferred = env !== undefined ? inferredWireType(vg, t.text, offset, env) : undefined;
		const typeSuffix = inferred !== undefined ? ` : ${inferred}` : "";
		return md(`\`${t.text}\`${typeSuffix} — internal **wire** (network-local, single-assignment).`, t);
	}

	return null;
}

function inferredWireType(vg: VgBody, name: string, offset: number, env: VgTypeEnv): string | undefined {
	const network = vg.networks.find((n) => offset >= n.span.start && offset <= n.span.end);
	if (network === undefined) return undefined;
	return inferWireType(network, name, env);
}

function md(value: string, t: Token): VgHoverResult {
	return { contents: { kind: "markdown", value }, range: rangeFromSpan(t.span) };
}

function tokenAt(tokens: Token[], offset: number): Token | undefined {
	for (const t of tokens) {
		if (offset >= t.span.start && offset < t.span.end) return t;
	}
	return undefined;
}
