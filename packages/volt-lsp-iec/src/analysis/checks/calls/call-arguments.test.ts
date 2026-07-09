/**
 * call-argument checks — arity (too-many positional), argument type, and unknown named argument, all
 * conservative (zero-FP). Multi-unit projects: an FB/function is declared in one file, called from another,
 * exercising the shared `resolveCallee`. The last test proves the shared body iterator now reaches property
 * accessor bodies (R1 coverage), which the old analysis `getBody` skipped.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

/** All diagnostic codes emitted across the given source units (project built from all of them). */
function codes(...sources: string[]): string[] {
  const files = sources.map((source, i) => ({ uri: `u${i}.fb`, source, parseResult: parseSource(source) }))
  const project = buildSymbolTable(files)
  const config = resolveConfig({ vendor: "codesys" })
  return files.flatMap((f) =>
    computeSemanticDiagnostics({ parseResult: f.parseResult, source: f.source, project, config }).map((d) => d.code),
  )
}

const FB_ONE_INPUT = `FUNCTION_BLOCK FB_T\nVAR_INPUT\n\tn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`
const FB_TWO_INPUTS = `FUNCTION_BLOCK FB_T\nVAR_INPUT\n\ta : INT;\n\tb : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`
const FB_THREE_INPUTS = `FUNCTION_BLOCK FB_T\nVAR_INPUT\n\ta : INT;\n\tb : INT;\n\tc : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`
const caller = (body: string) => `PROGRAM P\nVAR\n\tfb : FB_T;\n\ts : STRING;\nEND_VAR\n${body}\nEND_PROGRAM`

test("4.1 a wrong argument type is flagged (INT input called with STRING)", () => {
  expect(codes(FB_ONE_INPUT, caller(`fb(n := s);`))).toContain("call-argument-type")
  // ...and positionally, on an all-positional call.
  expect(codes(FB_ONE_INPUT, caller(`fb(s);`))).toContain("call-argument-type")
})

test("4.2 too many positional arguments is flagged", () => {
  expect(codes(FB_ONE_INPUT, caller(`fb(1, 2);`))).toContain("input-assignment-missing")
})

test("4.2b too-many wording is vendor-mirrored per callee kind: C0040 (function) vs C0044 (FB)", () => {
  const msgs = (...s: string[]) => {
    const files = s.map((source, i) => ({ uri: `u${i}.fb`, source, parseResult: parseSource(source) }))
    const project = buildSymbolTable(files)
    return files.flatMap((f) =>
      computeSemanticDiagnostics({ parseResult: f.parseResult, source: f.source, project, config: resolveConfig({ vendor: "codesys" }) }).map((d) => d.message),
    )
  }
  const fn = `FUNCTION TEST : INT\nVAR_INPUT a : INT; END_VAR\nTEST := a;\nEND_FUNCTION`
  expect(msgs(fn, `PROGRAM P\nVAR y : INT; END_VAR\ny := TEST(1, 2);\nEND_PROGRAM`)).toContain(
    "Function 'TEST' requires exactly '1' inputs",
  )
  const fb = `FUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK`
  expect(msgs(fb, `PROGRAM P\nVAR inst : FB; END_VAR\ninst(1);\nEND_PROGRAM`)).toContain(
    "Assignment to input missing for parameter '1' in call of 'FB'",
  )
})

test("4.3 an unknown named argument is flagged", () => {
  expect(codes(FB_ONE_INPUT, caller(`fb(zzz := 1);`))).toContain("unknown-named-argument")
})

test("4.3b C0038: a `name => target` binding naming no output → unknown-named-output (not -argument)", () => {
  const fbOut = `FUNCTION_BLOCK FB_T\nVAR_OUTPUT o : INT; END_VAR\nEND_FUNCTION_BLOCK`
  const call = `PROGRAM P\nVAR fb : FB_T; y : INT; END_VAR\nfb(bad => y);\nEND_PROGRAM`
  const c = codes(fbOut, call)
  expect(c).toContain("unknown-named-output")
  expect(c).not.toContain("unknown-named-argument")
  // ...and a valid output binding is clean.
  expect(codes(fbOut, `PROGRAM P\nVAR fb : FB_T; y : INT; END_VAR\nfb(o => y);\nEND_PROGRAM`)).toEqual([])
})

test("4.3c C0041: a VAR_IN_OUT parameter passed a literal/constant is flagged; a variable is not", () => {
  const fn = `FUNCTION TEST : INT\nVAR_IN_OUT in_out : INT; END_VAR\nTEST := in_out;\nEND_FUNCTION`
  const call = (b: string) => `PROGRAM P\nVAR i : INT; x : INT; END_VAR\n${b}\nEND_PROGRAM`
  expect(codes(fn, call(`i := TEST(31415);`))).toContain("in-out-needs-writable") // positional literal
  expect(codes(fn, call(`i := TEST(in_out := 99);`))).toContain("in-out-needs-writable") // named literal
  expect(codes(fn, call(`i := TEST(x);`))).not.toContain("in-out-needs-writable") // positional variable — ok
  expect(codes(fn, call(`i := TEST(in_out := x);`))).not.toContain("in-out-needs-writable") // named variable — ok
})

test("4.3d C0039: a VAR_IN_OUT left unbound in a call is flagged; a bound one is not", () => {
  const fb = `FUNCTION_BLOCK FB\nVAR_IN_OUT inout : INT; END_VAR\nVAR_INPUT n : INT; END_VAR\nEND_FUNCTION_BLOCK`
  const call = (b: string) => `PROGRAM P\nVAR inst : FB; x : INT; END_VAR\n${b}\nEND_PROGRAM`
  expect(codes(fb, call(`inst();`))).toContain("in-out-not-assigned")
  expect(codes(fb, call(`inst(n := 1);`))).toContain("in-out-not-assigned") // inout still unbound
  expect(codes(fb, call(`inst(inout := x);`))).not.toContain("in-out-not-assigned") // bound by name
  expect(codes(fb, call(`inst(x, 1);`))).not.toContain("in-out-not-assigned") // bound by position (slot 0 = inout)
})

test("4.3e C0201: a VAR_IN_OUT bound to a non-identical type is flagged; the same type is not", () => {
  const fb = `FUNCTION_BLOCK FB\nVAR_IN_OUT Variable : INT; END_VAR\nEND_FUNCTION_BLOCK`
  const call = (b: string) => `PROGRAM P\nVAR inst : FB; i : INT; bo : BOOL; END_VAR\n${b}\nEND_PROGRAM`
  const msgs = (...s: string[]) => {
    const files = s.map((source, k) => ({ uri: `u${k}.fb`, source, parseResult: parseSource(source) }))
    const project = buildSymbolTable(files)
    return files.flatMap((f) =>
      computeSemanticDiagnostics({ parseResult: f.parseResult, source: f.source, project, config: resolveConfig({ vendor: "codesys" }) })
        .filter((d) => d.code === "in-out-type-mismatch")
        .map((d) => d.message),
    )
  }
  expect(msgs(fb, call(`inst(Variable := bo);`))).toEqual(["Type 'BOOL' is not equal to type 'INT' of VAR_IN_OUT 'Variable'"])
  expect(msgs(fb, call(`inst(Variable := i);`))).toEqual([])
})

test("4.4 a mixed named+positional call does not type-check the trailing positional", () => {
  // `s` (STRING) would mismatch `b : INT` IF bound by index — but a mixed call must not bind positionally.
  const c = codes(FB_TWO_INPUTS, caller(`fb(a := 1, s);`))
  expect(c).not.toContain("call-argument-type")
  expect(c).not.toContain("input-assignment-missing")
  expect(c).not.toContain("unknown-named-argument")
})

test("4.5 omitting optional FB inputs is not flagged", () => {
  expect(codes(FB_THREE_INPUTS, caller(`fb(a := 1);`))).not.toContain("input-assignment-missing")
})

test("4.6 an unresolved callee yields no call-argument diagnostic (zero-FP)", () => {
  const c = codes(caller(`unknownThing(1, 2, 3);`))
  expect(c).not.toContain("input-assignment-missing")
  expect(c).not.toContain("call-argument-type")
  expect(c).not.toContain("unknown-named-argument")
})

test("4.5b a correct FB call is clean", () => {
  expect(codes(FB_TWO_INPUTS, caller(`fb(a := 1, b := 2);`))).not.toContain("call-argument-type")
  expect(codes(FB_TWO_INPUTS, caller(`fb(1, 2);`))).toEqual([]) // all-positional, in range, right types
})

test("4.7 a property accessor body is now diagnosed (R1 iterator covers accessors)", () => {
  // The GET body has an INT := STRING mismatch. The old analysis getBody() skipped accessor bodies entirely.
  const prop = `PROPERTY Prop : INT\nGET\nVAR i : INT; s : STRING; END_VAR\ni := s;\nEND_GET\nEND_PROPERTY`
  expect(codes(prop)).toContain("assignment-type-mismatch")
})

test("regression: getter and setter same-named locals do NOT collide (no dup-decl / mistype FP)", () => {
  // Legal IEC — GET and SET are separate scopes. A merged accessor scope produced false
  // duplicate-declaration (same-name) and false assignment-type-mismatch (setter's tmp typed from getter).
  const prop = `PROPERTY Prop : INT
GET
VAR tmp : INT; END_VAR
tmp := 1;
Prop := tmp;
END_GET
SET
VAR tmp : STRING; END_VAR
tmp := 'x';
END_SET
END_PROPERTY`
  const c = codes(prop)
  expect(c).not.toContain("duplicate-declaration")
  expect(c).not.toContain("assignment-type-mismatch")
})

test("regression: positional type-check skips when VAR_IN_OUT/OUTPUT interleave (index misalignment)", () => {
  // `io` (VAR_IN_OUT) is positional slot 0, `a : INT` is slot 1. params (VAR_INPUT-only) = [a], so a naive
  // params[0] check would compare the STRING io-arg against a:INT → false call-argument-type.
  const fn = `FUNCTION F : INT\nVAR_IN_OUT io : STRING; END_VAR\nVAR_INPUT a : INT; END_VAR\nF := a;\nEND_FUNCTION`
  const call = `PROGRAM P\nVAR s : STRING; END_VAR\nF(s, 5);\nEND_PROGRAM`
  expect(codes(fn, call)).not.toContain("call-argument-type")
})

test("gap: too-many is flagged on an INHERITING FB (params walk the EXTENDS chain)", () => {
  // FB_D EXTENDS FB_B: one inherited input (b) + one own input (d) = 2 positional slots. A 3rd positional
  // arg is too-many — previously the whole check bailed for any FB with a base, missing this.
  const base = `FUNCTION_BLOCK FB_B\nVAR_INPUT b : INT; END_VAR\nEND_FUNCTION_BLOCK`
  const derived = `FUNCTION_BLOCK FB_D EXTENDS FB_B\nVAR_INPUT d : INT; END_VAR\nEND_FUNCTION_BLOCK`
  const call = `PROGRAM P\nVAR fb : FB_D; END_VAR\nfb(1, 2, 3);\nEND_PROGRAM`
  expect(codes(base, derived, call)).toContain("input-assignment-missing")
  // ...and the legal 2-arg call is clean (inherited `b` is a real slot).
  const ok = `PROGRAM P\nVAR fb : FB_D; END_VAR\nfb(1, 2);\nEND_PROGRAM`
  expect(codes(base, derived, ok)).not.toContain("input-assignment-missing")
})

test("gap: a VAR_OUTPUT is not counted as a positional slot (FB call)", () => {
  // FB with 1 input + 1 output. Positionals bind only the input, so a 2nd positional arg is too-many —
  // previously VAR_OUTPUT inflated positionalArity and this slipped through.
  const fb = `FUNCTION_BLOCK FB_T\nVAR_INPUT n : INT; END_VAR\nVAR_OUTPUT e : BOOL; END_VAR\nEND_FUNCTION_BLOCK`
  const call = `PROGRAM P\nVAR fb : FB_T; END_VAR\nfb(1, 2);\nEND_PROGRAM`
  expect(codes(fb, call)).toContain("input-assignment-missing")
})

test("regression: a PROPERTY is a valid named-argument target (not flagged unknown)", () => {
  // A property (`p => var`) binds like an output but isn't a var-section param; the member-scope lookup
  // must recognize it. Previously the paramNames-only check false-flagged it as an unknown named argument.
  const fb = `FUNCTION_BLOCK FB_T\nVAR_INPUT n : INT; END_VAR\nEND_FUNCTION_BLOCK\nPROPERTY Elapsed : REAL\nGET\nElapsed := 1.0;\nEND_GET\nEND_PROPERTY`
  const call = `PROGRAM P\nVAR fb : FB_T; r : REAL; END_VAR\nfb(n := 1, Elapsed => r);\nEND_PROGRAM`
  expect(codes(fb, call)).not.toContain("unknown-named-argument")
})

test("regression: a qualified-enum argument is resolved (shared checkableType handles `E.X`)", () => {
  // Passing an enum value to a STRING input is a genuine mismatch. The check must SEE `E_A.X` as an enum
  // (not skip it): the old local enumValueRef only handled bare idents, so `E_A.X` slipped through untyped.
  const enumA = `TYPE E_A : (X, Y); END_TYPE`
  const fb = `FUNCTION_BLOCK FB_T\nVAR_INPUT s : STRING; END_VAR\nEND_FUNCTION_BLOCK`
  const call = `PROGRAM P\nVAR fb : FB_T; END_VAR\nfb(s := E_A.X);\nEND_PROGRAM`
  expect(codes(enumA, fb, call)).toContain("call-argument-type")
})
