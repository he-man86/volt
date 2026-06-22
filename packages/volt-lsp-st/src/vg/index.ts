/**
 * Public surface of the VG (Volt Graphical) sublanguage support.
 *
 * VG is the textual form of an FBD/LD graphical body (spec:
 * `packages/volt-bridge/docs/vg-language.md`). A POU body is VG when its
 * first significant token is `NETWORK`; otherwise it is ordinary ST.
 */
export * from "./ast.js";
export * from "./operators.js";
export { parseVgBody, parseVgText } from "./parser.js";
export { writeVgBody } from "./writer.js";

import type { Token } from "../lexer/tokens.js";

/**
 * True when a body's token slice is a VG body — i.e. its first
 * significant token is `NETWORK` (§4 EBNF: a VG body is `{ network }`).
 * This is the single discriminator the workspace uses to route a body to
 * VG handling instead of ST handling.
 */
export function isVgBody(tokens: readonly Token[]): boolean {
	for (const t of tokens) {
		if (
			t.kind === "whitespace" ||
			t.kind === "block_comment" ||
			t.kind === "line_comment" ||
			t.kind === "pragma" ||
			t.kind === "eof"
		) {
			continue;
		}
		return t.text.toUpperCase() === "NETWORK";
	}
	return false;
}
