/**
 * Mutation gate — prevents concurrent volt CLI operations on the same workspace.
 */
const inFlight = new Set<string>()

export function isMutationInFlight(workspaceRoot: string): boolean {
	return inFlight.has(workspaceRoot)
}

export function withGate<T>(workspaceRoot: string, fn: () => Promise<T>): Promise<T> {
	inFlight.add(workspaceRoot)
	return fn().finally(() => inFlight.delete(workspaceRoot))
}
