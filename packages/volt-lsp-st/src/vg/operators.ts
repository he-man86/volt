/**
 * The VG / FBD-LD operator table — the single source of truth for which
 * infix symbols are operators and what graph box type each maps to.
 *
 * Mirrors the bridge's `Graphical/FbdOperators.cs` (symbol ↔ box type)
 * verbatim so the LSP and the bridge agree on exactly one operator set.
 * The extra `class` column drives §8 type inference (logic/comparison →
 * BOOL, arithmetic → the operands' common type).
 *
 * Spec: `packages/volt-bridge/docs/vg-language.md` §7.
 */

/** Every infix operator symbol VG accepts. Case-insensitive on input. */
export type VgOperatorSymbol =
	| "AND"
	| "OR"
	| "XOR"
	| "+"
	| "-"
	| "*"
	| "/"
	| "MOD"
	| ">"
	| "<"
	| ">="
	| "<="
	| "="
	| "<>";

export type VgOperatorClass = "logic" | "arithmetic" | "comparison";

interface VgOperatorEntry {
	/** Infix VG token (`AND`, `+`, `>=`). */
	symbol: VgOperatorSymbol;
	/** Underlying operator-box type in the graph / PLCopen (`AND`, `ADD`, `GE`). */
	type: string;
	class: VgOperatorClass;
}

const TABLE: readonly VgOperatorEntry[] = [
	{ symbol: "OR", type: "OR", class: "logic" },
	{ symbol: "AND", type: "AND", class: "logic" },
	{ symbol: "XOR", type: "XOR", class: "logic" },
	{ symbol: "+", type: "ADD", class: "arithmetic" },
	{ symbol: "-", type: "SUB", class: "arithmetic" },
	{ symbol: "*", type: "MUL", class: "arithmetic" },
	{ symbol: "/", type: "DIV", class: "arithmetic" },
	{ symbol: "MOD", type: "MOD", class: "arithmetic" },
	{ symbol: ">", type: "GT", class: "comparison" },
	{ symbol: "<", type: "LT", class: "comparison" },
	{ symbol: ">=", type: "GE", class: "comparison" },
	{ symbol: "<=", type: "LE", class: "comparison" },
	{ symbol: "=", type: "EQ", class: "comparison" },
	{ symbol: "<>", type: "NE", class: "comparison" },
];

/** Word-form operators (`AND`/`OR`/`XOR`/`MOD`) — matched case-insensitively. */
const WORD_OPERATORS = new Set(["AND", "OR", "XOR", "MOD"]);

/** Punctuation-form operators — matched by exact text. */
const PUNCT_OPERATORS = new Set(["+", "-", "*", "/", ">", "<", ">=", "<=", "=", "<>"]);

const BY_SYMBOL = new Map<string, VgOperatorEntry>(
	TABLE.map((e) => [e.symbol.toUpperCase(), e]),
);
const BY_TYPE = new Map<string, VgOperatorEntry>(
	TABLE.map((e) => [e.type.toUpperCase(), e]),
);

/** Resolve an infix symbol (`+`, `and`) to its canonical operator entry, or undefined. */
export function operatorBySymbol(symbol: string): VgOperatorEntry | undefined {
	return BY_SYMBOL.get(symbol.toUpperCase());
}

/** Resolve a box type (`ADD`) to its operator entry, or undefined. */
export function operatorByType(type: string): VgOperatorEntry | undefined {
	return BY_TYPE.get(type.toUpperCase());
}

/** True if `text` is an operator word (`AND`/`OR`/`XOR`/`MOD`). */
export function isWordOperator(text: string): boolean {
	return WORD_OPERATORS.has(text.toUpperCase());
}

/** True if `text` is a punctuation operator (`+`, `<=`, …). */
export function isPunctOperator(text: string): boolean {
	return PUNCT_OPERATORS.has(text);
}

/** The canonical symbol for a recognised operator token text, or undefined. */
export function canonicalOperatorSymbol(text: string): VgOperatorSymbol | undefined {
	return operatorBySymbol(text)?.symbol;
}
