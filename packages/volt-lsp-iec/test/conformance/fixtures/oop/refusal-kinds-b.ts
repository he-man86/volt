/**
 * the fixtures of `refusal-kinds.ts` — part B.
 *
 * One slice of `refusal-kinds.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { fb } from "./refusal-kinds-shared.js"

export const OOP_REFUSAL_KIND_TESTS_B: readonly LanguageTest[] = [
  fb("rk_interface_bound_to_inout", "`interface-store` (access-guards.ts) — an interface variable bound to a FUNCTION's interface VAR_IN_OUT, called through there",
    `INTERFACE ITF_LANG_rk_ibti
METHOD Id : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_LANG_rk_ibti_impl IMPLEMENTS ITF_LANG_rk_ibti
END_FUNCTION_BLOCK

METHOD Id : INT
Id := 6;
END_METHOD

FUNCTION F_LANG_rk_ibti_read : INT
VAR_IN_OUT
	io : ITF_LANG_rk_ibti;
END_VAR
F_LANG_rk_ibti_read := io.Id();
END_FUNCTION

FUNCTION_BLOCK FB_LANG_rk_interface_bound_to_inout
VAR
	impl : FB_LANG_rk_ibti_impl;
	itf : ITF_LANG_rk_ibti;
	res : INT;
END_VAR
itf := impl;
res := F_LANG_rk_ibti_read(io := itf);
END_FUNCTION_BLOCK
`),
  fb("rk_queryinterface_from_instance", "`interface-query` (query.ts:43) — `__QUERYINTERFACE` whose FIRST operand is an FB instance, not an interface",
    `INTERFACE ITF_LANG_rk_qfi EXTENDS __SYSTEM.IQueryInterface
METHOD Id : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_LANG_rk_qfi_impl IMPLEMENTS ITF_LANG_rk_qfi
END_FUNCTION_BLOCK

METHOD Id : INT
Id := 4;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_queryinterface_from_instance
VAR
	impl : FB_LANG_rk_qfi_impl;
	itf : ITF_LANG_rk_qfi;
	found : BOOL;
	res : INT;
END_VAR
found := __QUERYINTERFACE(impl, itf);
IF found THEN
	res := itf.Id();
END_IF
END_FUNCTION_BLOCK
`),
]
