/**
 * `textDocument/formatting` — whole-document re-indentation, configured
 * by `.editorconfig`.
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
 * Format rules come from `.editorconfig` — the cross-editor industry
 * standard, scoped to exactly what this formatter touches: indent
 * style/size, end-of-line, trailing whitespace, final newline. The LSP
 * `FormattingOptions` (the editor's own tab settings) are the fallback
 * for any key `.editorconfig` doesn't specify. We parse `.editorconfig`
 * with a small dependency-free reader rather than pull a WASM-backed
 * package into the bundled server.
 *
 * Guarantees:
 *   - **Idempotent**: `format(format(x)) === format(x)`.
 *   - **Round-trip-clean**: the non-trivia token stream is byte-identical
 *     before and after (we only move whitespace, which is trivia).
 *   - **String/comment safe**: interior lines of a multi-line token
 *     (string literal, block comment) are emitted verbatim — never
 *     re-indented — so their content can't be altered.
 */
import * as fs from "node:fs";
import * as path from "node:path";
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
	/** Force a specific end-of-line; when omitted, detected from the source. */
	eol?: "\n" | "\r\n";
	/** Strip trailing whitespace from each line. Default true. */
	trimTrailingWhitespace?: boolean;
	/** Ensure exactly one final newline. Default true. */
	insertFinalNewline?: boolean;
}

/**
 * Re-indent ST source. Pure string→string; the LSP wrapper below turns
 * the result into a single full-document TextEdit.
 */
export function reindentSt(source: string, opts: IndentOptions): string {
	const eol = opts.eol ?? (source.includes("\r\n") ? "\r\n" : "\n");
	const unit = opts.insertSpaces ? " ".repeat(Math.max(1, opts.tabSize)) : "\t";
	const trimTrailing = opts.trimTrailingWhitespace ?? true;
	const finalNewline = opts.insertFinalNewline ?? true;
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

		if (raw.trim() === "") {
			out.push("");
			continue;
		}

		const first = firstMeaningful.get(lineNo);
		const dedentSelf =
			first?.kind === "keyword" &&
			first.keyword !== undefined &&
			(CLOSERS.has(first.keyword) || MIDBLOCK.has(first.keyword));

		const thisLevel = Math.max(0, level - (dedentSelf ? 1 : 0));
		const noLead = raw.replace(/^[ \t]+/, "");
		const content = trimTrailing ? noLead.replace(/[ \t]+$/, "") : noLead;
		out.push(unit.repeat(thisLevel) + content);

		level = Math.max(0, level + (lineDelta.get(lineNo) ?? 0));
	}

	const joined = out.join(eol).replace(/(?:\r?\n)*$/, "");
	return finalNewline ? joined + eol : joined;
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

/**
 * Resolve indent options for a document: `.editorconfig` wins for the
 * keys it specifies; the editor's `FormattingOptions` fill the rest.
 * `filePath` is undefined for untitled/in-memory docs — those just use
 * the editor settings.
 */
export function resolveFormatOptions(
	filePath: string | undefined,
	lsp: { tabSize: number; insertSpaces: boolean },
): IndentOptions {
	if (filePath === undefined) {
		return { tabSize: lsp.tabSize, insertSpaces: lsp.insertSpaces };
	}
	let props: EditorConfigProps = {};
	try {
		props = readEditorConfig(filePath);
	} catch {
		props = {};
	}
	return mapEditorConfigProps(props, lsp);
}

/** Pull the editor's tab settings out of the LSP request. */
export function indentOptionsFrom(params: DocumentFormattingParams): {
	tabSize: number;
	insertSpaces: boolean;
} {
	return { tabSize: params.options.tabSize, insertSpaces: params.options.insertSpaces };
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

// ─────────────────────────────────────────────────────────────────────
// .editorconfig support (dependency-free; honors the standard's common
// subset: `[*]` / `[*.ext]` / `[*.{a,b}]` sections, `root=true`, and
// directory inheritance).
// ─────────────────────────────────────────────────────────────────────

/** Raw property bag from a resolved `.editorconfig` (values are strings). */
export type EditorConfigProps = Partial<Record<
	"indent_style" | "indent_size" | "tab_width" | "end_of_line" |
	"trim_trailing_whitespace" | "insert_final_newline",
	string
>>;

/**
 * Map resolved `.editorconfig` properties onto `IndentOptions`, falling
 * back to the editor's settings for anything unspecified. Pure — no I/O,
 * so it's directly unit-testable.
 */
export function mapEditorConfigProps(
	props: EditorConfigProps,
	lsp: { tabSize: number; insertSpaces: boolean },
): IndentOptions {
	const opts: IndentOptions = { tabSize: lsp.tabSize, insertSpaces: lsp.insertSpaces };

	const style = props.indent_style?.toLowerCase();
	if (style === "tab") opts.insertSpaces = false;
	else if (style === "space") opts.insertSpaces = true;

	const toNum = (s: string | undefined): number | undefined =>
		s !== undefined && /^\d+$/.test(s) ? Number(s) : undefined;
	// `indent_size = tab` means "follow tab_width".
	const size =
		props.indent_size?.toLowerCase() === "tab"
			? toNum(props.tab_width)
			: toNum(props.indent_size) ?? toNum(props.tab_width);
	if (size !== undefined && size > 0) opts.tabSize = size;

	const eol = props.end_of_line?.toLowerCase();
	if (eol === "lf") opts.eol = "\n";
	else if (eol === "crlf") opts.eol = "\r\n";

	if (props.trim_trailing_whitespace?.toLowerCase() === "false") {
		opts.trimTrailingWhitespace = false;
	}
	if (props.insert_final_newline?.toLowerCase() === "false") {
		opts.insertFinalNewline = false;
	}
	return opts;
}

interface EditorConfigSection {
	glob: string;
	props: EditorConfigProps;
}

/**
 * Resolve `.editorconfig` for `filePath`: walk up the directory tree,
 * collecting matching sections, stopping once a file declares
 * `root = true`. Nearer files and later sections win.
 */
export function readEditorConfig(filePath: string): EditorConfigProps {
	const abs = path.resolve(filePath);
	const fileName = path.basename(abs);

	const found: Array<{ dir: string; sections: EditorConfigSection[] }> = [];
	let dir = path.dirname(abs);
	for (;;) {
		const ecPath = path.join(dir, ".editorconfig");
		try {
			const text = fs.readFileSync(ecPath, "utf8");
			const { root, sections } = parseEditorConfigFile(text);
			found.push({ dir, sections });
			if (root) break; // top of the config tree
		} catch {
			// no .editorconfig in this directory — keep ascending
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	// Apply farthest → nearest so nearer files override; within a file,
	// sections apply in order so later sections override earlier ones.
	const props: EditorConfigProps = {};
	for (let i = found.length - 1; i >= 0; i--) {
		const entry = found[i]!;
		const rel = path.relative(entry.dir, abs).replace(/\\/g, "/");
		for (const section of entry.sections) {
			if (sectionMatches(section.glob, fileName, rel)) {
				Object.assign(props, section.props);
			}
		}
	}
	return props;
}

const EC_KEYS = new Set([
	"indent_style", "indent_size", "tab_width", "end_of_line",
	"trim_trailing_whitespace", "insert_final_newline",
]);

function parseEditorConfigFile(text: string): {
	root: boolean;
	sections: EditorConfigSection[];
} {
	let root = false;
	const sections: EditorConfigSection[] = [];
	let current: EditorConfigSection | undefined;

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;

		const header = line.match(/^\[(.*)\]$/);
		if (header) {
			current = { glob: header[1]!, props: {} };
			sections.push(current);
			continue;
		}

		const eq = line.indexOf("=");
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim().toLowerCase();
		const value = line.slice(eq + 1).trim();

		if (current === undefined) {
			if (key === "root") root = value.toLowerCase() === "true";
		} else if (EC_KEYS.has(key)) {
			(current.props as Record<string, string>)[key] = value;
		}
	}
	return { root, sections };
}

/**
 * Match a section glob against a file. Per the spec, a glob with no `/`
 * matches the file *name* in any subdirectory; one with `/` matches the
 * path relative to the `.editorconfig` directory.
 */
function sectionMatches(glob: string, fileName: string, relPath: string): boolean {
	const hasSlash = glob.includes("/");
	const target = hasSlash ? relPath : fileName;
	return globToRegExp(glob).test(target);
}

function globToRegExp(glob: string): RegExp {
	let re = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i]!;
		if (c === "*") {
			if (glob[i + 1] === "*") {
				re += ".*";
				i++;
			} else {
				re += "[^/]*";
			}
		} else if (c === "?") {
			re += "[^/]";
		} else if (c === "{") {
			const close = glob.indexOf("}", i);
			if (close !== -1) {
				const alts = glob
					.slice(i + 1, close)
					.split(",")
					.map(escapeRegExp)
					.join("|");
				re += `(${alts})`;
				i = close;
			} else {
				re += "\\{";
			}
		} else if ("\\^$.|+()[]".includes(c)) {
			re += `\\${c}`;
		} else {
			re += c;
		}
	}
	return new RegExp(`^${re}$`);
}

function escapeRegExp(s: string): string {
	return s.replace(/[\\^$.|+()[\]{}*?]/g, "\\$&");
}
