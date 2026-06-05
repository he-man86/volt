/**
 * `INTERFACE Name [EXTENDS A, B, C]
 *  <method signatures>
 *  <property signatures>
 *  END_INTERFACE`
 *
 * Interfaces declare signatures only — no method bodies, no field
 * VARs (interface methods can still declare VAR_INPUT / VAR_OUTPUT
 * sections, which compose into the method signature).
 *
 * Multiple inheritance: unlike FBs, interfaces can EXTENDS a list of
 * parent interfaces. Each parent is fully qualified by name; the
 * resolver flattens the chain at symbol-table build time.
 */
import type {
	Identifier,
	Interface,
	InterfaceMethod,
	InterfaceProperty,
} from "../ast.js";
import type { Cursor } from "../cursor.js";
import { parseTypeExpression } from "../type-expr.js";
import { collectVarSections, describeToken, identFromToken, joinSpans } from "../util.js";

export function parseInterface(c: Cursor): Interface | undefined {
	const start = c.expectKeyword("INTERFACE", "at start of INTERFACE");
	if (start === undefined) return undefined;
	const nameTok = c.expectIdent("for INTERFACE name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);

	// Optional EXTENDS X, Y, Z (interfaces can extend multiple)
	let extendsList: Identifier[] | undefined;
	if (c.eatKeyword("EXTENDS") !== undefined) {
		extendsList = [];
		const first = c.expectIdent("after EXTENDS");
		if (first !== undefined) extendsList.push(identFromToken(first));
		while (c.eatPunct(",") !== undefined) {
			const more = c.expectIdent("in EXTENDS list");
			if (more === undefined) break;
			extendsList.push(identFromToken(more));
		}
	}

	const methods: InterfaceMethod[] = [];
	const properties: InterfaceProperty[] = [];

	while (!c.atEof()) {
		const endIface = c.eatKeyword("END_INTERFACE");
		if (endIface !== undefined) {
			return {
				kind: "interface",
				name,
				...(extendsList !== undefined ? { extends: extendsList } : {}),
				methods,
				properties,
				span: joinSpans(start.span, endIface.span),
			};
		}

		const next = c.peek();
		if (next.kind === "keyword" && next.keyword === "METHOD") {
			const m = parseInterfaceMethod(c);
			if (m !== undefined) methods.push(m);
			continue;
		}
		if (next.kind === "keyword" && next.keyword === "PROPERTY") {
			const p = parseInterfaceProperty(c);
			if (p !== undefined) properties.push(p);
			continue;
		}
		// Unknown — record and skip
		c.pushError(`unexpected ${describeToken(next)} inside INTERFACE`, next.span);
		if (!c.recoverTo({ keywords: ["END_INTERFACE", "METHOD", "PROPERTY"] })) break;
	}

	c.pushError("unterminated INTERFACE: expected END_INTERFACE", start.span);
	return {
		kind: "interface",
		name,
		...(extendsList !== undefined ? { extends: extendsList } : {}),
		methods,
		properties,
		span: joinSpans(start.span, name.span),
	};
}

function parseInterfaceMethod(c: Cursor): InterfaceMethod | undefined {
	const start = c.expectKeyword("METHOD", "at start of interface method");
	if (start === undefined) return undefined;
	// Modifiers are allowed but informational on interfaces
	while (
		c.eatAnyKeyword(
			"PUBLIC",
			"PRIVATE",
			"PROTECTED",
			"INTERNAL",
			"FINAL",
			"ABSTRACT",
			"OVERRIDE",
		) !== undefined
	) {
		// consume and ignore
	}
	const nameTok = c.expectIdent("for interface method name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);
	let returnType: InterfaceMethod["returnType"];
	if (c.eatPunct(":") !== undefined) {
		returnType = parseTypeExpression(c);
	}
	const varSections = collectVarSections(c);
	// Interfaces have no method bodies — the next keyword should be
	// END_METHOD (then we look for the next interface member). Some
	// formats omit END_METHOD entirely.
	const endMethod = c.eatKeyword("END_METHOD");
	const endSpan = endMethod?.span ?? returnType?.span ?? name.span;
	return {
		kind: "interface_method",
		name,
		...(returnType !== undefined ? { returnType } : {}),
		varSections,
		span: joinSpans(start.span, endSpan),
	};
}

function parseInterfaceProperty(c: Cursor): InterfaceProperty | undefined {
	const start = c.expectKeyword("PROPERTY", "at start of interface property");
	if (start === undefined) return undefined;
	const nameTok = c.expectIdent("for interface property name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);
	if (c.expectPunct(":", "after interface property name") === undefined) return undefined;
	const dataType = parseTypeExpression(c);
	if (dataType === undefined) return undefined;
	// Interfaces may declare which of GET/SET accessors are required.
	let hasGetter = false;
	let hasSetter = false;
	while (true) {
		const accessor = c.eatAnyKeyword("GET", "SET");
		if (accessor === undefined) break;
		if (accessor.keyword === "GET") hasGetter = true;
		if (accessor.keyword === "SET") hasSetter = true;
	}
	const endProp = c.eatKeyword("END_PROPERTY");
	const endSpan = endProp?.span ?? dataType.span;
	return {
		kind: "interface_property",
		name,
		dataType,
		hasGetter,
		hasSetter,
		span: joinSpans(start.span, endSpan),
	};
}
