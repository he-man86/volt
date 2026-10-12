/**
 * Pragma conformance test catalog.
 *
 * Each entry is a small, self-contained TwinCAT-pushable POU that
 * exercises ONE documented pragma. Used by:
 *   - `lsp-replay.test.ts` — replays the committed build recording, runs
 *     LSP diagnostics on each `source`, compares the two sides
 *   - `scripts/record-language.ts` — pushes each `source` through a live
 *     bridge, builds it, and records the compiler's diagnostics into
 *     `recordings/<vendor>.build.json`
 *
 * Catalog principles:
 * - Self-contained: every test is a single FB / GVL with the
 *   prefix `FB_LANG_` / `GVL_LANG_` (cleanup-friendly).
 * - One pragma per test: keeps disagreement attribution unambiguous.
 * - Mix of POSITIVE (`expectTcAccepts: true`) and NEGATIVE
 *   (`expectTcAccepts: false`) — both LSP false-positive and
 *   LSP-missed bugs need coverage.
 * - `fromDoc` points at the section of the reference doc the test
 *   came from, so a doc edit (rule clarification) can be traced
 *   to the test cases that need updating.
 */
import type { LanguageTest } from "../../types.js"
import { PRAGMA_TESTS_A } from "./pragma-a.js"
import { PRAGMA_TESTS_B } from "./pragma-b.js"
import { PRAGMA_TESTS_C } from "./pragma-c.js"

export const PRAGMA_TESTS: readonly LanguageTest[] = [...PRAGMA_TESTS_A, ...PRAGMA_TESTS_B, ...PRAGMA_TESTS_C]
