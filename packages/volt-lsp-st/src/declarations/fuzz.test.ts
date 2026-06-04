/**
 * Fuzz / robustness harness for lexer + parser. Catches uncaught
 * exceptions and infinite loops on adversarial or partially-typed-in
 * input — the failure modes the all-valid-input conformance harness
 * can't surface. Targets the error-recovery branches in parser.ts /
 * dut.ts that the catalog tests deliberately never reach.
 *
 * Three input strategies per phase (lex / parse):
 *   1. Random printable ASCII bytes — baseline robustness sweep
 *   2. Random keyword + punctuation mix — more likely to engage real
 *      parse paths before falling into recovery
 *   3. Single-char mutations of valid catalog sources — finds parser
 *      recovery bugs in the neighborhood of valid inputs
 *
 * Deterministic: each phase uses a seeded Mulberry32 PRNG so a failure
 * is reproducible from the seed + iteration index. Hand-rolled (no
 * fast-check) to keep the harness inside bun:test only.
 *
 * 6 tests × 200 runs each = 1200 fuzz iterations / ~1–2 s total.
 */
import { describe, expect, test } from "bun:test";
import { lex } from "../lexer/lexer.js";
import { parseSource } from "./parser.js";
import { ALL_TESTS } from "../conformance/index.js";

// Mulberry32 — small fast seedable PRNG. Public-domain. Returns floats
// in [0, 1) like Math.random but reproducible from a seed.
function makePrng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function randomBytes(rand: () => number, maxLen = 4000): string {
	const len = Math.floor(rand() * maxLen);
	let out = "";
	for (let i = 0; i < len; i++) {
		// Mostly printable ASCII (0x20-0x7E) with occasional newlines.
		const r = rand();
		if (r < 0.05) out += "\n";
		else out += String.fromCharCode(0x20 + Math.floor(rand() * 95));
	}
	return out;
}

const ST_KEYWORDS = [
	"FUNCTION_BLOCK", "END_FUNCTION_BLOCK", "PROGRAM", "END_PROGRAM",
	"FUNCTION", "END_FUNCTION", "INTERFACE", "END_INTERFACE",
	"VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_INOUT", "VAR_GLOBAL",
	"END_VAR", "METHOD", "END_METHOD", "ACTION", "END_ACTION",
	"PROPERTY", "END_PROPERTY", "GET", "END_GET", "SET", "END_SET",
	"IF", "THEN", "ELSE", "ELSIF", "END_IF", "FOR", "TO", "BY", "DO",
	"END_FOR", "WHILE", "END_WHILE", "REPEAT", "UNTIL", "END_REPEAT",
	"CASE", "OF", "END_CASE", "RETURN", "EXIT", "CONTINUE",
	"TRUE", "FALSE", "NULL", "INT", "DINT", "BOOL", "REAL", "STRING",
	"ARRAY", "OF", "POINTER", "REFERENCE", "IMPLEMENTS", "EXTENDS",
	"TYPE", "STRUCT", "END_STRUCT", "UNION", "END_UNION", "END_TYPE",
	"NAMESPACE", "END_NAMESPACE",
];
const ST_PUNCT = [
	";", ":", ",", "(", ")", "[", "]", ".", ":=", "=", "<>",
	"+", "-", "*", "/", "^", "<", ">", "<=", ">=", "&",
];

function randomKeywordMix(rand: () => number, tokenCount = 80): string {
	const parts: string[] = [];
	for (let i = 0; i < tokenCount; i++) {
		const r = rand();
		if (r < 0.5) parts.push(ST_KEYWORDS[Math.floor(rand() * ST_KEYWORDS.length)]!);
		else if (r < 0.8) parts.push(ST_PUNCT[Math.floor(rand() * ST_PUNCT.length)]!);
		else parts.push(`id_${Math.floor(rand() * 100)}`);
		if (rand() < 0.4) parts.push(" ");
		if (rand() < 0.1) parts.push("\n");
	}
	return parts.join("");
}

function mutateSource(rand: () => number, src: string): string {
	if (src.length === 0) return src;
	const i = Math.floor(rand() * src.length);
	const op = rand();
	if (op < 0.33) {
		// Insert random printable char.
		const c = String.fromCharCode(0x20 + Math.floor(rand() * 95));
		return src.slice(0, i) + c + src.slice(i);
	}
	if (op < 0.66) {
		// Delete one char.
		return src.slice(0, i) + src.slice(i + 1);
	}
	// Replace.
	const c = String.fromCharCode(0x20 + Math.floor(rand() * 95));
	return src.slice(0, i) + c + src.slice(i + 1);
}

const SEED = 0xc0ffee;
const RUNS = 200;

describe("fuzz: lexer never throws on adversarial input", () => {
	test("random ASCII bytes", () => {
		const rand = makePrng(SEED);
		for (let i = 0; i < RUNS; i++) {
			const input = randomBytes(rand);
			expect(() => lex(input)).not.toThrow();
		}
	});

	test("random keyword + punctuation mix", () => {
		const rand = makePrng(SEED + 1);
		for (let i = 0; i < RUNS; i++) {
			const input = randomKeywordMix(rand);
			expect(() => lex(input)).not.toThrow();
		}
	});

	test("single-char mutations of catalog sources", () => {
		const rand = makePrng(SEED + 2);
		for (let i = 0; i < RUNS; i++) {
			const base = ALL_TESTS[Math.floor(rand() * ALL_TESTS.length)]!.source;
			let mutated = base;
			const n = 1 + Math.floor(rand() * 8);
			for (let j = 0; j < n; j++) mutated = mutateSource(rand, mutated);
			expect(() => lex(mutated)).not.toThrow();
		}
	});
});

describe("fuzz: parser never throws on adversarial input", () => {
	test("random ASCII bytes — returns ParseResult shape", () => {
		const rand = makePrng(SEED + 10);
		for (let i = 0; i < RUNS; i++) {
			const input = randomBytes(rand);
			const r = parseSource(input);
			expect(Array.isArray(r.units)).toBe(true);
			expect(Array.isArray(r.errors)).toBe(true);
		}
	});

	test("random keyword + punctuation mix — returns ParseResult shape", () => {
		const rand = makePrng(SEED + 11);
		for (let i = 0; i < RUNS; i++) {
			const input = randomKeywordMix(rand);
			const r = parseSource(input);
			expect(Array.isArray(r.units)).toBe(true);
			expect(Array.isArray(r.errors)).toBe(true);
		}
	});

	test("mutated catalog sources — returns ParseResult shape", () => {
		const rand = makePrng(SEED + 12);
		for (let i = 0; i < RUNS; i++) {
			const base = ALL_TESTS[Math.floor(rand() * ALL_TESTS.length)]!.source;
			let mutated = base;
			const n = 1 + Math.floor(rand() * 8);
			for (let j = 0; j < n; j++) mutated = mutateSource(rand, mutated);
			const r = parseSource(mutated);
			expect(Array.isArray(r.units)).toBe(true);
			expect(Array.isArray(r.errors)).toBe(true);
		}
	});
});
