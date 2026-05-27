#!/usr/bin/env node
/**
 * `volt-mcp` — process entry point. All tool definitions live in `tools/`.
 *
 * Runs over stdio. Wire it into your MCP client's config; the server
 * advertises volt_init, volt_pull, volt_push, volt_status, volt_compile.
 * See README → "AI integration (MCP)" for a Claude Desktop config snippet.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./index.js";

const server = buildServer();
const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
	process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
});
