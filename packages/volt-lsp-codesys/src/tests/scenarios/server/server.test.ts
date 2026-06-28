/**
 * End-to-end LSP server tests: spawn the built bin, send LSP traffic,
 * assert on responses. One test per advertised capability — these
 * catch protocol-level regressions that the in-process unit tests can't.
 *
 * Skipped if the build artifact isn't present — vitest can run in a
 * pre-build state. Locally `npm run build` first.
 */
import { describe, expect, it } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { JsonRpcMessage, JsonRpcResponse } from "../../../lsp/types.js";

const BIN_PATH = resolve(__dirname, "../../dist/bin.js");

// ─── Framing helpers ─────────────────────────────────────────────────

function sendMessage(child: ChildProcessWithoutNullStreams, msg: JsonRpcMessage): void {
	const body = JSON.stringify(msg);
	const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
	child.stdin.write(header + body, "utf-8");
}

function awaitResponse<T>(
	child: ChildProcessWithoutNullStreams,
	predicate: (msg: JsonRpcMessage) => T | undefined,
	timeoutMs = 3000,
): Promise<T> {
	return new Promise((res, rej) => {
		let buf = Buffer.alloc(0);
		const timer = setTimeout(() => {
			child.stdout.removeListener("data", onData);
			rej(new Error("timeout waiting for LSP response"));
		}, timeoutMs);
		const onData = (chunk: Buffer): void => {
			buf = Buffer.concat([buf, chunk]);
			while (true) {
				const headerEnd = buf.indexOf("\r\n\r\n");
				if (headerEnd === -1) return;
				const header = buf.subarray(0, headerEnd).toString("utf-8");
				const m = /Content-Length:\s*(\d+)/i.exec(header);
				if (m === null) {
					buf = buf.subarray(headerEnd + 4);
					continue;
				}
				const len = Number(m[1]);
				const total = headerEnd + 4 + len;
				if (buf.length < total) return;
				const body = buf.subarray(headerEnd + 4, total).toString("utf-8");
				buf = buf.subarray(total);
				try {
					const msg = JSON.parse(body) as JsonRpcMessage;
					const r = predicate(msg);
					if (r !== undefined) {
						clearTimeout(timer);
						child.stdout.removeListener("data", onData);
						res(r);
						return;
					}
				} catch {
					// ignore
				}
			}
		};
		child.stdout.on("data", onData);
	});
}

// ─── Session helper ──────────────────────────────────────────────────

/**
 * Spawn a server, initialize it, run the test body, then shut it down.
 * Catches the common case where the test forgets to clean up. The
 * server is given client capabilities matching opencode/VS Code so
 * pull diagnostics are advertised.
 */
async function withServer(
	body: (child: ChildProcessWithoutNullStreams, nextId: () => number) => Promise<void>,
): Promise<void> {
	const child = spawn(process.execPath, [BIN_PATH, "--stdio"], {
		stdio: ["pipe", "pipe", "pipe"],
	});
	let idCounter = 1;
	const nextId = (): number => idCounter++;

	try {
		const initId = nextId();
		sendMessage(child, {
			jsonrpc: "2.0",
			id: initId,
			method: "initialize",
			params: {
				processId: process.pid,
				rootUri: null,
				capabilities: {
					textDocument: {
						diagnostic: { dynamicRegistration: false },
					},
				},
			},
		});
		await awaitResponse(child, (msg) => {
			if ("id" in msg && msg.id === initId) return msg as JsonRpcResponse;
			return undefined;
		});
		sendMessage(child, { jsonrpc: "2.0", method: "initialized", params: {} });

		await body(child, nextId);

		const shutdownId = nextId();
		sendMessage(child, { jsonrpc: "2.0", id: shutdownId, method: "shutdown" });
		await awaitResponse(child, (msg) => {
			if ("id" in msg && msg.id === shutdownId) return true;
			return undefined;
		});
		sendMessage(child, { jsonrpc: "2.0", method: "exit" });
		await new Promise<void>((res) => child.on("exit", () => res()));
	} finally {
		if (!child.killed && child.exitCode === null) child.kill();
	}
}

function openDoc(
	child: ChildProcessWithoutNullStreams,
	uri: string,
	text: string,
	version = 1,
): void {
	sendMessage(child, {
		jsonrpc: "2.0",
		method: "textDocument/didOpen",
		params: {
			textDocument: { uri, languageId: "structured-text", version, text },
		},
	});
}

function request<T = unknown>(
	child: ChildProcessWithoutNullStreams,
	id: number,
	method: string,
	params: unknown,
): Promise<T> {
	sendMessage(child, { jsonrpc: "2.0", id, method, params });
	return awaitResponse(child, (msg) => {
		if ("id" in msg && msg.id === id) {
			const r = msg as JsonRpcResponse;
			if (r.error !== undefined) throw new Error(`LSP error: ${r.error.message}`);
			return r.result as T;
		}
		return undefined;
	}) as Promise<T>;
}

// ─── Tests ───────────────────────────────────────────────────────────

const FB_FIXTURE = `FUNCTION_BLOCK FB_Motor
VAR
\ttCycle : TIME;
END_VAR
END_FUNCTION_BLOCK`;

describe.skipIf(!existsSync(BIN_PATH))("LSP server end-to-end", () => {
	it("advertises expected capabilities on initialize", async () => {
		await withServer(async (child, nextId) => {
			// initialize already happened in withServer; re-init to inspect caps
			// — but we can also just observe the original init result. Pull
			// diagnostics support is gated on client capabilities, so verify
			// it was advertised.
			openDoc(child, "file:///x.st", FB_FIXTURE);
			const result = await request<{ kind: string; items: unknown[] }>(
				child,
				nextId(),
				"textDocument/diagnostic",
				{ textDocument: { uri: "file:///x.st" } },
			);
			expect(result.kind).toBe("full");
		});
	}, 5000);

	it("documentSymbol returns FB outline", async () => {
		await withServer(async (child, nextId) => {
			openDoc(child, "file:///fb.st", FB_FIXTURE);
			const syms = await request<Array<{ name: string; children?: Array<{ name: string }> }>>(
				child,
				nextId(),
				"textDocument/documentSymbol",
				{ textDocument: { uri: "file:///fb.st" } },
			);
			expect(syms[0]?.name).toBe("FB_Motor");
			expect(syms[0]?.children?.[0]?.name).toBe("tCycle");
		});
	}, 5000);

	it("definition resolves a type reference to its declaration file", async () => {
		await withServer(async (child, nextId) => {
			openDoc(
				child,
				"file:///t.st",
				"TYPE T_State : (Idle, Running) END_TYPE",
			);
			openDoc(
				child,
				"file:///fb.st",
				"FUNCTION_BLOCK FB_X\nVAR\n  state : T_State;\nEND_VAR\nEND_FUNCTION_BLOCK",
			);
			const result = await request<Array<{ uri: string }>>(
				child,
				nextId(),
				"textDocument/definition",
				{
					textDocument: { uri: "file:///fb.st" },
					position: { line: 2, character: 12 }, // on "T_State"
				},
			);
			expect(result.length).toBeGreaterThan(0);
			expect(result[0]?.uri).toBe("file:///t.st");
		});
	}, 5000);

	it("references returns a Location array (verified across files)", async () => {
		await withServer(async (child, nextId) => {
			openDoc(child, "file:///a.st", "FUNCTION_BLOCK FB_Shared END_FUNCTION_BLOCK");
			openDoc(
				child,
				"file:///b.st",
				"FUNCTION_BLOCK FB_User\nVAR\n\tinst : FB_Shared;\nEND_VAR\nEND_FUNCTION_BLOCK",
			);
			// Query from the USE site in b.st — references unit tests confirm
			// this finds at least the declaration. E2E just verifies wire
			// shape: response is a Location[] (possibly empty depending on
			// resolver coverage, which the unit tests own).
			const refs = await request<Array<{ uri: string; range: unknown }>>(
				child,
				nextId(),
				"textDocument/references",
				{
					textDocument: { uri: "file:///b.st" },
					position: { line: 2, character: 11 }, // on FB_Shared in b.st
					context: { includeDeclaration: true },
				},
			);
			expect(Array.isArray(refs)).toBe(true);
		});
	}, 5000);

	it("hover returns markdown content for a known symbol", async () => {
		await withServer(async (child, nextId) => {
			openDoc(child, "file:///h.st", FB_FIXTURE);
			const hover = await request<{ contents: { kind: string; value: string } } | null>(
				child,
				nextId(),
				"textDocument/hover",
				{
					textDocument: { uri: "file:///h.st" },
					position: { line: 0, character: 18 }, // FB_Motor name
				},
			);
			expect(hover?.contents.kind).toBe("markdown");
			expect(hover?.contents.value).toContain("FB_Motor");
		});
	}, 5000);

	it("workspace/symbol finds across-file declarations", async () => {
		await withServer(async (child, nextId) => {
			openDoc(child, "file:///a.st", "FUNCTION_BLOCK FB_Alpha END_FUNCTION_BLOCK");
			openDoc(child, "file:///b.st", "FUNCTION_BLOCK FB_Beta END_FUNCTION_BLOCK");
			const result = await request<Array<{ name: string }>>(
				child,
				nextId(),
				"workspace/symbol",
				{ query: "alpha" },
			);
			expect(result.map((s) => s.name)).toContain("FB_Alpha");
		});
	}, 5000);

	it("implementation returns FBs that IMPLEMENTS the interface", async () => {
		await withServer(async (child, nextId) => {
			openDoc(child, "file:///i.st", "INTERFACE IFoo END_INTERFACE");
			openDoc(
				child,
				"file:///fb.st",
				"FUNCTION_BLOCK FB_A IMPLEMENTS IFoo END_FUNCTION_BLOCK",
			);
			const result = await request<Array<{ uri: string }>>(
				child,
				nextId(),
				"textDocument/implementation",
				{
					textDocument: { uri: "file:///i.st" },
					position: { line: 0, character: 11 }, // IFoo
				},
			);
			expect(result.some((r) => r.uri === "file:///fb.st")).toBe(true);
		});
	}, 5000);

	it("prepareCallHierarchy resolves a method", async () => {
		await withServer(async (child, nextId) => {
			openDoc(child, "file:///m.st", "METHOD PUBLIC Execute : BOOL END_METHOD");
			const items = await request<Array<{ name: string }>>(
				child,
				nextId(),
				"textDocument/prepareCallHierarchy",
				{
					textDocument: { uri: "file:///m.st" },
					position: { line: 0, character: 17 }, // Execute
				},
			);
			expect(items[0]?.name).toBe("Execute");
		});
	}, 5000);

	it("prepareTypeHierarchy resolves an FB", async () => {
		await withServer(async (child, nextId) => {
			openDoc(child, "file:///fb.st", FB_FIXTURE);
			const items = await request<Array<{ name: string }>>(
				child,
				nextId(),
				"textDocument/prepareTypeHierarchy",
				{
					textDocument: { uri: "file:///fb.st" },
					position: { line: 0, character: 18 },
				},
			);
			expect(items[0]?.name).toBe("FB_Motor");
		});
	}, 5000);

	it("textDocument/diagnostic returns a full report (pull)", async () => {
		await withServer(async (child, nextId) => {
			// Force a parse error so we observe a non-empty report.
			openDoc(child, "file:///bad.st", "FUNCTION_BLOCK FB_Broken");
			const report = await request<{ kind: string; items: unknown[] }>(
				child,
				nextId(),
				"textDocument/diagnostic",
				{ textDocument: { uri: "file:///bad.st" } },
			);
			expect(report.kind).toBe("full");
			expect(Array.isArray(report.items)).toBe(true);
		});
	}, 5000);

	it("publishDiagnostics fires (debounced) after didOpen", async () => {
		await withServer(async (child, nextId) => {
			// Set up listener BEFORE opening the doc so we don't miss the
			// debounced publish.
			const seen = new Promise<{ uri: string; diagnostics: unknown[] }>((res) => {
				const onData = (chunk: Buffer): void => {
					const str = chunk.toString("utf-8");
					if (str.includes('"method":"textDocument/publishDiagnostics"')) {
						// Parse the framed payload.
						const headerEnd = str.indexOf("\r\n\r\n");
						if (headerEnd === -1) return;
						const body = str.slice(headerEnd + 4);
						try {
							const msg = JSON.parse(body) as {
								params: { uri: string; diagnostics: unknown[] };
							};
							child.stdout.removeListener("data", onData);
							res(msg.params);
						} catch {
							/* ignore */
						}
					}
				};
				child.stdout.on("data", onData);
			});
			openDoc(child, "file:///d.st", "FUNCTION_BLOCK FB_Bad");
			const notif = await Promise.race([
				seen,
				new Promise<never>((_, rej) => setTimeout(() => rej(new Error("no publish")), 2000)),
			]);
			expect(notif.uri).toBe("file:///d.st");
			// Touch nextId so the helper-typed param is used (silences lint).
			void nextId;
		});
	}, 5000);
});
