/**
 * Memory-model measurements — the facts transpile-st-to-rust design §9's handle-first hybrid is built on (decided
 * 2026-09-14). Recorded BEFORE any of it is implemented: SIZEOF and member offsets (the on-demand byte view), pointer
 * indexing and `p + SIZEOF(T)` over an array of structs (the handle's last index step), a method called through a
 * pointer to an instance, and ADR of a VAR_IN_OUT member (a handle into a caller's place). Each question is its own
 * fixture, so one that does not compile cannot hide the others. Sizes are stored as ULINT: whatever width SIZEOF
 * returns widens into it.
 */
import type { LanguageTest } from "../../types.js"

const doc = "transpile-st-to-rust design §9"

export const MEMORY_MODEL_TESTS: readonly LanguageTest[] = [
  {
    name: "mem_sizeof_struct_mixed",
    pouName: "DUT_MEM_mixed",
    kind: "struct",
    feature: "SIZEOF a struct of mixed widths, an array of it, one BOOL field and a STRING — alignment and padding",
    fromDoc: doc,
    // (`s` is not a usable name — the IL operator S is reserved)
    plcPrgVar: "sv : DUT_MEM_mixed; arr : ARRAY[0..2] OF DUT_MEM_mixed; str : STRING; szStruct : ULINT; szArr : ULINT; szBool : ULINT; szString : ULINT;",
    plcPrgBody: "szStruct := SIZEOF(sv); szArr := SIZEOF(arr); szBool := SIZEOF(sv.x); szString := SIZEOF(str);",
    source: `TYPE DUT_MEM_mixed :
STRUCT
	b : BYTE;
	i : INT;
	d : DINT;
	x : BOOL;
	l : LREAL;
END_STRUCT
END_TYPE
`,
  },
  {
    name: "mem_member_offsets",
    pouName: "DUT_MEM_offsets",
    kind: "struct",
    feature: "each member's offset in a mixed struct, as the difference of two ADRs",
    fromDoc: doc,
    plcPrgVar: "sv : DUT_MEM_offsets; offI : ULINT; offD : ULINT; offX : ULINT; offL : ULINT;",
    plcPrgBody: "offI := ADR(sv.i) - ADR(sv); offD := ADR(sv.d) - ADR(sv); offX := ADR(sv.x) - ADR(sv); offL := ADR(sv.l) - ADR(sv);",
    source: `TYPE DUT_MEM_offsets :
STRUCT
	b : BYTE;
	i : INT;
	d : DINT;
	x : BOOL;
	l : LREAL;
END_STRUCT
END_TYPE
`,
  },
  {
    name: "mem_sizeof_fb_instance",
    pouName: "FB_MEM_sized",
    kind: "function_block",
    feature: "SIZEOF an FB instance with a method — does it carry a hidden header (a vtable pointer)?",
    fromDoc: doc,
    plcPrgVar: "inst : FB_MEM_sized; szInst : ULINT;",
    plcPrgBody: "szInst := SIZEOF(inst);",
    source: `FUNCTION_BLOCK FB_MEM_sized
VAR
	b : BYTE;
	d : DINT;
END_VAR

END_FUNCTION_BLOCK

METHOD Touch
b := b + 1;
END_METHOD
`,
  },
  {
    name: "mem_pointer_index_struct_array",
    pouName: "DUT_MEM_pt",
    kind: "struct",
    feature: "a POINTER TO a struct element: p^, p[i] and p + SIZEOF(T) over an array of structs",
    fromDoc: doc,
    // `(p + SIZEOF(DUT_MEM_pt))^.x` does not parse — "';' expected instead of '^'" (measured 2026-09-14): `^` follows a
    // name, never a parenthesized expression, so a stepped pointer is stored first.
    plcPrgVar:
      "arr : ARRAY[0..4] OF DUT_MEM_pt; p : POINTER TO DUT_MEM_pt; q : POINTER TO DUT_MEM_pt; k : INT; viaDeref : INT; viaIndex : INT; viaStep : INT; writtenBack : INT;",
    plcPrgBody:
      "FOR k := 0 TO 4 DO arr[k].x := k * 10; END_FOR\np := ADR(arr[1]);\nviaDeref := p^.x; viaIndex := p[2].x;\nq := p + SIZEOF(DUT_MEM_pt); viaStep := q^.x;\np[3].x := 77; writtenBack := arr[4].x;",
    source: `TYPE DUT_MEM_pt :
STRUCT
	x : INT;
	y : REAL;
END_STRUCT
END_TYPE
`,
  },
  {
    name: "mem_pointer_to_instance_method",
    pouName: "FB_MEM_counter",
    kind: "function_block",
    feature: "a method called through a POINTER TO an FB instance, and a member read through it",
    fromDoc: doc,
    plcPrgVar: "inst : FB_MEM_counter; pInst : POINTER TO FB_MEM_counter; got : INT;",
    plcPrgBody: "pInst := ADR(inst);\npInst^.Bump();\npInst^.Bump();\ngot := pInst^.n;",
    source: `FUNCTION_BLOCK FB_MEM_counter
VAR
	n : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Bump
n := n + 1;
END_METHOD
`,
  },
  {
    name: "mem_adr_of_inout_member",
    pouName: "FB_MEM_inout",
    kind: "function_block",
    feature: "ADR of a VAR_IN_OUT struct's member, written through — the caller's place changes",
    fromDoc: doc,
    plcPrgVar: "rec : DUT_MEM_io; fbio : FB_MEM_inout;",
    plcPrgBody: "fbio(io := rec);",
    source: `TYPE DUT_MEM_io :
STRUCT
	x : INT;
	y : INT;
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_MEM_inout
VAR_IN_OUT
	io : DUT_MEM_io;
END_VAR
VAR
	p : POINTER TO INT;
END_VAR
p := ADR(io.y);
p^ := 99;
END_FUNCTION_BLOCK
`,
  },
  // ─── DOES A VAR_TEMP OR VAR_STAT TAKE ROOM IN THE INSTANCE? ────────────────────────────────────────
  // `storage.ts` gives both a FRAME SLOT while `bytes.ts` skips both when it lays an instance out, and the two files
  // described that in words that read as a contradiction. Nothing measured which the vendor agrees with, and SIZEOF
  // is the question that tells: the baseline holds one DINT, and the other two add a temp and a static to it.
  {
    name: "mem_sizeof_fb_baseline_one_dint",
    pouName: "FB_MEM_fb_baseline_one_dint",
    kind: "function_block" as const,
    feature: "SIZEOF an FB with one DINT and no temp or static — the baseline",
    fromDoc: doc,
    plcPrgVar: "inst_fb_baseline_one_dint : FB_MEM_fb_baseline_one_dint; sz_fb_baseline_one_dint : ULINT;",
    plcPrgBody: "sz_fb_baseline_one_dint := SIZEOF(inst_fb_baseline_one_dint);",
    source: "FUNCTION_BLOCK FB_MEM_fb_baseline_one_dint\nVAR\n\tkept : DINT;\nEND_VAR\nkept := kept + 1;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "mem_sizeof_fb_with_temp",
    pouName: "FB_MEM_fb_with_temp",
    kind: "function_block" as const,
    feature: "SIZEOF an FB that also declares a VAR_TEMP — is the temp in the instance?",
    fromDoc: doc,
    plcPrgVar: "inst_fb_with_temp : FB_MEM_fb_with_temp; sz_fb_with_temp : ULINT;",
    plcPrgBody: "sz_fb_with_temp := SIZEOF(inst_fb_with_temp);",
    source: "FUNCTION_BLOCK FB_MEM_fb_with_temp\nVAR\n\tkept : DINT;\nEND_VAR\nVAR_TEMP\n\tscratch : LREAL;\nEND_VAR\nkept := kept + 1;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "mem_sizeof_fb_with_stat",
    pouName: "FB_MEM_fb_with_stat",
    kind: "function_block" as const,
    feature: "SIZEOF an FB that also declares a VAR_STAT — is the static in the instance?",
    fromDoc: doc,
    plcPrgVar: "inst_fb_with_stat : FB_MEM_fb_with_stat; sz_fb_with_stat : ULINT;",
    plcPrgBody: "sz_fb_with_stat := SIZEOF(inst_fb_with_stat);",
    source: "FUNCTION_BLOCK FB_MEM_fb_with_stat\nVAR\n\tkept : DINT;\nEND_VAR\nVAR_STAT\n\tshared : LREAL;\nEND_VAR\nkept := kept + 1;\nEND_FUNCTION_BLOCK\n",
  },
  // ─── DOES pack_mode DO ANYTHING ON A FUNCTION_BLOCK? ───────────────────────────────────────────────
  // `fieldBytes` reads `{attribute 'pack_mode' := '1'}` only for a STRUCT; for an FB it is ignored, and the review
  // filed that as "never read for a FUNCTION_BLOCK". Whether that is WRONG is unmeasured, and the one recording that
  // touches it says more than the fixture's own title does: `cc4_pack_mode_not_allowed` is named for the belief that
  // only a STRUCT takes the attribute, and CODESYS BUILT IT with no diagnostics at all. So the vendor accepts it on an
  // FB; the open question is whether it PACKS. These answer it by size — the same FB with and without the attribute,
  // holding fields whose alignment padding is visible (a BOOL then a DINT is 5 packed and 8 aligned, plus whatever
  // header an instance carries).
  {
    name: "mem_fb_pack_mode_aligned_baseline",
    pouName: "FB_MEM_fb_pack_mode_aligned_baseline",
    kind: "function_block" as const,
    feature: "SIZEOF an FB with padding-visible fields and NO pack_mode — the baseline",
    fromDoc: doc,
    plcPrgVar: "inst_fb_pack_mode_aligned_baseline : FB_MEM_fb_pack_mode_aligned_baseline; sz_fb_pack_mode_aligned_baseline : ULINT;",
    plcPrgBody: "sz_fb_pack_mode_aligned_baseline := SIZEOF(inst_fb_pack_mode_aligned_baseline);",
    source: "FUNCTION_BLOCK FB_MEM_fb_pack_mode_aligned_baseline\nVAR\n\tflag : BOOL;\n\twide : DINT;\nEND_VAR\nwide := wide + 1;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "mem_fb_pack_mode_one",
    pouName: "FB_MEM_fb_pack_mode_one",
    kind: "function_block" as const,
    feature: "SIZEOF the SAME FB with {attribute 'pack_mode' := '1'} — does the attribute reach an FB?",
    fromDoc: doc,
    plcPrgVar: "inst_fb_pack_mode_one : FB_MEM_fb_pack_mode_one; sz_fb_pack_mode_one : ULINT;",
    plcPrgBody: "sz_fb_pack_mode_one := SIZEOF(inst_fb_pack_mode_one);",
    source: "{attribute 'pack_mode' := '1'}\nFUNCTION_BLOCK FB_MEM_fb_pack_mode_one\nVAR\n\tflag : BOOL;\n\twide : DINT;\nEND_VAR\nwide := wide + 1;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "mem_fb_pack_mode_struct_control",
    pouName: "FB_MEM_fb_pack_mode_struct_control",
    kind: "function_block" as const,
    feature: "the same two fields in a STRUCT with pack_mode := 1 — the control, where the attribute IS read today",
    fromDoc: doc,
    plcPrgVar: "inst_fb_pack_mode_struct_control : FB_MEM_fb_pack_mode_struct_control; sz_fb_pack_mode_struct_control : ULINT;",
    plcPrgBody: "sz_fb_pack_mode_struct_control := SIZEOF(inst_fb_pack_mode_struct_control);",
    source: "{attribute 'pack_mode' := '1'}\nTYPE DUT_MEM_packed :\nSTRUCT\n\tflag : BOOL;\n\twide : DINT;\nEND_STRUCT\nEND_TYPE\n\nFUNCTION_BLOCK FB_MEM_fb_pack_mode_struct_control\nVAR\n\theld : DUT_MEM_packed;\nEND_VAR\nheld.wide := held.wide + 1;\nEND_FUNCTION_BLOCK\n",
  },
  // ─── transpile-review-2026-09-29 task 17: AN ANY INPUT'S pValue IS A RAW BYTE ADDRESS ──────────────────
  // `lower/pointers.ts` binds `v.pValue` to the whole argument AT THE ARGUMENT'S TYPE, so a pointer of another declared
  // type reads (or writes) the argument as if it were its own type. CODESYS reinterprets the bytes (little-endian).
  // One fixture per mismatch; each passes the edge values that make the reinterpretation visible.
  {
    name: "tr_17_any_pvalue_dint_via_real",
    pouName: "F_MEM_tr17_dint_via_real",
    kind: "function" as const,
    feature: "task 17: a DINT passed to an ANY input, read through POINTER TO REAL from pValue — the bits as a REAL",
    fromDoc: doc,
    plcPrgVar:
      "dOne : DINT := 1065353216; dMinusOne : DINT := -1082130432; dZero : DINT := 0; rOne : LREAL; rMinusOne : LREAL; rZero : LREAL;",
    plcPrgBody:
      "rOne := F_MEM_tr17_dint_via_real(v := dOne); rMinusOne := F_MEM_tr17_dint_via_real(v := dMinusOne); rZero := F_MEM_tr17_dint_via_real(v := dZero);",
    source:
      "FUNCTION F_MEM_tr17_dint_via_real : LREAL\nVAR_INPUT\n\tv : ANY;\nEND_VAR\nVAR\n\tpr : POINTER TO REAL;\nEND_VAR\npr := v.pValue;\nF_MEM_tr17_dint_via_real := pr^;\nEND_FUNCTION\n",
  },
  {
    name: "tr_17_any_pvalue_byte_via_sint",
    pouName: "F_MEM_tr17_byte_via_sint",
    kind: "function" as const,
    feature: "task 17: a BYTE passed to an ANY input, read through POINTER TO SINT and halved — the byte's signed view",
    fromDoc: doc,
    plcPrgVar: "b254 : BYTE := 254; b128 : BYTE := 128; b127 : BYTE := 127; h254 : DINT; h128 : DINT; h127 : DINT;",
    plcPrgBody:
      "h254 := F_MEM_tr17_byte_via_sint(v := b254); h128 := F_MEM_tr17_byte_via_sint(v := b128); h127 := F_MEM_tr17_byte_via_sint(v := b127);",
    source:
      "FUNCTION F_MEM_tr17_byte_via_sint : DINT\nVAR_INPUT\n\tv : ANY;\nEND_VAR\nVAR\n\tps : POINTER TO SINT;\nEND_VAR\nps := v.pValue;\nF_MEM_tr17_byte_via_sint := ps^ / 2;\nEND_FUNCTION\n",
  },
  {
    name: "tr_17_any_pvalue_uint_via_int",
    pouName: "F_MEM_tr17_uint_via_int",
    kind: "function" as const,
    feature: "task 17: a UINT passed to an ANY input, read through POINTER TO INT — the word's signed view",
    fromDoc: doc,
    plcPrgVar: "uMax : UINT := 65535; uHigh : UINT := 32768; uOne : UINT := 1; iMax : DINT; iHigh : DINT; iOne : DINT;",
    plcPrgBody:
      "iMax := F_MEM_tr17_uint_via_int(v := uMax); iHigh := F_MEM_tr17_uint_via_int(v := uHigh); iOne := F_MEM_tr17_uint_via_int(v := uOne);",
    source:
      "FUNCTION F_MEM_tr17_uint_via_int : DINT\nVAR_INPUT\n\tv : ANY;\nEND_VAR\nVAR\n\tpi : POINTER TO INT;\nEND_VAR\npi := v.pValue;\nF_MEM_tr17_uint_via_int := pi^;\nEND_FUNCTION\n",
  },
  {
    name: "tr_17_any_pvalue_dint_write_via_byte",
    pouName: "F_MEM_tr17_dint_write_via_byte",
    kind: "function" as const,
    feature: "task 17: pb^ := 16#FF through POINTER TO BYTE from a DINT argument's pValue — only the low byte changes",
    fromDoc: doc,
    plcPrgVar: "dMixed : DINT := 16#01020304; dHigh : DINT := 16#7FFFFF00; okMixed : BOOL; okHigh : BOOL;",
    plcPrgBody:
      "okMixed := F_MEM_tr17_dint_write_via_byte(v := dMixed); okHigh := F_MEM_tr17_dint_write_via_byte(v := dHigh);",
    source:
      "FUNCTION F_MEM_tr17_dint_write_via_byte : BOOL\nVAR_INPUT\n\tv : ANY;\nEND_VAR\nVAR\n\tpb : POINTER TO BYTE;\nEND_VAR\npb := v.pValue;\npb^ := 16#FF;\nF_MEM_tr17_dint_write_via_byte := TRUE;\nEND_FUNCTION\n",
  },
  // ─── transpile-review-2026-09-29 task 26: WHAT A VAR CONSTANT AND AN IMPLEMENTS ADD TO SIZEOF(FB) ─────
  // `lower/bytes.ts` lays out every VAR CONSTANT (the section's `constant` flag is not in its skip list) and never
  // reads `unit.implements`. The baseline is `mem_sizeof_fb_baseline_one_dint`; each variant below adds ONE thing to
  // that same one-DINT FB: a replaced scalar constant, a const_non_replaced one, a struct constant, one interface, two.
  {
    name: "mem_fb_var_constant_scalar",
    pouName: "FB_MEM_fb_var_constant_scalar",
    kind: "function_block" as const,
    feature: "task 26: SIZEOF the one-DINT FB plus a scalar VAR CONSTANT (replaced by the compiler) — is it in the instance?",
    fromDoc: doc,
    plcPrgVar: "inst_fb_var_constant_scalar : FB_MEM_fb_var_constant_scalar; sz_fb_var_constant_scalar : ULINT;",
    plcPrgBody: "sz_fb_var_constant_scalar := SIZEOF(inst_fb_var_constant_scalar);",
    source:
      "FUNCTION_BLOCK FB_MEM_fb_var_constant_scalar\nVAR\n\tkept : DINT;\nEND_VAR\nVAR CONSTANT\n\tc : LINT := 5;\nEND_VAR\nkept := kept + LINT_TO_DINT(c);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "mem_fb_var_constant_non_replaced",
    pouName: "FB_MEM_fb_var_constant_non_replaced",
    kind: "function_block" as const,
    feature: "task 26: the same scalar VAR CONSTANT under {attribute 'const_non_replaced'} — kept as a symbol, in the instance",
    fromDoc: doc,
    plcPrgVar:
      "inst_fb_var_constant_non_replaced : FB_MEM_fb_var_constant_non_replaced; sz_fb_var_constant_non_replaced : ULINT;",
    plcPrgBody: "sz_fb_var_constant_non_replaced := SIZEOF(inst_fb_var_constant_non_replaced);",
    source:
      "FUNCTION_BLOCK FB_MEM_fb_var_constant_non_replaced\nVAR\n\tkept : DINT;\nEND_VAR\nVAR CONSTANT\n\t{attribute 'const_non_replaced'}\n\tc : LINT := 5;\nEND_VAR\nkept := kept + LINT_TO_DINT(c);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "mem_fb_var_constant_struct",
    pouName: "FB_MEM_fb_var_constant_struct",
    kind: "function_block" as const,
    feature: "task 26: a STRUCT-typed VAR CONSTANT (never replaced) — it takes room in the instance",
    fromDoc: doc,
    plcPrgVar: "inst_fb_var_constant_struct : FB_MEM_fb_var_constant_struct; sz_fb_var_constant_struct : ULINT;",
    plcPrgBody: "sz_fb_var_constant_struct := SIZEOF(inst_fb_var_constant_struct);",
    source:
      "TYPE DUT_MEM_kpair :\nSTRUCT\n\twide : LINT;\n\tnarrow : DINT;\nEND_STRUCT\nEND_TYPE\n\nFUNCTION_BLOCK FB_MEM_fb_var_constant_struct\nVAR\n\tkept : DINT;\nEND_VAR\nVAR CONSTANT\n\tc : DUT_MEM_kpair := (wide := 5, narrow := 6);\nEND_VAR\nkept := kept + c.narrow;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "mem_fb_implements_one",
    pouName: "FB_MEM_fb_implements_one",
    kind: "function_block" as const,
    feature: "task 26: SIZEOF the one-DINT FB IMPLEMENTS one interface — does each interface add a pointer?",
    fromDoc: doc,
    plcPrgVar: "inst_fb_implements_one : FB_MEM_fb_implements_one; sz_fb_implements_one : ULINT;",
    plcPrgBody: "sz_fb_implements_one := SIZEOF(inst_fb_implements_one);",
    source:
      "INTERFACE I_MEM_impl_one_a\nMETHOD Ma : DINT\nEND_METHOD\nEND_INTERFACE\n\nFUNCTION_BLOCK FB_MEM_fb_implements_one IMPLEMENTS I_MEM_impl_one_a\nVAR\n\tkept : DINT;\nEND_VAR\nkept := kept + 1;\nEND_FUNCTION_BLOCK\n\nMETHOD Ma : DINT\nMa := kept;\nEND_METHOD\n",
  },
  {
    name: "mem_fb_implements_two",
    pouName: "FB_MEM_fb_implements_two",
    kind: "function_block" as const,
    feature: "task 26: SIZEOF the one-DINT FB IMPLEMENTS two interfaces",
    fromDoc: doc,
    plcPrgVar: "inst_fb_implements_two : FB_MEM_fb_implements_two; sz_fb_implements_two : ULINT;",
    plcPrgBody: "sz_fb_implements_two := SIZEOF(inst_fb_implements_two);",
    source:
      "INTERFACE I_MEM_impl_two_a\nMETHOD Ma : DINT\nEND_METHOD\nEND_INTERFACE\n\nINTERFACE I_MEM_impl_two_b\nMETHOD Mb : DINT\nEND_METHOD\nEND_INTERFACE\n\nFUNCTION_BLOCK FB_MEM_fb_implements_two IMPLEMENTS I_MEM_impl_two_a, I_MEM_impl_two_b\nVAR\n\tkept : DINT;\nEND_VAR\nkept := kept + 1;\nEND_FUNCTION_BLOCK\n\nMETHOD Ma : DINT\nMa := kept;\nEND_METHOD\n\nMETHOD Mb : DINT\nMb := kept + 1;\nEND_METHOD\n",
  },
  // ─── transpile-review-2026-09-29 task 44: A POINTER STEPPED BELOW ITS ARRAY'S FIRST ELEMENT ───────────
  // `lower/pointers.ts` tags array element k as k+1 and 0 as NULL, and a backwards step has no floor: ADR(arr[0])
  // minus one element lands on tag 0 and reads as NULL. In CODESYS a pointer is a byte address, so it is not NULL.
  // Also stepped two elements below and back, so a fix cannot bias only the first step.
  {
    name: "tr_44_pointer_step_below_first_element",
    pouName: "FB_MEM_tr44_step_below",
    kind: "function_block" as const,
    feature: "task 44: ADR(arr[0]) - SIZEOF(INT) is not NULL, and stepping back up reads arr[0] again",
    fromDoc: doc,
    plcPrgVar: "inst_tr44 : FB_MEM_tr44_step_below; isNull : BOOL; back : INT; isNullTwo : BOOL; backTwo : INT;",
    plcPrgBody:
      "inst_tr44();\nisNull := inst_tr44.isNull; back := inst_tr44.back; isNullTwo := inst_tr44.isNullTwo; backTwo := inst_tr44.backTwo;",
    source:
      "FUNCTION_BLOCK FB_MEM_tr44_step_below\nVAR_OUTPUT\n\tisNull : BOOL;\n\tback : INT;\n\tisNullTwo : BOOL;\n\tbackTwo : INT;\nEND_VAR\nVAR\n\tarr : ARRAY[0..3] OF INT := [11, 22, 33, 44];\n\tp : POINTER TO INT;\n\tq : POINTER TO INT;\nEND_VAR\np := ADR(arr[0]);\np := p - SIZEOF(INT);\nisNull := p = 0;\np := p + SIZEOF(INT);\nback := p^;\nq := ADR(arr[0]);\nq := q - 2 * SIZEOF(INT);\nisNullTwo := q = 0;\nq := q + 2 * SIZEOF(INT);\nbackTwo := q^;\nEND_FUNCTION_BLOCK\n",
  },
]
