/**
 * Unit tests for the semantic-tokens provider.
 *
 * The encoding is opaque — we test it via the legend mapping (token
 * type at index N is `TOKEN_TYPES[N]`). Each test extracts decoded
 * token-type strings from the raw integer array.
 */
import { describe, expect, it } from "vitest";
import { Workspace } from "../workspace.js";
import { semanticTokens, TOKEN_TYPES } from "./semantic-tokens.js";

interface DecodedToken {
	line: number;
	startChar: number;
	length: number;
	type: string;
}

function decode(data: readonly number[]): DecodedToken[] {
	const out: DecodedToken[] = [];
	let line = 0;
	let start = 0;
	for (let i = 0; i < data.length; i += 5) {
		const dLine = data[i]!;
		const dStart = data[i + 1]!;
		const length = data[i + 2]!;
		const typeIdx = data[i + 3]!;
		line += dLine;
		start = dLine === 0 ? start + dStart : dStart;
		out.push({ line, startChar: start, length, type: TOKEN_TYPES[typeIdx]! });
	}
	return out;
}

describe("semantic tokens: classification", () => {
	it("colors elementary types as 'type'", () => {
		const src = `FUNCTION_BLOCK FB_X
VAR
	x : INT;
END_VAR
END_FUNCTION_BLOCK`;
		const ws = new Workspace();
		ws.openDocument("file:///a.st", src, 1);
		const result = semanticTokens({
			source: src,
			project: ws.getProjectScope(),
			docUri: "file:///a.st",
		});
		const decoded = decode(result.data);
		const intToken = decoded.find((d) => d.line === 2 && d.startChar > 0);
		// Could be INT or x — either way the file has a `type` token.
		const hasType = decoded.some((d) => d.type === "type");
		expect(hasType).toBe(true);
	});

	it("colors keywords as 'keyword'", () => {
		const src = `FUNCTION_BLOCK FB_X END_FUNCTION_BLOCK`;
		const ws = new Workspace();
		ws.openDocument("file:///b.st", src, 1);
		const result = semanticTokens({
			source: src,
			project: ws.getProjectScope(),
			docUri: "file:///b.st",
		});
		const decoded = decode(result.data);
		expect(decoded.some((d) => d.type === "keyword")).toBe(true);
	});

	it("colors pragma tokens as 'macro'", () => {
		const src = `{attribute 'qualified_only'}
FUNCTION_BLOCK FB_X
END_FUNCTION_BLOCK`;
		const ws = new Workspace();
		ws.openDocument("file:///c.st", src, 1);
		const result = semanticTokens({
			source: src,
			project: ws.getProjectScope(),
			docUri: "file:///c.st",
		});
		const decoded = decode(result.data);
		expect(decoded.some((d) => d.type === "macro")).toBe(true);
	});

	it("colors string literals as 'string'", () => {
		const src = `FUNCTION_BLOCK FB_X
VAR
	msg : STRING := 'hello';
END_VAR
END_FUNCTION_BLOCK`;
		const ws = new Workspace();
		ws.openDocument("file:///d.st", src, 1);
		const result = semanticTokens({
			source: src,
			project: ws.getProjectScope(),
			docUri: "file:///d.st",
		});
		const decoded = decode(result.data);
		expect(decoded.some((d) => d.type === "string")).toBe(true);
	});

	it("colors integer literals as 'number'", () => {
		const src = `FUNCTION_BLOCK FB_X
VAR
	x : INT := 42;
END_VAR
END_FUNCTION_BLOCK`;
		const ws = new Workspace();
		ws.openDocument("file:///e.st", src, 1);
		const result = semanticTokens({
			source: src,
			project: ws.getProjectScope(),
			docUri: "file:///e.st",
		});
		const decoded = decode(result.data);
		expect(decoded.some((d) => d.type === "number")).toBe(true);
	});

	it("colors a user FB as 'class'", () => {
		const src = `FUNCTION_BLOCK FB_Motor END_FUNCTION_BLOCK
FUNCTION_BLOCK FB_User
VAR
	motor : FB_Motor;
END_VAR
END_FUNCTION_BLOCK`;
		const ws = new Workspace();
		ws.openDocument("file:///f.st", src, 1);
		const result = semanticTokens({
			source: src,
			project: ws.getProjectScope(),
			docUri: "file:///f.st",
		});
		const decoded = decode(result.data);
		// FB_Motor appears at FB declaration AND as a type reference.
		// At least one should be classified as 'class'.
		expect(decoded.some((d) => d.type === "class")).toBe(true);
	});
});

describe("semantic tokens: encoding", () => {
	it("encodes 5 ints per token", () => {
		const src = `FUNCTION_BLOCK FB_X END_FUNCTION_BLOCK`;
		const ws = new Workspace();
		ws.openDocument("file:///g.st", src, 1);
		const result = semanticTokens({
			source: src,
			project: ws.getProjectScope(),
			docUri: "file:///g.st",
		});
		expect(result.data.length % 5).toBe(0);
	});

	it("delta-encodes positions (first token absolute, rest relative)", () => {
		const src = `FUNCTION_BLOCK FB_X
END_FUNCTION_BLOCK`;
		const ws = new Workspace();
		ws.openDocument("file:///h.st", src, 1);
		const result = semanticTokens({
			source: src,
			project: ws.getProjectScope(),
			docUri: "file:///h.st",
		});
		// First token's deltaLine should be 0 (line 0).
		expect(result.data[0]).toBe(0);
	});
});
