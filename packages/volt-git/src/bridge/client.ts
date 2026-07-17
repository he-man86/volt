/**
 * BridgeClient — talks to a local bridge daemon on 127.0.0.1:<port> (8555 default). The CLI depends
 * only on the `Remote` interface. Loopback HTTP via node:http (NOT global fetch — undici's keep-alive
 * pool races process.exit on Windows and trips a libuv assertion in short-lived CLIs). Every 2xx is
 * schema-validated.
 */
import { request as httpRequest } from "node:http";
import type { z } from "zod";
import {
	BuildResponseSchema,
	FetchResponseSchema,
	HealthResponseSchema,
	ProgressFrameSchema,
	PushResponseSchema,
	RefsResponseSchema,
	WIRE_VERSION,
	type BuildRequest,
	type BuildResponse,
	type FetchRequest,
	type FetchResponse,
	type HealthResponse,
	type ProgressHandler,
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
	/** Per-endpoint timeouts — /health must fail fast, a build can run for minutes. */
	private readonly timeouts: { health: number; refs: number; build: number };
	readonly port: number;

	/** Wire-version preflight runs once; the result (ok or the mismatch error) is cached. */
	private wireChecked = false;
	private wireError?: BridgeError;

	constructor(opts: BridgeClientOptions = {}) {
		this.port = opts.port ?? 8555;
		this.baseUrl = opts.baseUrl ?? `http://127.0.0.1:${this.port}`;
		this.timeoutMs = opts.timeoutMs ?? 60_000;
		// /health is a pure cache read (fast); /refs and /fetch do a full tree walk + per-item materialize, so
		// /refs keeps the general budget (a 15s cap here spuriously reported a slow-but-healthy bridge offline);
		// a build can run for minutes.
		this.timeouts = { health: 3_000, refs: Math.max(this.timeoutMs, 60_000), build: Math.max(this.timeoutMs, 180_000) };
	}

	async getHealth(): Promise<HealthResponse> {
		const health = await this.request("GET", "/health", HealthResponseSchema, undefined, this.timeouts.health);
		this.assertWireCompatible(health);
		return health;
	}

	/** Refuse to interpret a bridge whose wire version we don't recognize — runs once, then cached.
	 *  An absent `wireVersion` (a pre-guard bridge) is treated as a mismatch, not a schema error. */
	private assertWireCompatible(health: HealthResponse): void {
		if (this.wireChecked) {
			if (this.wireError) throw this.wireError;
			return;
		}
		const got = health.wireVersion;
		if (got !== WIRE_VERSION) {
			this.wireError = new BridgeError(
				"PROTOCOL_MISMATCH",
				`bridge speaks wire v${got ?? "unknown"}, this Volt needs wire v${WIRE_VERSION} — update the bridge so they match (restart CODESYS / reinstall Volt)`,
				426,
			);
		}
		this.wireChecked = true;
		if (this.wireError) throw this.wireError;
	}

	/** Ensure the wire version was checked before any data endpoint relies on the bridge. */
	private async preflight(): Promise<void> {
		if (this.wireChecked) {
			if (this.wireError) throw this.wireError;
			return;
		}
		await this.getHealth(); // sets wireChecked, throws PROTOCOL_MISMATCH on a mismatch
	}

	/**
	 * Defense against silent data loss: a bridge can return 200 with an EMPTY item set when its IDE handle has
	 * gone stale (disconnected). Interpreting that as truth means a pull deletes every file ("engineer deleted
	 * every POU"). This is the one place that cross-checks /health for any response carrying the item set —
	 * `/refs`, `/fetch`, `/init` — so no consumer (pull included) can bypass it. An empty set with the IDE
	 * genuinely attached (a legitimately empty project) is allowed through.
	 */
	private async guardEmptyItems(itemCount: number): Promise<void> {
		if (itemCount > 0) return;
		const health = await this.getHealth().catch(() => undefined);
		if (health !== undefined && health.connected !== true) {
			process.stderr.write(
				`[bridge-client] empty item set + /health.connected=false (status=${health.status}) — refusing to interpret as "engineer deleted everything"\n`,
			);
			throw new BridgeError(
				"PLC_DISCONNECTED",
				"bridge reported zero items AND /health says no IDE is attached — refusing to treat an empty project as truth",
				503,
			);
		}
	}

	async getRefs(): Promise<RefsResponse> {
		await this.preflight();
		const refs = await this.request("GET", "/refs", RefsResponseSchema, undefined, this.timeouts.refs);
		await this.guardEmptyItems(Object.keys(refs.items).length);
		return refs;
	}

	async fetchChanges(req: FetchRequest, onProgress?: ProgressHandler): Promise<FetchResponse> {
		await this.preflight();
		const resp = onProgress
			? await this.requestStream("POST", "/fetch", FetchResponseSchema, req, onProgress, this.timeoutMs)
			: await this.request("POST", "/fetch", FetchResponseSchema, req);
		await this.guardEmptyItems(Object.keys(resp.items).length);
		return resp;
	}

	async init(onProgress?: ProgressHandler): Promise<FetchResponse> {
		await this.preflight();
		const resp = onProgress
			? await this.requestStream("POST", "/init", FetchResponseSchema, {}, onProgress, this.timeoutMs)
			: await this.request("POST", "/init", FetchResponseSchema, {});
		await this.guardEmptyItems(Object.keys(resp.items).length);
		return resp;
	}

	async pushBatch(req: PushRequest, onProgress?: ProgressHandler): Promise<PushResponse> {
		await this.preflight();
		return onProgress
			? this.requestStream("POST", "/push", PushResponseSchema, req, onProgress, this.timeoutMs)
			: this.request("POST", "/push", PushResponseSchema, req);
	}

	async build(req: BuildRequest, onProgress?: ProgressHandler): Promise<BuildResponse> {
		await this.preflight();
		return onProgress
			? this.requestStream("POST", "/build", BuildResponseSchema, req, onProgress, this.timeouts.build)
			: this.request("POST", "/build", BuildResponseSchema, req, this.timeouts.build);
	}

	/** Poll `GET /refs` until the project version differs from the baseline, or reject on timeout.
	 *  Powers `volt wait-change` — a script or the AI can react to an IDE edit without blocking a connection. */
	async waitForChange(timeoutMs?: number): Promise<void> {
		const initial = await this.request("GET", "/refs", RefsResponseSchema)
		const deadline = timeoutMs !== undefined ? Date.now() + timeoutMs : undefined

		return new Promise<void>((resolve, reject) => {
			const poll = async () => {
				if (deadline !== undefined && Date.now() >= deadline) {
					reject(new BridgeError("CHANGE_TIMEOUT", `no IDE change within ${timeoutMs}ms`))
					return
				}
				try {
					const current = await this.request("GET", "/refs", RefsResponseSchema)
					if (current.projectVersion !== initial.projectVersion) {
						resolve()
						return
					}
				} catch {
					/* bridge not reachable — retry */
				}
				setTimeout(poll, 2000)
			}
			poll()
		})
	}

	private async request<T>(
		method: "GET" | "POST",
		path: string,
		schema: z.ZodType<T>,
		body?: unknown,
		timeoutMs?: number,
	): Promise<T> {
		const raw = await this.transport(method, path, body, timeoutMs);
		try {
			return schema.parse(raw);
		} catch (err) {
			if (isZodError(err)) {
				throw new BridgeError("MALFORMED_RESPONSE", `bridge ${path} returned malformed payload: ${formatZodError(err)}`);
			}
			throw err;
		}
	}

	/** Streamed variant: request NDJSON, forward each `progress` frame to `onProgress`, and resolve with the
	 *  terminal `result` (validated) — or reject on an `error` frame. Falls back to a single buffered body if the
	 *  bridge answered `application/json` anyway (an opted-in client hitting a non-streaming response). */
	private async requestStream<T>(
		method: "GET" | "POST",
		path: string,
		schema: z.ZodType<T>,
		body: unknown,
		onProgress: ProgressHandler,
		timeoutMs?: number,
	): Promise<T> {
		let result: unknown;
		let bufferedBody: unknown; // set when the bridge returned a single JSON object, not NDJSON frames
		let streamError: { code?: string; message?: string } | undefined;

		await this.transportStream(method, path, body, timeoutMs, (frame, wasSingleBody) => {
			if (wasSingleBody) {
				bufferedBody = frame;
				return;
			}
			if (!frame || typeof frame !== "object") return;
			const f = frame as Record<string, unknown>;
			if (f.progress !== undefined) {
				const p = ProgressFrameSchema.safeParse(f.progress);
				if (p.success) onProgress(p.data);
			} else if (f.result !== undefined) {
				result = f.result;
			} else if (f.error !== undefined) {
				const e = f.error as { code?: unknown; message?: unknown };
				streamError = {
					code: typeof e.code === "string" ? e.code : undefined,
					message: typeof e.message === "string" ? e.message : undefined,
				};
			}
		});

		if (streamError !== undefined) throw new BridgeError(streamError.code ?? "BRIDGE_ERROR", streamError.message ?? `bridge ${path} streamed an error`);
		const payload = result !== undefined ? result : bufferedBody;
		if (payload === undefined) throw new BridgeError("MALFORMED_RESPONSE", `bridge ${path} stream ended without a result`);
		try {
			return schema.parse(payload);
		} catch (err) {
			if (isZodError(err)) throw new BridgeError("MALFORMED_RESPONSE", `bridge ${path} returned malformed payload: ${formatZodError(err)}`);
			throw err;
		}
	}

	/** Read an NDJSON response line by line (or, if the bridge sent `application/json`, the single body) and hand
	 *  each parsed value to `onValue`. `wasSingleBody` is true only for the non-streamed fallback. */
	private async transportStream(
		method: "GET" | "POST",
		path: string,
		body: unknown,
		timeoutMs: number | undefined,
		onValue: (value: unknown, wasSingleBody: boolean) => void,
	): Promise<void> {
		const url = new URL(`${this.baseUrl}${path}`);
		const payload = body !== undefined ? Buffer.from(JSON.stringify(body), "utf-8") : undefined;
		const timeout = timeoutMs ?? this.timeoutMs;
		const headers: Record<string, string> = { connection: "close", accept: "application/x-ndjson" };
		if (payload !== undefined) {
			headers["content-type"] = "application/json";
			headers["content-length"] = String(payload.byteLength);
		}

		return new Promise<void>((resolve, reject) => {
			const req = httpRequest(
				{
					method,
					protocol: url.protocol,
					hostname: url.hostname,
					port: url.port || (url.protocol === "https:" ? 443 : 80),
					path: url.pathname + url.search,
					headers,
					timeout,
				},
				(res) => {
					const status = res.statusCode ?? 0;
					const isNdjson = (res.headers["content-type"] ?? "").includes("application/x-ndjson");
					const chunks: string[] = [];
					let pending = "";
					res.setEncoding("utf-8");

					if (status < 200 || status >= 300) {
						res.on("data", (c: string) => chunks.push(c));
						res.on("end", () => {
							const raw = chunks.join("");
							let parsed: unknown;
							try {
								parsed = raw.length > 0 ? JSON.parse(raw) : undefined;
							} catch {
								parsed = undefined;
							}
							const info = extractBridgeError(parsed);
							reject(new BridgeError(info?.code ?? `HTTP_${status}`, info?.message ?? `bridge ${path} → ${status} ${res.statusMessage ?? ""}`.trim(), status));
						});
						return;
					}

					if (!isNdjson) {
						// Fallback: a non-streaming bridge answered a single JSON object — collect and hand it back.
						res.on("data", (c: string) => chunks.push(c));
						res.on("end", () => {
							const raw = chunks.join("").trim();
							if (raw.length > 0) {
								try {
									onValue(JSON.parse(raw), true);
								} catch {
									/* ignore — requestStream reports "no result" */
								}
							}
							resolve();
						});
						res.on("error", (err) => reject(err));
						return;
					}

					res.on("data", (chunk: string) => {
						pending += chunk;
						let nl: number;
						while ((nl = pending.indexOf("\n")) >= 0) {
							const line = pending.slice(0, nl).trim();
							pending = pending.slice(nl + 1);
							if (line.length === 0) continue;
							try {
								onValue(JSON.parse(line), false);
							} catch {
								/* skip a partial/garbage line */
							}
						}
					});
					res.on("end", () => {
						const rest = pending.trim();
						if (rest.length > 0) {
							try {
								onValue(JSON.parse(rest), false);
							} catch {
								/* ignore trailing garbage */
							}
						}
						resolve();
					});
					res.on("error", (err) => reject(err));
				},
			);
			req.on("error", (err) => reject(err));
			req.on("timeout", () => {
				const err = new Error(`bridge ${path} timed out after ${timeout}ms`) as NodeJS.ErrnoException;
				err.code = "ETIMEDOUT";
				req.destroy(err);
			});
			if (payload !== undefined) req.write(payload);
			req.end();
		});
	}

	private async transport(method: "GET" | "POST", path: string, body?: unknown, timeoutMs?: number): Promise<unknown> {
		const url = new URL(`${this.baseUrl}${path}`);
		const payload = body !== undefined ? Buffer.from(JSON.stringify(body), "utf-8") : undefined;
		const timeout = timeoutMs ?? this.timeoutMs;
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
					timeout,
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
			req.on("timeout", () => {
				const err = new Error(`bridge ${path} timed out after ${timeout}ms`) as NodeJS.ErrnoException;
				err.code = "ETIMEDOUT";
				req.destroy(err);
			});
			if (payload !== undefined) req.write(payload);
			req.end();
		});
	}
}

/** Node socket-level codes that mean "the bridge isn't reachable" (vs a BridgeError, which is the bridge
 *  answering). node:http surfaces these on `err.code` — match those, not brittle message substrings. */
const OFFLINE_CODES = new Set([
	"ECONNREFUSED",
	"ETIMEDOUT",
	"ENOTFOUND",
	"ECONNRESET",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"EPIPE",
]);

/** Detect "bridge isn't running/reachable" so callers can hint usefully. A BridgeError means the bridge DID
 *  respond (just with an error), so that is never "offline". */
export function isBridgeOfflineError(err: unknown): boolean {
	if (err instanceof BridgeError) return false;
	if (!(err instanceof Error)) return false;
	const code = (err as NodeJS.ErrnoException).code;
	return code !== undefined && OFFLINE_CODES.has(code);
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
