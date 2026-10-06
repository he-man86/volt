/**
 * ELEMENTARY TYPES, RULE BY RULE — design.md §4 4.1 of openspec `frontend-conformance` (TY1–TY15; tasks 4.1.1–4.1.3), each
 * rule the recorded fixtures elsewhere left a GAP in put to the vendor by fixtures of its own: `record:language` for
 * accept/refuse and the vendor's words, `record:exec` for the values (every FB below that builds copies what it reads into
 * VAR outputs, so the run recording holds `inst_<name>.<var>`).
 *
 *   TY5/TY6  the platform integers' width on each recording project's TARGET, and a pointer's (task 4.1.1): `__XINT`,
 *            `__UXINT` and `__XWORD` named by the message that converts them, and a pointer into each unsigned integer
 *            width (C0033, which names the width the pointer does not fit)
 *   TY11     the platform-alias conversion names `__XINT_TO_DINT` … and `DINT_TO___UXINT` … (task 4.1.2): their values, and
 *            their RESULT type, named by the message converting it on
 *   TY12     BIT, place by place: a FUNCTION's VAR and VAR_INPUT, a METHOD's VAR, an FB's VAR and VAR_INPUT, a GVL, and
 *            POINTER TO / REFERENCE TO / ARRAY OF BIT (task 4.1.3)
 *   TY13     an ARRAY of REFERENCE (and of POINTER, its control)
 *   TY14     ANY and the ANY_* groups as a parameter type, and which argument each accepts — and ANY_NUM as a local
 *   TY15     VERSION: its components and their types, an unknown component, VERSION into a STRING
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`…_<name>`): the replay binds every fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 4.1 (elementary types); docs/codesys-reference/06-data-types.md"

/** A function block `FB_LANG_<name>` with VAR `vars` and body `body`; `before` (whole units) is written ahead of it and
 *  `after` (its METHOD units) after it. Instanced in PLC_PRG as `inst_<name>` and called. */
function fb(name: string, feature: string, vars: string, body: string, before = "", after = "", sections = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}\n${sections}VAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n${after ? `\n${after}` : ""}`,
  }
}

/** A FUNCTION `FUN_LANG_<name> : <ret>` with sections `sections` and body `body`, called from PLC_PRG as `call`, its result
 *  in PLC_PRG's `<plcVars>`. */
function fun(name: string, feature: string, ret: string, sections: string, body: string, plcVars: string, call: string, before = ""): LanguageTest {
  const pouName = `FUN_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function",
    feature,
    fromDoc: doc,
    plcPrgVar: plcVars,
    plcPrgBody: call,
    source: `${before}FUNCTION ${pouName} : ${ret}\n${sections}${body}\nEND_FUNCTION\n`,
  }
}

/** `t`, whose refusal the LSP does not make — the reason, dated (`deferred.lsp`; `support/divergences.ts`
 *  `ELEMENTARY_RULE_DIVERGENCES`). */
const deferLsp = (t: LanguageTest, reason: string): LanguageTest => ({ ...t, deferred: { lsp: reason } })

/** A refusal whose sentence no catalog code carries. */
const noCatalogCode = (what: string, count: string): string =>
  `niche: accepted loss (${count}) (2026-10-03) — both vendors' words are recorded (${what}); not trivial: no catalog code carries the sentence, and a wire diagnostic is one (server/diagnostic-codes.ts admits no new slug)`

// ─── TY5/TY6 — the target's width (4.1.1) ─────────────────────────────────────────────────────────────────────────────

const PLATFORM_WIDTH: LanguageTest[] = [
  fb("ty_xint_twincat_width", "the three platform integers, each into a DINT and into a STRING — the messages name the width the recording project's target gives them",
    "\tx : __XINT := 5;\n\tux : __UXINT := 6;\n\txw : __XWORD := 7;\n\td : DINT;\n\tstr : STRING;",
    "d := x;\nd := ux;\nd := xw;\nstr := x;\nstr := ux;\nstr := xw;"),
  fb("ty_pointer_size_twincat", "a POINTER into every unsigned integer width and into the platform word — C0033 names the targets a pointer does not fit",
    "\theld : INT := 4;\n\tp : POINTER TO INT;\n\tw : WORD;\n\tdw : DWORD;\n\tud : UDINT;\n\tlw : LWORD;\n\tul : ULINT;\n\txw : __XWORD;",
    "p := ADR(held);\nw := p;\ndw := p;\nud := p;\nlw := p;\nul := p;\nxw := p;"),
]

// ─── TY11 — platform-alias conversion names (4.1.2) ───────────────────────────────────────────────────────────────────

const PLATFORM_CONVERSIONS: LanguageTest[] = [
  fb("ty_xint_to_dint", "`__XINT_TO_DINT`, `__UXINT_TO_UDINT`, `__XWORD_TO_DWORD` and `__XINT_TO_INT` — the platform type as a conversion's SOURCE",
    "\tx : __XINT := -70000;\n\tux : __UXINT := 70000;\n\txw : __XWORD := 16#1_0000_0005;\n\td : DINT;\n\tud : UDINT;\n\tdw : DWORD;\n\ti : INT;",
    "d := __XINT_TO_DINT(x);\nud := __UXINT_TO_UDINT(ux);\ndw := __XWORD_TO_DWORD(xw);\ni := __XINT_TO_INT(x);"),
  fb("ty_dint_to_uxint", "`DINT_TO___UXINT`, `DINT_TO___XINT`, `DWORD_TO___XWORD` and `INT_TO___XINT` — the platform type as a conversion's TARGET",
    "\td : DINT := -5;\n\tdw : DWORD := 16#FFFF_FFFF;\n\ti : INT := -3;\n\tux : __UXINT;\n\tx : __XINT;\n\txw : __XWORD;\n\tx2 : __XINT;",
    "ux := DINT_TO___UXINT(d);\nx := DINT_TO___XINT(d);\nxw := DWORD_TO___XWORD(dw);\nx2 := INT_TO___XINT(i);"),
  fb("ty_xint_to_dint_result_type", "a platform conversion's RESULT type, named by a store that refuses it: `__XINT_TO_DINT` into an INT, `DINT_TO___XINT` into a STRING",
    "\tx : __XINT := 5;\n\td : DINT := 6;\n\ti : INT;\n\tstr : STRING;",
    "i := __XINT_TO_DINT(x);\nstr := DINT_TO___XINT(d);"),
]

// ─── TY12 — BIT, place by place (4.1.3) ───────────────────────────────────────────────────────────────────────────────

const BIT_PLACES: LanguageTest[] = [
  fun("ty_bit_as_variable", "BIT as a FUNCTION's local variable", "BOOL",
    "VAR\n\tb : BIT;\nEND_VAR\n", "b := TRUE;\nFUN_LANG_ty_bit_as_variable := b;",
    "rBit : BOOL;", "rBit := FUN_LANG_ty_bit_as_variable();"),
  fun("ty_bit_as_function_input", "BIT as a FUNCTION's VAR_INPUT", "BOOL",
    "VAR_INPUT\n\tb : BIT;\nEND_VAR\n", "FUN_LANG_ty_bit_as_function_input := b;",
    "rBitIn : BOOL;", "rBitIn := FUN_LANG_ty_bit_as_function_input(TRUE);"),
  fb("ty_bit_as_fb_variable", "BIT as an FB's VAR — a field of the instance", "\tb : BIT;\n\tout : BOOL;", "b := TRUE;\nout := b;"),
  fb("ty_bit_as_fb_input", "BIT as an FB's VAR_INPUT", "\tout : BOOL;", "out := b;", "", "", "VAR_INPUT\n\tb : BIT;\nEND_VAR\n"),
  fb("ty_bit_as_method_variable", "BIT as a METHOD's local variable", "\tout : BOOL;", "out := M();", "",
    "METHOD M : BOOL\nVAR\n\tb : BIT;\nEND_VAR\nb := TRUE;\nM := b;\nEND_METHOD\n"),
  {
    name: "ty_bit_in_gvl",
    pouName: "FB_LANG_ty_bit_in_gvl",
    kind: "function_block",
    feature: "BIT as a global variable",
    fromDoc: doc,
    gvlNames: ["GVL_LANG_ty_bit_in_gvl"],
    plcPrgVar: "inst_ty_bit_in_gvl : FB_LANG_ty_bit_in_gvl;",
    plcPrgBody: "inst_ty_bit_in_gvl();",
    source:
      "VAR_GLOBAL\n\tgBit_ty_bit_in_gvl : BIT;\nEND_VAR\n\nFUNCTION_BLOCK FB_LANG_ty_bit_in_gvl\nVAR\n\tout : BOOL;\nEND_VAR\ngBit_ty_bit_in_gvl := TRUE;\nout := gBit_ty_bit_in_gvl;\nEND_FUNCTION_BLOCK\n",
  },
  fb("ty_pointer_to_bit", "POINTER TO BIT", "\tp : POINTER TO BIT;\n\tout : BOOL;", "out := p = 0;"),
  // "References to bits are not possible" — said by `bit-usage` since analysis-conformance 3.11 (the deferral left)
  fb("ty_reference_to_bit", "REFERENCE TO BIT", "\trb : REFERENCE TO BIT;\n\tout : BOOL;", "out := __ISVALIDREF(rb);"),
  fb("ty_array_of_bit", "ARRAY OF BIT", "\ta : ARRAY[1..8] OF BIT;\n\tout : BOOL;", "a[1] := TRUE;\nout := a[1];"),
]

// ─── TY13 — an ARRAY of REFERENCE ────────────────────────────────────────────────────────────────────────────────────

const REFERENCE_ELEMENTS: LanguageTest[] = [
  fb("ty_array_of_reference", "ARRAY OF REFERENCE TO INT", "\tv : INT := 3;\n\ta : ARRAY[1..2] OF REFERENCE TO INT;\n\tout : INT;", "a[1] REF= v;\nout := a[1];"),
  fb("ty_array_of_pointer", "ARRAY OF POINTER TO INT — the control beside the REFERENCE", "\tv : INT := 3;\n\ta : ARRAY[1..2] OF POINTER TO INT;\n\tout : INT;", "a[1] := ADR(v);\nout := a[1]^;"),
]

// ─── TY14 — ANY / ANY_* as a parameter type ──────────────────────────────────────────────────────────────────────────

/** A FUNCTION taking `x : <group>` and answering its size, called from PLC_PRG with `arg` (PLC_PRG's `<decls>` beside). */
const anyParam = (name: string, feature: string, group: string, decls: string, arg: string, before = ""): LanguageTest =>
  fun(name, feature, "DINT", `VAR_INPUT\n\tx : ${group};\nEND_VAR\n`, `FUN_LANG_${name} := x.diSize;`,
    `${decls}\nr_${name} : DINT;`, `r_${name} := FUN_LANG_${name}(${arg});`, before)

/** A STRUCT `DUT_LANG_<name>` of an INT and a BOOL, written ahead of the FUNCTION that names it. */
const structFor = (name: string): string => `TYPE DUT_LANG_${name} :\nSTRUCT\n\ta : INT;\n\tb : BOOL;\nEND_STRUCT\nEND_TYPE\n\n`

/** ANY_ELEMENTARY and ANY_MAGNITUDE are no TYPE on either vendor. */
const NO_SUCH_GROUP =
  "niche: accepted loss (0 occurrences in the corpora of ANY_ELEMENTARY or ANY_MAGNITUDE declared) (2026-10-03) — both vendors answer \"Unknown type: 'ANY_ELEMENTARY'\" twice, the argument's \"Cannot convert\" to it and the x.diSize it then cannot type; the LSP keeps both names in ANY_FAMILIES for the operators' rules and its unknown-type check passes every name there; not trivial: telling a declarable group from an operator family apart in that check"

const ANY_PARAMETERS: LanguageTest[] = [
  anyParam("ty_any_num_parameter_accepts_int", "ANY_NUM accepts an INT variable", "ANY_NUM", "iAnyNum : INT := 5;", "iAnyNum"),
  anyParam("ty_any_num_parameter_rejects_string", "ANY_NUM refuses a STRING variable", "ANY_NUM", "sAnyNum : STRING := 'a';", "sAnyNum"),
  anyParam("ty_any_num_parameter_accepts_real", "ANY_NUM accepts a REAL variable", "ANY_NUM", "rAnyNum : REAL := 1.5;", "rAnyNum"),
  anyParam("ty_any_num_parameter_rejects_bool", "ANY_NUM refuses a BOOL variable", "ANY_NUM", "bAnyNum : BOOL;", "bAnyNum"),
  anyParam("ty_any_num_parameter_rejects_time", "ANY_NUM refuses a TIME variable", "ANY_NUM", "tAnyNum : TIME;", "tAnyNum"),
  anyParam("ty_any_int_parameter_rejects_real", "ANY_INT refuses a REAL variable", "ANY_INT", "rAnyInt : REAL := 1.5;", "rAnyInt"),
  anyParam("ty_any_int_parameter_accepts_word", "ANY_INT accepts a WORD variable", "ANY_INT", "wAnyInt : WORD := 5;", "wAnyInt"),
  anyParam("ty_any_real_parameter_rejects_int", "ANY_REAL refuses an INT variable", "ANY_REAL", "iAnyReal : INT := 5;", "iAnyReal"),
  anyParam("ty_any_bit_parameter_rejects_int", "ANY_BIT refuses an INT variable", "ANY_BIT", "iAnyBit : INT := 5;", "iAnyBit"),
  anyParam("ty_any_bit_parameter_accepts_bool", "ANY_BIT accepts a BOOL variable", "ANY_BIT", "bAnyBit : BOOL := TRUE;", "bAnyBit"),
  anyParam("ty_any_string_parameter_rejects_int", "ANY_STRING refuses an INT variable", "ANY_STRING", "iAnyString : INT := 5;", "iAnyString"),
  anyParam("ty_any_date_parameter_rejects_int", "ANY_DATE refuses an INT variable", "ANY_DATE", "iAnyDate : INT := 5;", "iAnyDate"),
  anyParam("ty_any_date_parameter_accepts_tod", "ANY_DATE accepts a TOD variable", "ANY_DATE", "todAnyDate : TOD;", "todAnyDate"),
  anyParam("ty_any_parameter_accepts_struct", "ANY accepts a STRUCT variable", "ANY", "stAny : DUT_LANG_ty_any_parameter_accepts_struct;", "stAny",
    structFor("ty_any_parameter_accepts_struct")),
  deferLsp(anyParam("ty_any_elementary_parameter_rejects_struct", "ANY_ELEMENTARY refuses a STRUCT variable", "ANY_ELEMENTARY",
    "stAnyElem : DUT_LANG_ty_any_elementary_parameter_rejects_struct;", "stAnyElem", structFor("ty_any_elementary_parameter_rejects_struct")),
    NO_SUCH_GROUP),
  deferLsp(anyParam("ty_any_magnitude_parameter_accepts_time", "ANY_MAGNITUDE accepts a TIME variable", "ANY_MAGNITUDE", "tAnyMag : TIME;", "tAnyMag"), NO_SUCH_GROUP),
  deferLsp(fb("ty_any_num_as_local_variable", "ANY_NUM as a FUNCTION_BLOCK's local VAR — a parameter type only?", "\tx : ANY_NUM;\n\tout : INT;", "out := 1;"),
    noCatalogCode("\"Variables of type 'ANY_NUM' only allowed as input of functions\"", "0 occurrences in the corpora of a generic type outside a function's VAR_INPUT")),
]

// ─── TY15 — VERSION ──────────────────────────────────────────────────────────────────────────────────────────────────

const VERSION_TYPE: LanguageTest[] = [
  fb("ty_version_type", "VERSION's four components, written and read back: their sum in a UINT",
    "\tv : VERSION;\n\tout : UINT;",
    "v.uiMajor := 3;\nv.uiMinor := 5;\nv.uiServicePack := 21;\nv.uiPatch := 40;\nout := v.uiMajor + v.uiMinor + v.uiServicePack + v.uiPatch;"),
  fb("ty_version_component_type", "a VERSION component into a SINT and into a STRING — the messages name its type",
    "\tv : VERSION;\n\tsi : SINT;\n\tstr : STRING;", "si := v.uiMajor;\nstr := v.uiPatch;"),
  fb("ty_version_unknown_component", "an unknown component of VERSION", "\tv : VERSION;\n\tout : UINT;", "out := v.uiBuild;"),
  fb("ty_version_into_string", "a VERSION into a STRING — the message names the type", "\tv : VERSION;\n\tstr : STRING;", "str := v;"),
]

export const ELEMENTARY_RULE_TESTS: readonly LanguageTest[] = [
  ...PLATFORM_WIDTH,
  ...PLATFORM_CONVERSIONS,
  ...BIT_PLACES,
  ...REFERENCE_ELEMENTS,
  ...ANY_PARAMETERS,
  ...VERSION_TYPE,
]
