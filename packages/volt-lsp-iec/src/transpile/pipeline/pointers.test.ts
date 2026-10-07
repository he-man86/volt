import { describe, expect, test } from "bun:test"
import { load } from "../index.js"
import { IecFault } from "../semantics/index.js"

// End to end, ST -> lower -> interpreter: the byte layout, pointers, references, ANY.
describe("interp — the executable core", () => {
  // Phase 3 step 6a: the byte layout, as the 64-bit simulator measured it (conformance `mem_sizeof_struct_mixed`,
  // `mem_sizeof_fb_instance`, `mem_member_offsets`) — SIZEOF and a difference of addresses in one variable are constants.
  test("SIZEOF and ADR(a) - ADR(b) follow the measured layout: C alignment, a STRING's terminator, an FB's header", () => {
    const pou = load(
      `TYPE T_Mixed : STRUCT b : BYTE; i : INT; d : DINT; x : BOOL; l : LREAL; END_STRUCT END_TYPE
FUNCTION_BLOCK FB_Sized
VAR b : BYTE; d : DINT; END_VAR
END_FUNCTION_BLOCK
PROGRAM P
VAR
  sv : T_Mixed; arr : ARRAY[0..2] OF T_Mixed; str : STRING; inst : FB_Sized;
  szStruct : ULINT; szArr : ULINT; szBool : ULINT; szString : ULINT; szInst : ULINT; szType : ULINT;
  offI : ULINT; offD : ULINT; offX : ULINT; offL : ULINT; offElement : ULINT;
END_VAR
szStruct := SIZEOF(sv); szArr := SIZEOF(arr); szBool := SIZEOF(sv.x); szString := SIZEOF(str); szInst := SIZEOF(inst);
szType := SIZEOF(T_Mixed);
offI := ADR(sv.i) - ADR(sv); offD := ADR(sv.d) - ADR(sv); offX := ADR(sv.x) - ADR(sv); offL := ADR(sv.l) - ADR(sv);
offElement := ADR(arr[2].d) - ADR(arr[0]);
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect(["szStruct", "szArr", "szBool", "szString", "szInst", "szType"].map((n) => pou.get(n))).toEqual([24n, 72n, 1n, 81n, 16n, 24n])
    expect(["offI", "offD", "offX", "offL", "offElement"].map((n) => pou.get(n))).toEqual([2n, 4n, 8n, 16n, 52n])
  })

  // Phase 3 step 6b: pointers and references with one target (design §9 form 1), as CODESYS recorded them (conformance
  // `type_pointer_to_int`, `mem_pointer_index_struct_array`, `mem_pointer_to_instance_method`, `type_reference_to_int`,
  // `op_sys_isvalidref`, `keyword_null_pointer_init`).
  test("a pointer or reference reaches its one target — elements step, a method runs through it, null faults", () => {
    const source = `TYPE T_Pt : STRUCT x : INT; y : REAL; END_STRUCT END_TYPE
FUNCTION_BLOCK FB_Counter
VAR n : INT; END_VAR
END_FUNCTION_BLOCK
METHOD Bump
n := n + 1;
END_METHOD
PROGRAM P
VAR
  iValue : INT := 7; pInt : POINTER TO INT; iCopy : INT;
  arr : ARRAY[0..4] OF T_Pt; p : POINTER TO T_Pt; q : POINTER TO T_Pt; k : INT;
  viaDeref : INT; viaIndex : INT; viaStep : INT;
  inst : FB_Counter; pInst : POINTER TO FB_Counter; got : INT;
  target : INT := 42; ref1 : REFERENCE TO INT; valid : BOOL; throughRef : INT;
  nullPtr : POINTER TO INT := 0; isNull : BOOL; notNull : BOOL;
END_VAR
pInt := ADR(iValue); iCopy := pInt^; pInt^ := iCopy + 1;
FOR k := 0 TO 4 DO arr[k].x := k * 10; END_FOR
p := ADR(arr[1]); viaDeref := p^.x; viaIndex := p[2].x;
q := p + SIZEOF(T_Pt); viaStep := q^.x; p[3].x := 77;
pInst := ADR(inst); pInst^.Bump(); pInst^.Bump(); got := pInst^.n;
ref1 REF= target; valid := __ISVALIDREF(ref1); throughRef := ref1; ref1 := ref1 + 1;
isNull := (nullPtr = 0); notNull := pInt <> 0;
END_PROGRAM`
    const pou = load(source, "P")
    pou.scan()
    expect([pou.get("iCopy"), pou.get("iValue")]).toEqual([7n, 8n])
    expect([pou.get("viaDeref"), pou.get("viaIndex"), pou.get("viaStep"), pou.get("arr[4].x")]).toEqual([10n, 30n, 20n, 77n])
    expect([pou.get("got"), pou.get("inst.n")]).toEqual([2n, 2n])
    expect([pou.get("valid"), pou.get("throughRef"), pou.get("target")]).toEqual([true, 42n, 43n])
    expect([pou.get("isNull"), pou.get("notNull")]).toEqual([true, true])
    // a dereference of a null pointer stops the program, as it stops the CODESYS application
    const faulting = load("PROGRAM F\nVAR v : INT; ok : INT; pv : POINTER TO INT; END_VAR\npv := ADR(v); pv := 0; ok := pv^;\nEND_PROGRAM\n", "F")
    expect(() => faulting.scan()).toThrow("dereference of a null pointer")
  })

  // `state_any_input_sizes`: an ANY / ANY_NUM input's `diSize` is the argument's byte size, as SIZEOF lays it out — INT 2,
  // LREAL 8, BOOL 1, STRING(10) 11, a {BYTE; DINT} struct 8. Why missed: ANY had no type, so a function taking one was
  // refused — and the one recorded case read a single INT.
  test("an ANY input's diSize is its argument's byte size", () => {
    const pou = load(
      `PROGRAM P
VAR intArg : INT; lrealArg : LREAL; str10 : STRING(10); boolArg : BOOL; pairArg : T_Pair;
  sizeInt : DINT; sizeLreal : DINT; sizeString : DINT; sizeBool : DINT; sizePair : DINT; numLreal : DINT; END_VAR
sizeInt := F_Size(intArg); sizeLreal := F_Size(lrealArg); sizeString := F_Size(str10); sizeBool := F_Size(boolArg);
sizePair := F_Size(pairArg); numLreal := F_NumSize(anyNum := lrealArg);
END_PROGRAM
FUNCTION F_Size : DINT
VAR_INPUT anyArg : ANY; END_VAR
F_Size := anyArg.diSize;
END_FUNCTION
FUNCTION F_NumSize : DINT
VAR_INPUT anyNum : ANY_NUM; END_VAR
F_NumSize := anyNum.diSize;
END_FUNCTION
TYPE T_Pair : STRUCT a : BYTE; b : DINT; END_STRUCT END_TYPE`,
      "P",
    )
    pou.scan()
    expect(["sizeInt", "sizeLreal", "sizeString", "sizeBool", "sizePair", "numLreal"].map((n) => pou.get(n))).toEqual([2n, 8n, 11n, 1n, 8n, 8n])
  })

  // Transpiler review 2026-09-15. Why missed: the reference tests bound one, read it and wrote it with a plain `:=` —
  // none wrote through one any other way, and none compared one with 0.
  test("a reference is written through by every kind of store, and `r = 0` compares its target", () => {
    const pou = load(
      `FUNCTION_BLOCK FB_Out
VAR_OUTPUT q : INT; END_VAR
q := 42;
END_FUNCTION_BLOCK
FUNCTION_BLOCK FB_Add10
VAR_IN_OUT v : INT; END_VAR
v := v + 10;
END_FUNCTION_BLOCK
PROGRAM P
VAR
  n1 : INT; n2 : INT := 1; n3 : INT; flag : BOOL; zero : INT;
  r1 : REFERENCE TO INT; r2 : REFERENCE TO INT; r3 : REFERENCE TO INT; rb : REFERENCE TO BOOL; rz : REFERENCE TO INT;
  out : FB_Out; adder : FB_Add10; m : INT; isZero : BOOL; notZero : BOOL;
END_VAR
r1 REF= n1; r2 REF= n2; r3 REF= n3; rb REF= flag; rz REF= zero;
out(q => r1);
adder(v := r2);
rb S= TRUE;
m := r3 := 5;
isZero := rz = 0;
notZero := rz <> 0;
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect([pou.get("n1"), pou.get("n2"), pou.get("flag"), pou.get("n3"), pou.get("m")]).toEqual([42n, 11n, true, 5n, 5n])
    expect([pou.get("isZero"), pou.get("notZero")]).toEqual([true, false]) // the target is 0 — the reference is bound
  })
})

// Every fixed-text fault is ONE type, `IecFault` (transpile-restructure 1.3a's review): the null dereference through a
// guarded place (`Frame.locate`) and through a several-target pointer (`select`) were plain `RangeError`s.
describe("a null dereference is an IecFault", () => {
  test("through a pointer to one variable", () => {
    const pou = load(
      `PROGRAM P
VAR p : POINTER TO INT; a : INT; x : INT; pick : BOOL; END_VAR
IF pick THEN p := ADR(a); END_IF
x := p^;
END_PROGRAM`,
      "P",
    )
    expect(() => pou.scan()).toThrow(new IecFault("null-dereference"))
    expect(() => pou.scan()).toThrow(IecFault)
  })
  test("through a pointer that may name several variables", () => {
    const pou = load(
      `PROGRAM P
VAR p : POINTER TO INT; a : INT; b : INT; x : INT; pick : BOOL; END_VAR
IF pick THEN p := ADR(a); ELSIF x > 5 THEN p := ADR(b); END_IF
x := p^;
END_PROGRAM`,
      "P",
    )
    expect(() => pou.scan()).toThrow(IecFault)
  })
})
