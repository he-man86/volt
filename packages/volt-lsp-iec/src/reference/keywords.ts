/**
 * CODESYS reserved keywords. Source: `docs/codesys-reference/10-keywords.md`.
 *
 * Keywords are case-insensitive at the lexer but MUST be uppercase at the
 * source level per CODESYS docs ("In all editors, you must capitalize
 * keywords"). Identifiers may not match a keyword.
 *
 * This module is a **catalog with hover content** — the lexer's
 * `ALL_KEYWORDS` (in `src/lexer/tokens.ts:172`) is the authoritative
 * tokenization list. Anything in `ALL_KEYWORDS` should also have an
 * entry here so hover can describe it.
 *
 * Categories are encoded in `category` for grouping in completion.
 */

import type { ReferenceEntry } from "./index.js";

const SOURCE = {
	url: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_keywords.html",
	localFile: "docs/codesys-reference/10-keywords.md",
	retrievedAt: "2026-05-26",
};

type KeywordCategory =
	| "var-section"
	| "var-modifier"
	| "pou-structure"
	| "st-statement"
	| "operator-word"
	| "type-conversion-word"
	| "data-type"
	| "system-operator"
	| "export-format"
	| "other";

function kw(name: string, category: KeywordCategory, oneLiner: string, opts?: {
	details?: string;
	gotchas?: string[];
}): ReferenceEntry {
	// Every keyword in this module is shared between CODESYS and
	// TwinCAT (IEC 61131-3 core + V3-era extensions inherited by both).
	return {
		name,
		kind: "keyword",
		source: SOURCE,
		vendor: "shared",
		oneLiner,
		details: opts?.details,
		gotchas: opts?.gotchas,
	};
}

const ENTRIES: ReferenceEntry[] = [
	// Variable sections
	kw("VAR", "var-section", "Local variable section. Closes with END_VAR."),
	kw("END_VAR", "var-section", "Closes any VAR_* section."),
	kw("VAR_INPUT", "var-section", "FB/function/method input parameters (pass-by-value)."),
	kw("VAR_OUTPUT", "var-section", "FB/function/method output parameters. Functions/methods require `=>` at call site."),
	kw("VAR_IN_OUT", "var-section", "Pass-by-reference parameter. Cannot pass literals, constants, or bit variables.", {
		gotchas: ["Cannot be read/written externally via fb.varName — call-site only."],
	}),
	kw("VAR_GLOBAL", "var-section", "Application-wide global variable. Use `.name` for global namespace lookup.", {
		gotchas: ["Local variable with the same name shadows the global within its POU."],
	}),
	kw("VAR_TEMP", "var-section", "Temporary local variable. Re-initialized on every POU call.", {
		gotchas: ["Only in programs and FBs (not functions). Conflicts with {attribute 'subsequent'}."],
	}),
	kw("VAR_STAT", "var-section", "Static local variable (C-like). Initialized on download; retains value across calls."),
	kw("VAR_EXTERNAL", "var-section", "Imports a VAR_GLOBAL. IEC-compliance only — CODESYS doesn't require it.", {
		gotchas: ["Initialization not permitted."],
	}),
	kw("VAR_INST", "var-section", "Method instance variable. Stored in FB instance stack, not method call stack.", {
		gotchas: ["Only valid inside methods."],
	}),
	kw("VAR_CONFIG", "var-section", "Binds full I/O addresses to FB instance variables declared with incomplete addresses (`%I*`)."),
	kw("VAR_ACCESS", "var-section", "Reserved keyword for CODESYS export format."),
	kw("VAR_GENERIC", "var-section", "Generic-constant variant. Used in function templates."),

	// Modifiers
	kw("CONSTANT", "var-modifier", "Read-only; must have initial value at declaration."),
	kw("RETAIN", "var-modifier", "Variable stored in retain memory; survives warm-reset and download.", {
		gotchas: [
			"On a function-block variable, the ENTIRE FB instance lives in retain memory.",
			"No effect in functions — declaration is silently ignored.",
		],
	}),
	kw("PERSISTENT", "var-modifier", "Persistent memory; survives cold-reset and download. Canonical form: `VAR_GLOBAL PERSISTENT RETAIN`.", {
		gotchas: [
			"Bare PERSISTENT alone is forbidden inside an FB — must be PERSISTENT RETAIN.",
			"Avoid POINTER TO in persistent vars — addresses can change across downloads.",
		],
	}),
	kw("NON_RETAIN", "var-modifier", "Explicitly NOT retained — overrides cascading retain."),
	kw("AT", "var-modifier", "Binds a variable to a physical address: `name AT %IX0.0`."),

	// POU structure
	kw("PROGRAM", "pou-structure", "Top-level executable POU. One per task entry point."),
	kw("END_PROGRAM", "pou-structure", "Closes a PROGRAM block."),
	kw("FUNCTION", "pou-structure", "Stateless function. Returns one value; no persistent state."),
	kw("END_FUNCTION", "pou-structure", "Closes a FUNCTION block."),
	kw("FUNCTION_BLOCK", "pou-structure", "Stateful instantiable unit. Can EXTENDS, IMPLEMENTS, and contain methods/actions/properties."),
	kw("END_FUNCTION_BLOCK", "pou-structure", "Closes a FUNCTION_BLOCK."),
	kw("METHOD", "pou-structure", "Member function of an FB. Supports access modifiers (PUBLIC/PRIVATE/...)."),
	kw("END_METHOD", "pou-structure", "Closes a METHOD."),
	kw("ACTION", "pou-structure", "Member action of an FB. Reusable code block, callable like a method but no parameters."),
	kw("END_ACTION", "pou-structure", "Closes an ACTION."),
	kw("PROPERTY", "pou-structure", "FB member with GET/SET accessors. Looks like a field at the call site."),
	kw("END_PROPERTY", "pou-structure", "Closes a PROPERTY."),
	kw("GET", "pou-structure", "Property getter accessor."),
	kw("SET", "pou-structure", "Property setter accessor."),
	kw("INTERFACE", "pou-structure", "Contract type. FBs declare conformance via IMPLEMENTS."),
	kw("END_INTERFACE", "pou-structure", "Closes an INTERFACE."),
	kw("NAMESPACE", "pou-structure", "Logical grouping of POUs."),
	kw("END_NAMESPACE", "pou-structure", "Closes a NAMESPACE."),
	kw("TYPE", "pou-structure", "DUT (Data Unit Type) declaration. Encloses STRUCT/ENUM/UNION/ALIAS bodies."),
	kw("END_TYPE", "pou-structure", "Closes a TYPE."),
	kw("STRUCT", "pou-structure", "User-defined composite type with named fields."),
	kw("END_STRUCT", "pou-structure", "Closes a STRUCT."),
	kw("UNION", "pou-structure", "All members share the same memory. Size = largest member."),
	kw("END_UNION", "pou-structure", "Closes a UNION."),
	kw("EXTENDS", "pou-structure", "Single-base inheritance for FBs / interfaces / STRUCTs."),
	kw("IMPLEMENTS", "pou-structure", "FB declares conformance to one or more interfaces."),
	kw("ABSTRACT", "pou-structure", "Marks an FB or method as not directly instantiable / callable."),
	kw("FINAL", "pou-structure", "Marks a method as not-overridable, or an FB as not-extendable."),
	kw("PUBLIC", "pou-structure", "Access modifier: visible to all."),
	kw("PRIVATE", "pou-structure", "Access modifier: visible only inside the declaring FB."),
	kw("PROTECTED", "pou-structure", "Access modifier: visible to declaring FB + derived FBs."),
	kw("INTERNAL", "pou-structure", "Access modifier: visible within the same namespace/library."),
	kw("THIS", "pou-structure", "Pointer to the current FB instance. Use `THIS^.field` to disambiguate.", {
		gotchas: ["Not implemented in IL."],
	}),
	kw("SUPER", "pou-structure", "Pointer to the base FB instance (for EXTENDS chains). Use `SUPER^.method()`.", {
		gotchas: ["Not implemented in IL."],
	}),

	// ST statements
	kw("IF", "st-statement", "Conditional branch. `IF cond THEN ... [ELSIF ...] [ELSE ...] END_IF`."),
	kw("THEN", "st-statement", "Part of IF / ELSIF."),
	kw("ELSIF", "st-statement", "Additional branch in an IF chain."),
	kw("ELSE", "st-statement", "Default branch of IF or CASE."),
	kw("END_IF", "st-statement", "Closes an IF block."),
	kw("CASE", "st-statement", "Multi-way branch on integer/enum value. `CASE expr OF v1: ... vn: ... [ELSE ...] END_CASE`."),
	kw("OF", "st-statement", "Part of CASE syntax."),
	kw("END_CASE", "st-statement", "Closes a CASE block."),
	kw("FOR", "st-statement", "Counted loop. `FOR i := s TO e [BY step] DO ... END_FOR`."),
	kw("TO", "st-statement", "Part of FOR loop."),
	kw("BY", "st-statement", "Step value in FOR loop."),
	kw("DO", "st-statement", "Part of FOR/WHILE syntax."),
	kw("END_FOR", "st-statement", "Closes a FOR loop."),
	kw("WHILE", "st-statement", "Pre-test loop. `WHILE cond DO ... END_WHILE`."),
	kw("END_WHILE", "st-statement", "Closes a WHILE loop."),
	kw("REPEAT", "st-statement", "Post-test loop. `REPEAT ... UNTIL cond END_REPEAT`."),
	kw("UNTIL", "st-statement", "Post-condition of REPEAT."),
	kw("END_REPEAT", "st-statement", "Closes a REPEAT loop."),
	kw("RETURN", "st-statement", "Return from the current POU."),
	kw("JMP", "st-statement", "Jump to a labeled statement."),
	kw("EXIT", "st-statement", "Break out of the innermost loop."),
	kw("CONTINUE", "st-statement", "Skip to next loop iteration. ExST extension."),

	// Operator-form keywords
	kw("AND", "operator-word", "Boolean AND. NOT short-circuit (use AND_THEN for short-circuit)."),
	kw("OR", "operator-word", "Boolean OR. NOT short-circuit (use OR_ELSE for short-circuit)."),
	kw("NOT", "operator-word", "Boolean / bitwise complement."),
	kw("XOR", "operator-word", "Boolean / bitwise exclusive OR."),
	kw("AND_THEN", "operator-word", "Short-circuit AND (ExST). Use to guard pointer derefs."),
	kw("OR_ELSE", "operator-word", "Short-circuit OR (ExST)."),
	kw("MOD", "operator-word", "Integer modulo."),
	kw("DIV", "operator-word", "Integer division (operator word; the `/` symbol also divides)."),

	// Export-format keywords
	kw("READ_ONLY", "export-format", "Access modifier in CODESYS export format."),
	kw("READ_WRITE", "export-format", "Access modifier in CODESYS export format."),
	kw("PARAMS", "export-format", "Part of CODESYS export format."),
];

export const KEYWORDS = new Map<string, ReferenceEntry>(
	ENTRIES.map((e) => [e.name.toLowerCase(), e]),
);

// Also expose alternative-spelling lookups.
for (const e of ENTRIES) {
	if (e.aliases !== undefined) {
		for (const alias of e.aliases) {
			KEYWORDS.set(alias.toLowerCase(), e);
		}
	}
}
