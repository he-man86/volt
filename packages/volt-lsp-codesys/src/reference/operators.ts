/**
 * CODESYS operators. Source: `docs/codesys-reference/03-operators.md`.
 *
 * Covers the 64 named operators (IEC standard + CODESYS extensions).
 * Word-form operator keywords (`AND`, `OR`, `XOR`, `NOT`) live in
 * `keywords.ts` because they're tokenized as keywords by the lexer.
 *
 * Each entry's `details` captures the **non-obvious** behavior — the
 * stuff a competent ST programmer might still get wrong.
 */

import type { ReferenceEntry } from "./index.js";

const SOURCE = {
	url: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_struct_reference_operators.html",
	localFile: "docs/codesys-reference/03-operators.md",
	retrievedAt: "2026-05-26",
};

type OperatorCategory =
	| "arithmetic"
	| "logical"
	| "bitshift"
	| "selection"
	| "comparison"
	| "address"
	| "math"
	| "system"
	| "namespace";

function op(name: string, category: OperatorCategory, oneLiner: string, opts?: {
	details?: string;
	gotchas?: string[];
	examples?: string[];
	/** Vendor tag — defaults to "shared". Override for CODESYS-specific system ops like __POOL. */
	vendor?: "shared" | "codesys" | "twincat";
	equivalentIn?: ReferenceEntry["equivalentIn"];
}): ReferenceEntry {
	return {
		name,
		kind: "operator",
		source: SOURCE,
		vendor: opts?.vendor ?? "shared",
		oneLiner,
		details: opts?.details,
		gotchas: opts?.gotchas,
		examples: opts?.examples,
		...(opts?.equivalentIn !== undefined ? { equivalentIn: opts.equivalentIn } : {}),
	};
}

const ENTRIES: ReferenceEntry[] = [
	// Arithmetic
	op("ADD", "arithmetic", "Addition. `ADD(a, b)` or `a + b`.", {
		gotchas: ["Intermediate values are computed at target's native register width — overflow may not truncate to source type."],
	}),
	op("SUB", "arithmetic", "Subtraction. `SUB(a, b)` or `a - b`."),
	op("MUL", "arithmetic", "Multiplication. `MUL(a, b)` or `a * b`."),
	op("DIV", "arithmetic", "Division. `DIV(a, b)` or `a / b`.", {
		gotchas: ["Integer / integer = integer. `1/10 = 0`. Use `1.0/10` for `0.1`."],
	}),
	op("MOD", "arithmetic", "Integer modulo. `a MOD b`."),
	op("MOVE", "arithmetic", "Assignment in expression form. `MOVE(src, dst)` is equivalent to `dst := src`."),
	op("INDEXOF", "arithmetic", "Returns the index of a POU. `INDEXOF(MyFB)`."),
	op("SIZEOF", "arithmetic", "Returns byte size of a variable or type. `SIZEOF(myVar)`."),
	op("XSIZEOF", "arithmetic", "Extended size operator (CODESYS extension)."),

	// Logical / bitstring — keyword form is in keywords.ts, here we describe usage
	op("AND_THEN", "logical", "Short-circuit AND. Right operand only evaluated if left is TRUE.", {
		gotchas: ["Plain `AND` is NOT short-circuit. Use AND_THEN to guard pointer dereferences."],
		examples: ["IF p <> 0 AND_THEN p^.field > 0 THEN ... END_IF"],
	}),
	op("OR_ELSE", "logical", "Short-circuit OR. Right operand only evaluated if left is FALSE.", {
		gotchas: ["Plain `OR` is NOT short-circuit."],
	}),

	// Bitshift
	op("SHL", "bitshift", "Shift left. `SHL(value, n)`."),
	op("SHR", "bitshift", "Shift right. `SHR(value, n)`."),
	op("ROL", "bitshift", "Rotate left. `ROL(value, n)`."),
	op("ROR", "bitshift", "Rotate right. `ROR(value, n)`."),

	// Selection
	op("SEL", "selection", "Binary select. `SEL(bool, ifFalse, ifTrue)`."),
	op("MAX", "selection", "`MAX(a, b)`."),
	op("MIN", "selection", "`MIN(a, b)`."),
	op("LIMIT", "selection", "`LIMIT(min, value, max)` — clamps."),
	op("MUX", "selection", "Multi-way select. `MUX(idx, v0, v1, v2, ...)`."),

	// Comparison
	op("GT", "comparison", "`a > b` or `GT(a, b)`."),
	op("LT", "comparison", "`a < b` or `LT(a, b)`."),
	op("LE", "comparison", "`a <= b` or `LE(a, b)`."),
	op("GE", "comparison", "`a >= b` or `GE(a, b)`."),
	op("EQ", "comparison", "`a = b` or `EQ(a, b)`. Note: `=` is comparison; `:=` is assignment."),
	op("NE", "comparison", "`a <> b` or `NE(a, b)`."),

	// Address
	op("ADR", "address", "Address of a variable. `ADR(var)` returns a pointer.", {
		gotchas: ["Pointer to an I/O input triggers compiler warning. Copy input to a writable var first."],
	}),
	op("BITADR", "address", "Bit address. `BITADR(bit_var)`."),
	op("CAL", "address", "Call an FB. `CAL <FB>(params)`. ST programmers usually just write `fbInst()`."),

	// Math (IEC standard)
	op("ABS", "math", "Absolute value."),
	op("SQRT", "math", "Square root."),
	op("LN", "math", "Natural logarithm (base e)."),
	op("LOG", "math", "Base-10 logarithm.", {
		gotchas: ["This is a standard IEC operator — naming a user method `LOG` shadows it."],
	}),
	op("EXP", "math", "e raised to the power. `EXP(x)` = e^x."),
	op("EXPT", "math", "Power. `EXPT(base, exp)` = base^exp."),
	op("SIN", "math", "Sine. Argument in radians."),
	op("COS", "math", "Cosine. Argument in radians."),
	op("TAN", "math", "Tangent. Argument in radians."),
	op("ASIN", "math", "Arc sine."),
	op("ACOS", "math", "Arc cosine."),
	op("ATAN", "math", "Arc tangent."),

	// System operators (all __-prefixed; mostly CODESYS-specific).
	// Vendor tags reflect recorded TwinCAT compatibility (2026-05-29 live
	// recording): TC rejects most __-prefixed ops with a parse error; the
	// LSP's TC-incompatible-operator check flags these when activeVendor
	// is "twincat" so users see a red squiggle instead of waiting for the
	// compiler. __ISVALIDREF is the exception — TC accepts it cleanly.
	op("__NEW", "system", "Dynamic FB instantiation. `__NEW(FB_Name)` returns a POINTER TO FB_Name.", {
		// vendor tag intentionally omitted: TC parses __NEW without
		// rejecting (verified by `op_sys_new_delete` recording → TC 0 errors).
		// It's CODESYS-specific in spirit (TC has no runtime to back the
		// dynamic-allocation semantic), but flagging it as syntactically
		// vendor-rejected produces false positives. The `gotchas` text
		// still surfaces in hover so users get the portability heads-up.
		gotchas: [
			"Requires {attribute 'enable_dynamic_creation'} on the FB.",
			"TC parses without errors but lacks the runtime — call has no effect on TwinCAT.",
		],
		equivalentIn: {
			twincat: { name: "(no direct equivalent)", note: "TC programs use static instances or pre-allocated pools" },
		},
	}),
	op("__DELETE", "system", "Dispose a dynamically-allocated FB. `__DELETE(pInst)`.", {
		// See __NEW above — TC parses cleanly, gotcha lives in hover only.
		gotchas: [
			"TC parses without errors but the matching __NEW has no runtime backing.",
		],
		equivalentIn: {
			twincat: { name: "(no direct equivalent)", note: "Pair of __NEW; TC doesn't support either" },
		},
	}),
	op("__ISVALIDREF", "system", "Returns TRUE iff a REFERENCE TO is bound to a valid target.", {
		examples: ["IF __ISVALIDREF(refVar) THEN refVar := newValue; END_IF"],
	}),
	op("__QUERYINTERFACE", "system", "Runtime interface test on an FB instance. `__QUERYINTERFACE(fb, ITF#name)`.", {
		vendor: "codesys",
		equivalentIn: {
			twincat: { name: "(TwinCAT.SystemBase)", note: "TC uses its own runtime-interface primitives" },
		},
	}),
	op("__QUERYPOINTER", "system", "Runtime cast to POINTER TO.", { vendor: "codesys" }),
	op("__TRY", "system", "Begin try block (CODESYS exception handling). Paired with __CATCH/__FINALLY/__ENDTRY.", {
		vendor: "codesys",
		equivalentIn: {
			twincat: { name: "PLC_Exception", note: "TC uses error-flag patterns or PLC_Exception traps" },
		},
	}),
	op("__CATCH", "system", "Catch clause of __TRY.", { vendor: "codesys" }),
	op("__FINALLY", "system", "Cleanup clause of __TRY.", { vendor: "codesys" }),
	op("__ENDTRY", "system", "End of __TRY block.", { vendor: "codesys" }),
	op("__VARINFO", "system", "Compile-time variable metadata access.", { vendor: "codesys" }),
	op("__CURRENTTASK", "system", "Returns a handle to the current IEC task.", {
		vendor: "codesys",
		equivalentIn: {
			twincat: { name: "Tc2_System.GetCurTaskIndex", note: "TC exposes task context via the Tc2_System library" },
		},
	}),
	op("__POSITION", "system", "Source call position. Used by {attribute 'implicit-parameter' := 'position'}.", { vendor: "codesys" }),
	op("__POUNAME", "system", "Qualified caller POU name. Used by {attribute 'implicit-parameter' := 'pouname'}.", { vendor: "codesys" }),
	op("__COMPARE_AND_SWAP", "system", "Atomic compare-and-swap primitive.", { vendor: "codesys" }),
	op("__XADD", "system", "Atomic exchange-and-add.", { vendor: "codesys" }),
	op("__POOL", "system", "Disambiguator: forces lookup in the POUs view (vs Devices view). Use `__POOL.POU()`.", {
		vendor: "codesys",
		equivalentIn: {
			twincat: { name: "(no direct equivalent)", note: "TwinCAT uses namespace qualification or `__SYSTEM.POU` for similar disambiguation" },
		},
	}),
	op("TEST_AND_SET", "system", "Atomic test-and-set."),
	op("INI", "system", "Legacy initialization operator from CoDeSys V2.3.", {
		gotchas: ["DEPRECATED — replaced by FB_Init in V3. Auto-replaced during V2.3 project import."],
	}),

	// Namespace operators
	op("Global namespace", "namespace", "Leading `.` forces global resolution: `.ivar` refers to the global, not a local."),
	op("GVL namespace", "namespace", "`gvl_name.var` disambiguates across GVLs."),
	op("Library namespace", "namespace", "`lib_name.symbol` accesses symbols from a referenced library."),
	op("Enumeration namespace", "namespace", "`EnumType.MemberName` (required when `{attribute 'qualified_only'}` is set)."),
];

export const OPERATORS = new Map<string, ReferenceEntry>(
	ENTRIES.map((e) => [e.name.toLowerCase(), e]),
);
