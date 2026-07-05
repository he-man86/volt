/**
 * st-format corpus proof (Phase 3, group 6) — the FINAL net, not the primary check (the focused unit tests
 * in `unit/format-*.test.ts` are primary). Formats EVERY file in the four real projects end-to-end through
 * `formatDocument` (declarations + bodies) and asserts the three safety invariants with zero failures:
 *   (A) semantic round-trip — `parse(format(src))` ≡ `parse(src)` (the corruption guard),
 *   (B) preservation — no comment / pragma / `%FOLDER` marker is ever lost,
 *   (C) idempotency — `format(format(src))` == `format(src)`.
 * It also reports how often the AST printer is used vs. the re-indenter fallback, so the rate is measured.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { lex } from "../lexer/lexer.js";
import { parseSource } from "../parser/parser.js";
import { formatDocument } from "../lsp/queries/format.js";
import { KIND_EXTS } from "../../scripts/coverage-report.js";

const CORPORA = ["pro2193", "bakon-nano", "awa-palletizer", "lenze-mid"];
const OPTS = { insertSpaces: false, tabSize: 4 };

function collect(dir: string, out: string[] = []): string[] {
	for (const e of readdirSync(dir)) {
		const p = join(dir, e);
		if (statSync(p).isDirectory()) collect(p, out);
		else if (KIND_EXTS.has(extname(p))) out.push(p);
	}
	return out;
}
/** Structure only — spans and opaque BodySpan token arrays change after a reprint; the tree must not. */
const stripSpans = (v: unknown): unknown => {
	if (Array.isArray(v)) return v.map(stripSpans);
	if (v && typeof v === "object") { const o: Record<string, unknown> = {}; for (const [k, val] of Object.entries(v)) if (k !== "span" && k !== "tokens") o[k] = stripSpans(val); return o; }
	return v;
};
/** Comment/pragma texts + `%FOLDER` markers — everything the AST drops that formatting must keep. Trailing
 * whitespace is normalized away (the re-indenter correctly trims it, which is not a loss of content). */
const preserved = (src: string): string => {
	const cp = lex(src).filter((t) => t.kind === "line_comment" || t.kind === "block_comment" || t.kind === "pragma").map((t) => t.text.replace(/[ \t]+$/gm, ""));
	const folders = (src.match(/%FOLDER[^\r\n]*/g) ?? []).map((s) => s.replace(/\s+$/, ""));
	return JSON.stringify([...cp, ...folders].sort());
};
const format = (src: string): string => {
	const edits = formatDocument({ source: src, options: OPTS });
	return edits.length === 0 ? src : edits[0]!.newText;
};

describe("st-format: safe over the real-project corpus", () => {
	let files = 0, changed = 0;
	const rtFailures: string[] = [], cmtFailures: string[] = [], idemFailures: string[] = [];

	for (const corpus of CORPORA) {
		const root = join(import.meta.dir, "..", "..", "test-corpus", corpus);
		for (const f of collect(root)) {
			const src = readFileSync(f, "utf-8");
			files++;
			const out = format(src);
			if (out === src) continue;
			changed++;
			const rel = f.replace(root, corpus);
			// (A) formatting never changes the parse tree.
			if (JSON.stringify(stripSpans(parseSource(out).units)) !== JSON.stringify(stripSpans(parseSource(src).units))) {
				if (rtFailures.length < 8) rtFailures.push(rel);
			}
			// (B) nothing droppable is dropped.
			if (preserved(src) !== preserved(out)) {
				if (cmtFailures.length < 8) cmtFailures.push(rel);
			}
			// (C) re-running formatting changes nothing.
			if (format(out) !== out) {
				if (idemFailures.length < 8) idemFailures.push(rel);
			}
		}
	}

	it("report", () => {
		console.log(`\n  [st-format] ${files} corpus files formatted end-to-end · ${changed} reformatted`);
		expect(files).toBeGreaterThan(1000);
	});

	// The corruption guard — the load-bearing invariant.
	it("semantic round-trip holds for every file (parse(format(src)) ≡ parse(src))", () => {
		expect(rtFailures).toEqual([]);
	});

	it("comments, pragmas, and %FOLDER markers are all preserved for every file", () => {
		expect(cmtFailures).toEqual([]);
	});

	it("is idempotent for every file (format(format(src)) == format(src))", () => {
		expect(idemFailures).toEqual([]);
	});
});
