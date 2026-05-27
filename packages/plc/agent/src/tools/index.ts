/**
 * MCP tool registry — builds the server with all 5 plc_* tools
 * registered. Adding a new tool: write `tools/plc_<verb>.ts` that
 * exports `registerPlc<Verb>(server)`, import it here, call it.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPlcInit } from "./plc_init.js";
import { registerPlcPull } from "./plc_pull.js";
import { registerPlcPush } from "./plc_push.js";
import { registerPlcStatus } from "./plc_status.js";
import { registerPlcCompile } from "./plc_compile.js";

export function buildServer(): McpServer {
	const server = new McpServer({ name: "plcassist", version: "0.0.0" });
	registerPlcInit(server);
	registerPlcPull(server);
	registerPlcPush(server);
	registerPlcStatus(server);
	registerPlcCompile(server);
	return server;
}
