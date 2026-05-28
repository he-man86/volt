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
];
