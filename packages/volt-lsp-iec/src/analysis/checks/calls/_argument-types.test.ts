/**
 * argument types (`_argument-types.ts`, a helper of the call-argument check) — an argument whose type cannot feed its
 * parameter, the conversion warnings an assignable one still earns, the generic ANY_* inputs, and an output binding
 * whose target cannot hold the output. Through `computeDiagnostics`, as the rest of the call-argument tests
 * (`call-arguments.test.ts`).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { build } from "../../../frontend/symbols/index.js"
import { uriFor } from "../../../../test/support/test-uri.js"
import { codes, FB_ONE_INPUT, caller } from "../../../../test/support/call-diagnostics.js"

test("gap 9: a library FUNCTION's arguments are checked — Standard's LEN given a WSTRING", () => {
  // Every library callee was skipped ("library signatures flatten var sections"), so this was silent while CODESYS
  // refuses it (conformance `cc_standard_len_wstring`). Flattening is an FB/inheritance effect; a FUNCTION keeps its
  // VAR_INPUT — and its declared STRING(255) is printed with the length, as CODESYS prints it.
  const len = {
    uri: "Device/Plc Logic/Application/Library Manager/Standard/LEN.pou",
    source: "FUNCTION LEN : INT\nVAR_INPUT\n\tSTR : STRING(255);\nEND_VAR\nEND_FUNCTION",
  }
  const program = "PROGRAM P\nVAR\n\twide : WSTRING;\n\tn : INT;\nEND_VAR\nn := LEN(wide);\nEND_PROGRAM"
  const files = [len, { uri: "P.pou", source: program }].map((f) => ({ ...f, parseResult: parseSource(f.source, { networkText: true, unicodeIdentifiers: false }, "codesys") }))
  const project = build.buildSymbolTable(files, [], "codesys")
  const messages = computeDiagnostics({ uri: files[1]!.uri, parseResult: files[1]!.parseResult, source: program, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "call-argument-type")
    .map((d) => d.message)
  expect(messages).toEqual(["Cannot convert type 'WSTRING' to type 'STRING(255)'"])
})

test("4.1 a wrong argument type is flagged (INT input called with STRING)", () => {
  expect(codes(FB_ONE_INPUT, caller(`fb(n := sText);`))).toContain("call-argument-type")
  // ...and positionally, on an all-positional call.
  // NAMED, because an FB takes no positional argument at all — measured, see `calls/call-grid.ts`. The point of
  // this test is the TYPE, and a positional call now stops at `input-assignment-missing` before reaching it.
  expect(codes(FB_ONE_INPUT, caller(`fb(n := sText);`))).toContain("call-argument-type")
})

test("regression: a qualified-enum argument is resolved (shared checkableType handles `E.X`)", () => {
  // Passing an enum value to a STRING input is a genuine mismatch. The check must SEE `E_A.X` as an enum
  // (not skip it): the old local enumValueRef only handled bare idents, so `E_A.X` slipped through untyped.
  const enumA = `TYPE E_A : (X, Y); END_TYPE`
  const fb = `FUNCTION_BLOCK FB_T\nVAR_INPUT sv : STRING; END_VAR\nEND_FUNCTION_BLOCK`
  const call = `PROGRAM P\nVAR fb : FB_T; END_VAR\nfb(sv := E_A.X);\nEND_PROGRAM`
  expect(codes(enumA, fb, call)).toContain("call-argument-type")
})

test("an enum VALUE argument converts as INT, like an assignment — into a SINT input an error, the name upper-cased", () => {
  // This check typed enum values with its own lookup, which never learned the enum's base type: both were silent
  // (conformance `cc_enum_arg_into_sint`, `cc_enum_arg_into_uint`).
  const enumMode = `TYPE E_Mode : (Idle := 0, Busy := 1); END_TYPE`
  const fn = (target: string) => `FUNCTION F_Take : BOOL\nVAR_INPUT x : ${target}; END_VAR\nF_Take := TRUE;\nEND_FUNCTION`
  const call = `PROGRAM P\nVAR ok : BOOL; END_VAR\nok := F_Take(E_Mode.Busy);\nEND_PROGRAM`
  const messages = (target: string): string[] => {
    const files = [enumMode, fn(target), call].map((source, i) => ({ uri: `u${i}.pou`, source, parseResult: parseSource(source, { networkText: true, unicodeIdentifiers: false }, "codesys") }))
    const project = build.buildSymbolTable(files, [], "codesys")
    return computeDiagnostics({ uri: files[2]!.uri, parseResult: files[2]!.parseResult, source: call, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "call-argument-type" || d.code === "sign-change-conversion")
      .map((d) => d.message)
  }
  expect(messages("SINT")).toEqual(["Cannot convert type 'E_MODE' to type 'SINT'"])
  expect(messages("UINT")).toEqual(["Implicit conversion from signed Type 'E_MODE' to unsigned Type 'UINT' : Possible change of sign"])
  expect(messages("DINT")).toEqual([])
})

/**
 * AN ASSIGNABLE ARGUMENT IS NOT NECESSARILY A CLEAN ONE.
 *
 * `argTypeError` gated on `isAssignable`, which is true for every kind except `incompatible` — so a narrowing
 * (`LREAL`→`REAL`) or a sign crossing (`INT`→`UINT`) passed as an ARGUMENT produced nothing, while the identical
 * plain assignment warned. Found while chasing a corpus miss; the wording and codes come from `narrowing.ts`, so
 * a call site and an assignment now read the same.
 */
test("4.9 an argument that is assignable but LOSSY still warns — same wording as the assignment", () => {
  const fb = `FUNCTION_BLOCK FB_U
VAR_INPUT
	u : UINT;
END_VAR
END_FUNCTION_BLOCK`
  const call = `PROGRAM P
VAR
	fb : FB_U;
	i : INT;
END_VAR
fb(u := i);
END_PROGRAM`
  expect(codes(fb, call)).toContain("sign-change-conversion")

  // ...and it stays a WARNING rather than the call-argument-type ERROR. This used to ask the same thing of a
  // POSITIONAL call; an FB has no positional form, so the second shape is a FUNCTION, which does.
  const fn = `FUNCTION FUN_U : INT
VAR_INPUT
	u : UINT;
END_VAR
FUN_U := 0;
END_FUNCTION`
  const positional = `PROGRAM P
VAR
	i : INT;
	rv : INT;
END_VAR
rv := FUN_U(i);
END_PROGRAM`
  const cs = codes(fn, positional)
  expect(cs).toContain("sign-change-conversion")
  expect(cs).not.toContain("call-argument-type")
})

test("4.10 a narrowing argument (LREAL into a REAL input) warns as loss of information", () => {
  const fb = `FUNCTION_BLOCK FB_R
VAR_INPUT
	rv : REAL;
END_VAR
END_FUNCTION_BLOCK`
  const call = `PROGRAM P
VAR
	fb : FB_R;
	l : LREAL;
END_VAR
fb(rv := l);
END_PROGRAM`
  expect(codes(fb, call)).toContain("narrowing-conversion")
})

test("4.11 an argument that converts CLEANLY stays silent — the check must not fire on a widen", () => {
  const fb = `FUNCTION_BLOCK FB_D
VAR_INPUT
	d : DINT;
END_VAR
END_FUNCTION_BLOCK`
  const call = `PROGRAM P
VAR
	fb : FB_D;
	i : INT;
END_VAR
fb(d := i);
END_PROGRAM`
  const cs = codes(fb, call)
  expect(cs).not.toContain("sign-change-conversion")
  expect(cs).not.toContain("narrowing-conversion")
})

// ── GENERIC PARAMETERS (frontend-conformance 4.1.3, rule TY14; both vendors recorded 2026-10-03, `ty_any_*`) ──

/** The messages a call `F(<arg>)` of `FUNCTION F : DINT` with `VAR_INPUT x : <group>` draws, as `vendor`. */
function genericCall(group: string, decls: string, arg: string, vendor: "codesys" | "twincat"): string[] {
  const fn = `FUNCTION F : DINT\nVAR_INPUT\n\tx : ${group};\nEND_VAR\nF := x.diSize;\nEND_FUNCTION`
  const prg = `PROGRAM P\nVAR\n${decls}\n\tres : DINT;\nEND_VAR\nres := F(${arg});\nEND_PROGRAM`
  const files = [
    { uri: "F.pou", source: fn, parseResult: parseSource(fn, { networkText: true, unicodeIdentifiers: false }, vendor) },
    { uri: "P.pou", source: prg, parseResult: parseSource(prg, { networkText: true, unicodeIdentifiers: false }, vendor) },
  ]
  const project = build.buildSymbolTable(files, [], vendor)
  const f = files[1]!
  return computeDiagnostics({ uri: uriFor(f.parseResult), parseResult: f.parseResult, source: f.source, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "call-argument-type" || d.code === "in-out-needs-writable")
    .map((d) => d.message)
}

test("an ANY_* input refuses an argument outside its group, in the group's name — both vendors", () => {
  const cells: [string, string, string, string][] = [
    ["ANY_NUM", "v : STRING;", "v", "STRING"],
    ["ANY_NUM", "v : BOOL;", "v", "BOOL"],
    ["ANY_NUM", "v : TIME;", "v", "TIME"],
    ["ANY_INT", "v : REAL;", "v", "REAL"],
    ["ANY_REAL", "v : INT;", "v", "INT"],
    ["ANY_BIT", "v : INT;", "v", "INT"],
    ["ANY_STRING", "v : INT;", "v", "INT"],
    ["ANY_DATE", "v : INT;", "v", "INT"],
  ]
  for (const vendor of ["codesys", "twincat"] as const)
    for (const [group, decls, arg, type] of cells) expect(genericCall(group, decls, arg, vendor)).toEqual([`Cannot convert type '${type}' to type '${group}'`])
})

test("an ANY_* input takes an argument of its group, and ANY takes a STRUCT", () => {
  const cells: [string, string][] = [
    ["ANY_NUM", "v : INT;"],
    ["ANY_NUM", "v : REAL;"],
    ["ANY_INT", "v : WORD;"],
    ["ANY_DATE", "v : TOD;"],
    ["ANY", "v : STRING;"],
  ]
  for (const vendor of ["codesys", "twincat"] as const) for (const [group, decls] of cells) expect(genericCall(group, decls, "v", vendor)).toEqual([])
})

test("ANY_BIT takes a BOOL on CODESYS and refuses it on TwinCAT (`ty_any_bit_parameter_accepts_bool`)", () => {
  expect(genericCall("ANY_BIT", "v : BOOL;", "v", "codesys")).toEqual([])
  expect(genericCall("ANY_BIT", "v : BOOL;", "v", "twincat")).toEqual(["Cannot convert type 'BOOL' to type 'ANY_BIT'"])
})

test("a literal into an ANY_* input is refused — it needs a variable with write access (`lt_literal_any_int_argument`)", () => {
  for (const vendor of ["codesys", "twincat"] as const)
    for (const arg of ["5", "5000000000", "-1"])
      expect(genericCall("ANY_INT", "", arg, vendor)).toEqual(["ANY parameter 'x' of 'F' needs variable with write access as input"])
})

test("a literal into any other generic input is unmeasured and stays silent — only ANY_INT with an integer literal is recorded (step 4a review)", () => {
  const cells: [string, string][] = [
    ["ANY_STRING", "5"],
    ["ANY", "5"],
    ["ANY_BIT", "16#FF"],
    ["ANY_BIT", "TRUE"],
    ["ANY_STRING", "'abc'"],
    ["ANY", "1.5"],
  ]
  for (const vendor of ["codesys", "twincat"] as const) for (const [group, arg] of cells) expect(genericCall(group, "", arg, vendor)).toEqual([])
})

// lsp-transpile-review-gaps 1.4 (`tr_20_output_index_moved_by_callee`, CODESYS builds and runs it 2026-09-29): a FUNCTION's
// and a METHOD's VAR_OUTPUT bound `o => target` beside no input is an output, not "no output of" nor a wrong input count
test("a FUNCTION's / METHOD's VAR_OUTPUT binding `o => arr[k]` is read as an output (tr_20_output_index_moved_by_callee)", () => {
  const fn = `FUNCTION F_CS_out20 : BOOL\nVAR_OUTPUT\n\to : INT;\nEND_VAR\no := 5;\nF_CS_out20 := TRUE;\nEND_FUNCTION`
  const fb = `FUNCTION_BLOCK FB_CS_out20\nVAR_OUTPUT\n\tk : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD M : BOOL\nVAR_OUTPUT\n\to : INT;\nEND_VAR\nk := k + 1;\no := 5;\nM := TRUE;\nEND_METHOD`
  const prog = `PROGRAM P\nVAR\n\tfb1 : FB_CS_out20;\n\tarr : ARRAY[0..3] OF INT;\n\tarr2 : ARRAY[0..3] OF INT;\n\tg : INT;\n\tb : BOOL;\n\tc : BOOL;\nEND_VAR\nb := fb1.M(o => arr[fb1.k]);\nc := F_CS_out20(o => arr2[g]);\nEND_PROGRAM`
  expect(codes(fn, fb, prog)).toEqual([])
})

// lsp-transpile-review-gaps 2.4 (`tr_43_routine_output_dint_to_int`, `tr_43_routine_output_word_to_int`, both vendors
// record:language 2026-10-09): a FUNCTION's output binding is judged as an FB's is — a DINT output into an INT is "Cannot
// convert type 'DINT' to type 'INT'", a WORD one warns "Implicit conversion from unsigned Type 'WORD' to signed Type 'INT'"
test("a FUNCTION's output bound => a narrower target is judged as the FB's twin (tr_43_routine_output_*)", () => {
  const messages = (out: string): string[] => {
    const fn = `FUNCTION F_O : BOOL\nVAR_OUTPUT\n\to : ${out};\nEND_VAR\nF_O := TRUE;\nEND_FUNCTION`
    const prog = `PROGRAM P\nVAR\n\tt : INT;\n\tok : BOOL;\nEND_VAR\nok := F_O(o => t);\nEND_PROGRAM`
    const files = [fn, prog].map((source) => {
      const parseResult = parseSource(source, { networkText: true, unicodeIdentifiers: false }, "codesys")
      const first = parseResult.units.find((u) => "name" in u) as { name?: { text: string } } | undefined
      return { uri: `${first?.name?.text}.pou`, source, parseResult }
    })
    const project = build.buildSymbolTable(files, [], "codesys")
    const config = resolveConfig({ vendor: "codesys" })
    return files.flatMap((f) =>
      computeDiagnostics({ uri: uriFor(f.parseResult), parseResult: f.parseResult, source: f.source, project, config }).map((d) => `[${d.severity}] ${d.message}`),
    )
  }
  expect(messages("DINT")).toEqual(["[error] Cannot convert type 'DINT' to type 'INT'"])
  expect(messages("WORD")).toEqual(["[warning] Implicit conversion from unsigned Type 'WORD' to signed Type 'INT' : Possible change of sign"])
  expect(messages("INT")).toEqual([])
})
