/**
 * `plc_status` MCP tool — show what differs between IDE / snapshot / workspace.
 *
 * Returns a rich structured shape so the AI doesn't have to call extra
 * tools to figure out what's going on:
 *   - incoming         — {added, removed, modified} POU lists that
 *                        `plc_pull` would bring INTO the workspace
 *                        (= `hg incoming` / git's `HEAD..@{u}`)
 *   - outgoing         — {added, removed, modified} POU lists that
 *                        `plc_push` would send TO the bridge; same
 *                        shape as `incoming` so both directions render
 *                        identically (= `hg outgoing` / `@{u}..HEAD`)
 *   - dirtyPaths       — workspace files that differ from the snapshot
 *                        (path-level view backing `outgoing`)
 *   - ideDrifted       — boolean roll-up
 *   - workspaceDirty   — boolean roll-up
 *   - nextAction         — opinion: "pull" | "push" | "reconcile" | "init" | null
 *   - summary            — human-readable one-liner the AI can quote directly
 *   - availableCapabilities — active leases the human has granted (e.g. push-force).
 *                          Empty when no elevated parameters are usable. AI clients
 *                          check this BEFORE calling plc_push with force, etc.
 *
 * Cheap and safe to call at any time — including before `plc_init`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStatus } from "../engine/status.js";
import {
	commonArgs,
	errorContent,
	jsonContent,
	newBridge,
	resolvePort,
	resolveWorkspace,
	safeRun,
} from "./_shared.js";

export function registerPlcStatus(server: McpServer): void {
	server.registerTool(
		"plc_status",
		{
			description:
				"Report what differs between the IDE, the last-pulled snapshot, and the workspace. Returns `incoming` (what plc_pull would bring into the workspace) and `outgoing` (what plc_push would send to the bridge) as per-item added/removed/modified lists — same shape, same direction terms as `hg incoming`/`hg outgoing`. Plus per-file workspace dirtiness, a next-action recommendation (pull / push / reconcile / init / null), and a human-readable summary. Cheap — run as often as needed to orient before pull/push.",
			inputSchema: commonArgs,
		},
		async (args) => {
			const port = resolvePort(args.port);
			const ws = resolveWorkspace(args.workspace);
			const r = await safeRun(() => runStatus(ws, newBridge(port)));
			if (!r.ok) return errorContent(r.error);
			return jsonContent({
				workspace: ws,
				initialized: r.value.initialized,
				ideDrifted: r.value.ideDrifted,
				workspaceDirty: r.value.workspaceDirty,
				incoming: r.value.incoming,
				outgoing: r.value.outgoing,
				dirtyPaths: r.value.dirtyPaths,
				driftLikelySelfCaused: r.value.driftLikelySelfCaused,
				bridgeProjectVersion: r.value.bridgeProjectVersion,
				snapshotProjectVersion: r.value.snapshotProjectVersion,
				nextAction: r.value.nextAction,
				summary: r.value.summary,
				availableCapabilities: r.value.availableCapabilities,
			});
		},
	);
}
