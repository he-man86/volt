/**
 * the fixtures of `pointer-model.ts` — part A: transpile-restructure 4.3 (design.md §3.3 Decision step 4d, Migration): the ONE batch the image needs first; review of step 4d: three questions the image answered with no recording behind it; transpile-restructure 4.13: the appendix pointer items (transpile-review-2026-09-29 Appendix A), recorded first; transpile-restructure 8.2 (design.md §7.2 Decision step 8c): recorded before the NaN carrier and the raw BOOL.
 *
 * One slice of `pointer-model.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import {
  boolBytes,
  boolPlain,
  boolPlainVars,
  doc,
  doc413,
  doc82,
  nanLreal,
  nanReal,
  nanSelect,
} from "./pointer-model-shared.js"

export const POINTER_MODEL_TESTS_A: readonly LanguageTest[] = [
{
    name: "pointer_order_compare",
    pouName: "FB_MEM_ptr_order",
    kind: "function_block" as const,
    feature: "`<`, `>`, `<=`, `>=` on two pointers into one array, and on two members of one instance",
    fromDoc: doc,
    plcPrgVar:
      "inst_ptr_order : FB_MEM_ptr_order; ltArr : BOOL; gtArr : BOOL; leArr : BOOL; geArr : BOOL; leSame : BOOL; ltSame : BOOL; ltMembers : BOOL; gtMembers : BOOL;",
    plcPrgBody:
      "inst_ptr_order();\nltArr := inst_ptr_order.ltArr; gtArr := inst_ptr_order.gtArr; leArr := inst_ptr_order.leArr; geArr := inst_ptr_order.geArr;\nleSame := inst_ptr_order.leSame; ltSame := inst_ptr_order.ltSame; ltMembers := inst_ptr_order.ltMembers; gtMembers := inst_ptr_order.gtMembers;",
    source:
      "FUNCTION_BLOCK FB_MEM_ptr_order\nVAR_OUTPUT\n\tltArr : BOOL;\n\tgtArr : BOOL;\n\tleArr : BOOL;\n\tgeArr : BOOL;\n\tleSame : BOOL;\n\tltSame : BOOL;\n\tltMembers : BOOL;\n\tgtMembers : BOOL;\nEND_VAR\nVAR\n\tarr : ARRAY[0..3] OF INT;\n\tfirst : INT;\n\tsecond : INT;\n\tp1 : POINTER TO INT;\n\tp3 : POINTER TO INT;\n\tpa : POINTER TO INT;\n\tpb : POINTER TO INT;\nEND_VAR\np1 := ADR(arr[1]);\np3 := ADR(arr[3]);\nltArr := p1 < p3;\ngtArr := p1 > p3;\nleArr := p1 <= p3;\ngeArr := p1 >= p3;\nleSame := p1 <= ADR(arr[1]);\nltSame := p1 < ADR(arr[1]);\npa := ADR(first);\npb := ADR(second);\nltMembers := pa < pb;\ngtMembers := pa > pb;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "adr_difference_two_arrays",
    pouName: "FB_MEM_adr_two_arrays",
    kind: "function_block" as const,
    feature: "ADR difference across two arrays of one instance, and a pointer stepped by it from one array into the other",
    fromDoc: doc,
    plcPrgVar:
      "inst_adr_two : FB_MEM_adr_two_arrays; fwd : ULINT; within : ULINT; rev : LINT; crossed : INT; crossedLast : INT;",
    plcPrgBody:
      "inst_adr_two();\nfwd := inst_adr_two.fwd; within := inst_adr_two.within; rev := inst_adr_two.rev; crossed := inst_adr_two.crossed; crossedLast := inst_adr_two.crossedLast;",
    source:
      "FUNCTION_BLOCK FB_MEM_adr_two_arrays\nVAR_OUTPUT\n\tfwd : ULINT;\n\twithin : ULINT;\n\trev : LINT;\n\tcrossed : INT;\n\tcrossedLast : INT;\nEND_VAR\nVAR\n\tfirstArr : ARRAY[0..3] OF INT := [11, 12, 13, 14];\n\tsecondArr : ARRAY[0..2] OF INT := [21, 22, 23];\n\tp : POINTER TO INT;\nEND_VAR\nfwd := ADR(secondArr[0]) - ADR(firstArr[0]);\nwithin := ADR(firstArr[3]) - ADR(firstArr[0]);\nrev := ADR(firstArr[0]) - ADR(secondArr[0]);\np := ADR(firstArr[0]);\np := p + (ADR(secondArr[0]) - ADR(firstArr[0]));\ncrossed := p^;\np := ADR(firstArr[1]);\np := p + (ADR(secondArr[2]) - ADR(firstArr[1]));\ncrossedLast := p^;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "pointer_byte_walk_struct_padding",
    pouName: "FB_MEM_byte_walk",
    kind: "function_block" as const,
    feature: "a POINTER TO BYTE walking a STRUCT with padding byte by byte, and a byte written into a DINT member through it",
    fromDoc: doc,
    // The members hold distinct bytes so each dumped byte names its member; the padding bytes are whatever an
    // initialised struct holds there. `size` is SIZEOF, so the walk is as long as the vendor's layout.
    plcPrgVar:
      "inst_byte_walk : FB_MEM_byte_walk; size : ULINT; bytes : ARRAY[0..15] OF BYTE; dAfter : DINT; wAfter : WORD;",
    plcPrgBody:
      "inst_byte_walk();\nsize := inst_byte_walk.size; bytes := inst_byte_walk.bytes; dAfter := inst_byte_walk.dAfter; wAfter := inst_byte_walk.wAfter;",
    source:
      "TYPE DUT_MEM_padded :\nSTRUCT\n\tb : BYTE := 16#11;\n\td : DWORD := 16#A4A3A2A1;\n\tw : WORD := 16#B2B1;\n\tc : BYTE := 16#C1;\nEND_STRUCT\nEND_TYPE\n\nFUNCTION_BLOCK FB_MEM_byte_walk\nVAR_OUTPUT\n\tsize : ULINT;\n\tbytes : ARRAY[0..15] OF BYTE;\n\tdAfter : DINT;\n\twAfter : WORD;\nEND_VAR\nVAR\n\tsv : DUT_MEM_padded;\n\tpb : POINTER TO BYTE;\n\tk : INT;\nEND_VAR\nsize := SIZEOF(sv);\npb := ADR(sv);\nFOR k := 0 TO ULINT_TO_INT(size) - 1 DO\n\tbytes[k] := pb^;\n\tpb := pb + 1;\nEND_FOR\npb := ADR(sv) + 5;\npb^ := 16#FF;\ndAfter := DWORD_TO_DINT(sv.d);\npb := ADR(sv.w);\npb^ := 16#EE;\nwAfter := sv.w;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "pointer_step_past_end",
    pouName: "FB_MEM_step_past_end",
    kind: "function_block" as const,
    feature: "a pointer stepped one element past an array's end: not NULL, reads (and writes) the variable declared after it",
    fromDoc: doc,
    plcPrgVar:
      "inst_past_end : FB_MEM_step_past_end; isNull : BOOL; past : INT; back : INT; afterWritten : INT; lastKept : INT;",
    plcPrgBody:
      "inst_past_end();\nisNull := inst_past_end.isNull; past := inst_past_end.past; back := inst_past_end.back; afterWritten := inst_past_end.afterWritten; lastKept := inst_past_end.lastKept;",
    source:
      "FUNCTION_BLOCK FB_MEM_step_past_end\nVAR_OUTPUT\n\tisNull : BOOL;\n\tpast : INT;\n\tback : INT;\n\tafterWritten : INT;\n\tlastKept : INT;\nEND_VAR\nVAR\n\tarr : ARRAY[0..3] OF INT := [11, 22, 33, 44];\n\tafter : INT := 99;\n\tp : POINTER TO INT;\nEND_VAR\np := ADR(arr[3]);\np := p + SIZEOF(INT);\nisNull := p = 0;\npast := p^;\np^ := 77;\nafterWritten := after;\nlastKept := arr[3];\np := p - SIZEOF(INT);\nback := p^;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "pointer_to_lword_roundtrip",
    pouName: "FB_MEM_ptr_lword",
    kind: "function_block" as const,
    feature: "a pointer stored into an LWORD, stepped there, and stored back into a pointer: dereferenced after the trip",
    // `lw` is a VAR_TEMP so the recorder does not read it: its value is an address, which no run reproduces.
    fromDoc: doc,
    plcPrgVar: "inst_ptr_lword : FB_MEM_ptr_lword; same : BOOL; viaWord : INT; stepped : INT; nonZero : BOOL;",
    plcPrgBody:
      "inst_ptr_lword();\nsame := inst_ptr_lword.same; viaWord := inst_ptr_lword.viaWord; stepped := inst_ptr_lword.stepped; nonZero := inst_ptr_lword.nonZero;",
    source:
      "FUNCTION_BLOCK FB_MEM_ptr_lword\nVAR_OUTPUT\n\tsame : BOOL;\n\tviaWord : INT;\n\tstepped : INT;\n\tnonZero : BOOL;\nEND_VAR\nVAR\n\tarr : ARRAY[0..3] OF INT := [11, 22, 33, 44];\n\tp : POINTER TO INT;\n\tq : POINTER TO INT;\nEND_VAR\nVAR_TEMP\n\tlw : LWORD;\nEND_VAR\np := ADR(arr[1]);\nlw := p;\nnonZero := lw <> 0;\nq := lw;\nsame := q = p;\nviaWord := q^;\nlw := lw + SIZEOF(INT);\nq := lw;\nstepped := q^;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "pointer_to_dword_roundtrip",
    pouName: "FB_MEM_ptr_dword",
    kind: "function_block" as const,
    feature: "a pointer stored into a DWORD and back on the 64-bit simulator: compared, never dereferenced (a cut address faults)",
    // Recorded 2026-10-09: CODESYS refuses both stores — "Cannot convert type 'POINTER TO INT' to type 'DWORD'" and back.
    fromDoc: doc,
    plcPrgVar: "inst_ptr_dword : FB_MEM_ptr_dword; same : BOOL; lowSame : BOOL; nonZero : BOOL;",
    plcPrgBody:
      "inst_ptr_dword();\nsame := inst_ptr_dword.same; lowSame := inst_ptr_dword.lowSame; nonZero := inst_ptr_dword.nonZero;",
    source:
      "FUNCTION_BLOCK FB_MEM_ptr_dword\nVAR_OUTPUT\n\tsame : BOOL;\n\tlowSame : BOOL;\n\tnonZero : BOOL;\nEND_VAR\nVAR\n\tarr : ARRAY[0..3] OF INT := [11, 22, 33, 44];\n\tp : POINTER TO INT;\n\tq : POINTER TO INT;\n\tdw : DWORD;\n\tlw : LWORD;\nEND_VAR\np := ADR(arr[1]);\ndw := p;\nnonZero := dw <> 0;\nq := dw;\nsame := q = p;\nlw := p;\nlowSame := dw = LWORD_TO_DWORD(lw);\nEND_FUNCTION_BLOCK\n",
  },
  // ─── transpile-restructure 4.3 (design.md §3.3 Decision step 4d, Migration): the ONE batch the image needs first ───
  // Where an FB's fields sit behind its header (with and without IMPLEMENTS), measured from outside as `ADR(field) -
  // ADR(instance)` on its inputs and outputs and from inside as `ADR(loc) - ADR(THIS^)` on a private VAR; a WSTRING's
  // size and alignment inside a struct; and a DINT read as a REAL through a pointer at the edge bit patterns (a quiet
  // and a signalling NaN, ±0, the smallest denormal, ±max), with the REAL's bits read back through a POINTER TO DWORD.
  {
    name: "fb_header_offsets_plain",
    pouName: "FB_MEM_hdr_plain",
    kind: "function_block" as const,
    feature: "an FB's field offsets behind its header, from outside (inputs, outputs) and from inside (a VAR via THIS^)",
    fromDoc: "openspec transpile-restructure design.md §3.3 (task 4.3)",
    plcPrgVar: "inst_hdr_plain : FB_MEM_hdr_plain; size : ULINT; offIn : ULINT; offOutD : ULINT; offOutW : ULINT; offLoc : ULINT;",
    plcPrgBody:
      "inst_hdr_plain();\nsize := SIZEOF(inst_hdr_plain); offIn := ADR(inst_hdr_plain.inB) - ADR(inst_hdr_plain); offOutD := ADR(inst_hdr_plain.outD) - ADR(inst_hdr_plain); offOutW := ADR(inst_hdr_plain.outW) - ADR(inst_hdr_plain); offLoc := inst_hdr_plain.offLoc;",
    source:
      "FUNCTION_BLOCK FB_MEM_hdr_plain\nVAR_INPUT\n\tinB : BYTE;\nEND_VAR\nVAR_OUTPUT\n\toutD : DINT;\n\toutW : WORD;\n\toffLoc : ULINT;\nEND_VAR\nVAR\n\tloc : INT;\nEND_VAR\nloc := loc + 1;\noffLoc := ADR(loc) - ADR(THIS^);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "fb_header_offsets_implements",
    pouName: "FB_MEM_hdr_impl",
    kind: "function_block" as const,
    feature: "the same FB IMPLEMENTS one interface: where its fields sit behind the header and the interface pointer",
    fromDoc: "openspec transpile-restructure design.md §3.3 (task 4.3)",
    plcPrgVar: "inst_hdr_impl : FB_MEM_hdr_impl; size : ULINT; offIn : ULINT; offOutD : ULINT; offOutW : ULINT; offLoc : ULINT;",
    plcPrgBody:
      "inst_hdr_impl();\nsize := SIZEOF(inst_hdr_impl); offIn := ADR(inst_hdr_impl.inB) - ADR(inst_hdr_impl); offOutD := ADR(inst_hdr_impl.outD) - ADR(inst_hdr_impl); offOutW := ADR(inst_hdr_impl.outW) - ADR(inst_hdr_impl); offLoc := inst_hdr_impl.offLoc;",
    source:
      "INTERFACE I_MEM_hdr_impl\nMETHOD Mh : DINT\nEND_METHOD\nEND_INTERFACE\n\nFUNCTION_BLOCK FB_MEM_hdr_impl IMPLEMENTS I_MEM_hdr_impl\nVAR_INPUT\n\tinB : BYTE;\nEND_VAR\nVAR_OUTPUT\n\toutD : DINT;\n\toutW : WORD;\n\toffLoc : ULINT;\nEND_VAR\nVAR\n\tloc : INT;\nEND_VAR\nloc := loc + 1;\noffLoc := ADR(loc) - ADR(THIS^);\nEND_FUNCTION_BLOCK\n\nMETHOD Mh : DINT\nMh := outD;\nEND_METHOD\n",
  },
  {
    name: "wstring_layout_in_struct",
    pouName: "DUT_MEM_wstr_layout",
    kind: "dut",
    feature: "a WSTRING(3)'s size and alignment between two BYTEs of a struct",
    fromDoc: "openspec transpile-restructure design.md §3.3 (task 4.3)",
    plcPrgVar: "sv : DUT_MEM_wstr_layout; size : ULINT; wsSize : ULINT; offWs : ULINT; offAfter : ULINT;",
    plcPrgBody: "size := SIZEOF(sv); wsSize := SIZEOF(sv.ws); offWs := ADR(sv.ws) - ADR(sv); offAfter := ADR(sv.after) - ADR(sv);",
    source: "TYPE DUT_MEM_wstr_layout :\nSTRUCT\n\tb : BYTE;\n\tws : WSTRING(3);\n\tafter : BYTE;\nEND_STRUCT\nEND_TYPE\n",
  },
  {
    name: "reinterpret_dint_as_real_edges",
    pouName: "FB_MEM_reinterp_edges",
    kind: "function_block" as const,
    feature: "a DINT read as a REAL through a pointer at a quiet and a signalling NaN, ±0, the smallest denormal and ±max",
    fromDoc: "openspec transpile-restructure design.md §3.3 (task 4.3)",
    plcPrgVar:
      "inst_reinterp : FB_MEM_reinterp_edges; rQnan : REAL; rSnan : REAL; rPzero : REAL; rNzero : REAL; rDenorm : REAL; rMax : REAL; rMin : REAL; bQnan : DWORD; bSnan : DWORD; bNzero : DWORD; bDenorm : DWORD; bMin : DWORD; denormPos : BOOL; nanSelf : BOOL;",
    plcPrgBody:
      "inst_reinterp();\nrQnan := inst_reinterp.rQnan; rSnan := inst_reinterp.rSnan; rPzero := inst_reinterp.rPzero; rNzero := inst_reinterp.rNzero; rDenorm := inst_reinterp.rDenorm; rMax := inst_reinterp.rMax; rMin := inst_reinterp.rMin;\nbQnan := inst_reinterp.bQnan; bSnan := inst_reinterp.bSnan; bNzero := inst_reinterp.bNzero; bDenorm := inst_reinterp.bDenorm; bMin := inst_reinterp.bMin; denormPos := inst_reinterp.denormPos; nanSelf := inst_reinterp.nanSelf;",
    source:
      "FUNCTION_BLOCK FB_MEM_reinterp_edges\nVAR_OUTPUT\n\trQnan : REAL;\n\trSnan : REAL;\n\trPzero : REAL;\n\trNzero : REAL;\n\trDenorm : REAL;\n\trMax : REAL;\n\trMin : REAL;\n\tbQnan : DWORD;\n\tbSnan : DWORD;\n\tbNzero : DWORD;\n\tbDenorm : DWORD;\n\tbMin : DWORD;\n\tdenormPos : BOOL;\n\tnanSelf : BOOL;\nEND_VAR\nVAR\n\tdQnan : DINT := 2143289344;\n\tdSnan : DINT := 2141192192;\n\tdPzero : DINT := 0;\n\tdNzero : DINT := -2147483647 - 1;\n\tdDenorm : DINT := 1;\n\tdMax : DINT := 2139095039;\n\tdMin : DINT := -8388609;\n\tpr : POINTER TO REAL;\n\tpd : POINTER TO DWORD;\nEND_VAR\npr := ADR(dQnan);\nrQnan := pr^;\npr := ADR(dSnan);\nrSnan := pr^;\npr := ADR(dPzero);\nrPzero := pr^;\npr := ADR(dNzero);\nrNzero := pr^;\npr := ADR(dDenorm);\nrDenorm := pr^;\npr := ADR(dMax);\nrMax := pr^;\npr := ADR(dMin);\nrMin := pr^;\npd := ADR(rQnan);\nbQnan := pd^;\npd := ADR(rSnan);\nbSnan := pd^;\npd := ADR(rNzero);\nbNzero := pd^;\npd := ADR(rDenorm);\nbDenorm := pd^;\npd := ADR(rMin);\nbMin := pd^;\ndenormPos := rDenorm > 0.0;\nnanSelf := rQnan = rQnan;\nEND_FUNCTION_BLOCK\n",
  },
  // ─── review of step 4d: three questions the image answered with no recording behind it ───
  // A FB whose VAR comes BEFORE its VAR_INPUT and VAR_OUTPUT: whether the fields sit in DECLARATION order or in section
  // order (`fb_header_offsets_plain` declares them in section order, so it cannot tell the two apart); an end pointer
  // one past an array ordered against the array's own addresses, in PLC_PRG and in an FB whose array a POINTER follows;
  // and a BOOL whose byte a POINTER TO BYTE set to 2, compared with TRUE and negated.
  {
    name: "fb_offsets_var_before_input",
    pouName: "FB_MEM_var_first",
    kind: "function_block" as const,
    feature: "an FB declaring VAR before VAR_INPUT and VAR_OUTPUT: its field offsets from outside and via THIS^",
    fromDoc: "openspec transpile-restructure design.md §3.3 (review of step 4d)",
    plcPrgVar: "inst_var_first : FB_MEM_var_first; size : ULINT; offIn : ULINT; offOutD : ULINT; offLoc : ULINT;",
    plcPrgBody:
      "inst_var_first();\nsize := SIZEOF(inst_var_first); offIn := ADR(inst_var_first.inB) - ADR(inst_var_first); offOutD := ADR(inst_var_first.outD) - ADR(inst_var_first); offLoc := inst_var_first.offLoc;",
    source:
      "FUNCTION_BLOCK FB_MEM_var_first\nVAR\n\tloc : INT;\nEND_VAR\nVAR_INPUT\n\tinB : BYTE;\nEND_VAR\nVAR_OUTPUT\n\toutD : ULINT;\n\toffLoc : ULINT;\nEND_VAR\nloc := loc + 1;\noffLoc := ADR(loc) - ADR(THIS^);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "pointer_order_one_past_end",
    pouName: "FB_MEM_end_loop",
    kind: "function_block" as const,
    feature: "`WHILE p < pEnd` with pEnd one past an array's end, over a PLC_PRG array and an FB array a POINTER follows",
    fromDoc: "openspec transpile-restructure design.md §3.3 (review of step 4d)",
    plcPrgVar:
      "inst_end_loop : FB_MEM_end_loop; arrEnd : ARRAY[0..3] OF INT := [1, 2, 3, 4]; pE : POINTER TO INT; pEndE : POINTER TO INT; sumPrg : INT; sumFb : INT; endAfter : BOOL;",
    plcPrgBody:
      "sumPrg := 0;\npE := ADR(arrEnd[0]);\npEndE := ADR(arrEnd[0]) + SIZEOF(arrEnd);\nWHILE pE < pEndE DO\n\tsumPrg := sumPrg + pE^;\n\tpE := pE + SIZEOF(INT);\nEND_WHILE\nendAfter := pEndE > ADR(arrEnd[3]);\ninst_end_loop();\nsumFb := inst_end_loop.sum;",
    source:
      "FUNCTION_BLOCK FB_MEM_end_loop\nVAR_OUTPUT\n\tsum : INT;\nEND_VAR\nVAR\n\tarr : ARRAY[0..3] OF INT := [10, 20, 30, 40];\n\tp : POINTER TO INT;\n\tpEnd : POINTER TO INT;\nEND_VAR\nsum := 0;\np := ADR(arr[0]);\npEnd := ADR(arr[0]) + SIZEOF(arr);\nWHILE p < pEnd DO\n\tsum := sum + p^;\n\tp := p + SIZEOF(INT);\nEND_WHILE\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "bool_byte_two_through_pointer",
    pouName: "FB_MEM_bool_two",
    kind: "function_block" as const,
    feature: "a BOOL whose byte is set to 2 through a POINTER TO BYTE: compared with TRUE, negated, tested by IF, read back as a BYTE",
    fromDoc: "openspec transpile-restructure design.md §3.3 (review of step 4d)",
    plcPrgVar: "inst_bool_two : FB_MEM_bool_two; eqT : BOOL; nb : BOOL; taken : BOOL; raw : BYTE; notRaw : BYTE;",
    plcPrgBody:
      "inst_bool_two();\neqT := inst_bool_two.eqT; nb := inst_bool_two.nb; taken := inst_bool_two.taken; raw := inst_bool_two.raw; notRaw := inst_bool_two.notRaw;",
    source:
      "FUNCTION_BLOCK FB_MEM_bool_two\nVAR_OUTPUT\n\teqT : BOOL;\n\tnb : BOOL;\n\ttaken : BOOL;\n\traw : BYTE;\n\tnotRaw : BYTE;\nEND_VAR\nVAR\n\tb : BOOL;\n\tc : BOOL;\n\tpb : POINTER TO BYTE;\nEND_VAR\npb := ADR(b);\npb^ := 2;\neqT := b = TRUE;\nnb := NOT b;\ntaken := FALSE;\nIF b THEN\n\ttaken := TRUE;\nEND_IF\nraw := pb^;\nc := NOT b;\npb := ADR(c);\nnotRaw := pb^;\nEND_FUNCTION_BLOCK\n",
  },
  // ─── transpile-restructure 4.13: the appendix pointer items (transpile-review-2026-09-29 Appendix A), recorded first ───
  // (a) a pointer's target set read while it still grows: the read lowered before the store that gives it its second
  // target. A FUNCTION's local is no image variable, so its pointer keeps a tag (design.md §3.3 step 4f).
  {
    name: "pointer_target_set_grows_after_read",
    pouName: "F_MEM_ptr_grow",
    kind: "function" as const,
    feature: "a pointer read in a loop before the store that gives it its second target: the second pass reads the second target",
    fromDoc: doc413,
    plcPrgVar: "grown : INT;",
    plcPrgBody: "grown := F_MEM_ptr_grow();",
    source:
      "FUNCTION F_MEM_ptr_grow : INT\nVAR\n\ta : INT := 11;\n\tb : INT := 22;\n\tp : POINTER TO INT;\n\tk : INT;\nEND_VAR\nF_MEM_ptr_grow := 0;\np := ADR(a);\nFOR k := 1 TO 2 DO\n\tF_MEM_ptr_grow := F_MEM_ptr_grow + p^;\n\tp := ADR(b);\nEND_FOR\nEND_FUNCTION\n",
  },
  // (a), copied: the same growing set read through a COPY made each pass (`q := p; ... q^`) — a copy of a pointer of
  // several targets, refused `pointer-targets` by name (it read 22 silently before the seeded re-lowering; review of 4f).
  {
    name: "pointer_target_set_grows_copied",
    pouName: "F_MEM_ptr_grow_copy",
    kind: "function" as const,
    feature: "a pointer copied in a loop before the store that gives it its second target, the copy dereferenced: the second pass reads the second target",
    fromDoc: doc413,
    plcPrgVar: "grownCopy : INT;",
    plcPrgBody: "grownCopy := F_MEM_ptr_grow_copy();",
    source:
      "FUNCTION F_MEM_ptr_grow_copy : INT\nVAR\n\ta : INT := 11;\n\tb : INT := 22;\n\tp : POINTER TO INT;\n\tq : POINTER TO INT;\n\tk : INT;\nEND_VAR\nF_MEM_ptr_grow_copy := 0;\np := ADR(a);\nFOR k := 1 TO 2 DO\n\tq := p;\n\tF_MEM_ptr_grow_copy := F_MEM_ptr_grow_copy + q^;\n\tp := ADR(b);\nEND_FOR\nEND_FUNCTION\n",
  },
  // (a), before any store: a FUNCTION's local pointer dereferenced before the store that gives it its only target. Every
  // call starts with the pointer NULL, so the read is a null dereference (refused `pointer-order` before the seeded
  // re-lowering; review of 4f). Does the vendor stop?
  {
    name: "pointer_deref_before_first_store",
    pouName: "F_MEM_ptr_deref_first",
    kind: "function" as const,
    feature: "a FUNCTION's local pointer dereferenced before the store that gives it its target: a null dereference on every call",
    fromDoc: doc413,
    plcPrgVar: "derefFirst : INT;",
    plcPrgBody: "derefFirst := F_MEM_ptr_deref_first();",
    source:
      "FUNCTION F_MEM_ptr_deref_first : INT\nVAR\n\ta : INT := 11;\n\tp : POINTER TO INT;\nEND_VAR\nF_MEM_ptr_deref_first := p^;\np := ADR(a);\nEND_FUNCTION\n",
  },
  // (b) a NULL pointer copied into a pointer that names several variables stays NULL; a non-null copy names its target.
  {
    name: "pointer_null_copied_into_multi_target",
    pouName: "F_MEM_ptr_null_copy",
    kind: "function" as const,
    feature: "a null single-target pointer copied into a pointer with two targets: the copy is null; copied again once set, it reads the target",
    fromDoc: doc413,
    plcPrgVar: "copiedNull : BOOL; copiedSet : BOOL; readBack : INT;",
    plcPrgBody: "readBack := F_MEM_ptr_null_copy(copiedNull => copiedNull, copiedSet => copiedSet);",
    source:
      "FUNCTION F_MEM_ptr_null_copy : INT\nVAR_OUTPUT\n\tcopiedNull : BOOL;\n\tcopiedSet : BOOL;\nEND_VAR\nVAR\n\ta : INT := 11;\n\tb : INT := 22;\n\tnever : BOOL;\n\tsrc : POINTER TO INT;\n\tp : POINTER TO INT;\nEND_VAR\nIF never THEN\n\tsrc := ADR(a);\nEND_IF\np := ADR(b);\np := ADR(a);\np := src;\ncopiedNull := p = 0;\nsrc := ADR(a);\np := src;\ncopiedSet := p <> 0;\nF_MEM_ptr_null_copy := p^;\nEND_FUNCTION\n",
  },
  // (c) `0 = p` / `0 <> p` — the zero on the LEFT, on a pointer that holds an address (an FB field's) and on one that keeps a tag.
  {
    name: "pointer_zero_on_left_compare",
    pouName: "FB_MEM_zero_left",
    kind: "function_block" as const,
    feature: "`0 = p` and `0 <> p` on a pointer into the instance, before and after an address is stored",
    fromDoc: doc413,
    plcPrgVar: "inst_zero_left : FB_MEM_zero_left; zIsNull : BOOL; zNotNullBefore : BOOL; zIsNullAfter : BOOL; zNotNull : BOOL;",
    plcPrgBody: "inst_zero_left();\nzIsNull := inst_zero_left.isNull; zNotNullBefore := inst_zero_left.notNullBefore; zIsNullAfter := inst_zero_left.isNullAfter; zNotNull := inst_zero_left.notNull;",
    source:
      "FUNCTION_BLOCK FB_MEM_zero_left\nVAR_OUTPUT\n\tisNull : BOOL;\n\tnotNullBefore : BOOL;\n\tisNullAfter : BOOL;\n\tnotNull : BOOL;\nEND_VAR\nVAR\n\ta : INT;\n\tp : POINTER TO INT;\nEND_VAR\np := 0;\nisNull := 0 = p;\nnotNullBefore := 0 <> p;\np := ADR(a);\nisNullAfter := 0 = p;\nnotNull := 0 <> p;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "pointer_zero_on_left_compare_local",
    pouName: "F_MEM_zero_left_local",
    kind: "function" as const,
    feature: "`0 = p` and `0 <> p` on a FUNCTION's pointer to its own local (a tag), before and after an address is stored",
    fromDoc: doc413,
    plcPrgVar: "lIsNull : BOOL; lNotNull : BOOL;",
    plcPrgBody: "lIsNull := F_MEM_zero_left_local(notNull => lNotNull);",
    source:
      "FUNCTION F_MEM_zero_left_local : BOOL\nVAR_OUTPUT\n\tnotNull : BOOL;\nEND_VAR\nVAR\n\ta : INT;\n\tp : POINTER TO INT;\nEND_VAR\nF_MEM_zero_left_local := 0 = p;\np := ADR(a);\nnotNull := 0 <> p;\nEND_FUNCTION\n",
  },
  // (d) `r.3` on a REFERENCE: a bit of the referenced variable, read and written.
  {
    name: "reference_bit_access",
    pouName: "FB_MEM_ref_bit",
    kind: "function_block" as const,
    feature: "`rw.3` read and `rw.0 := TRUE` / `rw.3 := FALSE` written through a REFERENCE TO WORD into the instance",
    fromDoc: doc413,
    plcPrgVar: "inst_ref_bit : FB_MEM_ref_bit; rBit3 : BOOL; rBit2 : BOOL; rAfter : WORD;",
    plcPrgBody: "inst_ref_bit();\nrBit3 := inst_ref_bit.bit3; rBit2 := inst_ref_bit.bit2; rAfter := inst_ref_bit.after;",
    source:
      "FUNCTION_BLOCK FB_MEM_ref_bit\nVAR_OUTPUT\n\tbit3 : BOOL;\n\tbit2 : BOOL;\n\tafter : WORD;\nEND_VAR\nVAR\n\tw : WORD;\n\trw : REFERENCE TO WORD;\nEND_VAR\nw := 16#0008;\nrw REF= w;\nbit3 := rw.3;\nbit2 := rw.2;\nrw.0 := TRUE;\nrw.3 := FALSE;\nafter := w;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "reference_bit_access_local",
    pouName: "F_MEM_ref_bit_local",
    kind: "function" as const,
    feature: "`rw.3` read and `rw.0 := TRUE` written through a FUNCTION's REFERENCE TO WORD to its own local (a tag)",
    fromDoc: doc413,
    plcPrgVar: "lBit3 : BOOL; lAfter : WORD;",
    plcPrgBody: "lBit3 := F_MEM_ref_bit_local(after => lAfter);",
    source:
      "FUNCTION F_MEM_ref_bit_local : BOOL\nVAR_OUTPUT\n\tafter : WORD;\nEND_VAR\nVAR\n\tw : WORD := 16#0008;\n\trw : REFERENCE TO WORD;\nEND_VAR\nrw REF= w;\nF_MEM_ref_bit_local := rw.3;\nrw.0 := TRUE;\nafter := w;\nEND_FUNCTION\n",
  },
  // (e) an ANY input given a REFERENCE TO: the argument is the variable referenced — its size, and its value through pValue.
  {
    name: "any_input_given_reference",
    pouName: "F_MEM_any_ref",
    kind: "function" as const,
    feature: "a REFERENCE TO INT passed to an ANY input: diSize is the INT's, and pValue^ reads the referenced INT",
    fromDoc: doc413,
    plcPrgVar: "anyX : INT := 5; anyRef : REFERENCE TO INT; anySize : DINT; anySeen : INT;",
    plcPrgBody: "anyRef REF= anyX;\nanySize := F_MEM_any_ref(v := anyRef, seen => anySeen);",
    source:
      "FUNCTION F_MEM_any_ref : DINT\nVAR_INPUT\n\tv : ANY;\nEND_VAR\nVAR_OUTPUT\n\tseen : INT;\nEND_VAR\nVAR\n\tpi : POINTER TO INT;\nEND_VAR\nF_MEM_any_ref := v.diSize;\npi := v.pValue;\nseen := pi^;\nEND_FUNCTION\n",
  },
  {
    name: "any_input_given_reference_size",
    pouName: "F_MEM_any_ref_size",
    kind: "function" as const,
    feature: "a REFERENCE TO INT passed to an ANY input that reads only diSize: the argument lent is the referenced INT",
    fromDoc: doc413,
    plcPrgVar: "anySzX : INT := 5; anySzRef : REFERENCE TO INT; anySzOnly : DINT;",
    plcPrgBody: "anySzRef REF= anySzX;\nanySzOnly := F_MEM_any_ref_size(v := anySzRef);",
    source:
      "FUNCTION F_MEM_any_ref_size : DINT\nVAR_INPUT\n\tv : ANY;\nEND_VAR\nF_MEM_any_ref_size := v.diSize;\nEND_FUNCTION\n",
  },
  // ─── transpile-restructure 8.2 (design.md §7.2 Decision step 8c): recorded before the NaN carrier and the raw BOOL ───
  {
    name: "nan_payload_ops",
    pouName: "FB_MEM_nan_ops",
    kind: "function_block" as const,
    feature: "REAL NaN operands (signalling, payload, negative) through + - * /, two NaNs both orders, NEG/ABS/copy, SQRT/LN/LOG/EXP/EXPT; NaNs made from non-NaN operands; every result read as its bits",
    fromDoc: doc82,
    plcPrgVar: "inst_nan : FB_MEM_nan_ops;",
    plcPrgBody: "inst_nan();",
    source:
      "FUNCTION_BLOCK FB_MEM_nan_ops\nVAR\n\tdS : DWORD := 16#7FA00000;\n\tdP : DWORD := 16#7FC12345;\n\tdN : DWORD := 16#FFC00000;\n\tdNS : DWORD := 16#FF812345;\n\tdInf : DWORD := 16#7F800000;\n\tone : REAL := 1.0;\n\ttwo : REAL := 2.0;\n\tzero : REAL;\n\tsig : REAL;\n\tpay : REAL;\n\tneg : REAL;\n\tnegSig : REAL;\n\tpinf : REAL;\n\tres : REAL;\n\tpr : POINTER TO REAL;\n\tpd : POINTER TO DWORD;\n" +
      nanReal.vars +
      "\teqPP : BOOL;\n\tnePP : BOOL;\n\tltPOne : BOOL;\n\tgePOne : BOOL;\n\teqSS : BOOL;\n\tdintP : DINT;\n\ttruncP : DINT;\nEND_VAR\n" +
      "pr := ADR(dS);\nsig := pr^;\npr := ADR(dP);\npay := pr^;\npr := ADR(dN);\nneg := pr^;\npr := ADR(dNS);\nnegSig := pr^;\npr := ADR(dInf);\npinf := pr^;\n" +
      nanReal.body +
      "eqPP := pay = pay;\nnePP := pay <> pay;\nltPOne := pay < one;\ngePOne := pay >= one;\neqSS := sig = sig;\ndintP := REAL_TO_DINT(pay);\ntruncP := TRUNC(pay);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "nan_payload_ops_lreal",
    pouName: "FB_MEM_nan_ops_l",
    kind: "function_block" as const,
    feature: "LREAL NaN operands through + - * /, NEG/ABS/copy, SQRT/LN/EXP; REAL NaN to LREAL and LREAL NaN (payload low, high, none) to REAL; a REAL NaN beside an LREAL; every result read as its bits",
    fromDoc: doc82,
    plcPrgVar: "inst_nan_l : FB_MEM_nan_ops_l;",
    plcPrgBody: "inst_nan_l();",
    source:
      "FUNCTION_BLOCK FB_MEM_nan_ops_l\nVAR\n\tqS : LWORD := 16#7FF4000000000000;\n\tqP : LWORD := 16#7FF8000000012345;\n\tqN : LWORD := 16#FFF8000000000000;\n\tqHi : LWORD := 16#7FF8123400000000;\n\tqHiS : LWORD := 16#7FF1234500000000;\n\tqInf : LWORD := 16#7FF0000000000000;\n" +
      "\tdS : DWORD := 16#7FA00000;\n\tdP : DWORD := 16#7FC12345;\n\tdN : DWORD := 16#FFC00000;\n\tdNS : DWORD := 16#FF812345;\n" +
      "\tone : LREAL := 1.0;\n\ttwo : LREAL := 2.0;\n\tzero : LREAL;\n\tsig : LREAL;\n\tpay : LREAL;\n\tneg : LREAL;\n\thigh : LREAL;\n\thighSig : LREAL;\n\tpinf : LREAL;\n\tfs : REAL;\n\tfp : REAL;\n\tfn : REAL;\n\tfns : REAL;\n\tlr : LREAL;\n\tres : REAL;\n" +
      "\tpl : POINTER TO LREAL;\n\tpq : POINTER TO LWORD;\n\tpr : POINTER TO REAL;\n\tpd : POINTER TO DWORD;\n" +
      nanLreal.vars +
      "END_VAR\n" +
      "pl := ADR(qS);\nsig := pl^;\npl := ADR(qP);\npay := pl^;\npl := ADR(qN);\nneg := pl^;\npl := ADR(qHi);\nhigh := pl^;\npl := ADR(qHiS);\nhighSig := pl^;\npl := ADR(qInf);\npinf := pl^;\n" +
      "pr := ADR(dS);\nfs := pr^;\npr := ADR(dP);\nfp := pr^;\npr := ADR(dN);\nfn := pr^;\npr := ADR(dNS);\nfns := pr^;\n" +
      nanLreal.body +
      "END_FUNCTION_BLOCK\n",
  },
  {
    name: "nan_payload_select_trig",
    pouName: "FB_MEM_nan_sel",
    kind: "function_block" as const,
    feature: "a NaN through SIN/COS/TAN/ASIN/ACOS/ATAN, ABS of a signalling NaN, EXPT(NaN, 0), and a signalling NaN through MAX/MIN/LIMIT/SEL/MUX, REAL and LREAL; every result read as its bits",
    fromDoc: doc82,
    plcPrgVar: "inst_nan_sel : FB_MEM_nan_sel;",
    plcPrgBody: "inst_nan_sel();",
    source:
      "FUNCTION_BLOCK FB_MEM_nan_sel\nVAR\n\tdS : DWORD := 16#7FA00000;\n\tdP : DWORD := 16#7FC12345;\n\tqS : LWORD := 16#7FF4000000000000;\n\tqP : LWORD := 16#7FF8000000012345;\n" +
      "\tone : REAL := 1.0;\n\ttwo : REAL := 2.0;\n\tzero : REAL;\n\tsig : REAL;\n\tpay : REAL;\n\tres : REAL;\n\tlone : LREAL := 1.0;\n\tlsig : LREAL;\n\tlpay : LREAL;\n\tlr : LREAL;\n" +
      "\tpr : POINTER TO REAL;\n\tpd : POINTER TO DWORD;\n\tpl : POINTER TO LREAL;\n\tpq : POINTER TO LWORD;\n" +
      nanSelect.vars +
      "END_VAR\n" +
      "pr := ADR(dS);\nsig := pr^;\npr := ADR(dP);\npay := pr^;\npl := ADR(qS);\nlsig := pl^;\npl := ADR(qP);\nlpay := pl^;\n" +
      nanSelect.body +
      "END_FUNCTION_BLOCK\n",
  },
  {
    name: "bool_byte_ops",
    pouName: "FB_MEM_bool_ops",
    kind: "function_block" as const,
    feature: "BOOLs whose bytes are 2, 3 and 255 (set through a POINTER TO BYTE) through AND/OR/XOR/NOT, <> TRUE, = FALSE, =, BOOL_TO_INT/BYTE, IF, a copy into a plain BOOL, a FUNCTION input; each BOOL result's byte read",
    fromDoc: doc82,
    plcPrgVar: "inst_bool_ops : FB_MEM_bool_ops;",
    plcPrgBody: "inst_bool_ops();",
    source:
      "FUNCTION F_MEM_bool_in_byte : BYTE\nVAR_INPUT\n\tx : BOOL;\nEND_VAR\nF_MEM_bool_in_byte := BOOL_TO_BYTE(x);\nEND_FUNCTION\n\n" +
      "FUNCTION F_MEM_bool_in_eq : BOOL\nVAR_INPUT\n\tx : BOOL;\nEND_VAR\nF_MEM_bool_in_eq := x = TRUE;\nEND_FUNCTION\n\n" +
      "FUNCTION_BLOCK FB_MEM_bool_ops\nVAR\n\tb2 : BOOL;\n\tb3 : BOOL;\n\tb255 : BOOL;\n\tt : BOOL := TRUE;\n\tf : BOOL;\n\tres : BOOL;\n\tpb : POINTER TO BYTE;\n\teq2b3 : BOOL;\n" +
      boolBytes.vars +
      boolPlainVars +
      "END_VAR\n" +
      "pb := ADR(b2);\npb^ := 2;\npb := ADR(b3);\npb^ := 3;\npb := ADR(b255);\npb^ := 255;\n" +
      boolBytes.body +
      "eq2b3 := b2 = b3;\n" +
      boolPlain +
      "END_FUNCTION_BLOCK\n",
  },
]
