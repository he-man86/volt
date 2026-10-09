/**
 * Pointer-model measurements — openspec transpile-restructure task 4.1 (design.md §3.3, Measure item 4): the questions the
 * pointer census found no CODESYS answer for, recorded BEFORE §3.3 decides between (a) extended tags, (b) a byte arena and
 * (d) a per-pointer enum. Each answer separates the options: (a) and (d) know only "which target, which element", (b)
 * knows byte addresses. So a recorded byte layout (padding read through a byte pointer, two arrays' distance, the
 * variable behind an array's last element) is what only (b) can reproduce, and a recorded refusal is what all three may
 * refuse alike.
 *
 * Every question sits in an FB, whose instance is one contiguous block laid out in declaration order (measured:
 * `mem_member_offsets`, `mem_sizeof_*`), so an address difference is a property of the declarations and not of where
 * the linker put two PLC_PRG variables. No pointer is dereferenced after a conversion that may have cut it (a DWORD on
 * the 64-bit simulator): a fault wedges the simulated runtime and contaminates every case after it.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec transpile-restructure design.md §3.3 (task 4.1)"

export const POINTER_MODEL_TESTS: readonly LanguageTest[] = [
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
    deferred: {
      transpile:
        "2026-10-09 (transpile-restructure 4.1): CODESYS reads and writes `after` through ADR(arr[3]) + SIZEOF(INT) (past = 99, afterWritten = 77, isNull FALSE) — a byte address; both backends lower the step as element tag 4 of `arr` and fault, 'array index 4 is outside its bounds', where the vendor finishes the scan. Only a byte arena (design.md §3.3 option (b)) answers it; under (a) or (d) the step past the target must be refused by name instead of lowered. Decided by 4.2, built by 4.4.",
    },
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
]
