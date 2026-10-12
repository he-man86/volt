/**
 * the fixtures of `pointer-model.ts` — part B: transpile-restructure 8.2, gate 8c (review of step 8c): the BOOL-byte flows and views the step did not record.
 *
 * One slice of `pointer-model.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { BOOL_VIEWS, BOOL_VIEW_OF, boolFlowOutBody, boolFlowOutVars, boolFlowQ, doc82 } from "./pointer-model-shared.js"

export const POINTER_MODEL_TESTS_B: readonly LanguageTest[] = [
  // ─── transpile-restructure 8.2, gate 8c (review of step 8c): the BOOL-byte flows and views the step did not record ───
  // Asked before a rule is written for them (the step lowered them silently, or did not refuse them): does the byte of a
  // BOOL set to 2 / 255 through a POINTER TO BYTE reach an FB's VAR_INPUT (call form and `inst.x :=`), a FUNCTION's
  // VAR_IN_OUT, MOVE's result and an ANY input's target; what does a POINTER TO BOOL read over a BYTE, a WORD, an ARRAY OF
  // BYTE; and does a POINTER TO BOOL copied into a POINTER TO BYTE (and back) build, and answer what the direct one does.
  {
    name: "bool_byte_flow_fb_input",
    pouName: "FB_MEM_bool_flow_in",
    kind: "function_block" as const,
    feature: "a BOOL whose byte is 2 / 255 (set through a POINTER TO BYTE) given to an FB's VAR_INPUT in the call: `= TRUE`, NOT and BOOL_TO_INT of the input there",
    fromDoc: doc82,
    plcPrgVar: "inst_bool_flow_in : FB_MEM_bool_flow_in;",
    plcPrgBody: "inst_bool_flow_in();",
    source:
      boolFlowQ("FB_MEM_bool_flow_in_q") +
      "FUNCTION_BLOCK FB_MEM_bool_flow_in\nVAR\n\tb2 : BOOL;\n\tb255 : BOOL;\n\tpb : POINTER TO BYTE;\n\tq2 : FB_MEM_bool_flow_in_q;\n\tq255 : FB_MEM_bool_flow_in_q;\n" +
      boolFlowOutVars +
      "END_VAR\npb := ADR(b2);\npb^ := 2;\npb := ADR(b255);\npb^ := 255;\nq2(x := b2);\nq255(x := b255);\n" +
      boolFlowOutBody +
      "END_FUNCTION_BLOCK\n",
  },
  {
    name: "bool_byte_flow_fb_field",
    pouName: "FB_MEM_bool_flow_field",
    kind: "function_block" as const,
    feature: "a BOOL whose byte is 2 / 255 stored into an FB instance's VAR_INPUT from outside (`inst.x := b`) before the call: `= TRUE`, NOT and BOOL_TO_INT of the input there",
    fromDoc: doc82,
    plcPrgVar: "inst_bool_flow_field : FB_MEM_bool_flow_field;",
    plcPrgBody: "inst_bool_flow_field();",
    source:
      boolFlowQ("FB_MEM_bool_flow_field_q") +
      "FUNCTION_BLOCK FB_MEM_bool_flow_field\nVAR\n\tb2 : BOOL;\n\tb255 : BOOL;\n\tpb : POINTER TO BYTE;\n\tq2 : FB_MEM_bool_flow_field_q;\n\tq255 : FB_MEM_bool_flow_field_q;\n" +
      boolFlowOutVars +
      "END_VAR\npb := ADR(b2);\npb^ := 2;\npb := ADR(b255);\npb^ := 255;\nq2.x := b2;\nq2();\nq255.x := b255;\nq255();\n" +
      boolFlowOutBody +
      "END_FUNCTION_BLOCK\n",
  },
  {
    name: "bool_byte_flow_inout",
    pouName: "FB_MEM_bool_flow_io",
    kind: "function_block" as const,
    feature: "a BOOL whose byte is 2 / 255 bound to a FUNCTION's VAR_IN_OUT BOOL: `= TRUE`, NOT and BOOL_TO_INT of the in-out there",
    fromDoc: doc82,
    plcPrgVar: "inst_bool_flow_io : FB_MEM_bool_flow_io;",
    plcPrgBody: "inst_bool_flow_io();",
    source:
      "FUNCTION F_MEM_bool_io_eq : BOOL\nVAR_IN_OUT\n\tx : BOOL;\nEND_VAR\nF_MEM_bool_io_eq := x = TRUE;\nEND_FUNCTION\n\n" +
      "FUNCTION F_MEM_bool_io_not : BOOL\nVAR_IN_OUT\n\tx : BOOL;\nEND_VAR\nF_MEM_bool_io_not := NOT x;\nEND_FUNCTION\n\n" +
      "FUNCTION F_MEM_bool_io_int : INT\nVAR_IN_OUT\n\tx : BOOL;\nEND_VAR\nF_MEM_bool_io_int := BOOL_TO_INT(x);\nEND_FUNCTION\n\n" +
      "FUNCTION_BLOCK FB_MEM_bool_flow_io\nVAR\n\tb2 : BOOL;\n\tb255 : BOOL;\n\tpb : POINTER TO BYTE;\n" +
      boolFlowOutVars +
      "END_VAR\npb := ADR(b2);\npb^ := 2;\npb := ADR(b255);\npb^ := 255;\n" +
      [2, 255].map((k) => `isT${k} := F_MEM_bool_io_eq(x := b${k});\nnx${k} := F_MEM_bool_io_not(x := b${k});\nxInt${k} := F_MEM_bool_io_int(x := b${k});\n`).join("") +
      "END_FUNCTION_BLOCK\n",
  },
  {
    name: "bool_byte_flow_move",
    pouName: "FB_MEM_bool_flow_move",
    kind: "function_block" as const,
    feature: "a BOOL whose byte is 2 / 255 through MOVE into a plain BOOL: `= TRUE`, NOT and BOOL_TO_INT of the result",
    fromDoc: doc82,
    plcPrgVar: "inst_bool_flow_move : FB_MEM_bool_flow_move;",
    plcPrgBody: "inst_bool_flow_move();",
    source:
      "FUNCTION_BLOCK FB_MEM_bool_flow_move\nVAR\n\tb2 : BOOL;\n\tb255 : BOOL;\n\tpb : POINTER TO BYTE;\n\tc2 : BOOL;\n\tc255 : BOOL;\n" +
      boolFlowOutVars +
      "END_VAR\npb := ADR(b2);\npb^ := 2;\npb := ADR(b255);\npb^ := 255;\n" +
      [2, 255].map((k) => `c${k} := MOVE(b${k});\nisT${k} := c${k} = TRUE;\nnx${k} := NOT c${k};\nxInt${k} := BOOL_TO_INT(c${k});\n`).join("") +
      "END_FUNCTION_BLOCK\n",
  },
  {
    name: "bool_byte_flow_any",
    pouName: "FB_MEM_bool_flow_any",
    kind: "function_block" as const,
    feature: "a plain BOOL given to a FUNCTION's ANY input, whose pValue writes the byte 2 / 255 as a POINTER TO BYTE: `= TRUE`, NOT and BOOL_TO_INT of the BOOL after the call",
    fromDoc: doc82,
    plcPrgVar: "inst_bool_flow_any : FB_MEM_bool_flow_any;",
    plcPrgBody: "inst_bool_flow_any();",
    source:
      "FUNCTION F_MEM_bool_any_set : BOOL\nVAR_INPUT\n\tv : ANY;\n\tk : BYTE;\nEND_VAR\nVAR\n\tp : POINTER TO BYTE;\nEND_VAR\np := v.pValue;\np^ := k;\nF_MEM_bool_any_set := TRUE;\nEND_FUNCTION\n\n" +
      "FUNCTION_BLOCK FB_MEM_bool_flow_any\nVAR\n\tb2 : BOOL;\n\tb255 : BOOL;\n\tok2 : BOOL;\n\tok255 : BOOL;\n" +
      boolFlowOutVars +
      "END_VAR\nok2 := F_MEM_bool_any_set(v := b2, k := 2);\nok255 := F_MEM_bool_any_set(v := b255, k := 255);\n" +
      [2, 255].map((k) => `isT${k} := b${k} = TRUE;\nnx${k} := NOT b${k};\nxInt${k} := BOOL_TO_INT(b${k});\n`).join("") +
      "END_FUNCTION_BLOCK\n",
  },
  {
    name: "bool_pointer_over_bytes",
    pouName: "FB_MEM_bool_view",
    kind: "function_block" as const,
    feature: "a POINTER TO BOOL over a BYTE 2 / 255, a WORD 16#0205 and an ARRAY OF BYTE [2, 0]: `= TRUE`, NOT, BOOL_TO_INT, IF of what it reads, and the byte a copy of it holds",
    fromDoc: doc82,
    plcPrgVar: "inst_bool_view : FB_MEM_bool_view;",
    plcPrgBody: "inst_bool_view();",
    source:
      "FUNCTION_BLOCK FB_MEM_bool_view\nVAR\n\ty2 : BYTE := 2;\n\ty255 : BYTE := 255;\n\tw : WORD := 16#0205;\n\tarr : ARRAY[0..1] OF BYTE := [2, 0];\n\tp : POINTER TO BOOL;\n\tpr : POINTER TO BYTE;\n" +
      BOOL_VIEWS.map((v) => `\tisT${v} : BOOL;\n\tnx${v} : BOOL;\n\txInt${v} : INT;\n\ttaken${v} : BOOL;\n\tc${v} : BOOL;\n\tcByte${v} : BYTE;\n`).join("") +
      "END_VAR\n" +
      BOOL_VIEWS.map(
        (v) =>
          `p := ADR(${BOOL_VIEW_OF[v]});\nisT${v} := p^ = TRUE;\nnx${v} := NOT p^;\nxInt${v} := BOOL_TO_INT(p^);\ntaken${v} := FALSE;\nIF p^ THEN\n\ttaken${v} := TRUE;\nEND_IF\n` +
          `c${v} := p^;\npr := ADR(c${v});\ncByte${v} := pr^;\n`,
      ).join("") +
      "END_FUNCTION_BLOCK\n",
  },
  {
    name: "bool_pointer_copied_to_byte_pointer",
    pouName: "FB_MEM_bool_ptr_copy",
    kind: "function_block" as const,
    feature: "a POINTER TO BOOL holding a BOOL's address, copied into a POINTER TO BYTE that writes 2 there: `= TRUE`, NOT, BOOL_TO_INT of the BOOL",
    fromDoc: doc82,
    plcPrgVar: "inst_bool_ptr_copy : FB_MEM_bool_ptr_copy;",
    plcPrgBody: "inst_bool_ptr_copy();",
    source:
      "FUNCTION_BLOCK FB_MEM_bool_ptr_copy\nVAR\n\tb : BOOL;\n\tpbo : POINTER TO BOOL;\n\tpby : POINTER TO BYTE;\n\tisT : BOOL;\n\tnx : BOOL;\n\txInt : INT;\n\traw : BYTE;\nEND_VAR\n" +
      "pbo := ADR(b);\npby := pbo;\npby^ := 2;\nisT := b = TRUE;\nnx := NOT b;\nxInt := BOOL_TO_INT(b);\nraw := pby^;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "byte_pointer_copied_to_bool_pointer",
    pouName: "FB_MEM_byte_ptr_copy",
    kind: "function_block" as const,
    feature: "a POINTER TO BYTE holding a BYTE 2's address, copied into a POINTER TO BOOL: `= TRUE`, NOT, BOOL_TO_INT of what it reads",
    fromDoc: doc82,
    plcPrgVar: "inst_byte_ptr_copy : FB_MEM_byte_ptr_copy;",
    plcPrgBody: "inst_byte_ptr_copy();",
    source:
      "FUNCTION_BLOCK FB_MEM_byte_ptr_copy\nVAR\n\ty : BYTE := 2;\n\tpby : POINTER TO BYTE;\n\tpbo : POINTER TO BOOL;\n\tisT : BOOL;\n\tnx : BOOL;\n\txInt : INT;\nEND_VAR\n" +
      "pby := ADR(y);\npbo := pby;\nisT := pbo^ = TRUE;\nnx := NOT pbo^;\nxInt := BOOL_TO_INT(pbo^);\nEND_FUNCTION_BLOCK\n",
  },
]
