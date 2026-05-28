#!/usr/bin/env node
/**
 * `volt-lsp-st` CLI.
 *
 * Subcommands:
 *   lex <file>     Print the token stream for debugging.
 *   --stdio        Run as an LSP server over stdio (LSP 3.17).
 *   --version      Print version.
 *
 * Note: corpus installation (CODESYS reference docs + SKILL.md at
 * `.claude/skills/st-reference/`) is wired into `volt init` in the
 * volt-agent package — not exposed as a standalone subcommand here.
 * The `runInit` helper in `src/init.ts` is the library function
 * `volt init` calls.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lex } from "./lexer/lexer.js";
import { runServer } from "./lsp/server.js";

const VERSION = "0.0.0";

function main(argv: readonly string[]): number {
	const [cmd, ...rest] = argv;

	if (cmd === "--version" || cmd === "-v") {
		console.log(`volt-lsp-st ${VERSION}`);
		return 0;
	}

	if (cmd === "--help" || cmd === "-h" || cmd === undefined) {
		printUsage();
		return cmd === undefined ? 1 : 0;
	}

	if (cmd === "--stdio") {
		runServer({ input: process.stdin, output: process.stdout });
		// Server keeps running until `exit` notification arrives; we
		// return success here but the actual process exit happens
		// inside the server's exit handler.
		return -1;
	}

	if (cmd === "lex") {
		const file = rest[0];
		if (file === undefined) {
			console.error("usage: volt-lsp-st lex <file>");
			return 1;
		}
		return runLex(resolve(file));
	}

	console.error(`Unknown subcommand: ${cmd}`);
	printUsage();
	return 1;
}

function runLex(path: string): number {
	let src: string;
	try {
		src = readFileSync(path, "utf-8");
	} catch (err) {
		console.error(
			`Failed to read ${path}: ${err instanceof Error ? err.message : String(err)}`,
		);
		return 1;
	}
	const tokens = lex(src);
	for (const t of tokens) {
		if (t.kind === "eof") continue;
		const loc = `${t.span.startLine}:${t.span.startCol}-${t.span.endLine}:${t.span.endCol}`;
		const kw = t.keyword !== undefined ? ` [${t.keyword}]` : "";
		const display = JSON.stringify(t.text);
		console.log(`${loc.padEnd(16)} ${t.kind.padEnd(15)} ${display}${kw}`);
	}
	return 0;
}

function printUsage(): void {
	console.log(`volt-lsp-st ${VERSION}
TypeScript Language Server for IEC 61131-3 Structured Text.

Usage:
  volt-lsp-st lex <file>     Print token stream for a .st file
  volt-lsp-st --stdio        Run as LSP over stdio (LSP 3.17)
  volt-lsp-st --version      Print version
  volt-lsp-st --help         Show this help`);
}

const code = main(process.argv.slice(2));
// `-1` signals "long-running, don't exit" (the LSP server keeps the
// event loop alive on its own).
if (code !== -1) process.exit(code);
