export * from "./lexer/tokens.js";
export type { Span } from "./lexer/span.js";
export { lex } from "./lexer/lexer.js";

export * from "./parser/ast.js";
export { parse, parseSource } from "./parser/parser.js";

// Init helper for callers that want to install the CODESYS reference
// corpus + CLAUDE.md pointer (used by `plc init` in volt-agent).
export { runInit as installCorpus } from "./init.js";
export type { InitOptions as InstallCorpusOptions, InitResult as InstallCorpusResult } from "./init.js";

// Vendor auto-detection from a workspace directory.
export { detectVendor } from "./detect-vendor.js";
export type { DetectedVendor } from "./detect-vendor.js";
