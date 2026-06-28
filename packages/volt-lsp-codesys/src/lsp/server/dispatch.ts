/**
 * Request + notification dispatch for the LSP server. One switch per
 * direction — every LSP method we serve routes through here.
 *
 * The dispatcher is intentionally a flat table: one `case` per LSP
 * method, each delegating to its query module in `../queries/`. No
 * cross-case state, no shared error paths beyond the outer try/catch.
 * If a new LSP method needs serving, add one `case`.
 *
 * State flow:
 *   - In-flight tracking + cancellation lives in DispatchContext (the
 *     `inFlight` map is mutated here and read by reply/fail).
 *   - `shuttingDown` is mutated by the `shutdown` request and read by
 *     the `exit` notification.
 *   - Everything else is plumbed in through the context — no module-
 *     level state.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type {
	CodeActionParams,
	CompletionItem,
	DocumentFormattingParams,
	Position,
} from "vscode-languageserver-protocol";
import { computeDiagnostics, type DiagnosticsPusher } from "./diagnostics-push.js";
import { buildServerCapabilities } from "../capabilities.js";
import { resolveConfig, type PlcLspInitOptions } from "../config/index.js";
import {
	prepareCallHierarchy,
	incomingCalls,
	outgoingCalls,
	type CallHierarchyItem,
} from "../queries/call-hierarchy.js";
import { codeActions as runCodeActions } from "../queries/code-action.js";
import {
	completion as runCompletion,
	resolveCompletion,
} from "../queries/completion.js";
import { definition as runDefinition } from "../queries/definition.js";
import { formatDocument, indentOptionsFrom, resolveFormatOptions } from "../queries/format.js";
import { documentHighlight as runDocumentHighlight } from "../queries/document-highlight.js";
import { buildDocumentSymbols } from "../queries/document-symbol.js";
import { foldingRanges as runFoldingRanges } from "../queries/folding-range.js";
import { hover as runHover } from "../queries/hover.js";
import { implementation as runImplementation } from "../queries/implementation.js";
import { references as runReferences } from "../queries/references.js";
import { rename as runRename, prepareRename as runPrepareRename } from "../queries/rename.js";
import { selectionRanges as runSelectionRanges } from "../queries/selection-range.js";
import { semanticTokens as runSemanticTokens } from "../queries/semantic-tokens.js";
import { signatureHelp as runSignatureHelp } from "../queries/signature-help.js";
import { vgBodiesOf } from "../queries/vg/shared.js";
import {
	prepareTypeHierarchy,
	supertypes,
	subtypes,
	type TypeHierarchyItem,
} from "../queries/type-hierarchy.js";
import { workspaceSymbol as runWorkspaceSymbol } from "../queries/workspace-symbol.js";
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
	type ReferenceParams,
	type TextDocumentPositionParams,
} from "../types.js";
import type { Workspace } from "../workspace.js";

/**
 * Mutable server state shared by request + notification handlers.
 */
export interface ServerState {
	shuttingDown: boolean;
	/** Workspace root paths collected from the initialize params. */
	workspaceRoots: string[];
}

/**
 * Context plumbed into every dispatcher call. All side-channels (send
 * a message, reply to a request, etc.) are injected so the dispatcher
 * itself stays pure-ish — same inputs + ctx → same outputs.
 */
export interface DispatchContext {
	workspace: Workspace;
	state: ServerState;
	pusher: DiagnosticsPusher;
	send: (msg: JsonRpcMessage) => void;
	reply: (id: JsonRpcRequest["id"], result: unknown) => void;
	fail: (id: JsonRpcRequest["id"], code: number, message: string) => void;
}

export function handleRequest(req: JsonRpcRequest, ctx: DispatchContext): void {
	try {
		switch (req.method) {
		case "initialize": {
			const params = req.params as InitializeParams | undefined;
			if (params?.capabilities !== undefined) {
				ctx.workspace.setClientCapabilities(params.capabilities);
			}
			const initOptions = params?.initializationOptions as PlcLspInitOptions | undefined;
			ctx.workspace.setConfig(resolveConfig(initOptions));
			// Collect workspace roots for the background index on `initialized`.
			const roots: string[] = [];
			if (params?.workspaceFolders) {
				for (const folder of params.workspaceFolders) {
					try { roots.push(fileURLToPath(folder.uri)); } catch { /* skip non-file URIs */ }
				}
			} else if (params?.rootUri) {
				try { roots.push(fileURLToPath(params.rootUri)); } catch { /* skip */ }
			} else if (params?.rootPath) {
				roots.push(params.rootPath);
			}
			ctx.state.workspaceRoots = roots;
			const result: InitializeResult = {
				capabilities: buildServerCapabilities(ctx.workspace.clientCapabilities),
				serverInfo: { name: "volt-lsp-codesys", version: "0.0.0" },
			};
			ctx.reply(req.id, result);
			return;
		}
			case "shutdown": {
				ctx.state.shuttingDown = true;
				ctx.reply(req.id, null);
				return;
			}
			case "textDocument/documentSymbol": {
				const p = req.params as DocumentSymbolParams;
				const doc = ctx.workspace.getDocument(p.textDocument.uri);
				if (doc === undefined) { ctx.reply(req.id, []); return; }
				ctx.reply(req.id, buildDocumentSymbols(doc.parseResult, doc.bodyModels));
				return;
			}
			case "textDocument/definition": {
				const p = req.params as TextDocumentPositionParams;
				const doc = ctx.workspace.getDocument(p.textDocument.uri);
				if (doc === undefined) { ctx.reply(req.id, []); return; }
				ctx.reply(
					req.id,
					runDefinition({
						doc,
						position: p.position,
						project: ctx.workspace.getProjectScope(),
					}),
				);
				return;
			}
			case "textDocument/references": {
				const p = req.params as ReferenceParams;
				const doc = ctx.workspace.getDocument(p.textDocument.uri);
				if (doc === undefined) { ctx.reply(req.id, []); return; }
				ctx.reply(
					req.id,
					runReferences({
						workspace: ctx.workspace,
						doc,
						position: p.position,
						project: ctx.workspace.getProjectScope(),
						includeDeclaration: p.context.includeDeclaration,
					}),
				);
				return;
			}
			case "textDocument/implementation": {
				const p = req.params as TextDocumentPositionParams;
				const doc = ctx.workspace.getDocument(p.textDocument.uri);
				if (doc === undefined) { ctx.reply(req.id, []); return; }
				ctx.reply(
					req.id,
					runImplementation({
						workspace: ctx.workspace,
						doc,
						position: p.position,
						project: ctx.workspace.getProjectScope(),
					}),
				);
				return;
			}
			case "textDocument/hover": {
				const p = req.params as TextDocumentPositionParams;
				const doc = ctx.workspace.getDocument(p.textDocument.uri);
				if (doc === undefined) { ctx.reply(req.id, null); return; }
				ctx.reply(
					req.id,
					runHover({
						doc,
						position: p.position,
						project: ctx.workspace.getProjectScope(),
						showSource: ctx.workspace.config.hover.showSource,
						activeVendor: ctx.workspace.config.vendor,
					}),
				);
				return;
			}
			case "textDocument/prepareRename": {
				const p = req.params as TextDocumentPositionParams;
				const doc = ctx.workspace.getDocument(p.textDocument.uri);
				if (doc === undefined) { ctx.reply(req.id, null); return; }
				ctx.reply(req.id, runPrepareRename({ doc, position: p.position }));
				return;
			}
			case "textDocument/rename": {
				const p = req.params as TextDocumentPositionParams & { newName: string };
				const doc = ctx.workspace.getDocument(p.textDocument.uri);
				if (doc === undefined) { ctx.reply(req.id, null); return; }
				ctx.reply(
					req.id,
					runRename({
						workspace: ctx.workspace,
						doc,
						position: p.position,
						project: ctx.workspace.getProjectScope(),
						newName: p.newName,
					}),
				);
				return;
			}
			case "workspace/symbol": {
				const p = req.params as { query: string };
				ctx.reply(
					req.id,
					runWorkspaceSymbol({
						workspace: ctx.workspace,
						project: ctx.workspace.getProjectScope(),
						query: p.query,
					}),
				);
				return;
			}
			case "textDocument/prepareCallHierarchy": {
				const p = req.params as TextDocumentPositionParams;
				const doc = ctx.workspace.getDocument(p.textDocument.uri);
				if (doc === undefined) { ctx.reply(req.id, null); return; }
				ctx.reply(
					req.id,
					prepareCallHierarchy({
						doc,
						position: p.position,
						project: ctx.workspace.getProjectScope(),
					}),
				);
				return;
			}
			case "callHierarchy/incomingCalls": {
				const p = req.params as { item: CallHierarchyItem };
				ctx.reply(req.id, incomingCalls({ workspace: ctx.workspace, item: p.item }));
				return;
			}
			case "callHierarchy/outgoingCalls": {
				const p = req.params as { item: CallHierarchyItem };
				ctx.reply(
					req.id,
					outgoingCalls({
						workspace: ctx.workspace,
						project: ctx.workspace.getProjectScope(),
						item: p.item,
					}),
				);
				return;
			}
			case "textDocument/prepareTypeHierarchy": {
				const p = req.params as TextDocumentPositionParams;
				const doc = ctx.workspace.getDocument(p.textDocument.uri);
				if (doc === undefined) { ctx.reply(req.id, null); return; }
				ctx.reply(
					req.id,
					prepareTypeHierarchy({
						doc,
						position: p.position,
						project: ctx.workspace.getProjectScope(),
					}),
				);
				return;
			}
			case "typeHierarchy/supertypes": {
				const p = req.params as { item: TypeHierarchyItem };
				ctx.reply(
					req.id,
					supertypes({
						workspace: ctx.workspace,
						project: ctx.workspace.getProjectScope(),
						item: p.item,
					}),
				);
				return;
			}
			case "typeHierarchy/subtypes": {
				const p = req.params as { item: TypeHierarchyItem };
				ctx.reply(
					req.id,
					subtypes({
						workspace: ctx.workspace,
						project: ctx.workspace.getProjectScope(),
						item: p.item,
					}),
				);
				return;
			}
			case "textDocument/completion": {
				const p = req.params as TextDocumentPositionParams;
				const doc = ctx.workspace.getDocument(p.textDocument.uri);
				if (doc === undefined) { ctx.reply(req.id, []); return; }
				ctx.reply(
					req.id,
					runCompletion({
						doc,
						position: p.position,
						project: ctx.workspace.getProjectScope(),
						snippetSupport: ctx.workspace.config.completion.snippetSupport,
						activeVendor: ctx.workspace.config.vendor,
					}),
				);
				return;
			}
			case "completionItem/resolve": {
				const item = req.params as CompletionItem;
				ctx.reply(
					req.id,
					resolveCompletion(item, {
						showSource: ctx.workspace.config.hover.showSource,
						activeVendor: ctx.workspace.config.vendor,
					}),
				);
				return;
			}
			case "textDocument/signatureHelp": {
				const p = req.params as TextDocumentPositionParams;
				const doc = ctx.workspace.getDocument(p.textDocument.uri);
				if (doc === undefined) { ctx.reply(req.id, null); return; }
				ctx.reply(
					req.id,
					runSignatureHelp({
						doc,
						position: p.position,
						project: ctx.workspace.getProjectScope(),
					}),
				);
				return;
			}
			case "textDocument/foldingRange": {
				const p = req.params as { textDocument: { uri: string } };
				const doc = ctx.workspace.getDocument(p.textDocument.uri);
				if (doc === undefined) { ctx.reply(req.id, []); return; }
				ctx.reply(
					req.id,
					runFoldingRanges({ parseResult: doc.parseResult, source: doc.source, vgBodies: vgBodiesOf(doc.bodyModels) }),
				);
				return;
			}
			case "textDocument/documentHighlight": {
				const p = req.params as TextDocumentPositionParams;
				const doc = ctx.workspace.getDocument(p.textDocument.uri);
				if (doc === undefined) { ctx.reply(req.id, []); return; }
				ctx.reply(req.id, runDocumentHighlight({ doc, position: p.position }));
				return;
			}
			case "textDocument/selectionRange": {
				const p = req.params as { textDocument: { uri: string }; positions: Position[] };
				const doc = ctx.workspace.getDocument(p.textDocument.uri);
				if (doc === undefined) { ctx.reply(req.id, []); return; }
				ctx.reply(req.id, runSelectionRanges({ doc, positions: p.positions }));
				return;
			}
			case "textDocument/codeAction": {
				const p = req.params as CodeActionParams;
				const doc = ctx.workspace.getDocument(p.textDocument.uri);
				if (doc === undefined) { ctx.reply(req.id, []); return; }
				ctx.reply(req.id, runCodeActions({ doc, params: p, project: ctx.workspace.getProjectScope() }));
				return;
			}
			case "textDocument/formatting": {
					const p = req.params as DocumentFormattingParams;
					const doc = ctx.workspace.getDocument(p.textDocument.uri);
					if (doc === undefined) { ctx.reply(req.id, []); return; }
					// `.editorconfig` (resolved from the file's path) overrides
					// the editor's tab settings for the keys it specifies.
					// Untitled/in-memory docs have no path → editor settings only.
					let filePath: string | undefined;
					try { filePath = fileURLToPath(p.textDocument.uri); } catch { filePath = undefined; }
					ctx.reply(
						req.id,
						formatDocument({
							source: doc.source,
							options: resolveFormatOptions(filePath, indentOptionsFrom(p)),
						}),
					);
					return;
				}
				case "textDocument/semanticTokens/full": {
				const p = req.params as { textDocument: { uri: string } };
				const doc = ctx.workspace.getDocument(p.textDocument.uri);
				if (doc === undefined) { ctx.reply(req.id, { data: [] }); return; }
				ctx.reply(
					req.id,
					runSemanticTokens({
						source: doc.source,
						project: ctx.workspace.getProjectScope(),
						docUri: p.textDocument.uri,
						vgBodies: vgBodiesOf(doc.bodyModels),
					}),
				);
				return;
			}
			case "textDocument/diagnostic": {
				// LSP 3.17 pull diagnostics. We always return a full report —
				// server-side `resultId` caching is a future optimization,
				// not a correctness requirement.
				const p = req.params as { textDocument: { uri: string } };
				ctx.reply(req.id, {
					kind: "full",
					items: computeDiagnostics(ctx.workspace, p.textDocument.uri),
				});
				return;
			}
			default:
				ctx.fail(req.id, ErrorCodes.MethodNotFound, `method not found: ${req.method}`);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		ctx.fail(req.id, ErrorCodes.InternalError, message);
	}
}

export function handleNotification(
	msg: { method: string; params?: unknown },
	ctx: DispatchContext,
	inFlight: Map<JsonRpcRequest["id"], { cancelled: boolean }>,
): void {
	try {
		switch (msg.method) {
		case "initialized": {
			// Seed the workspace with every .st / type-def file found
			// under the workspace roots so cross-file types (enums,
			// structs, FBs defined in files the user hasn't opened yet)
			// are visible to the symbol table immediately.
			for (const root of ctx.state.workspaceRoots) {
				for (const file of walkForStFiles(root)) {
					// Skip files already opened by the editor via didOpen.
					const uri = pathToFileURL(file).toString();
					if (ctx.workspace.getDocument(uri) !== undefined) continue;
					try {
						const text = fs.readFileSync(file, "utf-8");
						ctx.workspace.openDocument(uri, text, 0);
					} catch { /* unreadable file — skip silently */ }
				}
			}
			return;
		}
			case "$/cancelRequest": {
				const p = msg.params as { id: JsonRpcRequest["id"] } | undefined;
				if (p?.id === undefined) return;
				const entry = inFlight.get(p.id);
				if (entry !== undefined) entry.cancelled = true;
				return;
			}
			case "$/setTrace":
			case "$/logTrace":
				// Tracing notifications — accept silently. We don't emit trace
				// messages, but acknowledging the methods keeps the client happy.
				return;
			case "textDocument/didOpen": {
				const p = msg.params as DidOpenTextDocumentParams;
				ctx.workspace.openDocument(
					p.textDocument.uri,
					p.textDocument.text,
					p.textDocument.version,
				);
				ctx.pusher.schedule(p.textDocument.uri);
				return;
			}
			case "textDocument/didChange": {
				const p = msg.params as DidChangeTextDocumentParams;
				// We advertised TextDocumentSyncKind.Incremental — pass the
				// whole change batch; the underlying TextDocument applies
				// each edit in order.
				ctx.workspace.changeDocument(
					p.textDocument.uri,
					p.contentChanges,
					p.textDocument.version,
				);
				ctx.pusher.schedule(p.textDocument.uri);
				return;
			}
			case "textDocument/didClose": {
				const p = msg.params as DidCloseTextDocumentParams;
				ctx.pusher.cancel(p.textDocument.uri);
				ctx.workspace.closeDocument(p.textDocument.uri);
				// Clear diagnostics on the client — pre-debounced timers might
				// otherwise leave stale squiggles behind.
				ctx.send({
					jsonrpc: "2.0",
					method: "textDocument/publishDiagnostics",
					params: { uri: p.textDocument.uri, diagnostics: [] },
				});
				return;
			}
		case "exit":
			process.exit(ctx.state.shuttingDown ? 0 : 1);
		default:
			// Unknown notifications are silently ignored per LSP convention.
			return;
	}
} catch {
	// Notifications cannot reply with errors per LSP spec. Swallow.
}
}

/**
 * Recursively walk `dir` and yield absolute paths of every PLC-text
 * source file found: `.st` (POU bodies), `.gvl` (global variable lists),
 * and the type-def extensions (`.struct` / `.enum` / `.union` / `.alias`)
 * volt-agent materializes for DUT subkinds. Skips `node_modules` and
 * hidden directories.
 */
const ST_LIKE_EXTENSIONS: ReadonlySet<string> = new Set([
	".st", ".struct", ".enum", ".union", ".alias", ".gvl",
]);
function* walkForStFiles(dir: string): Generator<string> {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walkForStFiles(full);
		} else if (entry.isFile()) {
			const ext = path.extname(entry.name).toLowerCase();
			if (ST_LIKE_EXTENSIONS.has(ext)) yield full;
		}
	}
}
