/**
 * LIBRARIES, RULE BY RULE — design.md §4 3.4 of openspec `frontend-conformance` (LB1–LB9; tasks 3.4.1, 3.4.2), each rule
 * put to the vendor by fixtures of its own: `record:language` for accept/refuse and the vendor's words, `record:exec` for
 * WHICH declaration a name meant (every FB below that builds writes into `out` a value that differs per candidate).
 *
 * The fixture project (CodesysTestProject) references, among others, Util (namespace Util), StringUtils (Stu), CAA
 * Device Diagnosis (DED) — whose manifest names CommFB and CAA Types (CAA) among its DEPENDENCIES — and BreakpointLogging
 * (BPLog). The elements the cells ask about, as the bridge materialized them:
 *   - the enum type `ERROR`: Util's (`_WRONG_TRANSITION := -1 … NO_ERROR := 0, _TIME_OUT := 1, WRONG_CONFIGURATION := 2 …`),
 *     DED's (`NO_ERROR := 0, FIRST_ERROR := 1300, TIME_OUT := 1301 …`) and CAA Types' (`NO_ERROR`);
 *   - the FUNCTION `GETSUPPLIERVERSION : WORD`: DED's and CAA Types'; `ISLIBRELEASED : BOOL`: Util's and CommFB's;
 *   - CommFB's enum `IO_SYSTEM_TYPE` (`PROFIBUS_DP := 1, PROFINET_IO := 2`), in no other library;
 *   - Util's lists `DAY_FLAGS` (`TUESDAY : DAYS := 2`, `DAYS` a BYTE) and `CONSTANTS` (`GC_AUSIWEEKDAY : ARRAY [0..11] OF
 *     USINT := [0, 3, …]`) — a list name four other libraries' lists also carry;
 *   - Util's FUNCTION `LEAPYEARS`, whose output `EERRORID : ERROR` is written in Util's own file.
 *
 *   LB1 a library element qualified through its NAMESPACE (also tr_21_*): a type, of either library declaring the name
 *   LB2 a library's namespace reaches only its own elements: a dependency's element through it, bare, by its own namespace
 *   LB3 own library first: a library FB's member typed in the library's own file; a project FUNCTION before two libraries'
 *   LB4 a project unit named like a library namespace
 *   LB5 a type name two libraries export, written bare
 *   LB6 a FUNCTION name two libraries export, called bare
 *   LB8 `lib0.lib1.sym` — through a library's namespace to a dependency's
 *   LB9 `lib.gvl.var` — a library list's variable through the namespace, a list name several libraries carry
 *
 * NO CONVERSION IS ASKED: which declaration a name meant is read back by comparing with a QUALIFIED one.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 3.4 (libraries); docs/codesys-reference/09-shadowing.md"

/** A function block `FB_LANG_<name>` with VAR `vars` and body `body`; `before` (whole units) is written ahead of it.
 *  Instanced in PLC_PRG as `inst_<name>` and called. */
function fb(name: string, feature: string, vars: string, body: string, before = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

const ASKED: readonly LanguageTest[] = [
  // ─── LB1 a library element qualified through its namespace ──────────────────────────────────────────────────────
  fb("lib_ns_type_qualified", "LB1/LB5 — `Util.ERROR`, a type name three libraries export, qualified by Util's namespace (out 2)",
    "\te : Util.ERROR;\n\tout : INT;",
    "e := Util.ERROR.WRONG_CONFIGURATION;\nIF e = Util.ERROR.WRONG_CONFIGURATION THEN\n\tout := INT#2;\nEND_IF"),
  fb("lib_ns_type_qualified_other_library", "LB1/LB5 — `DED.ERROR`, the same type name qualified by CAA Device Diagnosis' namespace (out 3)",
    "\te : DED.ERROR;\n\tout : INT;",
    "e := DED.ERROR.TIME_OUT;\nIF e = DED.ERROR.TIME_OUT THEN\n\tout := INT#3;\nEND_IF"),

  // ─── LB5 a type name two libraries export, bare ─────────────────────────────────────────────────────────────────
  fb("lib_ns_type_name_two_libraries", "LB5 — `ERROR` bare (Util, DED, CAA Types), its member only Util's declares: Util's (out 2), or ambiguous?",
    "\te : ERROR;\n\tout : INT;",
    "e := ERROR.WRONG_CONFIGURATION;\nIF e = Util.ERROR.WRONG_CONFIGURATION THEN\n\tout := INT#2;\nEND_IF"),
  fb("lib_ns_type_name_two_libraries_other_member", "LB5 — `ERROR` bare, its member only DED's declares: DED's (out 3), or ambiguous?",
    "\te : ERROR;\n\tout : INT;",
    "e := ERROR.TIME_OUT;\nIF e = DED.ERROR.TIME_OUT THEN\n\tout := INT#3;\nEND_IF"),

  // …which `lib_ns_type_name_two_libraries` answered with Util's, DED's never a candidate: is a DED element reachable
  // bare at all? (`DEVICE_STATE`, which no other library declares)
  fb("lib_ns_qualified_access_library_bare", "LB5/LB2 — DED's `DEVICE_STATE`, which only DED declares, as a type bare",
    "\tv : DEVICE_STATE;\n\tout : INT;", "out := INT#1;"),
  fb("lib_ns_qualified_access_library_qualified", "LB1 — DED's `DEVICE_STATE` qualified: `DED.DEVICE_STATE` (out 1)",
    "\tv : DED.DEVICE_STATE;\n\tout : INT;", "out := INT#1;"),

  // ─── LB3 own library first ──────────────────────────────────────────────────────────────────────────────────────
  fb("lib_ns_own_library_first", "LB3 — `GETSUPPLIERVERSION()` where a project FUNCTION and two libraries' (DED, CAA Types) share the name: the project's (out 7)",
    "\tout : INT;", "out := GETSUPPLIERVERSION();",
    "FUNCTION GETSUPPLIERVERSION : INT\nGETSUPPLIERVERSION := 7;\nEND_FUNCTION\n\n"),
  // The output of a Util FUNCTION, `EERRORID : ERROR` declared in Util's file. (The first recording read Util's
  // TIMERSWITCH's output — its type carries `no_assign`, and the FB holding the instance drew "Attribute 'no_assign'
  // missing", a question of its own; the second called LEAPYEARS, which is INTERNAL — the two cells below.)
  fb("lib_ns_library_member_own_type", "LB3 — Util's DATETIMEFROMWEEK output `EERRORID : ERROR` (written in Util's file) captured into a `Util.ERROR` (out 1)",
    "\tn : ULINT;\n\te : Util.ERROR := Util.ERROR.WRONG_CONFIGURATION;\n\tout : INT;",
    "n := Util.DATETIMEFROMWEEK(UIYEAR := 2020, UIWEEK := 10, EWEEKDAY := WEEKDAY.MONDAY, EERRORID => e);\nIF e = Util.ERROR.NO_ERROR THEN\n\tout := INT#1;\nEND_IF"),
  fb("lib_ns_library_member_own_type_other_enum", "LB3 — the same output captured into a `DED.ERROR`: an ERROR of another library",
    "\tn : ULINT;\n\te : DED.ERROR := DED.ERROR.TIME_OUT;\n\tout : INT;",
    "n := Util.DATETIMEFROMWEEK(UIYEAR := 2020, UIWEEK := 10, EWEEKDAY := WEEKDAY.MONDAY, EERRORID => e);\nIF e = DED.ERROR.NO_ERROR THEN\n\tout := INT#1;\nEND_IF"),

  // An INTERNAL library POU: Util's LEAPYEARS (its materialized declaration says nothing of INTERNAL)
  fb("lib_ns_library_internal_function_bare", "LB6 — Util's INTERNAL `LEAPYEARS`, which no other library declares, called bare",
    "\tn : UINT;\n\tout : INT;", "n := LEAPYEARS(UISTARTYEAR := 2000, UIENDYEAR := 2004);\nout := INT#1;"),
  fb("lib_ns_library_internal_function_qualified", "LB1 — Util's INTERNAL `LEAPYEARS` called through the namespace: `Util.LEAPYEARS(…)`",
    "\tn : UINT;\n\tout : INT;", "n := Util.LEAPYEARS(UISTARTYEAR := 2000, UIENDYEAR := 2004);\nout := INT#1;"),

  // ─── LB6 a FUNCTION two libraries export, called bare ───────────────────────────────────────────────────────────
  fb("lib_ns_same_name_two_libraries", "LB6 — `ISLIBRELEASED()` bare, which Util and CommFB (a dependency of DED) both export",
    "\tout : INT;", "IF ISLIBRELEASED() THEN\n\tout := INT#1;\nELSE\n\tout := INT#2;\nEND_IF"),

  // ─── LB2 a namespace reaches its own library's elements ─────────────────────────────────────────────────────────
  fb("lib_ns_transitive_bare", "LB2 — CommFB's `IO_SYSTEM_TYPE` bare (CommFB a dependency of DED, not a reference of the application?)",
    "\tv : IO_SYSTEM_TYPE;\n\tout : INT;", "out := INT#1;"),
  fb("lib_ns_direct_dependency_only", "LB2 — CommFB's `IO_SYSTEM_TYPE` through the namespace of DED, which depends on CommFB: `DED.IO_SYSTEM_TYPE`",
    "\tv : DED.IO_SYSTEM_TYPE;\n\tout : INT;", "out := INT#1;"),
  fb("lib_ns_transitive_namespace", "LB2 — CommFB's `IO_SYSTEM_TYPE` through CommFB's own namespace: `CommFB.IO_SYSTEM_TYPE`",
    "\tv : CommFB.IO_SYSTEM_TYPE;\n\tout : INT;", "out := INT#1;"),

  // ─── LB8 lib0.lib1.sym ──────────────────────────────────────────────────────────────────────────────────────────
  fb("lib_ns_transitive_qualification", "LB8 — `DED.CommFB.IO_SYSTEM_TYPE`: through DED's namespace to its dependency's (out 2)",
    "\tv : DED.CommFB.IO_SYSTEM_TYPE;\n\tout : INT;",
    "v := DED.CommFB.IO_SYSTEM_TYPE.PROFINET_IO;\nIF v = DED.CommFB.IO_SYSTEM_TYPE.PROFINET_IO THEN\n\tout := INT#2;\nEND_IF"),
  fb("lib_ns_transitive_qualification_call", "LB8 — `Util.Standard.LEN('abcd')`: a FUNCTION through Util's namespace to its dependency Standard's (out 4)",
    "\tout : INT;", "out := Util.Standard.LEN('abcd');"),

  // ─── LB4 a project unit named like a library namespace ──────────────────────────────────────────────────────────
  fb("lib_ns_project_unit_shadows_namespace", "LB4 — `BPLog.v` where a project PROGRAM `BPLog` shares BreakpointLogging's namespace name: the program's (out 12)",
    "\tout : INT;", "BPLog();\nout := BPLog.v;",
    "PROGRAM BPLog\nVAR\n\tv : INT := 12;\nEND_VAR\nEND_PROGRAM\n\n"),
  fb("lib_ns_project_type_shadows_namespace", "LB4 — `rec : CmpApp` where a project STRUCT `CmpApp` shares CmpApp's namespace name: the struct (out 6)",
    "\trec : CmpApp;\n\tout : INT;", "rec.a := INT#6;\nout := rec.a;",
    "TYPE CmpApp :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n\n"),

  // ─── LB9 lib.gvl.var ────────────────────────────────────────────────────────────────────────────────────────────
  fb("lib_ns_library_gvl_member", "LB9 — `Util.DAY_FLAGS.TUESDAY`: a library list's variable through namespace and list (out 2)",
    "\tb : BYTE;\n\tout : INT;", "b := Util.DAY_FLAGS.TUESDAY;\nIF b = BYTE#2 THEN\n\tout := INT#2;\nEND_IF"),
  fb("lib_ns_library_gvl_shared_list_name", "LB9 — `Util.CONSTANTS.GC_AUSIWEEKDAY[1]`: a list name five libraries carry, qualified by Util's namespace (out 3)",
    "\tu : USINT;\n\tout : INT;", "u := Util.CONSTANTS.GC_AUSIWEEKDAY[1];\nIF u = USINT#3 THEN\n\tout := INT#3;\nEND_IF"),
  fb("lib_ns_library_gvl_shared_list_name_bare", "LB9/LB6 — `CONSTANTS.GC_AUSIWEEKDAY[1]`: the list name five libraries carry, bare (only Util's declares the variable)",
    "\tu : USINT;\n\tout : INT;", "u := CONSTANTS.GC_AUSIWEEKDAY[1];\nIF u = USINT#3 THEN\n\tout := INT#3;\nEND_IF"),
]

/**
 * THE REFUSALS THE LSP DOES NOT MAKE (CODESYS 2026-10-02), each a fact the workspace does not hold — the manifest
 * (`.library`: NAMESPACE, RESOLUTION, PLACEHOLDER, SYSTEM, DEPENDENCIES) says neither which references are the
 * APPLICATION's own nor which a library PUBLISHES, nor whether it requires qualified access, and a materialized
 * declaration does not say INTERNAL. Each niche: the corpora build, so they hold none of these refused forms.
 */
const NOT_IN_THE_MANIFEST =
  "2026-10-02 niche: accepted loss (0 occurrences in the corpora): which libraries the APPLICATION references (CommFB is DED's dependency, not the application's) and which require qualified access (CAA Device Diagnosis' elements are \"Unknown type\" bare) is a bridge fact the manifest does not carry — never guessed per library (`support/divergences.ts` `CODESYS_LIBRARY_DIVERGENCES`)"
const DEFERRED: Readonly<Record<string, string>> = {
  lib_ns_transitive_bare: NOT_IN_THE_MANIFEST,
  lib_ns_transitive_namespace: NOT_IN_THE_MANIFEST,
  lib_ns_qualified_access_library_bare: NOT_IN_THE_MANIFEST,
  lib_ns_type_name_two_libraries_other_member: `${NOT_IN_THE_MANIFEST}; bare \`ERROR\` is Util's — DED's is no candidate — and the LSP, ranking Util and DED alike, takes DED's by the URI tiebreak (0 bare project type names two libraries export, counted 2026-10-02)`,
  lib_ns_direct_dependency_only:
    "2026-10-02 niche: accepted loss (0 occurrences in the corpora): `DED.IO_SYSTEM_TYPE` is \"Unknown type\" — DED's namespace does not reach CommFB, a dependency it does not publish — while 51 corpus references reach a PUBLISHED dependency's element through a namespace (`L_IE1P.L_IE1P_SeverityLevel`, two projects that build); the manifest does not say which dependencies are published (`support/divergences.ts` `CODESYS_LIBRARY_DIVERGENCES`)",
  lib_ns_library_internal_function_bare:
    "2026-10-02 niche: accepted loss (0 occurrences in the corpora): Util's LEAPYEARS is INTERNAL — \"Identifier 'LEAPYEARS' not defined\" bare, \"Cannot access internal object\" qualified — and its materialized declaration (`FUNCTION LEAPYEARS : UINT`) does not say so (`support/divergences.ts` `CODESYS_LIBRARY_DIVERGENCES`)",
  lib_ns_library_internal_function_qualified:
    "2026-10-02 niche: accepted loss (0 occurrences in the corpora): Util's LEAPYEARS is INTERNAL — \"Cannot access internal object LeapYears of library util …\" — and its materialized declaration does not say so (`support/divergences.ts` `CODESYS_LIBRARY_DIVERGENCES`)",
  lib_ns_library_gvl_shared_list_name_bare:
    "2026-10-02 niche: accepted loss (0 occurrences in the corpora: no project reads `L.v` with `L` a list name two libraries carry): \"Ambiguous use of name 'CONSTANTS'\" — Util's and StringUtils' lists both carry the name; which libraries' lists are candidates at all is the application's references, which the manifest does not carry (`support/divergences.ts` `CODESYS_LIBRARY_DIVERGENCES`)",
}

export const LIBRARY_RULE_TESTS: readonly LanguageTest[] = ASKED.map((t) =>
  DEFERRED[t.name] === undefined ? t : { ...t, deferred: { lsp: DEFERRED[t.name]! } },
)
