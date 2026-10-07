import { describe, expect, test } from "bun:test"
import { load } from "../index.js"

// End to end, ST -> lower -> interpreter: structs, FB instances, arrays, enums, aliases.
describe("interp — the executable core", () => {
  // Phase 3 step 2 (design §9): the frame is a tree of owned values. Before it, any struct-, FB- or array-typed variable
  // refused the whole POU (`slot-struct`, `slot-function_block`, `slot-array`).
  test("structs, FB instances and arrays are values in the frame — fields, bounds, bits and whole copies", () => {
    const pou = load(
      `TYPE T_Point : STRUCT x : INT := 7; y : INT; END_STRUCT END_TYPE
TYPE T_Line : STRUCT a : T_Point; b : T_Point; flag : BIT; END_STRUCT END_TYPE
FUNCTION_BLOCK FB_Holder
VAR_OUTPUT q : INT := 3; END_VAR
END_FUNCTION_BLOCK
PROGRAM P
VAR
  line1 : T_Line; line2 : T_Line;
  table : ARRAY[1..3] OF T_Point;
  grid : ARRAY[0..1, 5..6] OF INT;
  holder : FB_Holder;
  got : INT; bits : WORD;
END_VAR
line1.a.y := 5;
line1.flag := TRUE;
line2 := line1;
line1.a.y := 99;
table[3].x := line2.a.y;
grid[1, 6] := table[1].x + holder.q;
line1.b.x.1 := FALSE;
got := line1.b.x;
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect([pou.get("line2.a.y"), pou.get("line2.flag"), pou.get("line1.a.y")]).toEqual([5n, true, 99n]) // a copy, not an alias
    expect([pou.get("table[3].x"), pou.get("grid[1][6]"), pou.get("line2.b.x")]).toEqual([5n, 10n, 7n]) // x starts at its field's 7
    expect(pou.get("got")).toBe(5n) // bit 1 cleared on 7 (0b111)
  })

  // Enums and THIS^, as CODESYS recorded them (conformance `type_dut_enum_*`, `cc_enum_*`, `keyword_this_dereference`,
  // `use_self_method_call`). Before them an enum variable, an enum value and `THIS^` each refused the POU.
  test("an enum value is its number and an enum variable its base type; THIS^ is the instance a body runs on", () => {
    const pou = load(
      `TYPE E_Implicit : (Idle, Running, Halted); END_TYPE
TYPE E_Written : (Released := 0, Pressed := 5, HeldLong); END_TYPE
TYPE E_Byte : (LevelA, LevelB) BYTE; END_TYPE
TYPE E_Other : (O0, O1); END_TYPE
FUNCTION_BLOCK FB_Self
VAR count : INT; END_VAR
END_FUNCTION_BLOCK
METHOD Inner
THIS^.count := THIS^.count + 1;
END_METHOD
METHOD Outer
THIS^.Inner();
THIS^.Inner();
END_METHOD
PROGRAM P
VAR
  running : E_Implicit; held : E_Written; level : E_Byte; other : E_Other;
  asWord : WORD; same : BOOL; picked : INT; inst : FB_Self;
END_VAR
running := E_Implicit.Running;
held := HeldLong;
level := E_Byte.LevelB;
asWord := held;
same := running = O1;
CASE held OF
  E_Written.Pressed: picked := 1;
  HeldLong: picked := 2;
END_CASE
inst.Outer();
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect([pou.get("running"), pou.get("held"), pou.get("level"), pou.get("asWord")]).toEqual([1n, 6n, 1n, 6n])
    expect([pou.get("same"), pou.get("picked"), pou.get("inst.count")]).toEqual([true, 2n, 2n])
  })

  // `type_codesys_xint`, `type_implicit_enum_inline`, `type_array_2d` (recorded once the recorder read them): `__XINT` is a
  // LINT on the 64-bit target, an inline enum's value folds as a TYPE enum's does, a 2D element reads as `m[i, j]`. Why
  // missed: the recorder read none of these, so no value ever reached the replay, and `:= Idle` did not fold.
  test("a pointer-width integer, an inline enum's initial value, and a 2D array element read by path", () => {
    const pou = load(
      `PROGRAM P
VAR x : __XINT; state : (Idle, Running, Halted) := Idle; m : ARRAY[0..1, 0..2] OF REAL; wasIdle : BOOL; END_VAR
x := 42;
wasIdle := state = Idle;
state := Running;
m[1, 2] := 1.5;
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect([pou.get("x"), pou.get("state"), pou.get("wasIdle"), pou.get("m[1, 2]"), pou.get("m[0, 0]")]).toEqual([42n, 1n, true, 1.5, 0])
  })

  // `operand_partial_word_in_dword`: the slice counts from the low end. Why missed: `.%W1` parsed (for the LSP) but no
  // transpiler test ever read one — it stopped at "member access is not lowered".
  test("partial access reads a byte or word of an unsigned integer, counted from the low end", () => {
    const pou = load("PROGRAM P\nVAR dw : DWORD := 16#DEADBEEF; w1 : WORD; b3 : BYTE; b0 : BYTE; END_VAR\nw1 := dw.%W1;\nb3 := dw.%B3;\nb0 := dw.%B0;\nEND_PROGRAM", "P")
    pou.scan()
    expect([pou.get("w1"), pou.get("b3"), pou.get("b0")]).toEqual([57005n, 222n, 239n])
  })

  // Why missed: every initializer test wrote `:= …` on the variable itself; the alias case only arrived with the
  // fixtures' run recordings (conformance `type_dut_alias_with_init`, 43 after one `x := x + 1`).
  test("a variable with no initializer starts at its ALIAS type's", () => {
    const pou = load("TYPE T_Start : INT := 42; END_TYPE\nPROGRAM P\nVAR x : T_Start; END_VAR\nx := x + 1;\nEND_PROGRAM\n", "P")
    expect(pou.get("x")).toBe(42n)
    pou.scan()
    expect(pou.get("x")).toBe(43n)
  })

  test("a value set from outside is stored as the slot's type holds it", () => {
    // `set` wrote the raw value, so a test could plant 300 in a SINT — a value no program on the PLC can produce
    const pou = load("PROGRAM P\nVAR si : SINT; rv : REAL; five : STRING(5); END_VAR\nsi := si;\nEND_PROGRAM\n")
    pou.set("si", 300n)
    pou.set("rv", 0.1)
    pou.set("five", "abcdefgh")
    expect([pou.get("si"), pou.get("rv"), pou.get("five")]).toEqual([44n, Math.fround(0.1), "abcde"])
  })
})
