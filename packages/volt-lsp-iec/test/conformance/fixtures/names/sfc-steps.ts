/**
 * SFC STEP NAMES, RULE BY RULE — openspec `lsp-sfc-step-names` 1.1. A POU whose body is SFC puts the names of its
 * chart's steps in scope, each an instance of the IecSfc library's `SFCStepType`, and nothing in the POU's TEXT declares
 * them: Volt materializes the body as `IMPLEMENTATION SFC UNSUPPORTED`, so the chart is not in the file the LSP reads.
 * Seen in the field as `'S_Boot' is no component of 'PRG0_Main'` on a program that builds clean (PLCAssist, 2026-09-30).
 *
 * THE CHART IS CODESYS'S OWN. `record:exec` creates each SFC POU in SFC (`support/fixture-units.ts` `language`), which
 * gives the chart CODESYS makes for a new one — ONE initial step `Init`, a TRUE transition, a jump back (measured
 * 2026-10-03, SP21, exported as PLCopen) — and names that one step `S_Boot`, as the field case did, through CODESYS's own
 * PLCopen export and import (`types.ts` `sfcStep`). Nothing else is drawn. The default name is not kept because `Init` is
 * also a member of a TRANSITIVE library's enum (Component Manager's `RUNTIME_LICENSE_STATE.INIT`), which CODESYS does not
 * reach bare ("Identifier 'Init' not defined" in PLC_PRG) and the LSP does (LB2, `scope-nav` `resolveBareEnumMember`): a
 * fixture reading `Init.x` measured that enum, not the step — every in-POU read came back silent for that reason. So
 * the rules are asked of `S_Boot`, and S13 asks the default `Init` itself, as every new chart names it: the step is CODESYS's
 * answer there, and the LSP's enum binding is the wrong one even where it is silent.
 * The push refuses to CREATE a body it cannot author, on both vendors (`BodyFormatGuard.RequireAuthorable`), so there is
 * no BUILD recording: the run recording is CODESYS's answer — values where it builds, "does not compile: …" where not.
 *
 *   S1  a step's flag `.x` (BOOL) and elapsed time `.t` (TIME), read in an ACTION of the SFC PROGRAM
 *   S2  the internal pair `._x` / `._t`
 *   S3  the step qualified from OUTSIDE: `PRG.S_Boot.x` / `.t` (the field shape), `._x` / `._t`, and through an FB INSTANCE
 *   S4  the step in an SFC FUNCTION_BLOCK's ACTION and METHOD
 *   S5  case: `S_BOOT.X`
 *   S6  writing the flag and the time inside the POU; writing `PRG.S_Boot.x` from outside ("is no input of")
 *   S7  what a step IS: an unknown member ("is no component of 'SFCStepType'"), the step bare as a value (its type named
 *       `IecSfc.SFCStepType(…)`), `.t` as TIME and `.x` as BOOL (each assigned to an INT), SIZEOF and ADR of it
 *   S8  a name that is NO step: a typo inside ("Identifier 'S_Bot' not defined") and qualified ("is no component of")
 *   S9  a step name outside its POU, unqualified ("Identifier 'S_Boot' not defined")
 *   S10 a variable declared with a step's name ("has to be of type 'IecSfc.SFCStepType'")
 *   S11 the SFC flag variables: `SFCInit` undeclared is unknown; declared, it builds (CODESYS warns "Use of SFC flag
 *       variable 'SFCInit' is disabled." — a warning the run recording does not carry)
 *   S12 an ACTION's name with `.x`: an action no step of the chart calls has no flags ("'x' is no component of 'A'")
 *   S13 the DEFAULT step name `Init` — the one every new chart has, so the likeliest in a real project — whose name is also
 *       a transitive library's enum member (`RUNTIME_LICENSE_STATE.INIT`): CODESYS binds `Init.x` to the step
 *   S14 a step's name beside another visible name of the same spelling — a GVL global, a project enum member, a FUNCTION —
 *       read in the SFC POU's action (the step's?) and outside it (the global's). Each fixture names its own step, since a
 *       global or POU of a name another fixture's chart reads would make that fixture depend on this one
 *   S11 (systematic) every SFC flag variable CODESYS names — BOOL: SFCInit, SFCReset, SFCPause, SFCError, SFCTrans,
 *       SFCEnableLimit, SFCQuitError, SFCTip, SFCTipMode; STRING: SFCCurrentStep, SFCErrorStep, SFCErrorPOU,
 *       SFCErrorAnalyzation — undeclared, declared with its type and read, declared with ANOTHER type, and (a STRING flag)
 *       read into an INT. `SFCErrorAnalyzationTable` is not asked: its element type (IecSfc's `ExpressionResult`) and
 *       bounds are a declaration this text would have to guess. CODESYS's answers (2026-10-03): undeclared, each is unknown;
 *       declared, with its type OR ANY OTHER (`SFCInit : INT`, `SFCCurrentStep : BOOL`), each builds and reads as the
 *       ordinary variable it declares — the chart's flag use is disabled in the default SFC settings, so the name is
 *       nothing more; a STRING flag into an INT is the plain conversion refusal. The LSP agrees on every cell.
 *   S13/S14 answers: CODESYS binds the STEP in every case — over the library enum member `Init`, a GVL global, a project
 *       enum member and a FUNCTION of the same name — and the global outside the POU (k = 7)
 *
 * NOT ASKED, and why: a chart of SEVERAL steps, and an IEC action's flags (an action a step calls through a qualifier),
 * need a chart the recorder would have to DRAW rather than rename. Every rule above is about ONE step's name and what it
 * holds, which a second step would only repeat. 0 SFC charts with steps in the six corpora (the two `VltFixtureSfc`
 * stubs hold the default chart and no code reads them).
 *
 * A `.t` is never recorded as a value: it is the time since the step became active, which no replay can reproduce, so
 * each fixture records `.t >= T#0MS` instead. AVOID ONE-LETTER NAMES in an SFC POU: `s : STRING;` in one was refused
 * ("Unexpected token 's' found", a scratch probe 2026-10-03; whether only in an SFC POU was not asked) — a question for
 * another fixture than these.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec lsp-sfc-step-names 1.1; docs/codesys-reference/01-languages-and-editors.md (SFC)"

/** The refusal `volt push` gives a create whose body is a language Volt cannot author — on both vendors, before any IDE. */
const NOT_AUTHORABLE =
  "Volt's push, not the IDE: the item is 'IMPLEMENTATION SFC UNSUPPORTED', a body Volt cannot author — there is no text " +
  "form for it, so it can only be created in the IDE (BodyFormatGuard.RequireAuthorable). record:exec creates the SFC POU itself."
const REFUSES = { codesys: NOT_AUTHORABLE, twincat: NOT_AUTHORABLE }

/** Why the LSP does not refuse what CODESYS refuses yet — openspec lsp-sfc-step-names 2.1 (step names in scope). */
const GAP = "lsp-sfc-step-names 2.1 (2026-10-03): the chart is not in the text, so no step name is in scope —"

/** The chart's one step, named as the field case named it (`types.ts` `sfcStep`). */
const STEP = "S_Boot"

/** An SFC PROGRAM `PRG_LANG_sfc_<name>` with VAR `vars` and ACTION `A` holding `action` (none when empty). PLC_PRG calls
 *  it, then its action, and runs `plcBody` over `plcVars`. */
function program(
  name: string,
  feature: string,
  vars: string,
  action: string,
  plcVars = "",
  plcBody = "",
  refused?: string,
  gap?: string,
): LanguageTest {
  const pouName = `PRG_LANG_sfc_${name}`
  return {
    name: `sfc_step_${name}`,
    pouName,
    kind: "program",
    feature,
    fromDoc: doc,
    source:
      `PROGRAM ${pouName}\nVAR\n${vars}\nEND_VAR\nIMPLEMENTATION SFC UNSUPPORTED\nEND_PROGRAM\n` +
      (action === "" ? "" : `\nACTION A\n${action}\nEND_ACTION\n`),
    plcPrgVar: plcVars,
    plcPrgBody: `${pouName}();\n${action === "" ? "" : `${pouName}.A();\n`}${plcBody}`,
    sfcStep: STEP,
    vendorRefuses: REFUSES,
    ...(refused === undefined ? {} : { refused }),
    ...(gap === undefined ? {} : { deferred: { lsp: `${GAP} ${gap}` } }),
  }
}

/** An SFC FUNCTION_BLOCK `FB_LANG_sfc_<name>` with VAR `vars` and the member units `members`, instanced in PLC_PRG as
 *  `inst` and called, then `plcBody`. */
function block(name: string, feature: string, vars: string, members: string, plcVars = "", plcBody = ""): LanguageTest {
  const pouName = `FB_LANG_sfc_${name}`
  return {
    name: `sfc_step_${name}`,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    source: `FUNCTION_BLOCK ${pouName}\nVAR\n${vars}\nEND_VAR\nIMPLEMENTATION SFC UNSUPPORTED\nEND_FUNCTION_BLOCK\n\n${members}`,
    plcPrgVar: `inst : ${pouName};\n${plcVars}`,
    plcPrgBody: `inst();\n${plcBody}`,
    sfcStep: STEP,
    vendorRefuses: REFUSES,
  }
}

/** PLC_PRG copies the program's `bx` and `tOk` out, so the run recording holds them. */
const copyOut = (name: string): string => `bx := PRG_LANG_sfc_${name}.bx;\ntOk := PRG_LANG_sfc_${name}.tOk;`
const OUT_VARS = "bx : BOOL; tOk : BOOL;"
const OWN_VARS = "\tbx : BOOL;\n\ttOk : BOOL;"

/** `t` recorded with the chart's one step named `step` instead of `S_Boot` (`types.ts` `sfcStep`). */
const named = (t: LanguageTest, step: string): LanguageTest => ({ ...t, sfcStep: step })


/** `t` with `text` ahead of its POU — a list (each named in `gvlNames`), a type, a FUNCTION. */
const ahead = (t: LanguageTest, text: string, gvlNames?: readonly string[]): LanguageTest => ({
  ...t,
  source: `${text}\n${t.source}`,
  ...(gvlNames === undefined ? {} : { gvlNames }),
})

/** The SFC flag variables CODESYS names, with their types (S11). */
const FLAGS: readonly [string, "BOOL" | "STRING"][] = [
  ["SFCInit", "BOOL"],
  ["SFCReset", "BOOL"],
  ["SFCPause", "BOOL"],
  ["SFCError", "BOOL"],
  ["SFCTrans", "BOOL"],
  ["SFCEnableLimit", "BOOL"],
  ["SFCQuitError", "BOOL"],
  ["SFCTip", "BOOL"],
  ["SFCTipMode", "BOOL"],
  ["SFCCurrentStep", "STRING"],
  ["SFCErrorStep", "STRING"],
  ["SFCErrorPOU", "STRING"],
  ["SFCErrorAnalyzation", "STRING"],
]

/** Each flag undeclared, declared with its type and read, declared with another type, and a STRING one read into an INT. */
function flagTests(): LanguageTest[] {
  const out: LanguageTest[] = []
  for (const [flag, type] of FLAGS) {
    const id = flag.toLowerCase()
    const prg = (cell: string): string => `PRG_LANG_sfc_flag_${id}_${cell}`
    // SFCInit's undeclared and declared cells are the original S11 pair (`flag_undeclared`, `flag_declared`)
    if (flag !== "SFCInit") {
      out.push(
        type === "BOOL"
          ? program(`flag_${id}_undeclared`, `S11: the SFC flag ${flag} read without declaring it`, OWN_VARS, `bx := ${flag};`, "", "",
              `Identifier '${flag}' not defined`)
          : program(`flag_${id}_undeclared`, `S11: the SFC flag ${flag} read without declaring it`, "\tsText : STRING;", `sText := ${flag};`, "", "",
              `Identifier '${flag}' not defined`),
      )
      out.push(
        type === "BOOL"
          ? program(`flag_${id}_declared`, `S11: the SFC flag ${flag} declared as BOOL and read`, `\t${flag} : BOOL;\n${OWN_VARS}`,
              `bx := ${flag};`, OUT_VARS, copyOut(`flag_${id}_declared`))
          : program(`flag_${id}_declared`, `S11: the SFC flag ${flag} declared as STRING and read`, `\t${flag} : STRING;\n\tsText : STRING;`,
              `sText := ${flag};`, "sText : STRING;", `sText := ${prg("declared")}.sText;`),
      )
    }
    out.push(
      type === "BOOL"
        ? program(`flag_${id}_wrong_type`, `S11: the SFC flag ${flag} declared as INT, not BOOL, and read`, `\t${flag} : INT;\n\tk : INT;`,
            `k := ${flag};`, "k : INT;", `k := ${prg("wrong_type")}.k;`)
        : program(`flag_${id}_wrong_type`, `S11: the SFC flag ${flag} declared as BOOL, not STRING, and read`, `\t${flag} : BOOL;\n${OWN_VARS}`,
            `bx := ${flag};`, OUT_VARS, copyOut(`flag_${id}_wrong_type`)),
    )
    if (type === "STRING")
      out.push(program(`flag_${id}_into_int`, `S11: the SFC flag ${flag} declared as STRING and assigned to an INT`,
        `\t${flag} : STRING;\n\tk : INT;`, `k := ${flag};`, "", "", "Cannot convert type 'STRING' to type 'INT'"))
  }
  return out
}

export const SFC_STEP_TESTS: LanguageTest[] = [
  // S1
  program("flag_in_action", "S1: a step's .x and .t read in an ACTION of its SFC program", OWN_VARS,
    "bx := S_Boot.x;\ntOk := S_Boot.t >= T#0MS;", OUT_VARS, copyOut("flag_in_action")),
  // S2
  program("internal_in_action", "S2: a step's internal ._x and ._t read in an ACTION of its SFC program", OWN_VARS,
    "bx := S_Boot._x;\ntOk := S_Boot._t >= T#0MS;", OUT_VARS, copyOut("internal_in_action")),
  // S3 — the field's shape: a step of a PROGRAM read through the program's name
  program("qualified", "S3: PRG.S_Boot.x and PRG.S_Boot.t read from PLC_PRG", "", "", OUT_VARS,
    "bx := PRG_LANG_sfc_qualified.S_Boot.x;\ntOk := PRG_LANG_sfc_qualified.S_Boot.t >= T#0MS;"),
  program("qualified_internal", "S3: PRG.S_Boot._x and PRG.S_Boot._t read from PLC_PRG", "", "", OUT_VARS,
    "bx := PRG_LANG_sfc_qualified_internal.S_Boot._x;\ntOk := PRG_LANG_sfc_qualified_internal.S_Boot._t >= T#0MS;"),
  block("fb_instance", "S3: inst.S_Boot.x and inst.S_Boot.t read through an instance of an SFC FUNCTION_BLOCK", "", "", OUT_VARS,
    "bx := inst.S_Boot.x;\ntOk := inst.S_Boot.t >= T#0MS;"),
  // S4
  block("fb_action", "S4: a step's .x and .t read in an ACTION of its SFC FUNCTION_BLOCK", OWN_VARS,
    "ACTION A\nbx := S_Boot.x;\ntOk := S_Boot.t >= T#0MS;\nEND_ACTION\n", "", "inst.A();"),
  block("fb_method", "S4: a step's .x and .t read in a METHOD of its SFC FUNCTION_BLOCK", OWN_VARS,
    "METHOD M\nbx := S_Boot.x;\ntOk := S_Boot.t >= T#0MS;\nEND_METHOD\n", "", "inst.M();"),
  // S5
  program("case_insensitive", "S5: the step and its flag spelled in another case (S_BOOT.X, S_BOOT.T)", OWN_VARS,
    "bx := S_BOOT.X;\ntOk := S_BOOT.T >= T#0MS;", OUT_VARS, copyOut("case_insensitive")),
  // S6
  program("written_in_action", "S6: S_Boot.x and S_Boot.t written in an ACTION of its SFC program", OWN_VARS,
    "S_Boot.x := TRUE;\nS_Boot.t := T#1S;\nbx := S_Boot.x;\ntOk := S_Boot.t >= T#0MS;", OUT_VARS, copyOut("written_in_action")),
  program("written_from_outside", "S6: PRG.S_Boot.x written from PLC_PRG", "", "", "", "PRG_LANG_sfc_written_from_outside.S_Boot.x := TRUE;",
    "'S_Boot' is no input of 'PRG_LANG_sfc_written_from_outside'", "the LSP says 'S_Boot' is no COMPONENT of the program"),
  // S7
  program("unknown_member", "S7: a member SFCStepType does not have (S_Boot.y)", OWN_VARS, "bx := S_Boot.y;", "", "",
    "'y' is no component of 'SFCStepType'", "the LSP says S_Boot is not defined"),
  program("bare_value", "S7: the step itself read as a BOOL — its type is IecSfc.SFCStepType", OWN_VARS, "bx := S_Boot;", "", "",
    "Cannot convert type 'IecSfc.SFCStepType(iecsfc, 4.4.0.0 (system))' to type 'BOOL'", "the LSP says S_Boot is not defined"),
  program("t_is_time", "S7: S_Boot.t assigned to an INT — it is TIME", "\tk : INT;", "k := S_Boot.t;", "", "",
    "Cannot convert type 'TIME' to type 'INT'", "the LSP says S_Boot is not defined"),
  program("x_is_bool", "S7: S_Boot.x assigned to an INT — it is BOOL", "\tk : INT;", "k := S_Boot.x;", "", "",
    "Cannot convert type 'BOOL' to type 'INT'", "the LSP says S_Boot is not defined"),
  program("sizeof_adr", "S7: SIZEOF of a step and ADR of its flag", "\tsize : UDINT;\n\tpx : POINTER TO BOOL;\n\tbx : BOOL;",
    "size := SIZEOF(S_Boot);\npx := ADR(S_Boot.x);\nbx := px <> 0;", "size : UDINT; bx : BOOL;",
    "size := PRG_LANG_sfc_sizeof_adr.size;\nbx := PRG_LANG_sfc_sizeof_adr.bx;"),
  // S8
  program("typo", "S8: a name that is no step of the chart (S_Bot.x), inside the POU", OWN_VARS, "bx := S_Bot.x;", "", "",
    "Identifier 'S_Bot' not defined"),
  program("typo_qualified", "S8: a name that is no step of the chart (PRG.S_Bot.x), from PLC_PRG", "", "", "bx : BOOL;",
    "bx := PRG_LANG_sfc_typo_qualified.S_Bot.x;", "'S_Bot' is no component of 'PRG_LANG_sfc_typo_qualified'"),
  // S9
  program("outside_unqualified", "S9: a step name read unqualified in a POU that is not its SFC POU (PLC_PRG)", "", "",
    "bx : BOOL;", "bx := S_Boot.x;", "Identifier 'S_Boot' not defined"),
  // S10
  program("declared_as_variable", "S10: a variable of the SFC program declared with a step's name", "\tS_Boot : INT;", "", "", "",
    "Variable 'S_Boot' has to be of type 'IecSfc.SFCStepType'.", "the LSP sees an ordinary INT and says nothing"),
  // S11
  program("flag_undeclared", "S11: the SFC flag SFCInit read without declaring it", OWN_VARS, "bx := SFCInit;", "", "",
    "Identifier 'SFCInit' not defined"),
  program("flag_declared", "S11: the SFC flag SFCInit declared and read (CODESYS warns its use is disabled)",
    `\tSFCInit : BOOL;\n${OWN_VARS}`, "bx := SFCInit;", OUT_VARS, copyOut("flag_declared")),
  // S12
  program("action_flag", "S12: an ACTION's name with .x — an action no step calls has no flags", OWN_VARS, "bx := A.x;", "", "",
    "'x' is no component of 'A'",
    "nor which ACTION a step calls with a qualifier (an IEC action has flags), so the LSP leaves A.x alone and says nothing"),
  // S13 — the default step, as every new chart names it
  named(program("init_flag", "S13: the default step Init's .x and .t read in an ACTION (Init is also a library enum member)", OWN_VARS,
    "bx := Init.x;\ntOk := Init.t >= T#0MS;", OUT_VARS, copyOut("init_flag")), "Init"),
  // …the LSP is silent here for the WRONG reason: it binds bare `Init` to Component Manager's enum member (LB2) and says
  // nothing of its members; CODESYS binds the step. 2.1's step in scope must take precedence over that enum member.
  named(program("init_t_is_time", "S13: the default step's Init.t assigned to an INT — it is TIME", "\tk : INT;", "k := Init.t;", "", "",
    "Cannot convert type 'TIME' to type 'INT'",
    "and bare Init binds a transitive library's enum member (LB2), whose .t the LSP leaves untyped and silent"), "Init"),
  named(program("init_unknown_member", "S13: a member SFCStepType does not have, of the default step (Init.y)", OWN_VARS, "bx := Init.y;", "", "",
    "'y' is no component of 'SFCStepType'",
    "and bare Init binds a transitive library's enum member (LB2), whose .y the LSP says nothing of"), "Init"),
  // S14 — a step beside another visible name of its spelling
  named(ahead(program("shadow_global_in_action", "S14: a step and a GVL global of the same name — the step's .x and .t read in the action",
    OWN_VARS, "bx := S_Gvl.x;\ntOk := S_Gvl.t >= T#0MS;", OUT_VARS, copyOut("shadow_global_in_action")),
    "VAR_GLOBAL\n\tS_Gvl : INT := 7;\nEND_VAR\n", ["GVL_LANG_sfc_shadow_global_in_action"]), "S_Gvl"),
  // CODESYS binds the STEP in its own POU, over the global (the run reads TRUE, TRUE); the LSP, with no step in scope,
  // binds the INT global and says nothing of `.x` / `.t` on it — silent, so no mark can hold it: 2.1 must bind the step
  named(ahead(program("shadow_global_outside", "S14: a step and a GVL global of the same name — the name read bare in PLC_PRG",
    OWN_VARS, "bx := TRUE;", "k : INT;", "k := S_Gvl2;"),
    "VAR_GLOBAL\n\tS_Gvl2 : INT := 7;\nEND_VAR\n", ["GVL_LANG_sfc_shadow_global_outside"]), "S_Gvl2"),
  named(ahead(program("shadow_enum_in_action", "S14: a step and a project enum member of the same name — the step's .x and .t read in the action",
    OWN_VARS, "bx := S_Enum.x;\ntOk := S_Enum.t >= T#0MS;", OUT_VARS, copyOut("shadow_enum_in_action")),
    "TYPE DUT_LANG_sfc_shadow_enum_in_action :\n(\n\tS_Enum := 3,\n\tS_EnumOther := 4\n);\nEND_TYPE\n"), "S_Enum"),
  named(ahead(program("shadow_function_in_action", "S14: a step and a FUNCTION of the same name — the step's .x and .t read in the action",
    OWN_VARS, "bx := S_Fun.x;\ntOk := S_Fun.t >= T#0MS;", OUT_VARS, copyOut("shadow_function_in_action")),
    "FUNCTION S_Fun : INT\nS_Fun := 5;\nEND_FUNCTION\n"), "S_Fun"),
  // as with the global: CODESYS binds the step; the LSP binds the FUNCTION and is silent
  // S11, systematically
  ...flagTests(),
]
