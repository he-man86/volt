/**
 * FBD/LD body XML → ST source transpiler.
 *
 * Input:  a PLCopen TC6 v2.01 `<body>…</body>` element containing
 *         `<FBD>` or `<LD>` children, as sent by the bridge.
 * Output: an ST statement block — the textual equivalent of the
 *         graphical body that gets spliced into a `.st` file.
 *
 * Algorithm: reverse value propagation (Beremiz's term). For each
 * network, find every output sink (outVariable, coil, block outputs
 * consumed by an outVariable). Walk backward through connections
 * recursively, building an ST expression in terms of the source
 * inVariables. Emit one assignment per sink.
 *
 * This is a clean-room reimplementation guided by the algorithm
 * documented in Beremiz's `PLCGenerator.py` — code was NOT copied;
 * the structure here is original TypeScript.
 *
 * Determinism is mandatory: same XML input produces byte-identical
 * ST output. No timestamps, no random temp names, sorted iteration
 * where order matters.
 *
 * See `TRANSPILER-RESEARCH.md` for the Phase 0 research that landed
 * here, and `TRANSPILER.md` (Phase 5) for the supported-pattern
 * contract.
 */

// ─── Public types ────────────────────────────────────────────────

export interface TranspileSuccess {
	ok: true;
	/** ST statement block, ending with a newline. Ready to splice
	 *  into the workspace `.st` file between the declaration and
	 *  `END_PROGRAM` / `END_FUNCTION_BLOCK`. */
	st: string;
	/** VAR_TEMP declarations the transpiler synthesized for edge
	 *  contacts and other patterns that need stateful temporaries.
	 *  Empty when none. The caller splices these into a `VAR_TEMP`
	 *  section in the POU declaration. */
	tempDeclarations: string[];
}

export interface TranspileFailure {
	ok: false;
	/** Human-readable reason — surfaced as a pull-time error so
	 *  the user can act (restructure in the IDE, tag the POU, etc.). */
	reason: string;
	/** Body language detected (for the error message). */
	bodyLanguage: "FBD" | "LD" | "unknown";
}

export type TranspileResult = TranspileSuccess | TranspileFailure;

// ─── Public entry ────────────────────────────────────────────────

export function transpileGraphicalBodyToST(bodyXml: string): TranspileResult {
	const language = detectBodyLanguage(bodyXml);
	if (language === "unknown") {
		return {
			ok: false,
			reason: "body element contains neither <FBD> nor <LD>",
			bodyLanguage: "unknown",
		};
	}
	const networks = splitIntoNetworks(bodyXml, language);
	const lines: string[] = [];
	const tempDeclarations: string[] = [];
	for (let i = 0; i < networks.length; i++) {
		const network = networks[i]!;
		const nodes = parseNodes(network.inner);
		if (nodes.length === 0) continue;
		// Structural validation — same checks the IDE itself applies.
		// These fire BEFORE topology walking so error messages name the
		// underlying defect, not whatever symptom downstream code hits.
		const validation = validateNetwork(nodes);
		if (validation !== undefined) {
			return {
				ok: false,
				reason: `network ${i + 1}: ${validation}`,
				bodyLanguage: language,
			};
		}
		const networkResult = transpileNetwork(nodes, language);
		if (!networkResult.ok) {
			return {
				ok: false,
				reason: `network ${i + 1}: ${networkResult.reason}`,
				bodyLanguage: language,
			};
		}
		if (networks.length > 1) {
			const header = network.label !== undefined
				? `(* Network ${i + 1}: ${network.label} *)`
				: `(* Network ${i + 1} *)`;
			lines.push(header);
		}
		for (const line of networkResult.lines) lines.push(line);
		for (const decl of networkResult.tempDeclarations) tempDeclarations.push(decl);
		if (i < networks.length - 1) lines.push("");
	}
	return {
		ok: true,
		st: lines.length === 0 ? "" : `${lines.join("\n")}\n`,
		tempDeclarations,
	};
}

// ─── Structural validation ───────────────────────────────────────

/**
 * Catch shapes the IDE would reject before bothering with topology:
 *
 *   - Duplicate `localId` (the address space `<connection refLocalId=…/>`
 *     resolves against — duplicates make wiring ambiguous)
 *   - Dangling `refLocalId` (connection points at a localId not in the body)
 *   - Jump to a `<label>` that doesn't exist in the same body
 *
 * Returns the failure reason or undefined on clean.
 */
function validateNetwork(nodes: Node[]): string | undefined {
	const seen = new Set<string>();
	for (const n of nodes) {
		if (seen.has(n.localId)) {
			return `duplicate localId '${n.localId}' (each node must be unique)`;
		}
		seen.add(n.localId);
	}
	const byId = new Set(nodes.map((n) => n.localId));
	for (const n of nodes) {
		for (const [port, edge] of n.incoming) {
			if (!byId.has(edge.fromLocalId)) {
				const portHint = port === "" ? "" : ` (port '${port}')`;
				return `dangling connection from localId '${edge.fromLocalId}' to '${n.localId}'${portHint} — no such node in this network`;
			}
		}
	}
	const labels = new Set(
		nodes.filter((n) => n.kind === "label").map((n) => n.expression ?? n.localId),
	);
	for (const n of nodes) {
		if (n.kind === "jump") {
			const target = n.expression;
			if (target === undefined || target.length === 0) {
				return `jump node '${n.localId}' has no target label`;
			}
			if (!labels.has(target)) {
				return `jump to undefined label '${target}'`;
			}
		}
	}
	return undefined;
}

// ─── Internal types ──────────────────────────────────────────────

type BodyLanguage = "FBD" | "LD";

interface RawNetwork {
	inner: string;
	label?: string;
}

type NodeKind =
	| "inVariable"
	| "outVariable"
	| "inOutVariable"
	| "block"
	| "leftPowerRail"
	| "rightPowerRail"
	| "contact"
	| "coil"
	| "label"
	| "jump"
	| "return"
	| "comment";

interface Node {
	localId: string;
	kind: NodeKind;
	/** Block typeName (e.g. "AND", "R_TRIG") or undefined. */
	typeName?: string;
	/** Block instanceName (e.g. "trig") — stateful FBs only. */
	instanceName?: string;
	/** `<expression>` text on in/out variables; `<variable>` text on
	 *  coil/contact (the operand identifier). */
	expression?: string;
	/** LD modifiers on contact/coil. */
	negated?: boolean;
	edge?: "rising" | "falling";
	storage?: "set" | "reset";
	/** Block port → upstream `{localId, formalParameter?}`. Keyed by
	 *  the block's own formalParameter (input port name). For
	 *  variables / contacts / coils / rails: keyed by `""`. */
	incoming: Map<string, Edge>;
	/** Set of port names this node exposes as outputs (block typeName
	 *  outputs). For non-block nodes: `[""]`. */
	outputPorts: string[];
}

interface Edge {
	fromLocalId: string;
	/** Source port name (the upstream block's output formalParameter).
	 *  Undefined for variables / contact-coil wiring. */
	fromPort?: string;
}

// ─── Body-language detection ─────────────────────────────────────

function detectBodyLanguage(bodyXml: string): BodyLanguage | "unknown" {
	if (/<\s*(?:[A-Za-z_][\w.-]*:)?FBD\b/.test(bodyXml)) return "FBD";
	if (/<\s*(?:[A-Za-z_][\w.-]*:)?LD\b/.test(bodyXml)) return "LD";
	return "unknown";
}

// ─── Network splitting ───────────────────────────────────────────

/**
 * Split a body into networks. Two cases:
 *
 *   1. PLCopen-style: explicit `<network>` wrappers (used by TwinCAT
 *      for FBD). One network per `<network>` element. Each network
 *      is self-contained — connections never cross network boundaries.
 *   2. CODESYS-flat (used by CODESYS for both FBD and LD): no
 *      `<network>` wrappers, all elements directly under the
 *      language root. Empty-`<comment>` placeholders MAY separate
 *      logical rungs/networks, but connections (especially in LD)
 *      reference SHARED nodes like power rails across these
 *      placeholders. Treating the placeholder-split as hard network
 *      boundaries creates phantom "dangling connection" errors.
 *
 *      → for CODESYS-flat, treat the whole body as ONE network.
 *        The topological walk emits one statement per output sink
 *        (coil / outVariable). Per-rung `(* Rung N *)` comments are
 *        a future enhancement (requires shared-rail injection per
 *        rung-segment, same pattern the diagram viewer used).
 */
function splitIntoNetworks(bodyXml: string, language: BodyLanguage): RawNetwork[] {
	const root = extractLanguageRoot(bodyXml, language);
	if (root === undefined) return [];
	// Case 1: explicit <network> wrappers. Self-contained, no cross-network refs.
	const networkRe = /<\s*(?:[A-Za-z_][\w.-]*:)?network\b([^>]*)>([\s\S]*?)<\/\s*(?:[A-Za-z_][\w.-]*:)?network\s*>/g;
	const networks: RawNetwork[] = [];
	let m: RegExpExecArray | null;
	while ((m = networkRe.exec(root)) !== null) {
		const attrs = parseAttrs(m[1] ?? "");
		networks.push({ inner: m[2] ?? "", label: attrs.label });
	}
	if (networks.length > 0) return networks;

	// Case 2: CODESYS-flat. One big network. The transpiler's topo walk
	// produces one assignment per output sink (coil / outVariable),
	// preserving the user's logical ordering implicitly.
	return [{ inner: root }];
}

function extractLanguageRoot(bodyXml: string, language: BodyLanguage): string | undefined {
	const re = new RegExp(
		`<\\s*(?:[A-Za-z_][\\w.-]*:)?${language}\\b[^>]*>([\\s\\S]*?)<\\/\\s*(?:[A-Za-z_][\\w.-]*:)?${language}\\s*>`,
	);
	const m = bodyXml.match(re);
	return m?.[1];
}

// ─── Node parsing ────────────────────────────────────────────────

const RENDERABLE_KINDS: readonly NodeKind[] = [
	"inVariable",
	"outVariable",
	"inOutVariable",
	"block",
	"leftPowerRail",
	"rightPowerRail",
	"contact",
	"coil",
	"label",
	"jump",
	"return",
	"comment",
];

function parseNodes(networkInner: string): Node[] {
	const elementRe = new RegExp(
		`<\\s*(?:[A-Za-z_][\\w.-]*:)?(${RENDERABLE_KINDS.join("|")})\\b([^>]*)(?:\\/>|>([\\s\\S]*?)<\\/\\s*(?:[A-Za-z_][\\w.-]*:)?\\1\\s*>)`,
		"g",
	);
	const nodes: Node[] = [];
	let m: RegExpExecArray | null;
	while ((m = elementRe.exec(networkInner)) !== null) {
		const kind = m[1] as NodeKind;
		const attrs = parseAttrs(m[2] ?? "");
		const inner = m[3] ?? "";
		const localId = attrs.localId;
		if (localId === undefined || localId === "") continue;
		nodes.push(buildNode(kind, attrs, inner, localId));
	}
	return nodes;
}

function buildNode(
	kind: NodeKind,
	attrs: Record<string, string>,
	inner: string,
	localId: string,
): Node {
	const expression =
		kind === "inVariable" || kind === "outVariable" || kind === "inOutVariable"
			? extractInnerText(inner, "expression")
			: kind === "contact" || kind === "coil"
				? extractInnerText(inner, "variable")
				: kind === "jump" || kind === "label"
					? attrs.label
					: undefined;
	const negated = attrs.negated === "true" || attrs.negated === "1";
	const edge = attrs.edge === "rising" || attrs.edge === "falling" ? attrs.edge : undefined;
	const storage = attrs.storage === "set" || attrs.storage === "reset" ? attrs.storage : undefined;
	const incoming = collectIncoming(kind, inner);
	const outputPorts = collectOutputPorts(kind, inner);
	return {
		localId,
		kind,
		typeName: attrs.typeName,
		instanceName: attrs.instanceName,
		expression,
		negated: negated || undefined,
		edge,
		storage,
		incoming,
		outputPorts,
	};
}

function extractInnerText(inner: string, tag: string): string | undefined {
	const re = new RegExp(
		`<\\s*(?:[A-Za-z_][\\w.-]*:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/\\s*(?:[A-Za-z_][\\w.-]*:)?${tag}\\s*>`,
	);
	const m = inner.match(re);
	return m?.[1]?.trim();
}

/**
 * Collect incoming edges for a node, keyed by the LOCAL port name.
 * - Block nodes: each `<inputVariables>/<variable formalParameter="X">` has its own connectionPointIn → key "X"
 * - Single-port nodes (variables, contacts, coils, rails): one connectionPointIn → key ""
 *
 * The source port (upstream block's output formalParameter) is read
 * from `<connection formalParameter="...">` when present.
 */
function collectIncoming(kind: NodeKind, inner: string): Map<string, Edge> {
	const result = new Map<string, Edge>();
	if (kind === "block") {
		const variableBlockRe =
			/<\s*(?:[A-Za-z_][\w.-]*:)?variable\b([^>]*)>([\s\S]*?)<\/\s*(?:[A-Za-z_][\w.-]*:)?variable\s*>/g;
		// We need to ONLY look inside <inputVariables>...</inputVariables>
		// (and <inOutVariables>) — not <outputVariables>.
		const inputRegion = extractInnerText(inner, "inputVariables") ?? "";
		const inOutRegion = extractInnerText(inner, "inOutVariables") ?? "";
		const combined = `${inputRegion}\n${inOutRegion}`;
		let m: RegExpExecArray | null;
		variableBlockRe.lastIndex = 0;
		while ((m = variableBlockRe.exec(combined)) !== null) {
			const attrs = parseAttrs(m[1] ?? "");
			const formal = attrs.formalParameter ?? "";
			const cpIn = extractInnerText(m[2] ?? "", "connectionPointIn") ?? "";
			const edge = parseFirstConnection(cpIn);
			if (edge !== undefined) result.set(formal, edge);
		}
		return result;
	}
	// Non-block: single `<connectionPointIn>` directly under the node.
	const cpIn = extractInnerText(inner, "connectionPointIn");
	if (cpIn !== undefined) {
		const edge = parseFirstConnection(cpIn);
		if (edge !== undefined) result.set("", edge);
	}
	return result;
}

function collectOutputPorts(kind: NodeKind, inner: string): string[] {
	if (kind !== "block") return [""];
	const outputRegion = extractInnerText(inner, "outputVariables") ?? "";
	const variableBlockRe =
		/<\s*(?:[A-Za-z_][\w.-]*:)?variable\b([^>]*)>([\s\S]*?)<\/\s*(?:[A-Za-z_][\w.-]*:)?variable\s*>/g;
	const ports: string[] = [];
	let m: RegExpExecArray | null;
	while ((m = variableBlockRe.exec(outputRegion)) !== null) {
		const attrs = parseAttrs(m[1] ?? "");
		const formal = attrs.formalParameter;
		if (formal !== undefined && formal.length > 0) ports.push(formal);
	}
	return ports;
}

function parseFirstConnection(connectionPointInner: string): Edge | undefined {
	const re = /<\s*(?:[A-Za-z_][\w.-]*:)?connection\b([^>]*?)\/?\s*>/;
	const m = connectionPointInner.match(re);
	if (m === null) return undefined;
	const attrs = parseAttrs(m[1] ?? "");
	const fromLocalId = attrs.refLocalId;
	if (fromLocalId === undefined) return undefined;
	return { fromLocalId, fromPort: attrs.formalParameter };
}

// ─── Network transpilation ───────────────────────────────────────

interface NetworkSuccess {
	ok: true;
	lines: string[];
	tempDeclarations: string[];
}

interface NetworkFailure {
	ok: false;
	reason: string;
}

type NetworkResult = NetworkSuccess | NetworkFailure;

function transpileNetwork(nodes: Node[], language: BodyLanguage): NetworkResult {
	const byId = new Map(nodes.map((n) => [n.localId, n]));
	if (language === "LD") return transpileLD(nodes, byId);
	return transpileFBD(nodes, byId);
}

// ─── FBD ─────────────────────────────────────────────────────────

function transpileFBD(nodes: Node[], byId: Map<string, Node>): NetworkResult {
	// Stateful FB instances need an explicit call statement (their
	// state is read via `instance.OUTPUT`). For each block with an
	// `instanceName`, emit one call statement first.
	const lines: string[] = [];
	const renderedCalls = new Set<string>();
	const cycleGuard = new Set<string>();

	const callsForInstances: Node[] = nodes
		.filter((n) => n.kind === "block" && n.instanceName !== undefined && n.instanceName.length > 0)
		.sort((a, b) => a.localId.localeCompare(b.localId));

	for (const block of callsForInstances) {
		const callLine = renderFbInstanceCall(block, byId, cycleGuard);
		if (callLine === undefined) {
			return { ok: false, reason: `cannot transpile FB call '${block.instanceName}'` };
		}
		if (!renderedCalls.has(block.localId)) {
			lines.push(callLine);
			renderedCalls.add(block.localId);
		}
	}

	// Then for each outVariable, render an assignment from its source.
	const outVars = nodes
		.filter((n) => n.kind === "outVariable")
		.sort((a, b) => a.localId.localeCompare(b.localId));
	for (const outVar of outVars) {
		if (outVar.expression === undefined || outVar.expression.length === 0) {
			return { ok: false, reason: `outVariable ${outVar.localId} missing <expression>` };
		}
		const incoming = outVar.incoming.get("");
		if (incoming === undefined) {
			return { ok: false, reason: `outVariable '${outVar.expression}' has no incoming connection` };
		}
		const rhs = expressionForEdge(incoming, byId, cycleGuard);
		if (rhs === undefined) {
			return { ok: false, reason: `cannot resolve source expression for outVariable '${outVar.expression}'` };
		}
		lines.push(`${outVar.expression} := ${rhs};`);
	}

	// Dead-end operator blocks: a block with no outVariable consumer
	// is computed but its result goes nowhere. Common in test fixtures
	// and exploratory FBD bodies. Emit a comment with the computed
	// expression so AI reading the body sees the structure, even
	// though no ST statement executes it.
	const stateless = nodes
		.filter(
			(n) =>
				n.kind === "block" &&
				(n.instanceName === undefined || n.instanceName.length === 0),
		)
		.sort((a, b) => a.localId.localeCompare(b.localId));
	// Find blocks whose output isn't referenced by ANYONE (no other
	// node has an incoming edge from it).
	const consumed = new Set<string>();
	for (const n of nodes) {
		for (const edge of n.incoming.values()) consumed.add(edge.fromLocalId);
	}
	for (const block of stateless) {
		if (consumed.has(block.localId)) continue; // result is used; already emitted via outVar walk above
		const expr = renderOperatorExpression(block, byId, new Set());
		if (expr === undefined) continue; // can't render; skip silently rather than fail
		lines.push(`(* unused: ${expr} *)`);
	}

	return { ok: true, lines, tempDeclarations: [] };
}

function renderFbInstanceCall(
	block: Node,
	byId: Map<string, Node>,
	cycleGuard: Set<string>,
): string | undefined {
	if (block.instanceName === undefined) return undefined;
	const argParts: string[] = [];
	const sortedPorts = [...block.incoming.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	for (const [port, edge] of sortedPorts) {
		if (port === "") continue;
		const expr = expressionForEdge(edge, byId, cycleGuard);
		if (expr === undefined) return undefined;
		argParts.push(`${port} := ${expr}`);
	}
	return `${block.instanceName}(${argParts.join(", ")});`;
}

/**
 * Resolve the ST expression that flows out of the given edge. The
 * edge points to a SOURCE node + optional port; for variables and
 * single-output blocks the port is `""`. For multi-output blocks
 * (stateful FBs) the expression is `instanceName.PORT`.
 *
 * Cycle guard prevents infinite recursion on feedback loops; if we
 * detect one, return undefined → loud failure upstream.
 */
function expressionForEdge(
	edge: Edge,
	byId: Map<string, Node>,
	cycleGuard: Set<string>,
): string | undefined {
	if (cycleGuard.has(edge.fromLocalId)) return undefined;
	const source = byId.get(edge.fromLocalId);
	if (source === undefined) return undefined;
	cycleGuard.add(edge.fromLocalId);
	try {
		if (source.kind === "inVariable" || source.kind === "inOutVariable") {
			return source.expression;
		}
		if (source.kind === "outVariable") {
			return source.expression;
		}
		if (source.kind === "block") {
			if (source.instanceName !== undefined && source.instanceName.length > 0) {
				// Stateful FB output access: instance.PORT
				const port = edge.fromPort ?? source.outputPorts[0];
				if (port === undefined || port.length === 0) return undefined;
				return `${source.instanceName}.${port}`;
			}
			// Stateless operator: render the operator over its inputs.
			return renderOperatorExpression(source, byId, cycleGuard);
		}
		return undefined;
	} finally {
		cycleGuard.delete(edge.fromLocalId);
	}
}

// ─── Operator rendering ─────────────────────────────────────────

/** Operators where the block typeName maps to an INFIX ST operator. */
const INFIX_OPERATORS: Record<string, string> = {
	AND: "AND",
	OR: "OR",
	XOR: "XOR",
	ADD: "+",
	SUB: "-",
	MUL: "*",
	DIV: "/",
	MOD: "MOD",
	GT: ">",
	LT: "<",
	GE: ">=",
	LE: "<=",
	EQ: "=",
	NE: "<>",
};

/** Operators where the block typeName maps to a UNARY ST operator. */
const UNARY_OPERATORS: Record<string, string> = {
	NOT: "NOT",
	NEG: "-",
};

/** Operators that render as ST function calls, not infix. */
const FUNCTION_OPERATORS = new Set<string>([
	"SEL", "MUX", "MIN", "MAX", "LIMIT",
	"SHL", "SHR", "ROL", "ROR",
	"ABS", "SQRT", "LN", "LOG", "EXP",
	"SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN",
]);

/** Operators that are pure visual passthrough in FBD — their single
 *  input flows unchanged to their output. In ST they collapse to the
 *  operand itself (`y := MOVE(x);` → `y := x;`). MOVE is the canonical
 *  one; per IEC 61131-3, MOVE is defined as "same as the assignment
 *  operator". */
const PASSTHROUGH_OPERATORS = new Set<string>(["MOVE"]);

function renderOperatorExpression(
	block: Node,
	byId: Map<string, Node>,
	cycleGuard: Set<string>,
): string | undefined {
	const typeName = block.typeName?.toUpperCase();
	if (typeName === undefined) return undefined;

	// Collect input expressions in port-name-sorted order.
	const ports = [...block.incoming.entries()]
		.filter(([port]) => port !== "")
		.sort((a, b) => a[0].localeCompare(b[0]));
	const operands: string[] = [];
	for (const [, edge] of ports) {
		const expr = expressionForEdge(edge, byId, cycleGuard);
		if (expr === undefined) return undefined;
		operands.push(expr);
	}

	if (PASSTHROUGH_OPERATORS.has(typeName)) {
		if (operands.length === 0) return undefined;
		return operands[0]!;
	}
	if (typeName in UNARY_OPERATORS) {
		if (operands.length === 0) return undefined;
		const op = UNARY_OPERATORS[typeName]!;
		return op === "NOT" ? `NOT ${parenIfComplex(operands[0]!)}` : `${op}${parenIfComplex(operands[0]!)}`;
	}
	if (typeName in INFIX_OPERATORS) {
		if (operands.length < 2) return undefined;
		const op = INFIX_OPERATORS[typeName]!;
		return operands.map(parenIfComplex).join(` ${op} `);
	}
	if (FUNCTION_OPERATORS.has(typeName)) {
		return `${typeName}(${operands.join(", ")})`;
	}
	// Unknown operator: render as a function call. This handles
	// user-defined functions and standard library calls (Beremiz
	// fixtures cover both).
	return `${block.typeName}(${operands.join(", ")})`;
}

function parenIfComplex(expr: string): string {
	// Parenthesize when the expression contains a top-level operator —
	// keeps precedence correct without parsing ST. Simple identifiers,
	// literals, and member accesses don't need parens.
	if (/[\s+\-*/<>=]/.test(expr) && !expr.startsWith("(") && !expr.endsWith(")")) {
		return `(${expr})`;
	}
	return expr;
}

// ─── LD ──────────────────────────────────────────────────────────

interface LdContext {
	byId: Map<string, Node>;
	cycleGuard: Set<string>;
	tempDeclarations: string[];
	/** Block calls (e.g. `r1: R_TRIG; r1(CLK := …);`) emitted as the
	 *  rung walked them. Block-in-rung means the same FB instance may
	 *  feed multiple coils — we render the call once, then read .Q. */
	rungPrelude: string[];
	/** Set of block localIds whose call has been emitted already, so a
	 *  fan-out block doesn't get called twice in the same network. */
	emittedBlockCalls: Set<string>;
}

function transpileLD(nodes: Node[], byId: Map<string, Node>): NetworkResult {
	// LD structure: left rail → series boolean tree → coil. Supported
	// shapes:
	//   - Single contact → coil:                `c := a;`
	//   - Series contacts:                       `c := a AND b;`
	//   - Negated contact:                       `c := NOT a;`
	//   - Edge contact (rising/falling):         synthesizes R_TRIG/F_TRIG temp
	//   - Set/reset coil:                        `IF cond THEN out := TRUE; END_IF;`
	//   - FB block in rung:                      `fb(CLK := …);` + use `fb.Q`
	//
	// Parallel branches (multiple wires converging on a coil) and
	// FB-output-feeds-multiple-coils are post-Phase-2B.

	const coils = nodes.filter((n) => n.kind === "coil");
	if (coils.length === 0) return { ok: true, lines: [], tempDeclarations: [] };

	const lines: string[] = [];
	const ctx: LdContext = {
		byId,
		cycleGuard: new Set(),
		tempDeclarations: [],
		rungPrelude: [],
		emittedBlockCalls: new Set(),
	};
	for (const coil of coils) {
		if (coil.expression === undefined || coil.expression.length === 0) {
			return { ok: false, reason: `coil ${coil.localId} missing <variable>` };
		}
		const incoming = coil.incoming.get("");
		if (incoming === undefined) {
			return { ok: false, reason: `coil '${coil.expression}' has no incoming connection` };
		}
		// Reset the per-rung prelude — each coil's chain emits its own
		// block calls in front of the coil's assignment.
		ctx.rungPrelude = [];
		const condition = ldConditionFromEdge(incoming, ctx);
		if (condition === undefined) {
			return { ok: false, reason: `cannot resolve condition for coil '${coil.expression}'` };
		}
		for (const prelude of ctx.rungPrelude) lines.push(prelude);
		lines.push(formatCoilStatement(coil, condition));
	}
	return { ok: true, lines, tempDeclarations: ctx.tempDeclarations };
}

/**
 * Walk backward from a coil through the contact chain to build the
 * boolean expression. Series chain only (parallel branches deferred).
 */
function ldConditionFromEdge(edge: Edge, ctx: LdContext): string | undefined {
	if (ctx.cycleGuard.has(edge.fromLocalId)) return undefined;
	const source = ctx.byId.get(edge.fromLocalId);
	if (source === undefined) return undefined;
	ctx.cycleGuard.add(edge.fromLocalId);
	try {
		if (source.kind === "leftPowerRail") {
			return "TRUE";
		}
		if (source.kind === "inVariable" || source.kind === "inOutVariable") {
			// Data-flow source feeding a block's non-boolean port (e.g.
			// TON's PT receiving a literal `T#1S`). The walker is shared
			// with the rung-condition path, so an inVariable might also
			// feed a coil — same expression text either way.
			return source.expression;
		}
		if (source.kind === "contact") {
			if (source.expression === undefined || source.expression.length === 0) return undefined;
			const operand = source.expression;
			const upstreamEdge = source.incoming.get("");
			const upstream = upstreamEdge !== undefined
				? ldConditionFromEdge(upstreamEdge, ctx)
				: undefined;
			const contactExpr = renderContactExpression(operand, source, ctx);
			if (contactExpr === undefined) return undefined;
			if (upstream === undefined || upstream === "TRUE") return contactExpr;
			return `${upstream} AND ${contactExpr}`;
		}
		if (source.kind === "block") {
			// FB block in a rung — emit its call statement to the prelude
			// (so it runs before the coil's assignment), then use its
			// designated output port as the boolean condition.
			return ldBlockInRung(source, ctx);
		}
		return undefined;
	} finally {
		ctx.cycleGuard.delete(edge.fromLocalId);
	}
}

/**
 * Block embedded in an LD rung — typical pattern is a stateful FB
 * (TON, R_TRIG, etc.) whose output Q gates the coil. Emit the call
 * statement to the rung prelude; return `<instance>.<outputPort>` as
 * the expression to use in the coil's boolean tree.
 */
function ldBlockInRung(block: Node, ctx: LdContext): string | undefined {
	if (block.instanceName === undefined || block.instanceName.length === 0) {
		return undefined;
	}
	const args: string[] = [];
	const sortedPorts = [...block.incoming.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	for (const [port, edge] of sortedPorts) {
		if (port === "") continue;
		// Recursively resolve the upstream expression for each input
		// port. For a TON in a rung, EN/IN is typically wired from a
		// contact chain or directly from the rail.
		const expr = ldConditionFromEdge(edge, ctx);
		if (expr === undefined) return undefined;
		args.push(`${port} := ${expr}`);
	}
	if (!ctx.emittedBlockCalls.has(block.localId)) {
		ctx.rungPrelude.push(`${block.instanceName}(${args.join(", ")});`);
		ctx.emittedBlockCalls.add(block.localId);
	}
	// The block's "output" in a rung is the primary output port. For
	// standard FBs (R_TRIG/F_TRIG/TON/TOF/CTU/CTD) that's Q; for SR
	// it's Q1. Use the FIRST declared output port, which the XML lists
	// in the order CODESYS/TC emit (matches declaration order).
	const outPort = block.outputPorts[0];
	if (outPort === undefined || outPort.length === 0) return undefined;
	return `${block.instanceName}.${outPort}`;
}

function renderContactExpression(
	operand: string,
	contact: Node,
	ctx: LdContext,
): string | undefined {
	if (contact.edge === "rising" || contact.edge === "falling") {
		// Edge contact in LD synthesizes a hidden R_TRIG / F_TRIG
		// instance keyed by the contact's localId. The instance is
		// declared in VAR_TEMP at the POU level (the transpiler emits
		// the declaration string; the agent splices it into the file).
		const fbType = contact.edge === "rising" ? "R_TRIG" : "F_TRIG";
		const tempName = `_volt_edge_${contact.localId}`;
		const decl = `\t${tempName} : ${fbType};`;
		if (!ctx.tempDeclarations.includes(decl)) {
			ctx.tempDeclarations.push(decl);
		}
		ctx.rungPrelude.push(`${tempName}(CLK := ${operand});`);
		return `${tempName}.Q`;
	}
	if (contact.negated === true) return `NOT ${operand}`;
	return operand;
}

function formatCoilStatement(coil: Node, condition: string): string {
	const operand = coil.expression!;
	if (coil.storage === "set") {
		return `IF ${condition} THEN ${operand} := TRUE; END_IF;`;
	}
	if (coil.storage === "reset") {
		return `IF ${condition} THEN ${operand} := FALSE; END_IF;`;
	}
	if (coil.negated === true) {
		return `${operand} := NOT (${condition});`;
	}
	// Plain coil: `out := condition;`
	return `${operand} := ${condition};`;
}

// ─── XML attr parsing ────────────────────────────────────────────

function parseAttrs(attrsText: string): Record<string, string> {
	const out: Record<string, string> = {};
	const re = /([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(attrsText)) !== null) {
		out[m[1]!] = m[2]!;
	}
	return out;
}

// ─── Pre-processing: vendor-markup strip ─────────────────────────
//
// Vendor extensions (CODESYS `<vendorElement>`, PLCopen `<addData>`) are
// pure metadata per the PLCopen 2.01 spec — they carry visual hints
// and tool-specific attributes, never functional content. Removing them
// before the transpiler walks the body shrinks the search space and
// avoids the transpiler having to know about each vendor's namespace.

function stripVendorMarkup(bodyXml: string): string {
	// Both elements MAY use a namespace prefix (`ns0:vendorElement`,
	// `ns0:addData`). Tolerate any prefix.
	const VENDOR_ELEMENT_RE = /[ \t]*<(?:[A-Za-z_][\w.-]*:)?vendorElement\b[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?vendorElement>\s*\n?/g;
	const ADD_DATA_RE = /[ \t]*<(?:[A-Za-z_][\w.-]*:)?addData\b[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?addData>\s*\n?/g;
	let out = bodyXml.replace(VENDOR_ELEMENT_RE, "");
	out = out.replace(ADD_DATA_RE, "");
	// Collapse the 3+ consecutive blank lines that the strip can leave
	// behind into a single blank line — keeps the XML readable without
	// changing semantics.
	out = out.replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n");
	return out;
}

// ─── High-level materializer ─────────────────────────────────────
//
// One entry point for the materializer to call when a bridge item has
// an `implementationXml`: strip vendor markup, transpile, splice into
// the declaration shell, return the final `.st` content. Throws (with
// a user-actionable message) on transpile or splice failure.

/** Minimal item shape needed to splice transpiled ST into the POU's
 *  declaration. The full bridge `FetchedItem` is a superset. */
export interface MaterializeGraphicalInput {
	name: string;
	sourceText: string;
}

export function materializeGraphicalPouAsST(
	item: MaterializeGraphicalInput,
	bodyXml: string,
): string {
	const cleaned = stripVendorMarkup(bodyXml);
	const transpiled = transpileGraphicalBodyToST(cleaned);
	if (!transpiled.ok) {
		throw new Error(
			`transpile ${item.name}: ${transpiled.reason} — cannot produce ST. ` +
				`Either restructure the body in the IDE so it transpiles, or extend ` +
				`packages/volt-agent/src/engine/transpile-graphical-to-st.ts to handle this pattern.`,
		);
	}
	return spliceTranspiledBody(item.sourceText, transpiled.st, transpiled.tempDeclarations);
}

/** Shape of a graphical child (FBD/LD/SFC/CFC action/method/transition
 *  nested in an otherwise-ST parent) needed by the child materializer. */
export interface MaterializeGraphicalChildInput {
	name: string;
	kind: "action" | "method" | "transition";
	declaration: string;
	implementationXml: string;
}

/**
 * Sibling helper for `materializeGraphicalPouAsST` — same pipeline
 * (strip vendor markup → transpile → wrap in declaration shell) but
 * the shell is `ACTION X / <body> / END_ACTION` (or METHOD/TRANSITION
 * equivalents) instead of a full POU.
 *
 * Throws on transpile failure with the same actionable message shape.
 * Callable for FBD and LD only — CFC and SFC have no transpiler, so
 * the materializer caller routes those through a different path.
 */
export function materializeGraphicalChildAsST(
	child: MaterializeGraphicalChildInput,
): string {
	const cleaned = stripVendorMarkup(child.implementationXml);
	const transpiled = transpileGraphicalBodyToST(cleaned);
	if (!transpiled.ok) {
		throw new Error(
			`transpile ${child.name} (${child.kind}): ${transpiled.reason} — cannot produce ST. ` +
				`Either restructure the body in the IDE so it transpiles, or extend ` +
				`packages/volt-agent/src/engine/transpile-graphical-to-st.ts to handle this pattern.`,
		);
	}
	const endKeyword = `END_${child.kind.toUpperCase()}`;
	const lines: string[] = [];
	// Declaration. ACTIONs and TRANSITIONs are impl-only — the bridge
	// already synthesizes `ACTION <name>` when textual decl is empty;
	// methods carry their real `METHOD <name> ...` signature.
	lines.push(child.declaration.trimEnd());
	if (transpiled.tempDeclarations.length > 0) {
		lines.push("VAR_TEMP");
		for (const decl of transpiled.tempDeclarations) lines.push(`\t${decl}`);
		lines.push("END_VAR");
	}
	if (transpiled.st.length > 0) {
		lines.push(transpiled.st.trimEnd());
	}
	lines.push(endKeyword);
	return lines.join("\n") + "\n";
}

/**
 * Insert transpiled ST + optional VAR_TEMP into the declaration shell.
 * Declaration shell looks like:
 *
 *   PROGRAM X
 *   VAR ... END_VAR
 *                      ← VAR_TEMP spliced here (if any)
 *                      ← transpiled body spliced here
 *   END_PROGRAM
 *
 * Whatever content sits between the last END_VAR and the closing
 * END_PROGRAM in the bridge's sourceText is DROPPED — it's either the
 * Beckhoff bridge's "(graphical language ...)" placeholder, stale ST
 * from a prior pull, or whitespace. Our transpiled body replaces it
 * entirely. Throws if the declaration shape isn't recognized.
 */
function spliceTranspiledBody(
	declaration: string,
	body: string,
	tempDeclarations: readonly string[],
): string {
	// Find the END statement that closes the main POU. Use the FIRST
	// END_PROGRAM/END_FUNCTION_BLOCK/END_FUNCTION at line start (anchored
	// with `m` flag) so we don't accidentally pick up an END_METHOD of
	// a child unit that comes after the parent's closing.
	const endRe = /^END_(?:PROGRAM|FUNCTION_BLOCK|FUNCTION)\b[^\n]*\n?/m;
	const endMatch = declaration.match(endRe);
	if (endMatch === null || endMatch.index === undefined) {
		throw new Error(
			`splice failed: declaration has no END_PROGRAM / END_FUNCTION_BLOCK / END_FUNCTION terminator`,
		);
	}
	// Find the last END_VAR at line start BEFORE the closing END_*.
	// POUs without declared vars (no VAR section at all) are valid —
	// in that case we splice the body right after the POU header line.
	const declarationPrefix = declaration.slice(0, endMatch.index);
	const endVarRe = /^END_VAR\b[^\n]*\n?/gm;
	let lastEndVar: RegExpExecArray | undefined;
	let m: RegExpExecArray | null;
	while ((m = endVarRe.exec(declarationPrefix)) !== null) {
		lastEndVar = m;
	}
	let decUpToHeader: string;
	if (lastEndVar !== undefined && lastEndVar.index !== undefined) {
		decUpToHeader = declarationPrefix
			.slice(0, lastEndVar.index + lastEndVar[0].length)
			.replace(/\s+$/, "");
	} else {
		const headerEnd = declarationPrefix.indexOf("\n");
		decUpToHeader = headerEnd === -1
			? declarationPrefix.replace(/\s+$/, "")
			: declarationPrefix.slice(0, headerEnd);
	}
	const afterEnd = declaration.slice(endMatch.index + endMatch[0].length);
	const endLine = endMatch[0].trim();
	const tempSection = tempDeclarations.length === 0
		? ""
		: `\nVAR_TEMP\n${tempDeclarations.join("\n")}\nEND_VAR\n`;
	const bodyBlock = body.length === 0 ? "" : `\n${body.trim()}\n`;
	const afterBlock = afterEnd.trim().length === 0 ? "" : `\n${afterEnd.trim()}\n`;
	return `${decUpToHeader}\n${tempSection}${bodyBlock}\n${endLine}\n${afterBlock}`;
}
