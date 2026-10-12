/**
 * Data-type conformance tests — DUT shapes (STRUCT / UNION / ENUM /
 * ALIAS / SUBRANGE) and the BIT type.
 *
 * Source: 06-data-types.md.
 *
 * Each entry is a single DUT (`kind: "dut"`) materialized as one
 * kind-named file (every DUT is `.dut`), like every writable source kind. PLC_PRG instantiates the
 * type so TC analyses it (dead code is skipped by the compiler).
 *
 * Same LanguageTest shape as pragmas — see `test/conformance/types.ts` (`LanguageTest`) for field docs.
 */
import type { LanguageTest } from "../../types.js"
import { DATA_TYPE_TESTS_A } from "./data-type-a.js"
import { DATA_TYPE_TESTS_B } from "./data-type-b.js"

export const DATA_TYPE_TESTS: readonly LanguageTest[] = [...DATA_TYPE_TESTS_A, ...DATA_TYPE_TESTS_B]
