/**
 * THE RECORDING PROJECTS' COMPILE ENVIRONMENT — what the conformance harness states about the projects the recordings
 * were made in, and only what a recording MEASURED (`syntax/pragmas/conditional` `CompileEnvironment`).
 *
 * The LSP holds no project's compile defines, so `defined (X)` of a name the body does not define is refused there by
 * name (a compile define of the application makes it TRUE). The recording projects' answer is measured: they set no
 * compile define. Run: `prag_if_in_expression_statement` (out = 21), `prag_define_case_insensitive` and
 * `prag_define_upper_case` (out = 2) read a name the body does not define as FALSE; build, both vendors:
 * `prag_else_twice`, `prag_elsif_after_else` and `prag_untaken_branch_syntax_error` read `defined (VOLT_NEVER_DEFINED)`
 * as FALSE, and `prag_project_defined_in_body` reads `project_defined (X)` FALSE on CODESYS (frontend-conformance 2.7.1,
 * 2026-10-02).
 *
 * THE TARGET IS STATED, and is 64-bit on both: the recordings name it themselves — `plat_xint_into_string` and
 * `ty_xint_twincat_width` are "Cannot convert type 'LINT' to type 'STRING'" on CODESYS (`CODESYS Control Win V3 x64`) and
 * on TwinCAT (`TwinCAT RT (x64)`), and a pointer is silent into an LWORD/ULINT and refused into a DWORD/UDINT on both
 * (`ty_pointer_size_twincat`; frontend-conformance 4.1.1, 2026-10-03). `scripts/check-recording.ts` refuses a recording
 * made on another target.
 *
 * The device and the task configuration are NOT stated: the build recordings measure neither for the analysis, so a
 * condition on them stays refused here as in the LSP (the transpiler states the exec oracle's,
 * `transpile/lower/conditions.ts`).
 */
import type { CompileEnvironment } from "../../../src/frontend/syntax/index.js"

export const RECORDING_ENVIRONMENT: CompileEnvironment = Object.freeze({
  project: Object.freeze({ defines: new Set<string>() }),
  target: Object.freeze({ pointerBits: 64 as const }),
})
