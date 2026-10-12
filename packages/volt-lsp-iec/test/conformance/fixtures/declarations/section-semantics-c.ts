/**
 * the fixtures of `section-semantics.ts` — part C.
 *
 * One slice of `section-semantics.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"

export const tempScope_C: LanguageTest[] = [
{
    name: "var_temp_named_in_method",
    pouName: "FB_LANG_vtsm",
    kind: "function_block",
    feature: "an FB's VAR_TEMP named in its METHOD — visible there, or not declared?",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtsm
VAR_TEMP
	scratch : INT;
END_VAR
VAR
	seen : INT;
END_VAR
scratch := 5;
Probe();
END_FUNCTION_BLOCK

METHOD Probe
seen := scratch + 1;
END_METHOD
`,
    plcPrgVar: "inst : FB_LANG_vtsm; out : INT;",
    plcPrgBody: "inst(); out := inst.seen;",
  },
  {
    name: "var_temp_named_in_action",
    pouName: "FB_LANG_vtsa",
    kind: "function_block",
    feature: "an FB's VAR_TEMP named in its ACTION — visible there, or not declared?",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtsa
VAR_TEMP
	scratch : INT;
END_VAR
VAR
	seen : INT;
END_VAR
scratch := 5;
Probe();
END_FUNCTION_BLOCK

ACTION Probe
seen := scratch + 1;
END_ACTION
`,
    plcPrgVar: "inst : FB_LANG_vtsa; out : INT;",
    plcPrgBody: "inst(); out := inst.seen;",
    deferred: {
      transpile:
        "2026-10-10 (transpile-restructure 7.6.4): both vendors compile it, and CODESYS runs it to seen = 1 — the ACTION reads 0 where the body stored 5, so it does not reach the body's run's VAR_TEMP; which storage it reads is not modelled, refused `var-temp-outside-body`; niche: accepted loss (0 occurrences in the corpora: no ACTION names its FB's VAR_TEMP)",
    },
  },
  {
    name: "var_temp_named_in_derived_body",
    pouName: "FB_LANG_vtsd",
    kind: "function_block",
    feature: "a base FB's VAR_TEMP named in the derived FB's body — inherited, or not declared?",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtsd_base
VAR_TEMP
	scratch : INT;
END_VAR
VAR
	seen : INT;
END_VAR
scratch := 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_vtsd EXTENDS FB_LANG_vtsd_base
scratch := 5;
seen := scratch + 1;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtsd; out : INT;",
    plcPrgBody: "inst(); out := inst.seen;",
  },
  {
    name: "var_temp_named_through_this",
    pouName: "FB_LANG_vtst",
    kind: "function_block",
    feature: "an FB's VAR_TEMP named as THIS^.scratch in its own body — a member of the instance, or not?",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtst
VAR_TEMP
	scratch : INT;
END_VAR
VAR
	seen : INT;
END_VAR
scratch := 5;
seen := THIS^.scratch + 1;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtst; out : INT;",
    plcPrgBody: "inst(); out := inst.seen;",
    deferred: {
      transpile:
        "2026-10-10 (transpile-restructure 7.6.4): both vendors compile it, and CODESYS runs it to seen = 1 — `THIS^.scratch` reads 0 where the body stored 5 into `scratch`, so the path is no name of the run's VAR_TEMP; which storage it reads is not modelled, refused `var-temp-outside-body`; niche: accepted loss (0 occurrences in the corpora: no `THIS^.` names a VAR_TEMP)",
    },
  },
]
