/**
 * THE UNITS, RULE BY RULE — design.md §4 2.4 of openspec `frontend-conformance` (U1–U27, tasks 2.4.1–2.4.5), each rule
 * put to the vendor by fixtures of its own: `record:language` for accept/refuse and the vendor's words, `record:exec`
 * for the VALUE the unit computes (every FB fixture below that builds copies what its unit under test gives into `out`,
 * a variable of the FB, so the run recording holds `inst_<name>.out`; a PROGRAM's or FUNCTION's lands in PLC_PRG's
 * `seen_<name>`). Rows already decided by a recorded fixture elsewhere keep those fixtures; what is here is the cells
 * that separate a rule's readings: each header clause in each position, each modifier on each unit kind, alone, stacked,
 * reordered and repeated.
 *
 * ONE QUESTION PER FIXTURE, as in `declarations.ts`: the IDE stops after a few parse errors, so a fixture holding two
 * refusals measures the stop, not the rule. An INTERFACE is compiled only when something implements it, so every
 * interface below is implemented by the fixture's FB.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 2.4 (units)"

/** A fixture whose unit under test is the FB `FB_LANG_<name>`, instanced in PLC_PRG as `inst_<name>`; `source` holds it
 *  and whatever it needs (types, interfaces, a base, its members). */
function fbUnit(name: string, feature: string, source: string): LanguageTest {
  return {
    name,
    pouName: `FB_LANG_${name}`,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : FB_LANG_${name};`,
    plcPrgBody: `inst_${name}();`,
    source,
  }
}

/** An FB `FB_LANG_<name>` headed `FUNCTION_BLOCK <head>` (`<name>` stands for the FB's name in it), with `out : INT` and
 *  `body`, then `members` (METHOD/PROPERTY/ACTION units) and `before` (units written ahead of it). */
function fb(name: string, feature: string, head: string, body: string, members = "", before = ""): LanguageTest {
  const header = head.replaceAll("<name>", `FB_LANG_${name}`)
  return fbUnit(name, feature,
    `${before}FUNCTION_BLOCK ${header}\nVAR\n\tout : INT;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n${members ? `\n${members}` : ""}`)
}

/** A base FB `FB_LANG_<name>_base` with `members`, written ahead of a fixture's FB. */
function base(name: string, members = "", fields = "\tb : INT := 2;"): string {
  return `FUNCTION_BLOCK FB_LANG_${name}_base\nVAR\n${fields}\nEND_VAR\nEND_FUNCTION_BLOCK\n${members ? `\n${members}` : ""}\n`
}

/** An interface `ITF_LANG_<name><suffix>` declaring `members` (and `head` after its name). */
function itf(name: string, members: string, head = "", suffix = ""): string {
  return `INTERFACE ITF_LANG_${name}${suffix}${head}\n${members}END_INTERFACE\n\n`
}

/** The method `Get : INT` an interface declares, and the one an FB implements it with (5). */
const ITF_GET = "METHOD Get : INT\nEND_METHOD\n"

/** The push's refusal of an interface accessor's declaration, in its words (both vendors, 2026-10-01). */
const ACCESSOR_DECLARATION_NOT_WRITABLE = "an interface property's GET/SET carries only the fact that it exists — its declaration and body are not writable, and writing them can crash the IDE. Remove the edit, or make the change in the IDE and pull."

/** `t`, whose push both vendors refuse with `reason` (Volt's own push, before either IDE sees the text). */
function pushRefuses(t: LanguageTest, reason: string): LanguageTest {
  return { ...t, vendorRefuses: { codesys: reason, twincat: reason } }
}
/** `t`, whose text Volt's push REWRITES before either IDE sees it (`how`): no vendor ever answers the text as written.
 *  The build recording measures the rewrite, and `record:exec` would load the parser's own split — so nothing is
 *  asked. A BRIDGE gap (reported to the owner), not a fact about the language. */
function pushRewrites(t: LanguageTest, how: string): LanguageTest {
  return {
    ...t,
    execSkip: `NOTHING TO MEASURE until the bridge carries the text as written: ${how}, so the IDE never holds what the fixture asks, and record:exec would load the LSP parser's own split — an answer shaped by the code under test`,
  }
}
/**
 * `t`, whose push both vendors refuse and whose `record:exec` answer is shaped by the code under test: the loader names
 * each member object as the LSP PARSER splits it, and with OVERRIDE read as a name that object is called OVERRIDE (it
 * was M under the parser before 2.4a) — and CODESYS reads a property's or an interface method's declaration against
 * its object (`seen`, 2026-10-01), so the answer moves with the parser. `unit_method_override` keeps its recording:
 * an FB method's declaration is parsed whatever its object is called, and BOTH namings measured OVERRIDE as a name
 * ("The name used in the signature is not identical to the object name" under M; "Unexpected token 'INT' found" +
 * "';' expected instead of 'M'" under OVERRIDE).
 */
function loaderNamed(t: LanguageTest, seen: string): LanguageTest {
  return {
    ...t,
    execSkip: `NOTHING TO COMPARE: the push refuses this header on both vendors, and \`record:exec\` names the member object as the parser splits it — ${seen}, an answer that moves with the parser's reading rather than one about the text`,
  }
}

/** An interface accessor declaring an output or in-out (record:exec, CODESYS 2026-10-01): CODESYS refuses the
 *  IMPLEMENTER's getter against it ("Interface of overridden method '__GETVAL' of interface 'I' doesn't match declaration"
 *  + "The number of inputs/outputs of the method '__GETVAL' does not correspond to the interface 'I'."), a comparison of
 *  accessor signatures `interface-implementation` does not make. */
function accessorSignature(t: LanguageTest): LanguageTest {
  return {
    ...t,
    deferred: {
      lsp: "niche: accepted loss (0 occurrences in the corpora — no interface accessor declares an output or in-out); comparing an implementer's accessor with the interface's is `interface-implementation`'s, which compares methods only (2026-10-01)",
    },
  }
}
const IMPL_GET = "METHOD Get : INT\nGet := 5;\nEND_METHOD\n"

/** A STRUCT `DUT_LANG_<name><suffix>` with `fields` and `head` between its name and the colon. */
function struct(name: string, fields: string, head = "", suffix = "", after = ""): string {
  return `TYPE DUT_LANG_${name}${suffix}${head} :\nSTRUCT${after}\n${fields}\nEND_STRUCT\nEND_TYPE\n\n`
}

/** A FUNCTION `F_LANG_<name>` whose text is `source` (`<f>` stands for its name), called by PLC_PRG's `body`. */
function fun(name: string, feature: string, source: string, vars: string, body: string): LanguageTest {
  const f = `F_LANG_${name}`
  return {
    name,
    pouName: f,
    kind: "function",
    feature,
    fromDoc: doc,
    source: source.replaceAll("<f>", f),
    plcPrgVar: vars.replaceAll("<f>", f),
    plcPrgBody: body.replaceAll("<f>", f),
  }
}

/** A PROGRAM `PRG_LANG_<name>` headed `PROGRAM <head>` with `out : INT` set to 3, called and read by PLC_PRG. */
function program(name: string, feature: string, head: string): LanguageTest {
  const p = `PRG_LANG_${name}`
  return {
    name,
    pouName: p,
    kind: "program",
    feature,
    fromDoc: doc,
    source: `PROGRAM ${head.replaceAll("<name>", p)}\nVAR\n\tout : INT;\nEND_VAR\nout := 3;\nEND_PROGRAM\n`,
    plcPrgVar: `seen_${name} : INT;`,
    plcPrgBody: `${p}();\nseen_${name} := ${p}.out;`,
  }
}

/** A method `M : INT` returning 7, headed `METHOD <mods> M`, called by the FB's body. */
function method(name: string, feature: string, mods: string): LanguageTest {
  return fb(name, feature, "<name>", "out := M();", `METHOD ${mods} M : INT\nM := 7;\nEND_METHOD\n`)
}

/** An FB extending `FB_LANG_<name>_base` (whose `M` returns 1) and overriding `M` with one headed `METHOD <mods> M`. */
function overriding(name: string, feature: string, mods: string): LanguageTest {
  return fb(name, feature, `<name> EXTENDS FB_LANG_${name}_base`, "out := M();",
    `METHOD ${mods} M : INT\nM := 7;\nEND_METHOD\n`, base(name, "METHOD M : INT\nM := 1;\nEND_METHOD\n"))
}

/** A property `P : INT` headed `PROPERTY <mods> P` whose getter returns `stored` (6), read by the FB's body. */
function property(name: string, feature: string, mods: string, accessor = "GET\nP := stored;\nEND_GET\n"): LanguageTest {
  return fbUnit(name, feature,
    `FUNCTION_BLOCK FB_LANG_${name}\nVAR\n\tout : INT;\n\tstored : INT := 6;\nEND_VAR\nout := P;\nEND_FUNCTION_BLOCK\n\nPROPERTY ${mods ? `${mods} ` : ""}P : INT\n${accessor}END_PROPERTY\n`)
}

/** An interface whose `Get` is headed `METHOD <mods> Get`, implemented by the FB with a plain `METHOD Get` (5). */
function itfMethod(name: string, feature: string, mods: string): LanguageTest {
  return fb(name, feature, `<name> IMPLEMENTS ITF_LANG_${name}`, "out := Get();", IMPL_GET,
    itf(name, `METHOD ${mods} Get : INT\nEND_METHOD\n`))
}

/** An interface whose `Val` is headed `PROPERTY <mods> Val`, implemented by the FB with a plain getter (5). */
function itfProperty(name: string, feature: string, mods: string, accessor = "GET\nEND_GET\n"): LanguageTest {
  return fb(name, feature, `<name> IMPLEMENTS ITF_LANG_${name}`, "out := Val;",
    "PROPERTY Val : INT\nGET\nVal := 5;\nEND_GET\nEND_PROPERTY\n",
    itf(name, `PROPERTY ${mods ? `${mods} ` : ""}Val : INT\n${accessor}END_PROPERTY\n`))
}

/** A DUT that is the whole fixture, pushed AS SENT (the parser cannot split it: it has no body the parser reads), and
 *  declared in PLC_PRG so the build reaches it. */
function bareType(name: string, feature: string, kind: "alias" | "struct", source: string): LanguageTest {
  return {
    name,
    pouName: `DUT_LANG_${name}`,
    kind,
    feature,
    fromDoc: doc,
    asSent: "a TYPE with no body the parser reads: its text is pushed as a workspace file holds it",
    source,
    plcPrgVar: `v_${name} : DUT_LANG_${name};`,
  }
}

export const UNIT_RULE_TESTS: readonly LanguageTest[] = [
  // ─── U1 PROGRAM ─────────────────────────────────────────────────────────────────────────────────────────────────────
  asSent(program("unit_program_trailing_semicolon", "U1 — a PROGRAM header ended by `;`: `PROGRAM P;`", "<name>;")),

  // ─── U2 PROGRAM with a return type ──────────────────────────────────────────────────────────────────────────────────
  program("unit_program_return_type", "U2 — a PROGRAM with a return type: `PROGRAM P : INT`", "<name> : INT"),

  // ─── U3 FUNCTION with a return type ─────────────────────────────────────────────────────────────────────────────────
  fun("unit_function_trailing_semicolon", "U3 — a FUNCTION header ended by `;` after its return type: `FUNCTION F : INT;`",
    "FUNCTION <f> : INT;\nVAR_INPUT\n\tx : INT;\nEND_VAR\n<f> := x + INT#1;\nEND_FUNCTION\n",
    "seen_unit_function_trailing_semicolon : INT;", "seen_unit_function_trailing_semicolon := <f>(2);"),

  // ─── U4 FUNCTION without a return type; FUNCTION IMPLEMENTS / EXTENDS ───────────────────────────────────────────────
  fun("unit_function_no_return_type", "U4 — a FUNCTION with no return type, called as a statement",
    "FUNCTION <f>\nVAR_IN_OUT\n\tio : INT;\nEND_VAR\nio := io + INT#4;\nEND_FUNCTION\n",
    "seen_unit_function_no_return_type : INT;", "<f>(io := seen_unit_function_no_return_type);"),
  fun("unit_function_no_return_type_in_expression", "U4 — a FUNCTION with no return type, its call used as a value",
    "FUNCTION <f>\nVAR_IN_OUT\n\tio : INT;\nEND_VAR\nio := io + INT#4;\nEND_FUNCTION\n",
    "seen_unit_function_no_return_type_in_expression : INT;\n\tcell_unit_function_no_return_type_in_expression : INT;",
    "seen_unit_function_no_return_type_in_expression := <f>(io := cell_unit_function_no_return_type_in_expression);"),
  // the IMPLEMENTS clause AFTER the return type — `hdr_function_implements` asks it before (C0145 there)
  fun("unit_function_implements", "U4 — a FUNCTION whose IMPLEMENTS clause follows its return type: `FUNCTION F : INT IMPLEMENTS I`",
    "INTERFACE ITF_LANG_unit_function_implements\nEND_INTERFACE\n\nFUNCTION <f> : INT IMPLEMENTS ITF_LANG_unit_function_implements\nVAR_INPUT\n\tx : INT;\nEND_VAR\n<f> := x;\nEND_FUNCTION\n",
    "seen_unit_function_implements : INT;", "seen_unit_function_implements := <f>(2);"),
  // its base is `oop_base`'s FB (a fixture of its own: an item pushed AS SENT carries no second unit)
  asSent(fun("unit_function_extends_after_return", "U4 — a FUNCTION whose EXTENDS clause follows its return type: `FUNCTION F : INT EXTENDS B`",
    "FUNCTION <f> : INT EXTENDS FB_LANG_oop_base\nVAR_INPUT\n\tx : INT;\nEND_VAR\n<f> := x;\nEND_FUNCTION\n",
    "seen_unit_function_extends_after_return : INT;", "seen_unit_function_extends_after_return := <f>(2);")),

  // ─── U5 FUNCTION_BLOCK, EXTENDS, IMPLEMENTS and lists ───────────────────────────────────────────────────────────────
  // the base is `oop_base`'s FB and the interface `interface_empty`'s (fixtures of their own, as above)
  asSent(fb("unit_fb_implements_before_extends", "U5 — IMPLEMENTS written before EXTENDS: `FUNCTION_BLOCK X IMPLEMENTS I EXTENDS B`",
    "<name> IMPLEMENTS ITF_LANG_empty EXTENDS FB_LANG_oop_base", "iValue := 9;\nout := iValue;")),
  fb("unit_fb_implements_trailing_comma", "U5 — an IMPLEMENTS list ending in a comma: `IMPLEMENTS I,`",
    "<name> IMPLEMENTS ITF_LANG_unit_fb_implements_trailing_comma,", "out := Get();", IMPL_GET,
    itf("unit_fb_implements_trailing_comma", ITF_GET)),
  fb("unit_fb_implements_twice", "U5 — one interface named twice in an IMPLEMENTS list: `IMPLEMENTS I, I`",
    "<name> IMPLEMENTS ITF_LANG_unit_fb_implements_twice, ITF_LANG_unit_fb_implements_twice", "out := Get();", IMPL_GET,
    itf("unit_fb_implements_twice", ITF_GET)),

  // ─── U7 FB EXTENDS/IMPLEMENTS a qualified name ──────────────────────────────────────────────────────────────────────
  asSent(fb("unit_fb_extends_qualified", "U7 — an FB extending a library FB by its qualified name: `EXTENDS Standard.TON`",
    "<name> EXTENDS Standard.TON", "PT := T#5MS;\nout := TIME_TO_INT(PT);")),
  asSent(fb("unit_fb_extends_qualified_unknown", "U7 — an FB extending a qualified name no library holds: `EXTENDS NoSuchLib.FB_X`",
    "<name> EXTENDS NoSuchLib.FB_X", "out := 1;")),
  asSent(fb("unit_fb_implements_qualified", "U7 — an FB implementing a qualified interface: `IMPLEMENTS __SYSTEM.IQueryInterface`",
    "<name> IMPLEMENTS __SYSTEM.IQueryInterface", "out := 1;")),

  // ─── U8 FB ABSTRACT / FINAL ─────────────────────────────────────────────────────────────────────────────────────────
  {
    ...fb("unit_fb_abstract_final", "U8 — an FB both ABSTRACT and FINAL: `FUNCTION_BLOCK ABSTRACT FINAL X`",
      "ABSTRACT FINAL <name>", "out := 1;"),
    // an ABSTRACT FB cannot be instanced, so PLC_PRG reaches it through a pointer
    plcPrgVar: "p_unit_fb_abstract_final : POINTER TO FB_LANG_unit_fb_abstract_final;",
    plcPrgBody: "",
  },
  undeclaredFb(fb("unit_fb_modifier_twice", "U8/U9 — one FB modifier written twice: `FUNCTION_BLOCK PUBLIC PUBLIC X`",
    "PUBLIC PUBLIC <name>", "out := 1;")),
  // …and FINAL twice, which is no second access modifier (the first answers: PUBLIC PUBLIC and PUBLIC INTERNAL both
  // leave the FB undeclared, where METHOD FINAL FINAL builds)
  fb("unit_fb_final_twice", "U8 — FINAL written twice on an FB: `FUNCTION_BLOCK FINAL FINAL X`", "FINAL FINAL <name>",
    "out := 1;"),
  // …and an access modifier after FINAL (a METHOD refuses `FINAL PRIVATE`)
  undeclaredFb(fb("unit_fb_final_public_order", "U8/U9 — FINAL before the access modifier: `FUNCTION_BLOCK FINAL PUBLIC X`",
    "FINAL PUBLIC <name>", "out := 1;")),

  // ─── U9 FB access modifier ──────────────────────────────────────────────────────────────────────────────────────────
  fb("unit_fb_public", "U9 — `FUNCTION_BLOCK PUBLIC X`", "PUBLIC <name>", "out := 1;"),
  fb("unit_fb_internal", "U9 — `FUNCTION_BLOCK INTERNAL X`", "INTERNAL <name>", "out := 1;"),
  fb("unit_fb_private", "U9 — `FUNCTION_BLOCK PRIVATE X`", "PRIVATE <name>", "out := 1;"),
  fb("unit_fb_protected", "U9 — `FUNCTION_BLOCK PROTECTED X`", "PROTECTED <name>", "out := 1;"),
  // …and a PRIVATE FB nobody calls: is "Cannot access private method ???.X" the call's, or the header's?
  {
    ...fb("unit_fb_private_not_called", "U9 — `FUNCTION_BLOCK PRIVATE X`, reached through a pointer and never called",
      "PRIVATE <name>", "out := 1;"),
    plcPrgVar: "p_unit_fb_private_not_called : POINTER TO FB_LANG_unit_fb_private_not_called;",
    plcPrgBody: "",
  },
  undeclaredFb(fb("unit_fb_public_internal", "U9 — two access modifiers on one FB: `FUNCTION_BLOCK PUBLIC INTERNAL X`",
    "PUBLIC INTERNAL <name>", "out := 1;")),
  fb("unit_fb_internal_final", "U8/U9 — an access modifier and FINAL: `FUNCTION_BLOCK INTERNAL FINAL X`",
    "INTERNAL FINAL <name>", "out := 1;"),
  // …and an FB EXTENDING one whose header is refused: is the refused FB a base, when it is no type?
  fb("unit_fb_extends_refused", "U8/U9 — an FB extending one whose header is refused (`FUNCTION_BLOCK FINAL PUBLIC X`)",
    "<name> EXTENDS FB_LANG_unit_fb_extends_refused_base", "out := 1;", "",
    "FUNCTION_BLOCK FINAL PUBLIC FB_LANG_unit_fb_extends_refused_base\nVAR\n\tn : INT := 2;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n"),

  // ─── U11 METHOD ─────────────────────────────────────────────────────────────────────────────────────────────────────
  fb("unit_method_trailing_semicolon", "U11 — a METHOD header ended by `;` after its return type: `METHOD M : INT;`",
    "<name>", "out := M();", "METHOD M : INT;\nM := 7;\nEND_METHOD\n"),

  // ─── U13 METHOD modifiers, one by one, stacked, reordered, repeated ─────────────────────────────────────────────────
  method("unit_method_public", "U13 — `METHOD PUBLIC M`", "PUBLIC"),
  method("unit_method_private", "U13 — `METHOD PRIVATE M`", "PRIVATE"),
  method("unit_method_protected", "U13 — `METHOD PROTECTED M`", "PROTECTED"),
  method("unit_method_internal", "U13 — `METHOD INTERNAL M`", "INTERNAL"),
  method("unit_method_final", "U13 — `METHOD FINAL M`", "FINAL"),
  // OVERRIDE: the push refuses each OVERRIDE header (the IDE never sees it), so CODESYS answered through `record:exec`,
  // which loads the objects itself: OVERRIDE is no modifier there, it is the method's NAME — "The name used in the
  // signature is not identical to the object name" (2026-10-01). TwinCAT has no oracle that reaches past the push.
  pushRefuses(overriding("unit_method_override", "U13 — `METHOD OVERRIDE M`, overriding the base's M", "OVERRIDE"),
    "'FB_LANG_unit_method_override', line 9: Cannot parse METHOD signature: 'OVERRIDE' is not an access modifier — METHOD OVERRIDE M : INT"),
  pushRefuses(overriding("unit_method_override_public_order", "U13 — OVERRIDE before the access modifier: `METHOD OVERRIDE PUBLIC M`",
    "OVERRIDE PUBLIC"),
    "'FB_LANG_unit_method_override_public_order', line 9: Cannot parse METHOD signature: 'OVERRIDE' is not an access modifier — METHOD OVERRIDE PUBLIC M : INT"),
  method("unit_method_final_private_order", "U13 — FINAL before the access modifier: `METHOD FINAL PRIVATE M`", "FINAL PRIVATE"),
  method("unit_method_two_access", "U13 — two access modifiers on one METHOD: `METHOD PUBLIC PRIVATE M`", "PUBLIC PRIVATE"),
  method("unit_method_modifier_twice", "U13 — one METHOD modifier written twice: `METHOD FINAL FINAL M`", "FINAL FINAL"),
  // …and ABSTRACT with FINAL, which an FB refuses ("A method or functionblock cannot be ABSTRACT and FINAL")
  {
    ...fb("unit_method_abstract_final", "U12/U13 — a METHOD both ABSTRACT and FINAL, in an ABSTRACT FB", "ABSTRACT <name>",
      "out := 1;", "METHOD ABSTRACT FINAL M : INT\nEND_METHOD\n"),
    plcPrgVar: "p_unit_method_abstract_final : POINTER TO FB_LANG_unit_method_abstract_final;",
    plcPrgBody: "",
  },

  // ─── U16 PROPERTY modifiers, accessor modifiers, accessors without END_GET/END_SET ──────────────────────────────────
  property("unit_property_public", "U16 — `PROPERTY PUBLIC P`", "PUBLIC"),
  property("unit_property_private", "U16 — `PROPERTY PRIVATE P`", "PRIVATE"),
  property("unit_property_protected", "U16 — `PROPERTY PROTECTED P`", "PROTECTED"),
  property("unit_property_internal", "U16 — `PROPERTY INTERNAL P`", "INTERNAL"),
  property("unit_property_final", "U16 — `PROPERTY FINAL P`", "FINAL"),
  fb("unit_property_abstract", "U16 — `PROPERTY ABSTRACT P` in an ABSTRACT base, implemented by the FB extending it",
    "<name> EXTENDS FB_LANG_unit_property_abstract_base", "out := P;", "PROPERTY P : INT\nGET\nP := 6;\nEND_GET\nEND_PROPERTY\n",
    "FUNCTION_BLOCK ABSTRACT FB_LANG_unit_property_abstract_base\nEND_FUNCTION_BLOCK\n\nPROPERTY ABSTRACT P : INT\nGET\nEND_GET\nEND_PROPERTY\n\n"),
  loaderNamed(pushRefuses(fb("unit_property_override", "U16 — `PROPERTY OVERRIDE P`, overriding the base's P",
    "<name> EXTENDS FB_LANG_unit_property_override_base", "out := P;", "PROPERTY OVERRIDE P : INT\nGET\nP := 6;\nEND_GET\nEND_PROPERTY\n",
    base("unit_property_override", "PROPERTY P : INT\nGET\nP := 1;\nEND_GET\nEND_PROPERTY\n")),
    "'FB_LANG_unit_property_override', line 9: Cannot parse PROPERTY signature: 'OVERRIDE' is not an access modifier — PROPERTY OVERRIDE P : INT"),
    "a property object named OVERRIDE holding `PROPERTY OVERRIDE P : INT` BUILDS there and leaves the base's P in place (out = 1)"),
  property("unit_property_modifiers", "U16 — stacked PROPERTY modifiers: `PROPERTY PUBLIC FINAL P`", "PUBLIC FINAL"),
  property("unit_property_modifiers_reordered", "U16 — stacked PROPERTY modifiers, FINAL first: `PROPERTY FINAL PUBLIC P`",
    "FINAL PUBLIC"),
  property("unit_property_final_twice", "U16 — one PROPERTY modifier written twice: `PROPERTY FINAL FINAL P`", "FINAL FINAL"),
  // …and ABSTRACT with FINAL, which a METHOD and an FB refuse ("A method or functionblock cannot be ABSTRACT and FINAL")
  {
    ...fb("unit_property_abstract_final", "U16 — a PROPERTY both ABSTRACT and FINAL, in an ABSTRACT FB", "ABSTRACT <name>",
      "out := 1;", "PROPERTY ABSTRACT FINAL P : INT\nGET\nEND_GET\nEND_PROPERTY\n"),
    plcPrgVar: "p_unit_property_abstract_final : POINTER TO FB_LANG_unit_property_abstract_final;",
    plcPrgBody: "",
  },
  // THE PUSH REWRITES THESE THREE BEFORE EITHER IDE SEES THEM (volt-cli `StReader.ReadProperty`, 2026-10-01): it drops
  // an accessor's modifier, and it closes a getter that lacks END_GET as a BARE accessor, dropping its body. So the build
  // recordings (both vendors: it builds) measured the push's rewrite, and a run recording would be the LSP parser's own
  // split (`record:exec` loads it) — the code under test answering itself. Rated unaskable; U16 keeps them as a GAP.
  pushRewrites(property("unit_property_accessor_modifier", "U16 — a modifier on the accessor: `GET PRIVATE`", "",
    "GET PRIVATE\nP := stored;\nEND_GET\n"), "the push drops the accessor's modifier (`GET PRIVATE` reaches the IDE as `GET`)"),
  pushRewrites(property("unit_property_no_end_get", "U16 — a getter not closed by END_GET, followed by a setter", "",
    "GET\nP := stored;\nSET\nstored := P;\nEND_SET\n"), "the push closes the getter at `SET` as an EMPTY accessor, dropping `P := stored;`"),
  pushRewrites(property("unit_property_no_end_get_alone", "U16 — the only accessor, a getter not closed by END_GET", "",
    "GET\nP := stored;\n"), "the push closes the getter at END_PROPERTY as an EMPTY accessor, dropping `P := stored;`"),

  // ─── U17 ACTION ─────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    ...fb("unit_action_var_section", "U17 — an ACTION declaring a VAR section of its own",
      "<name>", "Act();", "ACTION Act\nVAR\n\tt : INT;\nEND_VAR\nIMPLEMENTATION ST\nt := 4;\nout := t;\nEND_ACTION\n"),
    asSent: "the parser reads no declaration on an ACTION, so it would mark the body above the VAR; the text states its own IMPLEMENTATION lines, as a workspace file does",
    source: "FUNCTION_BLOCK FB_LANG_unit_action_var_section\nVAR\n\tout : INT;\nEND_VAR\nIMPLEMENTATION ST\nAct();\nEND_FUNCTION_BLOCK\n\nACTION Act\nVAR\n\tt : INT;\nEND_VAR\nIMPLEMENTATION ST\nt := 4;\nout := t;\nEND_ACTION\n",
  },
  {
    ...fb("unit_action_modifier", "U17 — an access modifier on an ACTION: `ACTION PRIVATE Act`", "<name>", "Act();"),
    asSent: "the parser does not read a modifier on an ACTION; the text states its own IMPLEMENTATION lines, as a workspace file does",
    execSkip:
      "NOTHING TO MEASURE: a CODESYS ACTION has no declaration, so there is no text to give the modifier to — the push drops the header (CODESYS builds the FB), and `record:exec` loads the parser's units, which hold no such action",
    source: "FUNCTION_BLOCK FB_LANG_unit_action_modifier\nVAR\n\tout : INT;\nEND_VAR\nIMPLEMENTATION ST\nAct();\nEND_FUNCTION_BLOCK\n\nACTION PRIVATE Act\nIMPLEMENTATION ST\nout := 4;\nEND_ACTION\n",
  },

  // ─── U18 INTERFACE member modifiers, one by one (the interface's modifier set is decided by these) ────────────────
  itfMethod("unit_interface_method_public", "U18 — an interface method `METHOD PUBLIC Get`", "PUBLIC"),
  itfMethod("unit_interface_method_private", "U18 — an interface method `METHOD PRIVATE Get`", "PRIVATE"),
  itfMethod("unit_interface_method_protected", "U18 — an interface method `METHOD PROTECTED Get`", "PROTECTED"),
  itfMethod("unit_interface_method_internal", "U18 — an interface method `METHOD INTERNAL Get`", "INTERNAL"),
  itfMethod("unit_interface_method_final", "U18 — an interface method `METHOD FINAL Get`", "FINAL"),
  itfMethod("unit_interface_method_abstract", "U18 — an interface method `METHOD ABSTRACT Get`", "ABSTRACT"),
  loaderNamed(pushRefuses(itfMethod("unit_interface_method_override", "U18 — an interface method `METHOD OVERRIDE Get`", "OVERRIDE"),
    "'ITF_LANG_unit_interface_method_override', line 2: Cannot parse METHOD signature: 'OVERRIDE' is not an access modifier — METHOD OVERRIDE Get : INT"),
    "an interface method object named OVERRIDE holding `METHOD OVERRIDE Get : INT` reads no parse error there, only \"There is no implementation for method 'OVERRIDE'\""),
  itfProperty("unit_interface_property_public", "U18 — an interface property `PROPERTY PUBLIC Val`", "PUBLIC"),
  itfProperty("unit_interface_property_private", "U18 — an interface property `PROPERTY PRIVATE Val`", "PRIVATE"),
  itfProperty("unit_interface_property_protected", "U18 — an interface property `PROPERTY PROTECTED Val`", "PROTECTED"),
  itfProperty("unit_interface_property_internal", "U18 — an interface property `PROPERTY INTERNAL Val`", "INTERNAL"),
  itfProperty("unit_interface_property_final", "U18 — an interface property `PROPERTY FINAL Val`", "FINAL"),
  itfProperty("unit_interface_property_abstract", "U18 — an interface property `PROPERTY ABSTRACT Val`", "ABSTRACT"),
  // …ABSTRACT with FINAL, and an access modifier after FINAL, on each interface member kind
  itfMethod("unit_interface_method_abstract_final", "U18 — an interface method `METHOD ABSTRACT FINAL Get`", "ABSTRACT FINAL"),
  itfProperty("unit_interface_property_abstract_final", "U18 — an interface property `PROPERTY ABSTRACT FINAL Val`",
    "ABSTRACT FINAL"),
  itfMethod("unit_interface_method_final_public_order", "U18 — an interface method `METHOD FINAL PUBLIC Get`", "FINAL PUBLIC"),
  itfProperty("unit_interface_property_final_public_order", "U18 — an interface property `PROPERTY FINAL PUBLIC Val`",
    "FINAL PUBLIC"),
  {
    ...pushRefuses(itfProperty("unit_interface_property_override", "U18 — an interface property `PROPERTY OVERRIDE Val`", "OVERRIDE"),
      "'ITF_LANG_unit_interface_property_override', line 2: Cannot parse PROPERTY signature: 'OVERRIDE' is not an access modifier — PROPERTY OVERRIDE Val : INT"),
    execSkip:
      "NOTHING TO COMPARE: the push refuses this header on both vendors, and `record:exec` builds an interface's property objects from the parser's units — which cannot read `PROPERTY OVERRIDE Val` (OVERRIDE is a name, as `unit_method_override` measured), so it would load a different interface than the one written",
  },

  // ─── U20 INTERFACE EXTENDS a list; INTERFACE IMPLEMENTS ─────────────────────────────────────────────────────────────
  fb("unit_interface_extends_list", "U20 — an interface extending two: `INTERFACE I EXTENDS A, B`",
    "<name> IMPLEMENTS ITF_LANG_unit_interface_extends_list", "out := GetA() + GetB();",
    "METHOD GetA : INT\nGetA := 2;\nEND_METHOD\n\nMETHOD GetB : INT\nGetB := 3;\nEND_METHOD\n",
    itf("unit_interface_extends_list", "METHOD GetA : INT\nEND_METHOD\n", "", "_a") +
      itf("unit_interface_extends_list", "METHOD GetB : INT\nEND_METHOD\n", "", "_b") +
      itf("unit_interface_extends_list", "", " EXTENDS ITF_LANG_unit_interface_extends_list_a, ITF_LANG_unit_interface_extends_list_b")),
  fb("unit_interface_implements", "U20 — an interface with an IMPLEMENTS clause: `INTERFACE I IMPLEMENTS A`",
    "<name> IMPLEMENTS ITF_LANG_unit_interface_implements", "out := GetA();", "METHOD GetA : INT\nGetA := 2;\nEND_METHOD\n",
    itf("unit_interface_implements", "METHOD GetA : INT\nEND_METHOD\n", "", "_a") +
      itf("unit_interface_implements", "", " IMPLEMENTS ITF_LANG_unit_interface_implements_a")),
  fb("unit_interface_extends_qualified", "U18/U20 — an interface extending a qualified name: `EXTENDS __SYSTEM.IQueryInterface`",
    "<name> IMPLEMENTS ITF_LANG_unit_interface_extends_qualified", "out := Get();", IMPL_GET,
    itf("unit_interface_extends_qualified", ITF_GET, " EXTENDS __SYSTEM.IQueryInterface")),

  // ─── U21 interface accessor VAR sections ────────────────────────────────────────────────────────────────────────────
  // the push refuses to WRITE an interface accessor's declaration (a pull reads it — 263 in pro2193); `record:exec`
  // loads the objects itself and answers for CODESYS
  pushRefuses(itfProperty("unit_interface_property_accessor_var", "U21 — an interface property's getter declaring a VAR section", "",
    "GET\nVAR\n\tscratch : INT;\nEND_VAR\nEND_GET\n"), ACCESSOR_DECLARATION_NOT_WRITABLE),
  pushRefuses(itfProperty("unit_interface_property_accessor_var_input", "U21 — an interface property's getter declaring a VAR_INPUT section", "",
    "GET\nVAR_INPUT\n\tscratch : INT;\nEND_VAR\nEND_GET\n"), ACCESSOR_DECLARATION_NOT_WRITABLE),
  accessorSignature(pushRefuses(itfProperty("unit_interface_property_accessor_var_output", "U21 — an interface property's getter declaring a VAR_OUTPUT section", "",
    "GET\nVAR_OUTPUT\n\tscratch : INT;\nEND_VAR\nEND_GET\n"), ACCESSOR_DECLARATION_NOT_WRITABLE)),
  accessorSignature(pushRefuses(itfProperty("unit_interface_property_accessor_var_in_out", "U21 — an interface property's getter declaring a VAR_IN_OUT section", "",
    "GET\nVAR_IN_OUT\n\tscratch : INT;\nEND_VAR\nEND_GET\n"), ACCESSOR_DECLARATION_NOT_WRITABLE)),
  // …and an interface METHOD's local sections ("Only inputs, outputs, and inouts allowed in interface methods" is
  // measured on VAR; these are the other three a method may declare)
  ...(["VAR_TEMP", "VAR_STAT", "VAR_INST"] as const).map((section) => {
    const name = `unit_interface_method_${section.toLowerCase()}`
    return fb(name, `U21 — an interface method declaring a ${section} section`, `<name> IMPLEMENTS ITF_LANG_${name}`,
      "out := Get();", IMPL_GET, itf(name, `METHOD Get : INT\n${section}\n\tt : INT;\nEND_VAR\nEND_METHOD\n`))
  }),

  // ─── U22 STRUCT EXTENDS: where it stands, twice, a list; the `;` after END_STRUCT ───────────────────────────────────
  withRec(fb("unit_struct_extends_after_struct", "U22 — EXTENDS after the STRUCT keyword: `TYPE X : STRUCT EXTENDS B`",
    "<name>", "out := rec.a + rec.b;", "",
    struct("unit_struct_extends_after_struct", "\ta : INT := 2;", "", "_base") +
      struct("unit_struct_extends_after_struct", "\tb : INT := 3;", "", "", " EXTENDS DUT_LANG_unit_struct_extends_after_struct_base"))),
  withRec(fb("unit_struct_extends_twice", "U22 — EXTENDS on the TYPE and on the STRUCT: `TYPE X EXTENDS A : STRUCT EXTENDS B`",
    "<name>", "out := rec.c;", "",
    struct("unit_struct_extends_twice", "\ta : INT := 2;", "", "_a") +
      struct("unit_struct_extends_twice", "\tb : INT := 3;", "", "_b") +
      struct("unit_struct_extends_twice", "\tc : INT := 4;", " EXTENDS DUT_LANG_unit_struct_extends_twice_a", "",
        " EXTENDS DUT_LANG_unit_struct_extends_twice_b"))),
  // AS SENT, one TYPE: its header is refused, so the parser has no subtype to push it under; the bases are
  // `type_dut_struct_extends`'s two structs, and PLC_PRG reads a field of it
  {
    ...bareType("unit_struct_extends_list", "U22 — a STRUCT extending two: `TYPE X EXTENDS A, B : STRUCT`", "struct",
      "TYPE DUT_LANG_unit_struct_extends_list EXTENDS DUT_LANG_struct_base, DUT_LANG_struct_extends :\nSTRUCT\n\tc : INT := 4;\nEND_STRUCT\nEND_TYPE\n"),
    plcPrgVar: "v_unit_struct_extends_list : DUT_LANG_unit_struct_extends_list;\n\tseen_unit_struct_extends_list : INT;",
    plcPrgBody: "seen_unit_struct_extends_list := v_unit_struct_extends_list.c;",
  },
  withRec(fb("unit_struct_end_semicolon", "U22 — a `;` after END_STRUCT: `END_STRUCT;`", "<name>", "out := rec.a;", "",
    struct("unit_struct_end_semicolon", "\ta : INT := 2;").replace("END_STRUCT\n", "END_STRUCT;\n"))),

  // ─── U26 alias ──────────────────────────────────────────────────────────────────────────────────────────────────────
  withVar(fb("unit_alias_no_semicolon", "U26 — an alias with no `;` before END_TYPE: `TYPE A : INT END_TYPE`",
    "<name>", "v := 4;\nout := v;", "", "TYPE DUT_LANG_unit_alias_no_semicolon : INT\nEND_TYPE\n\n"),
    "\tv : DUT_LANG_unit_alias_no_semicolon;"),

  // ─── U27 TYPE EXTENDS on a non-struct; a TYPE with no body ──────────────────────────────────────────────────────────
  withVar(fb("unit_type_extends_on_enum", "U27 — EXTENDS on an enum: `TYPE E EXTENDS B : (A, C);`", "<name>", "out := 1;", "",
    struct("unit_type_extends_on_enum", "\ta : INT;", "", "_base") +
      "TYPE DUT_LANG_unit_type_extends_on_enum EXTENDS DUT_LANG_unit_type_extends_on_enum_base :\n(\n\tVA,\n\tVB\n);\nEND_TYPE\n\n"),
    "\te : DUT_LANG_unit_type_extends_on_enum;"),
  withVar(fb("unit_type_extends_on_alias", "U27 — EXTENDS on an alias: `TYPE A EXTENDS B : INT;`", "<name>", "out := 1;", "",
    struct("unit_type_extends_on_alias", "\ta : INT;", "", "_base") +
      "TYPE DUT_LANG_unit_type_extends_on_alias EXTENDS DUT_LANG_unit_type_extends_on_alias_base : INT;\nEND_TYPE\n\n"),
    "\te : DUT_LANG_unit_type_extends_on_alias;"),
  withVar(fb("unit_type_extends_on_union", "U27 — EXTENDS on a UNION: `TYPE U EXTENDS B : UNION … END_UNION`", "<name>",
    "out := 1;", "",
    struct("unit_type_extends_on_union", "\ta : INT;", "", "_base") +
      "TYPE DUT_LANG_unit_type_extends_on_union EXTENDS DUT_LANG_unit_type_extends_on_union_base :\nUNION\n\tx : INT;\n\ty : DINT;\nEND_UNION\nEND_TYPE\n\n"),
    "\te : DUT_LANG_unit_type_extends_on_union;"),
  // …and an enum extending an ENUM: both vendors answered EXTENDS on an enum with "No definition found for base class"
  // (a struct base), not with the alias's "Keyword EXTENDS not applicable" — is an enum base the one it looks for?
  withVar(fb("unit_enum_extends_enum", "U25/U27 — an enum extending an enum: `TYPE E2 EXTENDS E1 : (VC, VD);`", "<name>",
    "e := VA;\nout := 1;", "",
    "TYPE DUT_LANG_unit_enum_extends_enum_base :\n(\n\tVA,\n\tVB\n);\nEND_TYPE\n\n" +
      "TYPE DUT_LANG_unit_enum_extends_enum EXTENDS DUT_LANG_unit_enum_extends_enum_base :\n(\n\tVC,\n\tVD\n);\nEND_TYPE\n\n"),
    "\te : DUT_LANG_unit_enum_extends_enum;"),
  // …and the `;` after a UNION's END_UNION (a STRUCT's `END_STRUCT;` is refused on both vendors)
  withVar(fb("unit_union_end_semicolon", "U24 — a `;` after END_UNION: `END_UNION;`", "<name>", "u.x := 2;\nout := u.x;", "",
    "TYPE DUT_LANG_unit_union_end_semicolon :\nUNION\n\tx : INT;\n\ty : DINT;\nEND_UNION;\nEND_TYPE\n\n"),
    "\tu : DUT_LANG_unit_union_end_semicolon;"),
  bareType("unit_type_no_body", "U27 — a TYPE with nothing after its colon: `TYPE X : END_TYPE`", "alias",
    "TYPE DUT_LANG_unit_type_no_body :\nEND_TYPE\n"),
  bareType("unit_type_missing_colon", "U22/U27 — a TYPE with no colon before its body: `TYPE X STRUCT … END_STRUCT`", "struct",
    "TYPE DUT_LANG_unit_type_missing_colon\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n"),
]

/** `t` declared in PLC_PRG and not called — an FB whose header leaves it undeclared is asked by "Unknown type" alone. */
function undeclaredFb(t: LanguageTest): LanguageTest {
  return { ...t, plcPrgBody: "" }
}

/** `t` with `decl` added to its FB's VAR section, beside `out`. */
function withVar(t: LanguageTest, decl: string): LanguageTest {
  return { ...t, source: t.source.replace("VAR\n\tout : INT;\n", `VAR\n\tout : INT;\n${decl}\n`) }
}

/** `t` with `rec : DUT_LANG_<name>` declared in its FB — the STRUCT fixtures' variable. */
function withRec(t: LanguageTest): LanguageTest {
  return withVar(t, `\trec : DUT_LANG_${t.name};`)
}

/**
 * `t` pushed AS SENT: one item, its text as written, with `IMPLEMENTATION ST` stated above the body — for a header
 * the parser misreads, where its split would put the body's line in the wrong place (or nowhere) and the push would
 * carry the parser's reading instead of the question. One unit only: what it uses is another fixture's.
 */
function asSent(t: LanguageTest): LanguageTest {
  const units = t.source.match(/^(FUNCTION_BLOCK|FUNCTION|PROGRAM) /gm) ?? []
  if (units.length !== 1) throw new Error(`${t.name}: an AS SENT fixture holds one unit, not ${units.length}`)
  // the body is what follows the last END_VAR (every unit here declares one)
  const at = t.source.lastIndexOf("END_VAR\n") + "END_VAR\n".length
  return {
    ...t,
    asSent: "the parser misreads this header; its text is pushed as a workspace file holds it",
    source: `${t.source.slice(0, at)}IMPLEMENTATION ST\n${t.source.slice(at)}`,
  }
}
