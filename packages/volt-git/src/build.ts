/** volt-git build — delegate to the bridge's build endpoint + return normalized diagnostics. */
import type { Remote } from "./bridge/types.js";

export interface BuildDiagnostic {
	severity: "error" | "warning" | "info";
	message: string;
	object?: string | null;
}
export interface BuildResult {
	success: boolean;
	duration: number;
	diagnostics: BuildDiagnostic[];
}

export async function build(bridge: Remote, full: boolean): Promise<BuildResult> {
	const r = await bridge.build({ buildType: full ? "full" : "incremental" });
	return { success: r.success, duration: r.duration, diagnostics: r.diagnostics.map((d) => ({ severity: d.severity, message: d.message, object: d.object ?? null })) };
}
