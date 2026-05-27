/**
 * Per-workspace capability leases — the "sudo" of plcassist-agent.
 *
 * Problem: some operations (force-push that bypasses drift refusal,
 * future destructive verbs) are appropriate for a human at a terminal
 * but risky for an AI to invoke autonomously. Removing the parameter
 * from the MCP surface entirely (the previous design) is the safest
 * default, but blocks the legitimate workflow where an AI proposes a
 * force-push and a human wants to delegate it without retyping the
 * command themselves.
 *
 * Solution: capability LEASES. The human runs `plc grant <capability>
 * [--ttl <duration>] [--once]` from their terminal. That writes a
 * lease file to `.plcassist/auth/<capability>.lease` containing a
 * random nonce, an expiry timestamp, and a one-shot flag. The MCP
 * tool checks for an active lease before honoring the elevated
 * parameter; AI calls without a lease get a clear error explaining
 * that the human must grant the capability first. Active leases are
 * surfaced in `plc_status` so the AI can see which capabilities are
 * currently available without trying-and-failing.
 *
 * Why this is stronger than a conversational "yes do it":
 *   - The lease lives on the filesystem, not in chat. Prompt-injected
 *     "approved by user" text doesn't matter.
 *   - The lease originates from the CLI, a separate channel from MCP.
 *     AI cannot forge a lease through any MCP-exposed surface.
 *   - Leases auto-expire (default 5 minutes). Forgotten grants don't
 *     accumulate latent capability.
 *   - `--once` consumes the lease on first use. Standard "I'm
 *     approving exactly one operation" pattern.
 *
 * Why a JSON file instead of an in-memory token store:
 *   - The MCP server is a per-session process; humans should be able
 *     to grant a lease and have it persist across server restarts.
 *   - The bridge / CLI / MCP all share the same workspace; filesystem
 *     is the natural rendezvous.
 *   - `.plcassist/` is gitignored, so leases never leak into a
 *     committed repo.
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { workspacePaths } from "./config.js";

/**
 * Capabilities AI clients may receive via lease. Adding a new entry
 * here is the single point that authorizes a new elevated parameter
 * for AI use. The CLI's `plc grant` verb validates against this list.
 *
 * `push-force` covers `plc_push({ force: true })` — bypassing the
 * drift refusal and adopting the bridge's current per-item versions.
 */
export const KNOWN_CAPABILITIES = ["push-force"] as const;
export type Capability = (typeof KNOWN_CAPABILITIES)[number];

export function isKnownCapability(s: string): s is Capability {
	return (KNOWN_CAPABILITIES as readonly string[]).includes(s);
}

/** What a lease file contains. */
export interface Lease {
	capability: Capability;
	/** 16-byte hex nonce — purely audit trail, not used for auth. */
	nonce: string;
	/** ISO-8601 timestamp when the grant was issued. */
	issuedAt: string;
	/** ISO-8601 timestamp when the lease expires. */
	expiresAt: string;
	/** True if the lease is consumed on first successful use. */
	oneShot: boolean;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Parse a CLI duration string like "5m", "30s", "1h", "200ms" into
 * milliseconds. Throws on unrecognized format — the caller (the CLI
 * verb) wants a friendly error message, not a silent fallback.
 */
export function parseTtl(raw: string): number {
	const m = /^(\d+)(ms|s|m|h)$/.exec(raw);
	if (m === null) {
		throw new Error(
			`unrecognized duration "${raw}" — expected like 30s, 5m, 1h, or 200ms`,
		);
	}
	const n = Number.parseInt(m[1]!, 10);
	const unit = m[2]!;
	const multipliers: Record<string, number> = {
		ms: 1,
		s: 1_000,
		m: 60_000,
		h: 3_600_000,
	};
	const ms = n * multipliers[unit]!;
	if (ms <= 0) throw new Error(`duration "${raw}" must be positive`);
	if (ms > 24 * 3_600_000) {
		// 24h cap: leases are session-scoped tools, not persistent grants.
		// If you need longer, you should be reviewing the policy itself.
		throw new Error(`duration "${raw}" exceeds 24h — leases are session-scoped`);
	}
	return ms;
}

/**
 * Write a lease file for `capability`. Returns the lease metadata for
 * the CLI to echo back to the user. Overwrites any prior lease for
 * the same capability — last grant wins.
 */
export function issueLease(
	workspaceRoot: string,
	capability: Capability,
	opts: { ttlMs?: number; oneShot?: boolean } = {},
): Lease {
	const { authDir } = workspacePaths(workspaceRoot);
	if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true });
	const now = Date.now();
	const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
	const lease: Lease = {
		capability,
		nonce: randomBytes(16).toString("hex"),
		issuedAt: new Date(now).toISOString(),
		expiresAt: new Date(now + ttlMs).toISOString(),
		oneShot: opts.oneShot ?? false,
	};
	writeFileSync(leasePath(workspaceRoot, capability), `${JSON.stringify(lease, null, 2)}\n`, "utf-8");
	return lease;
}

/**
 * Read a lease for `capability`. Returns `null` if no lease exists or
 * the lease has expired. Expired leases are auto-cleaned (the file
 * is deleted) so subsequent reads are fast and so `plc_status`
 * doesn't keep showing stale entries.
 */
export function checkLease(
	workspaceRoot: string,
	capability: Capability,
): Lease | null {
	const path = leasePath(workspaceRoot, capability);
	if (!existsSync(path)) return null;
	let lease: Lease;
	try {
		lease = JSON.parse(readFileSync(path, "utf-8")) as Lease;
	} catch {
		// Malformed lease = no lease. Don't trust it.
		safeDelete(path);
		return null;
	}
	if (typeof lease.expiresAt !== "string") {
		safeDelete(path);
		return null;
	}
	if (Date.parse(lease.expiresAt) <= Date.now()) {
		safeDelete(path);
		return null;
	}
	return lease;
}

/**
 * Consume a one-shot lease (delete the file) and return whether the
 * deletion happened. No-op (returns false) for multi-use leases or
 * when no lease exists. Called after the elevated operation completed
 * successfully — if the op failed, the lease should remain available
 * for retry.
 */
export function consumeLeaseIfOneShot(
	workspaceRoot: string,
	capability: Capability,
): boolean {
	const lease = checkLease(workspaceRoot, capability);
	if (lease === null) return false;
	if (!lease.oneShot) return false;
	safeDelete(leasePath(workspaceRoot, capability));
	return true;
}

/**
 * Manually revoke a lease. Used by `plc revoke <capability>` and as a
 * safety net (e.g. workspace-bind change clears stale auth).
 */
export function revokeLease(workspaceRoot: string, capability: Capability): boolean {
	const path = leasePath(workspaceRoot, capability);
	if (!existsSync(path)) return false;
	safeDelete(path);
	return true;
}

/**
 * Enumerate all active (non-expired) leases for the workspace. Used
 * by `plc_status` to surface available capabilities to the AI without
 * the AI having to probe each one. Expired leases are cleaned as a
 * side effect of the per-capability checkLease.
 */
export function listActiveLeases(workspaceRoot: string): Lease[] {
	const { authDir } = workspacePaths(workspaceRoot);
	if (!existsSync(authDir)) return [];
	const out: Lease[] = [];
	for (const entry of readdirSync(authDir)) {
		if (!entry.endsWith(".lease")) continue;
		const cap = entry.slice(0, -".lease".length);
		if (!isKnownCapability(cap)) continue;
		const l = checkLease(workspaceRoot, cap);
		if (l !== null) out.push(l);
	}
	return out;
}

function leasePath(workspaceRoot: string, capability: Capability): string {
	return join(workspacePaths(workspaceRoot).authDir, `${capability}.lease`);
}

function safeDelete(path: string): void {
	try {
		rmSync(path, { force: true });
	} catch {
		/* best effort — next call will just re-detect and re-attempt */
	}
}
