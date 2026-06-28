/**
 * AST for the VG (Volt Graphical) sublanguage — the textual form of an
 * FBD/LD graphical body that lives inside an ST POU where the statement
 * body would otherwise be.
 *
 * Mirrors the bridge's graph model (`Graphical/GraphModel.cs`) and the
 * statement forms in `packages/volt-bridge/docs/vg-language.md` §5/§6,
 * but is span-rich (every node carries a `Span`) because the consumer is
 * a language server, not a transport. Unlike the bridge parser — which
 * THROWS on the first malformed line — this one COLLECTS diagnostics so
 * the editor can surface every problem as you type (§11).
 */
import type { Span } from "../lexer/span.js";
import type { Token } from "../lexer/tokens.js";
import type { VgOperatorSymbol } from "./operators.js";

// ─── Diagnostics ─────────────────────────────────────────────────────

/**
 * Stable VG diagnostic codes. These mirror the bridge gate (§10) so the
 * LSP flags a problem with the SAME code the push would reject it with.
 * `VG_PLCOPEN_DRIFT` is intentionally absent — it needs the PLCopen
 * pipeline and stays a bridge-only push backstop.
 */
export type VgDiagnosticCode =
	| "VG_PARSE"
	| "VG_NETWORK_NOT_CLOSED"
	| "VG_DUPLICATE_NETWORK"
	| "VG_DUPLICATE_NAME"
	| "VG_BAD_EXPRESSION"
	| "VG_UNKNOWN_OPERATOR"
	| "VG_LEAF_REFERENCES_TEMP"
	| "VG_LEAF_FANOUT"
	| "VG_NOT_CANONICAL";

export interface VgDiagnostic {
	code: VgDiagnosticCode;
	message: string;
	span: Span;
}

// ─── Shared leaves ───────────────────────────────────────────────────

export type VgLanguage = "FBD" | "LD";

/** A bare identifier reference with its source span. */
export interface VgName {
	text: string;
	span: Span;
}

/**
 * Operand modifiers — `NOT` (leading), `RISING`/`FALLING` (trailing edge),
 * `SET`/`RESET` (trailing storage). They ride on the CONSUMER (§6). The
 * `tokens` are kept for semantic-token coloring of the modifier words.
 */
export interface VgMods {
	negated: boolean;
	edge?: "rising" | "falling";
	storage?: "set" | "reset";
	tokens: Token[];
}

export function modsAreNone(m: VgMods): boolean {
	return !m.negated && m.edge === undefined && m.storage === undefined;
}

// ─── Expression tree ─────────────────────────────────────────────────

/** A producer-side core expression (the thing a wire carries). */
export type VgCore = VgGroup | VgCall | VgMember | VgLeaf;

/** An operand: `[NOT] core [RISING|FALLING] [SET|RESET]` (§4 grammar). */
export interface VgOperand {
	kind: "operand";
	mods: VgMods;
	core: VgCore;
	span: Span;
}

/** A fully-parenthesised operator group: one operator kind, ≥2 operands (§7). */
export interface VgGroup {
	kind: "group";
	/** Canonical operator symbol, or undefined when the operator was unknown/malformed. */
	op?: VgOperatorSymbol;
	/** The operator tokens (for coloring + the unknown-operator diagnostic). */
	opTokens: Token[];
	operands: VgOperand[];
	span: Span;
}

/** A function call `FN(arg, …)` — positional operand args (no pin names). */
export interface VgCall {
	kind: "call";
	callee: VgName;
	args: VgArg[];
	span: Span;
}

/** An FB-instance output read `inst.Pin` (§6). */
export interface VgMember {
	kind: "member";
	base: VgName;
	member: VgName;
	span: Span;
}

/**
 * A leaf operand — a bare variable/literal, or an opaque inlined ST text
 * (`a + 1`, `NOT x`) that the writer would have named `i*`. `name` is set
 * only for a single-identifier leaf (so navigation can resolve it).
 */
export interface VgLeaf {
	kind: "leaf";
	text: string;
	tokens: Token[];
	isLiteral: boolean;
	name?: VgName;
	span: Span;
}

/** One call argument: positional (`pin` undefined) or `pin := value`. */
export interface VgArg {
	pin?: VgName;
	value: VgOperand;
	span: Span;
}

// ─── Statements ──────────────────────────────────────────────────────

export type VgStatement =
	| VgWireDef
	| VgSink
	| VgFbCall
	| VgEnEnoIf
	| VgLabel
	| VgJump
	| VgReturn
	| VgComment
	| VgUnknownStmt;

/** `LET <name> := <producer>` — a named internal wire (§6). */
export interface VgWireDef {
	kind: "wire_def";
	name: VgName;
	producer: VgOperand;
	/** True when this wire is an EN/ENO enable echo (its name guards an `IF`). */
	isEnBinding: boolean;
	letToken?: Token;
	span: Span;
}

/** `<lvalue> := <operand>` — an outVariable / coil sink (§6). */
export interface VgSink {
	kind: "sink";
	target: VgLValue;
	value: VgOperand;
	span: Span;
}

/** A sink l-value — opaque ST text the bridge does not interpret, but we
 *  keep its identifiers for navigation. */
export interface VgLValue {
	text: string;
	tokens: Token[];
	names: VgName[];
	span: Span;
}

/** `inst(PIN := arg, …)` — a bare FB-instance invocation (§6). */
export interface VgFbCall {
	kind: "fb_call";
	instance: VgName;
	args: VgArg[];
	span: Span;
}

/** `IF en THEN <stmt>; END_IF` — an EN/ENO box (§6). */
export interface VgEnEnoIf {
	kind: "en_eno_if";
	en: VgName;
	/** The gated statement: a sink, a wire def, or an FB call. */
	body: VgStatement;
	span: Span;
}

/** `name:` — a jump target. */
export interface VgLabel {
	kind: "label";
	name: VgName;
	span: Span;
}

/** `JMP name;` or `IF cond THEN JMP name; END_IF`. */
export interface VgJump {
	kind: "jump";
	target: VgName;
	condition?: VgOperand;
	span: Span;
}

/** `RETURN;` or `IF cond THEN RETURN; END_IF`. */
export interface VgReturn {
	kind: "return";
	condition?: VgOperand;
	span: Span;
}

/** `// text` — a network comment. */
export interface VgComment {
	kind: "comment";
	text: string;
	span: Span;
}

/** A statement that did not match any VG form — kept so spans/tokens are
 *  still available; carries an attached diagnostic. */
export interface VgUnknownStmt {
	kind: "unknown_stmt";
	tokens: Token[];
	span: Span;
}

// ─── Networks & body ─────────────────────────────────────────────────

export interface VgNetwork {
	/** The verbatim network index (`NETWORK 3 FBD` → 3); undefined if omitted. */
	index?: number;
	indexToken?: Token;
	/** The body language tag; `string` (not VgLanguage) so an unknown tag round-trips. */
	language: string;
	languageToken?: Token;
	/** The quoted network title, if present. */
	label?: string;
	disabled: boolean;
	comments: VgComment[];
	statements: VgStatement[];
	/** Span of the `NETWORK …` header line. */
	headerSpan: Span;
	/** Span of the whole `NETWORK … END_NETWORK` block. */
	span: Span;
}

export interface VgBody {
	kind: "vg_body";
	networks: VgNetwork[];
	diagnostics: VgDiagnostic[];
	span: Span;
}

/** Re-export so consumers import the symbol type from one place. */
export type { VgOperatorSymbol };
