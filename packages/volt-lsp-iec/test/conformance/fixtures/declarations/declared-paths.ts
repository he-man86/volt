/**
 * PATHS AND QUALIFIED NAMES IN A DECLARATION (openspec lsp-field-false-positives 8, class 4). Task 3 found an instance
 * path with an array index (`GVL.fb.arr[1].x : T;`) in a persistent variable list, which CODESYS builds and the LSP
 * refused. A declared name reads a path in every list (`syntax/parse/names.ts` `readDeclaredName`), so each list is asked
 * each path form — one list and one form per fixture, `dp_<list>_<form>`:
 *
 *   lists   a global list (`VAR_GLOBAL`, `CONSTANT`, `RETAIN`, `PERSISTENT`, `PERSISTENT RETAIN`, `RETAIN PERSISTENT`), a
 *           configuration list (`VAR_CONFIG`, each path bound `AT %IX…` to an `AT %I*` input), an FB's `VAR`, a STRUCT;
 *   forms   `PLC_PRG.inst.y` (dotted), `PLC_PRG.afb[1].y` (an array element on the way), `PLC_PRG.aafb[1, 2].y` and
 *           `[1,2]` (two indexes, as the vendor spells them and tight), `PLC_PRG.ax[1]` (the index last), `PLC_PRG.inst.`
 *           (a dangling dot), and a path as the SECOND name of a list (`k, PLC_PRG.inst.y`).
 *
 * Beside them, what only a configuration list holds (no `AT`, an `AT %I*`, a bare name, a member that does not exist, an
 * index out of range), the paths a REFERENCE's and a POINTER's initial value names (`REF= GVL.g`, `ADR(GVL.ga[1])`, the
 * global namespace `.g`), and a path as an attribute's value. Each target exists: PLC_PRG holds the instances the paths
 * name (`inst_<n>`, `afb_<n>`, `aafb_<n>`, `ax_<n>`), of the fixture's own FB, whose `x AT %I*` a configuration binds.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec lsp-field-false-positives 8 (class 4) — a path or a qualified name where a declaration takes one"

/** The FB every path ends in, and the instances PLC_PRG holds of it. */
const target = (n: string): string => `FUNCTION_BLOCK FB_LANG_${n}_t\nVAR\n\tx AT %I* : BOOL;\n\ty : INT;\nEND_VAR\ny := 1;\nEND_FUNCTION_BLOCK\n\n`
/** Why a path fixture has no run: its FB's `x AT %I*` is bound for one instance at most, so the application builds and
 *  never logs in ("Login failed...", `dp_gvl_dotted`, 2026-10-29), as `lit_address_incomplete` measured. */
const NO_LOGIN =
  "NOTHING TO MEASURE — the instances the paths name hold an `AT %I*` input no configuration binds for all of them, so the application builds and never starts (\"Login failed...\", 2026-10-29); its one question is what the build says"

const instances = (n: string): string =>
  `inst_${n} : FB_LANG_${n}_t;\n\tafb_${n} : ARRAY[1..2] OF FB_LANG_${n}_t;\n\taafb_${n} : ARRAY[1..2, 1..2] OF FB_LANG_${n}_t;\n\tax_${n} : ARRAY[1..2] OF INT;`

/** The path forms, each as the declared names of one declaration. */
const FORMS: Readonly<Record<string, (n: string, member: string) => string>> = {
  dotted: (n, m) => `PLC_PRG.inst_${n}.${m}`,
  indexed: (n, m) => `PLC_PRG.afb_${n}[1].${m}`,
  indexed_two: (n, m) => `PLC_PRG.aafb_${n}[1, 2].${m}`,
  indexed_two_tight: (n, m) => `PLC_PRG.aafb_${n}[1,2].${m}`,
  index_last: (n) => `PLC_PRG.ax_${n}[1]`,
  dangling_dot: (n) => `PLC_PRG.inst_${n}.`,
  second_name: (n, m) => `k_${n}, PLC_PRG.inst_${n}.${m}`,
}

/** The lists, each as the text declaring `names` in it; `config` binds an input, the rest declare an INT. */
const LISTS: Readonly<Record<string, (names: string) => { list: string; inFb?: true; struct?: true }>> = {
  gvl: (d) => ({ list: `VAR_GLOBAL\n\t${d} : INT;\nEND_VAR\n` }),
  gvl_constant: (d) => ({ list: `VAR_GLOBAL CONSTANT\n\t${d} : INT := 1;\nEND_VAR\n` }),
  gvl_retain: (d) => ({ list: `VAR_GLOBAL RETAIN\n\t${d} : INT;\nEND_VAR\n` }),
  gvl_persistent: (d) => ({ list: `VAR_GLOBAL PERSISTENT\n\t${d} : INT;\nEND_VAR\n` }),
  gvl_persistent_retain: (d) => ({ list: `VAR_GLOBAL PERSISTENT RETAIN\n\t${d} : INT;\nEND_VAR\n` }),
  gvl_retain_persistent: (d) => ({ list: `VAR_GLOBAL RETAIN PERSISTENT\n\t${d} : INT;\nEND_VAR\n` }),
  config: (d) => ({ list: `VAR_CONFIG\n\t${d} AT %IX7.0 : BOOL;\nEND_VAR\n` }),
  fb_var: (d) => ({ list: d, inFb: true }),
  struct: (d) => ({ list: d, struct: true }),
}

function pathFixture(name: string, feature: string, names: string, listOf: (names: string) => { list: string; inFb?: true; struct?: true }): LanguageTest {
  const { list, inFb, struct } = listOf(names)
  const base = {
    name,
    feature,
    fromDoc: doc,
    pouName: `FB_LANG_${name}_t`,
    kind: "function_block" as const,
    plcPrgVar: instances(name),
    execSkip: NO_LOGIN,
  }
  if (inFb === true)
    return {
      ...base,
      pouName: `FB_LANG_${name}`,
      source: `${target(name)}FUNCTION_BLOCK FB_LANG_${name}\nVAR\n\t${list} : INT;\n\tk : INT;\nEND_VAR\nk := 1;\nEND_FUNCTION_BLOCK\n`,
      plcPrgVar: `${instances(name)}\n\tuser_${name} : FB_LANG_${name};`,
    }
  if (struct === true)
    return {
      ...base,
      source: `${target(name)}TYPE DUT_LANG_${name} :\nSTRUCT\n\t${list} : INT;\n\tother : INT;\nEND_STRUCT\nEND_TYPE\n`,
      plcPrgVar: `${instances(name)}\n\ts_${name} : DUT_LANG_${name};`,
    }
  return { ...base, source: `${target(name)}${list}`, gvlNames: [`GVL_LANG_${name}`] }
}

const LIST_FORM_TESTS: readonly LanguageTest[] = Object.entries(LISTS).flatMap(([list, listOf]) =>
  Object.entries(FORMS).map(([form, path]) => {
    const name = `dp_${list}_${form}`
    return pathFixture(name, `${form.replace(/_/g, " ")} path declared in ${list.replace(/_/g, " ")}`, path(name, list === "config" ? "x" : "y"), listOf)
  }),
)

/** What only a configuration list holds: the binding's own shapes. */
const CONFIG_TESTS: readonly LanguageTest[] = [
  ["dp_config_no_at", (n: string) => `VAR_CONFIG\n\tPLC_PRG.inst_${n}.x : BOOL;\nEND_VAR\n`, "a configured path with no AT"],
  ["dp_config_at_star", (n: string) => `VAR_CONFIG\n\tPLC_PRG.inst_${n}.x AT %I* : BOOL;\nEND_VAR\n`, "a configured path bound to an incomplete address"],
  ["dp_config_bare_name", (n: string) => `VAR_CONFIG\n\tx_${n} AT %IX7.0 : BOOL;\nEND_VAR\n`, "a bare name, no path, in a configuration list"],
  ["dp_config_unknown_member", (n: string) => `VAR_CONFIG\n\tPLC_PRG.inst_${n}.nope AT %IX7.0 : BOOL;\nEND_VAR\n`, "a configured path to a member the FB does not have"],
  ["dp_config_index_out_of_range", (n: string) => `VAR_CONFIG\n\tPLC_PRG.afb_${n}[5].x AT %IX7.0 : BOOL;\nEND_VAR\n`, "a configured path through an index out of the array's range"],
  ["dp_config_wrong_type", (n: string) => `VAR_CONFIG\n\tPLC_PRG.inst_${n}.x AT %IX7.0 : INT;\nEND_VAR\n`, "a configured path declared with another type than its variable's"],
].map(([name, list, feature]) => ({
  name: name as string,
  feature: feature as string,
  fromDoc: doc,
  pouName: `FB_LANG_${name as string}_t`,
  kind: "function_block" as const,
  source: `${target(name as string)}${(list as (n: string) => string)(name as string)}`,
  gvlNames: [`GVL_LANG_${name as string}`],
  plcPrgVar: instances(name as string),
  execSkip: NO_LOGIN,
}))

/** The globals a REFERENCE's or a POINTER's initial value names. */
const globals = (n: string): string =>
  `VAR_GLOBAL\n\tg_${n} : INT;\n\tga_${n} : ARRAY[1..2] OF INT;\n\tgs_${n} : DUT_LANG_${n}_s;\nEND_VAR\n\nTYPE DUT_LANG_${n}_s :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n\n`
const INIT_TESTS: readonly LanguageTest[] = [
  ["dp_ref_qualified", (n: string) => `rf : REFERENCE TO INT REF= GVL_LANG_${n}.g_${n};`],
  ["dp_ref_qualified_indexed", (n: string) => `rf : REFERENCE TO INT REF= GVL_LANG_${n}.ga_${n}[1];`],
  ["dp_ref_qualified_member", (n: string) => `rf : REFERENCE TO INT REF= GVL_LANG_${n}.gs_${n}.a;`],
  ["dp_ref_global_namespace", (n: string) => `rf : REFERENCE TO INT REF= .g_${n};`],
  ["dp_ref_assign_init", (n: string) => `rf : REFERENCE TO INT := GVL_LANG_${n}.g_${n};`],
  ["dp_pointer_qualified", (n: string) => `p : POINTER TO INT := ADR(GVL_LANG_${n}.g_${n});`],
  ["dp_pointer_qualified_indexed", (n: string) => `p : POINTER TO INT := ADR(GVL_LANG_${n}.ga_${n}[1]);`],
  ["dp_pointer_qualified_member", (n: string) => `p : POINTER TO INT := ADR(GVL_LANG_${n}.gs_${n}.a);`],
  ["dp_pointer_global_namespace", (n: string) => `p : POINTER TO INT := ADR(.g_${n});`],
].map(([name, decl]) => {
  const n = name as string
  return {
    name: n,
    feature: `an initial value naming a path: \`${(decl as (n: string) => string)("n")}\``,
    fromDoc: doc,
    pouName: `FB_LANG_${n}`,
    kind: "function_block" as const,
    gvlNames: [`GVL_LANG_${n}`],
    source: `${globals(n)}FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\t${(decl as (n: string) => string)(n)}\n\tk : INT;\nEND_VAR\nk := 1;\nEND_FUNCTION_BLOCK\n`,
    plcPrgVar: `inst_${n} : FB_LANG_${n};`,
    plcPrgBody: `inst_${n}();`,
  }
})

/** A path as an attribute's VALUE — quoted, as an attribute value is written, and unquoted. */
const ATTRIBUTE_TESTS: readonly LanguageTest[] = [
  ["dp_attribute_value_path_quoted", (n: string) => `{attribute 'volt_path' := 'GVL_LANG_${n}.g_${n}'}`],
  ["dp_attribute_value_path_unquoted", (n: string) => `{attribute 'volt_path' := GVL_LANG_${n}.g_${n}}`],
  ["dp_attribute_value_name_unquoted", (n: string) => `{attribute 'volt_path' := g_${n}}`],
].map(([name, pragma]) => {
  const n = name as string
  return {
    name: n,
    feature: `an attribute whose value is a path: \`${(pragma as (n: string) => string)("n")}\``,
    fromDoc: doc,
    pouName: `FB_LANG_${n}`,
    kind: "function_block" as const,
    gvlNames: [`GVL_LANG_${n}`],
    source: `${globals(n)}FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\t${(pragma as (n: string) => string)(n)}\n\tk : INT;\nEND_VAR\nk := 1;\nEND_FUNCTION_BLOCK\n`,
    plcPrgVar: `inst_${n} : FB_LANG_${n};`,
    plcPrgBody: `inst_${n}();`,
  }
})

/** A dotted path in each other section a POU declares in — the FB's `VAR` refused it, and a section is asked, not assumed. */
const SECTION_TESTS: readonly LanguageTest[] = ["VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP", "VAR_STAT", "VAR_EXTERNAL", "VAR CONSTANT"].map(
  (section) => {
    const name = `dp_${section.toLowerCase().replace(" ", "_")}_dotted`
    const init = section === "VAR CONSTANT" ? " := 1" : ""
    return {
      name,
      feature: `a dotted path declared in ${section}`,
      fromDoc: doc,
      pouName: `FB_LANG_${name}`,
      kind: "function_block" as const,
      source: `${target(name)}FUNCTION_BLOCK FB_LANG_${name}\n${section}\n\tPLC_PRG.inst_${name}.y : INT${init};\nEND_VAR\nVAR\n\tk : INT;\nEND_VAR\nk := 1;\nEND_FUNCTION_BLOCK\n`,
      plcPrgVar: `${instances(name)}\n\tuser_${name} : FB_LANG_${name};`,
      execSkip: NO_LOGIN,
    }
  },
)

/** The forms the first recording raised: an index with no path before it, and a dangling dot before `AT` in a global list. */
const EDGE_FORM_TESTS: readonly LanguageTest[] = [
  pathFixture("dp_gvl_index_only", "an array element with no path before it, in a global list", "ax_dp_gvl_index_only[1]", LISTS.gvl!),
  pathFixture("dp_config_index_only", "an array element with no path before it, in a configuration list", "ax_dp_config_index_only[1]", LISTS.config!),
  pathFixture("dp_fb_var_index_only", "an array element with no path before it, in an FB's VAR", "ax_dp_fb_var_index_only[1]", LISTS.fb_var!),
  {
    name: "dp_var_external_dotted_unknown",
    feature: "a dotted path to a member the FB does not have, declared in VAR_EXTERNAL",
    fromDoc: doc,
    pouName: "FB_LANG_dp_var_external_dotted_unknown",
    kind: "function_block",
    source: `${target("dp_var_external_dotted_unknown")}FUNCTION_BLOCK FB_LANG_dp_var_external_dotted_unknown\nVAR_EXTERNAL\n\tPLC_PRG.inst_dp_var_external_dotted_unknown.nope : INT;\nEND_VAR\nVAR\n\tk : INT;\nEND_VAR\nk := 1;\nEND_FUNCTION_BLOCK\n`,
    plcPrgVar: `${instances("dp_var_external_dotted_unknown")}\n\tuser_dp_var_external_dotted_unknown : FB_LANG_dp_var_external_dotted_unknown;`,
    execSkip: NO_LOGIN,
  },
  pathFixture(
    "dp_gvl_dangling_dot_at",
    "a dangling dot before AT, in a global list",
    "PLC_PRG.inst_dp_gvl_dangling_dot_at. AT %IX7.1",
    LISTS.gvl!,
  ),
]

export const DECLARED_PATH_TESTS: readonly LanguageTest[] = [
  ...LIST_FORM_TESTS,
  ...CONFIG_TESTS,
  ...INIT_TESTS,
  ...ATTRIBUTE_TESTS,
  ...SECTION_TESTS,
  ...EDGE_FORM_TESTS,
]
