/**
 * st-format corpus proof (Phase 3, group 6). Over EVERY POU body in the four real projects, the AST
 * printer must satisfy its two safety invariants — (A) semantic round-trip `parse(print(x)) ≡ parse(x)`
 * and (B) comment-multiset preservation — with ZERO failures. Also reports the fallback breakdown so the
 * rate is measured, not assumed. The unit tests (`format-print.test.ts`) are primary; this is the final net.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { lex } from "../lexer/lexer.js";
import { parseSource } from "../parser/parser.js";
import { parseStatements } from "../parser/statements.js";
import { getBody } from "../semantic/checks/_shared.js";
import { printBody, type PrintContext } from "../lsp/queries/format-print.js";
import { KIND_EXTS } from "../../scripts/coverage-report.js";
import type { BodySpan, Token } from "../parser/ast.js";

const CTX: PrintContext = { unit: "\t", eol: "\n" };
const CORPORA = ["pro2193", "bakon-nano", "awa-palletizer", "lenze-mid"];

function collect(dir: string, out: string[] = []): string[] {
	for (const e of readdirSync(dir)) {
		const p = join(dir, e);
		if (statSync(p).isDirectory()) collect(p, out);
		else if (KIND_EXTS.has(extname(p))) out.push(p);
	}
	return out;
}
const stripSpans = (v: unknown): unknown => {
	if (Array.isArray(v)) return v.map(stripSpans);
	if (v && typeof v === "object") { const o: Record<string, unknown> = {}; for (const [k, val] of Object.entries(v)) if (k !== "span") o[k] = stripSpans(val); return o; }
	return v;
};
const asBody = (src: string): BodySpan => ({ kind: "body", tokens: lex(src), span: { start: 0, end: src.length, startLine: 1, startCol: 0, endLine: 1, endCol: 0 } });
/** Everything the formatter must PRESERVE that the AST drops: comment/pragma texts + `%FOLDER` marker lines. */
const preservedSet = (toks: readonly Token[], src: string): string => {
	const cp = toks.filter((t) => t.kind === "line_comment" || t.kind === "block_comment" || t.kind === "pragma").map((t) => t.text);
	const folders = (src.match(/%FOLDER[^\r\n]*/g) ?? []).map((s) => s.replace(/\s+$/, ""));
	return JSON.stringify([...cp, ...folders].sort());
};

describe("st-format: safe over the real-project corpus", () => {
	let bodies = 0, astPrinted = 0, emptyBody = 0, parseFail = 0;
	const rtFailures: string[] = [], cmtFailures: string[] = [], idemFailures: string[] = [];

	for (const corpus of CORPORA) {
		const root = join(import.meta.dir, "..", "..", "test-corpus", corpus);
		for (const f of collect(root)) {
			const src = readFileSync(f, "utf-8");
			for (const u of parseSource(src).units) {
				const b = getBody(u);
				if (b === undefined) continue;
				bodies++;
				const st = parseStatements(b);
				if (!st.ok) { parseFail++; continue; } // the ONLY fallback path
				const content = b.tokens.filter((t) => t.kind !== "whitespace" && t.kind !== "eof");
				if (content.length === 0) { emptyBody++; continue; } // truly empty — nothing to print
				astPrinted++;
				const bodySrc = src.slice(b.span.start, b.span.end);
				const printed = printBody(st.statements, b.tokens, CTX, 0, src);
				const reparsed = parseStatements(asBody(printed));
				if (JSON.stringify(stripSpans(reparsed.statements)) !== JSON.stringify(stripSpans(st.statements))) {
					if (rtFailures.length < 8) rtFailures.push(f.replace(root, corpus));
				}
				if (preservedSet(b.tokens, bodySrc) !== preservedSet(lex(printed), printed)) {
					if (cmtFailures.length < 8) cmtFailures.push(`${f.replace(root, corpus)}`);
				}
				// (C) idempotent — re-printing the reparsed output is byte-identical.
				if (reparsed.ok && printBody(reparsed.statements, lex(printed), CTX, 0, printed) !== printed) {
					if (idemFailures.length < 8) idemFailures.push(f.replace(root, corpus));
				}
			}
		}
	}

	it("report", () => {
		console.log(
			`\n  [st-format] ${bodies} POU bodies across 4 corpora` +
			`\n  AST-printed ${astPrinted}  ·  empty (nothing to print) ${emptyBody}  ·  parse-fail fallback ${parseFail}` +
			`\n  fallback rate ${((parseFail / bodies) * 100).toFixed(2)}% — only genuine parse failures (0 on real code)`,
		);
		expect(astPrinted).toBeGreaterThan(1000);
	});

	// (A) The load-bearing correctness invariant — no formatted body ever changes the parse tree.
	it("semantic round-trip holds for every AST-printed body (parse(print(x)) ≡ parse(x))", () => {
		expect(rtFailures).toEqual([]);
	});

	// (B) Nothing the AST drops is ever lost — comments, pragmas, AND `%FOLDER` markers all survive.
	it("comments + pragmas + %FOLDER markers are all preserved for every AST-printed body", () => {
		expect(cmtFailures).toEqual([]);
	});

	// (C) Formatting is stable — re-running it changes nothing.
	it("is idempotent for every AST-printed body", () => {
		expect(idemFailures).toEqual([]);
	});

	// The treewalker is 100% on real code, so a body should never fall back — a non-zero count means a
	// parser regression, not a formatter one. This is the "0 fallback" invariant.
	it("ZERO fallbacks on real code (only a genuine parse failure would fall back)", () => {
		expect(parseFail).toBe(0);
	});
});
