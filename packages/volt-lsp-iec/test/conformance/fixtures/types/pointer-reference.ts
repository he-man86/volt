/**
 * POINTERS AND REFERENCES — design.md §4 4.5/4.7 of openspec `frontend-conformance` (CV6, DT12, DT13, DT14; task 4.5.2),
 * the cells no recorded fixture decided.
 *
 *   CV6   an INTEGER into a pointer — every unsigned width, a signed one, the platform word (the other direction is
 *         `ty_pointer_size_twincat`'s)
 *   DT12  POINTER TO / REFERENCE TO against each other and against the pointee: a reference stored into a pointer, a
 *         pointer bound or assigned to a reference, a pointer to another pointee, a pointer to its pointee and back
 *   DT13  pointer arithmetic: POINTER ± integer (either side), POINTER − POINTER, and the forms refused (×, POINTER + POINTER)
 *   DT14  a REFERENCE TO T reads as T (its type named into a STRING, in arithmetic, compared), and REF= to a target of
 *         another type
 *
 * The type-naming probes assign into a STRING, which no pointer, reference or number converts into, so the compiler names
 * the type it arrived at. The value twins (`*_values`) run on CODESYS. No variable is called `r` or `s`: `R` and `S` are IL
 * operators and cannot name one (the first recording, 2026-10-03, refused every cell that tried).
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 4.5/4.7 (pointers and references); docs/codesys-reference/06-data-types.md"

/** A function block `FB_LANG_<name>` with VAR `vars` and body `body`. */
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
    source: `FUNCTION_BLOCK ${pouName}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** Variables `decls` (set by `setup`), and each of `exprs` assigned into an `out<i>` of `outType`. */
function probe(name: string, feature: string, decls: string, setup: string, exprs: readonly string[], outType: string): LanguageTest {
  const vars = exprs.map((_, i) => `\tout${i + 1} : ${outType};`).join("\n")
  const body = exprs.map((e, i) => `out${i + 1} := ${e};`).join("\n")
  return fb(name, feature, `${decls}\n${vars}`, `${setup}${setup === "" ? "" : "\n"}${body}`)
}

// ─── CV6 — an integer into a pointer ───────────────────────────────────────────────────────────────────────────────

const INTEGERS: readonly string[] = ["LWORD", "ULINT", "DWORD", "UDINT", "WORD", "UINT", "LINT", "DINT", "INT", "BYTE"]

const CV6: LanguageTest[] = [
  fb("cv_integers_into_pointer", "CV6 — a variable of every integer width (unsigned, signed, bit string) assigned to a POINTER TO INT",
    `\tp : POINTER TO INT;\n${INTEGERS.map((t) => `\tv_${t.toLowerCase()} : ${t};`).join("\n")}`,
    INTEGERS.map((t) => `p := v_${t.toLowerCase()};`).join("\n")),
  fb("cv_xword_into_pointer", "CV6 — a `__XWORD` and a `__UXINT` assigned to a POINTER TO INT",
    "\tp : POINTER TO INT;\n\txw : __XWORD;\n\tux : __UXINT;", "p := xw;\np := ux;"),
  fb("cv_pointer_through_lword_values", "CV6 — a pointer stored into an LWORD and back, and dereferenced",
    "\tx : INT := 7;\n\tp : POINTER TO INT;\n\tq : POINTER TO INT;\n\tlw : LWORD;\n\tout : INT;\n\tsame : BOOL;",
    "p := ADR(x);\nlw := p;\nq := lw;\nout := q^;\nsame := p = q;"),
]

// ─── DT12 — pointer, reference and pointee ─────────────────────────────────────────────────────────────────────────

const DT12: LanguageTest[] = [
  fb("cv_reference_to_pointer", "DT12 — a REFERENCE TO INT assigned to a POINTER TO INT", "\tx : INT;\n\trf : REFERENCE TO INT;\n\tp : POINTER TO INT;",
    "rf REF= x;\np := rf;"),
  fb("cv_pointer_to_reference", "DT12 — a POINTER TO INT bound to a REFERENCE TO INT with REF=", "\tx : INT;\n\trf : REFERENCE TO INT;\n\tp : POINTER TO INT;",
    "p := ADR(x);\nrf REF= p;"),
  fb("cv_pointer_assigned_to_reference", "DT12 — a POINTER TO INT assigned (:=) to a REFERENCE TO INT", "\tx : INT;\n\ty : INT;\n\trf : REFERENCE TO INT;\n\tp : POINTER TO INT;",
    "rf REF= y;\np := ADR(x);\nrf := p;"),
  fb("cv_pointer_deref_to_reference_values", "DT12 — a reference bound to a dereferenced pointer (`rf REF= p^`), then written through",
    "\tx : INT := 1;\n\trf : REFERENCE TO INT;\n\tp : POINTER TO INT;\n\tout : INT;", "p := ADR(x);\nrf REF= p^;\nrf := 5;\nout := x;"),
  fb("cv_pointer_to_other_pointee", "DT12 — a POINTER TO REAL, a POINTER TO DINT and a POINTER TO BYTE assigned to a POINTER TO INT",
    "\tp : POINTER TO INT;\n\tpr : POINTER TO REAL;\n\tpd : POINTER TO DINT;\n\tpb : POINTER TO BYTE;", "p := pr;\np := pd;\np := pb;"),
  fb("cv_pointer_and_pointee", "DT12 — an INT assigned to a POINTER TO INT, a POINTER TO INT to an INT, and ADR of a REAL to a POINTER TO INT",
    "\tx : INT;\n\trl : REAL;\n\tp : POINTER TO INT;", "p := x;\nx := p;\np := ADR(rl);"),
  fb("cv_reference_to_other_reference", "DT12 — a REFERENCE TO REAL assigned (:=) to a REFERENCE TO INT, and bound with REF=",
    "\tx : INT;\n\ty : REAL;\n\tri : REFERENCE TO INT;\n\trr : REFERENCE TO REAL;", "ri REF= x;\nrr REF= y;\nri := rr;\nri REF= rr;"),
]

// ─── DT13 — pointer arithmetic ─────────────────────────────────────────────────────────────────────────────────────

const ARRAY_POINTERS = "\ta : ARRAY[0..3] OF INT := [10, 20, 30, 40];\n\tp : POINTER TO INT;\n\tq : POINTER TO INT;\n\tn : DINT := 2;"
const ARRAY_SETUP = "p := ADR(a[0]);\nq := ADR(a[2]);"

const DT13: LanguageTest[] = [
  probe("dt_pointer_plus_int", "DT13 — POINTER TO INT plus an untyped literal, plus a DINT, an integer plus the pointer, minus a literal, into STRINGs",
    ARRAY_POINTERS, ARRAY_SETUP, ["p + 2", "p + n", "n + p", "q - 2"], "STRING"),
  probe("dt_pointer_difference", "DT13 — POINTER TO INT minus POINTER TO INT, into STRINGs", ARRAY_POINTERS, ARRAY_SETUP, ["q - p", "p - q"], "STRING"),
  fb("dt_pointer_arithmetic_values", "DT13 — a pointer stepped by bytes (p + 4, q - 2), dereferenced, and the byte difference of two pointers stored into an LWORD and an __XINT",
    `${ARRAY_POINTERS}\n\trf : POINTER TO INT;\n\tv1 : INT;\n\tv2 : INT;\n\tgap : LWORD;\n\tsgap : __XINT;`,
    `${ARRAY_SETUP}\nrf := p + 4;\nv1 := rf^;\nrf := q - 2;\nv2 := rf^;\ngap := q - p;\nsgap := q - p;`),
  fb("dt_pointer_arithmetic_refused", "DT13 — POINTER TO INT times 2, pointer plus pointer, pointer divided by 2, and minus a REAL",
    `${ARRAY_POINTERS}\n\trf : POINTER TO INT;\n\tx : REAL := 1.0;`, `${ARRAY_SETUP}\nrf := p * 2;\nrf := p + q;\nrf := p / 2;\nrf := p - x;`),
]

// ─── DT14 — a reference reads as its target; REF= types ────────────────────────────────────────────────────────────

const REFS = "\tx : INT := 3;\n\ty : REAL := 1.5;\n\tri : REFERENCE TO INT;\n\trr : REFERENCE TO REAL;"
const REF_SETUP = "ri REF= x;\nrr REF= y;"

const DT14: LanguageTest[] = [
  probe("dt_reference_auto_deref_type", "DT14 — a REFERENCE TO INT, plus 1, times a REFERENCE TO REAL, and compared, into STRINGs",
    REFS, REF_SETUP, ["ri", "ri + 1", "ri * rr", "ri = 3", "rr"], "STRING"),
  fb("dt_reference_auto_deref_values", "DT14 — a REFERENCE TO INT read into an INT, plus 1, into a DINT, and a REFERENCE TO REAL into an LREAL",
    `${REFS}\n\tv1 : INT;\n\tv2 : INT;\n\tv3 : DINT;\n\tv4 : LREAL;`, `${REF_SETUP}\nv1 := ri;\nv2 := ri + 1;\nv3 := ri;\nv4 := rr;`),
  fb("dt_reference_into_narrower", "DT14 — a REFERENCE TO INT stored into a SINT and a UINT, a REFERENCE TO REAL into an INT",
    `${REFS}\n\tv1 : SINT;\n\tv2 : UINT;\n\tv3 : INT;`, `${REF_SETUP}\nv1 := ri;\nv2 := ri;\nv3 := rr;`),
  fb("dt_ref_assign_wrong_type", "DT14 — REF= of a REFERENCE TO INT to a REAL, a DINT, a SINT and an INT expression",
    "\tri : REFERENCE TO INT;\n\ty : REAL;\n\td : DINT;\n\tsi : SINT;\n\tx : INT;", "ri REF= y;\nri REF= d;\nri REF= si;\nri REF= x + 1;"),
  fb("dt_ref_assign_struct_mismatch", "DT14 — REF= of a REFERENCE TO an array of INT to an array of another length and to an array of DINT",
    "\trf : REFERENCE TO ARRAY[0..3] OF INT;\n\ta5 : ARRAY[0..4] OF INT;\n\tad : ARRAY[0..3] OF DINT;", "rf REF= a5;\nrf REF= ad;"),
]

export const POINTER_REFERENCE_TESTS: readonly LanguageTest[] = [...CV6, ...DT12, ...DT13, ...DT14]
