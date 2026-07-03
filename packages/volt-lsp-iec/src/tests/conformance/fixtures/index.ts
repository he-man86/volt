/**
 * Conformance test catalog — single source of truth.
 *
 * Each per-topic file exports a `LanguageTest[]`. This file aggregates
 * them into `CATEGORIES` so the recorder, replay test, and report
 * iterate one list. Adding a new category: write `<name>.ts` here,
 * import + add one row to the `CATEGORIES` array below.
 */
import type { LanguageTest } from "../types.js";
import { ADVANCED_TYPE_TESTS } from "./advanced-type.js";
import { CONDITIONAL_PRAGMA_TESTS } from "./conditional-pragma.js";
import { CONVERSION_TESTS } from "./conversion.js";
import { DATA_TYPE_TESTS } from "./data-type.js";
import { IDENTIFIER_TESTS } from "./identifier.js";
import { INIT_SLOT_TESTS } from "./init-slot.js";
import { INTERFACE_TESTS } from "./interface.js";
import { KEYWORD_TESTS } from "./keyword.js";
import { LIFECYCLE_TESTS } from "./lifecycle.js";
import { LITERAL_TESTS } from "./literal.js";
import { OOP_TESTS } from "./oop.js";
import { OPERANDS_TESTS } from "./operands.js";
import { OPERATOR_TESTS } from "./operator.js";
import { PRAGMA_TESTS } from "./pragma.js";
import { SEMANTIC_TESTS } from "./semantic.js";
import { SHADOWING_TESTS } from "./shadowing.js";
import { USAGE_PATTERN_TESTS } from "./usage-pattern.js";
import { VARIABLE_SECTION_TESTS } from "./variable-section.js";

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
