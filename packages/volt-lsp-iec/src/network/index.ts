// Layer F — network text. The textual FBD/LD sublanguage: parser + AST, structural diagnostics, and
// the graphical branch of the outline. A second front-end that plugs in, not a second stack.
// See architecture.md → ownership map: `network/` owns the network-text AST + network-text diagnostics.
export * from "./text/ast.js"
export { parseNetworkText } from "./text/parser.js"
export { analyzeNetworkText, networkScopeAt, wireDefs, type NetworkTextAnalysis } from "./network-analyze.js"
export { computeNetworkTextDiagnostics } from "./network-analysis.js"
export { documentSymbolsWithVg } from "./network-symbols.js"
export {
  inNetworkText,
  networkHover,
  networkMarkerHover,
  networkDefinition,
  networkTypeDefinition,
  networkCompletion,
  networkResolveAt,
  resolveAnywhere,
  allReferences,
  referencesAnywhere,
  documentHighlightsAnywhere,
  prepareRenameAnywhere,
  renameAnywhere,
} from "./network-services.js"
