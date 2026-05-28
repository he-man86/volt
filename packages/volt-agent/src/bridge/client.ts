/**
 * BridgeClient — talks to a local bridge daemon (Beckhoff, CODESYS, TIA, …)
 * on the user's machine. The `volt` CLI doesn't know or care which one;
 * it depends on the `Remote` interface, and any bridge that satisfies that
 * interface plugs in.
 *
 * Loopback HTTP — no relay, no token. The bridge runs at 127.0.0.1:8555
 * by default.
 *
 * Wire model is git-inspired:
 *   - `/refs`    — current refs (project version + per-item versions)
 *   - `/fetch`   — pull only items the client doesn't already have
 *   - `/push`    — atomic batch with per-item ifVersion guards
 *   - `/build`   — build + diagnostics
 *
 * Error shape: bridges return `{ error: { code, message } }` on non-2xx
 * status. We parse that and throw `BridgeError` so tools can distinguish
 * `NOT_FOUND` / `ALREADY_EXISTS` / etc. from generic transport failures.
 */

import { request as httpRequest } from "node:http";
import type {
	BuildRequest,
	BuildResponse,
	FetchRequest,
	FetchResponse,
	HealthResponse,
	PushRequest,
	PushResponse,
	RefsResponse,
} from "./types.js";
import type { Remote } from "./remote.js";

export interface BridgeClientOptions {
	/** Bridge daemon port. Defaults to 8555 (the Volt convention). */
	port?: number;
	/** Override base URL entirely (useful for tests). */
	baseUrl?: string;
	/** Request timeout in ms. */
	timeoutMs?: number;
}

export class BridgeError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly status?: number,
	) {
		super(message);
		this.name = "BridgeError";
	}
}

export class BridgeClient implements Remote {
	private readonly baseUrl: string;
	private readonly timeoutMs: number;

	constructor(opts: BridgeClientOptions = {}) {
		this.baseUrl = opts.baseUrl ?? `http://127.0.0.1:${opts.port ?? 8555}`;
		this.timeoutMs = opts.timeoutMs ?? 60_000;
	}

	async getHealth(): Promise<HealthResponse> {
		return this.get<HealthResponse>("/health");
	}

	async getRefs(): Promise<RefsResponse> {
		return this.get<RefsResponse>("/refs");
	}

	async fetchChanges(req: FetchRequest): Promise<FetchResponse> {
		return this.post<FetchResponse>("/fetch", req);
	}

	async pushBatch(req: PushRequest): Promise<PushResponse> {
		return this.post<PushResponse>("/push", req);
	}

	async build(req: BuildRequest): Promise<BuildResponse> {
		return this.post<BuildResponse>("/build", req);
	}

	private async get<T>(path: string): Promise<T> {
		return this.request<T>("GET", path);
	}

	private async post<T>(path: string, body: unknown): Promise<T> {
		return this.request<T>("POST", path, body);
	}

	private async request<T>(
		method: "GET" | "POST",
		path: string,
		body?: unknown,
	): Promise<T> {
		// Use node:http directly rather than global fetch.
		//
		// Reason: global fetch (undici) keeps sockets in a keep-alive
		// pool with an internal wake-up async handle. When this client
		// is used from a short-lived CLI on Windows, the pool's
		// teardown races process.exit and trips a libuv assertion
		// (`!(handle->flags & UV_HANDLE_CLOSING)`). node:http with
		// per-request agent stays out of the global pool — the socket
		// closes when the response ends and the process exits clean.
		const url = new URL(`${this.baseUrl}${path}`);
		const payload = body !== undefined ? Buffer.from(JSON.stringify(body), "utf-8") : undefined;
		const headers: Record<string, string> = { connection: "close" };
		if (payload !== undefined) {
			headers["content-type"] = "application/json";
			headers["content-length"] = String(payload.byteLength);
		}

		return new Promise<T>((resolve, reject) => {
			const req = httpRequest(
				{
					method,
					protocol: url.protocol,
					hostname: url.hostname,
					port: url.port || (url.protocol === "https:" ? 443 : 80),
					path: url.pathname + url.search,
					headers,
					timeout: this.timeoutMs,
				},
				(res) => {
					const chunks: Buffer[] = [];
					res.on("data", (c: Buffer) => chunks.push(c));
					res.on("end", () => {
						const raw = Buffer.concat(chunks).toString("utf-8");
						let parsed: unknown;
						try {
							parsed = raw.length > 0 ? JSON.parse(raw) : undefined;
						} catch {
							parsed = undefined;
						}
						const status = res.statusCode ?? 0;
						if (status < 200 || status >= 300) {
							const errorInfo = extractBridgeError(parsed);
							reject(
								new BridgeError(
									errorInfo?.code ?? `HTTP_${status}`,
									errorInfo?.message ?? `bridge ${path} → ${status} ${res.statusMessage ?? ""}`.trim(),
									status,
								),
							);
							return;
						}
						resolve(parsed as T);
					});
					res.on("error", (err) => reject(err));
				},
			);
			req.on("error", (err) => reject(err));
			req.on("timeout", () => {
				req.destroy(new Error(`bridge ${path} timed out after ${this.timeoutMs}ms`));
			});
			if (payload !== undefined) req.write(payload);
			req.end();
		});
	}
}

/** Detect the "bridge isn't running" error so callers can give a useful hint. */
export function isBridgeOfflineError(err: unknown): boolean {
	if (err instanceof BridgeError) return false; // a parsed error means the daemon answered
	if (!(err instanceof Error)) return false;
	const msg = err.message.toLowerCase();
	return (
		msg.includes("econnrefused") ||
		msg.includes("fetch failed") ||
		msg.includes("abort") ||
		msg.includes("network")
	);
}

function extractBridgeError(
	body: unknown,
): { code?: string; message?: string } | undefined {
	if (!body || typeof body !== "object") return undefined;
	const maybe = (body as { error?: unknown }).error;
	if (!maybe || typeof maybe !== "object") return undefined;
	const err = maybe as { code?: unknown; message?: unknown };
	return {
		code: typeof err.code === "string" ? err.code : undefined,
		message: typeof err.message === "string" ? err.message : undefined,
	};
}
