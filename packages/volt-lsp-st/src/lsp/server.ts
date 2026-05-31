/**
 * LSP server — JSON-RPC 2.0 over stdio.
 *
 * Message framing follows the LSP spec:
 *
 *   Content-Length: <bytes>\r\n
 *   \r\n
 *   <utf-8 JSON body>
 *
 * We hand-roll the framing rather than pull in a vscode-languageserver
 * dep. The parser is straightforward — read until \r\n\r\n, parse the
 * header for Content-Length, then read that many bytes of body.
 *
 * Lifecycle:
 *   initialize → initialized → request loop → shutdown → exit
 *
 * No external dependencies. Designed to be embeddable (you can call
 * `runServer(stdin, stdout)` from anywhere with two Readable/Writable
 * streams, not just process.stdin/stdout).
 */
import type { Readable, Writable } from "node:stream";
import { buildServerCapabilities } from "./capabilities.js";
import { resolveConfig, type PlcLspInitOptions } from "./config.js";
import { computeSemanticDiagnostics } from "../semantic/diagnostics.js";
import { completion as runCompletion, resolveCompletion } from "./queries/completion.js";
import { signatureHelp as runSignatureHelp } from "./queries/signature-help.js";
import { semanticTokens as runSemanticTokens } from "./queries/semantic-tokens.js";
import { foldingRanges as runFoldingRanges } from "./queries/folding-range.js";
import { documentHighlight as runDocumentHighlight } from "./queries/document-highlight.js";
import { selectionRanges as runSelectionRanges } from "./queries/selection-range.js";
import { codeActions as runCodeActions } from "./queries/code-action.js";
import type { CompletionItem, CodeActionParams, Position } from "vscode-languageserver-protocol";
import { buildDocumentSymbols } from "./queries/document-symbol.js";
import { definition as runDefinition } from "./queries/definition.js";
import { references as runReferences } from "./queries/references.js";
import { implementation as runImplementation } from "./queries/implementation.js";
import { hover as runHover } from "./queries/hover.js";
import { workspaceSymbol as runWorkspaceSymbol } from "./queries/workspace-symbol.js";
import {
	prepareCallHierarchy,
	incomingCalls,
	outgoingCalls,
	type CallHierarchyItem,
} from "./queries/call-hierarchy.js";
import {
	prepareTypeHierarchy,
	supertypes,
	subtypes,
	type TypeHierarchyItem,
} from "./queries/type-hierarchy.js";
import {
	ErrorCodes,
	type DidChangeTextDocumentParams,
	type DidCloseTextDocumentParams,
	type DidOpenTextDocumentParams,
	type DocumentSymbolParams,
	type InitializeParams,
	type InitializeResult,
	type JsonRpcMessage,
	type JsonRpcRequest,
	type JsonRpcResponse,
	type ReferenceParams,
	type TextDocumentPositionParams,
} from "./types.js";
import { Workspace } from "./workspace.js";

export interface ServerOptions {
	input: Readable;
	output: Writable;
}

export function runServer(opts: ServerOptions): void {
	const workspace = new Workspace();
	let shuttingDown = false;

	/**
	 * In-flight request ledger. Tracks which request IDs are currently
	 * being processed and whether a `$/cancelRequest` notification has
	 * arrived for each.
	 *
	 * Our query handlers are currently synchronous, so cancellation is
	 * largely protocol-surface — by the time a cancel arrives, the
	 * response is on its way back. But we honor it on the boundary: if
	 * a cancel comes in before the response is sent (rare race with
	 * batched I/O), we respond with `RequestCancelled` instead.
	 *
	 * When per-query work becomes async (e.g. workspace indexing for
	 * larger projects), threading an `AbortSignal` through query
	 * functions and checking it between iterations is the next step.
	 */
	const inFlight = new Map<JsonRpcRequest["id"], { cancelled: boolean }>();

	const send = (msg: JsonRpcMessage): void => {
		writeMessage(opts.output, msg);
	};

	const reply = (id: JsonRpcRequest["id"], result: unknown): void => {
		const entry = inFlight.get(id);
		inFlight.delete(id);
		if (entry?.cancelled === true) {
			send({
				jsonrpc: "2.0",
				id,
				error: {
					code: ErrorCodes.RequestCancelled,
					message: "Request cancelled by client",
				},
			} satisfies JsonRpcResponse);
			return;
		}
		send({ jsonrpc: "2.0", id, result } satisfies JsonRpcResponse);
	};

	const fail = (id: JsonRpcRequest["id"], code: number, message: string): void => {
		inFlight.delete(id);
		send({ jsonrpc: "2.0", id, error: { code, message } } satisfies JsonRpcResponse);
	};

	const handleRequest = (req: JsonRpcRequest): void => {
		inFlight.set(req.id, { cancelled: false });
		try {
			switch (req.method) {
				case "initialize": {
					const params = req.params as InitializeParams | undefined;
					if (params?.capabilities !== undefined) {
						workspace.setClientCapabilities(params.capabilities);
					}
					const initOptions = params?.initializationOptions as
						| PlcLspInitOptions
						| undefined;
					workspace.setConfig(resolveConfig(initOptions));
					const result: InitializeResult = {
						capabilities: buildServerCapabilities(workspace.clientCapabilities),
						serverInfo: { name: "volt-lsp-st", version: "0.0.0" },
					};
					reply(req.id, result);
					return;
				}
				case "shutdown": {
					shuttingDown = true;
					reply(req.id, null);
					return;
				}
				case "textDocument/documentSymbol": {
					const p = req.params as DocumentSymbolParams;
					const doc = workspace.getDocument(p.textDocument.uri);
					if (doc === undefined) {
						reply(req.id, []);
						return;
					}
					reply(req.id, buildDocumentSymbols(doc.parseResult));
					return;
				}
				case "textDocument/definition": {
					const p = req.params as TextDocumentPositionParams;
					const doc = workspace.getDocument(p.textDocument.uri);
					if (doc === undefined) {
						reply(req.id, []);
						return;
					}
					reply(
						req.id,
						runDefinition({
							doc,
							position: p.position,
							project: workspace.getProjectScope(),
						}),
					);
					return;
				}
				case "textDocument/references": {
					const p = req.params as ReferenceParams;
					const doc = workspace.getDocument(p.textDocument.uri);
					if (doc === undefined) {
						reply(req.id, []);
						return;
					}
					reply(
						req.id,
						runReferences({
							workspace,
							doc,
							position: p.position,
							project: workspace.getProjectScope(),
							includeDeclaration: p.context.includeDeclaration,
						}),
					);
					return;
				}
				case "textDocument/implementation": {
					const p = req.params as TextDocumentPositionParams;
					const doc = workspace.getDocument(p.textDocument.uri);
					if (doc === undefined) {
						reply(req.id, []);
						return;
					}
					reply(
						req.id,
						runImplementation({
							workspace,
							doc,
							position: p.position,
							project: workspace.getProjectScope(),
						}),
					);
					return;
				}
				case "textDocument/hover": {
					const p = req.params as TextDocumentPositionParams;
					const doc = workspace.getDocument(p.textDocument.uri);
					if (doc === undefined) {
						reply(req.id, null);
						return;
					}
					reply(
						req.id,
						runHover({
							doc,
							position: p.position,
							project: workspace.getProjectScope(),
							showSource: workspace.config.hover.showSource,
							activeVendor: workspace.config.vendor,
						}),
					);
					return;
				}
				case "workspace/symbol": {
					const p = req.params as { query: string };
					reply(
						req.id,
						runWorkspaceSymbol({
							workspace,
							project: workspace.getProjectScope(),
							query: p.query,
						}),
					);
					return;
				}
				case "textDocument/prepareCallHierarchy": {
					const p = req.params as TextDocumentPositionParams;
					const doc = workspace.getDocument(p.textDocument.uri);
					if (doc === undefined) {
						reply(req.id, null);
						return;
					}
					reply(
						req.id,
						prepareCallHierarchy({
							doc,
							position: p.position,
							project: workspace.getProjectScope(),
						}),
					);
					return;
				}
				case "callHierarchy/incomingCalls": {
					const p = req.params as { item: CallHierarchyItem };
					reply(req.id, incomingCalls({ workspace, item: p.item }));
					return;
				}
				case "callHierarchy/outgoingCalls": {
					const p = req.params as { item: CallHierarchyItem };
					reply(
						req.id,
						outgoingCalls({
							workspace,
							project: workspace.getProjectScope(),
							item: p.item,
						}),
					);
					return;
				}
				case "textDocument/prepareTypeHierarchy": {
					const p = req.params as TextDocumentPositionParams;
					const doc = workspace.getDocument(p.textDocument.uri);
					if (doc === undefined) {
						reply(req.id, null);
						return;
					}
					reply(
						req.id,
						prepareTypeHierarchy({
							doc,
							position: p.position,
							project: workspace.getProjectScope(),
						}),
					);
					return;
				}
				case "typeHierarchy/supertypes": {
					const p = req.params as { item: TypeHierarchyItem };
					reply(
						req.id,
						supertypes({
							workspace,
							project: workspace.getProjectScope(),
							item: p.item,
						}),
					);
					return;
				}
				case "textDocument/completion": {
					const p = req.params as TextDocumentPositionParams;
					const doc = workspace.getDocument(p.textDocument.uri);
					if (doc === undefined) {
						reply(req.id, []);
						return;
					}
					reply(
						req.id,
						runCompletion({
							doc,
							position: p.position,
							project: workspace.getProjectScope(),
							snippetSupport: workspace.config.completion.snippetSupport,
							activeVendor: workspace.config.vendor,
						}),
					);
					return;
				}
				case "completionItem/resolve": {
					const item = req.params as CompletionItem;
					reply(
						req.id,
						resolveCompletion(item, {
							showSource: workspace.config.hover.showSource,
							activeVendor: workspace.config.vendor,
						}),
					);
					return;
				}
				case "textDocument/signatureHelp": {
					const p = req.params as TextDocumentPositionParams;
					const doc = workspace.getDocument(p.textDocument.uri);
					if (doc === undefined) {
						reply(req.id, null);
						return;
					}
					reply(
						req.id,
						runSignatureHelp({
							doc,
							position: p.position,
							project: workspace.getProjectScope(),
						}),
					);
					return;
				}
				case "textDocument/foldingRange": {
					const p = req.params as { textDocument: { uri: string } };
					const doc = workspace.getDocument(p.textDocument.uri);
					if (doc === undefined) {
						reply(req.id, []);
						return;
					}
					reply(
						req.id,
						runFoldingRanges({ parseResult: doc.parseResult, source: doc.source }),
					);
					return;
				}
				case "textDocument/documentHighlight": {
					const p = req.params as TextDocumentPositionParams;
					const doc = workspace.getDocument(p.textDocument.uri);
					if (doc === undefined) {
						reply(req.id, []);
						return;
					}
					reply(req.id, runDocumentHighlight({ doc, position: p.position }));
					return;
				}
				case "textDocument/selectionRange": {
					const p = req.params as { textDocument: { uri: string }; positions: Position[] };
					const doc = workspace.getDocument(p.textDocument.uri);
					if (doc === undefined) {
						reply(req.id, []);
						return;
					}
					reply(req.id, runSelectionRanges({ doc, positions: p.positions }));
					return;
				}
				case "textDocument/codeAction": {
					const p = req.params as CodeActionParams;
					const doc = workspace.getDocument(p.textDocument.uri);
					if (doc === undefined) {
						reply(req.id, []);
						return;
					}
					reply(req.id, runCodeActions({ doc, params: p }));
					return;
				}
				case "textDocument/semanticTokens/full": {
					const p = req.params as { textDocument: { uri: string } };
					const doc = workspace.getDocument(p.textDocument.uri);
					if (doc === undefined) {
						reply(req.id, { data: [] });
						return;
					}
					reply(
						req.id,
						runSemanticTokens({
							source: doc.source,
							project: workspace.getProjectScope(),
							docUri: p.textDocument.uri,
						}),
					);
					return;
				}
				case "textDocument/diagnostic": {
					// LSP 3.17 pull diagnostics. We always return a full
					// report — server-side caching of `resultId` is a
					// future optimization, not a correctness requirement.
					const p = req.params as { textDocument: { uri: string } };
					reply(req.id, {
						kind: "full",
						items: computeDiagnostics(p.textDocument.uri),
					});
					return;
				}
				case "typeHierarchy/subtypes": {
					const p = req.params as { item: TypeHierarchyItem };
					reply(
						req.id,
						subtypes({
							workspace,
							project: workspace.getProjectScope(),
							item: p.item,
						}),
					);
					return;
				}
				default:
					fail(req.id, ErrorCodes.MethodNotFound, `method not found: ${req.method}`);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			fail(req.id, ErrorCodes.InternalError, message);
		}
	};

	const handleNotification = (msg: { method: string; params?: unknown }): void => {
		try {
			switch (msg.method) {
				case "initialized":
					return;
				case "$/cancelRequest": {
					const p = msg.params as { id: JsonRpcRequest["id"] } | undefined;
					if (p?.id === undefined) return;
					const entry = inFlight.get(p.id);
					if (entry !== undefined) {
						entry.cancelled = true;
					}
					return;
				}
				case "$/setTrace":
				case "$/logTrace":
					// Tracing notifications — accept silently. We don't emit
					// trace messages but acknowledging the methods is correct.
					return;
				case "textDocument/didOpen": {
					const p = msg.params as DidOpenTextDocumentParams;
					workspace.openDocument(p.textDocument.uri, p.textDocument.text, p.textDocument.version);
					publishDiagnostics(p.textDocument.uri);
					return;
				}
				case "textDocument/didChange": {
					const p = msg.params as DidChangeTextDocumentParams;
					// We advertised TextDocumentSyncKind.Incremental — pass the
					// whole change batch to the workspace; the underlying
					// TextDocument applies each edit in order.
					workspace.changeDocument(
						p.textDocument.uri,
						p.contentChanges,
						p.textDocument.version,
					);
					publishDiagnostics(p.textDocument.uri);
					return;
				}
				case "textDocument/didClose": {
					const p = msg.params as DidCloseTextDocumentParams;
					cancelPendingPush(p.textDocument.uri);
					workspace.closeDocument(p.textDocument.uri);
					// Also clear diagnostics on the client — pre-debounced
					// timers might otherwise leave stale squiggles behind.
					send({
						jsonrpc: "2.0",
						method: "textDocument/publishDiagnostics",
						params: { uri: p.textDocument.uri, diagnostics: [] },
					});
					return;
				}
				case "exit":
					process.exit(shuttingDown ? 0 : 1);
				default:
					// Unknown notifications are silently ignored per LSP convention.
					return;
			}
		} catch {
			// Notifications cannot reply with errors per LSP spec. Swallow.
		}
	};

	/**
	 * Pure diagnostic computation — independent of push/pull delivery.
	 * Merges parse errors with semantic diagnostics from
	 * `src/semantic/diagnostics.ts`.
	 *
	 * Called from:
	 *   - `publishDiagnostics(uri)` (push, debounced)
	 *   - `textDocument/diagnostic` (pull)
	 */
	const computeDiagnostics = (uri: string) => {
		const doc = workspace.getDocument(uri);
		if (doc === undefined) return [];
		const parseDiags = doc.parseResult.errors.map((e) => ({
			range: {
				start: { line: e.span.startLine - 1, character: e.span.startCol },
				end: { line: e.span.endLine - 1, character: e.span.endCol },
			},
			severity: 1, // Error
			source: "volt-lsp-st",
			message: e.message,
		}));
		const semantic = computeSemanticDiagnostics({
			parseResult: doc.parseResult,
			source: doc.source,
			project: workspace.getProjectScope(),
			config: workspace.config.diagnostics,
			activeVendor: workspace.config.vendor,
			bodyModels: doc.bodyModels,
		}).map((d) => ({
			range: {
				start: { line: d.span.startLine - 1, character: d.span.startCol },
				end: { line: d.span.endLine - 1, character: d.span.endCol },
			},
			severity: severityToNumber(d.severity),
			source: d.source,
			code: d.code,
			message: d.message,
		}));
		return [...parseDiags, ...semantic];
	};

	function severityToNumber(s: "error" | "warning" | "information" | "hint"): number {
		switch (s) {
			case "error":
				return 1;
			case "warning":
				return 2;
			case "information":
				return 3;
			case "hint":
				return 4;
		}
	}

	/**
	 * Per-document debounce timers for push diagnostics. Matches the
	 * 150ms cadence tsserver and opencode both use — long enough to
	 * coalesce rapid typing, short enough that the user feels the
	 * feedback.
	 */
	const DEBOUNCE_MS = 150;
	const pushTimers = new Map<string, NodeJS.Timeout>();

	const publishDiagnostics = (uri: string): void => {
		const existing = pushTimers.get(uri);
		if (existing !== undefined) clearTimeout(existing);
		const timer = setTimeout(() => {
			pushTimers.delete(uri);
			send({
				jsonrpc: "2.0",
				method: "textDocument/publishDiagnostics",
				params: { uri, diagnostics: computeDiagnostics(uri) },
			});
		}, DEBOUNCE_MS);
		pushTimers.set(uri, timer);
	};

	const cancelPendingPush = (uri: string): void => {
		const existing = pushTimers.get(uri);
		if (existing !== undefined) {
			clearTimeout(existing);
			pushTimers.delete(uri);
		}
	};

	readMessages(opts.input, (msg) => {
		if ("id" in msg && "method" in msg) {
			handleRequest(msg as JsonRpcRequest);
		} else if ("method" in msg) {
			handleNotification(msg as { method: string; params?: unknown });
		}
		// Responses to client-originated requests would be the third
		// case; we don't currently send any requests TO the client.
	});
}

// ─── Wire framing ────────────────────────────────────────────────────

function writeMessage(out: Writable, msg: JsonRpcMessage): void {
	const body = JSON.stringify(msg);
	const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
	out.write(header + body, "utf-8");
}

function readMessages(input: Readable, onMessage: (msg: JsonRpcMessage) => void): void {
	let buf = Buffer.alloc(0);
	input.on("data", (chunk: Buffer) => {
		buf = Buffer.concat([buf, chunk]);
		while (true) {
			const headerEnd = buf.indexOf("\r\n\r\n");
			if (headerEnd === -1) return;
			const header = buf.subarray(0, headerEnd).toString("utf-8");
			const m = /Content-Length:\s*(\d+)/i.exec(header);
			if (m === null) {
				// Malformed header — drop everything up to headerEnd and try again
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
				onMessage(msg);
			} catch {
				// Parse error — keep going, but ideally we'd send an error response.
			}
		}
	});
}
