/**
 * Graphical-body diagnostic: connection refLocalId doesn't resolve.
 *
 * Every `<connection refLocalId="N">` in an FBD / LD / CFC body
 * MUST reference an existing node (block, inVariable, outVariable,
 * etc.) within the SAME body. A dangling reference means the body
 * XML is corrupted — usually from manual edits or a buggy tool
 * writer. CODESYS itself rejects such bodies at runtime with
 * "Connection to undefined element".
 *
 * This check is purely topological — it walks `BodyModel.graph`
 * which the FBD/LD/CFC parser populates. Zero ST grammar
 * knowledge needed.
 *
 * Diagnostic is emitted at the `<connection>` element span (not
 * the referencing block) so the user can jump straight to the
 * bad line.
 */
import type { BodySpan } from "../../../declarations/ast.js";
import type { BodyModel } from "../../../body/index.js";
import { forEachGraphicalBody, type DiagnosticItem } from "../_shared.js";

export function checkDanglingConnections(
	bodyModels: Map<BodySpan, BodyModel>,
	out: DiagnosticItem[],
): void {
	forEachGraphicalBody(bodyModels, (model) => {
		const knownIds = new Set(model.graph.nodes.map((n) => n.localId));
		for (const conn of model.graph.connections) {
			if (conn.fromLocalId.length === 0) continue;
			if (knownIds.has(conn.fromLocalId)) continue;
			out.push({
				severity: "error",
				span: conn.span,
				source: "volt-lsp",
				code: "graphical-dangling-connection",
				message: `connection refLocalId="${conn.fromLocalId}" does not match any node in this body`,
			});
		}
	});
}
