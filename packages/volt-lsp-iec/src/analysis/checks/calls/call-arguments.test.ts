/**
 * call-argument checks — arity (too-many positional), argument type, and unknown named argument, all
 * conservative (zero-FP). Multi-unit projects: an FB/function is declared in one file, called from another,
 * exercising the shared `resolveCallee`. The last test proves the shared body iterator now reaches property
 * accessor bodies (R1 coverage), which the old analysis `getBody` skipped.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { build } from "../../../frontend/symbols/index.js"
import { uriFor } from "../../../../test/support/test-uri.js"
import { codes, FB_ONE_INPUT, caller, messagesOf } from "../../../../test/support/call-diagnostics.js"
import { diagnose } from "../../../../test/support/diagnose.js"

const FB_TWO_INPUTS = `FUNCTION_BLOCK FB_T\nVAR_INPUT\n\ta : INT;\n\tb : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`

const FB_THREE_INPUTS = `FUNCTION_BLOCK FB_T\nVAR_INPUT\n\ta : INT;\n\tb : INT;\n\tc : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`

test("4.2 too many positional arguments is flagged", () => {
  expect(codes(FB_ONE_INPUT, caller(`fb(1, 2);`))).toContain("input-assignment-missing")
})

test("4.2b too-many wording is vendor-mirrored per callee kind: C0040 (function) vs C0044 (FB)", () => {
  const msgs = (...s: string[]) => {
    const files = s.map((source, i) => ({ uri: `u${i}.pou`, source, parseResult: parseSource(source, { networkText: true }, "codesys") }))
    const project = build.buildSymbolTable(files, [], "codesys")
    return files.flatMap((f) =>
      computeDiagnostics({ uri: uriFor(f.parseResult), parseResult: f.parseResult, source: f.source, project, config: resolveConfig({ vendor: "codesys" }) }).map((d) => d.message),
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

test("4.4 a mixed named+positional call reports the POSITIONAL half, and still does not bind it by index", () => {
  // `sText` (STRING) would mismatch `b : INT` IF bound by index, and it must still not be. What changed is that the
  // positional argument is no longer silent: CODESYS refuses an FB positional argument outright, mixed or not
  // (`cg_fb_mixed`, measured 2026-09-19), so the call reports it rather than quietly binding nothing.
  const c = codes(FB_TWO_INPUTS, caller(`fb(a := 1, sText);`))
  expect(c).toContain("input-assignment-missing")
  expect(c).not.toContain("call-argument-type")
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
  // An all-positional FB call is NOT clean — it is two errors, one per argument, whatever the types are.
  expect(codes(FB_TWO_INPUTS, caller(`fb(1, 2);`))).toEqual(["input-assignment-missing", "input-assignment-missing"])
})

test("4.7 a property accessor body is now diagnosed (R1 iterator covers accessors)", () => {
  // The GET body has an INT := STRING mismatch. The old analysis getBody() skipped accessor bodies entirely.
  const prop = `PROPERTY Prop : INT\nGET\nVAR i : INT; sv : STRING; END_VAR\ni := sv;\nEND_GET\nEND_PROPERTY`
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
  const call = `PROGRAM P\nVAR sv : STRING; END_VAR\nF(sv, 5);\nEND_PROGRAM`
  expect(codes(fn, call)).not.toContain("call-argument-type")
})

test("gap: too-many is flagged on an INHERITING FB (params walk the EXTENDS chain)", () => {
  // FB_D EXTENDS FB_B: one inherited input (b) + one own input (d) = 2 positional slots. A 3rd positional
  // arg is too-many — previously the whole check bailed for any FB with a base, missing this.
  const base = `FUNCTION_BLOCK FB_B\nVAR_INPUT b : INT; END_VAR\nEND_FUNCTION_BLOCK`
  const derived = `FUNCTION_BLOCK FB_D EXTENDS FB_B\nVAR_INPUT d : INT; END_VAR\nEND_FUNCTION_BLOCK`
  const call = `PROGRAM P\nVAR fb : FB_D; END_VAR\nfb(1, 2, 3);\nEND_PROGRAM`
  expect(codes(base, derived, call)).toContain("input-assignment-missing")
  // ...and so is the 2-arg call, now that an FB takes no positional argument at all. What this test still proves is
  // that the check does not BAIL on an FB with a base — it used to, and then nothing was reported. The named form
  // is the clean one, and the inherited `b` being nameable is what shows the EXTENDS chain was walked.
  const named = `PROGRAM P\nVAR fb : FB_D; END_VAR\nfb(b := 1, d := 2);\nEND_PROGRAM`
  expect(codes(base, derived, named)).not.toContain("input-assignment-missing")
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
  const call = `PROGRAM P\nVAR fb : FB_T; rv : REAL; END_VAR\nfb(n := 1, Elapsed => rv);\nEND_PROGRAM`
  expect(codes(fb, call)).not.toContain("unknown-named-argument")
})

test("a FUNCTION's inputs WITHOUT a default are required — the count is a range when defaults exist", () => {
  // Too-few is not diagnosed in general (an FB retains its inputs between calls), but a function has no instance
  // to retain anything (conformance `callshape_function_input_no_default`).
  const call = (args: string) => {
    const src = `FUNCTION F_c : INT\nVAR_INPUT\nbaseValue : INT := 5;\nextra : INT;\nEND_VAR\nF_c := baseValue + extra;\nEND_FUNCTION\n\nFUNCTION_BLOCK FB_u\nVAR\nn : INT;\nEND_VAR\nn := F_c(${args});\nEND_FUNCTION_BLOCK`
    return diagnose(src)
      .filter((d) => d.code === "function-argument-count")
      .map((d) => d.message)
  }
  // the argument passed is the DEFAULTED one, so the required `extra` is still missing — a count alone would pass
  expect(call("baseValue := 7")).toEqual(["Function 'F_c' requires at least '1' and maximum '2' inputs"])
  expect(call("extra := 7")).toEqual([])
  expect(call("baseValue := 7, extra := 1")).toEqual([])
})

// TwinCAT reports the same missing input and never words it as a range — "requires exactly '2' inputs",
// counting all of them (`callshape_function_input_no_default`, its recording 2026-09-20).
test("the range wording is CODESYS's; TwinCAT says exactly", () => {
  const src = `FUNCTION F_c : INT\nVAR_INPUT\nbaseValue : INT := 5;\nextra : INT;\nEND_VAR\nF_c := baseValue + extra;\nEND_FUNCTION\n\nFUNCTION_BLOCK FB_u\nVAR\nn : INT;\nEND_VAR\nn := F_c(baseValue := 7);\nEND_FUNCTION_BLOCK`
  // ONE PROJECT PER VENDOR — the parse and the symbol table are both dialect-bound, so sharing them across the
  // two would be asking TwinCAT's question of a CODESYS-bound project
  const of = (vendor: "codesys" | "twincat") => {
    return diagnose(src, vendor)
      .filter((d) => d.code === "function-argument-count")
      .map((d) => d.message)
  }
  expect(of("codesys")).toEqual(["Function 'F_c' requires at least '1' and maximum '2' inputs"])
  expect(of("twincat")).toEqual(["Function 'F_c' requires exactly '2' inputs"])
})

test("an FB's inputs are NOT required — they are retained between calls", () => {
  const src = `FUNCTION_BLOCK FB_w\nVAR_INPUT\nneeded : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nFUNCTION_BLOCK FB_u\nVAR\nw : FB_w;\nEND_VAR\nw();\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "codesys")
  expect(
    computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "function-argument-count"),
  ).toEqual([])
})

// A METHOD IS A FUNCTION FOR THIS RULE, on both vendors — the gate said `function` and the method form had never
// been asked on its own (`callshape_method_input_no_default`, both recordings 2026-09-21). Both name the METHOD.
test("a METHOD's inputs without a default are required too", () => {
  const src =
    `FUNCTION_BLOCK FB_h
END_FUNCTION_BLOCK

METHOD Blend : INT
VAR_INPUT
	baseValue : INT := 5;
	extra : INT;
END_VAR
Blend := baseValue * 10 + extra;
END_METHOD

` +
    `FUNCTION_BLOCK FB_u
VAR
	h : FB_h;
	n : INT;
END_VAR
n := h.Blend(baseValue := 2);
END_FUNCTION_BLOCK`
  const of = (vendor: "codesys" | "twincat") => {
    return diagnose(src, vendor)
      .filter((d) => d.code === "function-argument-count")
      .map((d) => d.message)
  }
  expect(of("codesys")).toEqual(["Function 'Blend' requires at least '1' and maximum '2' inputs"])
  expect(of("twincat")).toEqual(["Function 'Blend' requires exactly '2' inputs"])
})

// AND A DEFAULT STOPS BEING OPTIONAL ON TWINCAT. Leaving out the input that HAS an initial value compiles on
// CODESYS and does not there (`callshape_input_left_out`, both recordings 2026-09-20).
test("on TwinCAT an input with a default is still required", () => {
  const src =
    `FUNCTION F_c : INT
VAR_INPUT
	baseValue : INT := 5;
	extra : INT;
END_VAR
F_c := baseValue + extra;
END_FUNCTION

` +
    `FUNCTION_BLOCK FB_u
VAR
	n : INT;
END_VAR
n := F_c(extra := 1);
END_FUNCTION_BLOCK`
  const of = (vendor: "codesys" | "twincat") => {
    return diagnose(src, vendor)
      .filter((d) => d.code === "function-argument-count")
      .map((d) => d.message)
  }
  expect(of("codesys")).toEqual([])
  expect(of("twincat")).toEqual(["Function 'F_c' requires exactly '2' inputs"])
})

// WHICH NAMES MAY A CALL BIND — inputs, outputs, in-outs and properties, and nothing else. This asked
// `lookupMember` unfiltered, so ANY member counted and `inst(loc := 5)` on a plain `VAR loc : INT` was accepted
// in silence, while the network-text check beside it already restricted to the pin sections. Both vendors say
// the ST side was the wrong one (`cc_named_arg_non_input`, 2026-09-21).
test("a named argument may bind a pin or a property, never a plain VAR", () => {
	const fb = (members: string) => `FUNCTION_BLOCK FB_T\n${members}\nEND_FUNCTION_BLOCK`
	const call = (b: string) => `PROGRAM P\nVAR\n\tfb : FB_T;\n\tn : INT;\nEND_VAR\n${b}\nEND_PROGRAM`
	const PINS = "VAR_INPUT\n\tinp : INT;\nEND_VAR\nVAR_OUTPUT\n\toutp : INT;\nEND_VAR\nVAR\n\tloc : INT;\nEND_VAR"
	expect(codes(fb(PINS), call("fb(inp := 1);"))).not.toContain("unknown-named-argument")
	expect(codes(fb(PINS), call("fb(outp => n);"))).not.toContain("unknown-named-output")
	expect(codes(fb(PINS), call("fb(loc := 5);"))).toContain("unknown-named-argument")
	// an IN-OUT binds too, and a name nothing declares is still the same error
	expect(codes(fb("VAR_IN_OUT\n\tio : INT;\nEND_VAR"), call("fb(io := n);"))).not.toContain("unknown-named-argument")
	expect(codes(fb(PINS), call("fb(nope := 1);"))).toContain("unknown-named-argument")
})

// …AND A CALL SITE UPPER-CASES THE CALLEE. A member WRITE from outside keeps the declared case
// (`'iSecret' is no input of 'FB_LANG_hide_var'`); a named argument does not
// (`'loc' is no input of 'FB_LANG_NAMED_ARG_HOLDER'`). One sentence, two sites, cased differently by the vendor.
test("the callee is upper-cased at a call site, as both vendors print it", () => {
	const src = `FUNCTION_BLOCK FB_Mixed\nVAR\n\tloc : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`
	const caller = `PROGRAM P\nVAR\n\tfb : FB_Mixed;\nEND_VAR\nfb(loc := 5);\nEND_PROGRAM`
	const files = [src, caller].map((source, i) => {
		const parseResult = parseSource(source, { networkText: true }, "codesys")
		return { uri: i === 0 ? "FB_Mixed.pou" : "P.pou", source, parseResult }
	})
	const project = build.buildSymbolTable(files, [], "codesys")
	const messages = files.flatMap((f) =>
		computeDiagnostics({ uri: uriFor(f.parseResult), parseResult: f.parseResult, source: f.source, project, config: resolveConfig({ vendor: "codesys" }) })
			.filter((d) => d.code === "unknown-named-argument")
			.map((d) => d.message),
	)
	expect(messages).toEqual(["'loc' is no input of 'FB_MIXED'"])
})

// rule Y20: a FUNCTION's or METHOD's name is its result variable, so a VAR_INPUT of that name is no input — both vendors
// count it out of the signature and refuse one argument with "Function 'F' requires exactly '0' inputs"
// (`sym_function_input_named_as_function`, `sym_method_input_named_as_method`, 2026-10-02)
test("an input named as its FUNCTION is no input: one argument is too many", () => {
  const fn = `FUNCTION F_Same : INT\nVAR_INPUT\n\tF_Same : INT;\nEND_VAR\nF_Same := 3;\nEND_FUNCTION`
  const prg = `PROGRAM P\nVAR\n\tout : INT;\nEND_VAR\nout := F_Same(1);\nEND_PROGRAM`
  expect(codes(fn, prg)).toContain("function-argument-count")
})

// …but a METHOD with no `: <type>` has no result variable, so its input of its own name IS an input (pro2193
// `Increment.Rollover(input := position, rollover := 5, …)` builds)
test("an input named as a METHOD with no result type is an input", () => {
  const fb = `FUNCTION_BLOCK FB_T\nEND_FUNCTION_BLOCK\nMETHOD PUBLIC Rollover\nVAR_INPUT\n\trollover : INT;\nEND_VAR\nEND_METHOD`
  const prg = `PROGRAM P\nVAR\n\tfb : FB_T;\nEND_VAR\nfb.Rollover(rollover := 5);\nfb.Rollover(5);\nEND_PROGRAM`
  expect(codes(fb, prg)).toEqual([])
})

// A named argument the callee declares NOTHING of is also looked up as an ordinary identifier and not found
// (`inh_interface_method_unknown_param`, both vendors 2026-10-02); a member that is no input is not
// (`cc_named_arg_non_input`).
test("an unknown named argument the callee declares nothing of is also 'Identifier not defined'", () => {
  const messagesOf = (...sources: string[]): string[] => {
    const files = sources.map((source) => {
      const parseResult = parseSource(source, { networkText: true }, "codesys")
      const first = parseResult.units.find((u) => "name" in u) as { name: { text: string } }
      return { uri: `${first.name.text}.pou`, source, parseResult }
    })
    const project = build.buildSymbolTable(files, [], "codesys")
    const config = resolveConfig({ vendor: "codesys" })
    return files.flatMap((f) => computeDiagnostics({ uri: uriFor(f.parseResult), parseResult: f.parseResult, source: f.source, project, config }).map((d) => `${d.code}: ${d.message}`))
  }
  // each sentence carries ITS rule's code: "is no input of" is C0037's, "Identifier not defined" C0046's
  const fb = `FUNCTION_BLOCK FB_T\nVAR_INPUT\n\tn : INT;\nEND_VAR\nVAR\n\tloc : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nVAR\n\tloc2 : INT;\nEND_VAR\nEND_METHOD`
  // a METHOD with no input given one named argument is one argument too many, not "no input of"
  // (`mem_method_unknown_param_no_input`, both vendors 2026-10-02 — this said "'zz' is no input of 'M'", read off
  // `inh_interface_method_unknown_param`, whose METHOD has an input)
  expect(messagesOf(fb, caller("fb.M(zz := 1);"))).toEqual(["function-argument-count: Function 'M' requires exactly '0' inputs", "unresolved-identifier: Identifier 'zz' not defined"])
  expect(messagesOf(fb, caller("fb(zz := 1);"))).toEqual(["unknown-named-argument: 'zz' is no input of 'FB_T'", "unresolved-identifier: Identifier 'zz' not defined"])
  expect(messagesOf(fb, caller("fb(loc := 1);"))).toEqual(["unknown-named-argument: 'loc' is no input of 'FB_T'"])
})

// An FB whose EXTENDS chain runs INTO a cycle it is not part of (X → A → B → A) is built on a broken hierarchy: its
// parameter list is not the whole of it, so the unknown-name check stays silent — as it does for an FB on the cycle
test("an FB whose base chain runs into a cycle has no authoritative parameter list", () => {
  const a = "FUNCTION_BLOCK A EXTENDS B\nVAR\nEND_VAR\nEND_FUNCTION_BLOCK"
  const b = "FUNCTION_BLOCK B EXTENDS A\nVAR\nEND_VAR\nEND_FUNCTION_BLOCK"
  const x = "FUNCTION_BLOCK X EXTENDS A\nVAR_INPUT\n\ti : INT;\nEND_VAR\nEND_FUNCTION_BLOCK"
  const call = "PROGRAM P\nVAR\n\tinst : X;\nEND_VAR\ninst(zz := 1);\nEND_PROGRAM"
  expect(codes(a, b, x, call).filter((c) => c === "unknown-named-argument" || c === "unresolved-identifier")).toEqual([])
})

/** `code: message` of every diagnostic over the sources, each file named after its first unit. */
function codedMessages(...sources: string[]): string[] {
  const files = sources.map((source) => {
    const parseResult = parseSource(source, { networkText: true }, "codesys")
    const first = parseResult.units.find((u) => "name" in u) as { name: { text: string } }
    return { uri: `${first.name.text}.pou`, source, parseResult }
  })
  const project = build.buildSymbolTable(files, [], "codesys")
  const config = resolveConfig({ vendor: "codesys" })
  return files.flatMap((f) => computeDiagnostics({ uri: uriFor(f.parseResult), parseResult: f.parseResult, source: f.source, project, config }).map((d) => `${d.code}: ${d.message}`))
}

// A FUNCTION's or METHOD's named arguments are COUNTED before they are named: more `name := value` arguments than the
// callee has inputs is "Function 'X' requires exactly 'N' inputs" (the declared case), and nothing is said of which name
// is no input; within the count, a name it does not declare is "'zz' is no input of 'X'". Every unknown name is "Identifier
// not defined" either way (`mem_method_unknown_param_*`, `mem_function_unknown_param_*`, `expr_en_eno_call`, both vendors
// 2026-10-02). An FB names each one, whatever the count (`mem_reference_to_fb_call_unknown_param`).
test("M3/E21: a FUNCTION's or METHOD's named arguments past its input count are 'requires exactly', not 'no input of'", () => {
  const fb = "FUNCTION_BLOCK FB_T\nVAR\n\tk : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD M1 : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nM1 := a;\nEND_METHOD"
  const call = (b: string) => `PROGRAM P\nVAR\n\tfb : FB_T;\n\tout : INT;\nEND_VAR\n${b}\nEND_PROGRAM`
  // one input, one unknown name: within the count
  expect(codedMessages(fb, call("out := fb.M1(zz := 1);"))).toEqual(["unknown-named-argument: 'zz' is no input of 'M1'", "unresolved-identifier: Identifier 'zz' not defined"])
  // its input given, and an unknown name beside it: past the count
  expect(codedMessages(fb, call("out := fb.M1(a := 1, zz := 2);"))).toEqual(["function-argument-count: Function 'M1' requires exactly '1' inputs", "unresolved-identifier: Identifier 'zz' not defined"])
  const fn = (inputs: string) => `FUNCTION F_T : INT\n${inputs}F_T := 3;\nEND_FUNCTION`
  const prg = "PROGRAM P\nVAR\n\tout : INT;\nEND_VAR\nout := F_T(zz := 1);\nEND_PROGRAM"
  expect(codedMessages(fn("VAR_INPUT\n\ta : INT;\nEND_VAR\n"), prg)).toEqual(["unknown-named-argument: 'zz' is no input of 'F_T'", "unresolved-identifier: Identifier 'zz' not defined"])
  expect(codedMessages(fn(""), prg)).toEqual(["function-argument-count: Function 'F_T' requires exactly '0' inputs", "unresolved-identifier: Identifier 'zz' not defined"])
})

// An FB INSTANCE reached through a REFERENCE TO it, an array element or SUPER^ is called as the instance is: its inputs
// bound by name, a name it does not declare refused (`mem_reference_to_fb_call_unknown_param`,
// `mem_array_element_call_unknown_param`, `mem_super_call_unknown_param`, both vendors 2026-10-02). The callee was looked
// up as a SYMBOL, and none of the three is one, so the call was not checked at all.
test("M3: an FB instance called through a REFERENCE, an array element or SUPER^ binds its inputs", () => {
  const sub = "FUNCTION_BLOCK FB_Sub\nVAR_INPUT\n\tn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK"
  const refused = ["unknown-named-argument: 'zz' is no input of 'FB_SUB'", "unresolved-identifier: Identifier 'zz' not defined"]
  const prg = (vars: string, body: string) => `PROGRAM P\nVAR\n\tsb : FB_Sub;\n${vars}END_VAR\n${body}\nEND_PROGRAM`
  expect(codedMessages(sub, prg("\trf : REFERENCE TO FB_Sub;\n", "rf REF= sb;\nrf(zz := 1);"))).toEqual(refused)
  expect(codedMessages(sub, prg("\trf : REFERENCE TO FB_Sub;\n", "rf REF= sb;\nrf(n := 1);"))).toEqual([])
  expect(codedMessages(sub, prg("\tarr : ARRAY[1..2] OF FB_Sub;\n", "arr[1](zz := 1);"))).toEqual(refused)
  const derived = "FUNCTION_BLOCK FB_D EXTENDS FB_Sub\nVAR\n\tj : INT;\nEND_VAR\nSUPER^(zz := 1);\nEND_FUNCTION_BLOCK"
  expect(codedMessages(sub, derived)).toEqual(refused)
})

// The count is asked only of the shape the vendors were asked about (step 3 review, 2026-10-03): plain VAR_INPUTs, no
// default and no VAR_IN_OUT, distinct names, an unknown INPUT name among them. A defaulted input's count is CODESYS's
// range wording (4b), an in-out is no input of the count, a repeated known name is no unknown one — none is recorded,
// so none is answered "requires exactly". An unknown OUTPUT binding keeps 4b's count of the inputs left out.
test("M3/E21: the named-argument count leaves unrecorded shapes alone", () => {
  const prg = (call: string) => `PROGRAM P\nVAR\n\tout : INT;\n\tx : INT;\nEND_VAR\n${call}\nEND_PROGRAM`
  const counted = (fn: string, call: string) => codedMessages(fn, prg(call)).filter((m) => m.includes("requires exactly"))
  const defaulted = "FUNCTION F_T : INT\nVAR_INPUT\n\ta : INT;\n\tb : INT := 1;\nEND_VAR\nF_T := a;\nEND_FUNCTION"
  expect(counted(defaulted, "out := F_T(a := 1, b := 2, zz := 3);")).toEqual([])
  const inOut = "FUNCTION F_T : INT\nVAR_IN_OUT\n\tio : INT;\nEND_VAR\nF_T := io;\nEND_FUNCTION"
  expect(counted(inOut, "out := F_T(io := x, zz := 2);")).toEqual([])
  const one = "FUNCTION F_T : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nF_T := a;\nEND_FUNCTION"
  expect(counted(one, "out := F_T(a := 1, a := 2);")).toEqual([])
  const two = "FUNCTION F_T : INT\nVAR_INPUT\n\ta : INT;\n\tb : INT;\nEND_VAR\nF_T := a;\nEND_FUNCTION"
  expect(counted(two, "out := F_T(a := 1, zz => x);")).toEqual(["function-argument-count: Function 'F_T' requires exactly '2' inputs"])
})

// A PROGRAM TAKES NO POSITIONAL ARGUMENT either: `P(5)` is "Assignment to input missing for parameter '5' in call of
// 'P'", the callee upper-cased (rule DT9, `dt_program_called_positionally`, CODESYS 2026-10-03) — it was taken.
test("a PROGRAM called positionally is refused, one error per argument (dt_program_called_positionally, DT9)", () => {
  const prg = `PROGRAM Prg_t\nVAR_INPUT\n\tk : INT;\nEND_VAR\nEND_PROGRAM`
  const src = `${prg}\nFUNCTION_BLOCK F\nVAR\nEND_VAR\nPrg_t(5);\nPrg_t(k := 5);\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }], [], "codesys")
  const msgs = computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "input-assignment-missing")
    .map((d) => d.message)
  expect(msgs).toEqual(["Assignment to input missing for parameter '5' in call of 'PRG_T'"])
})

const FB_OUT = `FUNCTION_BLOCK FB_T\nVAR_INPUT\n\ti : INT;\nEND_VAR\nVAR_OUTPUT\n\to : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`

const outCaller = (body: string) => `PROGRAM P\nVAR\n\tfb : FB_T;\n\tres : INT;\nEND_VAR\n${body}\nEND_PROGRAM`

test("an output binding naming nothing is no output AND no identifier; naming an INPUT, no output (calls_unknown_output_*, calls_output_names_input)", () => {
  for (const vendor of ["codesys", "twincat"] as const) {
    expect(messagesOf(vendor, FB_OUT, outCaller("fb(nope => res);"))).toEqual([
      "[error] 'nope' is no output of 'FB_T'",
      "[error] Identifier 'nope' not defined",
    ])
    expect(messagesOf(vendor, FB_OUT, outCaller("fb(i => res);"))).toEqual(["[error] 'i' is no output of 'FB_T'"])
  }
})

test("a FUNCTION's or METHOD's VAR_IN_OUT left out is its input COUNT; an FB's positional arguments bind no VAR_IN_OUT", () => {
  const fn = `FUNCTION F_T : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nVAR_IN_OUT\n\tio : INT;\nEND_VAR\nF_T := a;\nEND_FUNCTION`
  const prg = `PROGRAM P\nVAR\n\tout : INT;\nEND_VAR\nout := F_T(a := 1);\nEND_PROGRAM`
  for (const vendor of ["codesys", "twincat"] as const)
    expect(messagesOf(vendor, fn, prg)).toEqual(["[error] Function 'F_T' requires exactly '2' inputs"])
  // `cg_fb_positional`: `target(1, 2, mark)` on an FB binds nothing, so its VAR_IN_OUT is unassigned too
  const fbIo = `FUNCTION_BLOCK FB_T\nVAR_INPUT\n\ta : INT;\nEND_VAR\nVAR_IN_OUT\n\ttouched : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`
  const fbPrg = `PROGRAM P\nVAR\n\tfb : FB_T;\nEND_VAR\nfb(1);\nEND_PROGRAM`
  expect(messagesOf("codesys", fbIo, fbPrg)).toContain("[error] VAR_IN_OUT 'touched' must be assigned in call of 'FB_T'")
})

test("the in-outs count among a FUNCTION's inputs whichever is missing, in a mixed call, beside an unknown name (gate 3.7+3.9)", () => {
  const fn = `FUNCTION F_T : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nVAR_IN_OUT\n\tio : INT;\nEND_VAR\nF_T := a;\nEND_FUNCTION`
  const fn2 = `FUNCTION F_M : INT\nVAR_INPUT\n\ta : INT;\n\tb : INT;\nEND_VAR\nVAR_IN_OUT\n\tio : INT;\nEND_VAR\nF_M := a + b;\nEND_FUNCTION`
  const prg = (call: string) => `PROGRAM P\nVAR\n\tv : INT;\n\tout : INT;\nEND_VAR\nout := ${call};\nEND_PROGRAM`
  for (const vendor of ["codesys", "twincat"] as const) {
    // the in-out given, the input left out: the same count (`calls_inout_given_input_missing`)
    expect(messagesOf(vendor, fn, prg("F_T(io := v)"))).toEqual(["[error] Function 'F_T' requires exactly '2' inputs"])
    // an in-out left out of a mixed call (`calls_inout_unbound_mixed`)
    expect(messagesOf(vendor, fn2, prg("F_M(1, b := 2)"))).toEqual(["[error] Function 'F_M' requires exactly '3' inputs"])
    // beside an unknown named input, the unknown name alone (`calls_inout_unbound_unknown_named`)
    expect(messagesOf(vendor, fn, prg("F_T(a := 1, zz := 2)"))).toEqual([
      "[error] 'zz' is no input of 'F_T'",
      "[error] Identifier 'zz' not defined",
    ])
  }
})

test("an INTERFACE method's in-out left out is its input count (calls_inout_unbound_interface_method, gate 3.7+3.9)", () => {
  const itf = `INTERFACE ITF_Y\nMETHOD M : INT\nVAR_IN_OUT\n\tio : INT;\nEND_VAR\nEND_METHOD\nEND_INTERFACE`
  const prg = `PROGRAM P\nVAR\n\tref1 : ITF_Y;\n\tout : INT;\nEND_VAR\nout := ref1.M();\nEND_PROGRAM`
  expect(messagesOf("codesys", itf, prg)).toEqual(["[error] Function 'M' requires exactly '1' inputs"])
})

test("a FUNCTION input defaulted with a VARIABLE is required on CODESYS (callarg_no_argument_variable_default)", () => {
  const gvl = `VAR_GLOBAL\n\tg : INT := 3;\nEND_VAR`
  const fn = `FUNCTION F_D : INT\nVAR_INPUT\n\ti : INT := g;\nEND_VAR\nF_D := i;\nEND_FUNCTION`
  const prg = `PROGRAM P\nVAR\n\tout : INT;\nEND_VAR\nout := F_D();\nEND_PROGRAM`
  expect(messagesOf("codesys", gvl, fn, prg)).toContain("[error] Function 'F_D' requires exactly '1' inputs")
})

test("a default naming the callee's own CONSTANT is constant, though a global VARIABLE shares its name (gate 3.7+3.9)", () => {
  // the default is read in the CALLEE's scope: its VAR CONSTANT shadows the global (`calls_default_local_constant_shadows_global`)
  const gvl = `VAR_GLOBAL\n\tg : INT := 3;\nEND_VAR`
  const fn = `FUNCTION F_D : INT\nVAR CONSTANT\n\tg : INT := 1;\nEND_VAR\nVAR_INPUT\n\ti : INT := g;\nEND_VAR\nF_D := i;\nEND_FUNCTION`
  const prg = `PROGRAM P\nVAR\n\tout : INT;\nEND_VAR\nout := F_D();\nEND_PROGRAM`
  expect(messagesOf("codesys", gvl, fn, prg).filter((m) => m.includes("requires"))).toEqual([])
})
