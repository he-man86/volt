/**
 * LSP wire types — re-exported from the canonical Microsoft library plus
 * our own JSON-RPC envelope types (we hand-roll framing, so we don't
 * depend on `vscode-jsonrpc`).
 *
 * Canonical types come from `vscode-languageserver-protocol`. Re-exporting
 * under our existing names keeps internal call sites stable while we
 * benefit from spec-aligned shapes Microsoft maintains.
 *
 * Spec reference: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
 *
 * Conventions:
 *   - Lines and characters are 0-based (LSP standard).
 *   - Our internal lexer uses 1-based lines / 0-based cols; we
 *     convert at the LSP boundary in `src/lsp/position.ts`.
 */

// ─── Canonical LSP types (re-exported) ───────────────────────────────

export type {
	Position,
	Range,
	Location,
	DocumentSymbol,
	TextDocumentIdentifier,
	VersionedTextDocumentIdentifier,
	TextDocumentItem,
	TextDocumentPositionParams,
	DocumentSymbolParams,
	ReferenceContext,
	ReferenceParams,
	DidOpenTextDocumentParams,
	DidChangeTextDocumentParams,
	DidCloseTextDocumentParams,
	TextDocumentContentChangeEvent,
	InitializeParams,
	InitializeResult,
	ServerCapabilities,
	TextDocumentSyncOptions,
	ClientCapabilities,
	Diagnostic,
	DiagnosticSeverity,
	Hover,
	MarkupContent,
	WorkspaceSymbolParams,
	CallHierarchyItem,
	TypeHierarchyItem,
} from "vscode-languageserver-protocol";

export { TextDocumentSyncKind } from "vscode-languageserver-protocol";

// ─── SymbolKind ──────────────────────────────────────────────────────
// The library exports `SymbolKind` as both a namespace of numeric
// constants and a numeric union type. We expose both under our pre-
// existing names to avoid renaming every call site.

import { SymbolKind } from "vscode-languageserver-protocol";

export const LspSymbolKind = SymbolKind;
export type LspSymbolKindValue = SymbolKind;

// ─── JSON-RPC envelope (ours — we hand-roll wire framing) ────────────

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: number | string;
	method: string;
	params?: unknown;
}

export interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number | string;
	result?: unknown;
	error?: JsonRpcError;
}

export interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/**
 * Standard JSON-RPC + LSP error codes.
 *
 * Re-exposed under our existing `ErrorCodes` name. The canonical source is
 * `vscode-jsonrpc`'s `ErrorCodes`/`LSPErrorCodes` namespaces, but rather
 * than re-export the runtime objects (which would pull `vscode-jsonrpc`
 * into our bundle), we duplicate the numeric values here. The numbers
 * are spec-defined and stable.
 */
export const ErrorCodes = {
	// JSON-RPC standard
	ParseError: -32700,
	InvalidRequest: -32600,
	MethodNotFound: -32601,
	InvalidParams: -32602,
	InternalError: -32603,
	// LSP-specific
	RequestFailed: -32803,
	ServerCancelled: -32802,
	ContentModified: -32801,
	RequestCancelled: -32800,
} as const;
