/**
 * the fixtures of `refusal-kinds.ts` — part B.
 *
 * One slice of `refusal-kinds.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { fb } from "./refusal-kinds-shared.js"

export const CALL_REFUSAL_KIND_TESTS_B: readonly LanguageTest[] = [
  fb("rk_property_set_by_s", "`property-store` (property.ts) — a BOOL PROPERTY written by `S=`",
    `FUNCTION_BLOCK FB_LANG_rk_psbs_lamp
VAR
	on : BOOL;
	sets : INT;
END_VAR
END_FUNCTION_BLOCK

PROPERTY Lit : BOOL
GET
Lit := on;
END_GET
SET
on := Lit;
sets := sets + 1;
END_SET
END_PROPERTY

FUNCTION_BLOCK FB_LANG_rk_property_set_by_s
VAR
	lamp : FB_LANG_rk_psbs_lamp;
	go : BOOL := TRUE;
END_VAR
lamp.Lit S= go;
END_FUNCTION_BLOCK
`),
]
