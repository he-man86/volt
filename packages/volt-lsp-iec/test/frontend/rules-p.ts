/**
 * the front-end's rules, area by area (`rules.ts`) — part P: 4.7.
 *
 * One slice of `rules.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a test support
 * file is held to 400 lines).
 */

import { Rule } from "./rules-shared.js"

export const RULES_P: readonly Rule[] = [
  // ── 4.7 ──
  {
    id: "DT1",
    area: 4,
    section: "4.7",
    rule: "an alias resolves in its own file",
    home: "resolve",
    gap: false,
    fixtures: ["types/corpus-types.ts", "types/data-type.ts", "dt_alias_type_name", "dt_alias_narrowing_name", "dt_alias_struct_and_array_values"],
    design: "types/corpus-types.ts, types/data-type.ts",
    recheck:
      "4.7.4 (2026-10-03): a variable of an alias, and of an alias of one, is named as the type the alias resolves to ('INT', both vendors), its narrowing too; an alias of a STRUCT and of an ARRAY is read through (5, 7); an alias's own bounds and lengths resolve in the project its file sees (`test/frontend/dumps.ts` `sites`)."
  },
  {
    id: "DT2",
    area: 4,
    section: "4.7",
    rule: "an alias with an initializer",
    home: "resolve + const",
    gap: false,
    fixtures: ["type_dut_alias_with_init", "dt_alias_of_alias_init", "dt_alias_init_*"],
    design: "type_dut_alias_with_init",
    recheck:
      "4.7.4 (2026-10-03): an alias's initializer is NOT inherited by an alias of it (`dt_alias_of_alias_init`: 42, 0, 7); both vendors check it as a store into the base as often as the alias is used — never unused, a refusal once, a warning once plus once per FB variable on CODESYS — which the LSP does not (`ALIAS_INITIALIZER_NOT_CHECKED`, niche: accepted loss, 0 aliases with an initializer in the corpora)."
  },
  {
    id: "DT3",
    area: 4,
    section: "4.7",
    rule: "subrange bounds check (outside the Type model today)",
    home: "type.ts subrange",
    gap: false,
    fixtures: ["subrange_init_*", "subrange_assign_const_out", "dt_subrange_*"],
    design: "subrange_init_*, subrange_assign_const_out",
    recheck:
      "4.7.1 (2026-10-03): the subrange is in the Type (`type` `subrange`, folded where declared): a variable of one is named `INT (0..10)`, an operation on one is its base, and the check reads the target's Type — a STRUCT member's too; CODESYS types a positive lower bound of an assignment target with the base (`UINT#1`).",
  },
  {
    id: "DT4",
    area: 4,
    section: "4.7",
    rule: "union typing (a union as a struct today)",
    home: "type.ts union",
    gap: false,
    fixtures: ["types/data-type.ts", "operators/operands.ts", "dt_union_*", "dt_sizeof_derived_type"],
    design: "types/data-type.ts, operators/operands.ts",
    recheck:
      "4.7.2 (2026-10-03): a union is a struct with `union` in the Type; SIZEOF of one is its largest member rounded to its most aligned (4, 5, 8), and SIZEOF of a STRUCT or UNION is a UINT where an elementary, enum, alias or array size is the smallest unsigned integer holding it.",
  },
  {
    id: "DT5",
    area: 4,
    section: "4.7",
    rule: "enum default value: zero if a member, else the first",
    home: "enums",
    gap: false,
    fixtures: ["type_enum_default_*", "type_enum_inline_default_first_nonzero"],
    design: "type_enum_default_*, type_enum_inline_default_first_nonzero",
  },
  {
    id: "DT6",
    area: 4,
    section: "4.7",
    rule: "enum storage base (resolve says INT only for a project enum without a base; transpile uses the written base)",
    home: "enums",
    gap: false,
    fixtures: ["dt_enum_base_byte_storage*", "dt_enum_plain_storage", "dt_enum_implicit_storage", "dt_library_enum_storage*"],
    design: "**GAP**",
    recheck:
      "4.7.3 (2026-10-03): an enum is stored as its written base, else an INT, an implicit one an INT (`enums` `enumStorage`; SIZEOF 1, 2, 2) — the base it converts as; a library enum's base is not materialized (`LIBRARY_ENUM_BASE_NOT_MATERIALIZED`).",
  },
  {
    id: "DT7",
    area: 4,
    section: "4.7",
    rule: "THIS types as the enclosing FB; `THIS^` is identity",
    home: "infer/member",
    gap: false,
    fixtures: ["calls/call-shapes.ts", "calls/fb-call.ts", "oop/*", "dt_this_type", "dt_this_into_pointer", "dt_super_type", "dt_this_deref_identity_values"],
    design: "calls/call-shapes.ts, calls/fb-call.ts, oop/*",
    recheck:
      "4.7.4 (2026-10-03): THIS is a POINTER TO the enclosing FB and SUPER one to its base, `^` the FB — each named upper-cased ('POINTER TO FB_LANG_DT_THIS_TYPE', both vendors; `infer/member` `thisType`, `superType`); THIS converts into any pointer silently; a base member written through THIS^ reads back through SUPER^ (9). The design row said THIS was the FB."
  },
  {
    id: "DT8",
    area: 4,
    section: "4.7",
    rule: 'a name that denotes a GVL/enum/POU/namespace is a static member base (namespace and interface typed "struct" today)',
    home: "infer/member",
    gap: false,
    fixtures: ["cross-object/*", "dt_static_base_*", "dt_namespace_static_base", "dt_interface_static_base", "dt_interface_static_member", "dt_fb_instance_type_name", "dt_interface_variable_type_name", "dt_function_name_in_own_body"],
    design: "cross-object/*",
    recheck:
      "4.7.4 (2026-10-03): a name that denotes a declaration is a static base, and read as a value it is refused, named upper-cased: a GVL's, a namespace's, a STRUCT type's, an INTERFACE's and an uncalled FUNCTION's name are a `StaticType` (`type`; they were a \"struct\", UNKNOWN and the return type), a PROGRAM's and an FB type's the POU (`infer/member` `staticScopeType`), an enum type's its enum; an FB or interface type name stored says it must be instantiated; an INSTANCE, an interface variable and an array are refused named as declared (`analysis/rules` `storeConversionError`); a FUNCTION's name inside its own body is its result, and called there has no result (`cc2_call_recursion`)."
  },
  {
    id: "DT9",
    area: 4,
    section: "4.7",
    rule: "an FB takes no positional arguments; a function/method does",
    home: "infer/callee",
    gap: false,
    fixtures: ["calls/call-grid.ts", "refuse_fb_called_positionally", "dt_program_called_positionally", "dt_interface_method_positional_values"],
    design: "calls/call-grid.ts, refuse_fb_called_positionally",
    recheck:
      "4.7.4 (2026-10-03): a PROGRAM takes no positional argument either (\"Assignment to input missing for parameter '5' in call of 'PRG_…'\", both vendors; `infer/callee` `takesNoPositionalArguments`); an interface's method takes them (42)."
  },
  {
    id: "DT10",
    area: 4,
    section: "4.7",
    rule: "render: TIME_OF_DAY spelling, `ARRAY [` with a space, STRING(n)",
    home: "render",
    gap: false,
    fixtures: ["cc_ltod_literal_into_tod", "cc_standard_len_wstring", "cc6_function_input_array_default", "dt_render_array_dims", "dt_render_string_capacity", "dt_render_date_time_names", "dt_render_pointer_names"],
    design: "cc_ltod_literal_into_tod, cc_standard_len_wstring, cc6_function_input_array_default",
    recheck:
      "4.7.4 (2026-10-03): 'ARRAY [1..2, 0..1] OF BYTE', 'ARRAY [0..1] OF STRING(5)', 'ARRAY [0..1] OF ARRAY [0..2] OF INT', 'STRING(5)' and a sizeless 'STRING', 'WSTRING(7)', 'DATE', 'TIME_OF_DAY', 'DATE_AND_TIME', 'TIME', 'LTIME', 'POINTER TO POINTER TO INT', 'POINTER TO ARRAY [0..1] OF REAL' — every one as `render` prints it, both vendors (an array into an elementary was unchecked)."
  },
  {
    id: "DT11",
    area: 4,
    section: "4.7",
    rule: "render: a string literal as `STRING(INT#len)`",
    home: "render (compiler form)",
    gap: false,
    fixtures: ["cc_string_escape_literal_into_int", "operators/system-operands.ts", "dt_render_string_literal", "dt_render_string_constant"],
    design: "cc_string_escape_literal_into_int, operators/system-operands.ts",
    recheck:
      "4.7.4 (2026-10-03): 'STRING(INT#0)' for an empty literal, 'STRING(INT#3)' for `'a$$b'` (decoded), 'WSTRING(INT#4)' for a WSTRING literal; a STRING CONSTANT is its variable's type, 'STRING' (both vendors)."
  },
  {
    id: "DT12",
    area: 4,
    section: "4.7",
    rule: "POINTER TO / REFERENCE TO compatibility with each other and with the pointee",
    home: "compat",
    gap: false,
    fixtures: ["memory/*","cv_reference_to_pointer","cv_pointer_to_reference","cv_pointer_assigned_to_reference","cv_pointer_deref_to_reference_values","cv_pointer_to_other_pointee","cv_pointer_and_pointee","cv_reference_to_other_reference"],
    design: "memory/* (partial) — **GAP** for REFERENCE ↔ POINTER",
    recheck: "4.5.2 (2026-10-03): a reference converts as its target and is named as itself; a pointer into a reference is refused, REF= of a pointer too, a pointer to another pointee is silent.",
  },
  {
    id: "DT13",
    area: 4,
    section: "4.7",
    rule: "pointer arithmetic: POINTER ± integer, pointer − pointer",
    home: "arith/operators + compat",
    gap: false,
    fixtures: ["refuse_adr_difference","dt_pointer_plus_int","dt_pointer_difference","dt_pointer_arithmetic_values","dt_pointer_arithmetic_refused"],
    design: "refuse_adr_difference (the refused form only) — **GAP** for the accepted forms",
    recheck: "4.5.2 (2026-10-03): POINTER ± integer is the pointer, pointer − pointer a DWORD (`arith/operators` `pointerArithmeticType`); a pointer minus a REAL is refused.",
  },
  {
    id: "DT14",
    area: 4,
    section: "4.7",
    rule: "REFERENCE auto-dereference typing (a REFERENCE TO T reads as T) and the REF= type rules beyond LT10",
    home: "infer/member + compat",
    gap: false,
    fixtures: ["dt_reference_auto_deref_type","dt_reference_auto_deref_values","dt_reference_into_narrower","dt_ref_assign_wrong_type","dt_ref_assign_struct_mismatch"],
    design: "**GAP**",
    recheck: "4.5.2 (2026-10-03): a REFERENCE TO T reads as T in an operation and is named REFERENCE TO T bare; REF= takes a variable of exactly the target type (arrays too), an operation is the write-access refusal.",
  },
]
