/**
 * Public API surface for `@opencode-ai/volt-lsp`.
 *
 * Every export here is consumed by another package (primarily
 * volt-agent's conformance harness, recorder, and VS Code extension).
 * Adding an export commits to its stability — bump the package version
 * on breaking changes. Removing one risks breaking downstream tools.
 *
 * Internal modules (everything not re-exported here) are free to
 * change without a version bump.
 */

// ─── Lexer ────────────────────────────────────────────────────────────
export * from "./lexer/tokens.js";
export type { Span } from "./lexer/span.js";
export { lex } from "./lexer/lexer.js";

// ─── Parser ───────────────────────────────────────────────────────────
export * from "./parser/ast.js";
export { parse, parseSource } from "./parser/parser.js";

// ─── Semantic — symbol table ─────────────────────────────────────────
export { buildSymbolTable } from "./semantic/symbol-table-build.js";
export type { SymbolTableInput } from "./semantic/symbol-table-build.js";
export type { Scope } from "./semantic/symbol-table.js";

// ─── Semantic — body model ───────────────────────────────────────────
// Used by downstream callers (volt-agent's conformance harness) that
// compute diagnostics without going through the LSP workspace.
export {
	buildBodyModel,
	buildBodyModelsForParseResult,
} from "./semantic/body.js";
export type { BodyModel } from "./semantic/body.js";

// ─── Semantic — diagnostics ──────────────────────────────────────────
// Exposed so downstream packages (volt-agent's language-conformance
// harness) can compute the same diagnostics the live LSP server
// emits, without spawning a subprocess.
export { computeSemanticDiagnostics } from "./semantic/diagnostics.js";
export type { DiagnosticItem, DiagnosticsArgs } from "./semantic/diagnostics.js";

// ─── LSP — diagnostic config ─────────────────────────────────────────
export { DEFAULT_DIAGNOSTIC_CONFIG } from "./lsp/config/index.js";
export type { DiagnosticConfig } from "./lsp/config/index.js";

// ─── Vendor detection ────────────────────────────────────────────────
export { detectVendor } from "./detect-vendor.js";
export type { DetectedVendor } from "./detect-vendor.js";

// ─── Workspace init (CODESYS reference corpus installer) ─────────────
// Used by `volt init` in volt-agent to drop the ST reference docs +
// SKILL.md into a consumer project so AI sessions auto-discover them.
export { runInit as installCorpus } from "./init.js";
export type {
	InitOptions as InstallCorpusOptions,
	InitResult as InstallCorpusResult,
} from "./init.js";
