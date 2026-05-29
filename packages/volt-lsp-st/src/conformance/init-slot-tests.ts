/**
 * Global init-slot collision conformance tests.
 *
 * Source: 12-global-init-slots.md. The LSP has an `initSlotCollision`
 * check that flags `{attribute 'global_init_slot' := '<N>'}` when N
 * collides with a reserved slot (see the doc's slot table).
 *
 * TC itself rarely warns on slot collisions — it accepts the value
 * silently and uses undefined ordering. The LSP value-add is catching
 * the collision before runtime.
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "./types.js";

export const INIT_SLOT_TESTS: readonly LanguageTest[] = [
	// ========================================================================
	// Category: 12-global-init-slots.md — slot collision detection
	// ========================================================================

	{
		name: "init_slot_default_50000",
		pouName: "FB_LANG_init_slot_default_50000",
		kind: "function_block",
		feature: "global_init_slot at user default (50000) — fine",
		fromDoc: "12-global-init-slots.md#the-full-slot-map",
		expectTcAccepts: true,
		note: "Sanity check: declaring the default user slot explicitly should be a no-op, both TC and LSP clean.",
		plcPrgVar: "fb_d50 : FB_LANG_init_slot_default_50000;",
		plcPrgBody: "fb_d50();",
		source:
`{attribute 'global_init_slot' := '50000'}
FUNCTION_BLOCK FB_LANG_init_slot_default_50000
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "init_slot_reserved_alarm_manager",
		pouName: "FB_LANG_init_slot_reserved_alarm_manager",
		kind: "function_block",
		feature: "global_init_slot at slot 30000 — reserved for Library: Alarm Manager",
		fromDoc: "12-global-init-slots.md#the-full-slot-map",
		expectTcAccepts: true,
		note: "Per docs §3 'slot collisions are allowed' but undefined-ordered. TC accepts silently. LSP initSlotCollision should warn that 30000 is reserved.",
		plcPrgVar: "fb_iram : FB_LANG_init_slot_reserved_alarm_manager;",
		plcPrgBody: "fb_iram();",
		source:
`{attribute 'global_init_slot' := '30000'}
FUNCTION_BLOCK FB_LANG_init_slot_reserved_alarm_manager
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "init_slot_reserved_device_object",
		pouName: "FB_LANG_init_slot_reserved_device_object",
		kind: "function_block",
		feature: "global_init_slot at slot 60000 — reserved for DeviceObject IoConfig_Globals",
		fromDoc: "12-global-init-slots.md#the-full-slot-map",
		expectTcAccepts: true,
		plcPrgVar: "fb_ird : FB_LANG_init_slot_reserved_device_object;",
		plcPrgBody: "fb_ird();",
		source:
`{attribute 'global_init_slot' := '60000'}
FUNCTION_BLOCK FB_LANG_init_slot_reserved_device_object
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "init_slot_user_early",
		pouName: "FB_LANG_init_slot_user_early",
		kind: "function_block",
		feature: "global_init_slot at slot 48000 — user-picked early slot, no reservation",
		fromDoc: "12-global-init-slots.md#the-full-slot-map",
		expectTcAccepts: true,
		note: "Slot 48000 isn't in the reserved table. Both TC and LSP should accept cleanly.",
		plcPrgVar: "fb_iue : FB_LANG_init_slot_user_early;",
		plcPrgBody: "fb_iue();",
		source:
`{attribute 'global_init_slot' := '48000'}
FUNCTION_BLOCK FB_LANG_init_slot_user_early
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},
];
