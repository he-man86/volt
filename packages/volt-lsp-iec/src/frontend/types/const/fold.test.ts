/**
 * constEval — folding a CONSTANT named through its global variable list or its PROGRAM (`GVL_Constants.N`,
 * `XiUnits.MaxVacuums`), as pro2193 sizes arrays. Neither folded: every such array had no size, every such initializer
 * no value (transpiler corpus: `init-not-constant`, "an index on something that is not a sized array").
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../syntax/index.js"
import { bodies, build } from "../../symbols/index.js"
import { constantSlotType, constEval, elementaryType } from "../index.js"

const LISTS = [
  { uri: "file:///p/GVL_Constants.gvl", source: "{attribute 'qualified_only'}\nVAR_GLOBAL CONSTANT\n  Count : INT := 12;\nEND_VAR\nVAR_GLOBAL\n  plain : INT := 3;\nEND_VAR\n" },
  { uri: "file:///p/XiUnits.pou", source: "PROGRAM XiUnits\nVAR\n  runs : INT := 4;\nEND_VAR\nVAR CONSTANT\n  MaxVacuums : USINT := GVL_Constants.Count - 2;\nEND_VAR\nEND_PROGRAM\n" },
]

/** The value of `n := <value>;` in an FB beside `files`. */
function folded(value: string, files: readonly { uri: string; source: string }[] = LISTS): unknown {
  const all = [...files, { uri: "file:///p/F.pou", source: `FUNCTION_BLOCK F\nVAR\n  n : INT;\nEND_VAR\nn := ${value};\nEND_FUNCTION_BLOCK\n` }].map((f) => ({ ...f, parseResult: parseSource(f.source, { networkText: true }) }))
  const project = build.buildSymbolTable(all)
  for (const { scope, statements } of bodies(all.at(-1)!.parseResult.units, project)) {
    const s = statements[0]
    if (s?.kind === "assign") return constEval(s.value, scope)
  }
  throw new Error("no assignment parsed")
}

test("a constant named through its GVL or its PROGRAM folds — its own initializer, in its own scope", () => {
  expect(folded("GVL_Constants.Count")).toBe(12n)
  // a PROGRAM's VAR CONSTANT whose own initializer is qualified in turn
  expect(folded("XiUnits.MaxVacuums * 2")).toBe(20n)
})

test("a variable named through its GVL or its PROGRAM does not fold", () => {
  expect(folded("GVL_Constants.plain")).toBeUndefined()
  expect(folded("XiUnits.runs")).toBeUndefined()
})

// Review of the batch (adversarial verify), each reproduced before its fix. Why missed: every test constant was an
// integer, acyclic, and alone of its name.
test("a cycle does not fold — it recursed forever, freezing the editor's diagnostics", () => {
  expect(folded("P.N", [{ uri: "file:///p/P.pou", source: "PROGRAM P\nVAR CONSTANT\n  N : INT := P.N;\nEND_VAR\nEND_PROGRAM\n" }])).toBeUndefined()
  const lists = [
    { uri: "file:///p/GA.gvl", source: "VAR_GLOBAL CONSTANT\n  X : INT := GB.Y;\nEND_VAR\n" },
    { uri: "file:///p/GB.gvl", source: "VAR_GLOBAL CONSTANT\n  Y : INT := GA.X;\nEND_VAR\n" },
  ]
  expect(folded("GA.X", lists)).toBeUndefined()
  // the bare cycle hung before qualified names folded at all
  expect(folded("X", [{ uri: "file:///p/C.gvl", source: "VAR_GLOBAL CONSTANT\n  X : INT := Y;\n  Y : INT := X;\nEND_VAR\n" }])).toBeUndefined()
})

test("a REAL constant written as an integer is a REAL — `RC / 4` is 2.5, not 2", () => {
  const real = [{ uri: "file:///p/G.gvl", source: "VAR_GLOBAL CONSTANT\n  RC : REAL := 10;\nEND_VAR\n" }, { uri: "file:///p/P.pou", source: "PROGRAM P\nVAR CONSTANT\n  RP : LREAL := 10;\nEND_VAR\nEND_PROGRAM\n" }]
  expect(folded("G.RC / 4", real)).toBe(2.5)
  expect(folded("P.RP / 4", real)).toBe(2.5)
  expect(folded("RC / 4", real)).toBe(2.5)
})

test("inside a list's own initializer a bare name is its sibling first — not another list's constant of that name", () => {
  const lists = [
    { uri: "file:///p/GQ.gvl", source: "{attribute 'qualified_only'}\nVAR_GLOBAL CONSTANT\n  A : INT := 5;\n  B : INT := A * 2;\nEND_VAR\n" },
    { uri: "file:///p/GP.gvl", source: "VAR_GLOBAL CONSTANT\n  A : INT := 100;\nEND_VAR\n" },
  ]
  expect(folded("GQ.B", lists)).toBe(10n)
})

// transpile-review-2026-09-29 task 2 (conformance `named_const_literal_wrap`, `named_const_expression_keeps`, LIVE):
// a constant initialised from a LITERAL holds it at its declared width, as its slot does — but one initialised from a
// constant EXPRESSION keeps the unwrapped value, even read back from the constant itself.
test("a named constant from a literal folds to what its type holds; from an expression, unwrapped", () => {
  const list = [
    { uri: "file:///p/G.gvl", source: "VAR_GLOBAL CONSTANT\n  C : INT := 40000;\n  Q : SINT := 200;\n  K : SINT := 127;\n  D : SINT := K + 1;\n  U : USINT := 255;\n  E : USINT := U + 3;\nEND_VAR\n" },
  ]
  expect(folded("C", list)).toBe(-25536n)
  expect(folded("Q", list)).toBe(-56n)
  expect(folded("D", list)).toBe(128n)
  expect(folded("E", list)).toBe(258n)
})

// transpile-review-2026-09-29 task 2.3 (conformance `named_const_expression_keeps`, recorded: D reads SINT#128, E USINT#258):
// the constant's slot is the same signedness at the first width that holds its unwrapped fold.
test("a constant whose fold its declared type cannot hold gets a slot that can", () => {
  expect(constantSlotType(128n, elementaryType("SINT")!)?.name).toBe("INT")
  expect(constantSlotType(258n, elementaryType("USINT")!)?.name).toBe("UINT")
  expect(constantSlotType(127n, elementaryType("SINT")!)).toBeUndefined()
})

// transpile-review-2026-09-29 task 3 (conformance `real_constant_fold_width`, LIVE): a fold over REAL computes wide and
// rounds ONCE, to float32, at the end — the value its runtime twin reads. An LREAL constant from a REAL one is the literal.
test("an expression over REAL folds wide and rounds once to float32; an LREAL constant keeps the literal", () => {
  const list = [
    { uri: "file:///p/G.gvl", source: "VAR_GLOBAL CONSTANT\n  C01 : REAL := 0.1;\n  CBig : REAL := 16777216;\n  C1 : REAL := 1;\n  C3 : REAL := 3;\n  DChain : LREAL := C01;\nEND_VAR\n" },
  ]
  expect(folded("C01", list)).toBe(0.10000000149011612)
  expect(folded("CBig + 1", list)).toBe(16777216)
  expect(folded("C1 / C3", list)).toBe(0.3333333432674408)
  expect(folded("REAL#0.1 * 1", list)).toBe(0.10000000149011612)
  expect(folded("(CBig + 1) - CBig", list)).toBe(1)
  expect(folded("DChain", list)).toBe(0.1)
  expect(folded("LREAL#0.1 * 1", list)).toBe(0.1)
  expect(folded("0.1", list)).toBe(0.1)
})

// transpile-review-2026-09-29 task 4 (conformance `var_input_constant_default_as_step`, LIVE: F(n := 3) steps by 3): a
// VAR_INPUT CONSTANT is a PARAMETER holding the caller's argument, so its default is not a compile-time constant.
test("a VAR_INPUT CONSTANT parameter does not fold to its default; a VAR CONSTANT beside it does", () => {
  const source = "FUNCTION F : INT\nVAR_INPUT CONSTANT\n  n : INT := 1;\nEND_VAR\nVAR CONSTANT\n  K : INT := 2;\nEND_VAR\nF := n;\nF := K;\nEND_FUNCTION\n"
  const all = [{ uri: "file:///p/F.pou", source, parseResult: parseSource(source, { networkText: true }) }]
  const project = build.buildSymbolTable(all)
  const [{ scope, statements }] = [...bodies(all[0]!.parseResult.units, project)]
  const values = statements.map((s) => (s.kind === "assign" ? constEval(s.value, scope) : null))
  expect(values).toEqual([undefined, 2n])
})

test("a platform-integer CONSTANT's literal initializer is held at the target's width: __XINT on a 64-bit target is LINT (step 4a review)", () => {
  const src = "FUNCTION_BLOCK F\nVAR CONSTANT\n  C : __XINT := 16#FFFF_FFFF_FFFF_FFFF;\nEND_VAR\nVAR\n  l : LINT;\nEND_VAR\nl := C;\nEND_FUNCTION_BLOCK\n"
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "file:///p/F.pou", source: src, parseResult }], [], "codesys", { target: { pointerBits: 64 } })
  const [body] = [...bodies(parseResult.units, project)]
  const s = body!.statements[0]
  expect(s?.kind === "assign" ? constEval(s.value, body!.scope) : undefined).toBe(-1n)
})

// frontend-conformance 4.6.1 (CE6, CE9; conformance `ce_fold_*`, `ce_real_alias_const`, both vendors 2026-10-03): every
// value below is the bound CODESYS folded, named in its "The constant index '30000' is not within the range from '0' to
// '<fold>'" — a conversion, a pure built-in, SIZEOF, an enum value, NOT on an integer and the shifts fold as the
// transpiler folds them. constEval answered nothing for every one.
const FOLD_FILES = [
  { uri: "file:///p/E.dut", source: "TYPE E :\n(\n  First,\n  Second,\n  Third := 7\n);\nEND_TYPE\n" },
  { uri: "file:///p/A.dut", source: "TYPE A : REAL;\nEND_TYPE\n" },
  {
    uri: "file:///p/K.gvl",
    source:
      "VAR_GLOBAL CONSTANT\n  KC : DINT := INT_TO_DINT(3);\n  KB : BYTE := 250;\n  KE : INT := E.Third;\n  KR : A := 10;\nEND_VAR\n" +
      "VAR_GLOBAL\n  lr : LREAL;\n  arr : ARRAY[0..2] OF INT;\n  txt : STRING(10);\n  v : INT;\nEND_VAR\n",
  },
]

test("a conversion folds: the target's width wraps it, a REAL rounds half away from zero, BOOL and TIME convert (CE6)", () => {
  expect(folded("KC", FOLD_FILES)).toBe(3n)
  expect(folded("TO_DINT(5)", FOLD_FILES)).toBe(5n)
  expect(folded("INT_TO_USINT(300)", FOLD_FILES)).toBe(44n)
  expect(folded("INT_TO_SINT(200)", FOLD_FILES)).toBe(-56n)
  expect(folded("REAL_TO_INT(2.5)", FOLD_FILES)).toBe(3n)
  expect(folded("REAL_TO_INT(-2.5)", FOLD_FILES)).toBe(-3n)
  expect(folded("REAL_TO_DINT(3.0E9)", FOLD_FILES)).toBe(-1294967296n)
  expect(folded("TRUNC(7.9)", FOLD_FILES)).toBe(7n)
  expect(folded("BOOL_TO_INT(TRUE)", FOLD_FILES)).toBe(1n)
  expect(folded("TIME_TO_DINT(T#5MS)", FOLD_FILES)).toBe(5n)
  expect(folded("TIME_TO_DINT(T#1S500MS)", FOLD_FILES)).toBe(1500n)
  expect(folded("DINT_TO_INT(INT_TO_DINT(4) + 2)", FOLD_FILES)).toBe(6n)
  expect(folded("UINT_TO_DWORD(3)", FOLD_FILES)).toBe(3n)
})

test("the pure built-ins fold (CE6)", () => {
  expect(folded("ABS(-3)", FOLD_FILES)).toBe(3n)
  expect(folded("MIN(5, 3)", FOLD_FILES)).toBe(3n)
  expect(folded("MAX(2, 4)", FOLD_FILES)).toBe(4n)
  expect(folded("MIN(3, MAX(1, 2))", FOLD_FILES)).toBe(2n)
  expect(folded("LIMIT(0, 9, 5)", FOLD_FILES)).toBe(5n)
  expect(folded("SEL(TRUE, 1, 6)", FOLD_FILES)).toBe(6n)
  expect(folded("MUX(1, 2, 7, 9)", FOLD_FILES)).toBe(7n)
  expect(folded("LREAL_TO_INT(EXPT(2, 3))", FOLD_FILES)).toBe(8n)
  expect(folded("ABS(-7) + 1", FOLD_FILES)).toBe(8n)
})

test("SIZEOF folds — of a type, a variable, an array and a STRING (CE6)", () => {
  expect(folded("SIZEOF(DINT)", FOLD_FILES)).toBe(4n)
  expect(folded("SIZEOF(lr)", FOLD_FILES)).toBe(8n)
  expect(folded("SIZEOF(arr)", FOLD_FILES)).toBe(6n)
  expect(folded("SIZEOF(txt)", FOLD_FILES)).toBe(11n)
})

test("an enum value folds — qualified, converted, and through a constant (CE6)", () => {
  expect(folded("E.Third", FOLD_FILES)).toBe(7n)
  expect(folded("E.Second", FOLD_FILES)).toBe(1n)
  expect(folded("TO_INT(E.Third)", FOLD_FILES)).toBe(7n)
  expect(folded("KE", FOLD_FILES)).toBe(7n)
})

test("NOT on an integer computes in the unsigned integer of its width (CE9)", () => {
  expect(folded("NOT BYTE#250", FOLD_FILES)).toBe(5n)
  expect(folded("NOT WORD#65530", FOLD_FILES)).toBe(5n)
  // an untyped literal has no width without a context (`integerTypeOf`; the bound's narrowest is an accepted loss)
  expect(folded("NOT 250", FOLD_FILES)).toBeUndefined()
  expect(folded("NOT INT#-5", FOLD_FILES)).toBe(4n)
  expect(folded("NOT KB", FOLD_FILES)).toBe(5n)
})

test("the shifts and rotations fold at their operand's width (CE9)", () => {
  expect(folded("SHL(BYTE#1, 3)", FOLD_FILES)).toBe(8n)
  expect(folded("SHL(BYTE#255, 1)", FOLD_FILES)).toBe(254n)
  expect(folded("SHL(1, 3)", FOLD_FILES)).toBeUndefined()
  expect(folded("SHR(WORD#80, 4)", FOLD_FILES)).toBe(5n)
  expect(folded("ROL(BYTE#129, 1)", FOLD_FILES)).toBe(3n)
  expect(folded("ROR(BYTE#129, 1)", FOLD_FILES)).toBe(192n)
  expect(folded("SHL(UINT_TO_DWORD(3), 16)", FOLD_FILES)).toBe(196608n)
  expect(folded("(SHL(UINT_TO_DWORD(3), 16) OR 16#1)", FOLD_FILES)).toBe(196609n)
})

test("a REAL constant declared through an alias is a REAL — `KR / 4` is 2.5 (CE9)", () => {
  expect(folded("KR / 4", FOLD_FILES)).toBe(2.5)
  expect(folded("REAL_TO_INT(KR / 4)", FOLD_FILES)).toBe(3n)
})

// a built-in's own name is reserved (`FUNCTION ABS` does not parse), a conversion's is not: a project may declare INT_TO_DINT
test("a call of a variable's value, or of a function the project declares under a conversion's name, does not fold", () => {
  expect(folded("ABS(v)", FOLD_FILES)).toBeUndefined()
  const shadow = [...FOLD_FILES, { uri: "file:///p/F2.pou", source: "FUNCTION INT_TO_DINT : DINT\nVAR_INPUT\n  x : INT;\nEND_VAR\nINT_TO_DINT := 1;\nEND_FUNCTION\n" }]
  expect(folded("INT_TO_DINT(3)", shadow)).toBeUndefined()
})

// frontend-conformance 4.7.2 / 4.7.3 (rules DT4, DT6; `dt_union_*sizeof_bound`, `dt_union_member_sizes`,
// `dt_enum_*_storage`, both vendors 2026-10-03): a UNION is as large as its largest member, rounded up to its most aligned
// member; an enum is stored as its written base, else an INT — an implicit enum too.
const STORAGE_FILES = [
  { uri: "file:///p/U1.dut", source: "TYPE U1 :\nUNION\n  b : BYTE;\n  d : DWORD;\nEND_UNION\nEND_TYPE\n" },
  { uri: "file:///p/U2.dut", source: "TYPE U2 :\nUNION\n  b : BYTE;\n  arr : ARRAY[0..4] OF BYTE;\nEND_UNION\nEND_TYPE\n" },
  { uri: "file:///p/U3.dut", source: "TYPE U3 :\nUNION\n  l : LREAL;\n  i : INT;\nEND_UNION\nEND_TYPE\n" },
  { uri: "file:///p/EB.dut", source: "TYPE EB :\n(\n  A,\n  B := 200\n) BYTE;\nEND_TYPE\n" },
  { uri: "file:///p/EP.dut", source: "TYPE EP :\n(\n  A,\n  B\n);\nEND_TYPE\n" },
  {
    uri: "file:///p/S.gvl",
    source: "VAR_GLOBAL\n  u1 : U1;\n  u2 : U2;\n  u3 : U3;\n  eb : EB;\n  ep : EP;\n  ei : (Ia, Ib);\n  ae : ARRAY[0..2] OF EB;\nEND_VAR\n",
  },
]

test("SIZEOF of a union is its largest member's size, rounded up to its most aligned member (DT4)", () => {
  expect(folded("SIZEOF(u1)", STORAGE_FILES)).toBe(4n)
  expect(folded("SIZEOF(u2)", STORAGE_FILES)).toBe(5n)
  expect(folded("SIZEOF(u3)", STORAGE_FILES)).toBe(8n)
})

test("SIZEOF of an enum is its storage: the written base, else INT (DT6)", () => {
  expect(folded("SIZEOF(eb)", STORAGE_FILES)).toBe(1n)
  expect(folded("SIZEOF(ep)", STORAGE_FILES)).toBe(2n)
  expect(folded("SIZEOF(ei)", STORAGE_FILES)).toBe(2n)
  expect(folded("SIZEOF(ae)", STORAGE_FILES)).toBe(3n)
})

// `ce_fold_untyped_in_context_values`, `ce_fold_untyped_shl_in_context_values` (CODESYS 2026-10-03): in a CONSTANT of a
// declared type an untyped literal takes that type — `NOT 0` into a WORD is 65535, not the 255 of its narrowest USINT.
test("an untyped literal under NOT or a shift takes the declared type of the constant it initializes", () => {
  const files = [{ uri: "file:///p/C.gvl", source: "VAR_GLOBAL CONSTANT\n  KW : WORD := NOT 0;\n  KD : DWORD := SHL(1, 20);\n  KB : BYTE := ROL(16#81, 1);\nEND_VAR\n" }]
  expect(folded("KW", files)).toBe(65535n)
  expect(folded("KD", files)).toBe(1048576n)
  expect(folded("KB", files)).toBe(3n)
  // …and with no context, no width at all: the transpiler folds `NOT 0` by itself, where 255 would be wrong
  expect(folded("NOT 0", files)).toBeUndefined()
})

// Step 4d review (adversarial verify), each reproduced before its fix.
// SIZEOF folds through the operand's type, whose resolution folds its bounds: a size that reaches itself recursed until
// the stack overflowed — no diagnostics at all for the file, not even its parse errors. It does not fold.
test("a SIZEOF that reaches its own size through a bound does not fold — it overflowed the stack", () => {
  const gvl = (source: string): { uri: string; source: string }[] => [{ uri: "file:///p/G.gvl", source }]
  const viaConstant = gvl("VAR_GLOBAL CONSTANT\n  c : DINT := SIZEOF(arr);\nEND_VAR\nVAR_GLOBAL\n  arr : ARRAY[0..c] OF INT;\nEND_VAR\n")
  expect(folded("c", viaConstant)).toBeUndefined()
  expect(folded("SIZEOF(arr)", viaConstant)).toBeUndefined()
  expect(folded("SIZEOF(a)", gvl("VAR_GLOBAL\n  a : ARRAY[0..SIZEOF(a)] OF INT;\nEND_VAR\n"))).toBeUndefined()
  // (a subrange's own bound does not fold inside itself, so the variable reads as its base: an INT, 2 bytes)
  expect(() => folded("SIZEOF(x)", gvl("VAR_GLOBAL\n  x : INT (0..SIZEOF(x));\nEND_VAR\n"))).not.toThrow()
  expect(folded("SIZEOF(q)", gvl("VAR_GLOBAL\n  q : STRING(SIZEOF(q));\nEND_VAR\n"))).toBeUndefined()
  expect(folded("SIZEOF(a)", gvl("VAR_GLOBAL\n  a : ARRAY[0..SIZEOF(b)] OF INT;\n  b : ARRAY[0..SIZEOF(a)] OF INT;\nEND_VAR\n"))).toBeUndefined()
})

// A duration's ticks are what a CONVERSION reads; MIN/MAX/LIMIT/SEL/MUX of TIMEs yield a TIME, which no fold here holds —
// it folded to the bare tick count, an integer constant wherever it was named (an array bound sized 0..2000).
test("a TIME inside a built-in that is no conversion does not fold to its ticks", () => {
  const files = [{ uri: "file:///p/T.gvl", source: "VAR_GLOBAL CONSTANT\n  k : TIME := MAX(T#1S, T#2S);\nEND_VAR\n" }]
  expect(folded("k", files)).toBeUndefined()
  expect(folded("k * 2", files)).toBeUndefined()
  expect(folded("SEL(TRUE, T#1S, T#3S)", files)).toBeUndefined()
  expect(folded("LIMIT(T#0S, T#5S, T#2S)", files)).toBeUndefined()
  expect(folded("MAX(T#1S, T#2S) / 3", files)).toBeUndefined()
  // …while a conversion still reads them
  expect(folded("TIME_TO_DINT(T#5MS)", files)).toBe(5n)
})

// The context's type reaches an untyped literal only where it was recorded: at the top of an UNSIGNED constant's
// initializer, under NOT or a shift (`ce_fold_untyped_*_in_context_values`). Through an operator, a built-in's argument, or
// into a SIGNED constant (`c3 : INT := NOT 5` is refused by both vendors) it is unmeasured — no width, no fold.
test("an untyped literal takes a constant's type only at its initializer's top, and only an unsigned one", () => {
  const files = [
    {
      uri: "file:///p/C.gvl",
      source: "VAR_GLOBAL CONSTANT\n  KI : INT := SHL(1, 15);\n  KY : BYTE := SHL(1, 20) / 4096;\n  KM : WORD := MAX(1, 2) + NOT 0;\n  KP : WORD := (NOT 0);\nEND_VAR\n",
    },
  ]
  expect(folded("KI", files)).toBeUndefined()
  expect(folded("KY", files)).toBeUndefined()
  expect(folded("KM", files)).toBeUndefined()
  expect(folded("KP", files)).toBeUndefined()
})

// Step 4d review, recorded (`dt_union_wstring_sizeof_bound`, both vendors 2026-10-03): a WSTRING aligns to its code unit,
// 2 — the union of a WSTRING(1) (4 bytes) and five bytes is 6, not the 5 an alignment of 1 gave.
test("a WSTRING member aligns a union to 2", () => {
  const files = [
    { uri: "file:///p/UW.dut", source: "TYPE UW :\nUNION\n  w : WSTRING(1);\n  arr : ARRAY[0..4] OF BYTE;\nEND_UNION\nEND_TYPE\n" },
    { uri: "file:///p/W.gvl", source: "VAR_GLOBAL\n  uw : UW;\nEND_VAR\n" },
  ]
  expect(folded("SIZEOF(uw)", files)).toBe(6n)
})

// Step 4d review 2: a constant typed by an alias whose bound names the constant (`TYPE A : INT(0..c)`, `c : A := 5`)
// resolved the alias inside its own fold — the bound folded the constant again, and the stack overflowed.
test("a constant typed by an alias whose bound names it does not overflow the stack", () => {
  const files = (type: string, gvl: string): { uri: string; source: string }[] => [
    { uri: "file:///p/A.dut", source: type },
    { uri: "file:///p/GVL.gvl", source: gvl },
  ]
  expect(() => folded("c", files("TYPE A : INT(0..c);\nEND_TYPE\n", "VAR_GLOBAL CONSTANT\n  c : A := 5;\nEND_VAR\n"))).not.toThrow()
  expect(() => folded("c", files("TYPE S : STRING(c);\nEND_TYPE\n", "VAR_GLOBAL CONSTANT\n  c : S := 'x';\nEND_VAR\n"))).not.toThrow()
  expect(() => folded("c", files("TYPE A : INT(0..GVL.c);\nEND_TYPE\n", "VAR_GLOBAL CONSTANT\n  c : A := 5;\nEND_VAR\n"))).not.toThrow()
  expect(() => folded("c", files("TYPE A : INT(0..d);\nEND_TYPE\n", "VAR_GLOBAL CONSTANT\n  c : A := 5;\n  d : INT := c;\nEND_VAR\n"))).not.toThrow()
})

// Step 4d review 2: an enum member's value is its own written value, or the nearest written one before it plus the
// distance — a sibling's value that does not fold (here: it names the constant being folded) leaves it alone.
test("an enum member folds without its siblings", () => {
  const files = [
    { uri: "file:///p/E.dut", source: "TYPE E :\n(\n  A := 1,\n  B,\n  C := k\n);\nEND_TYPE\n" },
    { uri: "file:///p/GVL.gvl", source: "VAR_GLOBAL CONSTANT\n  k : INT := E.A;\n  k2 : INT := E.B;\nEND_VAR\n" },
  ]
  expect(folded("k", files)).toBe(1n)
  expect(folded("k2", files)).toBe(2n)
})

// Step 4d review 2: the context type reaches only an untyped literal directly under the NOT or the shift an UNSIGNED
// constant's initializer is (the measured cells) — not a conversion's argument, not a NOT nested in a shift. Unmeasured
// there, so no width and no value: `DWORD_TO_WORD(NOT 0)` folded to 65535 and `DWORD_TO_INT(NOT 0)` to -1.
test("the context type does not reach a conversion's argument or a NOT under a shift", () => {
  const files = [{ uri: "file:///p/C.gvl", source: "VAR_GLOBAL CONSTANT\n  KX : WORD := DWORD_TO_WORD(NOT 0);\n  KS : INT := DWORD_TO_INT(NOT 0);\n  KQ : DWORD := SHL(NOT 0, 4);\nEND_VAR\n" }]
  expect(folded("KX", files)).toBeUndefined()
  expect(folded("KS", files)).toBeUndefined()
  expect(folded("KQ", files)).toBeUndefined()
  expect(folded("DWORD_TO_INT(NOT 0)", files)).toBeUndefined()
  // a conversion still reads its literal argument (`INT_TO_USINT(300)` is 44, `ce_fold_conversion_bound_*`)
  expect(folded("INT_TO_USINT(300)", files)).toBe(44n)
})

