/**
 * THE EXPLICIT CONVERSIONS NO FIXTURE CALLED — design.md §4 CV7 of openspec `frontend-conformance` (task 4.5.3): one
 * fixture per `X_TO_Y` pair `scripts/conversion-matrix.ts --explicit` listed as called by no recorded fixture on
 * 2026-10-03 (327 of the 600 pairs over the front-end's elementary types). The other 273 have their own fixtures
 * (`conversion.ts`, `cross-family.ts`, `integer-to-*.ts`, `real-to-integer*.ts`, `to-string-format.ts` …).
 *
 * Each cell converts ONE variable holding a known value of its source type and stores the result into a variable of the
 * target type, so the run recording holds the value and the build recording whether the vendor has the function at all
 * (a pair it does not know is refused by name — that refusal is the answer). The values are chosen to show what a
 * conversion does to a sign, a width and a unit: a negative signed integer, an unsigned one past the signed range, a bit
 * string with its high bits set, a REAL with a fraction, a duration of 1 s 500 ms, an instant with every field set. A
 * STRING (WSTRING) source holds the text of a value of the TARGET type — '123', 'TRUE', 'T#1s500ms', 'D#2026-05-09' —
 * since parsing is the question there.
 */
import type { LanguageTest } from "../../types.js"

/** The pairs, by source type: each target the matrix listed as missing for it. */
const MISSING: Readonly<Record<string, string>> = {
  BOOL: "WORD DWORD LWORD SINT DINT LINT USINT UINT UDINT ULINT LREAL TIME LTIME DATE TOD DT LDATE LTOD LDT WSTRING",
  BYTE: "TIME LTIME DATE TOD DT LDATE LTOD LDT WSTRING",
  DATE: "BOOL BYTE WORD DWORD LWORD SINT INT DINT LINT USINT UINT REAL TIME LTIME WSTRING",
  DINT: "BOOL DATE TOD DT LDATE LTOD LDT WSTRING",
  DT: "BOOL BYTE WORD LWORD SINT INT DINT LINT USINT UINT ULINT REAL LREAL TIME LTIME WSTRING",
  DWORD: "BOOL TIME LTIME DATE TOD LDATE LTOD LDT WSTRING",
  INT: "TIME LTIME DATE TOD DT LDATE LTOD LDT WSTRING",
  LDATE: "BOOL BYTE WORD DWORD LWORD SINT INT DINT LINT USINT UINT UDINT REAL LREAL TIME LTIME WSTRING",
  LDT: "BOOL BYTE WORD DWORD LWORD SINT INT DINT LINT USINT UINT UDINT REAL LREAL TIME LTIME WSTRING",
  LINT: "BOOL TIME LTIME DATE TOD DT LDATE LTOD LDT WSTRING",
  LREAL: "BOOL TIME LTIME DATE TOD DT LDATE LTOD LDT WSTRING",
  LTIME: "BOOL BYTE WORD DWORD LWORD SINT INT USINT UINT REAL LREAL DATE TOD DT LDATE LTOD LDT WSTRING",
  LTOD: "BOOL BYTE WORD DWORD LWORD SINT INT DINT LINT USINT UINT UDINT REAL LREAL TIME LTIME WSTRING",
  LWORD: "BOOL TIME LTIME DATE TOD DT LDATE LTOD LDT STRING WSTRING",
  REAL: "LTIME DATE TOD DT LDATE LTOD LDT WSTRING",
  SINT: "BOOL TIME LTIME DATE TOD DT LDATE LTOD LDT STRING WSTRING",
  STRING: "BYTE WORD DWORD LWORD SINT DINT LINT USINT UINT UDINT ULINT LTIME DATE TOD DT LDATE LTOD LDT",
  TIME: "BOOL BYTE WORD SINT USINT LREAL DATE DT LDATE LTOD LDT WSTRING",
  TOD: "BOOL BYTE WORD DWORD LWORD SINT INT DINT LINT USINT UINT ULINT REAL LREAL LTIME WSTRING",
  UDINT: "BOOL TIME LTIME DATE TOD DT LDATE LTOD LDT STRING WSTRING",
  UINT: "BOOL TIME LTIME DATE TOD DT LDATE LTOD LDT WSTRING",
  ULINT: "BOOL TIME LTIME DATE TOD DT LDATE LTOD LDT STRING WSTRING",
  USINT: "BOOL TIME LTIME DATE TOD DT LDATE LTOD LDT STRING WSTRING",
  WORD: "BOOL TIME LTIME DATE TOD DT LDATE LTOD LDT STRING WSTRING",
  WSTRING: "BOOL BYTE WORD DWORD LWORD SINT DINT LINT USINT UINT UDINT ULINT REAL LREAL TIME LTIME DATE TOD DT LDATE LTOD LDT",
}

/** A known value of each source type (its initializer). */
const VALUE: Readonly<Record<string, string>> = {
  BOOL: "TRUE",
  BYTE: "16#A5",
  WORD: "16#F234",
  DWORD: "16#F2345678",
  LWORD: "16#F23456789ABCDEF0",
  SINT: "-5",
  INT: "-1234",
  DINT: "-123456",
  LINT: "-1234567890123",
  USINT: "200",
  UINT: "50000",
  UDINT: "3000000000",
  ULINT: "10000000000000",
  REAL: "12.75",
  LREAL: "-1234.5625",
  TIME: "T#1S500MS",
  LTIME: "LTIME#1S500MS",
  DATE: "D#2026-05-09",
  TOD: "TOD#07:05:03.250",
  DT: "DT#2026-05-09-07:05:03",
  LDATE: "LDATE#2026-05-09",
  LTOD: "LTOD#07:05:03.250",
  LDT: "LDT#2026-05-09-07:05:03",
}

/** The text a STRING source holds for a target: a value of that target, written as its literal. */
const TEXT: Readonly<Record<string, string>> = {
  BOOL: "TRUE",
  REAL: "12.75",
  LREAL: "-1234.5625",
  TIME: "T#1s500ms",
  LTIME: "LTIME#1s500ms",
  DATE: "D#2026-05-09",
  TOD: "TOD#07:05:03.250",
  DT: "DT#2026-05-09-07:05:03",
  LDATE: "LDATE#2026-05-09",
  LTOD: "LTOD#07:05:03.250",
  LDT: "LDT#2026-05-09-07:05:03",
}

function initializer(from: string, to: string): string {
  if (from === "STRING") return `'${TEXT[to] ?? "123"}'`
  if (from === "WSTRING") return `"${TEXT[to] ?? "123"}"`
  const v = VALUE[from]
  if (v === undefined) throw new Error(`explicit-pairs: no value for the source type ${from}`)
  return v
}

function pair(from: string, to: string): LanguageTest {
  const name = `xp_${from.toLowerCase()}_to_${to.toLowerCase()}`
  const pou = `FB_LANG_${name}`
  const v = initializer(from, to)
  return {
    name,
    pouName: pou,
    kind: "function_block",
    feature: `${from}_TO_${to} of ${v}`,
    fromDoc: "frontend-conformance design.md §4 CV7 (explicit conversions); docs/codesys-reference/06-data-types.md",
    plcPrgVar: `inst_${name} : ${pou};`,
    plcPrgBody: `inst_${name}();`,
    source: `FUNCTION_BLOCK ${pou}\nVAR\n\tv : ${from} := ${v};\n\tout : ${to};\nEND_VAR\nout := ${from}_TO_${to}(v);\nEND_FUNCTION_BLOCK\n`,
  }
}

export const EXPLICIT_PAIR_TESTS: readonly LanguageTest[] = Object.entries(MISSING).flatMap(([from, targets]) =>
  targets.split(" ").map((to) => pair(from, to)),
)
