// Layer F — graphical (VG). The textual FBD/LD sublanguage: parser + AST, structural diagnostics, and
// the graphical branch of the outline. A second front-end that plugs in, not a second stack.
// See architecture.md → ownership map: `graphical/` owns the VG AST + VG diagnostics.
export * from "./text/ast.js"
export { parseVgBody } from "./text/parser.js"
export { analyzeVgBody, vgScopeAt, wireDefs, type VgAnalysis } from "./vg-analyze.js"
export { computeVgDiagnostics } from "./vg-analysis.js"
export { documentSymbolsWithVg } from "./vg-symbols.js"
export {
  inVgBody,
  vgHover,
  vgMarkerHover,
  vgDefinition,
  vgTypeDefinition,
  vgCompletion,
  vgResolveAt,
  resolveAnywhere,
  allReferences,
  referencesAnywhere,
  prepareRenameAnywhere,
  renameAnywhere,
} from "./vg-services.js"
