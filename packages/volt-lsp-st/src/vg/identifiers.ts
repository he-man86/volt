/**
 * Identifier collection over a parsed VG body — the VG analogue of
 * `semantic/identifier-scan.ts` for ST bodies.
 *
 * It emits only references to names that live in the POU's declaration
 * scope (real variables, FB instances, function names) — NOT the
 * network-local VG-only names (`LET` wires, EN echoes, labels), NOT pin
 * names, NOT operators/keywords/literals. That keeps project-wide
 * find-references and rename correct: a wire named `g1` must never be
 * confused with a declared variable `g1`, and renaming a real variable
 * must not touch a coincidentally-named wire.
 *
 * Network-local navigation for `LET` wires / labels is a separate concern
 * (handled by the VG navigation queries), deliberately not mixed in here.
 */
import type { Span } from "../lexer/span.js";
import type {
	VgArg,
	VgBody,
	VgCore,
	VgNetwork,
	VgOperand,
	VgStatement,
} from "./ast.js";

/** Mirrors `semantic/body.ts`'s IdentifierRef shape (kept local to avoid a
 *  semantic→vg→semantic import cycle). */
export interface VgIdentifierRef {
	name: string;
	span: Span;
	isCall: boolean;
	isMemberAccess: boolean;
	isNamedParam: boolean;
	qualifier?: string[];
}

/** Collect every declaration-scope identifier reference in a VG body. */
export function collectVgIdentifierRefs(vg: VgBody): VgIdentifierRef[] {
	const out: VgIdentifierRef[] = [];
	for (const network of vg.networks) collectNetwork(network, out);
	return out;
}

function collectNetwork(network: VgNetwork, out: VgIdentifierRef[]): void {
	// Network-local names (wires / EN echoes / labels) are excluded from
	// project-scope references.
	const local = new Set<string>();
	const noteLocal = (stmt: VgStatement): void => {
		if (stmt.kind === "wire_def") local.add(stmt.name.text);
		else if (stmt.kind === "label") local.add(stmt.name.text);
		else if (stmt.kind === "en_eno_if") {
			local.add(stmt.en.text);
			noteLocal(stmt.body);
		}
	};
	for (const stmt of network.statements) noteLocal(stmt);

	for (const stmt of network.statements) emitStatement(stmt, local, out);
}

function emitStatement(stmt: VgStatement, local: Set<string>, out: VgIdentifierRef[]): void {
	switch (stmt.kind) {
		case "wire_def":
			emitOperand(stmt.producer, local, out);
			return;
		case "sink": {
			// Emit the real-variable identifiers in the l-value — the write
			// target plus any array-index vars (`arr[i]` → `arr`, `i`) — but
			// NOT member fields (`struct.field` → `struct` only; `field` is a
			// member resolved against the type, not a scope variable).
			const toks = stmt.target.tokens;
			for (let i = 0; i < toks.length; i++) {
				const t = toks[i]!;
				if (t.kind !== "identifier") continue;
				const prev = toks[i - 1];
				if (prev !== undefined && prev.kind === "punct" && prev.text === ".") continue;
				if (local.has(t.text)) continue;
				out.push({ name: t.text, span: t.span, isCall: false, isMemberAccess: false, isNamedParam: false });
			}
			emitOperand(stmt.value, local, out);
			return;
		}
		case "fb_call":
			if (!local.has(stmt.instance.text)) {
				out.push({
					name: stmt.instance.text,
					span: stmt.instance.span,
					isCall: true,
					isMemberAccess: false,
					isNamedParam: false,
				});
			}
			for (const arg of stmt.args) emitArg(arg, local, out);
			return;
		case "en_eno_if":
			emitStatement(stmt.body, local, out);
			return;
		case "jump":
			if (stmt.condition !== undefined) emitOperand(stmt.condition, local, out);
			return;
		case "return":
			if (stmt.condition !== undefined) emitOperand(stmt.condition, local, out);
			return;
		case "label":
		case "comment":
		case "unknown_stmt":
			return;
	}
}

function emitOperand(op: VgOperand, local: Set<string>, out: VgIdentifierRef[]): void {
	emitCore(op.core, local, out);
}

function emitCore(core: VgCore, local: Set<string>, out: VgIdentifierRef[]): void {
	switch (core.kind) {
		case "group":
			for (const o of core.operands) emitOperand(o, local, out);
			return;
		case "call":
			out.push({
				name: core.callee.text,
				span: core.callee.span,
				isCall: true,
				isMemberAccess: false,
				isNamedParam: false,
			});
			for (const arg of core.args) emitArg(arg, local, out);
			return;
		case "member":
			// `inst.Pin` — the base is a declared FB instance; the member is
			// the instance's pin (resolved against the FB type, not scope).
			if (!local.has(core.base.text)) {
				out.push({
					name: core.base.text,
					span: core.base.span,
					isCall: false,
					isMemberAccess: false,
					isNamedParam: false,
				});
			}
			return;
		case "leaf": {
			if (core.isLiteral) return;
			if (core.name !== undefined) {
				if (!local.has(core.name.text)) {
					out.push({
						name: core.name.text,
						span: core.name.span,
						isCall: false,
						isMemberAccess: false,
						isNamedParam: false,
					});
				}
				return;
			}
			// Opaque multi-token leaf (`a + 1`) — surface its identifier tokens.
			for (const t of core.tokens) {
				if (t.kind === "identifier" && !local.has(t.text)) {
					out.push({ name: t.text, span: t.span, isCall: false, isMemberAccess: false, isNamedParam: false });
				}
			}
			return;
		}
	}
}

function emitArg(arg: VgArg, local: Set<string>, out: VgIdentifierRef[]): void {
	// A pin name (`PIN := value`) belongs to the callee's declaration, not
	// the calling scope — flagged isNamedParam so unresolved-identifier skips
	// it (parity with ST named-parameter handling).
	if (arg.pin !== undefined) {
		out.push({ name: arg.pin.text, span: arg.pin.span, isCall: false, isMemberAccess: false, isNamedParam: true });
	}
	emitOperand(arg.value, local, out);
}
