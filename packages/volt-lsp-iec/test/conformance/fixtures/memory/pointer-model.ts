/**
 * Pointer-model measurements — openspec transpile-restructure task 4.1 (design.md §3.3, Measure item 4): the questions the
 * pointer census found no CODESYS answer for, recorded BEFORE §3.3 decides between (a) extended tags, (b) a byte arena and
 * (d) a per-pointer enum. Each answer separates the options: (a) and (d) know only "which target, which element", (b)
 * knows byte addresses. So a recorded byte layout (padding read through a byte pointer, two arrays' distance, the
 * variable behind an array's last element) is what only (b) can reproduce, and a recorded refusal is what all three may
 * refuse alike.
 *
 * Every question sits in an FB, whose instance is one contiguous block laid out in declaration order (measured:
 * `mem_member_offsets`, `mem_sizeof_*`), so an address difference is a property of the declarations and not of where
 * the linker put two PLC_PRG variables. No pointer is dereferenced after a conversion that may have cut it (a DWORD on
 * the 64-bit simulator): a fault wedges the simulated runtime and contaminates every case after it.
 */
import type { LanguageTest } from "../../types.js"
import { POINTER_MODEL_TESTS_A } from "./pointer-model-a.js"
import { POINTER_MODEL_TESTS_B } from "./pointer-model-b.js"

export const POINTER_MODEL_TESTS: readonly LanguageTest[] = [...POINTER_MODEL_TESTS_A, ...POINTER_MODEL_TESTS_B]
