/**
 * THE VOLT LIBRARY FORMAT — how a referenced library is materialized in a workspace: its path layout, its manifest, and
 * the materialization format (openspec frontend-conformance design.md P2: a leaf that imports nothing). The front-end's
 * `symbols` and `types`, the server, `workspace-refs`, the library repo and the transpiler read it through here.
 */
export { isLibraryUri, libraryOf } from "./path.js"
export { libraryResolution, parseLibraryManifest, type LibraryManifest } from "./manifest.js"
export {
  MATERIALIZATION,
  MATERIALIZATION_FORMATS,
  materializationMismatch,
  newerLibraryManifests,
  staleLibraryManifests,
} from "./materialization.js"
