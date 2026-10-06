/**
 * A POINTER STORED INTO WHAT IS NOT A POINTER — openspec `analysis-conformance` task 3.1.1 (types A), the
 * `pointer-conversion` check (C0033, `src/analysis/checks/types/pointer-conversion.ts`) rule by rule, on the targets no
 * fixture had asked: a SIGNED integer at both widths, a REAL, a BOOL, a TIME, a pointer of another base type, and the
 * same store written as a declaration's initializer (the check walks statements only).
 *
 * `ty_pointer_size_twincat` asked the unsigned widths and `cv_pointer_and_pointee` an INT; the census (0.1) measured
 * every C0033 the LSP gives at the other SEVERITY (the fixture project raises it to an error), so these record the
 * severity on each target too.
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`FB_LANG_<name>`): the replay binds every fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec analysis-conformance 3.1.1 (pointer-conversion); docs/codesys-reference C0033"

function fb(name: string, feature: string, vars: string, body: string): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `FUNCTION_BLOCK ${pouName}\nVAR\n\theld : INT := 4;\n\tp : POINTER TO INT;\n${vars}\nEND_VAR\np := ADR(held);\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

export const POINTER_INTO_SCALAR_TESTS: readonly LanguageTest[] = [
  fb("ptrsc_into_dint", "a POINTER TO INT stored into a DINT", "\td : DINT;", "d := p;"),
  fb("ptrsc_into_lint", "a POINTER TO INT stored into a LINT", "\tl : LINT;", "l := p;"),
  fb("ptrsc_into_real", "a POINTER TO INT stored into an LREAL", "\trv : LREAL;", "rv := p;"),
  fb("ptrsc_into_real32", "a POINTER TO INT stored into a REAL", "\trv : REAL;", "rv := p;"),
  fb("ptrsc_into_sint", "a POINTER TO INT stored into a SINT", "\tn : SINT;", "n := p;"),
  fb("ptrsc_into_word", "a POINTER TO INT stored into a WORD and a BYTE", "\tw : WORD;\n\tbv : BYTE;", "w := p;\nbv := p;"),
  fb("ptrsc_into_bool", "a POINTER TO INT stored into a BOOL", "\tb : BOOL;", "b := p;"),
  fb("ptrsc_into_time", "a POINTER TO INT stored into a TIME", "\tt : TIME;", "t := p;"),
  fb("ptrsc_into_other_pointer", "a POINTER TO INT stored into a POINTER TO REAL", "\tpr : POINTER TO REAL;", "pr := p;"),
  // 3.1+3.3 gate review: the elementary targets `pointerIntoElementary` generalized to without a cell, the platform
  // integer, and a REFERENCE bound to a pointer by its declaration
  fb("ptrsc_into_date", "a POINTER TO INT stored into a DATE", "\td : DATE;", "d := p;"),
  fb("ptrsc_into_dt", "a POINTER TO INT stored into a DT", "\tdtv : DT;", "dtv := p;"),
  fb("ptrsc_into_tod", "a POINTER TO INT stored into a TOD", "\ttodv : TOD;", "todv := p;"),
  fb("ptrsc_into_ltime", "a POINTER TO INT stored into an LTIME", "\tltv : LTIME;", "ltv := p;"),
  fb("ptrsc_into_wstring", "a POINTER TO INT stored into a WSTRING", "\tws : WSTRING;", "ws := p;"),
  fb("ptrsc_into_xint", "a POINTER TO INT stored into an __XINT", "\txi : __XINT;", "xi := p;"),
  fb("ptrsc_reference_initializer", "a REFERENCE TO INT declared with a POINTER TO INT as its initial value", "\trf : REFERENCE TO INT := p;", "held := held + 1;"),
  fb("ptrsc_initializer_into_dword", "ADR of a variable as a DWORD variable's initializer", "\tdw : DWORD := ADR(held);", "dw := dw + 1;"),
]
