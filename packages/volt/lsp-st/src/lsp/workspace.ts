/**
 * In-memory workspace state for the LSP server. Tracks every open
 * document and its parse tree; rebuilds the project-scope symbol
 * table on demand.
 *
 * Document storage uses `TextDocument` from `vscode-languageserver-textdocument`
 * to handle incremental content updates correctly (range-based edits with
 * `TextDocumentSyncKind.Incremental`). We expose `source` as a convenience
 * string field that mirrors `textDocument.getText()` after each update.
 *
 * Mutation API:
 *   - openDocument(uri, source, version)
 *   - changeDocument(uri, contentChanges, version) — incremental edits
 *   - closeDocument(uri)
 *
 * Read API:
 *   - getDocument(uri)
 *   - getProjectScope() — lazily rebuilt; cached until next mutation
 *   - allDocuments() — iterator for cross-file scans
 *
 * The project scope is invalidated on every mutation. For tens of
 * files this is fine; for thousands we'd add per-file caching.
 */
import { TextDocument } from "vscode-languageserver-textdocument";
import type {
	ClientCapabilities,
	TextDocumentContentChangeEvent,
} from "vscode-languageserver-protocol";
import { parseSource } from "../parser/parser.js";
import type { ParseResult } from "../parser/ast.js";
import { buildSymbolTable, type Scope } from "../semantic/symbol-table.js";
import {
	DEFAULT_RESOLVED_CONFIG,
	type ResolvedConfig,
} from "./config.js";

/**
 * The IEC 61131-3 ST language id under LSP. Matches the VS Code
 * extension's `contributes.languages[*].id` for ST files.
 */
const ST_LANGUAGE_ID = "structured-text";

export interface Document {
	uri: string;
	/** Mirror of `textDocument.getText()` — kept in sync after each update. */
	source: string;
	version: number;
	parseResult: ParseResult;
	/** Underlying LSP text document — used by `applyContentChanges`. */
	textDocument: TextDocument;
}

export class Workspace {
	private readonly documents: Map<string, Document> = new Map();
	private projectScopeCache: Scope | undefined;
	private _clientCapabilities: ClientCapabilities = {};
	private _config: ResolvedConfig = DEFAULT_RESOLVED_CONFIG;

	/** Set during the `initialize` handshake. Empty object until then. */
	get clientCapabilities(): ClientCapabilities {
		return this._clientCapabilities;
	}
	setClientCapabilities(caps: ClientCapabilities): void {
		this._clientCapabilities = caps;
	}

	/** Resolved server config from `initializationOptions` + defaults. */
	get config(): ResolvedConfig {
		return this._config;
	}
	setConfig(config: ResolvedConfig): void {
		this._config = config;
	}

	openDocument(uri: string, source: string, version: number, languageId: string = ST_LANGUAGE_ID): void {
		const textDocument = TextDocument.create(uri, languageId, version, source);
		this.documents.set(uri, this.buildDocument(textDocument));
		this.invalidate();
	}

	/**
	 * Apply a batch of content changes. Each change is either:
	 *   - a full-document replacement (`{ text }` with no range)
	 *   - an incremental range edit (`{ range, text }`)
	 *
	 * Handles both because LSP allows clients to mix them. The underlying
	 * `TextDocument.update` does the right thing in either case.
	 *
	 * If the document is unknown (didChange arriving before didOpen — rare
	 * but observed in the wild), we treat the change as a full-text seed.
	 */
	changeDocument(uri: string, changes: TextDocumentContentChangeEvent[], version: number): void {
		const existing = this.documents.get(uri);
		if (existing === undefined) {
			// Defensive: seed from the last full-text change in the batch.
			let fullText = "";
			for (let i = changes.length - 1; i >= 0; i--) {
				const c = changes[i]!;
				if (!("range" in c)) {
					fullText = c.text;
					break;
				}
			}
			this.openDocument(uri, fullText, version);
			return;
		}
		const updated = TextDocument.update(existing.textDocument, changes, version);
		this.documents.set(uri, this.buildDocument(updated));
		this.invalidate();
	}

	closeDocument(uri: string): void {
		this.documents.delete(uri);
		this.invalidate();
	}

	getDocument(uri: string): Document | undefined {
		return this.documents.get(uri);
	}

	allDocuments(): Document[] {
		return [...this.documents.values()];
	}

	/** Build (or return cached) project-scope symbol table over all open documents. */
	getProjectScope(): Scope {
		if (this.projectScopeCache !== undefined) return this.projectScopeCache;
		const project = buildSymbolTable(
			this.allDocuments().map((d) => ({ uri: d.uri, parseResult: d.parseResult })),
		);
		this.projectScopeCache = project;
		return project;
	}

	private buildDocument(textDocument: TextDocument): Document {
		const source = textDocument.getText();
		return {
			uri: textDocument.uri,
			source,
			version: textDocument.version,
			parseResult: parseSource(source),
			textDocument,
		};
	}

	private invalidate(): void {
		this.projectScopeCache = undefined;
	}
}
