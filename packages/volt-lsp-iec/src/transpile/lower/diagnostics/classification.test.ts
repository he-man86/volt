/**
 * THE SPLITS OF openspec `transpile-refusal-classification` 2.x — a code whose call sites refused more than one kind of
 * thing was split, one code per kind, each half decided by a recording (the `rk_*` fixtures, `calls/`, `memory/`, `oop/`,
 * `operators/refusal-kinds.ts`) or by the corpora. Each test lowers one snippet per half and names the code it refuses
 * with; the kind is the registry's (`codes.ts`), so a half that drifts back under its sibling's code fails here.
 */
import { describe, expect, test } from "bun:test"
import { lowerSource } from "../index.js"
import { lowerCodeKind } from "./codes.js"
import type { LibraryFile } from "../project/prepare.js"
import { libraryBase, type LibraryBase } from "../index.js"
// the recording project's Standard as its Library Manager holds it: the manifest and the TON declaration, no body
const STANDARD = "file:///p/Library Manager/Standard"
const STANDARD_BASE = libraryBase([
  {
    uri: `${STANDARD}/Standard.library`,
    source: "LIBRARY Standard\nNAMESPACE Standard\nRESOLUTION Standard, 3.5.18.0 (System)\nPLACEHOLDER true\nSYSTEM false\nMATERIALIZATION 4\n",
  },
  { uri: `${STANDARD}/TON.pou`, source: "FUNCTION_BLOCK TON\nVAR_INPUT\n\tIN : BOOL;\n\tPT : TIME;\nEND_VAR\nVAR_OUTPUT\n\tQ : BOOL;\n\tET : TIME;\nEND_VAR\nEND_FUNCTION_BLOCK\n" },
])

const codes = (src: string, libraries: readonly LibraryFile[] = [], base?: LibraryBase): string[] =>
  [...new Set((lowerSource(src, "P", libraries, undefined, base).diagnostics ?? []).map((d) => d.code))]
const allInvalid = (found: readonly string[]): boolean => found.every((c) => lowerCodeKind(c) === "invalid")
const prg = (vars: string, body: string, rest = ""): string => `PROGRAM P\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n${rest}`

describe("every split half is registered with its kind", () => {
  test.each([
    ["base-unresolved", "invalid"],
    ["layout-base", "not-modelled"],
    ["library-declaration", "not-modelled"],
    ["call-empty-argument", "not-modelled"],
    ["call-super-output", "not-modelled"],
    ["program-property-written", "invalid"],
    ["call-not-callable", "invalid"],
    ["fb-init-argument", "invalid"],
    ["fb-init-argument-shape", "not-modelled"],
    ["interface-impl-signature", "invalid"],
    ["interface-query-operand", "invalid"],
    ["interface-given-value", "invalid"],
    ["layout-union", "not-modelled"],
    ["union-overlay", "not-measured"],
    ["pragma-undecided", "not-measured"],
    ["gvl-member-unknown", "invalid"],
    ["deref-not-pointer", "invalid"],
    ["index-dims", "invalid"],
    ["reference-type", "invalid"],
    ["integer-into-pointer", "invalid"],
    ["pointer-operand", "invalid"],
    ["operand-types", "invalid"],
    ["var-at-address", "invalid"],
    ["attr-init-signature", "invalid"],
    ["attr-init-inputs", "not-modelled"],
    ["call-recursive", "invalid"],
    ["call-recursion", "not-modelled"],
    ["call-program", "not-modelled"],
    ["call-this", "not-modelled"],
  ])("%s is %s", (code, kind) => {
    expect(lowerCodeKind(code)).toBe(kind as never)
  })
})

describe("a base no declaration resolves is invalid; a library base lowering cannot lay out is not modelled", () => {
  test("EXTENDS a name nothing declares, and a cycle (`inh_unresolved_base`, `inh_extends_cycle`: both vendors refuse)", () => {
    expect(codes(prg("d : FB_D;", "d();", "FUNCTION_BLOCK FB_D EXTENDS FB_Missing\nEND_FUNCTION_BLOCK\n"))).toEqual(["base-unresolved"])
    // the cycle is `layout-recursive` too, refused as invalid for itself
    const cycle = codes(prg("a : FB_A;", "a();", "FUNCTION_BLOCK FB_A EXTENDS FB_B\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_B EXTENDS FB_A\nEND_FUNCTION_BLOCK\n"))
    expect(cycle).toContain("base-unresolved")
    expect(allInvalid(cycle)).toBe(true)
  })

  test("EXTENDS a library FB the binder links by its qualified name (`unit_fb_extends_qualified`, `rk_super_base_library`: CODESYS builds)", () => {
    // the Standard library as the recording project's Library Manager holds it (`STANDARD_BASE`)
    const found = codes(prg("d : FB_D;", "d();", "FUNCTION_BLOCK FB_D EXTENDS Standard.TON\nEND_FUNCTION_BLOCK\n"), [], STANDARD_BASE)
    expect(found).not.toContain("base-unresolved")
    expect(found.every((c) => lowerCodeKind(c) === "not-modelled")).toBe(true)
  })
})

describe("a library element whose materialized declaration lacks what CODESYS knows is not modelled; a project one's is invalid", () => {
  const lib = "file:///p/Library Manager/Lib"
  // a compiled library's interface is materialized with its METHODs AFTER `END_INTERFACE` (pro2193 `IADDLOG.itf`), and its
  // FBs with no IMPLEMENTS list (awa-palletizer `L_IMHP_MODULEHANDLER.pou`)
  const libraries = [
    { uri: `${lib}/I_LIB.itf`, source: "INTERFACE I_LIB\nEND_INTERFACE\n\nMETHOD M : INT\nEND_METHOD\n" },
    { uri: `${lib}/FB_LIB.pou`, source: "FUNCTION_BLOCK FB_LIB\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nM := 1;\nEND_METHOD\n" },
  ]

  test("a METHOD called through a library interface whose METHODs the declaration holds after END_INTERFACE", () => {
    expect(codes(prg("i : I_LIB; res : INT;", "res := i.M();"), libraries)).toEqual(["library-declaration"])
  })

  test("a project interface with no such METHOD (`mem_unknown_method_of_interface`: both vendors refuse)", () => {
    expect(codes(prg("i : I_PRJ; res : INT;", "res := i.Nope();", "INTERFACE I_PRJ\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE\n"))).toEqual(["call-method"])
  })

  test("a library FB given to an interface, its IMPLEMENTS not materialized; a project FB that implements nothing (`rk_interface_given_fb_not_implementing`: refused)", () => {
    expect(codes(prg("f : FB_LIB; i : I_LIB;", "i := f;"), libraries)).toEqual(["library-declaration"])
    const project = "INTERFACE I_PRJ\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE\nFUNCTION_BLOCK FB_PRJ\nEND_FUNCTION_BLOCK\nMETHOD M : INT\nM := 1;\nEND_METHOD\n"
    expect(codes(prg("f : FB_PRJ; i : I_PRJ;", "i := f;", project))).toEqual(["interface-type"])
  })
})

describe("a call of a name that is no callable thing is invalid; a name lowering cannot resolve is not modelled", () => {
  test("a constant, a variable and a type called (`calls_constant_called`, `cc5_invalid_call_target`, `dt_struct_type_name_called`: refused)", () => {
    expect(codes(prg("x : INT; res : INT;", "res := x();"))).toEqual(["call-not-callable"])
    expect(codes(prg("x : INT;", "x();"))).toEqual(["call-not-callable"])
    const dut = "TYPE DUT_S :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n"
    expect(codes(prg("res : INT;", "res := DUT_S();", dut))).toEqual(["call-not-callable"])
  })

  test("a name nothing resolves — a device the lowering project holds none of (`EtherCAT_Master`, bakon-nano), a library FUNCTION it lacks (`DELETE`, awa-palletizer)", () => {
    expect(codes(prg("", "EtherCAT_Master();"))).toEqual(["stmt-call_stmt"])
    expect(codes(prg("res : INT;", "res := NoSuchThing(1);"))).toEqual(["expr-call"])
  })

  test("a library FUNCTION whose name a library FB of another library also bears (`DELETE`, awa-palletizer: Standard's FUNCTION, CAA File's FB)", () => {
    // the lowering project holds CAA File's FB DELETE and not Standard's FUNCTION; the corpus builds, so the call is valid ST
    const caa = [{ uri: "file:///p/Library Manager/CAA File/DELETE.pou", source: "FUNCTION_BLOCK DELETE\nVAR_INPUT\n\tsFileName : STRING;\nEND_VAR\nEND_FUNCTION_BLOCK\n" }]
    expect(codes(prg("txt : STRING; res : STRING;", "res := DELETE(STR := txt, LEN := 4, POS := 0);"), caa)).toEqual(["expr-call"])
    expect(codes(prg("txt : STRING;", "DELETE(STR := txt, LEN := 4, POS := 0);"), caa)).toEqual(["stmt-call_stmt"])
  })
})

describe("call shapes the vendor decided", () => {
  test("an empty argument `F(a := , b := 2)` builds (`rk_function_empty_argument`); a VAR_OUTPUT given `:=` does not (`rk_function_output_bound_with_assign`)", () => {
    const f = "FUNCTION F : INT\nVAR_INPUT\n\ta : INT := 4;\n\tb : INT;\nEND_VAR\nVAR_OUTPUT\n\to : INT;\nEND_VAR\nF := a + b;\nEND_FUNCTION\n"
    expect(codes(prg("res : INT;", "res := F(a := , b := 2);", f))).toEqual(["call-empty-argument"])
    expect(codes(prg("res : INT; v : INT;", "res := F(a := 1, o := v);", f))).toEqual(["call-output"])
  })

  test("`SUPER^(o => got)` builds (`rk_super_call_output_argument`); `SUPER^(5)` is an FB called positionally (`refuse_fb_called_positionally`)", () => {
    const base = "FUNCTION_BLOCK FB_B\nVAR_INPUT\n\ti : INT;\nEND_VAR\nVAR_OUTPUT\n\to : INT;\nEND_VAR\no := i;\nEND_FUNCTION_BLOCK\n"
    const derived = (call: string) => `${base}FUNCTION_BLOCK FB_D EXTENDS FB_B\nVAR\n\tgot : INT;\nEND_VAR\n${call}\nEND_FUNCTION_BLOCK\n`
    expect(codes(prg("d : FB_D;", "d();", derived("SUPER^(o => got);")))).toEqual(["call-super-output"])
    expect(codes(prg("d : FB_D;", "d();", derived("SUPER^(5);")))).toEqual(["call-positional"])
  })

  test("a PROPERTY of an FB inside a PROGRAM written from outside it is refused (`rk_program_instance_property_written`)", () => {
    const cell = "FUNCTION_BLOCK FB_C\nVAR\n\tlvl : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nPROPERTY Level : INT\nGET\nLevel := lvl;\nEND_GET\nSET\nlvl := Level;\nEND_SET\nEND_PROPERTY\n"
    const holder = "PROGRAM PRG_H\nVAR\n\tcell : FB_C;\nEND_VAR\nEND_PROGRAM\n"
    expect(codes(prg("", "PRG_H.cell.Level := 8;", cell + holder))).toEqual(["program-property-written"])
  })

  test("an FB VAR_IN_OUT bound to a DERIVED instance builds (`rk_inout_derived_fb`); to another struct type it does not (`rk_inout_other_struct`)", () => {
    const fbs = "FUNCTION_BLOCK FB_B\nVAR\n\tn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_D EXTENDS FB_B\nEND_FUNCTION_BLOCK\n"
    const f = "FUNCTION F : INT\nVAR_IN_OUT\n\tio : FB_B;\nEND_VAR\nF := io.n;\nEND_FUNCTION\n"
    expect(codes(prg("d : FB_D; res : INT;", "res := F(io := d);", fbs + f))).toEqual(["call-inout-derived"])
    const duts = "TYPE DUT_A :\nSTRUCT\n\tv : INT;\nEND_STRUCT\nEND_TYPE\nTYPE DUT_B :\nSTRUCT\n\tv : INT;\nEND_STRUCT\nEND_TYPE\n"
    const g = "FUNCTION G : INT\nVAR_IN_OUT\n\trec : DUT_A;\nEND_VAR\nG := rec.v;\nEND_FUNCTION\n"
    expect(codes(prg("b : DUT_B; res : INT;", "res := G(rec := b);", duts + g))).toEqual(["call-inout-type"])
  })
})

describe("FB_Init arguments", () => {
  const fb = "FUNCTION_BLOCK FB_I\nVAR\n\tstart : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT\n\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\n\tstartValue : INT;\nEND_VAR\nstart := startValue;\nEND_METHOD\n"
  test("an FB_Init argument given positionally builds (`rk_fb_init_positional_argument`)", () => {
    expect(codes(prg("c : FB_I(5);", "", fb))).toEqual(["fb-init-argument-shape"])
  })
  test("an FB_Init input given no argument at all is refused (`fb_init_argument_left_out`)", () => {
    expect(codes(prg("c : FB_I;", "", fb))).toEqual(["fb-init-argument"])
  })
})

describe("interfaces", () => {
  const itf = "INTERFACE I\nMETHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n"
  test("an implementation whose METHOD declares a VAR_IN_OUT the interface's has not is refused (`rk_interface_impl_method_inout`)", () => {
    const impl = "FUNCTION_BLOCK FB_X IMPLEMENTS I\nEND_FUNCTION_BLOCK\nMETHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nVAR_IN_OUT\n\tio : INT;\nEND_VAR\nM := a + io;\nEND_METHOD\n"
    expect(codes(prg("x : FB_X; i : I; res : INT;", "i := x;\nres := i.M(a := 2);", itf + impl))).toEqual(["interface-impl-signature"])
  })
  test("an interface given an INT is refused (`rk_interface_given_integer`)", () => {
    expect(codes(prg("n : INT; i : I;", "i := n;", itf))).toEqual(["interface-given-value"])
  })
  test("an interface given a REFERENCE TO an FB that implements it is not invalid — no recording refuses it", () => {
    const impl = "FUNCTION_BLOCK FB_X IMPLEMENTS I\nEND_FUNCTION_BLOCK\nMETHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nM := a;\nEND_METHOD\n"
    const found = codes(prg("f : FB_X; rf : REFERENCE TO FB_X; i : I;", "rf REF= f;\ni := rf;", itf + impl))
    expect(found).toEqual(["interface-value"])
  })
  test("an interface given a REFERENCE TO a project FB that does not implement it is refused, read through the reference", () => {
    const fb = "FUNCTION_BLOCK FB_N\nEND_FUNCTION_BLOCK\n"
    expect(codes(prg("f : FB_N; i : I;", "i := f;", itf + fb))).toEqual(["interface-type"])
    expect(codes(prg("f : FB_N; rf : REFERENCE TO FB_N; i : I;", "rf REF= f;\ni := rf;", itf + fb))).toEqual(["interface-type"])
  })
  test("`__QUERYINTERFACE` of an INT is refused (`calls_queryinterface_int_first`)", () => {
    expect(codes(prg("n : INT; i : I; ok : BOOL;", "ok := __QUERYINTERFACE(n, i);", itf))).toEqual(["interface-query-operand"])
  })
})

describe("places, pointers, references and addresses", () => {
  test("a GVL named with a member it does not declare is refused (`sym_gvl_unknown_member`)", () => {
    const gvl = { uri: "file:///p/GVL_G.gvl", source: "{attribute 'qualified_only'}\nVAR_GLOBAL\n\tg : INT;\nEND_VAR\n" }
    expect(codes(prg("res : INT;", "res := GVL_G.nope;"), [gvl])).toEqual(["gvl-member-unknown"])
  })
  test("a dereference of an INT, a STRING and a POINTER indexed twice are refused (`rk_string_indexed_two_dims`, `cc3_pointer_conversions`)", () => {
    expect(codes(prg("x : INT; res : INT;", "res := x^;"))).toEqual(["deref-not-pointer"])
    expect(codes(prg("txt : STRING := 'abc'; v : BYTE;", "v := txt[0, 1];"))).toEqual(["index-dims"])
    expect(codes(prg("a : ARRAY[0..3] OF INT; p : POINTER TO INT; res : INT;", "p := ADR(a[0]);\nres := p[0, 1];"))).toEqual(["index-dims"])
  })
  test("a REFERENCE bound to a variable of another type is refused (`refdecl_target_wrong_type`); a POINTER given one is not (`calls_adr_on_bit_field`)", () => {
    expect(codes(prg("x : STRING; ref_ : REFERENCE TO INT REF= x; v : INT;", "v := ref_;"))).toContain("reference-type")
  })
  test("REF= from a REFERENCE of the same type builds (pro2193 `MapperBase.SetSliceRef`); from one of another type it does not (`cv_reference_to_other_reference`)", () => {
    const same = codes(prg("x : INT; rf : REFERENCE TO INT; rf2 : REFERENCE TO INT; v : INT;", "rf REF= x;\nrf2 REF= rf;\nv := rf2;"))
    expect(same).not.toContain("reference-type")
    expect(same).toContain("pointer-type")
    const other = codes(prg("y : REAL; rr : REFERENCE TO REAL; ri : REFERENCE TO INT; v : INT;", "rr REF= y;\nri REF= rr;\nv := ri;"))
    expect(other).toContain("reference-type")
  })
  test("a 32-bit integer stored into a pointer on the 64-bit target is refused (`pointer_to_dword_roundtrip`); an LWORD is not (`pointer_to_lword_roundtrip`)", () => {
    const refused = codes(prg("dw : DWORD; x : INT; p : POINTER TO INT; v : INT;", "p := ADR(x);\np := dw;\nv := p^;"))
    expect(refused).toContain("integer-into-pointer")
    const built = codes(prg("lw : LWORD; x : INT; p : POINTER TO INT; v : INT;", "p := ADR(x);\nlw := p;\np := lw;\nv := p^;"))
    expect(built).not.toContain("integer-into-pointer")
  })
  test("a pointer stepped by a STRUCT is refused (`rk_pointer_stepped_by_struct`)", () => {
    const dut = "TYPE DUT_S :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE\n"
    expect(codes(prg("arr : ARRAY[0..2] OF INT; rec : DUT_S; p : POINTER TO INT;", "p := ADR(arr[0]);\np := p + rec;", dut))).toEqual(["pointer-operand"])
  })
  test("an AT address CODESYS calls malformed is refused (`lit_address_unsized`); an incomplete `%I*` is not modelled", () => {
    expect(codes(prg("b AT %M0 : BOOL;", "b := TRUE;"))).toEqual(["var-at-address"])
  })
})

describe("operands and unions", () => {
  test("operands with no common type are refused (`cmpop_time_vs_int`, `rk_builtin_mixed_types`)", () => {
    expect(codes(prg("t : TIME; n : INT; b : BOOL;", "b := t > n;"))).toEqual(["operand-types"])
    expect(codes(prg("b : BOOL := TRUE; t : TIME; res : TIME;", "res := MAX(b, t);"))).toEqual(["operand-types"])
  })
  test("a UNION member with an initial value builds (`rk_union_member_initial_value`); a member whose overlay is unmeasured is not-measured", () => {
    const init = "TYPE DUT_U :\nUNION\n\tw : WORD := 16#0102;\n\tb : BYTE;\nEND_UNION\nEND_TYPE\n"
    expect(codes(prg("u : DUT_U; lo : BYTE;", "lo := u.b;", init))).toContain("layout-union")
    const overlay = "TYPE DUT_V :\nUNION\n\tx : BOOL;\n\tb : BYTE;\nEND_UNION\nEND_TYPE\n"
    expect(codes(prg("u : DUT_V; lo : BYTE;", "lo := u.b;", overlay))).toContain("union-overlay")
  })
})

describe("the init step's attributes", () => {
  const slot = (inputs: string) =>
    `FUNCTION_BLOCK FB_S\nVAR\n\tinits : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n{attribute 'call_after_global_init_slot' := '50000'}\nMETHOD AfterInit\nVAR_INPUT\n${inputs}\nEND_VAR\ninits := inits + 1;\nEND_METHOD\n`
  test("one input `bInitRetains` builds (`rk_init_slot_method_binitretains`); any other is refused (`rk_init_slot_method_with_input`)", () => {
    expect(codes(prg("cell : FB_S; v : INT;", "v := cell.inits;", slot("\tbInitRetains : BOOL;")))).toEqual(["attr-init-inputs"])
    expect(codes(prg("cell : FB_S; v : INT;", "v := cell.inits;", slot("\tstep : INT;")))).toEqual(["attr-init-signature"])
  })
})

describe("a body whose conditional pragma asks what Volt is not given is not measured; a body that does not parse is not modelled", () => {
  test("`{IF hasconstanttype (...)}` (`prag_if_hasconstanttype`: CODESYS runs it) and a body with a syntax error", () => {
    const pragma = "FUNCTION_BLOCK FB_Q\nVAR\n\tc : INT := 5;\n\tout : INT;\nEND_VAR\n{IF hasconstanttype (c, TRUE)}\nout := 1;\n{ELSE}\nout := 2;\n{END_IF}\nEND_FUNCTION_BLOCK\n"
    expect(codes(prg("q : FB_Q;", "q();", pragma))).toEqual(["pragma-undecided"])
  })
  test("`parse` is not invalid: CODESYS builds ST the LSP's parser refuses (`expr_pool_qualified_fb_type`: \"Type definition expected instead of '__POOL'\")", () => {
    expect(lowerCodeKind("parse")).toBe("not-modelled")
  })
})

describe("recursion: a FUNCTION or METHOD naming itself is invalid; recursion through another routine or a PROGRAM runs", () => {
  test("a FUNCTION calling itself by name is refused — its name is its result there (`cc2_call_recursion`, `calls_method_recursive`)", () => {
    const f = "FUNCTION F : INT\nVAR_INPUT\n\tn : INT;\nEND_VAR\nIF n > 0 THEN\n\tF := F(n := n - 1) + 1;\nEND_IF\nEND_FUNCTION\n"
    expect(codes(prg("res : INT;", "res := F(n := 2);", f))).toEqual(["call-recursive"])
  })
  test("a METHOD calling itself through THIS^ is not invalid — its name is not its result there, and no recording refuses it", () => {
    const fb =
      "FUNCTION_BLOCK FB_R\nEND_FUNCTION_BLOCK\nMETHOD M : INT\nVAR_INPUT\n\tn : INT;\nEND_VAR\nIF n > 0 THEN\n\tM := THIS^.M(n := n - 1) + 1;\nELSE\n\tM := 0;\nEND_IF\nEND_METHOD\n"
    expect(codes(prg("f : FB_R; out : INT;", "out := f.M(n := 2);", fb))).toEqual(["call-recursion"])
    const bare = fb.replace("THIS^.M(", "M(")
    expect(codes(prg("f : FB_R; out : INT;", "out := f.M(n := 2);", bare))).toEqual(["call-recursive"])
  })
  test("an ACTION or a METHOD with no result calling itself by name is not invalid — it has no name-as-result, no recording refuses it", () => {
    const action = "FUNCTION_BLOCK FB_A\nVAR\n\tn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nACTION Act\nIF n > 0 THEN\n\tn := n - 1;\n\tAct();\nEND_IF\nEND_ACTION\n"
    expect(codes(prg("f : FB_A;", "f.n := 2;\nf.Act();", action))).toEqual(["call-recursion"])
    const method = "FUNCTION_BLOCK FB_R\nVAR\n\tn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD M\nIF n > 0 THEN\n\tn := n - 1;\n\tM();\nEND_IF\nEND_METHOD\n"
    expect(codes(prg("f : FB_R;", "f.n := 2;\nf.M();", method))).toEqual(["call-recursion"])
  })
  test("two FUNCTIONs calling each other run (`calls_functions_mutually_recursive`)", () => {
    const fs =
      "FUNCTION F_A : INT\nVAR_INPUT\n\tn : INT;\nEND_VAR\nIF n > 0 THEN\n\tF_A := F_B(n := n - 1) + 1;\nEND_IF\nEND_FUNCTION\n" +
      "FUNCTION F_B : INT\nVAR_INPUT\n\tn : INT;\nEND_VAR\nIF n > 0 THEN\n\tF_B := F_A(n := n - 1) + 1;\nEND_IF\nEND_FUNCTION\n"
    expect(codes(prg("res : INT;", "res := F_A(n := 2);", fs))).toEqual(["call-recursion"])
  })
  test("a PROGRAM calling itself runs (`rk_program_calls_itself`: CODESYS warns \"Call recursion\" and runs it, 3)", () => {
    expect(codes(prg("n : INT;", "n := n + 1;\nIF n < 3 THEN\n\tP();\nEND_IF"))).toEqual(["call-program"])
    const called = "PROGRAM PRG_R\nVAR\n\tn : INT;\nEND_VAR\nn := n + 1;\nIF n < 3 THEN\n\tPRG_R();\nEND_IF\nEND_PROGRAM\n"
    expect(codes(prg("", "PRG_R();", called))).toEqual(["call-recursion"])
  })
})

describe("the not-modelled halves the splits leave behind", () => {
  test("an implementation whose METHOD reaches its FB's VAR_IN_OUT — a hidden in-out, the signature matches — is not modelled", () => {
    const itf = "INTERFACE I\nMETHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n"
    const impl = "FUNCTION_BLOCK FB_X IMPLEMENTS I\nVAR_IN_OUT\n\tio : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nM := a + io;\nEND_METHOD\n"
    expect(codes(prg("x : FB_X; i : I; res : INT; v : INT := 4;", "x(io := v);\ni := x;\nres := i.M(a := 2);", itf + impl))).toEqual(["interface-call-shape"])
  })
  test("an incomplete `%I*` address is not modelled (`lit_address_incomplete`: it builds, mapped by a VAR_CONFIG)", () => {
    const fb = "FUNCTION_BLOCK FB_A\nVAR\n\tb AT %I* : BOOL;\n\tc : BOOL;\nEND_VAR\nc := b;\nEND_FUNCTION_BLOCK\n"
    expect(codes(prg("f : FB_A;", "f();", fb))).toEqual(["var-at"])
  })
  test("a POINTER given the address of another type is not modelled (`calls_adr_on_bit_field`)", () => {
    expect(codes(prg("x : REAL := 1.0; p : POINTER TO DINT; v : DINT;", "p := ADR(x);\nv := p^;"))).not.toContain("reference-type")
  })
})
