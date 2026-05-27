# 01 — Programming Languages and Editors

> **Source:** https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_struct_reference_programming_languages_and_editors.html
> **Retrieved:** 2026-05-26
> **CODESYS version:** V3.5.22.0

## Summary

CODESYS supports six IEC 61131-3 implementation languages, each with its own editor. The implementation language is fixed when a POU is created and cannot be changed afterward. Each POU's editor has two sub-windows: a **declaration editor** (top — textual or tabular form) and an **implementation editor** (bottom — language-specific).

This file focuses on Structured Text (ST) and Extended Structured Text (ExST), since plcassist-st-lsp targets ST. The other languages are catalogued for context.

## The six languages

| Lang | Family | Notes |
|---|---|---|
| **ST** (Structured Text) | Text | C-/Pascal-flavored. The most-used textual language. Our LSP targets this. |
| **ExST** (Extended ST) | Text | ST + CODESYS extensions: `S=` / `R=` / `REF=` assignments, assignment-as-expression, `CONTINUE`. Strict superset of IEC ST. |
| **IL** (Instruction List) | Text | Stack-based assembly-like. **Deprecated** in IEC 61131-3 third edition. Some `THIS`/`SUPER` features are NOT supported in IL. |
| **FBD** (Function Block Diagram) | Graphical | Block-and-wire data flow. Pragmas like `dataflow`, `pingroup`, `pin_presentation_order_*` affect display. |
| **LD** (Ladder Diagram) | Graphical | Relay-logic schematic style. Same pragma support as FBD. |
| **SFC** (Sequential Function Chart) | Graphical | State-machine notation. Step actions can be virtual; see `no_virtual_actions` pragma. |
| **CFC** (Continuous Function Chart) | Graphical | Free-form block diagram (non-IEC, CODESYS extension). Supports `ProcessValue` pragma. |

## Key ST-specific knowledge

### Assignment operators

| Operator | Form | Notes |
|---|---|---|
| `:=` | `target := expr;` | Standard assignment. Equivalent to `MOVE` operator. |
| `=>` | `<FB output> => <var>;` | Output assignment in FB calls. RHS may be blank (`FBcomp_Output2 => ;`). |
| `S=` | `var S= operand;` | **ExST only.** When operand transitions to TRUE, sets var to TRUE; var sticks. Both `BOOL`. |
| `R=` | `var R= operand;` | **ExST only.** When operand transitions to TRUE, resets var to FALSE; var sticks. Both `BOOL`. |
| `REF=` | `ref REF= target;` | **ExST only.** Creates a reference (`A REF= B` ≡ `A := ADR(B)`). Used with `REFERENCE TO` variables. |

**Critical quirk — multi-assignment evaluation:** In chained assignments like `xSet S= xReset R= funCompute(...)`, the assignments do **NOT** evaluate right-to-left. **All assignments operate against the operand at the end of the line.** So `xReset R= funCompute(...)` and `xSet S= funCompute(...)` — `xSet` does NOT take its value from `xReset`. Easy bug source.

**ExST-only feature: assignments as expressions:**
```st
int_var1 := int_var2 := int_var3 + 9;     (* both vars get value *)
IF b := (i = 1) THEN i := i + 1; END_IF   (* assignment in condition *)
int_var := real_var := int_var;            (* ERROR: data type mismatch *)
```

### ST expressions

An expression evaluates to a value. Operands: constant, variable, function call, or another expression. Special forms:
- Array element access: `arr[i]`
- Struct member access: `s.field`
- FB/program instance member access: `fbInstance.var`
- Method call: `fb.Method(args)`

**Operator precedence** (strongest binding → weakest):
1. `( ... )` — parenthesis
2. `<function>(args)` — function call; all operators with parenthesized syntax
3. `EXPT` — exponentiation
4. `-` (unary negate), `NOT`
5. `*`, `/`, `MOD`
6. `+`, `-`
7. `<`, `>`, `<=`, `>=`
8. `=`, `<>`
9. `AND`, `AND_THEN`
10. `XOR`
11. `OR`, `OR_ELSE`

Equal-precedence operators evaluate **left-to-right**.

### ST statements

Catalog from `_cds_st_f_instructions.html`. Each links to a sub-page on the CODESYS site.

| Statement | URL fragment | Notes |
|---|---|---|
| `IF` ... `THEN` ... [`ELSIF`] [`ELSE`] `END_IF` | `_cds_st_instruction_if.html` | |
| `CASE <expr> OF <values>: ... [ELSE ...] END_CASE` | `_cds_st_instruction_case.html` | |
| `FOR <var> := <start> TO <end> [BY <step>] DO ... END_FOR` | `_cds_st_instruction_for.html` | |
| `WHILE <cond> DO ... END_WHILE` | `_cds_st_instruction_while.html` | |
| `REPEAT ... UNTIL <cond> END_REPEAT` | `_cds_st_instruction_repeat.html` | |
| `RETURN` | `_cds_st_instruction_return.html` | Returns from POU |
| `JMP <label>` | `_cds_st_instruction_jmp.html` | Jump to labeled statement |
| `EXIT` | `_cds_st_instruction_exit.html` | Break out of innermost loop |
| `CONTINUE` | `_cds_exst_instruction_continue.html` | **ExST only** — skip to next loop iteration |
| FB call | `_cds_st_fb_call.html` | `fbInst(in1 := a, in2 := b, out1 => c);` |
| Comments | `_cds_st_comment.html` | `(* block *)`, `// line` (ExST) |

### `THIS` and `SUPER` pointers

Special variables for object-oriented FB programming.

**`THIS`** — pointer to the current FB instance. Always implicitly available inside method/FB code.
- Dereference: `THIS^`
- Use to disambiguate FB member from local: `THIS^.iVarB := 222;` when a local `iVarB` exists in a method.
- Use to pass own instance to a function: `funA(pFB := THIS^);`
- **Not implemented in IL.**

**`SUPER`** — pointer to the base FB instance of an `EXTENDS`-derived FB.
- Dereference: `SUPER^`
- Use to call base-class methods: `SUPER^.METH_DoIt();`
- Use to read inherited fields: `iBase := SUPER^.iCnt;`
- **Not implemented in IL.**

```st
FUNCTION_BLOCK FB_Base
VAR_OUTPUT iCnt : INT; END_VAR
METHOD METH_DoIt : BOOL
    iCnt := -1;

FUNCTION_BLOCK FB_1 EXTENDS FB_Base
    THIS^.METH_DoIt();    (* calls FB_1's override *)
    SUPER^.METH_DoIt();   (* calls FB_Base.METH_DoIt *)
END_FUNCTION_BLOCK
```

## Sub-page catalog

Total: 24 pages.

| Sub-section | URL fragment |
|---|---|
| Declaration Editor | `_cds_edt_declaration_editor.html` |
| Common Functions in Graphical Editors | `_cds_common_functionalities_in_grafic_editors.html` |
| Structured Text and Extended Structured Text | `_cds_st_f_language.html` |
| ST Editor | `_cds_edt_st_editor.html` |
| ST Editor in Online Mode | `_cds_st_editor_in_online_mode.html` |
| ST Expressions | `_cds_st_expressions.html` |
| Assignments (overview) | `_cds_st_f_assignments.html` |
| ST Assignment Operator (`:=`) | `_cds_st_operator_assignment.html` |
| ST Assignment Operator for Outputs (`=>`) | `_cds_st_operator_output_assignment.html` |
| ExST Assignment: `S=` | `_cds_exst_operator_s.html` |
| ExST Assignment: `R=` | `_cds_exst_operator_r.html` |
| ExST Assignment as an Expression | `_cds_exst_operator_expression.html` |
| Assignment Operator: `REF=` | `_cds_ref_assignment.html` |
| Statements (overview) | `_cds_st_f_instructions.html` |
| `IF` | `_cds_st_instruction_if.html` |
| `FOR` | `_cds_st_instruction_for.html` |
| `CASE` | `_cds_st_instruction_case.html` |
| `WHILE` | `_cds_st_instruction_while.html` |
| `REPEAT` | `_cds_st_instruction_repeat.html` |
| `RETURN` | `_cds_st_instruction_return.html` |
| `JMP` | `_cds_st_instruction_jmp.html` |
| `EXIT` | `_cds_st_instruction_exit.html` |
| `CONTINUE` | `_cds_exst_instruction_continue.html` |
| ST Function Block Call | `_cds_st_fb_call.html` |
| ST Comments | `_cds_st_comment.html` |

## Notes for tooling

**Already implemented in lexer/parser:**
- `:=`, `=>`, `REF=`, comments — confirmed in `src/lexer/`
- All ST statements (`IF`/`CASE`/`FOR`/`WHILE`/`REPEAT`) — confirmed in `src/parser/`
- `THIS`, `SUPER` — keywords in `ALL_KEYWORDS`

**Confirm during Stage 5:**
- `S=` and `R=` ExST assignments — may or may not be in lexer
- `CONTINUE` — ExST-only; check lexer support
- Assignment-as-expression — parser may currently reject this as an error

**Diagnostic candidates (Stage 5):**
- Multi-assignment chains with `S=` / `R=` mixed → warning (evaluation order trap)
- `S=`/`R=`/`REF=` outside ExST context → if we ever distinguish strict IEC vs ExST modes (probably not worth it)

**Hover augmentation:**
- Hovering on `THIS` / `SUPER` shows their semantics
- Hovering on `S=` / `R=` / `REF=` shows the evaluation-order quirk
