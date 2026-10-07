/**
 * narrowing / sign-change on a DECLARATION's initializer, and how often the compiler reports it (see
 * `pushForDeclaration`). The conversion relation itself is covered below ("implicit conversions", merged here in analysis-conformance 1.14).
 */
import { test, expect, describe } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig, type Vendor } from "../../index.js"
import { uriFor } from "../../test-uri.js"


test("a VAR CONSTANT initializer warns ONCE in an FB, where a plain VAR warns twice", () => {
  // A constant is folded at compile time, not stored on the instance, so there is no instance initialisation to
  // check it a second time (conformance `co_any_to_conversions` — one warning — against `ir_initializer_warning_*`).
  const run = (section: string) => {
    const src = `FUNCTION_BLOCK F\n${section}\ncLimit : DINT := 16#80000000;\nEND_VAR\nEND_FUNCTION_BLOCK`
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
    return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "sign-change-conversion")
      .map((d) => d.message)
  }
  expect(run("VAR CONSTANT")).toHaveLength(1)
  expect(run("VAR")).toHaveLength(2)
})

// THE CONVERSIONS INSIDE AN INITIALIZER, which is the body arm's question asked in the other place. The store
// here converts nothing — a DINT into a DINT — and the ARGUMENT converts everything: `EXPT` answers LREAL and
// `REAL_TO_DINT` wants a REAL (`cfold_expt`, `cfold_sqrt`, both recordings 2026-09-21).
test("a conversion ARGUMENT inside an initializer warns, and twice like any declaration", () => {
  const src = `FUNCTION_BLOCK F
VAR
	i : DINT := REAL_TO_DINT(EXPT(2, 10));
END_VAR
END_FUNCTION_BLOCK`
  const pr = parseSource(src, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }], [], "codesys")
  const messages = computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "narrowing-conversion")
    .map((d) => d.message)
  expect(messages).toEqual([
    "Implicit conversion from 'LREAL' to 'REAL': Possible loss of information",
    "Implicit conversion from 'LREAL' to 'REAL': Possible loss of information",
  ])
})

// ── LITERAL TYPING IN A CONTEXT (frontend-conformance 4.2, rule LT12; both vendors recorded 2026-10-03) ──

/** The sign-change and narrowing messages over `body` in an FB declaring `vars`, as `vendor`. */
const signMessages = (vars: string, body: string, vendor: "codesys" | "twincat"): string[] => {
  const src = `FUNCTION_BLOCK F\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }], [], vendor)
  return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "sign-change-conversion" || d.code === "narrowing-conversion")
    .map((d) => d.message)
}

test("an untyped non-negative literal beside a narrower variable converts nothing in a comparison — both vendors (`lt_literal_in_comparison`)", () => {
  for (const vendor of ["codesys", "twincat"] as const)
    expect(signMessages("si : SINT; i : INT; b : BOOL;", "b := si = 200;\nb := si < 300;\nb := i = 70000;\nb := i > -40000;", vendor)).toEqual([])
})

test("an untyped NEGATIVE literal beside an unsigned variable converts the literal — into the operand's type on TwinCAT, into UDINT on CODESYS (`lt_literal_negative_in_comparison_unsigned`)", () => {
  const body = "b := u = -1;\nb := ui > -1;"
  expect(signMessages("u : USINT; ui : UINT; b : BOOL;", body, "twincat")).toEqual([
    "Implicit conversion from signed Type 'SINT' to unsigned Type 'USINT' : possible change of sign",
    "Implicit conversion from signed Type 'SINT' to unsigned Type 'UINT' : possible change of sign",
  ])
  expect(signMessages("u : USINT; ui : UINT; b : BOOL;", body, "codesys")).toEqual([
    "Implicit conversion from signed Type 'SINT' to unsigned Type 'UDINT' : Possible change of sign",
    "Implicit conversion from signed Type 'SINT' to unsigned Type 'UDINT' : Possible change of sign",
  ])
})

test("a CASE label converts into the selector's type: 200 under a SINT selector is USINT → SINT (`lt_literal_case_label_out_of_range`)", () => {
  expect(signMessages("si : SINT; out : INT;", "CASE si OF\n100: out := 1;\n200: out := 2;\nEND_CASE", "codesys")).toEqual([
    "Implicit conversion from unsigned Type 'USINT' to signed Type 'SINT' : Possible change of sign",
  ])
  // labels the selector's type holds convert nothing (`lt_literal_case_label`)
  expect(signMessages("si : SINT; out : INT;", "CASE si OF\n-128: out := 1;\n0..10: out := 2;\n127: out := 3;\nEND_CASE", "twincat")).toEqual([])
})

test("a FOR bound converts into the counter's type: TO 200 over a SINT counter is USINT → SINT (`lt_literal_for_bounds_out_of_range`)", () => {
  expect(signMessages("si : SINT; n : INT;", "FOR si := 1 TO 200 DO\n\tn := n + 1;\nEND_FOR", "twincat")).toEqual([
    "Implicit conversion from unsigned Type 'USINT' to signed Type 'SINT' : possible change of sign",
  ])
  expect(signMessages("si : SINT; n : INT;", "FOR si := -128 TO 126 DO\n\tn := n + 1;\nEND_FOR\nFOR si := 0 TO 100 BY 2 DO\n\tn := n + 1;\nEND_FOR", "codesys")).toEqual([])
})

test("a CASE label converts only in the measured shape — a same-width unsigned literal under a signed selector; a negative label under an unsigned selector is unmeasured and silent (step 4a review)", () => {
  for (const vendor of ["codesys", "twincat"] as const)
    expect(signMessages("w : WORD; n : INT;", "CASE w OF\n-1: n := 2;\nEND_CASE", vendor)).toEqual([])
})

test("a NEGATIVE literal beside a 32- or 64-bit unsigned operand is unmeasured on both vendors and stays silent (step 4a review)", () => {
  for (const vendor of ["codesys", "twincat"] as const)
    expect(signMessages("ud : UDINT; ul : ULINT; b : BOOL;", "b := ud > -1;\nb := ul = -1;", vendor)).toEqual([])
})

// THE SELECTION FUNCTIONS CONVERT EVERY VALUE ARGUMENT INTO THEIR MEET, as MIN and MAX do: one warning per argument that
// crosses sign or loses information on the way, the selector and the index converting nothing (`ar_limit_mixed_types`,
// `ar_sel_mixed_types`, `ar_mux_mixed_types`, both vendors 2026-10-03, rule AR14).
test("LIMIT, SEL and MUX warn on each value argument that converts into the meet", () => {
  const run = (body: string): string[] => {
    const src = `FUNCTION_BLOCK F\nVAR\n i : INT; ui : UINT; li : LINT; rv : REAL; g : BOOL; k : INT; out : STRING;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK`
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
    return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "sign-change-conversion" || d.code === "narrowing-conversion")
      .map((d) => d.message)
  }
  const sign = "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT' : Possible change of sign"
  expect(run("out := LIMIT(i, ui, i);")).toEqual([sign])
  expect(run("out := LIMIT(ui, i, ui);")).toEqual([sign, sign])
  expect(run("out := SEL(g, i, ui);")).toEqual([sign])
  expect(run("out := MUX(k, ui, i);")).toEqual([sign])
  expect(run("out := SEL(g, li, rv);")).toEqual(["Implicit conversion from 'LINT' to 'REAL': Possible loss of information"])
})

// A bit operator's untyped literal stays at the operand's width (`arith/checked` `bitwiseLiteralOperandType`): widening
// `si AND 255` to the next SIGNED integer as at `+` made inference say INT and refuse the store back into the SINT
// (finding 4b), code CODESYS builds with only the operand's sign warning (`cc_bitwise_sint_and_literal`).
test("a bit operator's out-of-signed-range literal is refused nowhere (`cc_bitwise_sint_and_literal`, `ar_bitwise_literal_beyond_width`)", () => {
  const src = `FUNCTION_BLOCK F\nVAR\nsi : SINT; i : INT; di : DINT; w : WORD; res : INT;\nEND_VAR\nres := si AND 255;\nsi := si AND 255;\ni := i AND 16#FF00;\ndi := di OR 16#80000000;\nw := i AND 16#FF00;\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }], [], "codesys")
  const all = computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
  expect(all.filter((d) => /Cannot convert/.test(d.message)).map((d) => d.message)).toEqual([])
  expect(signMessages("sn : SINT; res : INT;", "res := sn AND 255;", "codesys")).toEqual([
    "Implicit conversion from signed Type 'SINT' to unsigned Type 'USINT' : Possible change of sign",
  ])
})

// A NEGATIVE literal beside a bit operator converts from its OWN type (the smallest signed integer holding it, SINT for
// -1) into the unsigned integer the operation computes in — beside the signed operand's own conversion
// (`ar_bitwise_literal_unsigned_or_negative`, `_stores`, both vendors 2026-10-03). TwinCAT prints one copy of a message
// per line, so `si AND -1` warns once there and twice on CODESYS; `i XOR -1` warns INT and SINT into UINT on both.
test("a negative literal beside a bit operator converts into the operation's unsigned type (`ar_bitwise_literal_unsigned_or_negative`)", () => {
  const sint = "Implicit conversion from signed Type 'SINT' to unsigned Type 'USINT' : Possible change of sign"
  const back = "Implicit conversion from unsigned Type 'USINT' to signed Type 'SINT' : Possible change of sign"
  expect(signMessages("si : SINT;", "si := si AND -1;", "codesys").sort()).toEqual([sint, sint, back].sort())
  expect(signMessages("si : SINT;", "si := si AND -1;", "twincat").length).toBe(2)
  expect(signMessages("si : SINT; us : USINT;", "us := -1 AND si;", "codesys")).toEqual([sint, sint])
  expect(signMessages("i : INT; ui : UINT;", "ui := i XOR -1;", "codesys").sort()).toEqual([
    "Implicit conversion from signed Type 'INT' to unsigned Type 'UINT' : Possible change of sign",
    "Implicit conversion from signed Type 'SINT' to unsigned Type 'UINT' : Possible change of sign",
  ])
  expect(signMessages("i : INT; ui : UINT;", "ui := i XOR -1;", "twincat").length).toBe(2)
})

// A duration scaled by an integer no wider than it keeps the duration, and the integer converts into the SIGNED integer
// of the duration's width: CODESYS warns for a same-width UNSIGNED one — "UDINT to DINT" beside a TIME, "ULINT to LINT"
// beside an LTIME — and TwinCAT is silent (`ar_duration_scaled_by_same_width_unsigned_type`, `ar_duration_scaled_stores`,
// 2026-10-03). A narrower integer widens silently (`ar_time_scaled_by_wide_or_unsigned_int_type`: TIME × UINT, × SINT).
test("a duration scaled by a same-width unsigned integer warns its change of sign on CODESYS only", () => {
  const vars = "t : TIME; ud : UDINT; ui : UINT; si : SINT; ltm : LTIME; ul : ULINT;"
  const udint = "Implicit conversion from unsigned Type 'UDINT' to signed Type 'DINT' : Possible change of sign"
  const ulint = "Implicit conversion from unsigned Type 'ULINT' to signed Type 'LINT' : Possible change of sign"
  expect(signMessages(vars, "t := t * ud;", "codesys")).toEqual([udint])
  expect(signMessages(vars, "t := ud * t;", "codesys")).toEqual([udint])
  expect(signMessages(vars, "t := t / ud;", "codesys")).toEqual([udint])
  expect(signMessages(vars, "ltm := ltm * ul;", "codesys")).toEqual([ulint])
  expect(signMessages(vars, "ltm := ul * ltm;", "codesys")).toEqual([ulint])
  expect(signMessages(vars, "t := t * ui;\nt := t * si;", "codesys")).toEqual([])
  expect(signMessages(vars, "t := t * ud;\nltm := ltm / ul;", "twincat")).toEqual([])
})

/**
 * implicit-conversion — the WARNINGs derived from `classifyConversion`: narrow (loss) + sign-change. Both
 * wordings confirmed live (only "Possible"/"possible" differs per vendor). Also pins that an ERROR kind
 * (integer narrowing) does NOT also produce a conversion warning — one site, one diagnostic.
 */
describe("implicit conversions", () => {
  const conv = (decls: string, body: string, vendor: Vendor = "codesys") => {
    const src = `FUNCTION_BLOCK F\nVAR\n${decls}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK`
    const pr = parseSource(src, { networkText: true }, vendor)
    const p = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }], [], vendor)
    return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project: p, config: resolveConfig({ vendor }) }).filter(
      (d) => d.code === "narrowing-conversion" || d.code === "sign-change-conversion",
    )
  }

  test("each `:=` link of a chained assignment is its own store — the inner narrowing warns", () => {
    // Why missed: the check paired only the outer target with the final value; chains arrived with the execution programs
    // (conformance `assign_chained_plain`: `outL := midR := srcL` warns LREAL → REAL once).
    const diags = conv("x : INT; y : INT; z : INT; srcL : LREAL; midR : REAL; outL : LREAL;", "x := y := z;\noutL := midR := srcL;")
    expect(diags.map((d) => d.message)).toEqual(["Implicit conversion from 'LREAL' to 'REAL': Possible loss of information"])
  })

  test("a same-width signed/unsigned pair warns on the operand the operation converts", () => {
    // Why missed: only assignments, conversion arguments and unary minus were walked — never an operator's operands. The
    // execution programs mixed signs inside expressions, and their builds warned where the LSP was silent (conformance
    // `cc_add_*`, `cc_bitwise_*`, `cc_not_*`, `cc_max_*`, `cc_*_udint_dint`, `cc_compare_uint_int`).
    const msgs = conv(
      "wv : WORD; si : INT; bv : BYTE; sn : SINT; un : UINT; ud : UDINT; di : DINT; res : DINT; ok : BOOL;",
      "res := wv + si;\nres := bv AND sn;\nres := NOT sn;\nres := MAX(ud, di);\nok := ud <= di;\nok := un > si;\nres := un XOR 1;\nres := sn AND 255;",
    ).map((d) => d.message)
    expect(msgs).toEqual([
      "Implicit conversion from unsigned Type 'WORD' to signed Type 'INT' : Possible change of sign",
      "Implicit conversion from signed Type 'SINT' to unsigned Type 'USINT' : Possible change of sign",
      "Implicit conversion from signed Type 'SINT' to unsigned Type 'USINT' : Possible change of sign",
      "Implicit conversion from unsigned Type 'UDINT' to signed Type 'DINT' : Possible change of sign",
      "Implicit conversion from unsigned Type 'UDINT' to signed Type 'DINT' : Possible change of sign",
      "Implicit conversion from signed Type 'SINT' to unsigned Type 'USINT' : Possible change of sign",
    ])
  })

  test("a REAL literal beyond REAL's range is an LREAL — the only real literal that warns into a REAL", () => {
    // Why missed: a literal's warning type was measured for integers only (conformance `cc_real_init_max`, `_tiny`,
    // `_sci_fraction`; `real_to_string_digits`).
    const msgs = conv("big : REAL := 3.4028235E38; mid : REAL := 1.5E8; tiny : REAL := 2.5E-10;", "").map((d) => d.message)
    // twice, because it is an FB DECLARATION's initializer — see `pushForDeclaration`
    expect(msgs).toEqual([
      "Implicit conversion from 'LREAL' to 'REAL': Possible loss of information",
      "Implicit conversion from 'LREAL' to 'REAL': Possible loss of information",
    ])
  })

  test("a typed literal sum folds into the narrowest type of its signedness that holds it", () => {
    // Why missed: inference typed `USINT#200 + USINT#100` as USINT, its operands' type (conformance `cc_typed_fold_*`).
    const msgs = conv("i : INT; d : DINT;", "i := USINT#200 + USINT#100;\ni := SINT#100 + SINT#100;\ni := USINT#1 + USINT#2;\nd := INT#30000 + INT#30000;")
    expect(msgs.map((d) => d.message)).toEqual(["Implicit conversion from unsigned Type 'UINT' to signed Type 'INT' : Possible change of sign"])
  })

  test("an enum value into an unsigned type warns change of sign as a signed INT would — it was never typed here", () => {
    // The warning typed the value by inference alone, which gives an enum VALUE no type (conformance `cc_enum_into_uint`,
    // `cc_enum_into_dword`; into DINT silent, `cc_enum_into_dint`).
    const src = `TYPE E_Mode :\n(\n\tIdle := 0,\n\tBusy := 1\n);\nEND_TYPE\n\nFUNCTION_BLOCK F\nVAR\n\tu : UINT;\n\tw : DWORD;\n\ti : DINT;\nEND_VAR\nu := E_Mode.Busy;\nw := E_Mode.Busy;\ni := E_Mode.Busy;\nEND_FUNCTION_BLOCK`
    const pr = parseSource(src, { networkText: true })
    const p = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }], [], "codesys")
    const messages = computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project: p, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "sign-change-conversion")
      .map((d) => d.message)
    expect(messages).toEqual([
      "Implicit conversion from signed Type 'E_MODE' to unsigned Type 'UINT' : Possible change of sign",
      "Implicit conversion from signed Type 'E_MODE' to unsigned Type 'DWORD' : Possible change of sign",
    ])
  })

  test("a LIBRARY enum stays silent — real builds store one into a WORD without the warning", () => {
    // bakon-nano and pro2193 assign `L_IE1P_Error` variables to WORDs and their builds report no change of sign, while a
    // project enum's variable does warn (conformance `cc_enum_var_into_word`). Why is unrecorded, so no rule is guessed.
    const lib = `TYPE E_Lib :\n(\n\tIdle := 0,\n\tBusy := 1\n);\nEND_TYPE`
    const src = `FUNCTION_BLOCK F\nVAR\n\te : E_Lib;\n\tw : WORD;\nEND_VAR\nw := e;\nEND_FUNCTION_BLOCK`
    const libResult = parseSource(lib, { networkText: true })
    const pr = parseSource(src, { networkText: true })
    const p = build.buildSymbolTable([
      { uri: "Application/Library Manager/Lib/E_Lib.dut", parseResult: libResult, source: lib },
      { uri: "F.pou", parseResult: pr, source: src },
    ])
    const d = computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project: p, config: resolveConfig({ vendor: "codesys" }) })
    expect(d.filter((x) => x.code === "sign-change-conversion")).toEqual([])
  })

  test("narrowing (LREAL→REAL) warns 'possible loss of information'", () => {
    const d = conv("rx : REAL; l : LREAL;", "rx := l;")
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ severity: "warning", code: "narrowing-conversion" })
    expect(d[0]?.message).toBe("Implicit conversion from 'LREAL' to 'REAL': Possible loss of information")
  })

  test("sign-change (WORD→INT) warns byte-identical; vendor differs only in caps", () => {
    const cs = conv("x : INT; w : WORD;", "x := w;")
    expect(cs[0]).toMatchObject({ severity: "warning", code: "sign-change-conversion" })
    expect(cs[0]?.message).toBe("Implicit conversion from unsigned Type 'WORD' to signed Type 'INT' : Possible change of sign")
    const tc = conv("x : INT; w : WORD;", "x := w;", "twincat")
    expect(tc[0]?.message).toBe("Implicit conversion from unsigned Type 'WORD' to signed Type 'INT' : possible change of sign")
  })

  test("an untyped integer literal the target cannot hold warns as its literal type (gap 13)", () => {
    // silent before: a bare integer literal typed UNKNOWN (conformance `cc_literal_*`, `overflow_*`)
    const msgs = (decls: string, body: string) => conv(decls, body).map((d) => d.message)
    expect(msgs("si : SINT;", "si := 128;")).toEqual(["Implicit conversion from unsigned Type 'USINT' to signed Type 'SINT' : Possible change of sign"])
    expect(msgs("i : INT;", "i := 40000;")).toEqual(["Implicit conversion from unsigned Type 'UINT' to signed Type 'INT' : Possible change of sign"])
    expect(msgs("d : DINT;", "d := 3000000000;")).toEqual(["Implicit conversion from unsigned Type 'UDINT' to signed Type 'DINT' : Possible change of sign"])
    expect(msgs("us : USINT;", "us := -1;")).toEqual(["Implicit conversion from signed Type 'SINT' to unsigned Type 'USINT' : Possible change of sign"])
    // a declaration's initializer too — and an FB's is reported TWICE, as the IDE does (`pushForDeclaration`)
    expect(msgs("u : UINT := -5;", "")).toEqual([
      "Implicit conversion from signed Type 'SINT' to unsigned Type 'UINT' : Possible change of sign",
      "Implicit conversion from signed Type 'SINT' to unsigned Type 'UINT' : Possible change of sign",
    ])
    // silent: the target holds the value (a small literal into an unsigned or a bit string warns nothing), or it is an error
    expect(msgs("us : USINT; w : WORD; b : BYTE; si : SINT; r : REAL;", "us := 5; w := 5; b := 0; si := 127; r := 5; b := 300;")).toEqual([])
  })

  test("sign-change fires both directions (signed→unsigned too)", () => {
    const d = conv("u : UINT; i : INT;", "u := i;")
    expect(d[0]?.message).toBe("Implicit conversion from signed Type 'INT' to unsigned Type 'UINT' : Possible change of sign")
  })

  test("an integer narrowing (DINT→INT) is an ERROR, not a conversion warning — no double diagnostic", () => {
    expect(conv("x : INT; d : DINT;", "x := d;")).toEqual([]) // the assignment-type-mismatch check owns it
  })

  test("a safe widening (SINT→INT) produces no conversion warning", () => {
    expect(conv("x : INT; s : SINT;", "x := s;")).toEqual([])
  })

  // ── conversion-function ARGUMENTS: `<SRC>_TO_<DST>(arg)` implicitly converts `arg` to `<SRC>` ──────────────
  // Corpus-found (lenze): `REAL_TO_DINT(<LREAL>)` and `UINT_TO_WORD(<INT>)` — CODESYS warns on the argument
  // exactly as an assignment to a `<SRC>` variable would. The assignment-only check missed this whole class.

  test("conversion arg that narrows (REAL_TO_DINT of an LREAL) warns 'loss of information'", () => {
    const d = conv("d : DINT; l : LREAL;", "d := REAL_TO_DINT(l);")
    expect(d).toHaveLength(1)
    expect(d[0]?.message).toBe("Implicit conversion from 'LREAL' to 'REAL': Possible loss of information")
  })

  test("conversion arg that sign-changes (UINT_TO_WORD of an INT) warns 'change of sign'", () => {
    const d = conv("w : WORD; i : INT;", "w := UINT_TO_WORD(i);")
    expect(d).toHaveLength(1)
    expect(d[0]?.message).toBe("Implicit conversion from signed Type 'INT' to unsigned Type 'UINT' : Possible change of sign")
  })

  test("conversion arg already the source type does NOT warn (zero-FP)", () => {
    expect(conv("r : REAL; i : INT;", "r := INT_TO_REAL(i);")).toEqual([]) // arg INT = source INT
    expect(conv("i : INT; w : WORD;", "i := WORD_TO_INT(w);")).toEqual([]) // arg WORD = source WORD
    expect(conv("s : STRING; i : INT;", "s := TO_STRING(i);")).toEqual([]) // TO_STRING has no elementary source
  })

  // EXPT is modeled as returning LREAL, so a conversion whose arg is an EXPT result sees the narrowing.
  // Corpus-found (lenze fc_DintToTime): `REAL_TO_DINT(EXPT(10, DecShift))` — LREAL result narrows into REAL.
  test("a conversion arg that is an EXPT result (LREAL) narrows into a REAL source", () => {
    const d = conv("d : DINT; n : DINT;", "d := REAL_TO_DINT(EXPT(10, n));")
    expect(d).toHaveLength(1)
    expect(d[0]?.message).toBe("Implicit conversion from 'LREAL' to 'REAL': Possible loss of information")
  })
})

/**
 * The "change of sign" a unary minus puts on an UNSIGNED operand (narrowing.ts `negationOperandWarning`). Wording
 * and trigger set recorded live on CODESYS SP21 (conformance `cc_neg_uint_into_int`, `cc_neg_word_into_word`,
 * `cc_neg_udint_into_udint`, `cc_neg_usint_into_usint`).
 */
describe("a negation's change of sign", () => {
  function warnings(decls: string, body: string) {
    const src = `PROGRAM PLC_PRG\nVAR\n  ${decls}\nEND_VAR\n${body}\nEND_PROGRAM`
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: uriFor(parseResult), parseResult, source: src }])
    return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.severity === "warning" || d.severity === "error")
      .map((d) => d.message)
  }

  test("negating a UINT converts it to INT first — CODESYS warns on the operand", () => {
    // Invisible before: unary minus was typed as its operand, so there was no conversion to warn about.
    expect(warnings("a : UINT; b : INT;", "b := -a;")).toEqual([
      "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT' : Possible change of sign",
    ])
  })

  test("storing it back into the UINT adds the assignment's own change of sign — both recorded", () => {
    expect(warnings("a : UINT; b : UINT;", "b := -a;").sort()).toEqual(
      [
        "Implicit conversion from signed Type 'INT' to unsigned Type 'UINT' : Possible change of sign",
        "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT' : Possible change of sign",
      ].sort(),
    )
  })

  test("an 8-bit unsigned operand widens into INT silently, and storing it back is the error CODESYS reports", () => {
    expect(warnings("a : USINT; b : USINT;", "b := -a;")).toEqual(["Cannot convert type 'INT' to type 'USINT'"])
    expect(warnings("a : SINT; b : SINT;", "b := -a;")).toEqual(["Cannot convert type 'INT' to type 'SINT'"])
  })

  test("a signed operand of 16 bits or more is untouched", () => {
    expect(warnings("a : INT; b : INT;", "b := -a;")).toEqual([])
    expect(warnings("a : SINT; b : INT;", "b := -a;")).toEqual([])
  })
})
