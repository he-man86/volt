/**
 * Memory-model measurements — the facts transpile-st-to-rust design §9's handle-first hybrid is built on (decided
 * 2026-09-14). Recorded BEFORE any of it is implemented: SIZEOF and member offsets (the on-demand byte view), pointer
 * indexing and `p + SIZEOF(T)` over an array of structs (the handle's last index step), a method called through a
 * pointer to an instance, and ADR of a VAR_IN_OUT member (a handle into a caller's place). Each question is its own
 * fixture, so one that does not compile cannot hide the others. Sizes are stored as ULINT: whatever width SIZEOF
 * returns widens into it.
 */
import type { LanguageTest } from "../types.js"

const doc = "transpile-st-to-rust design §9"

export const MEMORY_MODEL_TESTS: readonly LanguageTest[] = [
  {
    name: "mem_sizeof_struct_mixed",
    pouName: "DUT_MEM_mixed",
    kind: "dut",
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
    kind: "dut",
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
    kind: "dut",
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
]
