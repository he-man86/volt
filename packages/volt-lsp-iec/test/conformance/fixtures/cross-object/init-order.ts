/**
 * THE INITIALIZATION ORDER OF PROGRAMS — openspec `analysis-conformance` task 3.12 (pro2193's three C0564 "A reference to
 * uninitialized variable Unit is used for initialization of Unit"): a PROGRAM's initializer reading ANOTHER PROGRAM's FB
 * instance. Which program is initialized first decides whether the read meets an initialized instance, so each cell
 * varies one thing the order could follow:
 *
 *   the NAME            the reader's name sorts before / after the read program's (`_A` / `_B`)
 *   the DECLARATION     the reader's unit is pushed (created) first / second
 *   the CALL            PLC_PRG calls the reader first / second
 *   `global_init_slot`  on the reader / on the read program (the attribute pro2193's `Chains` carries for this reason)
 *   the READ INSTANCE   initialized at its declaration `(instanceNo := 1)` (pro2193's), not at all, or by its FB type's
 *                       default — whether it has initialization code to run at all
 *   the SHAPE           an interface input of an FB instance (pro2193's), an array of them (pro2193's exactly), an
 *                       interface variable, a plain INT value
 *
 * plus pro2193's symbol attributes (and its `'noe'` typo) on a chain, and C0564's help-page repro inside one POU.
 *
 * WHAT THE VENDORS ANSWERED (2026-10-07). The order is the order the TASK reaches the programs — PLC_PRG's calls — with
 * `global_init_slot` before it (lower first, default 50000); not the name, not the declaration: `_called_second` is
 * silent where `initord_reads_later_name` is not, `_declared_second` is not silent. An initializer reading a program
 * initialized LATER is refused, whatever the read instance's own initialization, and so is C0564's same-block repro:
 *   TwinCAT    at BUILD, an ERROR on the reader's declaration line — "The uninitialized variable <read> is used for
 *              initialization of <target>. Use the attribute 'global_init_slot' to change the order of initialisation."
 *   CODESYS    NOT at build: every cell builds clean through the bridge (`app.build()`). It answers at CODE GENERATION
 *              (`app.generate_code()`, a single-use probe 2026-10-07): C0564 "A reference to uninitialized variable
 *              <read> is used for initialization of <target>. …" — a WARNING for an FB instance read (the interface
 *              cells, the arrays, the chains: one per late read), and TwinCAT's sentence as an ERROR for a value
 *              (`initord_value_later_name`) or an instance read into an interface variable
 *              (`initord_interface_var_later_name`). pro2193's three C0564 are such code-generation warnings.
 * The LSP models neither (`support/divergences.ts` `INIT_ORDER_OF_PROGRAMS`).
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`PRG_LANG_<name>_A|B`, `FB_LANG_<name>`, `ITF_LANG_<name>`): the replay binds every
 * fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec analysis-conformance 3.12 (initialization order of PROGRAMs); docs/codesys-reference attribute global_init_slot"

/** Why the execution recorder has nothing to read: CODESYS refuses the program at code generation, so login fails. */
const REFUSED_AT_CODE_GENERATION =
  "NOTHING TO MEASURE — recorded as \"Login failed...\" (CODESYS record:exec 2026-10-07): CODESYS refuses the initializer at CODE GENERATION (\"The uninitialized variable … Use the attribute 'global_init_slot' …\", a single-use generate_code probe), after a clean build, so the application never starts; its one question is what the build says"

interface Cell {
  /** Which program reads the other's instance in its initializer. */
  reader: "A" | "B"
  /** Declaration (push) order of the two programs. */
  declared: "AB" | "BA"
  /** PLC_PRG's call order. */
  called: "AB" | "BA"
  /** `global_init_slot` per program. */
  slot?: Partial<Record<"A" | "B", number>>
  /** The reader's declaration, given the read program's name (`X`); the read program declares `Unit : FB_LANG_<name>`
   *  (`Unit : ARRAY[1..1] OF FB_LANG_<name>` for the array shape) and `y : INT := 5`. */
  shape: "interface-input" | "array" | "interface-var" | "value"
  /** How the READ instance is initialized: `(instanceNo := 1)` written at it (pro2193's — the default), nothing at all,
   *  or a default the FB type declares (`instanceNo : INT := 1`). */
  readInit?: "written" | "none" | "type-default"
}

function cell(name: string, feature: string, c: Cell): LanguageTest {
  const itf = `ITF_LANG_${name}`
  const fbName = `FB_LANG_${name}`
  const prg = (p: "A" | "B"): string => `PRG_LANG_${name}_${p}`
  const read = c.reader === "A" ? "B" : "A"
  const X = prg(read)
  const slot = (p: "A" | "B"): string => (c.slot?.[p] === undefined ? "" : `{attribute 'global_init_slot' := '${c.slot[p]}'}\n`)
  const readInit = c.readInit ?? "written"
  const written = readInit === "written"
  const unitDecl =
    c.shape === "array"
      ? `Unit : ARRAY[1..1] OF ${fbName}${written ? " := [(instanceNo := 1)]" : ""};`
      : `Unit : ${fbName}${written ? " := (instanceNo := 1)" : ""};`
  const readDecl = {
    "interface-input": `Unit : ${fbName} := (reset := ${X}.Unit);`,
    array: `Unit : ARRAY[1..1] OF ${fbName} := [(reset := ${X}.Unit[1])];`,
    "interface-var": `i : ${itf} := ${X}.Unit;`,
    value: `v : INT := ${X}.y;`,
  }[c.shape]
  const call = c.shape === "array" ? "Unit[1]();" : "Unit();"
  const readerBody = c.shape === "interface-var" || c.shape === "value" ? "" : call
  const unit = (p: "A" | "B"): string =>
    p === c.reader
      ? `${slot(p)}PROGRAM ${prg(p)}\nVAR_INPUT\n\t${readDecl}\nEND_VAR\n${readerBody}\nEND_PROGRAM\n`
      : `${slot(p)}PROGRAM ${prg(p)}\nVAR_INPUT\n\t${unitDecl}\n\ty : INT := 5;\nEND_VAR\n${call}\nEND_PROGRAM\n`
  return {
    name,
    pouName: prg(c.reader),
    kind: "program",
    feature,
    fromDoc: doc,
    plcPrgVar: "",
    plcPrgBody: [...c.called].map((p) => `${prg(p as "A" | "B")}();`).join("\n"),
    source:
      `INTERFACE ${itf}\nEND_INTERFACE\n\n` +
      `FUNCTION_BLOCK ${fbName} IMPLEMENTS ${itf}\nVAR_INPUT\n\tinstanceNo : INT${readInit === "type-default" ? " := 1" : ""};\n\treset : ${itf};\nEND_VAR\nEND_FUNCTION_BLOCK\n\n` +
      [...c.declared].map((p) => unit(p as "A" | "B")).join("\n"),
  }
}

/**
 * A CHAIN of `length` PROGRAMs, each initializing its FB instance's interface input with the next one's instance (pro2193:
 * `LabelSuppliers` → `Magazines` → `XiUnits` → `InjectionMouldingMachine`). `names` "asc": the chain's first reader is named
 * first (`_A` reads `_B` reads `_C` …); "desc": the other way round. Declared and called in name order. `symbol`, when
 * given, is pro2193's symbol-export shape: the PROGRAM `{attribute 'symbol' := '<symbol>'}`, its `Unit` 'readwrite'.
 */
function chain(name: string, feature: string, length: number, names: "asc" | "desc", symbol?: string): LanguageTest {
  const itf = `ITF_LANG_${name}`
  const fbName = `FB_LANG_${name}`
  const letters = "ABCDE".slice(0, length).split("")
  const order = names === "asc" ? letters : [...letters].reverse() // order[0] reads order[1] reads …
  const prg = (l: string): string => `PRG_LANG_${name}_${l}`
  const unit = (l: string): string => {
    const next = order[order.indexOf(l) + 1]
    const init = next === undefined ? "(instanceNo := 1)" : `(instanceNo := 1, reset := ${prg(next)}.Unit)`
    const prgAttr = symbol === undefined ? "" : `{attribute 'symbol' := '${symbol}'}\n`
    const unitAttr = symbol === undefined ? "" : "{attribute 'symbol' := 'readwrite'} "
    return `${prgAttr}PROGRAM ${prg(l)}\nVAR_INPUT\n\t${unitAttr}Unit : ${fbName} := ${init};\nEND_VAR\nUnit();\nEND_PROGRAM\n`
  }
  return {
    name,
    pouName: prg(order[0]!),
    kind: "program",
    feature,
    fromDoc: doc,
    plcPrgVar: "",
    plcPrgBody: letters.map((l) => `${prg(l)}();`).join("\n"),
    source:
      `INTERFACE ${itf}\nEND_INTERFACE\n\n` +
      `FUNCTION_BLOCK ${fbName} IMPLEMENTS ${itf}\nVAR_INPUT\n\tinstanceNo : INT;\n\treset : ${itf};\nEND_VAR\nEND_FUNCTION_BLOCK\n\n` +
      letters.map(unit).join("\n"),
  }
}

export const INIT_ORDER_TESTS: readonly LanguageTest[] = [
  // the name × the declaration order, pro2193's shape (an FB instance's interface input)
  cell("initord_reads_later_name", "a PROGRAM (`_A`) initializing an FB's interface input with a PROGRAM named after it (`_B`)'s instance, declared and called A then B",
    { reader: "A", declared: "AB", called: "AB", shape: "interface-input" }),
  cell("initord_reads_later_name_declared_second", "as `initord_reads_later_name`, the reader declared second",
    { reader: "A", declared: "BA", called: "AB", shape: "interface-input" }),
  cell("initord_reads_earlier_name", "a PROGRAM (`_B`) initializing an FB's interface input with a PROGRAM named before it (`_A`)'s instance, declared and called A then B",
    { reader: "B", declared: "AB", called: "AB", shape: "interface-input" }),
  cell("initord_reads_earlier_name_declared_first", "as `initord_reads_earlier_name`, the reader declared first",
    { reader: "B", declared: "BA", called: "AB", shape: "interface-input" }),
  // the call order
  cell("initord_reads_later_name_called_second", "as `initord_reads_later_name`, PLC_PRG calling the reader second",
    { reader: "A", declared: "AB", called: "BA", shape: "interface-input" }),
  // global_init_slot (the default is 50000; a higher slot initializes later)
  cell("initord_slot_on_reader", "as `initord_reads_later_name`, the reader carrying global_init_slot 50002",
    { reader: "A", declared: "AB", called: "AB", slot: { A: 50002 }, shape: "interface-input" }),
  cell("initord_slot_on_read", "as `initord_reads_earlier_name`, the READ program carrying global_init_slot 50002",
    { reader: "B", declared: "AB", called: "AB", slot: { A: 50002 }, shape: "interface-input" }),
  cell("initord_slot_lower_on_read", "as `initord_reads_later_name`, the read program carrying global_init_slot 49999",
    { reader: "A", declared: "AB", called: "AB", slot: { B: 49999 }, shape: "interface-input" }),
  // the shape
  cell("initord_array_later_name", "pro2193's shape exactly: an ARRAY OF FB initialized `[(reset := _B.Unit[1])]` in `_A`",
    { reader: "A", declared: "AB", called: "AB", shape: "array" }),
  cell("initord_array_earlier_name", "pro2193's shape exactly, the reader named after the read program",
    { reader: "B", declared: "AB", called: "AB", shape: "array" }),
  {
    ...cell("initord_interface_var_later_name", "an interface variable of `_A` initialized with `_B`'s FB instance",
      { reader: "A", declared: "AB", called: "AB", shape: "interface-var" }),
    execSkip: REFUSED_AT_CODE_GENERATION,
  },
  // the read instance's own initialization
  cell("initord_read_uninitialized", "as `initord_reads_later_name`, the read instance initialized by nothing",
    { reader: "A", declared: "AB", called: "AB", shape: "interface-input", readInit: "none" }),
  cell("initord_read_uninitialized_earlier_name", "as `initord_reads_earlier_name`, the read instance initialized by nothing",
    { reader: "B", declared: "AB", called: "AB", shape: "interface-input", readInit: "none" }),
  cell("initord_read_type_default", "as `initord_reads_later_name`, the read instance initialized by its FB type's default only",
    { reader: "A", declared: "AB", called: "AB", shape: "interface-input", readInit: "type-default" }),
  cell("initord_read_type_default_earlier_name", "as `initord_reads_earlier_name`, the read instance initialized by its FB type's default only",
    { reader: "B", declared: "AB", called: "AB", shape: "interface-input", readInit: "type-default" }),
  {
    ...cell("initord_value_later_name", "an INT of `_A` initialized with `_B`'s INT input (5)",
      { reader: "A", declared: "AB", called: "AB", shape: "value" }),
    execSkip: REFUSED_AT_CODE_GENERATION,
  },
  // chains (pro2193's three C0564 are its readers three reads from the end of a chain; its two-read readers are silent)
  chain("initord_chain3_asc", "a chain of 3 PROGRAMs, `_A` reads `_B` reads `_C`", 3, "asc"),
  chain("initord_chain3_desc", "a chain of 3 PROGRAMs, `_C` reads `_B` reads `_A`", 3, "desc"),
  chain("initord_chain4_asc", "a chain of 4 PROGRAMs, `_A` reads `_B` reads `_C` reads `_D`", 4, "asc"),
  chain("initord_chain4_desc", "a chain of 4 PROGRAMs, `_D` reads `_C` reads `_B` reads `_A`", 4, "desc"),
  chain("initord_chain5_asc", "a chain of 5 PROGRAMs, `_A` reads `_B` … reads `_E`", 5, "asc"),
  // pro2193's symbol-export attributes on the chain (its programs say 'none', their `Unit` 'readwrite'), and the 'noe' typo
  // its build reports beside the three C0564
  chain("initord_chain4_symbol_none", "as `initord_chain4_desc`, every PROGRAM `{attribute 'symbol' := 'none'}` and its `Unit` 'readwrite'", 4, "desc", "none"),
  chain("initord_chain4_symbol_noe", "as `initord_chain4_desc`, every PROGRAM `{attribute 'symbol' := 'noe'}` (pro2193's typo) and its `Unit` 'readwrite'", 4, "desc", "noe"),
  // the vendor's own repro (C0564's help page): one PROGRAM, an instance initialized with an instance declared after it
  {
    name: "initord_same_block_later_instance",
    pouName: "PRG_LANG_initord_same_block_later_instance",
    kind: "program",
    feature: "C0564's help-page repro: in one VAR block, an FB instance's interface input initialized with an instance declared after it",
    fromDoc: doc,
    plcPrgVar: "",
    plcPrgBody: "PRG_LANG_initord_same_block_later_instance();",
    source:
      "INTERFACE ITF_LANG_initord_same_block_later_instance\nEND_INTERFACE\n\n" +
      "FUNCTION_BLOCK FB_LANG_initord_same_block_later_instance IMPLEMENTS ITF_LANG_initord_same_block_later_instance\nVAR_INPUT\n\tinstanceNo : INT;\n\treset : ITF_LANG_initord_same_block_later_instance;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" +
      "PROGRAM PRG_LANG_initord_same_block_later_instance\nVAR\n\tinst : FB_LANG_initord_same_block_later_instance := (reset := inst2);\n\tinst2 : FB_LANG_initord_same_block_later_instance := (instanceNo := 1);\nEND_VAR\ninst();\ninst2();\nEND_PROGRAM\n",
  },
]
