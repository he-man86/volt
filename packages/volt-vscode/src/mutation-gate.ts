/**
 * MutationGate — single owner of "is a mutating CLI invocation in flight
 * against this workspace?"
 *
 * Why a module: the flag was previously a free-floating `Set<string>`
 * exported across files (`cli.ts` mutated it; `scm.ts`'s heartbeat and
 * connection-loss toast suppression read it). Three independent files
 * had to agree on the invariant that the flag is set *before* the CLI
 * spawn and cleared *after* the post-mutation refresh. Each one was
 * one careful ordering mistake away from a regression (1.19.3 was
 * exactly that — see git history).
 *
 * Single API: `withGate(cwd, fn)` brackets a block of async work in
 * the gate. The caller can't accidentally clear the flag before fn
 * resolves; the inflight check is the only public read surface.
 *
 * The gate exists for two consumers:
 *   1. SCM heartbeat (`scm.ts`): skip the /health probe while a
 *      mutation is running so the 2s probe doesn't time out behind
 *      a /refs/fetch walk on the bridge's single COM thread.
 *   2. Connection-loss toast (`scm.ts`): suppress the toast when a
 *      /health probe lands in the post-mutation recovery window —
 *      it's a flake from COM-thread contention, not a real disconnect.
 *
 * Both reads go through `isInFlight(cwd)`. Both invariants
 * (set-before-spawn, hold-through-refresh) are owned by `withGate`.
 */

const inflight = new Set<string>();

/**
 * True while a mutating CLI invocation is running against this workspace
 * cwd. SCM consumers use this to gate /health probes and toast emission
 * during the COM-thread-busy window. Returns false outside `withGate`.
 */
export function isMutationInFlight(cwd: string): boolean {
	return inflight.has(cwd);
}

/**
 * Bracket a block of async work in the mutation gate.
 *
 * The gate is set BEFORE fn runs and cleared in a `finally`, so even
 * if fn throws the flag is released. The caller can't get the ordering
 * wrong because the flag isn't reachable directly. Callers should
 * include the post-mutation refresh inside fn — keeping the gate held
 * during the refresh's /health probe is what suppresses the spurious
 * "lost IDE connection" toast.
 *
 * Concurrent calls with the SAME cwd are not coalesced here — that's
 * the responsibility of the CLI concurrency guard (`runWithCliGuard`).
 * Multiple cwds run independently.
 */
export async function withGate<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
	inflight.add(cwd);
	try {
		return await fn();
	} finally {
		inflight.delete(cwd);
	}
}
