/**
 * Server capabilities — what we tell the LSP client we can do.
 *
 * Keep this in sync with what's actually implemented. Advertising a
 * capability we don't serve makes clients send requests we'll fail.
 */
import {
	LspSymbolKind,
	TextDocumentSyncKind,
	type ClientCapabilities,
	type LspSymbolKindValue,
	type ServerCapabilities,
} from "./types.js";
import type { SymbolKind } from "../semantic/symbol-table.js";
import { TOKEN_TYPES, TOKEN_MODIFIERS } from "./queries/semantic-tokens.js";

/**
 * Compute the server capabilities to advertise, gated by what the
 * client said it supports. Following the rust-analyzer / lsp-sample
 * pattern: never advertise something the client cannot consume.
 *
 * The pull-diagnostics provider is only advertised if the client
 * declares support via `textDocument.diagnostic`. Push diagnostics
 * are always available (notification, not opt-in).
 */
export function buildServerCapabilities(clientCaps: ClientCapabilities): ServerCapabilities {
	const supportsPullDiagnostics =
		clientCaps.textDocument?.diagnostic !== undefined;

	const caps: ServerCapabilities = {
		textDocumentSync: {
			openClose: true,
			change: TextDocumentSyncKind.Incremental,
		},
		documentSymbolProvider: true,
		definitionProvider: true,
		referencesProvider: true,
		implementationProvider: true,
		hoverProvider: true,
		workspaceSymbolProvider: true,
		callHierarchyProvider: true,
		typeHierarchyProvider: true,
	};

	if (supportsPullDiagnostics) {
		caps.diagnosticProvider = {
			interFileDependencies: true,
			workspaceDiagnostics: false,
			identifier: "plcassist-st-lsp",
		};
	}

	// Completion provider — triggers on `.` (member access) and `'`
	// (pragma attribute names). Resolve provider enabled so we can
	// lazy-load markdown docs.
	caps.completionProvider = {
		resolveProvider: true,
		triggerCharacters: [".", "'"],
	};

	// Signature help — triggers on `(` and `,`.
	caps.signatureHelpProvider = {
		triggerCharacters: ["(", ","],
		retriggerCharacters: [","],
	};

	// Phase-7 polish features — all advertised unconditionally; clients
	// that don't support them ignore.
	caps.foldingRangeProvider = true;
	caps.documentHighlightProvider = true;
	caps.selectionRangeProvider = true;
	caps.codeActionProvider = {
		codeActionKinds: ["quickfix"],
		resolveProvider: false,
	};

	// Semantic tokens — gated on client support.
	const supportsSemanticTokens = clientCaps.textDocument?.semanticTokens !== undefined;
	if (supportsSemanticTokens) {
		caps.semanticTokensProvider = {
			legend: {
				tokenTypes: [...TOKEN_TYPES],
				tokenModifiers: [...TOKEN_MODIFIERS],
			},
			full: true,
			range: false,
		};
	}

	return caps;
}

/**
 * Map our domain SymbolKind to LSP's numeric SymbolKind.
 * Centralized here so changes ripple through one place.
 */
export function lspSymbolKindFor(kind: SymbolKind): LspSymbolKindValue {
	switch (kind) {
		case "function_block":
			return LspSymbolKind.Class;
		case "program":
			return LspSymbolKind.Module;
		case "function":
			return LspSymbolKind.Function;
		case "method":
			return LspSymbolKind.Method;
		case "action":
			return LspSymbolKind.Function;
		case "property":
			return LspSymbolKind.Property;
		case "interface":
			return LspSymbolKind.Interface;
		case "interface_method":
			return LspSymbolKind.Method;
		case "interface_property":
			return LspSymbolKind.Property;
		case "namespace":
			return LspSymbolKind.Namespace;
		case "type":
			return LspSymbolKind.Struct;
		case "var":
			return LspSymbolKind.Variable;
		case "method_param":
			return LspSymbolKind.Variable;
		case "struct_field":
			return LspSymbolKind.Field;
		case "enum_value":
			return LspSymbolKind.EnumMember;
		case "gvl_var":
			return LspSymbolKind.Variable;
	}
}
