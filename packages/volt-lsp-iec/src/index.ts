/**
 * Public API surface for `@opencode-ai/volt-lsp-iec`.
 *
 * The live consumer is volt-git's `volt init` (`installCorpus` + vendor
 * detection). The VS Code extension bundles the LSP *binary* (`bin.ts`),
 * not this API. The remaining exports are the stable analysis surface
 * (lexer / parser / symbol table / diagnostics) kept for the in-package
 * conformance harness + recorder and any future downstream tool; the
 * scripts and tests import these modules directly, not through here.
 *
 * Adding an export commits to its stability — bump the package version on
 * breaking changes. Internal modules (not re-exported here) change freely.
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
// For callers that compute diagnostics without going through the LSP
// workspace (the in-package conformance harness).
export {
	buildBodyModel,
	buildBodyModelsForParseResult,
} from "./semantic/body.js";
export type { BodyModel } from "./semantic/body.js";

// ─── Semantic — diagnostics ──────────────────────────────────────────
// Compute the same diagnostics the live LSP server emits, without
// spawning a subprocess (the conformance harness / recorder).
export { computeSemanticDiagnostics } from "./semantic/diagnostics.js";
export type { DiagnosticItem, DiagnosticsArgs } from "./semantic/diagnostics.js";

// ─── LSP — diagnostic config ─────────────────────────────────────────
export { DEFAULT_DIAGNOSTIC_CONFIG } from "./lsp/config/index.js";
export type { DiagnosticConfig } from "./lsp/config/index.js";

// ─── Vendor detection ────────────────────────────────────────────────
export { detectVendor } from "./detect-vendor.js";
export type { DetectedVendor } from "./detect-vendor.js";

// ─── Workspace init (CODESYS reference corpus installer) ─────────────
// Used by volt-git's `volt init` to drop the ST reference docs + SKILL.md
// into a consumer project so AI sessions auto-discover them.
export { runInit as installCorpus } from "./init.js";
export type {
	InitOptions as InstallCorpusOptions,
	InitResult as InstallCorpusResult,
} from "./init.js";
