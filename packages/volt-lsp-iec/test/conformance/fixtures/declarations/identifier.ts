/**
 * Identifier-rules conformance tests.
 *
 * Source: 08-identifiers.md. The LSP has three dedicated checks:
 *   - reservedKeyword: identifier matches a CODESYS reserved keyword
 *   - doubleUnderscore: identifier starts with `__` (system-reserved)
 *   - consecutiveUnderscores: identifier contains `__` anywhere
 *
 * Each test pushes an FB that uses a non-conforming identifier in a
 * VAR section. TC and LSP responses are compared.
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "../../types.js"

export const IDENTIFIER_TESTS: readonly LanguageTest[] = [
  // ========================================================================
  // Category: 08-identifiers.md — identifier-rules checks
  // ========================================================================

  {
    name: "identifier_double_underscore",
    pouName: "FB_LANG_identifier_double_underscore",
    kind: "function_block",
    feature: "Identifier prefixed with __ (system-reserved per docs)",
    fromDoc: "08-identifiers.md#hard-rules",
    note: "DISCOVERY: TC enforces this strictly — errors out the build with multiple diagnostics. Catalog initially assumed silent acceptance; conformance run corrected the expectation. Marked recordIsolated: this test produces PARSE errors that, in mega-batch, would block semantic analysis on OTHER tests (their errors silently disappear from the pane).",
    plcPrgVar: "fb_du : FB_LANG_identifier_double_underscore;",
    plcPrgBody: "fb_du();",
    source: `FUNCTION_BLOCK FB_LANG_identifier_double_underscore
VAR
	__systemReserved : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },

  {
    name: "identifier_consecutive_underscores",
    pouName: "FB_LANG_identifier_consecutive_underscores",
    kind: "function_block",
    feature: "Identifier with __ in the middle (consecutive underscores)",
    fromDoc: "08-identifiers.md#hard-rules",
    note: "DISCOVERY: TC enforces docs §2 strictly — errors out. Same recordIsolated reason as the double-underscore test: parse errors here would short-circuit TC semantic analysis on the rest of the batch.",
    plcPrgVar: "fb_cu : FB_LANG_identifier_consecutive_underscores;",
    plcPrgBody: "fb_cu();",
    source: `FUNCTION_BLOCK FB_LANG_identifier_consecutive_underscores
VAR
	foo__bar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },

  // ─── Note: identifier_reserved_keyword removed for v1 ─────────────
  // Using a keyword as a variable name (e.g., `INT : BOOL;`) is
  // rejected by the lexer/parser BEFORE the semantic-diagnostic
  // layer runs, so we can't push it via volt push — it'd fail
  // validation in record-language. The LSP reservedKeyword check
  // catches a related case: when an identifier-shaped token (not a
  // keyword) happens to match a reserved word post-lexing. Test
  // that case needs a more contrived source.

  {
    name: "identifier_backtick_keyword_escape",
    pouName: "FB_LANG_backtick_ident",
    kind: "function_block",
    feature: "Backtick-escaped identifier using a CODESYS keyword — CODESYS extension; TC behavior recorded",
    fromDoc: "08-identifiers.md#backtick-identifiers",
    note: "Backtick-quoted identifiers let CODESYS code use keywords as names. TC support is platform-dependent — catalog records actual behavior. Source uses string concatenation to avoid escaping nightmares in this TS file.",
    plcPrgVar: "fb_bi : FB_LANG_backtick_ident;",
    plcPrgBody: "fb_bi.Apply();",
    source:
      "FUNCTION_BLOCK FB_LANG_backtick_ident\n" +
      "VAR\n" +
      "\t`TYPE` : INT;\n" +
      "END_VAR\n" +
      "\n" +
      "END_FUNCTION_BLOCK\n" +
      "\n" +
      "METHOD Apply\n" +
      "`TYPE` := 1;\n" +
      "END_METHOD\n",
  },
  // ─── HOW DOES CODESYS SPELL THE TOKEN IT ECHOES? ───────────────────────────────────────────────────
  // Two dated live confirmations disagree, and the rule between them decides our wording for every
  // `Unexpected token 'x' found`:
  //
  //   `Limit : INT;`  -> `Unexpected token 'LIMIT' found`   UPPERCASED   (cursor.ts, confirmed 2026-09-03)
  //   `lt : BOOL;`    -> `Unexpected token 'lt' found`      AS WRITTEN   (string_compare_operators, 2026-09-18)
  //
  // Both are in the tree; neither is wrong on its face. The plausible reading is that a standard FUNCTION name is
  // echoed canonically while an IL operator is echoed as typed — but that is a guess, and printing the wrong one
  // makes every such message disagree on wording alone. Changing `describeToken` to echo the source text was tried
  // and reverted: it fixed `lt` and broke `LIMIT`, which is a trade, not an answer.
  //
  // These ask directly, with the SAME word in three spellings, so the answer cannot be read two ways.
  {
    name: "echo_mixed_case_function_name",
    refused: "Unexpected token 'Limit' found",
    pouName: "FB_LANG_echo_mixed_case_function_name",
    kind: "function_block" as const,
    feature: "a standard FUNCTION name as a variable, written MIXED case — is it echoed as typed or canonicalised?",
    fromDoc: "08-identifiers.md",
    plcPrgVar: "inst_echo_mixed_case_function_name : FB_LANG_echo_mixed_case_function_name;",
    plcPrgBody: "inst_echo_mixed_case_function_name();",
    source: "FUNCTION_BLOCK FB_LANG_echo_mixed_case_function_name\nVAR\n\tLimit : INT;\n\tok : BOOL;\nEND_VAR\nok := TRUE;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "echo_lower_case_function_name",
    refused: "Unexpected token 'limit' found",
    pouName: "FB_LANG_echo_lower_case_function_name",
    kind: "function_block" as const,
    feature: "the same name in lower case — the control for echo_mixed_case_function_name",
    fromDoc: "08-identifiers.md",
    plcPrgVar: "inst_echo_lower_case_function_name : FB_LANG_echo_lower_case_function_name;",
    plcPrgBody: "inst_echo_lower_case_function_name();",
    source: "FUNCTION_BLOCK FB_LANG_echo_lower_case_function_name\nVAR\n\tlimit : INT;\n\tok : BOOL;\nEND_VAR\nok := TRUE;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "echo_upper_case_il_operator",
    refused: "Unexpected token 'LT' found",
    pouName: "FB_LANG_echo_upper_case_il_operator",
    kind: "function_block" as const,
    feature: "an IL operator as a variable in UPPER case — the mirror of the lower-case `lt` already recorded",
    fromDoc: "08-identifiers.md",
    plcPrgVar: "inst_echo_upper_case_il_operator : FB_LANG_echo_upper_case_il_operator;",
    plcPrgBody: "inst_echo_upper_case_il_operator();",
    source: "FUNCTION_BLOCK FB_LANG_echo_upper_case_il_operator\nVAR\n\tLT : BOOL;\n\tok : BOOL;\nEND_VAR\nok := TRUE;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "echo_mixed_case_il_operator",
    refused: "Unexpected token 'Lt' found",
    pouName: "FB_LANG_echo_mixed_case_il_operator",
    kind: "function_block" as const,
    feature: "an IL operator in MIXED case — the case that separates as-typed from canonical",
    fromDoc: "08-identifiers.md",
    plcPrgVar: "inst_echo_mixed_case_il_operator : FB_LANG_echo_mixed_case_il_operator;",
    plcPrgBody: "inst_echo_mixed_case_il_operator();",
    source: "FUNCTION_BLOCK FB_LANG_echo_mixed_case_il_operator\nVAR\n\tLt : BOOL;\n\tok : BOOL;\nEND_VAR\nok := TRUE;\nEND_FUNCTION_BLOCK\n",
  },
]
