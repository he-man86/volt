/**
 * How long a declared variable lives — the oracle for three sections the transpiler modelled by guess (review
 * 2026-09-15), recorded BEFORE they are fixed: an FB body's VAR_STAT laid out per instance, an FB's VAR_TEMP refused as
 * unmeasured, and a PROGRAM's VAR_TEMP kept across scans. One question each, each POU called twice per cycle over two
 * cycles, so a value kept per call, per instance or per application reads differently.
 */
import type { LanguageTest } from "../types.js"

const doc = "transpile-st-to-rust review 2026-09-15 — declaration lifetimes"

export const DECLARATION_LIFETIME_TESTS: readonly LanguageTest[] = [
  {
    name: "life_fb_var_stat_instances",
    pouName: "FB_LIFE_stat",
    kind: "function_block",
    feature: "VAR_STAT in an FB body: one variable every instance shares, or one per instance",
    fromDoc: doc,
    source: `FUNCTION_BLOCK FB_LIFE_stat
VAR_STAT
	counter : INT;
END_VAR
VAR
	seen : INT;
END_VAR
counter := counter + 1;
seen := counter;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "first : FB_LIFE_stat; second : FB_LIFE_stat;",
    plcPrgBody: "first();\nsecond();",
    cycles: 2,
  },
  {
    name: "life_fb_var_temp_calls",
    pouName: "FB_LIFE_temp",
    kind: "function_block",
    feature: "VAR_TEMP in an FB: starts over on every call (and at its initial value), or keeps its value",
    fromDoc: doc,
    source: `FUNCTION_BLOCK FB_LIFE_temp
VAR_TEMP
	plain : INT;
	started : INT := 5;
END_VAR
VAR
	seenPlain : INT;
	seenStarted : INT;
END_VAR
plain := plain + 1;
started := started + 1;
seenPlain := plain;
seenStarted := started;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LIFE_temp;",
    plcPrgBody: "inst();\ninst();",
    cycles: 2,
  },
  {
    name: "life_program_var_temp_runs",
    pouName: "PRG_LIFE_temp",
    kind: "program",
    feature: "VAR_TEMP in a PROGRAM: starts over on every run (and at its initial value), or keeps its value",
    fromDoc: doc,
    source: `PROGRAM PRG_LIFE_temp
VAR_TEMP
	plain : INT;
	started : INT := 5;
END_VAR
VAR
	seenPlain : INT;
	seenStarted : INT;
END_VAR
plain := plain + 1;
started := started + 1;
seenPlain := plain;
seenStarted := started;
END_PROGRAM
`,
    plcPrgVar: "progPlain : INT; progStarted : INT;",
    plcPrgBody: "PRG_LIFE_temp();\nPRG_LIFE_temp();\nprogPlain := PRG_LIFE_temp.seenPlain;\nprogStarted := PRG_LIFE_temp.seenStarted;",
    cycles: 2,
  },
]
