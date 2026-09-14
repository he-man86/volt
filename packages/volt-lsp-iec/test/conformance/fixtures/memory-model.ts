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
]
