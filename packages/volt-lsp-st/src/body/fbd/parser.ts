/**
 * FBD body parser — reads PLCopenXML `<body><FBD>...</FBD></body>`
 * blocks and produces the normalized `BodyModel`.
 *
 * What the parser extracts (the semantically meaningful subset):
 *   - `<inVariable>` / `<outVariable>` / `<inOutVariable>` with an
 *     `<expression>` child — the expression text is an ST identifier
 *     reference (sometimes member-access like `GVL_Basic.cConst`).
 *     The text is re-lexed through the existing ST lexer so we get
 *     correct qualifier-chain detection for free.
 *   - `<block typeName="X">` — `X` is a call to either a built-in
 *     operator (AND / OR / ADD / GT / ...) or a user-defined POU.
 *     Emitted as an `IdentifierRef` with `isCall=true` AND a
 *     `CallSite` for call-hierarchy.
 *   - `<connection refLocalId="N" formalParameter="P">` — data-flow
 *     edge; populated into `graph.connections` for future P5
 *     diagnostics (unconnected required input, type-mismatch).
 *
 * What it skips (vendor metadata that's noise for analysis):
 *   - `<position>` (layout hints)
 *   - `<vendorElement>` (CODESYS FBD editor preferences)
 *   - `<addData>` (vendor extension blocks with 3s-software.com URIs)
 *   - `<alternativeText>` (UI tooltip XHTML)
 *   - empty containers like `<inOutVariables />`
 *
 * Robust against missing body XML: if the body region has no
 * `<body>` element (empty graphical POU, declaration-only file),
 * returns an empty `BodyModel` rather than throwing.
 */
import { lex } from "../../lexer/lexer.js";
import { spanFromOffsets, type Span } from "../../lexer/span.js";
import type { Token } from "../../lexer/tokens.js";
import type {
	BodyModel,
	BodyParser,
	BodyParseInput,
	CallSite,
	Connection,
	GraphBody,
	GraphNode,
	IdentifierRef,
	PortRef,
	BodyParseDiagnostic,
} from "../types.js";
import { filterChildren, parseXml, walkElements, type XmlNode } from "./xml.js";

export const fbdBodyParser: BodyParser = {
	languageId: "plc-fbd",
	parse(input: BodyParseInput): BodyModel {
		return parseGraphicalBody(input, "FBD");
	},
};

/**
 * Shared graphical-body parser — used by FBD today, and reused by
 * LD / SFC / CFC in P4. Those languages share the FBD vocabulary
 * for `<inVariable>` / `<outVariable>` / `<block>` / `<connection>`
 * per PLCopenXML XSD; only the root element name differs (`<LD>`,
 * `<SFC>`, `<CFC>`). Language-specific elements (LD's
 * `<contact>`/`<coil>`, SFC's `<step>`/`<transition>`) need
 * post-processing in their own parser — this function handles only
 * the shared core.
 *
 * Exported (not just used by `fbdBodyParser`) so the LD/SFC/CFC
 * parsers in P4 can call it with their own root tag name.
 */
export function parseGraphicalBody(
	input: BodyParseInput,
	rootTag: "FBD" | "LD" | "SFC" | "CFC",
): BodyModel {
	const { source, bodyRegion } = input;
	const span = spanFromOffsets(source, bodyRegion.start, bodyRegion.end);
	const parseDiagnostics: BodyParseDiagnostic[] = [];
	const identifiers: IdentifierRef[] = [];
	const calls: CallSite[] = [];
	const nodes: GraphNode[] = [];
	const connections: Connection[] = [];

	const xml = parseXml(source, bodyRegion.start, bodyRegion.end);
	for (const err of xml.errors) {
		parseDiagnostics.push({
			message: `body XML: ${err.message}`,
			span: spanFromOffsets(source, err.offset, err.offset + 1),
		});
	}

	if (xml.root !== undefined) {
		const bodyNode = xml.root.tag === "body" ? xml.root : findElement(xml.root, "body");
		const langNode =
			bodyNode === undefined ? undefined : findElement(bodyNode, rootTag);
		if (langNode !== undefined) {
			walkBody(source, langNode, {
				identifiers,
				calls,
				nodes,
				connections,
				parseDiagnostics,
			});
		}
	}

	const graph: GraphBody = { nodes, connections, parseDiagnostics };
	const languageId =
		rootTag === "FBD" ? "plc-fbd" :
		rootTag === "LD" ? "plc-ld" :
		rootTag === "SFC" ? "plc-sfc" :
		"plc-cfc";
	return { languageId, span, identifiers, calls, graph };
}

interface WalkAccum {
	identifiers: IdentifierRef[];
	calls: CallSite[];
	nodes: GraphNode[];
	connections: Connection[];
	parseDiagnostics: BodyParseDiagnostic[];
}

function walkBody(source: string, langNode: XmlNode, acc: WalkAccum): void {
	for (const child of langNode.children) {
		switch (child.tag) {
			case "inVariable":
				handleVarNode(source, child, "inVariable", acc);
				break;
			case "outVariable":
				handleVarNode(source, child, "outVariable", acc);
				break;
			case "inOutVariable":
				handleVarNode(source, child, "inOutVariable", acc);
				break;
			case "block":
				handleBlockNode(source, child, acc);
				break;
			case "label":
			case "jump":
			case "return":
			case "comment":
				// Structural — record so the future viewer can render,
				// but no semantic identifier extraction needed.
				acc.nodes.push(makeStructuralNode(source, child));
				break;
			// Vendor metadata — explicitly skipped:
			case "vendorElement":
			case "addData":
			case "alternativeText":
				break;
			default:
				// Unknown element — record nothing, swallow silently.
				// Real FBD bodies have a stable element vocabulary; if
				// new ones appear, surface them as parse diagnostics
				// rather than spamming identifier refs.
				break;
		}
	}
}

function handleVarNode(
	source: string,
	node: XmlNode,
	kind: GraphNode["kind"],
	acc: WalkAccum,
): void {
	const localId = node.attrs.localId ?? "";
	const expression = findElement(node, "expression");
	const exprText = expression?.text ?? "";
	const exprOffset = expression?.textSpan?.start;
	const exprSpan = expression?.textSpan;

	if (exprText.length > 0 && exprOffset !== undefined && exprSpan !== undefined) {
		extractIdentifiersFromExpression(source, exprText, exprOffset, acc.identifiers);
	}

	acc.nodes.push({
		localId,
		kind,
		nameExpression: exprText,
		span: spanFromOffsets(source, node.span.start, node.span.end),
	});

	// inVariable / outVariable can also be a connection sink/source.
	collectConnectionsFromVar(source, node, localId, acc.connections);
}

function handleBlockNode(source: string, node: XmlNode, acc: WalkAccum): void {
	const localId = node.attrs.localId ?? "";
	const typeName = node.attrs.typeName;
	if (typeName !== undefined && typeName.length > 0) {
		// The typeName attribute is the call target. Locate its
		// offset inside the `<block typeName="X">` so the LSP can
		// jump to the called POU.
		const typeNameSpan = findAttrValueSpan(source, node, "typeName");
		if (typeNameSpan !== undefined) {
			acc.identifiers.push({
				name: typeName,
				span: typeNameSpan,
				isCall: true,
				isMemberAccess: false,
			});
			acc.calls.push({ name: typeName, span: typeNameSpan });
		}
	}

	const inputs: PortRef[] = [];
	const outputs: PortRef[] = [];

	const inputVars = findElement(node, "inputVariables");
	if (inputVars !== undefined) {
		for (const v of filterChildren(inputVars, "variable")) {
			const formal = v.attrs.formalParameter ?? "";
			inputs.push({
				formalParameter: formal,
				span: spanFromOffsets(source, v.span.start, v.span.end),
			});
			collectConnectionsFromPort(source, v, localId, formal, acc.connections);
		}
	}
	const outputVars = findElement(node, "outputVariables");
	if (outputVars !== undefined) {
		for (const v of filterChildren(outputVars, "variable")) {
			const formal = v.attrs.formalParameter ?? "";
			outputs.push({
				formalParameter: formal,
				span: spanFromOffsets(source, v.span.start, v.span.end),
			});
		}
	}

	acc.nodes.push({
		localId,
		kind: "block",
		typeName,
		span: spanFromOffsets(source, node.span.start, node.span.end),
		inputs,
		outputs,
	});
}

function makeStructuralNode(source: string, node: XmlNode): GraphNode {
	return {
		localId: node.attrs.localId ?? "",
		kind: node.tag as GraphNode["kind"],
		span: spanFromOffsets(source, node.span.start, node.span.end),
	};
}

/** Walk `<connectionPointIn>` children for `<connection refLocalId="N">`
 *  edges and record them. Used both for variable nodes and block ports. */
function collectConnectionsFromVar(
	source: string,
	node: XmlNode,
	toLocalId: string,
	connections: Connection[],
): void {
	const cpIn = findElement(node, "connectionPointIn");
	if (cpIn === undefined) return;
	for (const conn of filterChildren(cpIn, "connection")) {
		pushConnection(source, conn, toLocalId, undefined, connections);
	}
}
function collectConnectionsFromPort(
	source: string,
	variable: XmlNode,
	toLocalId: string,
	formalParameter: string,
	connections: Connection[],
): void {
	const cpIn = findElement(variable, "connectionPointIn");
	if (cpIn === undefined) return;
	for (const conn of filterChildren(cpIn, "connection")) {
		pushConnection(source, conn, toLocalId, formalParameter, connections);
	}
}
function pushConnection(
	source: string,
	conn: XmlNode,
	toLocalId: string,
	formalParameter: string | undefined,
	connections: Connection[],
): void {
	const fromLocalId = conn.attrs.refLocalId ?? "";
	if (fromLocalId.length === 0) return;
	connections.push({
		fromLocalId,
		toLocalId,
		formalParameter: conn.attrs.formalParameter ?? formalParameter,
		span: spanFromOffsets(source, conn.span.start, conn.span.end),
	});
}

/**
 * Run the existing ST lexer on the expression text and extract
 * identifier tokens. Spans are RELATIVE to the expression's offset
 * in the source — translate to absolute source coordinates.
 *
 * Member access (`fb.method`, `GVL_Basic.cConst`) produces multiple
 * identifier tokens; we mark each one with isMemberAccess based on
 * whether it's preceded by `.`, and collect the `qualifier` chain.
 */
function extractIdentifiersFromExpression(
	source: string,
	exprText: string,
	exprOffset: number,
	out: IdentifierRef[],
): void {
	const tokens: Token[] = lex(exprText);
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i]!;
		if (t.kind !== "identifier") continue;
		// Look at preceding non-trivia token for `.` (member access).
		const prevIdx = findPrevNonTrivia(tokens, i);
		const prev = prevIdx >= 0 ? tokens[prevIdx] : undefined;
		const isMemberAccess = prev !== undefined && prev.kind === "punct" && prev.text === ".";
		const qualifier = isMemberAccess
			? collectQualifierChain(tokens, i)
			: undefined;
		const absSpan: Span = spanFromOffsets(
			source,
			exprOffset + t.span.start,
			exprOffset + t.span.end,
		);
		out.push({
			name: t.text,
			span: absSpan,
			// Body expressions don't have call sites in FBD — the
			// block's typeName is the call. Variables in <expression>
			// are pure references.
			isCall: false,
			isMemberAccess,
			qualifier,
		});
	}
}

function findPrevNonTrivia(tokens: readonly Token[], idx: number): number {
	for (let i = idx - 1; i >= 0; i--) {
		const k = tokens[i]!.kind;
		if (
			k !== "whitespace" &&
			k !== "line_comment" &&
			k !== "block_comment" &&
			k !== "pragma"
		) {
			return i;
		}
	}
	return -1;
}

/** For `a.b.c`, when called at index of `c`, returns `["a", "b"]`. */
function collectQualifierChain(tokens: readonly Token[], identIdx: number): string[] {
	const chain: string[] = [];
	let i = findPrevNonTrivia(tokens, identIdx);
	while (i >= 0) {
		const t = tokens[i]!;
		if (t.kind === "punct" && t.text === ".") {
			i = findPrevNonTrivia(tokens, i);
			if (i < 0) break;
			const id = tokens[i]!;
			if (id.kind !== "identifier") break;
			chain.unshift(id.text);
			i = findPrevNonTrivia(tokens, i);
		} else {
			break;
		}
	}
	return chain;
}

/** Find the source offset of an attribute's VALUE inside an
 *  element. Used so `<block typeName="ADD">` produces an
 *  IdentifierRef pointing at `ADD` (between the quotes), not at
 *  the opening `<` of the element. */
function findAttrValueSpan(
	source: string,
	node: XmlNode,
	attrName: string,
): Span | undefined {
	// Search within the element's opening tag (between < and >).
	const elemStart = node.span.start;
	// The end of the opening tag is one of `>` or `/>` — find it
	// by scanning forward from elemStart.
	let openEnd = elemStart;
	while (openEnd < source.length && source[openEnd] !== ">") openEnd++;
	const haystack = source.slice(elemStart, openEnd);
	// Match `attrName="value"` or `attrName='value'`. Order-aware
	// so we don't false-match on a substring.
	const pattern = new RegExp(`\\b${attrName}\\s*=\\s*(['"])([^'"]*)\\1`);
	const m = pattern.exec(haystack);
	if (m === null || m.index === undefined) return undefined;
	const valueStart = elemStart + m.index + m[0].indexOf(m[1]!) + 1;
	const valueEnd = valueStart + m[2]!.length;
	return spanFromOffsets(source, valueStart, valueEnd);
}

/** Recursive find — first descendant with the given tag name. */
function findElement(node: XmlNode, tag: string): XmlNode | undefined {
	for (const n of walkElements(node)) {
		if (n.tag === tag) return n;
	}
	return undefined;
}
