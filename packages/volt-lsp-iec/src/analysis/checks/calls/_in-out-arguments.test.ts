/**
 * VAR_IN_OUT arguments (`_in-out-arguments.ts`, a helper of the call-argument check) — writability (C0041), the
 * constant forms, exact type identity (C0201), a STRING too short, and an in-out left unbound (C0039). Through
 * `computeDiagnostics`, as the rest of the call-argument tests (`call-arguments.test.ts`).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { build } from "../../../frontend/symbols/index.js"
import { uriFor } from "../../../../test/support/test-uri.js"
import { codes, messagesOf } from "../../../../test/support/call-diagnostics.js"

test("4.3c C0041: a VAR_IN_OUT parameter passed a literal/constant is flagged; a variable is not", () => {
  const fn = `FUNCTION TEST : INT\nVAR_IN_OUT in_out : INT; END_VAR\nTEST := in_out;\nEND_FUNCTION`
  const call = (b: string) => `PROGRAM P\nVAR i : INT; x : INT; END_VAR\n${b}\nEND_PROGRAM`
  expect(codes(fn, call(`i := TEST(31415);`))).toContain("in-out-needs-writable") // positional literal
  expect(codes(fn, call(`i := TEST(in_out := 99);`))).toContain("in-out-needs-writable") // named literal
  expect(codes(fn, call(`i := TEST(x);`))).not.toContain("in-out-needs-writable") // positional variable — ok
  expect(codes(fn, call(`i := TEST(in_out := x);`))).not.toContain("in-out-needs-writable") // named variable — ok
})

// VAR_IN_OUT CONSTANT (conformance `inout_const_*`, CODESYS SP21). It was checked as a plain VAR_IN_OUT: the STRING literal
// and STRING constant CODESYS accepts were reported, and a rejected integer literal read the plain in-out wording. Why
// missed: no fixture or corpus project held the section.
test("VAR_IN_OUT CONSTANT: a STRING literal or constant binds; an integer literal or constant needs a variable", () => {
  const fns = `FUNCTION F_Int : INT\nVAR_IN_OUT CONSTANT value : INT; END_VAR\nF_Int := value;\nEND_FUNCTION\nFUNCTION F_Text : BOOL\nVAR_IN_OUT CONSTANT text : STRING; END_VAR\nF_Text := text = 'abc';\nEND_FUNCTION`
  const call = (b: string) => `PROGRAM P\nVAR CONSTANT seven : INT := 7; fixed : STRING := 'abc'; END_VAR\nVAR n : INT; ok : BOOL; x : INT; END_VAR\n${b}\nEND_PROGRAM`
  expect(codes(fns, call(`ok := F_Text(text := 'abc');`))).toEqual([])
  expect(codes(fns, call(`ok := F_Text(text := fixed);`))).toEqual([])
  expect(codes(fns, call(`n := F_Int(value := x);`))).toEqual([])
  expect(codes(fns, call(`n := F_Int(value := seven);`))).toEqual(["in-out-constant-needs-variable"])
  expect(codes(fns, call(`n := F_Int(value := 5);`))).toContain("in-out-constant-needs-variable")
  expect(codes(fns, call(`n := F_Int(value := 5);`))).not.toContain("in-out-needs-writable")
})

test("4.3d C0039: a VAR_IN_OUT left unbound in a call is flagged; a bound one is not", () => {
  const fb = `FUNCTION_BLOCK FB\nVAR_IN_OUT inout : INT; END_VAR\nVAR_INPUT n : INT; END_VAR\nEND_FUNCTION_BLOCK`
  const call = (b: string) => `PROGRAM P\nVAR inst : FB; x : INT; END_VAR\n${b}\nEND_PROGRAM`
  expect(codes(fb, call(`inst();`))).toContain("in-out-not-assigned")
  expect(codes(fb, call(`inst(n := 1);`))).toContain("in-out-not-assigned") // inout still unbound
  expect(codes(fb, call(`inst(inout := x);`))).not.toContain("in-out-not-assigned") // bound by name
  // an FB takes no positional argument, so a positional one binds no VAR_IN_OUT: `cg_fb_positional` records "VAR_IN_OUT
  // 'touched' must be assigned" beside each positional refusal (both vendors) — this said "bound by position"
  expect(codes(fb, call(`inst(x, 1);`))).toContain("in-out-not-assigned")
})

test("4.3e C0201: a VAR_IN_OUT bound to a non-identical type is flagged; the same type is not", () => {
  const fb = `FUNCTION_BLOCK FB\nVAR_IN_OUT Variable : INT; END_VAR\nEND_FUNCTION_BLOCK`
  const call = (b: string) => `PROGRAM P\nVAR inst : FB; i : INT; bo : BOOL; END_VAR\n${b}\nEND_PROGRAM`
  const msgs = (...s: string[]) => {
    const files = s.map((source, k) => ({ uri: `u${k}.pou`, source, parseResult: parseSource(source, { networkText: true, unicodeIdentifiers: false }, "codesys") }))
    const project = build.buildSymbolTable(files, [], "codesys")
    return files.flatMap((f) =>
      computeDiagnostics({ uri: uriFor(f.parseResult), parseResult: f.parseResult, source: f.source, project, config: resolveConfig({ vendor: "codesys" }) })
        .filter((d) => d.code === "in-out-type-mismatch")
        .map((d) => d.message),
    )
  }
  expect(msgs(fb, call(`inst(Variable := bo);`))).toEqual(["Type 'BOOL' is not equal to type 'INT' of VAR_IN_OUT respectively REFERENCE 'Variable'"])
  expect(msgs(fb, call(`inst(Variable := i);`))).toEqual([])
})

test("a LITERAL bound to a VAR_IN_OUT is typed by its narrowest type for the identity test (C0201)", () => {
  // Why missed: an untyped integer literal infers no type, so the by-reference identity test skipped every literal
  // and four fixtures missed this error (conformance `inout_plain_literal_4`, `cc2_in_out_not_assigned`).
  const src = `FUNCTION F_takes : INT\nVAR_IN_OUT\nvalue : INT;\nEND_VAR\nF_takes := value;\nEND_FUNCTION\n\nFUNCTION_BLOCK FB_user\nVAR\nn : INT;\nEND_VAR\nn := F_takes(value := 5);\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "codesys")
  const msgs = computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "in-out-type-mismatch")
    .map((d) => d.message)
  expect(msgs).toEqual(["Type 'SINT' is not equal to type 'INT' of VAR_IN_OUT respectively REFERENCE 'value'"])
})

test("a literal whose narrowest type MATCHES the parameter stays silent", () => {
  const src = `FUNCTION F_takes : INT\nVAR_IN_OUT\nvalue : SINT;\nEND_VAR\nF_takes := value;\nEND_FUNCTION\n\nFUNCTION_BLOCK FB_user\nVAR\nn : INT;\nEND_VAR\nn := F_takes(value := 5);\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "codesys")
  expect(
    computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "in-out-type-mismatch"),
  ).toEqual([])
})

test("a VAR_IN_OUT bound to a call's result needs a variable; to a property, CODESYS says so of properties (calls_inout_bound_to_*)", () => {
  const fbIo = `FUNCTION_BLOCK FB_T\nVAR_IN_OUT\n\tio : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`
  const fn = `FUNCTION F_V : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nF_V := a;\nEND_FUNCTION`
  const prg = `PROGRAM P\nVAR\n\tfb : FB_T;\nEND_VAR\nfb(io := F_V(a := 2));\nEND_PROGRAM`
  expect(messagesOf("codesys", fbIo, fn, prg)).toEqual([
    "[error] VAR_IN_OUT respectively REFERENCE parameter 'io' of 'FB_T' needs variable with write access as input",
  ])
  expect(messagesOf("twincat", fbIo, fn, prg)).toEqual(["[error] VAR_IN_OUT parameter 'io' of 'FB_T' needs variable with write access as input"])
  const owner = `FUNCTION_BLOCK FB_P\nVAR\n\tstored : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nPROPERTY P : INT\nGET\nP := stored;\nEND_GET\nSET\nstored := P;\nEND_SET\nEND_PROPERTY`
  const prg2 = `PROGRAM P\nVAR\n\tfb : FB_T;\n\tow : FB_P;\nEND_VAR\nfb(io := ow.P);\nEND_PROGRAM`
  expect(messagesOf("codesys", fbIo, owner, prg2)).toEqual(["[error] Properties can't be assigned to VAR_IN_OUT."])
  expect(messagesOf("twincat", fbIo, owner, prg2)).toEqual(["[error] VAR_IN_OUT parameter 'io' of 'FB_T' needs variable with write access as input"])
})

test("a VAR_IN_OUT CONSTANT given an integer literal is refused on both vendors, a VAR CONSTANT on CODESYS alone (inout_const_bound_forms_1)", () => {
  const fn = `FUNCTION F_C : INT
VAR_IN_OUT CONSTANT
	value : INT;
END_VAR
F_C := value;
END_FUNCTION`
  const prg = (arg: string) => `PROGRAM P
VAR CONSTANT
	seven : INT := 7;
END_VAR
VAR
	out : INT;
END_VAR
out := F_C(value := ${arg});
END_PROGRAM`
  const said = (vendor: "codesys" | "twincat", arg: string) => messagesOf(vendor, fn, prg(arg)).filter((m) => m.includes("CONSTANT parameter"))
  for (const vendor of ["codesys", "twincat"] as const) expect(said(vendor, "5")).toHaveLength(1)
  expect(said("codesys", "seven")).toHaveLength(1)
  expect(said("twincat", "seven")).toEqual([])
})

// lsp-transpile-review-gaps 2.5 (`string_inout_narrower`, `wstring_inout_narrower`, both vendors 2026-10-11): a STRING bound
// to a VAR_IN_OUT that declares MORE units is "String variable 'v' too short for the VAR_IN_OUT parameter 'io' of 'F'"
// (TwinCAT names the two the other way round); wider builds (`string_inout_wider_*`), and a VAR_IN_OUT CONSTANT bound
// narrower builds (`xo4_inout_constant_chain`)
test("a STRING bound to a VAR_IN_OUT that declares more units is too short (string_inout_narrower)", () => {
  const messages = (vendor: "codesys" | "twincat", param: string, arg: string, constant = false): string[] => {
    const fn = `FUNCTION F_Io : BOOL\nVAR_IN_OUT${constant ? " CONSTANT" : ""}\n\tio : ${param};\nEND_VAR\nF_Io := TRUE;\nEND_FUNCTION`
    const prog = `PROGRAM P\nVAR\n\tv : ${arg};\n\tok : BOOL;\nEND_VAR\nok := F_Io(io := v);\nEND_PROGRAM`
    const files = [fn, prog].map((source) => {
      const parseResult = parseSource(source, { networkText: true, unicodeIdentifiers: false }, vendor)
      const first = parseResult.units.find((u) => "name" in u) as { name?: { text: string } } | undefined
      return { uri: `${first?.name?.text}.pou`, source, parseResult }
    })
    const project = build.buildSymbolTable(files, [], vendor)
    const config = resolveConfig({ vendor })
    return files.flatMap((f) =>
      computeDiagnostics({ uri: uriFor(f.parseResult), parseResult: f.parseResult, source: f.source, project, config }).filter((d) => d.severity === "error").map((d) => d.message),
    )
  }
  expect(messages("codesys", "STRING(10)", "STRING(4)")).toEqual(["String variable 'v' too short for the VAR_IN_OUT parameter 'io' of 'F_Io'"])
  expect(messages("twincat", "STRING(10)", "STRING(4)")).toEqual(["String variable 'io' too short for the VAR_IN_OUT parameter 'v' of 'F_Io'"])
  expect(messages("codesys", "WSTRING(10)", "WSTRING(4)")).toEqual(["String variable 'v' too short for the VAR_IN_OUT parameter 'io' of 'F_Io'"])
  expect(messages("codesys", "STRING", "STRING(10)")).toEqual(["String variable 'v' too short for the VAR_IN_OUT parameter 'io' of 'F_Io'"])
  expect(messages("codesys", "STRING(10)", "STRING(12)")).toEqual([])
  expect(messages("codesys", "STRING(10)", "STRING(10)")).toEqual([])
  expect(messages("codesys", "STRING(10)", "STRING(4)", true)).toEqual([])
})
