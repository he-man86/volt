/**
 * Type-aware reference resolution — the shared core for references, rename,
 * and document-highlight (st-nav-chains §2.1).
 *
 * The name-based approach matches every same-named identifier project-wide,
 * so `motor.Start` matched every `Start`. This narrows by SYMBOL IDENTITY:
 * resolve the target symbol at the cursor, then keep only occurrences that
 * resolve to the same symbol. An occurrence that can't be proven to bind to
 * the target is NOT a reference to it, so excluding it is correct (this is
 * why type-aware rename is safe — it renames exactly the target's bindings).
 * When the target itself can't be resolved to a symbol, we fall back to
 * name-based matching (the prior behavior) — no worse than before.
 */
import type { BodySpan, TopLevel } from "../parser/ast.js";
import type { Span } from "../lexer/span.js";
import type { Scope, Symbol } from "../semantic/symbol-table.js";
import type { BodyModel, IdentifierRef } from "../semantic/body.js";
import type { Document } from "./workspace.js";
import { lookup } from "../semantic/resolver.js";
import { findIdentifiersByName } from "../semantic/body.js";
import { findScopeForUnit } from "../semantic/checks/_shared.js";
import { memberAtOffset } from "../parser/ast-walk.js";
import { resolveBareEnumMember, resolveMemberChain } from "../semantic/type-infer.js";
import { findIdentifierAtOffset } from "./identifier-at.js";
import { scopeAtOffset } from "./scope-at.js";
import { stStatementsAtOffset } from "./st-body-at.js";

/** The declaration symbol referenced at a document offset — through a member chain when the cursor is on a
 *  member, else by scope lookup (incl. bare enum members). Undefined when nothing resolves. */
export function symbolAtOffset(doc: Document, project: Scope, offset: number): Symbol | undefined {
	const scope = scopeAtOffset(project, doc, offset);
	const statements = stStatementsAtOffset(doc.bodyModels, offset);
	if (statements !== undefined) {
		const member = memberAtOffset(statements, offset);
		if (member !== undefined) {
			const sym = resolveMemberChain(member, scope, project);
			if (sym !== undefined) return sym;
		}
	}
	const idTok = findIdentifierAtOffset(doc.parseResult, offset, doc.bodyModels);
	if (idTok === undefined) return undefined;
	return lookup(scope, idTok.text)?.symbol ?? resolveBareEnumMember(project, idTok.text);
}

function bodyOf(unit: TopLevel): BodySpan | undefined {
	switch (unit.kind) {
		case "function_block":
		case "program":
		case "function":
		case "method":
		case "action":
			return unit.body;
		case "property": {
			// property accessors have their own bodies; handled by the caller iterating both — return undefined here
			return undefined;
		}
		default:
			return undefined;
	}
}

/** The symbol a single body occurrence binds to — via chain for a member, else scope lookup. */
function occurrenceSymbol(ref: IdentifierRef, model: BodyModel, bodyScope: Scope, project: Scope): Symbol | undefined {
	if (ref.isMemberAccess === true) {
		if (model.statementsOk === true && model.statements !== undefined) {
			const member = memberAtOffset(model.statements, ref.span.start);
			if (member !== undefined) return resolveMemberChain(member, bodyScope, project);
		}
		return undefined; // a member we can't resolve is not provably the target
	}
	return lookup(bodyScope, ref.name)?.symbol ?? resolveBareEnumMember(project, ref.name);
}

export interface Ref {
	uri: string;
	span: Span;
}

/**
 * Every body occurrence of `name` across `docs` that binds to `target`. When `target` is undefined, falls
 * back to name-based matching (every same-named occurrence). Declarations are the caller's concern.
 */
export function findReferences(docs: Iterable<Document>, name: string, target: Symbol | undefined, project: Scope): Ref[] {
	const out: Ref[] = [];
	for (const d of docs) {
		for (const unit of d.parseResult.units) {
			const body = bodyOf(unit);
			if (body === undefined) continue;
			const model = d.bodyModels.get(body);
			if (model === undefined) continue;
			const bodyScope = findScopeForUnit(project, unit) ?? project;
			for (const ref of findIdentifiersByName(model, name)) {
				if (target === undefined || occurrenceSymbol(ref, model, bodyScope, project) === target) {
					out.push({ uri: d.uri, span: ref.span });
				}
			}
		}
	}
	return out;
}
