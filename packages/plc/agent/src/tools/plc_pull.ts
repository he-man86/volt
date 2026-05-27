/**
 * `plc_pull` MCP tool — pull IDE state into the workspace.
 * Mirrors `git pull`: brings the remote (= bridge) up into our working
 * tree (= workspace), refusing if local edits would be overwritten.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runPull } from "../engine/pull.js";
import {
	commonArgs,
	errorContent,
	jsonContent,
	newBridge,
	resolvePort,
	resolveWorkspace,
	safeRun,
} from "./_shared.js";

export function registerPlcPull(server: McpServer): void {
	server.registerTool(
		"plc_pull",
		{
			description:
				"Pull the IDE's current state into the workspace. Refuses if the workspace has uncommitted local edits that would be overwritten — pass force: true to discard them. Pass dryRun: true to PREVIEW what would be pulled (per-item incoming ChangeSet) without writing to the snapshot or the workspace (models `git fetch --dry-run`) — safe to call before the real pull.",
			inputSchema: {
				...commonArgs,
				force: z
					.boolean()
					.optional()
					.describe("Discard any local workspace edits that conflict with the pull."),
				dryRun: z
					.boolean()
					.optional()
					.describe(
						"Preview only — compute what would be pulled (per-item) without touching the snapshot or workspace. Modeled on `git fetch --dry-run` / `git pull --dry-run`. The dirty-workspace conflict guard still runs (callers get the same refusal a real pull would).",
					),
			},
		},
		async (args) => {
			const port = resolvePort(args.port);
			const ws = resolveWorkspace(args.workspace);
			const r = await safeRun(() =>
				runPull(ws, newBridge(port), { force: args.force, dryRun: args.dryRun === true }),
			);
			if (!r.ok) return errorContent(r.error);
			const v = r.value;
			const wroteOrRemoved = v.written.length + v.removed.length;
			const upToDate = v.upToDate && wroteOrRemoved === 0;
			const dryRun = v.dryRun === true;
			let status: string;
			if (dryRun) status = upToDate ? "already_up_to_date" : "would_pull";
			else status = upToDate ? "already_up_to_date" : "pulled";
			return jsonContent({
				status,
				workspace: ws,
				...(dryRun && { dryRun: true }),
				written: v.written,
				removed: v.removed,
				incoming: v.incoming,
				hint: dryRun
					? upToDate
						? "Dry-run: workspace already matches the IDE — a real plc_pull would be a no-op."
						: "Dry-run: shows what plc_pull WOULD bring in (see `incoming`). Snapshot and workspace were NOT touched."
					: upToDate
					? "Workspace already matches the IDE. Call plc_status to see what (if anything) you've changed locally."
					: `${v.written.length} file(s) written, ${v.removed.length} removed. Edit files in the workspace, then call plc_push to send back.`,
			});
		},
	);
}
