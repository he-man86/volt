/**
 * VG semantic-token classification — colours a graphical body's tokens by
 * their VG role rather than ST role (vg-language.md §11): keywords
 * (`NETWORK`/`LET`/`IF`/…), operators, modifier words (`NOT`/`RISING`/…),
 * wires (`LET` bindings), sinks, FB instances + `.Pin` reads, pin names,
 * functions, and literals.
 *
 * Classification is lexical (token + nearest significant neighbours + the
 * set of wire names in the body) — enough to make a network instantly
 * legible without re-deriving the full AST per token.
 */
import type { Token } from "../../../lexer/tokens.js";
import type { VgBody, VgStatement } from "../../../vg/index.js";
import { isPunctOperator, isWordOperator } from "../../../vg/operators.js";
import type { TokenType } from "../semantic-tokens.js";

const VG_KEYWORD_IDENTS = new Set(["NETWORK", "END_NETWORK", "LET", "FBD", "LD", "DISABLED"]);
const VG_KEYWORDS_AS_ST = new Set(["IF", "THEN", "END_IF", "JMP", "RETURN"]);
const MODIFIER_WORDS = new Set(["NOT", "RISING", "FALLING", "SET", "RESET"]);

const LITERAL_NUMBER = new Set(["int_lit", "real_lit", "time_lit", "date_lit", "tod_lit", "datetime_lit", "typed_lit", "address_lit"]);
const LITERAL_STRING = new Set(["string_lit", "wstring_lit"]);

/** All wire / EN-echo names defined in a VG body (lowercased). */
export function collectVgWireNames(vg: VgBody): Set<string> {
	const out = new Set<string>();
	const note = (stmt: VgStatement): void => {
		if (stmt.kind === "wire_def") out.add(stmt.name.text.toLowerCase());
		else if (stmt.kind === "en_eno_if") note(stmt.body);
	};
	for (const net of vg.networks) {
		for (const stmt of net.statements) note(stmt);
	}
	return out;
}

/** Classify one VG token; undefined → leave uncoloured. */
export function vgTokenClass(
	token: Token,
	prev: Token | undefined,
	next: Token | undefined,
	wireNames: Set<string>,
): TokenType | undefined {
	const upper = token.text.toUpperCase();

	// ST-keyword tokens that arrive pre-classified by the lexer.
	if (token.kind === "keyword") {
		if (isWordOperator(token.text)) return "operator";
		if (MODIFIER_WORDS.has(upper)) return "modifier";
		if (VG_KEYWORDS_AS_ST.has(upper)) return "keyword";
		return "keyword";
	}
	if (token.kind === "line_comment" || token.kind === "block_comment") return "comment";
	if (LITERAL_NUMBER.has(token.kind)) return "number";
	if (LITERAL_STRING.has(token.kind)) return "string";
	if (token.kind === "punct") return isPunctOperator(token.text) ? "operator" : undefined;

	if (token.kind === "identifier") {
		if (VG_KEYWORD_IDENTS.has(upper)) return "keyword";
		if (MODIFIER_WORDS.has(upper)) return "modifier";
		if (prev?.kind === "punct" && prev.text === ".") return "property"; // `.Pin` read
		if (isPinName(prev, next)) return "parameter"; // `PIN := value`
		if (next?.kind === "punct" && next.text === "(") return "function";
		if (wireNames.has(token.text.toLowerCase())) return "variable"; // internal wire
		return "variable";
	}
	return undefined;
}

function isPinName(prev: Token | undefined, next: Token | undefined): boolean {
	if (next?.kind !== "punct" || next.text !== ":=") return false;
	return prev?.kind === "punct" && (prev.text === "(" || prev.text === ",");
}
