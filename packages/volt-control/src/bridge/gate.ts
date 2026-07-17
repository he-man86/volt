// A mutation gate per workspace: while a pull/push/init runs, the trackers must not read the project's own
// dirtying as an engineer edit. Refcounted (not a bool/Set) because mutations on one workspace can overlap —
// pull-then-push, or the force-pull→pull chain — and the first to finish must NOT clear the gate out from
// under the second still running.
const depth = new Map<string, number>()

export function isMutationInFlight(workspaceRoot: string): boolean {
	return (depth.get(workspaceRoot) ?? 0) > 0
}

export function withGate<T>(workspaceRoot: string, fn: () => Promise<T>): Promise<T> {
	depth.set(workspaceRoot, (depth.get(workspaceRoot) ?? 0) + 1)
	return fn().finally(() => {
		const n = (depth.get(workspaceRoot) ?? 1) - 1
		if (n <= 0) depth.delete(workspaceRoot)
		else depth.set(workspaceRoot, n)
	})
}
