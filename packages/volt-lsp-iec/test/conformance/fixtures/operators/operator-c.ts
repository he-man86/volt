/**
 * the fixtures of `operator.ts` — part C: CODESYS __-prefixed system operators; HOW DOES THE VENDOR ORDER TWO STRINGS?; THE FUNCTION-CALL SPELLING OF AN OPERATOR.
 *
 * One slice of `operator.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"

export const OPERATOR_TESTS_C: readonly LanguageTest[] = [
  // ─── CODESYS __-prefixed system operators ───────────────────────
  // Each test records TC's actual behavior — these are CODESYS
  // extensions, so TC support is platform-dependent. Some are
  // runtime-system features that TC implements differently or not at
  // all. Catalog encodes recorded reality.

  {
    name: "op_sys_isvalidref",
    pouName: "FB_LANG_op_sys_isvalidref",
    kind: "function_block",
    feature: "__ISVALIDREF — check that a REFERENCE TO is bound to a valid target",
    fromDoc: "03-operators.md",
    plcPrgVar: "fb_ivr : FB_LANG_op_sys_isvalidref;",
    plcPrgBody: "fb_ivr.Check();",
    source: `FUNCTION_BLOCK FB_LANG_op_sys_isvalidref
VAR
	iTarget : INT := 42;
	refTo : REFERENCE TO INT;
	bValid : BOOL;
END_VAR

END_FUNCTION_BLOCK

METHOD Check
refTo REF= iTarget;
bValid := __ISVALIDREF(refTo);
END_METHOD
`,
  },
  {
    name: "op_sys_varinfo",
    pouName: "FB_LANG_op_sys_varinfo",
    kind: "function_block",
    feature: "__VARINFO — CODESYS-only; TC rejects (platform-dependent)",
    fromDoc: "03-operators.md",
    note: "DISCOVERY (verified live 2026-05-29): TC rejects __VARINFO — CODESYS-only system operator. Use TwinCAT's specific introspection facilities instead.",
    plcPrgVar: "fb_vi : FB_LANG_op_sys_varinfo;",
    plcPrgBody: "fb_vi.Inspect();",
    source: `FUNCTION_BLOCK FB_LANG_op_sys_varinfo
VAR
	iValue : INT := 99;
	wSize : UDINT;
END_VAR

END_FUNCTION_BLOCK

METHOD Inspect
wSize := __VARINFO(iValue).size;
END_METHOD
`,
  },
  // BARE `TYPE_CLASS` — the system enum `__VARINFO` answers with, spelled without its `__SYSTEM.` qualifier, as a
  // DECLARED TYPE and as the qualifier of its values. Libraries in the corpus declare `ETYPE : TYPE_CLASS;` so
  // (L_UM1P_DATASENDER) and pro2193's own code compares `TYPE_CLASS.TYPE_SUBRANGE`; whether a project may is asked here
  // (push-without-header-check review: `nameResolves` took the name for granted, the new C0077 check refused it).
  {
    name: "op_sys_type_class_bare",
    pouName: "FB_LANG_op_sys_type_class_bare",
    kind: "function_block",
    feature: "bare TYPE_CLASS (no __SYSTEM.) as a declared type and as its values' qualifier",
    fromDoc: "06-data-types.md",
    plcPrgVar: "fb_tcb : FB_LANG_op_sys_type_class_bare;",
    plcPrgBody: "fb_tcb();",
    source: `FUNCTION_BLOCK FB_LANG_op_sys_type_class_bare
VAR
	eType : TYPE_CLASS;
	bSubrange : BOOL;
END_VAR

bSubrange := eType = TYPE_CLASS.TYPE_SUBRANGE;
END_FUNCTION_BLOCK
`,
  },
  {
    name: "op_sys_currenttask",
    pouName: "FB_LANG_op_sys_currenttask",
    kind: "function_block",
    feature: "__CURRENTTASK — CODESYS-only; TC rejects (platform-dependent)",
    fromDoc: "03-operators.md",
    note: "DISCOVERY (verified live 2026-05-29): TC rejects __CURRENTTASK. TwinCAT exposes task context via TwinCAT.Standard's GetCurTaskIndex() helpers instead.",
    plcPrgVar: "fb_ct : FB_LANG_op_sys_currenttask;",
    plcPrgBody: "fb_ct.Inspect();",
    source: `FUNCTION_BLOCK FB_LANG_op_sys_currenttask
VAR
	pTask : POINTER TO BYTE;
END_VAR

END_FUNCTION_BLOCK

METHOD Inspect
pTask := __CURRENTTASK;
END_METHOD
`,
  },
  {
    name: "op_sys_try_catch",
    pouName: "FB_LANG_op_sys_try_catch",
    kind: "function_block",
    feature: "__TRY / __CATCH / __FINALLY / __ENDTRY — CODESYS-only; TC rejects",
    fromDoc: "03-operators.md",
    note: "DISCOVERY (verified live 2026-05-29): TC rejects structured-exception-handling pragmas. CODESYS-only feature; TC uses simpler error-flag patterns or PLC_Exception traps.",
    plcPrgVar: "fb_tc : FB_LANG_op_sys_try_catch;",
    plcPrgBody: "fb_tc.Guarded();",
    source: `FUNCTION_BLOCK FB_LANG_op_sys_try_catch
VAR
	iValue : INT;
	bCleanup : BOOL;
END_VAR

END_FUNCTION_BLOCK

METHOD Guarded
__TRY
	iValue := 1;
__CATCH(exc)
	iValue := -1;
__FINALLY
	bCleanup := TRUE;
__ENDTRY
END_METHOD
`,
  },
  {
    name: "op_sys_new_delete",
    // The BUILD recording here reports "needs the pragma '{attribute 'enable_dynamic_creation'}'" for a source
    // that HAS that pragma. `newdel_in_method_with_pragma` is the same source recorded through the EXECUTION
    // oracle and is clean, so the attribute line did not survive whatever wrote this one — a stale or mangled
    // recording, not a language fact. The `newdel_*` family measures the rule properly; this stays as the
    // evidence that the two recorders disagree, and is not asked again until the build recorder is re-run.
    recorderSkip: true,
    pouName: "FB_LANG_op_sys_new_delete",
    kind: "function_block",
    feature: "__NEW / __DELETE — dynamic allocation under `{attribute 'enable_dynamic_creation'}`",
    fromDoc: "03-operators.md",
    note: "TC accepts __NEW / __DELETE when the FB carries `{attribute 'enable_dynamic_creation'}`. Without that attribute TC rejects the operators; the attribute is the documented opt-in (CODESYS supports the operators unconditionally, TC requires the explicit opt-in).",
    plcPrgVar: "fb_nd : FB_LANG_op_sys_new_delete;",
    plcPrgBody: "fb_nd.Alloc();",
    source: `{attribute 'enable_dynamic_creation'}
FUNCTION_BLOCK FB_LANG_op_sys_new_delete
VAR
	pInst : POINTER TO FB_LANG_op_sys_new_delete;
END_VAR

END_FUNCTION_BLOCK

METHOD Alloc
pInst := __NEW(FB_LANG_op_sys_new_delete);
IF pInst <> 0 THEN
	__DELETE(pInst);
END_IF
END_METHOD
`,
  },
  {
    name: "op_sys_queryinterface",
    pouName: "FB_LANG_op_sys_queryinterface",
    kind: "function_block",
    feature: "__QUERYINTERFACE — CODESYS-only runtime interface query; TC rejects",
    fromDoc: "03-operators.md",
    note: "DISCOVERY (verified live 2026-05-29): TC rejects __QUERYINTERFACE. CODESYS-only; TC has its own runtime-interface query primitives in TwinCAT.SystemBase.",
    plcPrgVar: "fb_qi : FB_LANG_op_sys_queryinterface;",
    plcPrgBody: "fb_qi.Query();",
    // THE INTERFACE IS DECLARED HERE, and that is the whole point of this edit. It used to name
    // `ITF_LANG_with_method`, which another fixture declares — and `withDependencies` scans a fixture's
    // DECLARATIONS, not its method BODIES, so the interface was never pushed alongside it. Every recording of
    // this fixture therefore said `Unknown type: 'ITF_LANG_with_method'`: it has never measured
    // `__QUERYINTERFACE` at all, on either vendor. Found 2026-09-20 by the cross-fixture check in
    // `scripts/check-recording.ts`.
    source: `INTERFACE ITF_LANG_qi_target

METHOD Ping
END_METHOD

END_INTERFACE

FUNCTION_BLOCK FB_LANG_op_sys_queryinterface IMPLEMENTS ITF_LANG_qi_target
VAR
	bFound : BOOL;
END_VAR

END_FUNCTION_BLOCK

METHOD Ping
END_METHOD

METHOD Query
bFound := __QUERYINTERFACE(THIS^, ITF_LANG_qi_target);
END_METHOD
`,
  },
  // ─── HOW DOES THE VENDOR ORDER TWO STRINGS? ────────────────────────────────────────────────────────
  // MAX/MIN/LIMIT over a STRING lowered, and the interpreter compared the text (`MAX('abc','abd')` = 'abd') while the
  // emitted Rust printed `.max()` on an `IecStr`, which has PartialOrd but not Ord — so that program did not COMPILE
  // (E0599). Both halves were wrong to ship: nothing records what CODESYS orders two strings by, or whether it accepts
  // the call at all. Refused as `value-string-order` until these answered it. `>` and `<` on strings are recorded too,
  // since an order for those and an order for MAX need not be the same thing — and they turned out to agree.
  // ANSWERED 2026-09-19 by `strings/ordering.ts`, which asks the six pairs these four leave open; the refusal and
  // its registry entry are both gone.
  {
    name: "string_max",
    pouName: "FB_LANG_string_max",
    kind: "function_block" as const,
    feature: "MAX over two STRINGs — does it compile, and which one wins?",
    fromDoc: "string-order",
    plcPrgVar: "inst_string_max : FB_LANG_string_max;",
    plcPrgBody: "inst_string_max();",
    source: "FUNCTION_BLOCK FB_LANG_string_max\nVAR\n\ta : STRING := 'abc';\n\tb : STRING := 'abd';\n\tout : STRING;\nEND_VAR\nout := MAX(a, b);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "string_min",
    pouName: "FB_LANG_string_min",
    kind: "function_block" as const,
    feature: "MIN over two STRINGs",
    fromDoc: "string-order",
    plcPrgVar: "inst_string_min : FB_LANG_string_min;",
    plcPrgBody: "inst_string_min();",
    source: "FUNCTION_BLOCK FB_LANG_string_min\nVAR\n\ta : STRING := 'abc';\n\tb : STRING := 'abd';\n\tout : STRING;\nEND_VAR\nout := MIN(a, b);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "string_limit",
    pouName: "FB_LANG_string_limit",
    kind: "function_block" as const,
    feature: "LIMIT over three STRINGs",
    fromDoc: "string-order",
    plcPrgVar: "inst_string_limit : FB_LANG_string_limit;",
    plcPrgBody: "inst_string_limit();",
    source: "FUNCTION_BLOCK FB_LANG_string_limit\nVAR\n\tmn : STRING := 'a';\n\tin_ : STRING := 'b';\n\tmx : STRING := 'c';\n\tout : STRING;\nEND_VAR\nout := LIMIT(mn, in_, mx);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "string_compare_operators",
    pouName: "FB_LANG_string_compare_operators",
    kind: "function_block" as const,
    feature: "the comparison OPERATORS on STRINGs — a different question from MAX",
    fromDoc: "string-order",
    plcPrgVar: "inst_string_compare_operators : FB_LANG_string_compare_operators;",
    plcPrgBody: "inst_string_compare_operators();",
    source: "FUNCTION_BLOCK FB_LANG_string_compare_operators\nVAR\n\ta : STRING := 'abc';\n\tb : STRING := 'abd';\n\tisLess : BOOL;\n\tisGreater : BOOL;\n\tisEqual : BOOL;\n\tshorter : STRING := 'ab';\n\tshortLt : BOOL;\nEND_VAR\nisLess := a < b;\nisGreater := a > b;\nisEqual := a = b;\nshortLt := shorter < a;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "string_max_differing_case",
    pouName: "FB_LANG_string_max_differing_case",
    kind: "function_block" as const,
    feature: "MAX over STRINGs differing only in CASE — is the order case-sensitive?",
    fromDoc: "string-order",
    plcPrgVar: "inst_string_max_differing_case : FB_LANG_string_max_differing_case;",
    plcPrgBody: "inst_string_max_differing_case();",
    source: "FUNCTION_BLOCK FB_LANG_string_max_differing_case\nVAR\n\tupper : STRING := 'ABC';\n\tlower : STRING := 'abc';\n\tout : STRING;\nEND_VAR\nout := MAX(upper, lower);\nEND_FUNCTION_BLOCK\n",
  },
  // ─── THE FUNCTION-CALL SPELLING OF AN OPERATOR ─────────────────────────────────────────────────────
  // `03-operators.md` gives ADD, SUB, MUL, DIV, GT, LT, LE, GE, EQ and NE their own pages: CODESYS accepts `ADD(a, b)`
  // as well as `a + b`. Lowering takes the SYMBOL form only, so every call form is refused as a generic `expr-call`
  // (measured 2026-09-18, all ten). Implementing it is coverage work and out of this change's scope — these record
  // what the vendor answers, so that work has an acceptance test waiting rather than starting from a guess. They also
  // ask the question the symbol form cannot: ADD and MUL are EXTENSIBLE in IEC, so what does `ADD(a, b, c)` do?
  {
    name: "operator_call_form_arithmetic",
    refused: "';' expected instead of 'ADD'",
    pouName: "FB_LANG_operator_call_form_arithmetic",
    kind: "function_block" as const,
    feature: "ADD/SUB/MUL/DIV written as CALLS rather than symbols — accepted, and the same answers?",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_operator_call_form_arithmetic : FB_LANG_operator_call_form_arithmetic;",
    plcPrgBody: "inst_operator_call_form_arithmetic();",
    source: "FUNCTION_BLOCK FB_LANG_operator_call_form_arithmetic\nVAR\n\ta : INT := 12;\n\tb : INT := 4;\n\tadded : INT;\n\tsubbed : INT;\n\tmultiplied : INT;\n\tdivided : INT;\nEND_VAR\nadded := ADD(a, b);\nsubbed := SUB(a, b);\nmultiplied := MUL(a, b);\ndivided := DIV(a, b);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "operator_call_form_extensible",
    refused: "';' expected instead of 'ADD'",
    pouName: "FB_LANG_operator_call_form_extensible",
    kind: "function_block" as const,
    feature: "ADD and MUL are EXTENSIBLE — what does a THIRD argument do?",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_operator_call_form_extensible : FB_LANG_operator_call_form_extensible;",
    plcPrgBody: "inst_operator_call_form_extensible();",
    source: "FUNCTION_BLOCK FB_LANG_operator_call_form_extensible\nVAR\n\ta : INT := 2;\n\tb : INT := 3;\n\tc : INT := 4;\n\tadded3 : INT;\n\tmultiplied3 : INT;\nEND_VAR\nadded3 := ADD(a, b, c);\nmultiplied3 := MUL(a, b, c);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "operator_call_form_comparison",
    refused: "';' expected instead of 'GT'",
    pouName: "FB_LANG_operator_call_form_comparison",
    kind: "function_block" as const,
    feature: "GT/LT/LE/GE/EQ/NE written as CALLS rather than symbols",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_operator_call_form_comparison : FB_LANG_operator_call_form_comparison;",
    plcPrgBody: "inst_operator_call_form_comparison();",
    source: "FUNCTION_BLOCK FB_LANG_operator_call_form_comparison\nVAR\n\ta : INT := 12;\n\tb : INT := 4;\n\tisGreater : BOOL;\n\tisLess : BOOL;\n\tisLessEq : BOOL;\n\tisGreaterEq : BOOL;\n\tisEqual : BOOL;\n\tisNotEqual : BOOL;\nEND_VAR\nisGreater := GT(a, b);\nisLess := LT(a, b);\nisLessEq := LE(a, b);\nisGreaterEq := GE(a, b);\nisEqual := EQ(a, b);\nisNotEqual := NE(a, b);\nEND_FUNCTION_BLOCK\n",
  },
]
