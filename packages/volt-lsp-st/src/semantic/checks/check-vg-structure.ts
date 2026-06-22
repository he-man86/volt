/**
 * VG structural diagnostics — surface, in the editor, the well-formedness
 * codes the bridge gate would refuse a push with (vg-language.md §10).
 *
 * The LSP computes these by INSPECTING the parsed VG tree (collected in
 * `BodyModel.vg.diagnostics` at parse time), not by round-tripping through
 * a writer/PLCopen pipeline the way the bridge does. So this check is a
 * thin adapter: it copies each VG body's parse diagnostics into the
 * LSP diagnostic stream.
 *
 * Two §10 codes are intentionally never produced here:
 *   - VG_NOT_CANONICAL needs the ported canonical writer (a later phase).
 *   - VG_PLCOPEN_DRIFT needs the PLCopen pipeline — bridge-only.
 *   - VG_LEAF_FANOUT cannot arise from VG *text*: the parser mints a fresh
 *     leaf per occurrence, so a text-parsed graph never shares a leaf.
 */
import type { CheckContext } from "../diagnostics.js";
import type { DiagnosticItem } from "./_shared.js";
import { writeVgBody } from "../../vg/index.js";

export function checkVgStructure(ctx: CheckContext, out: DiagnosticItem[]): void {
	for (const model of ctx.bodyModels.values()) {
		if (model.language !== "vg" || model.vg === undefined) continue;
		for (const d of model.vg.diagnostics) {
			out.push({
				severity: "error",
				span: d.span,
				source: "volt-lsp-st",
				code: d.code,
				message: d.message,
			});
		}

		// VG_NOT_CANONICAL (opt-in): compare the body text against the
		// re-emitted canonical form, ignoring leading indentation (the
		// formatter owns indentation; the bridge owns deep canonicality).
		if (ctx.config.vgNotCanonical && model.vg.diagnostics.length === 0) {
			const actual = normalize(ctx.source.slice(model.st.span.start, model.st.span.end));
			const canonical = normalize(writeVgBody(model.vg));
			if (actual !== canonical) {
				out.push({
					severity: "warning",
					span: model.st.span,
					source: "volt-lsp-st",
					code: "VG_NOT_CANONICAL",
					message: `VG body is not in canonical form. Canonical:\n${writeVgBody(model.vg)}`,
				});
			}
		}
	}
}

/** Per-line trim + drop blank lines — compares structure/spacing while
 *  ignoring the indentation the formatter normalises separately. */
function normalize(text: string): string {
	return text
		.replace(/\r/g, "")
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0)
		.join("\n");
}
