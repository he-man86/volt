/**
 * Graphical-POU disk format helpers (FBD / LD / SFC / CFC).
 *
 * CODESYS exports a graphical POU as PLCopenXML, but the variable
 * declarations are ALSO available as plain ST text via the bridge's
 * `sourceText` field. We persist BOTH in a single `.fbd` / `.ld` /
 * `.sfc` / `.cfc` file:
 *
 *   PROGRAM POU_X
 *   VAR
 *       a : BOOL;
 *       b : BOOL;
 *   END_VAR
 *
 *   <body xmlns="http://www.plcopen.org/xml/tc6_0200">
 *     <FBD>...graphical content...</FBD>
 *   </body>
 *
 *   END_PROGRAM
 *
 * Rationale: declarations stay grep / diff / LLM-friendly (plain ST);
 * the graphical body is preserved verbatim as PLCopenXML so a future
 * `push` can reconstruct the full `<pou>` document for `import_xml`.
 *
 * **Reconstructible to full PLCopenXML.** The agent's parser splits
 * the file at `<body`; everything before is the textual declaration,
 * the `<body>...</body>` element is the graphical body, anything
 * after (`END_PROGRAM` etc.) is a syntactic bookend ignored on push.
 */

/**
 * Build the on-disk content for a graphical POU.
 *
 * Splices `bodyXml` into `declarationText` between the LAST `END_VAR`
 * and the closing `END_PROGRAM` / `END_FUNCTION_BLOCK` /
 * `END_FUNCTION` line. The bridge's `sourceText` for a graphical POU
 * looks like:
 *
 *   PROGRAM Foo
 *   VAR
 *       ...
 *   END_VAR
 *
 *   END_PROGRAM
 *
 * (Empty body between END_VAR and END_PROGRAM — graphical POUs have
 * no textual implementation.) We replace that empty gap with the XML.
 *
 * Falls back to appending the body before any trailing newline when
 * the END_VAR / END_X anchors aren't found — defensive, shouldn't
 * normally fire.
 */
export function embedGraphicalBody(declarationText: string, bodyXml: string): string {
	const decl = declarationText.replace(/\r\n/g, "\n");
	// Normalize body line endings to LF too — the workspace writes LF
	// everywhere (.gitattributes enforces it), and the bridge's body
	// XML can arrive with CRLF (TwinCAT's case) or LF (CODESYS's case).
	// Without this, the embed → parse → embed round-trip differs byte-
	// for-byte across vendors.
	const trimmed = bodyXml.replace(/\r\n/g, "\n").trim();

	const endVarIdx = lastIndexOfWord(decl, "END_VAR");
	const endPouIdx = findEndPouLine(decl);

	if (endVarIdx === -1 || endPouIdx === -1 || endPouIdx < endVarIdx) {
		// Defensive: structure didn't match expectations. Append the
		// body before the last newline so we never silently drop it.
		const trailing = decl.endsWith("\n") ? "" : "\n";
		return `${decl}${trailing}\n${trimmed}\n`;
	}

	// Splice: keep everything through the END_VAR line, insert blank
	// line + body XML + blank line, then everything from the END_POU
	// line onward.
	const beforeEnd = decl.slice(0, endOfLine(decl, endVarIdx));
	const afterEnd = decl.slice(startOfLine(decl, endPouIdx));
	return `${beforeEnd}\n\n${trimmed}\n\n${afterEnd}`;
}

/**
 * Parse a `.fbd` / `.ld` / `.sfc` / `.cfc` file back into its two
 * logical pieces. Returns null when no `<body>` element is found —
 * caller falls back to treating the whole file as plain ST.
 *
 * Used by the (future) push path to send `declarationText` as
 * `sourceText` and `bodyXml` as `implementationXml` to the bridge.
 */
export function extractGraphicalBody(
	content: string,
): { declarationText: string; bodyXml: string } | null {
	const normalized = content.replace(/\r\n/g, "\n");
	const bodyStart = findBodyStart(normalized);
	if (bodyStart === -1) return null;
	const bodyEnd = findBodyEnd(normalized, bodyStart);
	if (bodyEnd === -1) return null;

	// Declaration: everything before <body>, stripped of trailing
	// blank lines so we can re-embed cleanly on next pull.
	const declRaw = normalized.slice(0, bodyStart);
	const declarationText = stripTrailingBlankLines(declRaw);

	// Body: the <body>...</body> element verbatim.
	const bodyXml = normalized.slice(bodyStart, bodyEnd);

	// Trailing bookend (END_PROGRAM etc.) — anything after </body>,
	// re-attached to the declaration with a blank-line separator so
	// embedGraphicalBody can find the END_X anchor on next round-trip.
	const after = normalized.slice(bodyEnd).replace(/^\s+/, "").trimEnd();
	const fullDecl = after.length > 0
		? declarationText + "\n\n" + after + "\n"
		: declarationText + "\n";

	return { declarationText: fullDecl, bodyXml };
}

// ─── Internal helpers ────────────────────────────────────────────────

const END_POU_RE = /^[ \t]*(END_PROGRAM|END_FUNCTION_BLOCK|END_FUNCTION)\b/im;
// Match `<body ...>` or `<NS:body ...>` where NS is any XML namespace
// prefix. CODESYS exports body XML with `ns0:` prefix; agents may
// strip prefixes for readability but we accept both shapes.
const BODY_OPEN_RE = /<(?:[A-Za-z_][\w.-]*:)?body\b[^>]*>/i;
const BODY_CLOSE_RE = /<\/(?:[A-Za-z_][\w.-]*:)?body\s*>/i;

function findBodyStart(text: string): number {
	const m = BODY_OPEN_RE.exec(text);
	return m ? m.index : -1;
}

function findBodyEnd(text: string, fromIdx: number): number {
	// Match the FIRST `</body>` (or `</ns:body>`) after fromIdx —
	// PLCopenXML bodies are flat, no nested <body> elements.
	const close = BODY_CLOSE_RE.exec(text.slice(fromIdx));
	if (!close) return -1;
	return fromIdx + close.index + close[0].length;
}

function findEndPouLine(text: string): number {
	const m = END_POU_RE.exec(text);
	return m ? m.index : -1;
}

function lastIndexOfWord(text: string, word: string): number {
	// Case-insensitive word-boundary last-occurrence search. We use
	// it to anchor on END_VAR (POUs may have multiple VAR/END_VAR
	// blocks; we want the final one before the body).
	const re = new RegExp(`\\b${word}\\b`, "gi");
	let last = -1;
	for (let m: RegExpExecArray | null; (m = re.exec(text)) !== null; ) {
		last = m.index;
	}
	return last;
}

function startOfLine(text: string, idx: number): number {
	const nl = text.lastIndexOf("\n", idx - 1);
	return nl === -1 ? 0 : nl + 1;
}

function endOfLine(text: string, idx: number): number {
	const nl = text.indexOf("\n", idx);
	return nl === -1 ? text.length : nl;
}

function stripTrailingBlankLines(text: string): string {
	let i = text.length;
	while (i > 0 && /\s/.test(text.charAt(i - 1))) i--;
	return text.slice(0, i);
}
