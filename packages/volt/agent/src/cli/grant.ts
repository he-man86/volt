/**
 * `volt grant <capability> [--ttl <duration>] [--once]` — issue a
 * capability lease so AI clients can use elevated parameters that are
 * gated behind it (currently: `push-force`).
 *
 * Why this verb is CLI-only: leases must originate from a channel the
 * AI cannot reach. The terminal session IS that channel. If grant
 * were exposed over MCP, AI could grant itself permission — which
 * defeats the entire point.
 */
import { configExists } from "../engine/config.js";
import {
	KNOWN_CAPABILITIES,
	isKnownCapability,
	issueLease,
	parseTtl,
	revokeLease,
} from "../engine/lease.js";
import { flagBool, flagString, type VerbFn } from "./_shared.js";

export const grant: VerbFn = async ({ workspace, flags }) => {
	const positional = readPositional(flags);
	if (positional === undefined) {
		process.stderr.write(
			`usage: volt grant <capability> [--ttl <duration>] [--once]\n\n` +
				`Known capabilities:\n${KNOWN_CAPABILITIES.map((c) => `  - ${c}`).join("\n")}\n`,
		);
		return 1;
	}
	if (!isKnownCapability(positional)) {
		process.stderr.write(
			`unknown capability: ${positional}\n\n` +
				`Known capabilities:\n${KNOWN_CAPABILITIES.map((c) => `  - ${c}`).join("\n")}\n`,
		);
		return 1;
	}
	if (!configExists(workspace)) {
		process.stderr.write(
			`workspace is not initialized — run \`volt init\` first.\n`,
		);
		return 1;
	}
	const ttlRaw = flagString(flags, "ttl");
	let ttlMs: number | undefined;
	if (ttlRaw !== undefined) {
		try {
			ttlMs = parseTtl(ttlRaw);
		} catch (err) {
			process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
			return 1;
		}
	}
	const oneShot = flagBool(flags, "once");
	const lease = issueLease(workspace, positional, { ttlMs, oneShot });
	const ttlHuman = ttlRaw ?? "5m (default)";
	const expires = new Date(lease.expiresAt);
	console.log(`granted: ${positional} for ${ttlHuman}${oneShot ? " (one-shot)" : ""}`);
	console.log(`expires: ${expires.toISOString()} (${remainingHuman(lease.expiresAt)})`);
	console.log(`lease:   .volt/auth/${positional}.lease`);
	console.log("");
	console.log(
		`The AI can now call elevated operations gated on '${positional}'. ` +
			`The lease ${oneShot ? "will be consumed on first use." : "stays valid until expiry."}`,
	);
	return 0;
};

/**
 * `volt revoke <capability>` — manually revoke a lease before it
 * expires. Standard sudo-style "kill the credential" — used when you
 * change your mind, or as a safety net before walking away from the
 * terminal.
 */
export const revoke: VerbFn = async ({ workspace, flags }) => {
	const positional = readPositional(flags);
	if (positional === undefined) {
		process.stderr.write(`usage: volt revoke <capability>\n`);
		return 1;
	}
	if (!isKnownCapability(positional)) {
		process.stderr.write(`unknown capability: ${positional}\n`);
		return 1;
	}
	const existed = revokeLease(workspace, positional);
	if (existed) {
		console.log(`revoked: ${positional}`);
	} else {
		console.log(`no active lease for ${positional}`);
	}
	return 0;
};

// Positional capability arg lives in flags["_positional"] thanks to the
// dispatcher's argv pre-pass (see parseArgs in cli/index.ts).
function readPositional(flags: { [k: string]: string | boolean }): string | undefined {
	const p = flags["_positional"];
	return typeof p === "string" && p.length > 0 ? p : undefined;
}

function remainingHuman(expiresAtIso: string): string {
	const ms = Date.parse(expiresAtIso) - Date.now();
	if (ms <= 0) return "expired";
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s remaining`;
	const m = Math.floor(s / 60);
	const r = s % 60;
	return r === 0 ? `${m}m remaining` : `${m}m ${r}s remaining`;
}
