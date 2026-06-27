/**
 * BridgeClient — talks to a local bridge daemon on 127.0.0.1:<port> (8555 default). The CLI depends
 * only on the `Remote` interface. Loopback HTTP via node:http (NOT global fetch — undici's keep-alive
 * pool races process.exit on Windows and trips a libuv assertion in short-lived CLIs). Every 2xx is
 * schema-validated. Verbatim contract copy from volt-cli.
 */
import { request as httpRequest } from "node:http";
import type { z } from "zod";
import {
	BuildResponseSchema,
	FetchResponseSchema,
	HealthResponseSchema,
	PushResponseSchema,
	RefsResponseSchema,
	type BuildRequest,
	type BuildResponse,
	type FetchRequest,
	type FetchResponse,
	type HealthResponse,
	type PushRequest,
	type PushResponse,
	type RefsResponse,
	type Remote,
} from "./types.js";

export interface BridgeClientOptions {
	port?: number;
	baseUrl?: string;
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
	readonly port: number;

	constructor(opts: BridgeClientOptions = {}) {
		this.port = opts.port ?? 8555;
		this.baseUrl = opts.baseUrl ?? `http://127.0.0.1:${this.port}`;
		this.timeoutMs = opts.timeoutMs ?? 60_000;
	}

	async getHealth(): Promise<HealthResponse> {
		return this.request("GET", "/health", HealthResponseSchema);
	}

	async getRefs(): Promise<RefsResponse> {
		const refs = await this.request("GET", "/refs", RefsResponseSchema);
		// Defense: a bridge can return 200 with an empty items map when the IDE handle has gone stale.
		// Treating that as truth risks a destructive pull ("engineer deleted every POU"). Cross-check
		// /health; if no IDE is attached, throw the same disconnected error every consumer already routes.
		if (Object.keys(refs.items).length === 0) {
			const health = await this.getHealth().catch(() => undefined);
			if (health !== undefined && health.connected !== true) {
				process.stderr.write(
					`[bridge-client] empty /refs + /health.connected=false (status=${health.status}) — refusing to interpret as "engineer deleted everything"\n`,
				);
				throw new BridgeError(
					"PLC_DISCONNECTED",
					"bridge reported zero items AND /health says no IDE is attached — refusing to treat empty refs as truth",
					503,
				);
			}
		}
		return refs;
	}

	async fetchChanges(req: FetchRequest): Promise<FetchResponse> {
		return this.request("POST", "/fetch", FetchResponseSchema, req);
	}

	async pushBatch(req: PushRequest): Promise<PushResponse> {
		return this.request("POST", "/push", PushResponseSchema, req);
	}

	async build(req: BuildRequest): Promise<BuildResponse> {
		return this.request("POST", "/build", BuildResponseSchema, req);
	}

	private async request<T>(
		method: "GET" | "POST",
		path: string,
		schema: z.ZodType<T>,
		body?: unknown,
	): Promise<T> {
		const raw = await this.transport(method, path, body);
		try {
			return schema.parse(raw);
		} catch (err) {
			if (isZodError(err)) {
				throw new BridgeError("MALFORMED_RESPONSE", `bridge ${path} returned malformed payload: ${formatZodError(err)}`);
			}
			throw err;
		}
	}

	private async transport(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
		const url = new URL(`${this.baseUrl}${path}`);
		const payload = body !== undefined ? Buffer.from(JSON.stringify(body), "utf-8") : undefined;
		const headers: Record<string, string> = { connection: "close" };
		if (payload !== undefined) {
			headers["content-type"] = "application/json";
			headers["content-length"] = String(payload.byteLength);
		}

		return new Promise<unknown>((resolve, reject) => {
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
						resolve(parsed);
					});
					res.on("error", (err) => reject(err));
				},
			);
			req.on("error", (err) => reject(err));
			req.on("timeout", () => req.destroy(new Error(`bridge ${path} timed out after ${this.timeoutMs}ms`)));
			if (payload !== undefined) req.write(payload);
			req.end();
		});
	}
}

/** Detect "bridge isn't running" so callers can hint usefully. */
export function isBridgeOfflineError(err: unknown): boolean {
	if (err instanceof BridgeError) return false;
	if (!(err instanceof Error)) return false;
	const msg = err.message.toLowerCase();
	return msg.includes("econnrefused") || msg.includes("fetch failed") || msg.includes("abort") || msg.includes("network");
}

function extractBridgeError(body: unknown): { code?: string; message?: string } | undefined {
	if (!body || typeof body !== "object") return undefined;
	const maybe = (body as { error?: unknown }).error;
	if (!maybe || typeof maybe !== "object") return undefined;
	const err = maybe as { code?: unknown; message?: unknown };
	return {
		code: typeof err.code === "string" ? err.code : undefined,
		message: typeof err.message === "string" ? err.message : undefined,
	};
}

interface ZodErrorLike {
	issues: Array<{ path: Array<string | number>; message: string }>;
}
function isZodError(err: unknown): err is ZodErrorLike {
	return err instanceof Error && err.name === "ZodError" && Array.isArray((err as { issues?: unknown }).issues);
}
function formatZodError(err: ZodErrorLike): string {
	return err.issues
		.slice(0, 3)
		.map((i) => `${i.path.length > 0 ? i.path.join(".") : "<root>"}: ${i.message}`)
		.join("; ");
}
