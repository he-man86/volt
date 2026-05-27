/**
 * MCP tool registry — builds the server with all 5 volt_* tools
 * registered. Adding a new tool: write `tools/volt_<verb>.ts` that
 * exports `registerVolt<Verb>(server)`, import it here, call it.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerVoltInit } from "./volt_init.js";
import { registerVoltPull } from "./volt_pull.js";
import { registerVoltPush } from "./volt_push.js";
import { registerVoltStatus } from "./volt_status.js";
import { registerVoltCompile } from "./volt_compile.js";

export function buildServer(): McpServer {
	const server = new McpServer({ name: "volt", version: "0.0.0" });
	registerVoltInit(server);
	registerVoltPull(server);
	registerVoltPush(server);
	registerVoltStatus(server);
	registerVoltCompile(server);
	return server;
}
