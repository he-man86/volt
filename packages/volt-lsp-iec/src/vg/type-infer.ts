/**
 * VG wire/operand type inference — the §8 table from vg-language.md.
 *
 * VG never writes wire types; the LSP infers them from the defining
 * expression plus the POU declaration:
 *
 *   logic/comparison op       → BOOL
 *   EN echo (en*)             → BOOL
 *   arithmetic op             → the operands' common/result type
 *   function call FN(…)       → the function's declared return type
 *   FB output inst.Pin        → the FB's output-pin type
 *   bare variable leaf        → its declared type
 *   literal                   → the literal's type (numeric is polymorphic → unknown)
 *
 * The declaration is the authority for real variables, supplied via
 * `VgTypeEnv` (the LSP already has the POU document + scope).
 */
import type { VgCore, VgNetwork, VgOperand, VgStatement } from "./ast.js";
import { operatorBySymbol } from "./operators.js";

/** Declaration-scope type lookups the inferrer needs from the LSP. */
export interface VgTypeEnv {
	/** Declared type of a real variable / FB instance (uppercased simple name). */
	varType(name: string): string | undefined;
	/** Declared return type of a function. */
	functionReturnType(name: string): string | undefined;
	/** Output-pin type of an FB instance (`inst`, `Pin`). */
	memberType(instance: string, pin: string): string | undefined;
}

/** Infer the type a wire carries, by inferring its producer (§8). */
export function inferWireType(network: VgNetwork, wireName: string, env: VgTypeEnv): string | undefined {
	return inferWire(network, wireName, env, new Set());
}

/** Infer the type of an operand expression (§8). */
export function inferOperandType(operand: VgOperand, network: VgNetwork, env: VgTypeEnv): string | undefined {
	return inferOperand(operand, network, env, new Set());
}

function inferWire(network: VgNetwork, wireName: string, env: VgTypeEnv, seen: Set<string>): string | undefined {
	if (seen.has(wireName)) return undefined; // guard cyclic references
	seen.add(wireName);
	const def = findWireDef(network.statements, wireName);
	if (def === undefined) return undefined;
	if (def.isEnBinding) return "BOOL"; // an EN echo is always BOOL
	return inferOperand(def.producer, network, env, seen);
}

function inferOperand(operand: VgOperand, network: VgNetwork, env: VgTypeEnv, seen: Set<string>): string | undefined {
	// A negation or edge yields a boolean signal.
	if (operand.mods.negated || operand.mods.edge !== undefined) return "BOOL";
	return inferCore(operand.core, network, env, seen);
}

function inferCore(core: VgCore, network: VgNetwork, env: VgTypeEnv, seen: Set<string>): string | undefined {
	switch (core.kind) {
		case "group": {
			if (core.op === undefined) return undefined;
			const entry = operatorBySymbol(core.op);
			if (entry === undefined) return undefined;
			if (entry.class === "logic" || entry.class === "comparison") return "BOOL";
			// arithmetic → the operands' common type (approximated by the
			// first resolvable operand).
			for (const o of core.operands) {
				const t = inferOperand(o, network, env, seen);
				if (t !== undefined) return t;
			}
			return undefined;
		}
		case "call":
			return env.functionReturnType(core.callee.text);
		case "member":
			return env.memberType(core.base.text, core.member.text);
		case "leaf": {
			if (core.isLiteral) return literalType(core);
			if (core.name === undefined) return undefined; // opaque multi-token leaf
			const name = core.name.text;
			// A reference to another wire / EN echo in this network.
			if (findWireDef(network.statements, name) !== undefined) return inferWire(network, name, env, seen);
			return env.varType(name);
		}
	}
}

function literalType(core: { text: string }): string | undefined {
	const t = core.text.trim().toUpperCase();
	if (t === "TRUE" || t === "FALSE") return "BOOL";
	// Numeric literals are polymorphic in IEC (sized by context) — unknown.
	return undefined;
}

function findWireDef(statements: VgStatement[], name: string): import("./ast.js").VgWireDef | undefined {
	for (const stmt of statements) {
		if (stmt.kind === "wire_def" && stmt.name.text === name) return stmt;
		if (stmt.kind === "en_eno_if") {
			const inner = stmt.body;
			if (inner.kind === "wire_def" && inner.name.text === name) return inner;
		}
	}
	return undefined;
}
