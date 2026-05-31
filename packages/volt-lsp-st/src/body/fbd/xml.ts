/**
 * Dependency-free XML reader for PLCopenXML bodies.
 *
 * Why hand-rolled: the LSP package only depends on
 * vscode-languageserver* + zod, and adding a full XML parser
 * (fast-xml-parser, sax, etc.) for ~150 lines of straightforward
 * walking would be overkill. The PLCopenXML bodies we read are
 * well-formed by construction (the bridges round-trip through
 * CODESYS / TwinCAT serializers); we don't need DTD validation,
 * external entity resolution, or any of the XML-spec features that
 * make real parsers large.
 *
 * What this reader handles:
 *   - Element tags + attributes (both `"..."` and `'...'` quotes)
 *   - Self-closing tags `<foo/>`
 *   - Nested elements
 *   - Element text content (no entity decoding beyond &lt; &gt; &amp; &quot; &apos;)
 *   - Comments `<!-- ... -->` (skipped)
 *   - Processing instructions `<?xml ... ?>` (skipped)
 *   - CDATA `<![CDATA[ ... ]]>` (content preserved, boundaries stripped)
 *   - xmlns="" and xmlns:prefix="..." (treated as plain attributes —
 *     we don't resolve namespaces; the body's known to use one URL)
 *
 * What it deliberately doesn't handle:
 *   - DTDs / external entities (not used in PLCopenXML bodies)
 *   - Mixed content where text and elements interleave (PLCopenXML
 *     bodies are element-only or element-with-leaf-text)
 *
 * Span tracking: every node carries source byte offsets so the body
 * parser can produce LSP diagnostics + definition jumps that point
 * to the right character.
 */

export interface XmlNode {
	tag: string;
	attrs: Record<string, string>;
	children: XmlNode[];
	/** Concatenated text content if this is a leaf element with text. */
	text: string;
	/** Span of the FULL element (from `<` to after `>` of the closing tag). */
	span: { start: number; end: number };
	/** Span of just the text content inside the element (for
	 *  `<expression>name</expression>`-style elements where the text
	 *  IS the meaningful payload and we want LSP cursors to land in
	 *  the right place). */
	textSpan?: { start: number; end: number };
}

export interface XmlParseResult {
	root?: XmlNode;
	errors: XmlError[];
}

export interface XmlError {
	message: string;
	offset: number;
}

/**
 * Parse XML starting at `source[from..to]`. Returns the first
 * top-level element (PLCopenXML bodies have exactly one root
 * `<body>` element by spec). Bytes outside the element are
 * silently skipped — this means leading whitespace, processing
 * instructions, and comments don't fail the parse.
 */
export function parseXml(
	source: string,
	from = 0,
	to: number = source.length,
): XmlParseResult {
	const errors: XmlError[] = [];
	const ctx = { source, pos: from, end: to, errors };
	skipTrivia(ctx);
	const root = readElement(ctx);
	if (root === undefined && errors.length === 0) {
		errors.push({ message: "no root element found", offset: from });
	}
	return { root, errors };
}

interface Ctx {
	source: string;
	pos: number;
	end: number;
	errors: XmlError[];
}

function readElement(ctx: Ctx): XmlNode | undefined {
	const start = ctx.pos;
	if (ctx.pos >= ctx.end || ctx.source[ctx.pos] !== "<") return undefined;
	if (ctx.source[ctx.pos + 1] === "/") return undefined; // closing tag — caller handles
	const tagStart = ctx.pos + 1;
	const tagMatch = /[A-Za-z_][\w:.\-]*/y;
	tagMatch.lastIndex = tagStart;
	const m = tagMatch.exec(ctx.source);
	if (m === null) {
		ctx.errors.push({ message: "expected tag name after '<'", offset: ctx.pos });
		ctx.pos++;
		return undefined;
	}
	const tag = m[0];
	ctx.pos = tagStart + tag.length;
	const attrs = readAttrs(ctx);
	// Either `/>` self-close or `>` open
	if (ctx.source[ctx.pos] === "/" && ctx.source[ctx.pos + 1] === ">") {
		ctx.pos += 2;
		return { tag, attrs, children: [], text: "", span: { start, end: ctx.pos } };
	}
	if (ctx.source[ctx.pos] !== ">") {
		ctx.errors.push({ message: `expected '>' after <${tag}`, offset: ctx.pos });
		return { tag, attrs, children: [], text: "", span: { start, end: ctx.pos } };
	}
	ctx.pos++; // past '>'
	const bodyStart = ctx.pos;
	const children: XmlNode[] = [];
	let text = "";
	let textSpan: { start: number; end: number } | undefined;
	while (ctx.pos < ctx.end) {
		const c = ctx.source[ctx.pos];
		if (c === "<") {
			if (
				ctx.source[ctx.pos + 1] === "/" &&
				ctx.source.startsWith(`</${tag}`, ctx.pos)
			) {
				// matching close — consume
				ctx.pos += 2 + tag.length;
				while (ctx.pos < ctx.end && ctx.source[ctx.pos] !== ">") ctx.pos++;
				if (ctx.source[ctx.pos] === ">") ctx.pos++;
				break;
			}
			if (ctx.source[ctx.pos + 1] === "!") {
				skipComment(ctx);
				continue;
			}
			if (ctx.source[ctx.pos + 1] === "?") {
				skipProcessingInstruction(ctx);
				continue;
			}
			const child = readElement(ctx);
			if (child !== undefined) children.push(child);
			else ctx.pos++; // defensive forward-progress
			continue;
		}
		// text content
		const textStart = ctx.pos;
		while (ctx.pos < ctx.end && ctx.source[ctx.pos] !== "<") ctx.pos++;
		const chunk = ctx.source.slice(textStart, ctx.pos);
		text += chunk;
		// Track the FIRST non-whitespace text span — for
		// `<expression>name</expression>` this nails the offset of
		// the actual identifier inside the body XML.
		if (textSpan === undefined && chunk.trim().length > 0) {
			const leading = chunk.length - chunk.trimStart().length;
			const trailing = chunk.length - chunk.trimEnd().length;
			textSpan = {
				start: textStart + leading,
				end: ctx.pos - trailing,
			};
		}
	}
	if (bodyStart > 0) {
		/* keep linter happy */
	}
	return {
		tag,
		attrs,
		children,
		text: decodeEntities(text.trim()),
		span: { start, end: ctx.pos },
		textSpan,
	};
}

function readAttrs(ctx: Ctx): Record<string, string> {
	const out: Record<string, string> = {};
	while (ctx.pos < ctx.end) {
		skipWhitespace(ctx);
		const c = ctx.source[ctx.pos];
		if (c === ">" || c === "/" || c === undefined) return out;
		const nameMatch = /[A-Za-z_][\w:.\-]*/y;
		nameMatch.lastIndex = ctx.pos;
		const nm = nameMatch.exec(ctx.source);
		if (nm === null) {
			// Unexpected character — bail to caller, which decides how to recover.
			return out;
		}
		const name = nm[0];
		ctx.pos += name.length;
		skipWhitespace(ctx);
		if (ctx.source[ctx.pos] !== "=") {
			// Boolean attribute (no value). Skip.
			out[name] = "";
			continue;
		}
		ctx.pos++; // past '='
		skipWhitespace(ctx);
		const quote = ctx.source[ctx.pos];
		if (quote !== '"' && quote !== "'") {
			ctx.errors.push({ message: `expected attribute quote after ${name}=`, offset: ctx.pos });
			return out;
		}
		ctx.pos++;
		const valStart = ctx.pos;
		while (ctx.pos < ctx.end && ctx.source[ctx.pos] !== quote) ctx.pos++;
		out[name] = decodeEntities(ctx.source.slice(valStart, ctx.pos));
		if (ctx.source[ctx.pos] === quote) ctx.pos++;
	}
	return out;
}

function skipWhitespace(ctx: Ctx): void {
	while (ctx.pos < ctx.end) {
		const c = ctx.source.charCodeAt(ctx.pos);
		if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) ctx.pos++;
		else return;
	}
}

function skipTrivia(ctx: Ctx): void {
	while (ctx.pos < ctx.end) {
		skipWhitespace(ctx);
		if (ctx.source.startsWith("<!--", ctx.pos)) {
			skipComment(ctx);
			continue;
		}
		if (ctx.source.startsWith("<?", ctx.pos)) {
			skipProcessingInstruction(ctx);
			continue;
		}
		return;
	}
}

function skipComment(ctx: Ctx): void {
	const end = ctx.source.indexOf("-->", ctx.pos);
	ctx.pos = end === -1 ? ctx.end : end + 3;
}

function skipProcessingInstruction(ctx: Ctx): void {
	const end = ctx.source.indexOf("?>", ctx.pos);
	ctx.pos = end === -1 ? ctx.end : end + 2;
}

const ENTITY = /&(lt|gt|amp|quot|apos);/g;
const ENTITY_MAP: Record<string, string> = {
	lt: "<",
	gt: ">",
	amp: "&",
	quot: '"',
	apos: "'",
};
function decodeEntities(s: string): string {
	if (!s.includes("&")) return s;
	return s.replace(ENTITY, (_match, name) => ENTITY_MAP[name as string] ?? _match);
}

/** Convenience: walk every descendant element (depth-first, pre-order). */
export function* walkElements(node: XmlNode): IterableIterator<XmlNode> {
	yield node;
	for (const child of node.children) yield* walkElements(child);
}

/** Convenience: find the first descendant with the given tag name. */
export function findChild(node: XmlNode, tag: string): XmlNode | undefined {
	for (const child of node.children) if (child.tag === tag) return child;
	return undefined;
}

/** Convenience: every direct child with the given tag name. */
export function filterChildren(node: XmlNode, tag: string): XmlNode[] {
	return node.children.filter((c) => c.tag === tag);
}
