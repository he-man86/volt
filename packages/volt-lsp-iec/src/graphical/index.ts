// Layer F — graphical (VG). The textual FBD/LD sublanguage: parser + AST, structural diagnostics, and
// the graphical branch of the outline. A second front-end that plugs in, not a second stack.
// See architecture.md → ownership map: `graphical/` owns the VG AST + VG diagnostics.
export * from "./text/ast.js"
export { parseNetworkText } from "./text/parser.js"
export { analyzeNetworkText, vgScopeAt, wireDefs, type NetworkTextAnalysis } from "./network-analyze.js"
export { computeNetworkTextDiagnostics } from "./network-analysis.js"
export { documentSymbolsWithVg } from "./network-symbols.js"
export {
  inNetworkText,
  vgHover,
  vgMarkerHover,
  vgDefinition,
  vgTypeDefinition,
  vgCompletion,
  vgResolveAt,
  resolveAnywhere,
  allReferences,
  referencesAnywhere,
  documentHighlightsAnywhere,
  prepareRenameAnywhere,
  renameAnywhere,
} from "./network-services.js"
