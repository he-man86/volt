/**
 * FB lifecycle conformance test catalog — FB_Init / FB_Reinit / FB_Exit.
 *
 * Source: 11-fb-lifecycle.md. The LSP has a `fbLifecycleSignature`
 * diagnostic that's supposed to catch signature mistakes here; these
 * tests measure whether it actually does (and whether TC agrees).
 *
 * Per the doc's "Diagnostic candidates":
 *   - FB_Init / FB_Reinit / FB_Exit with wrong return type → error
 *   - FB_Init missing bInitRetains + bInCopyCode → error/warning
 *   - FB_Exit missing bInCopyCode → error
 *   - FB_Reinit with parameters → questionable (doc says "no parameters")
 *
 * Same LanguageTest shape as pragmas — see `test/conformance/types.ts` (`LanguageTest`) for field docs.
 */
import type { LanguageTest } from "../../types.js"
import { LIFECYCLE_TESTS_A } from "./lifecycle-a.js"
import { LIFECYCLE_TESTS_B } from "./lifecycle-b.js"
import { LIFECYCLE_TESTS_C } from "./lifecycle-c.js"
import { LIFECYCLE_TESTS_D } from "./lifecycle-d.js"

export const LIFECYCLE_TESTS: readonly LanguageTest[] = [...LIFECYCLE_TESTS_A, ...LIFECYCLE_TESTS_B, ...LIFECYCLE_TESTS_C, ...LIFECYCLE_TESTS_D]
