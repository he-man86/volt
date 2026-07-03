/**
 * JSON-RPC 2.0 wire framing for the LSP. Pure functions — no shared
 * state, no dependencies on workspace/dispatch.
 *
 * The LSP framing format:
 *
 *   Content-Length: <bytes>\r\n
 *   \r\n
 *   <utf-8 JSON body>
 *
 * Hand-rolled rather than pulled from `vscode-jsonrpc` so the server
 * stays dependency-light and trivial to embed (the consumer just hands
 * in two Readable/Writable streams).
 */
import type { Readable, Writable } from "node:stream";
import type { JsonRpcMessage } from "../types.js";

export function writeMessage(out: Writable, msg: JsonRpcMessage): void {
	const body = JSON.stringify(msg);
	const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
	out.write(header + body, "utf-8");
}

/**
 * Read framed messages off a Readable stream, calling `onMessage` for
 * each complete frame. Buffers partial reads; tolerates malformed
 * headers (drops up to the malformed `\r\n\r\n` and resyncs).
 */
export function readMessages(
	input: Readable,
	onMessage: (msg: JsonRpcMessage) => void,
): void {
	let buf = Buffer.alloc(0);
	input.on("data", (chunk: Buffer) => {
		buf = Buffer.concat([buf, chunk]);
		while (true) {
			const headerEnd = buf.indexOf("\r\n\r\n");
			if (headerEnd === -1) return;
			const header = buf.subarray(0, headerEnd).toString("utf-8");
			const m = /Content-Length:\s*(\d+)/i.exec(header);
			if (m === null) {
				// Malformed header — drop everything up to headerEnd and try again.
				buf = buf.subarray(headerEnd + 4);
				continue;
			}
			const len = Number(m[1]);
			const total = headerEnd + 4 + len;
			if (buf.length < total) return;
			const body = buf.subarray(headerEnd + 4, total).toString("utf-8");
			buf = buf.subarray(total);
			try {
				const msg = JSON.parse(body) as JsonRpcMessage;
				onMessage(msg);
			} catch {
				// JSON parse error — keep going; ideally we'd send an error
				// response, but the spec leaves recovery here vague.
			}
		}
	});
}
