/**
 * AST → IR. The only place ST semantics are decided; every backend downstream is a printer.
 *
 * The folders (design.md §2.4): `entry/` the per-POU pipeline and the source path, `project/` the input assembly,
 * `diagnostics/` the refusal registry, `core/` the frame and the shared builders, `values/` literals, folds and
 * conversions, `storage/` layouts and declarations, `init/` the init step, `places/` where a name lives, `pointers/`
 * POINTER and REFERENCE, `expressions/`, `builtins/`, `statements/`, `calls/` and `interfaces/`.
 */
export { lowerUnit } from "./entry/lower-unit.js"
export { lowerPrepared, lowerSource } from "./entry/lower-source.js"
// `LoweringProject` beyond design.md §2.1.1's row: the corpus gate binds its projects through it (`test/corpus/support`)
export { prepareProject, type LibraryFile, type LoweringProject, type ParsedFile } from "./project/prepare.js"
export { libraryBase, type LibraryBase } from "./project/library-base.js"
/** The global `TIME()` reads — what a harness sets before a scan. */
export { CLOCK } from "./builtins/clock.js"
/** What lowering answers with, and the refusal registry (`kind`: "is this my bug or yours?"). */
export { LOWER_CODES, LOWER_CODE_PREFIXES, lowerCodeKind } from "./diagnostics/codes.js"
export type { LowerDiagnostic, LoweredPou } from "./diagnostics/diagnostic.js"
