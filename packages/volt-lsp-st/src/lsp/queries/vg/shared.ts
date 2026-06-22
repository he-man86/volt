/**
 * Shared helpers for VG query handlers — extracting the VG bodies from a
 * document's per-body models, and locating the VG body (if any) at a
 * source offset.
 */
import type { Span } from "../../../lexer/span.js";
import type { Token } from "../../../lexer/tokens.js";
import type { BodySpan } from "../../../parser/ast.js";
import type { BodyModel } from "../../../semantic/body.js";
import type { VgBody } from "../../../vg/index.js";

export interface VgBodyEntry {
	span: Span;
	vg: VgBody;
	tokens: Token[];
}

/** Every VG body in a document, with its source span and token slice. */
export function vgBodiesOf(bodyModels: Map<BodySpan, BodyModel>): VgBodyEntry[] {
	const out: VgBodyEntry[] = [];
	for (const model of bodyModels.values()) {
		if (model.language === "vg" && model.vg !== undefined) {
			out.push({ span: model.st.span, vg: model.vg, tokens: model.st.tokens });
		}
	}
	return out;
}

/** The VG body containing `offset`, or undefined. */
export function vgBodyAtOffset(bodyModels: Map<BodySpan, BodyModel>, offset: number): VgBodyEntry | undefined {
	for (const entry of vgBodiesOf(bodyModels)) {
		if (offset >= entry.span.start && offset <= entry.span.end) return entry;
	}
	return undefined;
}
