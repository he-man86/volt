/**
 * the front-end's rules, area by area (`rules.ts`) — part F.
 *
 * One slice of `rules.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a test support
 * file is held to 400 lines).
 */

import { Rule } from "./rules-shared.js"

export const RULES_F: readonly Rule[] = [
  {
    id: "E26",
    area: 2,
    section: "2.5",
    rule: "inline assignment as an IF/WHILE/REPEAT condition",
    home: "parse/statements",
    gap: false,
    fixtures: [
      "expr_inline_assign_if_condition",
      "expr_inline_assign_elsif_condition",
      "expr_inline_assign_while_condition",
      "expr_inline_assign_repeat_condition",
      "expr_inline_assign_case_selector",
      "expr_inline_assign_for_bound",
      "expr_inline_assign_for_start",
      "expr_inline_assign_index",
      "expr_inline_assign_operand",
    ],
    design: "**GAP**",
    tests: [
      {
        file: "src/frontend/syntax/parse/expression.test.ts",
        title:
          "an inline assignment stands unparenthesised wherever an expression is read: a CASE selector, a FOR bound, an index (expr_inline_assign_case_selector, _for_bound, _index, E26)",
      },
      {
        file: "src/frontend/syntax/parse/expression.test.ts",
        title: "an inline assignment as a FOR start value: `FOR i := m := 1 TO 3 DO` (expr_inline_assign_for_start, E26)",
      },
    ],
    recheck:
      "2.5.6: also a CASE selector, a FOR bound and an index (`parseAssignable`); a chain's inner target is ST4's. 2.5b review: and a FOR start value; a call's argument is not asked (`F(m := 1)` is a formal argument)",
  },
  {
    id: "E27",
    area: 2,
    section: "2.5",
    rule: "THIS / SUPER / `THIS^.x`",
    home: "parse/expression, identifier",
    gap: false,
    fixtures: [
      "xo3_override_calls_override",
      "xo_three_level_super_chain",
      "shadowing_method_local_shadows_fb_var",
      "expr_this_deref_member_in_body",
      "expr_this_member_without_deref",
      "expr_this_as_pointer",
      "expr_super_without_deref",
      "expr_super_deref_call",
      "expr_super_without_base",
      "expr_super_without_deref_without_base",
      "expr_this_in_function",
      "refuse_super_without_base",
    ],
    design: "xo3_override_calls_override, xo_three_level_super_chain, shadowing_method_local_shadows_fb_var",
    tests: [
      {
        file: "src/analysis/checks/flow/this-super-context.test.ts",
        title:
          "SUPER in a base-less function block: not allowed, and its call no call target as written (refuse_super_without_base, expr_super_without_base, E27)",
      },
      {
        file: "src/analysis/checks/flow/this-super-context.test.ts",
        title:
          "a member off THIS or SUPER without its `^`: no structured variable (expr_this_member_without_deref, expr_super_without_deref, E27)",
      },
      {
        file: "src/analysis/checks/flow/this-super-context.test.ts",
        title:
          "SUPER.Get() in a base-less function block: one call-target message, no structured-variable one (expr_super_without_deref_without_base, E27)",
      },
    ],
  },
  {
    id: "E28",
    area: 2,
    section: "2.5",
    rule: "keyword-named callee (ADR, SIZEOF, SEL, MUX, MIN, MAX, LIMIT…)",
    home: "parse/expression",
    gap: false,
    fixtures: [
      "lib_stu_length",
      "xo_reference_to_fb_call",
      "expr_trailing_comma_operator_call",
    ],
    design: "lib_stu_length, xo_reference_to_fb_call",
  },
  {
    id: "E29",
    area: 2,
    section: "2.5",
    rule: "`__POSITION` swallows the next token",
    home: "parse/expression, parse/statements",
    gap: false,
    fixtures: ["operand_position", "sysop_position_then_statement", "sysop_position_call_form"],
    design: "operand_position, sysop_position_then_statement, sysop_position_call_form",
  },
  {
    id: "E30",
    area: 2,
    section: "2.5",
    rule: "`__CURRENTTASK` refused in ST",
    home: "parse/expression",
    gap: false,
    fixtures: [
      "op_sys_currenttask",
      "sysop_currenttask_then_statement",
      "sysop_currenttask_call_form",
      "lex_keyword_assigned_sys_currenttask",
      "lex_keyword_before_name_sys_currenttask",
    ],
    design: "op_sys_currenttask, sysop_currenttask_then_statement, sysop_currenttask_call_form",
  },
  {
    id: "E31",
    area: 2,
    section: "2.5",
    rule: "IL operator call form `ADD()`/`GT()` refused",
    home: "parse/expression",
    gap: false,
    fixtures: [
      "operator_call_form_arithmetic",
      "operator_call_form_comparison",
      "operator_call_form_extensible",
      "expr_operator_call_form_mod",
      "expr_operator_call_form_and",
      "expr_operator_call_form_not",
      "expr_operator_call_form_lower_case",
    ],
    design: "operator_call_form_arithmetic, operator_call_form_comparison, operator_call_form_extensible",
    recheck: "2.5.5: moved from analysis refused-name into the parser (`NOT_AN_OPERAND` before `(`)",
  },
  {
    id: "E32",
    area: 2,
    section: "2.5",
    rule: "`eatName` accepts any keyword as a member name",
    home: "parse/expression",
    gap: false,
    fixtures: [
      "expr_member_named_keyword",
      "expr_member_named_operator_keyword",
      "expr_member_named_function_keyword",
      "expr_member_named_type_keyword",
      "expr_member_named_soft_keyword",
      "expr_member_named_keyword_beside_undefined",
    ],
    design: "**GAP**",
  },
  {
    id: "E33",
    area: 2,
    section: "2.5",
    rule: "the global-namespace operator: a leading dot `.ident` names the global (`08-identifiers.md`, `09-shadowing.md`; the parser has no primary for it)",
    home: "parse/expression + types/names",
    gap: false,
    fixtures: [
      "expr_global_namespace_dot",
      "expr_global_namespace_shadowed_local",
      "expr_global_namespace_assign_target",
      "expr_global_namespace_member",
      "expr_global_namespace_undefined",
      "expr_global_namespace_local_only",
      "expr_global_namespace_function_call",
      "expr_global_namespace_space",
      "expr_global_namespace_constant_target",
      "expr_global_namespace_ambiguous",
      "expr_global_namespace_ambiguous_bare",
      "expr_global_namespace_call_non_callable",
      "expr_global_namespace_variable_in_constant",
      "expr_global_namespace_array_bound",
      "expr_global_namespace_array_bound_index",
      "expr_global_namespace_qualified_bound",
      "expr_global_namespace_enum_bound",
      "sym_global_namespace_dot_skips_local",
    ],
    design: "**GAP**",
    tests: [
      {
        file: "src/frontend/syntax/parse/expression.test.ts",
        title:
          "a leading dot names the GLOBAL: `.g` is one global_expr, as an operand, an assignment target, a member base and a callee, a space after the dot allowed (expr_global_namespace_*, E33)",
      },
      {
        file: "src/analysis/checks/names/unresolved-identifier.test.ts",
        title: "`.g` resolves the GLOBAL past a local, and names no global as the vendors do (expr_global_namespace_*, E33)",
      },
      {
        file: "src/analysis/checks/names/unresolved-identifier.test.ts",
        title: "`.g` declared by two global lists names no global (expr_global_namespace_ambiguous, E33)",
      },
      {
        file: "src/services/navigation/references-type-positions.test.ts",
        title: "rename, references and definition see `.gv` (the global-namespace dot, E33)",
      },
    ],
    recheck:
      "2.5.6: the primary is `GlobalExpr` (`global_expr`), resolved in the project scope only (`lookupGlobal`: two lists declaring it is none); lowering refuses it. 2.5b review: the corpora's only form, `ARRAY[1...GVL.c]` / `[E.A...E.B]`, recorded",
  },
  {
    id: "E34",
    area: 2,
    section: "2.5",
    rule: "`__POOL.POU()` (the pool qualifier)",
    home: "parse/expression",
    gap: false,
    fixtures: [
      "expr_pool_qualified_call",
      "expr_pool_qualified_global",
      "expr_pool_qualified_fb_type",
      "lex_keyword_assigned_sys_pool",
      "lex_keyword_before_name_sys_pool",
      "lex_keyword_operand_sys_pool",
    ],
    design: "**GAP**",
    recheck: "2.5.6: a lookup in the POUs view, which the workspace does not model — every cell a niche divergence (0 `__POOL` in the corpora)",
  },
]
