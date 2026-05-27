/**
 * `plc_init` MCP tool — bind the workspace to the IDE project.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runInit } from "../engine/init.js";
import {
	commonArgs,
	errorContent,
	jsonContent,
	newBridge,
	resolvePort,
	resolveWorkspace,
	safeRun,
} from "./_shared.js";

export function registerPlcInit(server: McpServer): void {
	server.registerTool(
		"plc_init",
		{
			description:
				"Bind a workspace folder to the IDE project the bridge currently has open. Idempotent — re-init on a matching project is a no-op. Use force: true to repoint an existing workspace to a different IDE project.",
			inputSchema: {
				...commonArgs,
				force: z
					.boolean()
					.optional()
					.describe("Repoint an existing workspace whose binding doesn't match the bridge's current project."),
			},
		},
		async (args) => {
			const port = resolvePort(args.port);
			const ws = resolveWorkspace(args.workspace);
			const r = await safeRun(() => runInit(ws, newBridge(port), port, { force: args.force }));
			if (!r.ok) return errorContent(r.error);
			return jsonContent({
				status: r.value.alreadyInitialized ? "already_initialized" : "initialized",
				workspace: ws,
				platform: r.value.platform,
				projectName: r.value.projectName,
				plcProjectName: r.value.plcProjectName,
				nextStep: r.value.alreadyInitialized ? null : "run plc_pull to populate the workspace",
			});
		},
	);
}
