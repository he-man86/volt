/**
 * LSP server entry — wires the three pieces (framing, dispatch,
 * diagnostics-push) around a single Workspace. JSON-RPC 2.0 over any
 * Readable / Writable pair.
 *
 * Lifecycle: initialize → initialized → request loop → shutdown → exit.
 *
 * No external dependencies. Designed to be embeddable: call
 * `runServer({ input, output })` with two streams; the typical use is
 * `process.stdin` / `process.stdout`, but tests or custom transports
 * can pass anything that implements the stream interfaces.
 */
import type { Readable, Writable } from "node:stream";
import {
	handleNotification,
	handleRequest,
	type DispatchContext,
	type ServerState,
} from "./dispatch.js";
import { DiagnosticsPusher } from "./diagnostics-push.js";
import { readMessages, writeMessage } from "./framing.js";
import {
	ErrorCodes,
	type JsonRpcMessage,
	type JsonRpcRequest,
	type JsonRpcResponse,
} from "../types.js";
import { Workspace } from "../workspace.js";

export interface ServerOptions {
	input: Readable;
	output: Writable;
}

export function runServer(opts: ServerOptions): void {
	const workspace = new Workspace();
	const state: ServerState = { shuttingDown: false, workspaceRoots: [] };

	/**
	 * In-flight request ledger. Tracks which request IDs are currently
	 * being processed and whether a `$/cancelRequest` notification has
	 * arrived for each.
	 *
	 * Query handlers are currently synchronous, so cancellation is
	 * largely protocol-surface — by the time a cancel arrives, the
	 * response is on its way back. We honor it on the boundary: if a
	 * cancel arrived before the response is sent, we respond with
	 * `RequestCancelled` instead.
	 *
	 * When per-query work becomes async (e.g. workspace indexing for
	 * larger projects), threading an `AbortSignal` through query
	 * functions and checking it between iterations is the next step.
	 */
	const inFlight = new Map<JsonRpcRequest["id"], { cancelled: boolean }>();

	const send = (msg: JsonRpcMessage): void => {
		writeMessage(opts.output, msg);
	};

	const reply = (id: JsonRpcRequest["id"], result: unknown): void => {
		const entry = inFlight.get(id);
		inFlight.delete(id);
		if (entry?.cancelled === true) {
			send({
				jsonrpc: "2.0",
				id,
				error: {
					code: ErrorCodes.RequestCancelled,
					message: "Request cancelled by client",
				},
			} satisfies JsonRpcResponse);
			return;
		}
		send({ jsonrpc: "2.0", id, result } satisfies JsonRpcResponse);
	};

	const fail = (id: JsonRpcRequest["id"], code: number, message: string): void => {
		inFlight.delete(id);
		send({ jsonrpc: "2.0", id, error: { code, message } } satisfies JsonRpcResponse);
	};

	const pusher = new DiagnosticsPusher(workspace, send);

	const ctx: DispatchContext = {
		workspace,
		state,
		pusher,
		send,
		reply,
		fail,
	};

	readMessages(opts.input, (msg) => {
		if ("id" in msg && "method" in msg) {
			const req = msg as JsonRpcRequest;
			inFlight.set(req.id, { cancelled: false });
			handleRequest(req, ctx);
		} else if ("method" in msg) {
			handleNotification(msg as { method: string; params?: unknown }, ctx, inFlight);
		}
		// Responses to client-originated requests would be the third case;
		// we don't currently send any requests TO the client.
	});
}
