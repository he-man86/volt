/**
 * Tiny utility surface shared by every CLI verb file. Kept minimal on
 * purpose — anything that grows beyond "argv flag parsing + a couple
 * of bridge-error helpers" should live in `engine/`, not here.
 */
import { BridgeClient, isBridgeOfflineError } from "../bridge/client.js";

export type Flags = Record<string, string | boolean>;

export interface VerbContext {
	/** Workspace root the verb operates on. */
	workspace: string;
	/** Bridge HTTP port. */
	port: number;
	/** Bridge client constructed against the resolved port. */
	bridge: BridgeClient;
	/** All flags as parsed; verbs reach in for verb-specific ones (`--force`, `--full`, …). */
	flags: Flags;
}

/**
 * Per-verb entry shape. Each `cli/<verb>.ts` exports one of these.
 * Returns the process exit code; never calls process.exit itself —
 * the top-level dispatcher does that, so verbs stay testable.
 */
export type VerbFn = (ctx: VerbContext) => Promise<number>;

export function flagInt(flags: Flags, key: string, fallback: number): number {
	const raw = flags[key];
	if (typeof raw !== "string") return fallback;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) ? n : fallback;
}

export function flagString(flags: Flags, key: string): string | undefined {
	const raw = flags[key];
	return typeof raw === "string" ? raw : undefined;
}

export function flagBool(flags: Flags, key: string): boolean {
	return flags[key] === true;
}

/** Write the standard "bridge unreachable, is it running?" hint to stderr. */
export function bridgeOfflineHint(err: unknown): void {
	process.stderr.write(`bridge unreachable: ${err instanceof Error ? err.message : err}\n`);
	process.stderr.write("is the bridge running? (bridges/dist/BeckhoffBridge.exe with the IDE open)\n");
}

/**
 * Wrap a verb body so bridge-offline errors land as a friendly message
 * (exit 1) and other errors land as `error: …` (exit 1). Returns the
 * verb's natural exit code on success, OR 1 on failure.
 */
export async function safeVerb(verb: VerbFn, ctx: VerbContext): Promise<number> {
	try {
		return await verb(ctx);
	} catch (err) {
		if (isBridgeOfflineError(err)) {
			bridgeOfflineHint(err);
			return 1;
		}
		process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
		return 1;
	}
}
