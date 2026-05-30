/**
 * Combined language conformance test catalog.
 *
 * Catalogs are split per docs section for clarity. `CATEGORIES` is the
 * single source of truth — the recorder, replay test, and report all
 * read from it. Adding a new category: write `<category>-tests.ts`,
 * import + add one row below.
 */
import type { LanguageTest } from "./types.js";
import { PRAGMA_TESTS } from "./pragma-tests.js";
import { LIFECYCLE_TESTS } from "./lifecycle-tests.js";
import { IDENTIFIER_TESTS } from "./identifier-tests.js";
import { INIT_SLOT_TESTS } from "./init-slot-tests.js";
import { SHADOWING_TESTS } from "./shadowing-tests.js";
import { CONVERSION_TESTS } from "./conversion-tests.js";
import { SEMANTIC_TESTS } from "./semantic-tests.js";
import { CONDITIONAL_PRAGMA_TESTS } from "./conditional-pragma-tests.js";
import { OPERATOR_TESTS } from "./operator-tests.js";
import { LITERAL_TESTS } from "./literal-tests.js";
import { INTERFACE_TESTS } from "./interface-tests.js";
import { OOP_TESTS } from "./oop-tests.js";
import { ADVANCED_TYPE_TESTS } from "./advanced-type-tests.js";
import { DATA_TYPE_TESTS } from "./data-type-tests.js";
import { VARIABLE_SECTION_TESTS } from "./variable-section-tests.js";
import { KEYWORD_TESTS } from "./keyword-tests.js";
import { OPERANDS_TESTS } from "./operands-tests.js";
import { USAGE_PATTERN_TESTS } from "./usage-pattern-tests.js";

export type { LanguageTest } from "./types.js";

export interface CategoryGroup {
	name: string;
	tests: readonly LanguageTest[];
}

export const CATEGORIES: readonly CategoryGroup[] = [
	{ name: "pragma", tests: PRAGMA_TESTS },
	{ name: "lifecycle", tests: LIFECYCLE_TESTS },
	{ name: "identifier", tests: IDENTIFIER_TESTS },
	{ name: "init-slot", tests: INIT_SLOT_TESTS },
	{ name: "shadowing", tests: SHADOWING_TESTS },
	{ name: "conversion", tests: CONVERSION_TESTS },
	{ name: "semantic", tests: SEMANTIC_TESTS },
	{ name: "conditional-pragma", tests: CONDITIONAL_PRAGMA_TESTS },
	{ name: "operator", tests: OPERATOR_TESTS },
	{ name: "literal", tests: LITERAL_TESTS },
	{ name: "interface", tests: INTERFACE_TESTS },
	{ name: "oop", tests: OOP_TESTS },
	{ name: "advanced-type", tests: ADVANCED_TYPE_TESTS },
	{ name: "data-type", tests: DATA_TYPE_TESTS },
	{ name: "variable-section", tests: VARIABLE_SECTION_TESTS },
	{ name: "keyword", tests: KEYWORD_TESTS },
	{ name: "operands", tests: OPERANDS_TESTS },
	{ name: "usage-pattern", tests: USAGE_PATTERN_TESTS },
];

export const ALL_TESTS: readonly LanguageTest[] = CATEGORIES.flatMap((c) => c.tests);
