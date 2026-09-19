/**
 * THE `__` ATOMIC OPERATORS AND THEIR OPERANDS — what each one actually demands, asked of more than one type.
 *
 * `operand_xadd`, `operand_compare_and_swap` and `operand_test_and_set` each record ONE refusal:
 *
 *   __XADD(aDint, 5)                 Cannot convert type 'DINT' to type 'POINTER TO DINT'
 *   __COMPARE_AND_SWAP(aDint, 1, 2)  Cannot convert type 'DINT' to type 'POINTER TO LWORD'
 *   TEST_AND_SET(aDword)             Cannot convert type 'DWORD' to type 'BOOL'
 *
 * and the three disagree in a way one sample each cannot settle. `__XADD` names a pointer to the type it was GIVEN;
 * `__COMPARE_AND_SWAP` names a FIXED `POINTER TO LWORD` whatever it was given; `TEST_AND_SET` names a plain BOOL.
 * Which of those is the operator's rule and which is a coincidence of the one type each fixture happened to use is
 * exactly the question — implementing from one point would be fitting the message to the sample.
 *
 * So each is asked with several operand types, and with the operand it is supposed to take.
 */
import type { LanguageTest } from "../../types.js"

/** The vendor's verdict where a probe is refused — the pointer types are FIXED, not derived from the operand. */
const REFUSED: Readonly<Record<string, string>> = {
  atomic_bitadr_on_bool: "Operation 'BitAdr' is not possible on type 'BOOL'",
  atomic_bitadr_on_word: "Operation 'BitAdr' is not possible on type 'WORD'",
  atomic_cas_dint: "Cannot convert type 'DINT' to type 'POINTER TO LWORD'",
  atomic_cas_lint: "Cannot convert type 'LINT' to type 'POINTER TO LWORD'",
  atomic_cas_lword: "Cannot convert type 'LWORD' to type 'POINTER TO LWORD'",
  atomic_indexof_variable: "The operator INDEXOF is no longer supported. Use ADR instead. ADR on a POU name returns a pointer to a pointer to the function code.",
  atomic_tas_bool: "Cannot convert type 'DWORD' to type 'BOOL'",
  atomic_tas_byte: "Cannot convert type 'DWORD' to type 'BOOL'",
  atomic_tas_dint: "Cannot convert type 'DWORD' to type 'BOOL'",
  atomic_tas_dword: "Cannot convert type 'DWORD' to type 'BOOL'",
  atomic_xadd_dint: "Cannot convert type 'DINT' to type 'POINTER TO DINT'",
  atomic_xadd_dword: "Cannot convert type 'DWORD' to type 'POINTER TO DINT'",
  atomic_xadd_int: "Cannot convert type 'DINT' to type 'INT'",
  atomic_xadd_lint: "Cannot convert type 'LINT' to type 'POINTER TO DINT'",
  atomic_xadd_lword: "Cannot convert type 'LWORD' to type 'POINTER TO DINT'",
}

function probe(slug: string, decls: string, body: string, feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "08-standard-library.md",
    ...(REFUSED[slug] !== undefined ? { refused: REFUSED[slug]! } : {}),
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** `__XADD` — does the expected pointer follow the OPERAND's type, or is it fixed? */
const xadd: LanguageTest[] = [
  ...["DINT", "LINT", "INT", "DWORD", "LWORD"].map((t) =>
    probe(
      `atomic_xadd_${t.toLowerCase()}`,
      `\tvalue : ${t} := 1;\n\tprevious : ${t};`,
      "previous := __XADD(value, 5);",
      `__XADD given a ${t} by value — which pointer type does the message name?`,
    ),
  ),
  probe(
    "atomic_xadd_pointer",
    "\tvalue : DINT := 1;\n\tp : POINTER TO DINT;\n\tprevious : DINT;",
    "p := ADR(value);\nprevious := __XADD(p, 5);",
    "__XADD given the POINTER it wants — the baseline that must be accepted",
  ),
]

/** `__COMPARE_AND_SWAP` — `POINTER TO LWORD` for every operand type, or the operand's own? */
const cas: LanguageTest[] = [
  ...["DINT", "LINT", "LWORD"].map((t) =>
    probe(
      `atomic_cas_${t.toLowerCase()}`,
      `\tvalue : ${t} := 1;\n\tswapped : BOOL;`,
      "swapped := __COMPARE_AND_SWAP(value, 1, 2);",
      `__COMPARE_AND_SWAP given a ${t} by value`,
    ),
  ),
  probe(
    "atomic_cas_pointer",
    "\tvalue : LWORD := 1;\n\tp : POINTER TO LWORD;\n\tswapped : BOOL;",
    "p := ADR(value);\nswapped := __COMPARE_AND_SWAP(p, 1, 2);",
    "__COMPARE_AND_SWAP given a POINTER TO LWORD — the baseline",
  ),
]

/** `TEST_AND_SET` — a BOOL for every operand type, or something width-dependent? */
const tas: LanguageTest[] = [
  ...["DWORD", "DINT", "BYTE"].map((t) =>
    probe(
      `atomic_tas_${t.toLowerCase()}`,
      `\tflag : ${t};\n\twas : BOOL;`,
      "was := TEST_AND_SET(flag);",
      `TEST_AND_SET given a ${t}`,
    ),
  ),
  probe(
    "atomic_tas_bool",
    "\tflag : BOOL;\n\twas : BOOL;",
    "was := TEST_AND_SET(flag);",
    "TEST_AND_SET given a BOOL — the baseline the message points at",
  ),
]

/** `BITADR` and `INDEXOF`, the two one-offs beside them. */
const others: LanguageTest[] = [
  probe(
    "atomic_bitadr_on_word",
    "\tw : WORD;\n\taddr : DWORD;",
    "addr := BITADR(w);",
    "BITADR of a whole WORD rather than a bit of one",
  ),
  probe(
    "atomic_bitadr_on_bool",
    "\tb : BOOL;\n\taddr : DWORD;",
    "addr := BITADR(b);",
    "BITADR of a BOOL",
  ),
  probe(
    "atomic_indexof_variable",
    "\tn : INT;\n\tidx : DINT;",
    "idx := INDEXOF(n);",
    "INDEXOF of a VARIABLE — SP21 removed the operator, so is the message the same as for a POU name?",
  ),
]

export const ATOMIC_OPERAND_TESTS: readonly LanguageTest[] = [...xadd, ...cas, ...tas, ...others]
