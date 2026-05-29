/**
 * Combined language conformance test catalog.
 *
 * Catalogs are split per docs section for clarity, then merged here
 * so the recorder + replay test see a single ALL_TESTS array.
 * Adding a new category: write `<category>-tests.ts`, import + spread
 * here.
 */
import { PRAGMA_TESTS } from "./pragma-tests.js";
import { LIFECYCLE_TESTS } from "./lifecycle-tests.js";
import { IDENTIFIER_TESTS } from "./identifier-tests.js";
import { INIT_SLOT_TESTS } from "./init-slot-tests.js";
import { SHADOWING_TESTS } from "./shadowing-tests.js";
import { CONVERSION_TESTS } from "./conversion-tests.js";
import { SEMANTIC_TESTS } from "./semantic-tests.js";
import { CONDITIONAL_PRAGMA_TESTS } from "./conditional-pragma-tests.js";
import { OPERATOR_TESTS } from "./operator-tests.js";
// LITERAL_TESTS catalog exists but is NOT registered yet — needs a
// fresh recording against a live bridge once the TC crash situation
// is fully stable. Re-enable by re-adding to the spread below and
// running `bun run record:language`. See literal-tests.ts header.
// import { LITERAL_TESTS } from "./literal-tests.js";

export type { LanguageTest } from "./pragma-tests.js";

export const ALL_TESTS = [
	...PRAGMA_TESTS,
	...LIFECYCLE_TESTS,
	...IDENTIFIER_TESTS,
	...INIT_SLOT_TESTS,
	...SHADOWING_TESTS,
	...CONVERSION_TESTS,
	...SEMANTIC_TESTS,
	...CONDITIONAL_PRAGMA_TESTS,
	...OPERATOR_TESTS,
];
