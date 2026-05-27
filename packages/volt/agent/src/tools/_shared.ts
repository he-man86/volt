/**
 * Common surface for every MCP tool file: arg-shape helpers, the
 * `workspace` + `port` zod fragment, the BridgeClient factory, and a
 * couple of safe-call / response-formatting helpers.
 *
 * Each tool resolves workspace + port from (tool args → env → default)
 * so an MCP client can either pre-bake them via env at server startup
 * (single-project setup) or pass them per-call (multi-project setup).
 */
import { z } from "zod";
import { BridgeClient, isBridgeOfflineError } from "../bridge/client.js";

const DEFAULT_BRIDGE_PORT = Number.parseInt(
	process.env.VOLT_BRIDGE_PORT ?? "8555",
	10,
);
const DEFAULT_WORKSPACE = process.env.VOLT_WORKSPACE ?? process.cwd();

export function resolvePort(arg: number | undefined): number {
	return arg ?? DEFAULT_BRIDGE_PORT;
}
export function resolveWorkspace(arg: string | undefined): string {
	return arg ?? DEFAULT_WORKSPACE;
}
export function newBridge(port: number): BridgeClient {
	return new BridgeClient({ port });
}

/** The (workspace, port) input fragment shared by every tool. */
export const commonArgs = {
	workspace: z
		.string()
		.optional()
		.describe(
			"Absolute or relative path to the workspace folder. Defaults to env VOLT_WORKSPACE then process cwd.",
		),
	port: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Bridge HTTP port. Defaults to env VOLT_BRIDGE_PORT then 8555."),
};

/**
 * Wrap a tool body so bridge-offline errors come back as structured
 * tool errors (with a useful hint) instead of crashing the server.
 */
export async function safeRun<T>(
	fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
	try {
		return { ok: true, value: await fn() };
	} catch (err) {
		if (isBridgeOfflineError(err)) {
			return {
				ok: false,
				error: `bridge unreachable on the configured port. Is the bridge running (bridges/dist/BeckhoffBridge.exe with the IDE open)? Underlying error: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

/** Structured JSON content block — AI clients can JSON.parse the .text field. */
export function jsonContent(obj: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
	};
}

/** Tool error response (isError flag flips the MCP "tool failed" path). */
export function errorContent(message: string) {
	return {
		isError: true,
		content: [{ type: "text" as const, text: message }],
	};
}
