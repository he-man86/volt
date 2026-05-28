export * from "./lexer/tokens.js";
export type { Span } from "./lexer/span.js";
export { lex } from "./lexer/lexer.js";

export * from "./parser/ast.js";
export { parse, parseSource } from "./parser/parser.js";

// Init helper for callers that want to install the CODESYS reference
// corpus + SKILL.md (used by `volt init` in volt-agent).
export { runInit as installCorpus } from "./init.js";
export type { InitOptions as InstallCorpusOptions, InitResult as InstallCorpusResult } from "./init.js";

// Vendor auto-detection from a workspace directory.
export { detectVendor } from "./detect-vendor.js";
export type { DetectedVendor } from "./detect-vendor.js";

// Semantic diagnostics — exposed so downstream packages (volt-agent's
// language-conformance harness) can compute the same diagnostics the
// live LSP server emits, without spawning a subprocess.
export { computeSemanticDiagnostics } from "./semantic/diagnostics.js";
export type { DiagnosticItem, DiagnosticsArgs } from "./semantic/diagnostics.js";
export { buildSymbolTable } from "./semantic/symbol-table.js";
export type { Scope, SymbolTableInput } from "./semantic/symbol-table.js";
export { DEFAULT_DIAGNOSTIC_CONFIG } from "./lsp/config.js";
export type { DiagnosticConfig } from "./lsp/config.js";
