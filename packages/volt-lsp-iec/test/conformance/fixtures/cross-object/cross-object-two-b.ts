/**
 * the fixtures of `cross-object-two.ts` — part B: a pointer into another object's array, walked by whole elements.
 *
 * One slice of `cross-object-two.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { fb } from "./cross-object-two-shared.js"

export const CROSS_OBJECT_TWO_TESTS_B: readonly LanguageTest[] = [
  // ─── a pointer into another object's array, walked by whole elements ────────
  fb("xo2_pointer_walk_across_objects", "FB_X2_walker", "a POINTER TO a STRUCT from another object, stepped by SIZEOF and written through",
    `TYPE DUT_X2_slot :
STRUCT
	id : INT;
	load : INT;
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_X2_walker
VAR
	slots : ARRAY[0..2] OF DUT_X2_slot;
	cursor : POINTER TO DUT_X2_slot;
	seenId : INT;
END_VAR
cursor := ADR(slots[0]);
cursor^.id := 10;
cursor^.load := 1;
cursor := cursor + SIZEOF(DUT_X2_slot);
cursor^.id := 20;
cursor^.load := 2;
cursor := cursor + SIZEOF(DUT_X2_slot);
cursor^.id := 30;
seenId := cursor^.id;
END_FUNCTION_BLOCK
`,
    "inst : FB_X2_walker;", "inst();"),
  // The same walk with the stride held in a VARIABLE. CODESYS walks it exactly as the inline SIZEOF above. It waited
  // while the transpiler's pointer was an element INDEX (design §9 form 1), which a variable step cannot divide; model 3
  // makes the pointer a byte address (transpile-restructure 4.4), so the variable step lowers as the bytes it is.
  {
    ...fb("xo2_pointer_step_variable", "FB_X2_strider", "a pointer stepped by a VARIABLE holding SIZEOF, not by the constant itself",
      `FUNCTION_BLOCK FB_X2_strider
VAR
	slots : ARRAY[0..2] OF DUT_X2_slot;
	cursor : POINTER TO DUT_X2_slot;
	stride : DINT;
	seenId : INT;
END_VAR
stride := SIZEOF(DUT_X2_slot);
cursor := ADR(slots[0]);
cursor^.id := 10;
cursor := cursor + stride;
cursor^.id := 20;
cursor := cursor + stride;
cursor^.id := 30;
seenId := cursor^.id;
END_FUNCTION_BLOCK
`,
      "inst : FB_X2_strider;", "inst();"),
  },
]
