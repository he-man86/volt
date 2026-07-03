/**
 * IEC 61131-3 standard function blocks — timers, edge detectors,
 * counters, bistables. Shared across CODESYS and TwinCAT (both
 * vendors implement the standard library identically at this
 * surface; vendor-specific extensions live elsewhere).
 *
 * Each entry's `details` field carries the pin signature in
 * `VAR_INPUT` / `VAR_OUTPUT` form so hover renders the canonical
 * call shape — the most useful thing an engineer can see at a
 * glance when they land on `TON` in unfamiliar code.
 *
 * The behavior descriptions are deliberately terse — the standard
 * defines these precisely; engineer-facing docs already render the
 * detail at the vendor links.
 */
import type { ReferenceEntry } from "./index.js";

const SOURCE_CODESYS = {
	url: "https://content.helpme-codesys.com/en/libs/Standard/Current/Standard.html",
	localFile: "docs/codesys-reference/10-standard-fbs.md",
	retrievedAt: "2026-06-05",
};

const ENTRIES: ReferenceEntry[] = [
	// ─── Timers ──────────────────────────────────────────────────────
	{
		name: "TON",
		kind: "standard-fb",
		source: SOURCE_CODESYS,
		vendor: "shared",
		oneLiner: "On-delay timer. Q goes TRUE PT after the rising edge of IN; resets when IN goes FALSE.",
		details:
			"```iec61131\nFUNCTION_BLOCK TON\nVAR_INPUT\n    IN : BOOL;   // start signal\n    PT : TIME;   // preset delay\nEND_VAR\nVAR_OUTPUT\n    Q  : BOOL;   // TRUE once ET reaches PT\n    ET : TIME;   // elapsed time since IN went TRUE\nEND_VAR\n```",
	},
	{
		name: "TOF",
		kind: "standard-fb",
		source: SOURCE_CODESYS,
		vendor: "shared",
		oneLiner: "Off-delay timer. Q drops to FALSE PT after the falling edge of IN; TRUE while IN is TRUE.",
		details:
			"```iec61131\nFUNCTION_BLOCK TOF\nVAR_INPUT\n    IN : BOOL;   // start signal\n    PT : TIME;   // off delay\nEND_VAR\nVAR_OUTPUT\n    Q  : BOOL;   // TRUE while IN, then FALSE PT after IN falls\n    ET : TIME;   // elapsed time since IN went FALSE\nEND_VAR\n```",
	},
	{
		name: "TP",
		kind: "standard-fb",
		source: SOURCE_CODESYS,
		vendor: "shared",
		oneLiner: "Pulse timer. Q stays TRUE for exactly PT after the rising edge of IN; ignores IN during the pulse.",
		details:
			"```iec61131\nFUNCTION_BLOCK TP\nVAR_INPUT\n    IN : BOOL;   // trigger\n    PT : TIME;   // pulse width\nEND_VAR\nVAR_OUTPUT\n    Q  : BOOL;   // TRUE for PT after rising edge of IN\n    ET : TIME;   // elapsed time within the pulse\nEND_VAR\n```",
	},

	// ─── Edge detectors ──────────────────────────────────────────────
	{
		name: "R_TRIG",
		kind: "standard-fb",
		source: SOURCE_CODESYS,
		vendor: "shared",
		oneLiner: "Rising-edge detector. Q is TRUE for exactly one cycle following a low-to-high transition of CLK.",
		details:
			"```iec61131\nFUNCTION_BLOCK R_TRIG\nVAR_INPUT\n    CLK : BOOL;  // signal to watch\nEND_VAR\nVAR_OUTPUT\n    Q   : BOOL;  // one-cycle pulse on rising edge\nEND_VAR\n```",
	},
	{
		name: "F_TRIG",
		kind: "standard-fb",
		source: SOURCE_CODESYS,
		vendor: "shared",
		oneLiner: "Falling-edge detector. Q is TRUE for exactly one cycle following a high-to-low transition of CLK.",
		details:
			"```iec61131\nFUNCTION_BLOCK F_TRIG\nVAR_INPUT\n    CLK : BOOL;  // signal to watch\nEND_VAR\nVAR_OUTPUT\n    Q   : BOOL;  // one-cycle pulse on falling edge\nEND_VAR\n```",
	},

	// ─── Counters ────────────────────────────────────────────────────
	{
		name: "CTU",
		kind: "standard-fb",
		source: SOURCE_CODESYS,
		vendor: "shared",
		oneLiner: "Up-counter. CV increments on rising edge of CU; Q becomes TRUE when CV >= PV; R clears CV to 0.",
		details:
			"```iec61131\nFUNCTION_BLOCK CTU\nVAR_INPUT\n    CU : BOOL;   // count-up trigger (rising edge)\n    R  : BOOL;   // synchronous reset\n    PV : INT;    // preset value\nEND_VAR\nVAR_OUTPUT\n    Q  : BOOL;   // TRUE when CV >= PV\n    CV : INT;    // current count\nEND_VAR\n```",
	},
	{
		name: "CTD",
		kind: "standard-fb",
		source: SOURCE_CODESYS,
		vendor: "shared",
		oneLiner: "Down-counter. CV decrements on rising edge of CD; Q becomes TRUE when CV <= 0; LD loads PV.",
		details:
			"```iec61131\nFUNCTION_BLOCK CTD\nVAR_INPUT\n    CD : BOOL;   // count-down trigger (rising edge)\n    LD : BOOL;   // load (CV := PV)\n    PV : INT;    // preset value loaded by LD\nEND_VAR\nVAR_OUTPUT\n    Q  : BOOL;   // TRUE when CV <= 0\n    CV : INT;    // current count\nEND_VAR\n```",
	},
	{
		name: "CTUD",
		kind: "standard-fb",
		source: SOURCE_CODESYS,
		vendor: "shared",
		oneLiner: "Up/down counter. Combines CTU + CTD; QU = CV >= PV, QD = CV <= 0; R clears, LD loads.",
		details:
			"```iec61131\nFUNCTION_BLOCK CTUD\nVAR_INPUT\n    CU : BOOL;   // count-up trigger\n    CD : BOOL;   // count-down trigger\n    R  : BOOL;   // synchronous reset (CV := 0)\n    LD : BOOL;   // load (CV := PV)\n    PV : INT;    // preset value\nEND_VAR\nVAR_OUTPUT\n    QU : BOOL;   // CV >= PV\n    QD : BOOL;   // CV <= 0\n    CV : INT;    // current count\nEND_VAR\n```",
	},

	// ─── Bistables (set/reset latches) ───────────────────────────────
	{
		name: "SR",
		kind: "standard-fb",
		source: SOURCE_CODESYS,
		vendor: "shared",
		oneLiner: "Set-dominant latch. Q1 follows SET1; RESET clears Q1 only when SET1 is FALSE.",
		details:
			"```iec61131\nFUNCTION_BLOCK SR\nVAR_INPUT\n    SET1  : BOOL;  // dominant set\n    RESET : BOOL;\nEND_VAR\nVAR_OUTPUT\n    Q1    : BOOL;  // SET1 OR (Q1 AND NOT RESET)\nEND_VAR\n```",
	},
	{
		name: "RS",
		kind: "standard-fb",
		source: SOURCE_CODESYS,
		vendor: "shared",
		oneLiner: "Reset-dominant latch. RESET1 dominates SET; Q1 holds previous state when both are FALSE.",
		details:
			"```iec61131\nFUNCTION_BLOCK RS\nVAR_INPUT\n    SET    : BOOL;\n    RESET1 : BOOL;  // dominant reset\nEND_VAR\nVAR_OUTPUT\n    Q1     : BOOL;  // (SET OR Q1) AND NOT RESET1\nEND_VAR\n```",
	},
];

export const STANDARD_FBS = new Map<string, ReferenceEntry>(
	ENTRIES.map((e) => [e.name.toLowerCase(), e]),
);

export const ALL_STANDARD_FBS: readonly ReferenceEntry[] = ENTRIES;
