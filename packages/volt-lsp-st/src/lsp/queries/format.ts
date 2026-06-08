/**
 * `textDocument/formatting` — whole-document re-indentation.
 *
 * Design: a token-driven **re-indenter**, not an expression reflow. We
 * only ever change a line's *leading* indentation (and strip trailing
 * whitespace + normalize the final newline). Internal token spacing,
 * operator spacing, and keyword casing are left exactly as written.
 *
 * Why so conservative: bodies are opaque (we don't parse statement
 * trees — see memory `graphical-read-only` / the opaque-BodySpan
 * design), and the IDE compiler stays authoritative for statement
 * semantics. Re-spacing expressions risks corrupting code for no real
 * gain; fixing indentation is the high-value, zero-risk 80%.
 *
 * Guarantees:
 *   - **Idempotent**: `format(format(x)) === format(x)`.
 *   - **Round-trip-clean**: the non-trivia token stream is byte-identical
 *     before and after (we only move whitespace, which is trivia).
 *   - **String/comment safe**: interior lines of a multi-line token
 *     (string literal, block comment) are emitted verbatim — never
 *     re-indented — so their content can't be altered.
 *
 * Indent level is driven purely by block keywords from the lexer (so
 * keywords inside strings/comments never miscount). Statement-level
 * constructs (IF/FOR/WHILE/CASE/REPEAT) indent uniformly with
 * declaration blocks (POU shells, VAR sections, TYPE/STRUCT, PROPERTY
 * accessors).
 */
import type { DocumentFormattingParams, TextEdit } from "vscode-languageserver-protocol";
import { lex } from "../../lexer/lexer.js";
import { isTrivia, type Keyword, type Token } from "../../lexer/tokens.js";

/** Block openers — the line *after* these is indented one level deeper. */
const OPENERS: ReadonlySet<Keyword> = new Set<Keyword>([
	// POU shells
	"FUNCTION_BLOCK", "PROGRAM", "FUNCTION", "METHOD", "ACTION",
	"PROPERTY", "INTERFACE", "NAMESPACE",
	// Type declarations
	"TYPE", "STRUCT", "UNION",
	// VAR sections
	"VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP", "VAR_STAT",
	"VAR_INST", "VAR_EXTERNAL", "VAR_GLOBAL", "VAR_CONFIG", "VAR_ACCESS",
	"VAR_GENERIC",
	// Property accessors
	"GET", "SET",
	// Control flow
	"IF", "FOR", "WHILE", "CASE", "REPEAT",
]);

/** Block closers — the closing line itself dedents, as do lines after. */
const CLOSERS: ReadonlySet<Keyword> = new Set<Keyword>([
	"END_FUNCTION_BLOCK", "END_PROGRAM", "END_FUNCTION", "END_METHOD",
	"END_ACTION", "END_PROPERTY", "END_INTERFACE", "END_NAMESPACE",
	"END_TYPE", "END_STRUCT", "END_UNION", "END_VAR",
	"END_GET", "END_SET",
	"END_IF", "END_CASE", "END_FOR", "END_WHILE", "END_REPEAT",
]);

/**
 * Mid-block keywords — the line dedents to the enclosing block's level
 * but does NOT change the running level (the body that follows stays at
 * the same depth). `UNTIL` is the REPEAT footer; `ELSE`/`ELSIF` split
 * IF and CASE.
 */
const MIDBLOCK: ReadonlySet<Keyword> = new Set<Keyword>(["ELSE", "ELSIF", "UNTIL"]);

export interface IndentOptions {
	/** Spaces per indent level (used only when `insertSpaces`). */
	tabSize: number;
	/** Indent with spaces (true) or a single tab per level (false). */
	insertSpaces: boolean;
}

/**
 * Re-indent ST source. Pure string→string; the LSP wrapper below turns
 * the result into a single full-document TextEdit.
 */
export function reindentSt(source: string, opts: IndentOptions): string {
	const eol = source.includes("\r\n") ? "\r\n" : "\n";
	const unit = opts.insertSpaces ? " ".repeat(Math.max(1, opts.tabSize)) : "\t";
	const lines = source.split(/\r?\n/);
	const tokens = lex(source);

	// Per-line analysis derived from the token stream (1-based line nos):
	//  - protectedLines: interior lines of any multi-line token (string /
	//    block comment) — emitted verbatim so content is never altered.
	//  - firstMeaningful: first non-trivia token starting on the line,
	//    used to decide whether the line itself dedents.
	//  - delta: net block-level change contributed by keywords on the line.
	const protectedLines = new Set<number>();
	const firstMeaningful = new Map<number, Token>();
	const lineDelta = new Map<number, number>();

	for (const t of tokens) {
		// Protect interior lines of a multi-line *content* token (string
		// literal, block comment, pragma). Whitespace tokens also span a
		// newline (`"\n"` is line N→N+1) but carry no content — excluding
		// them is essential, else every line after a newline looks
		// "protected" and nothing gets re-indented.
		if (t.kind !== "whitespace" && t.span.endLine > t.span.startLine) {
			for (let l = t.span.startLine + 1; l <= t.span.endLine; l++) {
				protectedLines.add(l);
			}
		}
		if (isTrivia(t.kind) || t.kind === "eof") continue;
		const ln = t.span.startLine;
		if (!firstMeaningful.has(ln)) firstMeaningful.set(ln, t);
		if (t.kind === "keyword" && t.keyword !== undefined) {
			const d = OPENERS.has(t.keyword) ? 1 : CLOSERS.has(t.keyword) ? -1 : 0;
			if (d !== 0) lineDelta.set(ln, (lineDelta.get(ln) ?? 0) + d);
		}
	}

	let level = 0;
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const lineNo = i + 1;
		const raw = lines[i] ?? "";

		// Interior of a multi-line string/comment: never touch it.
		if (protectedLines.has(lineNo)) {
			out.push(raw);
			continue;
		}

		const trimmed = raw.trim();
		if (trimmed === "") {
			out.push("");
			continue;
		}

		const first = firstMeaningful.get(lineNo);
		const dedentSelf =
			first?.kind === "keyword" &&
			first.keyword !== undefined &&
			(CLOSERS.has(first.keyword) || MIDBLOCK.has(first.keyword));

		const thisLevel = Math.max(0, level - (dedentSelf ? 1 : 0));
		out.push(unit.repeat(thisLevel) + trimmed);

		level = Math.max(0, level + (lineDelta.get(lineNo) ?? 0));
	}

	// Exactly one trailing newline; no trailing blank lines.
	return out.join(eol).replace(/(?:\r?\n)*$/, "") + eol;
}

export interface FormatArgs {
	source: string;
	options: IndentOptions;
}

/**
 * LSP entry point. Returns a single whole-document replace edit, or an
 * empty array when the source is already formatted (so the client shows
 * "no changes" rather than a no-op edit).
 */
export function formatDocument(args: FormatArgs): TextEdit[] {
	const formatted = reindentSt(args.source, args.options);
	if (formatted === args.source) return [];
	return [{ range: fullDocumentRange(args.source), newText: formatted }];
}

/** Build `IndentOptions` from the LSP-supplied `FormattingOptions`. */
export function indentOptionsFrom(params: DocumentFormattingParams): IndentOptions {
	return {
		tabSize: params.options.tabSize,
		insertSpaces: params.options.insertSpaces,
	};
}

/** Full-document range, from {0,0} to the end of the last line. */
function fullDocumentRange(source: string): TextEdit["range"] {
	const lines = source.split(/\r?\n/);
	const lastLine = lines.length - 1;
	return {
		start: { line: 0, character: 0 },
		end: { line: lastLine, character: (lines[lastLine] ?? "").length },
	};
}
