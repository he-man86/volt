/**
 * Lightweight bridge `/health` probe used by the activity-bar TreeView
 * for the live "Connected: <IDE> <project>" badge.
 *
 * Deliberately bypasses `volt status --json` (which runs the full
 * /refs walk + classification) — health is cheap (~1ms COM probe in
 * the bridge), so we hit it directly via the bridge's HTTP surface
 * every ~30s while the Volt view is visible. Refreshes the full
 * status only on user-driven events (view focus, manual refresh,
 * workspace file change), not on a timer.
 *
 * The bridge port is read from each workspace's `.volt/config.json`.
 */
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";

/** Mirror of bridge BuildHealthSnapshot wire shape. All fields optional
 *  because vendors may diverge as the bridge schema evolves; we only
 *  rely on the ones we display. */
export interface BridgeHealth {
	status: "healthy" | "degraded" | "unavailable" | string;
	connected: boolean;
	ideAlive?: boolean;
	degraded?: boolean;
	degradedReason?: string | null;
	ideName?: string | null;
	ideVersion?: string | null;
	platform?: string;
	projectName?: string | null;
	plcProjectName?: string | null;
	version?: string;
	projectDirty?: boolean;
}

/** Three high-level states the UI cares about. */
export type HealthState =
	| { kind: "unknown" }
	| { kind: "connected"; health: BridgeHealth }
	| { kind: "degraded"; health: BridgeHealth }
	| { kind: "disconnected"; health: BridgeHealth }
	| { kind: "unreachable"; reason: string };

/** True iff the bridge is reachable AND the PLC IDE has a project open
 *  (= safe to run `volt status --json`). `degraded` counts as online —
 *  it means "bridge up, PLC up, but with caveats" (slow extractor, etc.)
 *  which doesn't block status. */
export function isBridgeOnline(h: HealthState): boolean {
	return h.kind === "connected" || h.kind === "degraded";
}

/** Human-readable reason a bridge is NOT online. Empty string when it is. */
export function describeOffline(h: HealthState): string {
	if (h.kind === "disconnected") {
		const detail = h.health.degradedReason ?? h.health.status ?? "PLC disconnected";
		return String(detail);
	}
	if (h.kind === "unreachable") return h.reason;
	if (h.kind === "unknown") return "probing…";
	return "";
}

/** Read `.volt/config.json` and pull the bridge port. Returns undefined
 *  on missing / malformed config — the caller surfaces this as an
 *  "unreachable" state rather than crashing. */
export function readBridgePort(workspaceRoot: string): number | undefined {
	try {
		const raw = readFileSync(join(workspaceRoot, ".volt", "config.json"), "utf-8");
		const parsed = JSON.parse(raw) as { bridge?: { port?: unknown } };
		const port = parsed.bridge?.port;
		if (typeof port === "number" && Number.isFinite(port)) return port;
		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * GET `http://localhost:<port>/health` with a short timeout. Resolves
 * to a `HealthState` describing what the bridge says (or that we
 * couldn't reach it). Never throws — the caller renders the state
 * directly into the badge.
 */
export async function probeHealth(port: number, timeoutMs = 2_000): Promise<HealthState> {
	return new Promise<HealthState>((resolve) => {
		const req = httpRequest(
			{
				method: "GET",
				hostname: "127.0.0.1",
				port,
				path: "/health",
				timeout: timeoutMs,
				headers: { connection: "close" },
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () => {
					const raw = Buffer.concat(chunks).toString("utf-8");
					let parsed: BridgeHealth | undefined;
					try {
						parsed = JSON.parse(raw) as BridgeHealth;
					} catch {
						resolve({ kind: "unreachable", reason: `bridge returned non-JSON (HTTP ${res.statusCode ?? "?"})` });
						return;
					}
					// Treat any 2xx with a parseable health shape as truth.
					// 503 PLC_DISCONNECTED also produces a parseable error
					// envelope, but we route it as "disconnected" only if
					// the bridge served the structured /health snapshot.
					if (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300 && parsed.status !== undefined) {
						if (parsed.connected && parsed.status === "healthy") {
							resolve({ kind: "connected", health: parsed });
						} else if (parsed.connected && parsed.status === "degraded") {
							resolve({ kind: "degraded", health: parsed });
						} else {
							resolve({ kind: "disconnected", health: parsed });
						}
						return;
					}
					resolve({ kind: "unreachable", reason: `HTTP ${res.statusCode ?? "?"}` });
				});
				res.on("error", (err) => resolve({ kind: "unreachable", reason: err.message }));
			},
		);
		req.on("error", (err) => resolve({ kind: "unreachable", reason: err.message }));
		req.on("timeout", () => {
			req.destroy();
			resolve({ kind: "unreachable", reason: `timeout after ${timeoutMs}ms` });
		});
		req.end();
	});
}

/**
 * One-line label for the badge. Stable across renders — same input
 * produces same output, no timestamps. The TreeView's header item
 * pairs this with a ThemeIcon for the color dot.
 */
export function healthLabel(state: HealthState): string {
	switch (state.kind) {
		case "unknown":
			return "Probing IDE…";
		case "connected": {
			// No "Connected:" prefix — the green dot at position 0 of
			// the row already carries that. Just the identity.
			const ide = state.health.ideName ?? "IDE";
			const project = state.health.plcProjectName ?? state.health.projectName ?? "(no project)";
			return `${ide} — ${project}`;
		}
		case "degraded": {
			const reason = state.health.degradedReason ?? "previous call failed";
			return `Degraded: ${reason}`;
		}
		case "disconnected":
			// Short. The full "open the PLC IDE with a project loaded"
			// guidance lives in the row's tooltip — see healthTooltip().
			return "No project loaded";
		case "unreachable":
			return `Bridge unreachable: ${friendlyUnreachableReason(state.reason)}`;
	}
}

/**
 * Map common error strings (Node/Win32 errno codes, timeout patterns)
 * to short user-friendly labels. The raw string lives on in the
 * tooltip for diagnosis — this is just the BADGE label, where we
 * want a glanceable phrase, not technical detail.
 */
function friendlyUnreachableReason(raw: string): string {
	const lower = raw.toLowerCase();
	if (lower.includes("econnrefused")) return "bridge not running";
	if (lower.includes("timeout") || lower.includes("etimedout")) return "bridge not responding";
	if (lower.includes("enetunreach") || lower.includes("enotfound")) return "network unreachable";
	if (lower.includes("ehostunreach")) return "host unreachable";
	if (lower.includes("config.json")) return "no Volt config in workspace";
	if (lower.includes("returned non-json")) return "bridge returned invalid response";
	if (lower.startsWith("http ")) return raw; // already concise (e.g. "HTTP 502")
	// Fallback — strip the leading "connect " prefix Node adds and
	// keep the rest readable.
	return raw.replace(/^connect\s+/i, "").slice(0, 80);
}
