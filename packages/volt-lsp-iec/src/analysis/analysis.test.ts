import { test, expect } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { buildSymbolTable } from "../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type DiagnosticItem, type Vendor } from "./index.js"

function diag(src: string, vendor: Vendor): DiagnosticItem[] {
  const parseResult = parseSource(src, vendor)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
}

const codes = (src: string, v: Vendor): string[] =>
  diag(src, v)
    .map((d) => d.code)
    .sort()

// FP-bait battery: code the live compilers ACCEPT (verified against the live compilers, 2026-07-07). Each must
// produce ZERO error-severity diagnostics — these are the near-miss cases where a type check is most likely
// to over-fire. This is what caught the (now-removed) overflow check's false positives.
test("type checks do not false-positive on compiler-accepted code", () => {
  const accepts = [
    "x : REAL;\nEND_VAR\nx := 5;", // int literal → REAL
    "x : LREAL;\nEND_VAR\nx := 5;", // int literal → LREAL
    "x : INT; y : DINT;\nEND_VAR\ny := x;", // widening
    "w : WORD;\nEND_VAR\nw := 16#FF;", // hex → WORD
    "x : INT; w : WORD;\nEND_VAR\nx := w;", // WORD → INT (compiler warns, never errors)
    // string literal. This was `s : STRING; s := 'abc'` — NOT compiler-accepted: CODESYS rejects the NAME `s` (the set
    // keyword), "Unexpected token 's' found" at the declaration and the use (conformance cc_reserved_name_s_string).
    // The battery was verified for the string assignment, never for the variable name.
    "sText : STRING;\nEND_VAR\nsText := 'abc';",
    "t : TIME;\nEND_VAR\nt := T#1S;", // time literal
    "x : INT; y : DINT; z : DINT;\nEND_VAR\nz := x + y;", // mixed-width arithmetic
    "x : REAL; y : INT; z : REAL;\nEND_VAR\nz := x + y;", // real + int
    "x : BYTE; y : WORD; z : WORD;\nEND_VAR\nz := x AND y;", // bitwise mixed width
    "x : INT := 40000;\nEND_VAR", // out-of-range literal — compiler accepts (conversion), not an error
    "x : INT := 30000 + 10000;\nEND_VAR", // const-expr over max — compiler accepts
    "p : POINTER TO INT; x : INT;\nEND_VAR\nx := p^;", // valid deref
  ]
  for (const decls of accepts) {
    const src = `FUNCTION_BLOCK F\nVAR\n${decls}\nEND_FUNCTION_BLOCK`
    const errs = diag(src, "codesys").filter((d) => d.severity === "error")
    expect(errs.map((d) => `${decls} → ${d.code}`)).toEqual([])
  }
})

test("clean code produces no diagnostics (no false positives)", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n a : INT; b : INT;\nEND_VAR\na := b + 1;\nEND_FUNCTION_BLOCK`
  expect(diag(src, "codesys")).toEqual([])
  expect(diag(src, "twincat")).toEqual([])
})

// The active IDE is used because CODESYS and TwinCAT diverge — same input, different wording.
test("vendor-keyed wording: narrowing LREAL→REAL", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n rv : REAL; l : LREAL;\nEND_VAR\nrv := l;\nEND_FUNCTION_BLOCK`
  expect(diag(src, "codesys")[0]?.message).toBe(
    "Implicit conversion from 'LREAL' to 'REAL': Possible loss of information",
  )
  expect(diag(src, "twincat")[0]?.message).toBe(
    "Implicit conversion from 'LREAL' to 'REAL': possible loss of information",
  )
})

test("vendor-keyed wording: MOD on REAL", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n a : REAL; b : REAL; c : REAL;\nEND_VAR\nc := a MOD b;\nEND_FUNCTION_BLOCK`
  expect(diag(src, "codesys").find((d) => d.code === "binary-op-type-mismatch")?.message).toBe(
    "MOD is not defined for REAL",
  )
  expect(diag(src, "twincat").find((d) => d.code === "binary-op-type-mismatch")?.message).toBe(
    "'MOD' is not defined for 'REAL'",
  )
})

// A reserved IL operator used as a name: both vendors echo the token back, and capitalise the word
// differently while they do it (conformance `echo_*`, both recordings 2026-09-20).
test("vendor-keyed wording: the echoed unexpected token", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n LT : BOOL;\n ok : BOOL;\nEND_VAR\nok := TRUE;\nEND_FUNCTION_BLOCK`
  expect(diag(src, "codesys").map((d) => d.message)).toContain("Unexpected token 'LT' found")
  expect(diag(src, "twincat").map((d) => d.message)).toContain("Unexpected Token 'LT' found")
})

// A BOOL OPERAND IS NOT A MOD REFUSAL. Both vendors take `aBool MOD anInt` as arithmetic and complain about the
// conversion, exactly as they do for + - * / (`meet_bool_*_int`, both recordings 2026-09-20); the LSP used to
// answer MOD with a rule neither compiler has.
test("MOD on a BOOL is the conversion message, not a refusal", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n flag : BOOL; i : INT; out : INT;\nEND_VAR\nout := flag MOD i;\nEND_FUNCTION_BLOCK`
  const message = "Cannot convert type 'BOOL' to type 'INT'"
  expect(diag(src, "codesys").find((d) => d.code === "binary-op-type-mismatch")?.message).toBe(message)
  expect(diag(src, "twincat").find((d) => d.code === "binary-op-type-mismatch")?.message).toBe(message)
})

// THE VOCABULARY IS THE VENDOR'S TOO, not just the wording. `__POSITION` is a CODESYS operator with a value;
// TwinCAT has no such name and says so — "Identifier '__POSITION' not defined" — so it must not be TYPED there
// either, or the LSP invents a conversion error about a STRING that does not exist (`sysop_position_*`, both
// recordings 2026-09-20).
test("a CODESYS-only operator is an undefined identifier on TwinCAT", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n here : DINT;\nEND_VAR\nhere := __POSITION();\nEND_FUNCTION_BLOCK`
  expect(diag(src, "codesys").map((d) => d.message)).toEqual(["Cannot convert type 'STRING' to type 'DINT'"])
  // …and all THREE of TwinCAT's own messages for it, in the order its recording of `sysop_position_call_form`
  // carries them — the third arrived when `checkUnknownSource` stopped being gated to CODESYS on a premise that
  // was only ever "unmeasured".
  expect(diag(src, "twincat").map((d) => d.message)).toEqual([
    "Identifier '__POSITION' not defined",
    "Program name, function or function block instance expected instead of '__POSITION'",
    "Cannot convert type 'Unknown type: '__POSITION()'' to type 'DINT'",
  ])
})

// THE TWO `__XADD`s ARE MIRROR IMAGES. CODESYS takes the ADDRESS of the counter and refuses the counter;
// TwinCAT takes the counter and refuses the address, and hands back the operand's own type where CODESYS
// always returns DINT (`atomic_xadd_*`, six operand types on both recordings, 2026-09-20).
test("__XADD: CODESYS wants the pointer, TwinCAT wants the value", () => {
  const call = (decl: string, arg: string) =>
    `FUNCTION_BLOCK F\nVAR\n${decl}\n res : DINT;\nEND_VAR\nres := __XADD(${arg}, 1);\nEND_FUNCTION_BLOCK`
  const of = (src: string, v: Vendor) => diag(src, v).map((d) => d.message)

  const value = call(' n : DINT;', 'n')
  expect(of(value, "codesys")).toEqual(["Cannot convert type 'DINT' to type 'POINTER TO DINT'"])
  expect(of(value, "twincat")).toEqual([])

  const pointer = call(' p : POINTER TO DINT;', 'p')
  expect(of(pointer, "codesys")).toEqual([])
  expect(of(pointer, "twincat")).toEqual(["Cannot convert type 'POINTER TO DINT' to type 'DINT'"])

  // the RESULT follows the operand on TwinCAT: a DINT counter into an INT is a conversion there, not here
  const intRes = `FUNCTION_BLOCK F\nVAR\n n : INT;\n res : INT;\nEND_VAR\nres := __XADD(n, 1);\nEND_FUNCTION_BLOCK`
  expect(of(intRes, "twincat")).toEqual([])
})

// A SIGN CROSSING AT AN ARGUMENT IS CODESYS'S WARNING ALONE — TwinCAT warns for every assignment and for none
// of these (`cc_enum_arg_into_{uint,udint,word,dword}` and `atomic_xadd_{dword,lword}`, 2026-09-20).
test("a sign change at an ARGUMENT warns on CODESYS only", () => {
  const src = `FUNCTION F_u : INT\nVAR_INPUT\n u : UINT;\nEND_VAR\nF_u := 1;\nEND_FUNCTION\n\nFUNCTION_BLOCK F\nVAR\n si : INT;\n out : INT;\nEND_VAR\nout := F_u(si);\nEND_FUNCTION_BLOCK`
  expect(diag(src, "codesys").map((d) => d.message)).toEqual([
    "Implicit conversion from signed Type 'INT' to unsigned Type 'UINT' : Possible change of sign",
  ])
  expect(diag(src, "twincat").map((d) => d.message)).toEqual([])
})
// A SIGN CROSSING IN A COMPARISON HAS A 32-BIT FLOOR, and the floor is CODESYS's. Both warn at DINT/UDINT and
// LINT/ULINT; at SINT/USINT and INT/UINT only TwinCAT does (all 24 `cmp_sign_*` cells, six operators at four
// widths, both recordings 2026-09-20).
test("a narrow comparison warns on TwinCAT only", () => {
  const cmp = (t: string, u: string) =>
    `FUNCTION_BLOCK F\nVAR\n si : ${t};\n un : ${u};\n ok : BOOL;\nEND_VAR\nok := si > un;\nEND_FUNCTION_BLOCK`
  const of = (src: string, v: Vendor) => diag(src, v).map((d) => d.message)

  expect(of(cmp("INT", "UINT"), "codesys")).toEqual([])
  expect(of(cmp("INT", "UINT"), "twincat")).toEqual([
    "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT' : possible change of sign",
  ])
  // …and at 32 bits they agree, down to the capital on "Possible"
  expect(of(cmp("DINT", "UDINT"), "codesys")).toEqual([
    "Implicit conversion from unsigned Type 'UDINT' to signed Type 'DINT' : Possible change of sign",
  ])
  expect(of(cmp("DINT", "UDINT"), "twincat")).toEqual([
    "Implicit conversion from unsigned Type 'UDINT' to signed Type 'DINT' : possible change of sign",
  ])
})
// TWINCAT NEVER SAYS THE SAME THING TWICE ON ONE LINE. CODESYS does — an over-long string constant in a
// declaration warns once for the declaration and once for the initialization, at two spans on one line, and 111
// of 2541 CODESYS fixtures carry a repeat like that where ZERO TwinCAT fixtures do (both recordings 2026-09-20).
test("TwinCAT collapses a message repeated on one line", () => {
  const src = `FUNCTION_BLOCK F
VAR
 two : STRING(4) := 'abcdef';
END_VAR
END_FUNCTION_BLOCK`
  const msg = "String constant ''...' too long for destination type 'STRING(4)'"
  expect(diag(src, "codesys").map((d) => d.message)).toEqual([msg, msg])
  expect(diag(src, "twincat").map((d) => d.message)).toEqual([msg])
})
// A BITWISE OPERATOR COMPUTES IN THE UNSIGNED INTEGER OF ITS WIDTH. `out := a AND b` with LINT operands is three
// warnings on CODESYS — one per operand going in, one for the result coming back out — and the LSP answered with
// silence, because it typed the result LINT and saw no conversion (`bit_{and,or,xor}_{sint,int,dint,lint}`).
test("a bitwise operator on signed operands converts, both ways", () => {
  const src = `FUNCTION_BLOCK F
VAR
 a : LINT;
 b : LINT;
 out : LINT;
END_VAR
out := a AND b;
END_FUNCTION_BLOCK`
  const inward = "Implicit conversion from signed Type 'LINT' to unsigned Type 'ULINT' : Possible change of sign"
  const outward = "Implicit conversion from unsigned Type 'ULINT' to signed Type 'LINT' : Possible change of sign"
  expect(diag(src, "codesys").map((d) => d.message).sort()).toEqual([inward, inward, outward].sort())
  // …and TwinCAT collapses the two identical ones onto their shared line
  expect(diag(src, "twincat").map((d) => d.message).length).toBe(2)
  // an UNSIGNED pair converts nowhere and stays silent
  const un = `FUNCTION_BLOCK F
VAR
 a : ULINT;
 b : ULINT;
 out : ULINT;
END_VAR
out := a AND b;
END_FUNCTION_BLOCK`
  expect(diag(un, "codesys")).toEqual([])
})
// ARITHMETIC MEETS ITS OPERANDS, and both convert into the meet — which is where a conversion can lose
// information without either operand being the destination (`meet_ulint_mod_sint`, `meet_lint_plus_real`).
test("both operands convert into an arithmetic meet", () => {
  const src = `FUNCTION_BLOCK F
VAR
 a : LINT;
 b : REAL;
 out : REAL;
END_VAR
out := a + b;
END_FUNCTION_BLOCK`
  expect(diag(src, "codesys").map((d) => d.message)).toEqual([
    "Implicit conversion from 'LINT' to 'REAL': Possible loss of information",
  ])
  // …and a meet nothing recorded stays silent rather than guessing
  const t = `FUNCTION_BLOCK F
VAR
 a : TIME;
 b : TIME;
 out : TIME;
END_VAR
out := a + b;
END_FUNCTION_BLOCK`
  expect(diag(t, "codesys")).toEqual([])
})
// THE 64-BIT DATE TYPES ARE CODESYS'S TOO. TwinCAT has LTIME and has no LDATE/LTOD/LDT: it answers "Unknown
// type" for the declaration and "Identifier not defined" for the conversions that would carry them (39 messages
// across 13 fixtures in its recording, none in CODESYS's).
test("a CODESYS-only TYPE is unknown on TwinCAT, and so are its conversions", () => {
  const src = `FUNCTION_BLOCK F
VAR
 d : DATE;
 l : LDATE;
END_VAR
l := DATE_TO_LDATE(d);
END_FUNCTION_BLOCK`
  expect(diag(src, "codesys")).toEqual([])
  expect(diag(src, "twincat").map((d) => d.message)).toEqual([
    "Identifier 'DATE_TO_LDATE' not defined",
    "Program name, function or function block instance expected instead of 'DATE_TO_LDATE'",
    "Unknown type: 'LDATE'",
  ])
  // …and LTIME, which TwinCAT does have, stays a type on both
  const lt = `FUNCTION_BLOCK F
VAR
 t : LTIME;
END_VAR
END_FUNCTION_BLOCK`
  expect(diag(lt, "twincat")).toEqual([])
})
// A ONE-ARGUMENT MATH FUNCTION HANDS BACK THE REAL IT WAS GIVEN — all ten, both ways (`mathret_*`, 2026-09-21).
test("SQRT returns its argument's real type", () => {
  const call = (argType: string) => `FUNCTION_BLOCK F
VAR
 arg : ${argType} := 0.5;
 rv : REAL;
END_VAR
rv := SQRT(arg);
END_FUNCTION_BLOCK`
  expect(diag(call("REAL"), "codesys")).toEqual([])
  expect(diag(call("LREAL"), "codesys").map((d) => d.message)).toEqual([
    "Implicit conversion from 'LREAL' to 'REAL': Possible loss of information",
  ])
  // an untyped real literal is an LREAL, which is why `rv : REAL := SQRT(16.0)` warns at all
  const folded = `FUNCTION_BLOCK F
VAR
 rv : REAL := SQRT(16.0);
END_VAR
END_FUNCTION_BLOCK`
  expect(diag(folded, "codesys").length).toBeGreaterThan(0)
})
// BOTH SPELLINGS OF A CONVERSION, and a project that declares the type anyway. Found in review: the dialect
// test split the NAME on `_TO_`, which the `TO_<Y>` shape does not contain, and the declaration check never
// asked whether the project had declared `LDATE` itself — the shim a port writes.
test("the CODESYS-only types: both conversion shapes, and a project that declares one", () => {
  const call = (fn: string) => `FUNCTION_BLOCK F\nVAR\n d : DATE;\n l : LDATE;\nEND_VAR\nl := ${fn}(d);\nEND_FUNCTION_BLOCK`
  for (const fn of ["DATE_TO_LDATE", "TO_LDATE"])
    expect(diag(call(fn), "twincat").map((d) => d.message)).toContain(`Identifier '${fn}' not defined`)
  // a project that declares the type keeps it — `resolveNamedType` resolves it, so the check must not disagree
  const shim = `TYPE LDATE : ULINT;\nEND_TYPE\n\nFUNCTION_BLOCK F\nVAR\n x : LDATE;\nEND_VAR\nEND_FUNCTION_BLOCK`
  expect(diag(shim, "twincat")).toEqual([])
})
test("vendor-keyed wording: ABSTRACT instantiation", () => {
  const src = `FUNCTION_BLOCK ABSTRACT FB_A\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK F\nVAR\n x : FB_A;\nEND_VAR\nEND_FUNCTION_BLOCK`
  expect(diag(src, "codesys").find((d) => d.code === "abstract-instantiation")?.message).toBe(
    "Function block FB_A is ABSTRACT and cannot be instantiated",
  )
  expect(diag(src, "twincat").find((d) => d.code === "abstract-instantiation")?.message).toBe(
    "Functionblock FB_A is ABSTRACT and cannot be instantiated",
  )
})

test("assignment type mismatch, duplicate declaration, external write fire with the right codes", () => {
  expect(
    codes(`FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK`, "codesys"),
  ).toContain("assignment-type-mismatch")
  expect(codes(`FUNCTION_BLOCK F\nVAR\n x : INT;\n x : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`, "codesys")).toContain(
    "duplicate-declaration",
  )
  const ext = `FUNCTION_BLOCK FB_A\nVAR\n secret : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nPROGRAM P\nVAR\n fb : FB_A;\nEND_VAR\nfb.secret := 1;\nEND_PROGRAM`
  expect(codes(ext, "codesys")).toContain("external-non-input-write")
})

// constant-overflow was REMOVED (2026-07-07): live /build proved CODESYS accepts out-of-range untyped
// literals (`INT := 40000` builds clean with a signed/unsigned conversion WARNING, `30000 + 10000` builds
// clean) — our range check false-positived. The genuine cases are type-conversion errors, owned by the
// conversion/assignment checks, not a dedicated overflow rule.

test("subrange + array-bounds detection (const-eval)", () => {
  // subrange: INT(0..100) init out of range
  expect(codes(`FUNCTION_BLOCK F\nVAR\n x : INT(0..100) := 150;\nEND_VAR\nEND_FUNCTION_BLOCK`, "codesys")).toContain(
    "subrange-out-of-range",
  )
  expect(codes(`FUNCTION_BLOCK F\nVAR\n x : INT(0..100) := 50;\nEND_VAR\nEND_FUNCTION_BLOCK`, "codesys")).not.toContain(
    "subrange-out-of-range",
  )
  // array-bounds: constant index outside ARRAY[0..3]
  expect(
    codes(`FUNCTION_BLOCK F\nVAR\n a : ARRAY[0..3] OF INT;\nEND_VAR\na[5] := 1;\nEND_FUNCTION_BLOCK`, "codesys"),
  ).toContain("array-index-out-of-bounds")
  expect(
    codes(`FUNCTION_BLOCK F\nVAR\n a : ARRAY[0..3] OF INT;\nEND_VAR\na[2] := 1;\nEND_FUNCTION_BLOCK`, "codesys"),
  ).not.toContain("array-index-out-of-bounds")
})

test("message pragmas surface the author's text at matching severity", () => {
  const src = `{warning 'deliberate'}\nFUNCTION_BLOCK F\nEND_FUNCTION_BLOCK`
  const d = diag(src, "codesys").find((x) => x.code === "message-pragma-warning")
  expect(d).toMatchObject({ severity: "warning", message: "deliberate" })
})
