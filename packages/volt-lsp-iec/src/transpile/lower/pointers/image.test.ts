/**
 * The byte image (model 3, design.md §3.3 step 4d): which variables escape into it, what a data pointer is once they
 * do, and what stays refused by name.
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

const codes = (src: string, name = "P"): string[] => lowerSource(src, name).diagnostics.map((d) => d.code)

/** Lower and run one scan, then read `names` — the interpreter's view of what the program computed. */
function scan(src: string, names: readonly string[], name = "P"): unknown[] {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  const r = run(pou!)
  r.scan()
  return names.map((n) => r.get(n))
}

describe("dynamic memory is refused by its own code (4.2, review 4c)", () => {
  test("a POU whose only statement is `p := __NEW(INT);` is refused dynamic-memory, not lowered", () => {
    expect(codes("PROGRAM P\nVAR p : POINTER TO INT; END_VAR\np := __NEW(INT);\nEND_PROGRAM\n")).toEqual(["dynamic-memory"])
  })
  test("`__DELETE(p)` is refused dynamic-memory, not as a call of no instance", () => {
    expect(codes("PROGRAM P\nVAR p : POINTER TO INT; END_VAR\n__DELETE(p);\nEND_PROGRAM\n")).toEqual(["dynamic-memory"])
  })
})

describe("a data pointer is a byte address into the image", () => {
  test("a pointer stepped one element past an array reads and writes the variable declared after it (pointer_step_past_end)", () => {
    const src = `FUNCTION_BLOCK FB_End
VAR_OUTPUT isNull : BOOL; past : INT; back : INT; afterWritten : INT; END_VAR
VAR arr : ARRAY[0..3] OF INT := [11, 22, 33, 44]; after : INT := 99; p : POINTER TO INT; END_VAR
p := ADR(arr[3]); p := p + SIZEOF(INT); isNull := p = 0; past := p^; p^ := 77; afterWritten := after;
p := p - SIZEOF(INT); back := p^;
END_FUNCTION_BLOCK
PROGRAM P
VAR inst : FB_End; END_VAR
inst();
END_PROGRAM
`
    expect(scan(src, ["inst.isNull", "inst.past", "inst.afterWritten", "inst.back", "inst.after"])).toEqual([false, 99n, 77n, 44n, 77n])
  })

  test("a step below an array's first element is not NULL, and stepping back reads the first element (RC 44)", () => {
    const src = `PROGRAM P
VAR arr : ARRAY[0..2] OF INT := [5, 6, 7]; p : POINTER TO INT; isNull : BOOL; back : INT; END_VAR
p := ADR(arr[0]) - SIZEOF(INT); isNull := p = 0; p := p + SIZEOF(INT); back := p^;
END_PROGRAM
`
    expect(scan(src, ["isNull", "back"])).toEqual([false, 5n])
  })

  test("a latch through a pointer that may name either variable latches the one it names (RC 14)", () => {
    const src = `PROGRAM P
VAR c : BOOL; a : BOOL := TRUE; b : BOOL := TRUE; p : POINTER TO BOOL; END_VAR
p := ADR(a); IF c THEN p := ADR(b); END_IF; p^ R= TRUE;
END_PROGRAM
`
    expect(scan(src, ["a", "b"])).toEqual([false, true])
  })

  test("an instance copied whole keeps the address its pointer field held (RC 15)", () => {
    const src = `FUNCTION_BLOCK FB_C
VAR_INPUT set : INT; END_VAR
VAR x : INT := 5; p : POINTER TO INT := ADR(x); seen : INT; END_VAR
IF set <> 0 THEN x := set; END_IF
seen := p^;
END_FUNCTION_BLOCK
PROGRAM P
VAR a : FB_C; b : FB_C; rb : INT; sameA : BOOL; sameB : BOOL; END_VAR
b := a; a(set := 7); b(set := 0); rb := b.seen; sameA := b.p = ADR(a.x); sameB := b.p = ADR(b.x);
END_PROGRAM
`
    expect(scan(src, ["rb", "b.x", "a.x", "sameA", "sameB"])).toEqual([7n, 5n, 7n, true, false])
  })

  test("a POINTER TO BYTE walks a struct's bytes, its padding included", () => {
    const src = `TYPE T_Pad : STRUCT b : BYTE := 16#11; d : DWORD := 16#A4A3A2A1; END_STRUCT END_TYPE
PROGRAM P
VAR sv : T_Pad; pb : POINTER TO BYTE; b0 : BYTE; b1 : BYTE; b4 : BYTE; END_VAR
pb := ADR(sv); b0 := pb^; b1 := pb[1]; b4 := pb[4];
END_PROGRAM
`
    expect(scan(src, ["b0", "b1", "b4"])).toEqual([0x11n, 0n, 0xa1n])
  })

  test("an access outside every variable the program took the address of faults by name", () => {
    const src = `PROGRAM P
VAR arr : ARRAY[0..1] OF INT; p : POINTER TO INT; v : INT; END_VAR
p := ADR(arr[1]) + 2 * SIZEOF(INT); v := p^;
END_PROGRAM
`
    const { pou, diagnostics } = lowerSource(src, "P")
    expect(diagnostics).toEqual([])
    expect(() => run(pou!).scan()).toThrow("an access through an address outside every variable whose address the program took")
  })
})

describe("what the image does not hold stays a tag", () => {
  test("a pointer to a FUNCTION's local keeps form 1's tag (a region per call is not built)", () => {
    const src = `FUNCTION F : INT
VAR x : INT := 3; p : POINTER TO INT; END_VAR
p := ADR(x); F := p^;
END_FUNCTION
PROGRAM P
VAR v : INT; END_VAR
v := F();
END_PROGRAM
`
    expect(scan(src, ["v"])).toEqual([3n])
  })
})

describe("an instance whose data the image holds is copied by value through a call's arguments (review 4d)", () => {
  const FB_C = `FUNCTION_BLOCK FB_C
VAR_INPUT set : INT; END_VAR
VAR x : INT := 5; p : POINTER TO INT; seen : INT; END_VAR
p := ADR(x); IF set <> 0 THEN x := set; END_IF
seen := p^;
END_FUNCTION_BLOCK
`
  test("an FB-typed VAR_INPUT stored from an instance leaves the source's bytes alone", () => {
    const src = `${FB_C}FUNCTION_BLOCK FB_Outer
VAR_INPUT inner : FB_C; END_VAR
inner(set := 42);
END_FUNCTION_BLOCK
PROGRAM P
VAR a : FB_C; o : FB_Outer; END_VAR
o(inner := a);
END_PROGRAM
`
    expect(scan(src, ["a.x", "o.inner.x"])).toEqual([5n, 42n])
  })
  test("an FB-typed VAR_OUTPUT read with => leaves the copy apart from the output", () => {
    const src = `${FB_C}FUNCTION_BLOCK FB_Outer
VAR_OUTPUT inner : FB_C; END_VAR
inner(set := 42);
END_FUNCTION_BLOCK
PROGRAM P
VAR a : FB_C; o : FB_Outer; ix : INT; END_VAR
o(inner => a); a(set := 7); ix := o.inner.x;
END_PROGRAM
`
    expect(scan(src, ["ix", "a.x"])).toEqual([42n, 7n])
  })
})

describe("a difference of two addresses in one array is measured wherever the array sits (review 4d)", () => {
  test("an FB local array next to a POINTER field", () => {
    const src = `FUNCTION_BLOCK FB
VAR_OUTPUT d : ULINT; END_VAR
VAR arr : ARRAY[0..3] OF INT; q : POINTER TO INT; END_VAR
d := ADR(arr[2]) - ADR(arr[0]);
END_FUNCTION_BLOCK
PROGRAM P
VAR f : FB; END_VAR
f();
END_PROGRAM
`
    expect(scan(src, ["f.d"])).toEqual([4n])
  })
  test("an FB VAR_TEMP array", () => {
    const src = `FUNCTION_BLOCK FB
VAR_OUTPUT d : ULINT; END_VAR
VAR q : POINTER TO INT; END_VAR
VAR_TEMP t : ARRAY[0..3] OF INT; END_VAR
d := ADR(t[2]) - ADR(t[0]);
END_FUNCTION_BLOCK
PROGRAM P
VAR f : FB; END_VAR
f();
END_PROGRAM
`
    expect(scan(src, ["f.d"])).toEqual([4n])
  })
})

describe("an end pointer one past an array orders against the array's own addresses (review 4d)", () => {
  test("`WHILE p < pEnd` over a PROGRAM's array sums it", () => {
    const src = `PROGRAM P
VAR arr : ARRAY[0..3] OF INT := [1, 2, 3, 4]; p : POINTER TO INT; pEnd : POINTER TO INT; sum : INT; END_VAR
p := ADR(arr[0]); pEnd := ADR(arr[0]) + SIZEOF(arr);
WHILE p < pEnd DO sum := sum + p^; p := p + SIZEOF(INT); END_WHILE
END_PROGRAM
`
    expect(scan(src, ["sum"])).toEqual([10n])
  })
  test("`WHILE p < pEnd` over an FB's array followed by a POINTER field sums it", () => {
    const src = `FUNCTION_BLOCK FB
VAR_OUTPUT sum : INT; END_VAR
VAR arr : ARRAY[0..3] OF INT := [1, 2, 3, 4]; p : POINTER TO INT; pEnd : POINTER TO INT; END_VAR
sum := 0; p := ADR(arr[0]); pEnd := ADR(arr[0]) + SIZEOF(arr);
WHILE p < pEnd DO sum := sum + p^; p := p + SIZEOF(INT); END_WHILE
END_FUNCTION_BLOCK
PROGRAM P
VAR f : FB; END_VAR
f();
END_PROGRAM
`
    expect(scan(src, ["f.sum"])).toEqual([10n])
  })
})

describe("a difference of addresses through dereferenced pointers is refused, not folded to 0 (review 4d gate)", () => {
  test("`ADR(p^) - ADR(q^)` of two elements of one array is refused adr-offset (it was folded to 0)", () => {
    const src = `PROGRAM P
VAR a : ARRAY[0..3] OF INT; p : POINTER TO INT; q : POINTER TO INT; d : ULINT; END_VAR
p := ADR(a[3]); q := ADR(a[0]); d := ADR(p^) - ADR(q^);
END_PROGRAM
`
    expect(codes(src)).toEqual(["adr-offset"])
  })
  test("`ADR(p^.g) - ADR(q^.f)` of two different variables is refused adr-offset", () => {
    const src = `TYPE S : STRUCT f : INT; g : DINT; END_STRUCT END_TYPE
PROGRAM P
VAR s1 : S; s2 : S; p : POINTER TO S; q : POINTER TO S; d : ULINT; END_VAR
p := ADR(s1); q := ADR(s2); d := ADR(p^.g) - ADR(q^.f);
END_PROGRAM
`
    expect(codes(src)).toEqual(["adr-offset"])
  })
  test("`ADR(p^[3]) - ADR(p^[0])` through one pointer is refused adr-offset", () => {
    const src = `PROGRAM P
VAR a : ARRAY[0..3] OF INT; p : POINTER TO ARRAY[0..3] OF INT; d : ULINT; END_VAR
p := ADR(a); d := ADR(p^[3]) - ADR(p^[0]);
END_PROGRAM
`
    expect(codes(src)).toEqual(["adr-offset"])
  })
})
