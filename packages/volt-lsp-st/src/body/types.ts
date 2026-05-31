/**
 * Body-language plug-in interfaces.
 *
 * A POU file has the same TEXT DECLARATION block on top
 * (`FUNCTION_BLOCK X / VAR_INPUT / END_VAR / ...`) regardless of body
 * language. Only the body itself differs:
 *
 *   - `structured-text`  →  ST source code (statements, expressions)
 *   - `plc-fbd`          →  PLCopenXML `<body><FBD>...</FBD></body>`
 *   - `plc-ld`           →  PLCopenXML `<body><LD>...</LD></body>`
 *   - `plc-sfc`          →  PLCopenXML `<body><SFC>...</SFC></body>`
 *   - `plc-cfc`          →  PLCopenXML `<body><CFC>...</CFC></body>`
 *
 * The parser in `src/parser/parser.ts` is language-NEUTRAL — it
 * understands declarations, captures the body as an opaque
 * `BodySpan` of tokens, and returns. Per-body-language analysis
 * happens in this module: a `BodyParser` reads the source slice and
 * produces a `BodyModel` that the rest of the LSP (references,
 * completion, diagnostics, etc.) consumes through the language-
 * neutral fields (`identifiers`, `calls`).
 *
 * BodyModel is a DISCRIMINATED UNION so language-specific data
 * (ST token stream, graphical node/edge graph) lives on the right
 * variant — TypeScript stops consumers from accidentally reading
 * the wrong half.
 *
 * The 80/20 split: every LSP feature that operates on DECLARATIONS
 * (definition, hover, document symbols, type hierarchy, completion
 * of declared names, …) works unchanged for every language. Only
 * BODY-dependent features need the language-specific parser to
 * produce a BodyModel.
 */
import type { Span } from "../lexer/span.js";
import type { BodySpan } from "../parser/ast.js";

// ─── Language-ID source of truth ──────────────────────────────────────
//
// One const array, two derived types. Adding a new body language
// is two edits: add to the array here, register a parser in
// `body/index.ts`. The discriminated union below + every
// `BodyLanguageId`-typed parameter pick up the change automatically.

/** Every body language the LSP recognizes (whether implemented or
 *  not). Must match the VS Code extension's
 *  `contributes.languages[*].id`. Hard-coded literal so it's stable
 *  documentation; the parser registry may register a subset. */
export const BODY_LANGUAGE_IDS = [
	"structured-text",
	"plc-fbd",
	"plc-ld",
	"plc-sfc",
	"plc-cfc",
] as const;

export type BodyLanguageId = (typeof BODY_LANGUAGE_IDS)[number];

/** Subset of body languages that carry a graphical (XML) body.
 *  Used to narrow `BodyModel` to the variant with `.graph`. */
export const GRAPHICAL_LANGUAGE_IDS = ["plc-fbd", "plc-ld", "plc-sfc", "plc-cfc"] as const;
export type GraphicalLanguageId = (typeof GRAPHICAL_LANGUAGE_IDS)[number];

// ─── BodyModel — discriminated union ──────────────────────────────────
//
// `identifiers` and `calls` are LANGUAGE-NEUTRAL — every body parser
// populates them. These power the queries that don't care about
// body shape (references, document-highlight, completion,
// call-hierarchy, unresolved-identifier diagnostic).
//
// `st` (token stream) and `graph` (node/edge graph) are SHAPED — they
// power language-specific diagnostics. Narrow via `languageId`:
//
//   if (model.languageId === "structured-text") {
//     model.st  // BodySpan — token list for ST-grammar checks
//   } else {
//     model.graph  // GraphBody — for FBD/LD/SFC/CFC diagnostics
//   }

export type BodyModel = STBodyModel | GraphicalBodyModel;

/** Common surface every body parser populates. ST and graphical
 *  variants extend this. */
interface BodyModelCommon {
	/** Full body region in source coordinates. */
	span: Span;
	/** Every name occurrence — drives references / highlight /
	 *  completion / unresolved-identifier diagnostic. */
	identifiers: IdentifierRef[];
	/** Subset of `identifiers` where the name is immediately
	 *  invoked. Drives call hierarchy. */
	calls: CallSite[];
}

export interface STBodyModel extends BodyModelCommon {
	languageId: "structured-text";
	/** Raw token stream from the ST lexer. Required for ST-grammar
	 *  diagnostics (assignment-type-mismatch, conversion-source-
	 *  mismatch, etc.) that need to walk statement structure. */
	st: BodySpan;
}

export interface GraphicalBodyModel extends BodyModelCommon {
	languageId: GraphicalLanguageId;
	/** Parsed graph — nodes (blocks, in/outVariables, steps,
	 *  transitions) + connections (data-flow edges) + any parser
	 *  diagnostics. Required for graphical-specific diagnostics
	 *  (unconnected required input, type mismatch on connection,
	 *  dangling block). */
	graph: GraphBody;
}

export interface IdentifierRef {
	name: string;
	span: Span;
	/** True when the next significant token is `(` (ST) OR when this
	 *  ref is the typeName of a `<block>` element (FBD/CFC). */
	isCall: boolean;
	/** True when this ref is preceded by `.` (ST member access) OR
	 *  when the graphical-body parser deduces a qualifier chain from
	 *  an `<expression>` like `fb.method`. */
	isMemberAccess: boolean;
	/** The qualifier chain (`["fb"]` for `fb.method`). Undefined when
	 *  isMemberAccess is false. */
	qualifier?: string[];
}

export interface CallSite {
	name: string;
	span: Span;
	/** Best-effort guess at the target POU name when the call is on
	 *  a member (`fb.method` → "method", but we may know "fb" is of
	 *  type "FB_Foo"). Used by call hierarchy for direction. */
	targetGuess?: string;
}

/** Graphical-only enrichment — populated by FBD/LD/SFC/CFC parsers. */
export interface GraphBody {
	nodes: GraphNode[];
	connections: Connection[];
	/** Errors the parser hit while reading the body XML. Surfaced as
	 *  LSP diagnostics so authors can see "malformed body". */
	parseDiagnostics: BodyParseDiagnostic[];
}

export interface GraphNode {
	/** PLCopenXML `localId` — unique within the body. Connections
	 *  reference these. */
	localId: string;
	kind:
		| "block"
		| "inVariable"
		| "outVariable"
		| "inOutVariable"
		| "label"
		| "jump"
		| "return"
		| "step"
		| "transition"
		| "comment";
	/** Block typeName attribute or step/transition name. */
	typeName?: string;
	/** `<expression>` text inside in/out variables. */
	nameExpression?: string;
	span: Span;
	inputs?: PortRef[];
	outputs?: PortRef[];
}

export interface PortRef {
	formalParameter: string;
	span: Span;
}

export interface Connection {
	fromLocalId: string;
	toLocalId: string;
	/** Target port name when the receiver is a block input. */
	formalParameter?: string;
	span: Span;
}

export interface BodyParseDiagnostic {
	message: string;
	span: Span;
}

/** Inputs every body parser receives. The body region is given as
 *  source offsets so the parser can slice the file itself — keeps
 *  the parser dependency-free from the upstream token stream. */
export interface BodyParseInput {
	source: string;
	bodyRegion: { start: number; end: number };
	/** Present for ST bodies — gives the parser direct access to the
	 *  token stream the lexer already produced, avoiding a re-lex.
	 *  Always undefined for graphical languages. */
	st?: BodySpan;
}

/** Plug-in contract. Each body language ships one implementation. */
export interface BodyParser {
	readonly languageId: BodyLanguageId;
	parse(input: BodyParseInput): BodyModel;
}
